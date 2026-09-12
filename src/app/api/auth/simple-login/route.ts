import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/data-mode";

const FIXED_EMAIL = "admin@moneyplanner.local";

/** 进程内登录限流：每个 IP 每 5 分钟最多 10 次尝试（单实例够用；多实例需换共享存储） */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function tooManyAttempts(ip: string): boolean {
  const now = Date.now();
  const rec = attempts.get(ip);
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  rec.count += 1;
  return rec.count > MAX_ATTEMPTS;
}

export async function POST(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  if (tooManyAttempts(ip)) {
    return NextResponse.json(
      { ok: false, error: "尝试次数过多，请 5 分钟后再试" },
      { status: 429 },
    );
  }

  try {
    const { password } = await request.json();
    const envPassword = process.env.APP_PASSWORD?.trim();

    if (!envPassword) {
      return NextResponse.json({ ok: false, error: "服务器未配置 APP_PASSWORD" }, { status: 500 });
    }

    if (typeof password !== "string" || password !== envPassword) {
      return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
    }

    // 密码正确，使用固定账号在 Supabase 登录或在本地模式放行
    const { url, anonKey } = getSupabaseEnv();

    const cookieStore = await cookies();

    if (!url || !anonKey) {
      // 演示/无数据库模式：写入长期免登 cookie 即可
      cookieStore.set("mp_local_session", "true", {
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
        sameSite: "lax",
      });
      return NextResponse.json({ ok: true });
    }

    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, {
                ...options,
                maxAge: 60 * 60 * 24 * 365, // 手机端保持登录 1 年
                path: "/",
                sameSite: "lax",
              });
            }
          } catch {
            // ignore
          }
        },
      },
    });

    // 映射一个稳定且符合 Supabase 复杂度要求的内部密码（至少 8 位），
    // 这样用户在 APP_PASSWORD 里设置任何方便手机输入的密码（如纯数字或短词）都不会被 Supabase 校验拦截
    const internalSupabasePassword = `mp_${envPassword}_2026_secure`;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: FIXED_EMAIL,
      password: internalSupabasePassword,
    });

    if (signInError && (signInError.message.includes("Invalid login credentials") || signInError.message.includes("User not found"))) {
      // 账号不存在，自动注册
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: FIXED_EMAIL,
        password: internalSupabasePassword,
      });
      if (signUpError) {
        if (signUpError.message.toLowerCase().includes("email logins are disabled") || signUpError.message.toLowerCase().includes("signup is disabled")) {
          return NextResponse.json(
            {
              ok: false,
              error: "Supabase 的 Email 登录总开关被关闭了。请在 Supabase 后台 Authentication -> Providers -> Email 中重新打开顶部的「Enable Email provider」，然后仅关闭下方的「Confirm email」复选框。",
            },
            { status: 400 },
          );
        }
        if (/already registered/i.test(signUpError.message)) {
          // APP_PASSWORD 改过：固定账号的真实密码由旧密码派生，signIn 失败后
          // signUp 又撞上「已注册」。给出可操作的恢复指引而不是裸 500。
          return NextResponse.json(
            {
              ok: false,
              error:
                "APP_PASSWORD 修改过，固定账号的内部密码还是按旧密码派生的。请在 Supabase Dashboard → Authentication → Users 里删除 " +
                FIXED_EMAIL +
                "，之后重新登录即可自动注册；或把该用户密码直接改成 mp_" +
                envPassword +
                "_2026_secure。",
            },
            { status: 409 },
          );
        }
        return NextResponse.json({ ok: false, error: "自动注册失败：" + signUpError.message }, { status: 500 });
      }

      // 如果 Supabase 开启了自动确认，signUpData 会直接带 session
      if (!signUpData.session) {
        const { error: retryError } = await supabase.auth.signInWithPassword({
          email: FIXED_EMAIL,
          password: internalSupabasePassword,
        });
        if (retryError) {
          if (retryError.message.toLowerCase().includes("email not confirmed")) {
            return NextResponse.json(
              {
                ok: false,
                error: "请前往 Supabase -> Authentication -> Providers -> Email，取消勾选下方的「Confirm email」并点击 Save（注意：不要关闭最上方的 Enable Email provider）。",
              },
              { status: 400 },
            );
          }
          return NextResponse.json({ ok: false, error: "注册后登录失败：" + retryError.message }, { status: 500 });
        }
      }
    } else if (signInError) {
      const msg = signInError.message.toLowerCase();
      if (msg.includes("email logins are disabled")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Supabase 的 Email 登录总开关被关闭了。请前往 Supabase -> Authentication -> Providers -> Email，重新把最上方的「Enable Email provider」开关打开（保持紫色），然后仅取消勾选下方的「Confirm email」并保存。",
          },
          { status: 400 },
        );
      }
      if (msg.includes("email not confirmed")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Supabase 提示邮箱未验证。请前往 Supabase -> Authentication -> Providers -> Email，取消勾选下方的「Confirm email」并保存。",
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: false, error: "登录失败：" + signInError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "登录请求处理失败" },
      { status: 500 },
    );
  }
}

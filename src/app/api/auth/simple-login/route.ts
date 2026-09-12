import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/data-mode";

const FIXED_EMAIL = "admin@moneyplanner.local";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const envPassword = process.env.APP_PASSWORD?.trim();

    if (!envPassword) {
      return NextResponse.json({ ok: false, error: "服务器未配置 APP_PASSWORD" }, { status: 500 });
    }

    if (password !== envPassword) {
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

    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
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
                error: "Supabase 项目开启了邮箱验证，请在 Supabase 后台 Authentication -> Providers -> Email 中关闭「Confirm email」。",
              },
              { status: 400 },
            );
          }
          return NextResponse.json({ ok: false, error: "注册后登录失败：" + retryError.message }, { status: 500 });
        }
      }
    } else if (signInError) {
      if (signInError.message.toLowerCase().includes("email not confirmed")) {
        return NextResponse.json(
          {
            ok: false,
            error: "Supabase 提示邮箱未验证，请在 Supabase 后台 Authentication -> Providers -> Email 中关闭「Confirm email」。",
          },
          { status: 400 },
        );
      }
      return NextResponse.json({ ok: false, error: "登录失败：" + signInError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

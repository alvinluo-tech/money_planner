import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const FIXED_EMAIL = "admin@moneyplanner.local";

export async function POST(request: Request) {
  try {
    const { password } = await request.json();
    const envPassword = process.env.APP_PASSWORD;

    if (!envPassword) {
      return NextResponse.json({ ok: false, error: "服务器未配置 APP_PASSWORD" }, { status: 500 });
    }

    if (password !== envPassword) {
      return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
    }

    // 密码正确，使用固定账号在 Supabase 登录
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !anonKey) {
      return NextResponse.json({ ok: false, error: "未配置 Supabase" }, { status: 500 });
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // ignore
          }
        },
      },
    });

    let { error: signInError } = await supabase.auth.signInWithPassword({
      email: FIXED_EMAIL,
      password: envPassword,
    });

    if (signInError && signInError.message.includes("Invalid login credentials")) {
      // 账号不存在，自动注册
      const { error: signUpError } = await supabase.auth.signUp({
        email: FIXED_EMAIL,
        password: envPassword,
      });
      if (signUpError) {
        return NextResponse.json({ ok: false, error: "自动注册失败：" + signUpError.message }, { status: 500 });
      }
      // 注册完再次登录
      const { error: retryError } = await supabase.auth.signInWithPassword({
        email: FIXED_EMAIL,
        password: envPassword,
      });
      if (retryError) {
        return NextResponse.json({ ok: false, error: "注册后登录失败：" + retryError.message }, { status: 500 });
      }
    } else if (signInError) {
      return NextResponse.json({ ok: false, error: "登录失败：" + signInError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

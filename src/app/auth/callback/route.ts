import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * 同时兼容三种 Supabase 回调形态：
 *   1) PKCE：?code=...
 *   2) 隐式流：?token_hash=...&type=...
 *   3) 会话已在 cookie 里（直接放行）
 * 失败时带上具体错误码，登录页会翻译成能照做的提示。
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as "signup" | "recovery" | "invite" | "email" | null;

  // 只接受站内相对路径：拒绝 //evil.com、/\evil.com 这类协议相对写法（开放重定向），
  // 也拒绝任何绝对 URL
  const rawNext = searchParams.get("next") ?? "/";
  const next = /^\/[^/\\]/.test(rawNext) ? rawNext : "/";

  const fail = (reason: string) =>
    NextResponse.redirect(`${origin}/login?error=${reason}`);

  const supabase = await createServerSupabase();
  if (!supabase) return fail("supabase_not_configured");

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    const message = error.message.toLowerCase();
    // 换浏览器/换设备打开时最常见的失败：拿不到 code verifier
    if (message.includes("code verifier") || message.includes("pkce")) {
      return fail("pkce_verifier_missing");
    }
    return fail("auth_failed");
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return fail("auth_failed");
  }

  // 有些配置下 Supabase 已经写好 cookie 再跳回来
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return NextResponse.redirect(`${origin}${next}`);

  return fail("missing_code");
}

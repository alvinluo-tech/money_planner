"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/client";

/** 订阅一个永不变化的外部源，只为了拿到浏览器侧的稳定快照 */
const noopSubscribe = () => () => {};

/**
 * 读取只在浏览器里存在的值。
 * 用 useSyncExternalStore 而不是 useEffect + setState：服务端渲染时给空值，
 * 水合后自动切到真实值，既没有 hydration 警告也不需要额外的一次渲染。
 */
function useBrowserOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => "",
  );
}

function useSearchParam(name: string): string | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}

function useErrorCode(): string | null {
  return useSearchParam("error");
}

/** 把 /auth/callback 抛回来的错误码翻译成能照做的提示 */
const ERROR_HINTS: Record<string, string> = {
  missing_code: "登录链接不完整。回到登录页重新发送一个验证码即可。",
  pkce_verifier_missing:
    "这个链接是在另一个浏览器或设备上打开的。其实你不需要链接——回到登录页重新发一个验证码，在当前页面输入就能登录。",
  auth_failed: "链接已失效或已经用过。回到登录页重新发送一个验证码即可。",
  supabase_not_configured:
    "服务端没读到 Supabase 配置。检查 .env / .env.local 里的 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_ANON_KEY，然后重启 dev server。",
};

function formatAuthError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("error sending confirmation email")) {
    return "邮件发送失败：请使用真实可达的个人邮箱（如 @qq.com, @163.com, @gmail.com）；如果是 Supabase 免费额度超限（每小时限发 3 封），请稍后再试或在 Supabase 后台配置自定义 SMTP。";
  }
  if (lower.includes("rate limit") || lower.includes("too many requests")) {
    return "发送过于频繁，Supabase 邮件发送额度已达上限。请稍后再试，或在 Supabase Dashboard 开启 Custom SMTP。";
  }
  if (lower.includes("invalid email")) {
    return "邮箱格式不正确，请检查后重新输入。";
  }
  return message;
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const /** input = 填邮箱；code = 已发送，等验证码 */
    [phase, setPhase] = useState<"input" | "code">("input");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [showChecklist, setShowChecklist] = useState(false);

  const origin = useBrowserOrigin();
  const errorCode = useErrorCode();
  const nextPath = useSearchParam("next");
  const configured = process.env.NEXT_PUBLIC_SITE_URL ?? "";

  /** 端口不一致是最常见的「邮件打不开/收不到」原因，直接标红提醒 */
  const mismatch = (() => {
    if (!origin || !configured) return false;
    try {
      return new URL(configured).origin !== origin;
    } catch {
      return true;
    }
  })();

  const callbackUrl = origin ? `${origin}/auth/callback` : "";

  /** 验证码重发冷却倒计时 */
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  /** 发送验证码（首次发送与重发共用） */
  const sendCode = async () => {
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setError("未配置 Supabase，请检查 .env / .env.local");
      return;
    }
    const addr = email.trim();
    if (!addr) return;
    setSending(true);
    setError(null);
    // 用「当前实际访问的地址」而不是环境变量：环境变量里的端口一旦和实际不符，
    // 邮件链接就会跳到没有服务的地方。
    const siteUrl = window.location.origin;
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { emailRedirectTo: `${siteUrl}/auth/callback` },
    });
    setSending(false);
    if (signInError) {
      setError(formatAuthError(signInError.message));
      return;
    }
    setPhase("code");
    setCode("");
    setCooldown(60);
  };

  /** 用邮件验证码在当前浏览器内完成登录（Supabase 项目可配 6 或 8 位，都接受） */
  const verify = async (raw?: string) => {
    const supabase = createBrowserSupabase();
    if (!supabase) return;
    const token = (raw ?? code).replace(/\D/g, "");
    if (token.length < 6 || token.length > 8) {
      setError("请输入邮件里的验证码（6~8 位数字）");
      return;
    }
    setVerifying(true);
    setError(null);
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token,
      type: "email",
    });
    setVerifying(false);
    if (verifyError) {
      setError("验证码不对或已过期。等冷却结束后重新发一个。");
      return;
    }
    // 只接受站内相对路径，防开放重定向；与 /auth/callback 的校验规则一致
    const target = nextPath && /^\/[^/\\]/.test(nextPath) ? nextPath : "/";
    router.replace(target);
    router.refresh();
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-xs font-medium tracking-widest text-brand">MONEY PLANNER</p>
      <h1 className="mt-3 text-2xl font-semibold">登录</h1>
      <p className="mt-2 text-sm text-ink-muted">
        输入邮箱，我们发一个邮箱验证码给你。不需要记密码。
      </p>

      {errorCode && (
        <div className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
          <p className="text-sm font-medium text-rose-800">登录没成功</p>
          <p className="mt-1 text-xs leading-relaxed text-rose-700">
            {ERROR_HINTS[errorCode] ?? `链接校验失败（${errorCode}）。`}
          </p>        </div>
      )}

      {mismatch && (
        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">端口不一致，邮件链接会跳错地方</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-800">
            配置里写的是 <code className="font-mono">{configured}</code>，
            但你当前访问的是 <code className="font-mono">{origin}</code>。
            邮件链接会跳到配置里那个地址，而那里没有服务，所以「打不开」。
          </p>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            下面这个按钮已经改用「当前地址」申请链接，能直接生效；
            但还需要把 <code className="font-mono">{callbackUrl}</code> 加进 Supabase 的
            Redirect URLs（见下方检查清单）。
          </p>
        </div>
      )}

      {phase === "code" ? (
        <div className="mt-6 space-y-3">
          <p className="text-sm text-ink-muted">
            验证码已发到 <span className="font-medium text-ink">{email.trim()}</span>
            ，输入邮件里的验证码就能登录（通常 6 或 8 位）。
          </p>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d*"
            maxLength={8}
            value={code}
            autoFocus
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 8));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !verifying) void verify();
            }}
            placeholder="······"
            className="input tnum text-center text-2xl tracking-[0.6em]"
          />
          <button
            type="button"
            onClick={() => void verify()}
            disabled={verifying || code.replace(/\D/g, "").length < 6}
            className="btn-primary w-full py-3"
          >
            {verifying ? "验证中…" : "验证并登录"}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={cooldown > 0 || sending}
              className="min-h-9 font-medium text-brand disabled:text-ink-muted"
            >
              {sending ? "发送中…" : cooldown > 0 ? `${cooldown}s 后可重发` : "重新发送验证码"}
            </button>
            <button
              type="button"
              onClick={() => {
                setPhase("input");
                setCode("");
                setError(null);
              }}
              className="min-h-9 text-ink-muted"
            >
              换个邮箱
            </button>
          </div>
          {error && <p className="text-xs text-risk">{error}</p>}
          <p className="pt-1 text-xs leading-relaxed text-ink-muted">
            只需要在上面输入验证码，不用点邮件里的任何链接。
            收不到？先看看垃圾箱，等冷却结束可以重新发送。
          </p>
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="input"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !sending) void sendCode();
            }}
          />
          <button type="button" onClick={() => void sendCode()} disabled={sending} className="btn-primary w-full py-3">
            {sending ? "发送中…" : "发送验证码"}
          </button>
          {error && <p className="text-xs text-risk">{error}</p>}
          <div className="relative my-3 flex items-center justify-center pt-2">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-line" />
            </div>
            <span className="relative bg-surface-sunken px-2 text-[11px] text-ink-muted">或者测试体验</span>
          </div>

          <Link
            href="/"
            className="btn-secondary flex w-full items-center justify-center gap-2 py-3 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-brand-soft/20 hover:text-brand"
          >
            <span>🚀</span>
            <span>免登录直接体验（预置英国旅行测试数据）</span>
          </Link>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowChecklist((v) => !v)}
        className="mt-6 text-left text-xs font-medium text-brand"
      >
        {showChecklist ? "收起" : "邮件收不到 / 链接打不开？点这里看检查清单"}
      </button>

      {showChecklist && (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-surface p-4 text-xs leading-relaxed text-ink-soft">
          <div>
            <p className="font-medium text-ink">1. 首选邮箱验证码</p>
            <p className="mt-1">
              验证码在当前浏览器里输入，没有「链接在别的浏览器打开」的问题。收不到邮件先看垃圾箱。
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">2. 地址必须完全一致</p>
            <p className="mt-1">
              <code className="font-mono">.env</code> 里的{" "}
              <code className="font-mono">NEXT_PUBLIC_SITE_URL</code> 要等于你实际访问的地址
              {origin && <>（现在是 <code className="font-mono">{origin}</code>）</>}。
            </p>
          </div>
          <div>
            <p className="font-medium text-ink">3. Supabase Dashboard 里登记回调地址</p>
            <p className="mt-1">Authentication → URL Configuration：</p>
            <ul className="mt-1.5 space-y-1 pl-4">
              <li>· Site URL：<code className="font-mono">{origin || "http://localhost:3000"}</code></li>
              <li>
                · Redirect URLs：加上{" "}
                <code className="font-mono">{callbackUrl || "http://localhost:3000/auth/callback"}</code>
              </li>
            </ul>
            <p className="mt-1.5 text-ink-muted">没登记的话，Supabase 会忽略你的 redirect_to，改跳到 Site URL。</p>
          </div>
          <div>
            <p className="font-medium text-ink">4. 邮件模板保留 Token 变量</p>
            <p className="mt-1">
              Authentication → Email Templates → Magic Link，模板里要有{" "}
              <code className="font-mono">{"{{ .Token }}"}</code>（邮箱验证码），
              项目里的 <code className="font-mono">supabase/templates/magic-link-zh.html</code> 可直接粘贴。
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

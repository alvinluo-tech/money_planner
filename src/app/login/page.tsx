"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function useSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nextPath = useSearchParam("next");

  const handleLogin = async () => {
    if (!password) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/simple-login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.error || "登录失败");
      }
      
      const target = nextPath && /^\/[^/\\]/.test(nextPath) ? nextPath : "/";
      router.replace(target);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <p className="text-xs font-medium tracking-widest text-brand">MONEY PLANNER</p>
      <h1 className="mt-3 text-2xl font-semibold">登录</h1>
      <p className="mt-2 text-sm text-ink-muted">
        这是一个单用户部署实例。请输入管理员密码。
      </p>

      <div className="mt-6 space-y-3">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="输入访问密码"
          className="input"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !loading) void handleLogin();
          }}
        />
        <button type="button" onClick={() => void handleLogin()} disabled={loading} className="btn-primary w-full py-3">
          {loading ? "验证中…" : "进入"}
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
    </main>
  );
}

"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, EyeOff, Lock } from "lucide-react";

function useSearchParam(name: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(name);
}

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDemoMode, setIsDemoMode] = useState(false);

  const nextPath = useSearchParam("next");

  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => {
        if (data?.dataMode === "memory") {
          setIsDemoMode(true);
        }
      })
      .catch(() => {});
  }, []);

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
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="card p-6 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <Lock className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-semibold tracking-wider text-brand uppercase">MONEY PLANNER</p>
            <h1 className="text-xl font-bold">欢迎使用</h1>
          </div>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-muted">
          个人私有旅行记账。请输入你设定的访问密码以登录。
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleLogin();
          }}
        >
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="输入访问密码"
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              enterKeyHint="go"
              className="input pr-10"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? "隐藏密码" : "显示密码"}
              className="absolute right-3 text-ink-muted hover:text-ink transition"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            className="btn-primary w-full py-3 text-sm font-medium transition active:scale-[0.99] disabled:opacity-50"
          >
            {loading ? "验证中…" : "进入应用"}
          </button>

          {error && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
              {error}
            </div>
          )}
        </form>

        {isDemoMode && (
          <>
            <div className="relative my-4 flex items-center justify-center pt-2">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-line" />
              </div>
              <span className="relative bg-surface px-2 text-[11px] text-ink-muted">或者测试体验</span>
            </div>

            <Link
              href="/"
              className="btn-secondary flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-medium text-ink transition hover:border-brand/40 hover:bg-brand-soft/20 hover:text-brand"
            >
              <span>🚀</span>
              <span>免登录直接体验（本地内存演示）</span>
            </Link>
          </>
        )}
      </div>

      <p className="mt-6 text-center text-[11px] text-ink-muted">
        密码可在服务器配置或本地 <code className="rounded bg-paper px-1 py-0.5 font-mono text-[10px]">.env</code> 的{" "}
        <code className="rounded bg-paper px-1 py-0.5 font-mono text-[10px]">APP_PASSWORD</code> 中修改
      </p>
    </main>
  );
}

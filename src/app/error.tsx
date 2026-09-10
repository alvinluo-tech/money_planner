"use client";
import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <span className="text-4xl">😵‍💫</span>
      <h1 className="mt-4 text-xl font-semibold">出了点问题</h1>
      <p className="mt-2 text-sm text-ink-muted">
        {error.message || "页面加载失败，可以重试一次。"}
      </p>
      <button type="button" onClick={reset} className="btn-primary mt-6">
        重试
      </button>
    </main>
  );
}

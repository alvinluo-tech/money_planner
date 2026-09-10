import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col items-center justify-center px-6 text-center">
      <span className="text-4xl">🧭</span>
      <h1 className="mt-4 text-xl font-semibold">找不到这个页面</h1>
      <p className="mt-2 text-sm text-ink-muted">
        行程可能已被删除，或者链接不对。
      </p>
      <Link href="/?all=1" className="btn-primary mt-6">
        回到我的旅行
      </Link>
    </main>
  );
}

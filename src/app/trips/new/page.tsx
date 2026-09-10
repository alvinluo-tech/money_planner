import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/db";
import { TripForm } from "@/components/trip-form";

export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-10">
      <header className="mb-7">
        <Link href="/" className="text-xs text-ink-muted hover:underline">
          ← 返回
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">新建行程</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          预算支持多币种组合，例如 1000 英镑 + 10000 人民币。
        </p>
      </header>
      <TripForm />
    </main>
  );
}

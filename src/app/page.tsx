import { redirect } from "next/navigation";
import Link from "next/link";
import { getSession, resolveDataMode } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { dateRangeLabel, HEALTH_META } from "@/lib/ui/format";
import { loadTripContext } from "@/lib/services/trip";

import { ModelSelector } from "@/components/model-selector";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { all } = await searchParams;
  const trips = await session.repo.listTrips();
  // 只有一个行程时直接进仪表盘（快捷路径），?all=1 可以强制回到列表
  if (trips.length === 1 && all !== "1") redirect(`/trips/${trips[0].id}`);

  const summaries = await Promise.all(
    trips.map(async (trip) => {
      const ctx = await loadTripContext(session.repo, trip.id);
      return { trip, summary: ctx?.summary ?? null };
    }),
  );

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <header className="mb-8 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-widest text-brand">MONEY PLANNER</p>
          <h1 className="mt-2 text-2xl font-semibold">我的旅行</h1>
          <p className="mt-1.5 text-sm text-ink-muted">
            说一句话记账，AI 帮你盯住预算。
            {resolveDataMode() === "memory" && (
              <span className="ml-1.5 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                演示模式
              </span>
            )}
          </p>
        </div>
        <ModelSelector />
      </header>

      {trips.length === 0 ? (
        <div className="card flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="text-4xl">🧳</span>
          <div>
            <h2 className="text-lg font-semibold">还没有行程</h2>
            <p className="mt-1 text-sm text-ink-muted">
              建一趟旅行，设置多币种预算，就可以开始语音记账了。
            </p>
          </div>
          <Link href="/trips/new" className="btn-primary">
            新建行程
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {summaries.map(({ trip, summary }) => {
            const meta = summary ? HEALTH_META[summary.health] : null;
            return (
              <Link
                key={trip.id}
                href={`/trips/${trip.id}`}
                className="card block p-5 transition hover:-translate-y-0.5 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <h2 className="flex items-center gap-2 truncate text-base font-semibold">
                      <span aria-hidden>{trip.coverEmoji ?? "✈️"}</span>
                      {trip.name}
                    </h2>
                    <p className="mt-1 text-xs text-ink-muted">
                      {dateRangeLabel(trip.startDate, trip.endDate)} · {summary?.daysTotal ?? 0} 天 ·{" "}
                      {trip.baseCurrency}
                    </p>
                  </div>
                  {meta && (
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${meta.bg} ${meta.text}`}>
                      {meta.label}
                    </span>
                  )}
                </div>
                {summary && (
                  <div className="mt-4 flex items-baseline gap-4">
                    <span className="tnum text-xl font-semibold">
                      {formatMoney(summary.remaining, summary.baseCurrency)}
                    </span>
                    <span className="text-xs text-ink-muted">
                      剩余 / 共 {formatMoney(summary.totalBudget, summary.baseCurrency)}
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
          <Link href="/trips/new" className="btn-ghost w-full py-3">
            + 新建行程
          </Link>
        </div>
      )}
    </main>
  );
}

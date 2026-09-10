import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession, resolveDataMode } from "@/lib/db";
import { sttEnabled } from "@/lib/ai/config";
import { inferDefaultCurrency, loadTripContext, tripToday } from "@/lib/services/trip";
import { describeRoute } from "@/lib/legs";
import { dateRangeLabel } from "@/lib/ui/format";
import { TripNav } from "@/components/trip-nav";
import { VoiceCapture } from "@/components/voice-capture";

export const dynamic = "force-dynamic";

export default async function TripLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const ctx = await loadTripContext(session.repo, id);
  if (!ctx) notFound();
  const { trip, budgets, categories, legs } = ctx;
  const route = describeRoute(legs);

  return (
    <div className="page-bottom-pad mx-auto w-full max-w-3xl px-4 pt-6 sm:px-5">
      <header className="mb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="-ml-1 flex items-center gap-1">
              <Link
                href="/?all=1"
                className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs text-ink-muted active:bg-paper"
              >
                ← 我的旅行
              </Link>
              <Link
                href="/trips/new"
                className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs text-brand active:bg-paper"
              >
                + 新建行程
              </Link>
            </div>
            <h1 className="mt-2 flex items-center gap-2 truncate text-xl font-semibold">
              <span aria-hidden>{trip.coverEmoji ?? "✈️"}</span>
              {trip.name}
            </h1>
            <p className="mt-1 text-xs text-ink-muted">
              {dateRangeLabel(trip.startDate, trip.endDate)} ·{" "}
              {route || trip.destination || "未填目的地"} · 基准币 {trip.baseCurrency}
              {resolveDataMode() === "memory" && (
                <span className="ml-2 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-medium text-brand">
                  演示模式
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <TripNav tripId={trip.id} />
        </div>
      </header>

      {children}

      <VoiceCapture
        tripId={trip.id}
        today={tripToday(trip, legs)}
        baseCurrency={trip.baseCurrency}
        defaultCurrency={inferDefaultCurrency(trip, budgets, legs, tripToday(trip, legs))}
        categories={categories.map((c) => ({
          key: c.key,
          name: c.name,
          emoji: c.emoji,
          color: c.color,
        }))}
        sttEnabled={sttEnabled()}
      />
    </div>
  );
}

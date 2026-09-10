import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/db";
import { formatMoney, formatPercent } from "@/lib/money";
import { loadTripContext, tripToday } from "@/lib/services/trip";
import { aiEnabled } from "@/lib/ai/config";
import { ExpenseList } from "@/components/expense-list";

export const dynamic = "force-dynamic";

export default async function ExpensesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const ctx = await loadTripContext(session.repo, id);
  if (!ctx) notFound();

  const { trip, expenses, categories, summary } = ctx;
  const today = tripToday(trip, ctx.legs);

  return (
    <div className="space-y-4">
      <section className="card flex items-center justify-between px-4 py-4">
        <div>
          <p className="text-xs text-ink-muted">共 {expenses.length} 笔</p>
          <p className="tnum mt-0.5 text-lg font-semibold">
            {formatMoney(summary.spent, summary.baseCurrency)}
            <span className="ml-2 text-xs font-normal text-ink-muted">
              预算的 {formatPercent(summary.utilization, 1)}
            </span>
          </p>
        </div>
        {summary.byCurrency.length > 1 && (
          <div className="text-right text-xs text-ink-muted">
            {summary.byCurrency.map((c) => (
              <p key={c.currency} className="tnum">
                {formatMoney(c.spent, c.currency)} · {formatPercent(c.share, 0)}
              </p>
            ))}
          </div>
        )}
      </section>

      <ExpenseList
        tripId={id}
        expenses={expenses}
        categories={categories}
        baseCurrency={summary.baseCurrency}
        today={today}
        aiEnabled={await aiEnabled()}
      />
    </div>
  );
}

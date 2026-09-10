import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/db";
import { loadTripContext } from "@/lib/services/trip";
import { BudgetEditor } from "@/components/budget-editor";
import { TripSettingsForm } from "@/components/trip-settings-form";
import { LegsSettings } from "@/components/legs-settings";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const ctx = await loadTripContext(session.repo, id);
  if (!ctx) notFound();

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="section-title mb-4">行程分段（多国）</h2>
        <LegsSettings
          tripId={id}
          tripStart={ctx.trip.startDate}
          tripEnd={ctx.trip.endDate}
          legs={ctx.legs}
        />
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-4">行程预算</h2>
        <BudgetEditor tripId={id} budgets={ctx.budgets} baseCurrency={ctx.trip.baseCurrency} />
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-4">行程信息</h2>
        <TripSettingsForm trip={ctx.trip} />
      </section>
    </div>
  );
}

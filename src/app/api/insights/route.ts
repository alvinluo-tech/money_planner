import { NextResponse } from "next/server";
import { withMutation, withSession, jsonError, zodMessage } from "@/lib/api";
import { analyzeSchema } from "@/lib/schemas";
import { analyzeTrip } from "@/lib/services/insights";
import { loadTripContext } from "@/lib/services/trip";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  return withSession(async (session) => {
    const tripId = new URL(request.url).searchParams.get("tripId");
    if (!tripId) return jsonError("缺少 tripId", 422);
    const insights = await session.repo.listInsights(tripId, 10);
    return NextResponse.json({ ok: true, insights });
  });
}

/** POST /api/insights —— 生成一次预算分析（可带用户提问） */
export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    const body = await request.json().catch(() => null);
    const parsed = analyzeSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const ctx = await loadTripContext(session.repo, parsed.data.tripId);
    if (!ctx) return jsonError("行程不存在", 404);

    const result = await analyzeTrip({
      trip: ctx.trip,
      summary: ctx.summary,
      expenses: ctx.expenses,
      categories: ctx.categories,
      question: parsed.data.question,
    });

    const insight = await session.repo.saveInsight({
      tripId: ctx.trip.id,
      kind: parsed.data.forDate ? "daily_digest" : "budget_check",
      forDate: parsed.data.forDate ?? null,
      headline: result.headline,
      body: result.body,
      severity: result.severity,
      metrics: {
        verdict: result.verdict,
        bullets: result.bullets,
        actions: result.actions,
        projectedTotal: result.projectedTotal,
        engine: result.engine,
        summary: {
          totalBudget: ctx.summary.totalBudget,
          spent: ctx.summary.spent,
          remaining: ctx.summary.remaining,
          daysElapsed: ctx.summary.daysElapsed,
          daysRemaining: ctx.summary.daysRemaining,
          actualDaily: ctx.summary.actualDaily,
          allowedDaily: ctx.summary.allowedDaily,
        },
      },
      model: result.model,
    });

    return NextResponse.json({ ok: true, insight, engine: result.engine });
  });
}

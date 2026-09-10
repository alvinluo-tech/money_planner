import { NextResponse } from "next/server";
import { withMutation, withSession, jsonError, zodMessage } from "@/lib/api";
import { createExpensesSchema } from "@/lib/schemas";
import { createExpensesFromDrafts } from "@/lib/services/trip";

export const runtime = "nodejs";

/** GET /api/expenses?tripId=...&limit=50 */
export async function GET(request: Request) {
  return withSession(async (session) => {
    const url = new URL(request.url);
    const tripId = url.searchParams.get("tripId");
    if (!tripId) return jsonError("缺少 tripId", 422);
    const limit = Number(url.searchParams.get("limit") ?? 200);
    const expenses = await session.repo.listExpenses(tripId, { limit });
    return NextResponse.json({ ok: true, expenses });
  });
}

/** POST /api/expenses —— 批量确认落库（一次语音可能产生多条） */
export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    const body = await request.json().catch(() => null);
    const parsed = createExpensesSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const trip = await session.repo.getTrip(parsed.data.tripId);
    if (!trip) return jsonError("行程不存在", 404);

    const legs = await session.repo.listLegs(trip.id);
    const created = await createExpensesFromDrafts({
      repo: session.repo,
      trip,
      legs,
      drafts: parsed.data.expenses,
    });

    if (parsed.data.captureId) {
      await session.repo.updateCaptureStatus(parsed.data.captureId, "confirmed", null);
    }

    return NextResponse.json({ ok: true, expenses: created });
  });
}

import { NextResponse } from "next/server";
import { withMutation, jsonError, zodMessage } from "@/lib/api";
import { legsInputSchema } from "@/lib/schemas";
import { validateLegs } from "@/lib/legs";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/trips/:id/legs —— 整体替换行程分段。
 * 分段只影响「币种/时区推断」与「分段复盘」，不会改动任何已落库的金额与汇率。
 */
export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    const parsed = legsInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const trip = await session.repo.getTrip(id);
    if (!trip) return jsonError("行程不存在", 404);

    const check = validateLegs(parsed.data.legs, trip.startDate, trip.endDate);
    if (!check.ok) return jsonError(check.errors.join("；"), 422);

    const rows = await session.repo.replaceLegs(
      id,
      parsed.data.legs.map((l) => ({
        name: l.name,
        countryCode: l.countryCode ?? null,
        currency: l.currency,
        timezone: l.timezone,
        startDate: l.startDate,
        endDate: l.endDate,
      })),
    );
    return NextResponse.json({ ok: true, legs: rows });
  });
}

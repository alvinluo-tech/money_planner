import { NextResponse } from "next/server";
import { withMutation, jsonError, zodMessage } from "@/lib/api";
import { tripBudgetsSchema } from "@/lib/schemas";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PUT /api/trips/:id/budgets —— 整体替换预算组合（多币种） */
export async function PUT(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    const parsed = tripBudgetsSchema.safeParse((body as { budgets?: unknown })?.budgets);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const trip = await session.repo.getTrip(id);
    if (!trip) return jsonError("行程不存在", 404);

    const rows = await session.repo.replaceBudgets(
      id,
      parsed.data.map((b, index) => ({
        currency: b.currency,
        amount: b.amount,
        label: b.label,
        isPrimary: b.isPrimary ?? index === 0,
      })),
    );
    return NextResponse.json({ ok: true, budgets: rows });
  });
}

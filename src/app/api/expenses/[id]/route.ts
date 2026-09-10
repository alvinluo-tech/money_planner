import { NextResponse } from "next/server";
import { withMutation, jsonError, zodMessage } from "@/lib/api";
import { updateExpenseSchema } from "@/lib/schemas";
import { getRatesTo } from "@/lib/fx";
import { roundMoney } from "@/lib/money";
import { tripToday } from "@/lib/services/trip";
import type { ExpenseInsert } from "@/lib/db/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** 修改一笔消费。金额/币种/日期变化时重新折算基准币金额。 */
export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    const parsed = updateExpenseSchema.safeParse({ ...(body as object), id });
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const current = await session.repo.getExpense(id);
    if (!current) return jsonError("消费记录不存在", 404);

    const trip = await session.repo.getTrip(current.tripId);
    if (!trip) return jsonError("行程不存在", 404);

    const { amount, currency, spentOn, spentAt, categoryKey, merchant, note, paymentMethod, tags } =
      parsed.data;
    const patch: Partial<ExpenseInsert> = {
      categoryKey,
      merchant,
      note,
      paymentMethod,
      tags,
    };

    const nextCurrency = (currency ?? current.currency).toUpperCase();
    const nextAmount = amount ?? current.amount;
    const base = trip.baseCurrency.toUpperCase();

    if (amount !== undefined || currency !== undefined) {
      const quotes = await getRatesTo([nextCurrency, base], base);
      const rate = nextCurrency === base ? 1 : (quotes[nextCurrency]?.rate ?? current.fxRate);
      patch.amount = roundMoney(nextAmount, nextCurrency);
      patch.currency = nextCurrency;
      patch.fxRate = rate;
      patch.baseCurrency = base;
      patch.baseAmount = roundMoney(nextAmount * rate, base);
      patch.fxSource =
        nextCurrency === base ? "same" : (quotes[nextCurrency]?.source ?? "manual");
    }
    if (spentOn !== undefined && spentOn !== null) {
      // 与创建时的保护一致：不允许未来日期污染节奏推演
      const today = tripToday(trip, await session.repo.listLegs(trip.id));
      patch.spentOn = spentOn > today ? today : spentOn;
    }
    if (spentAt !== undefined && spentAt !== null) patch.spentAt = spentAt;

    const updated = await session.repo.updateExpense(id, patch);
    return NextResponse.json({ ok: true, expense: updated });
  });
}

export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    await session.repo.deleteExpense(id);
    return NextResponse.json({ ok: true });
  });
}

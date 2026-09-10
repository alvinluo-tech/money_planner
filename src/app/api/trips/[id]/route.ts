import { NextResponse } from "next/server";
import { withMutation, jsonError, zodMessage } from "@/lib/api";
import { tripUpdateSchema } from "@/lib/schemas";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/trips/:id —— 修改行程名称、日期、目的地等 */
export async function PATCH(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const body = await request.json().catch(() => null);
    const parsed = tripUpdateSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    const current = await session.repo.getTrip(id);
    if (!current) return jsonError("行程不存在", 404);

    const nextStart = parsed.data.startDate ?? current.startDate;
    const nextEnd = parsed.data.endDate ?? current.endDate;
    if (nextEnd < nextStart) return jsonError("结束日期不能早于开始日期", 422);

    // 基准币是历史记录的折算锚点，已有消费后再改会让旧账目失真，直接拒绝
    if (parsed.data.baseCurrency && parsed.data.baseCurrency !== current.baseCurrency) {
      const existing = await session.repo.listExpenses(id, { limit: 1 });
      if (existing.length > 0) {
        return jsonError(
          "已经产生消费记录，不能再更换基准币（会让历史折算失真）。如需更换请新建行程。",
          409,
        );
      }
    }

    const trip = await session.repo.updateTrip(id, parsed.data);
    return NextResponse.json({ ok: true, trip });
  });
}

/** DELETE /api/trips/:id —— 连同预算、消费、分析记录一起删除 */
export async function DELETE(request: Request, ctx: Ctx) {
  return withMutation(request, async (session) => {
    const { id } = await ctx.params;
    const trip = await session.repo.getTrip(id);
    if (!trip) return jsonError("行程不存在", 404);
    await session.repo.deleteTrip(id);
    return NextResponse.json({ ok: true });
  });
}

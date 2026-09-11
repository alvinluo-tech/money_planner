import { NextResponse } from "next/server";
import { aiPlanTripInputSchema } from "@/lib/schemas";
import { generateAiTripPlan } from "@/lib/services/trip-planner";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const parsed = aiPlanTripInputSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { ok: false, error: parsed.error.issues[0]?.message || "参数不合法" },
        { status: 422 },
      );
    }

    const plan = await generateAiTripPlan(parsed.data.prompt, parsed.data.today);
    return NextResponse.json({ ok: true, plan });
  } catch (err: any) {
    console.error("[api/trips/ai-plan]", err);
    return NextResponse.json(
      { ok: false, error: err.message || "行程规划生成失败，请重试" },
      { status: 500 },
    );
  }
}

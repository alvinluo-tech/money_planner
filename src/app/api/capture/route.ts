import { NextResponse } from "next/server";
import { z } from "zod";
import { withMutation, jsonError } from "@/lib/api";
import { parseCaptureSchema } from "@/lib/schemas";
import { parseCapture } from "@/lib/parser";
import { transcribeAudio } from "@/lib/ai/transcribe";
import {
  inferDefaultCurrency,
  recentParseExamples,
  resolveCorrectionTarget,
  tripToday,
} from "@/lib/services/trip";
import type { Expense } from "@/lib/types";
import { sttEnabled } from "@/lib/ai/config";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * 语音 / 文本 → 结构化消费草稿（不落库，交给用户确认）。
 * 两种调用方式：
 *   · multipart/form-data：字段 audio(File) + tripId [+ transcript 作为浏览器本地识别的结果]
 *   · application/json：{ tripId, transcript }
 */
export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    const contentType = request.headers.get("content-type") ?? "";
    let tripId = "";
    let transcript = "";
    let language: string | undefined;
    let audioFileName: string | undefined;
    let audio: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const rawTripId = form.get("tripId");
      if (typeof rawTripId !== "string" || !rawTripId.trim()) return jsonError("缺少 tripId", 422);
      const uuidCheck = z.string().uuid().safeParse(rawTripId.trim());
      if (!uuidCheck.success) return jsonError("tripId 无效", 422);
      tripId = uuidCheck.data;
      const provided = form.get("transcript");
      if (typeof provided === "string" && provided.trim()) transcript = provided.trim();
      const lang = form.get("language");
      if (typeof lang === "string" && lang.trim()) language = lang.trim();
      const file = form.get("audio");
      if (file instanceof File && file.size > 0) {
        audio = file;
        audioFileName = file.name || "capture.webm";
      }
    } else {
      const body = await request.json().catch(() => null);
      const parsed = parseCaptureSchema.safeParse(body);
      if (!parsed.success) return jsonError("参数不合法", 422);
      tripId = parsed.data.tripId;
      transcript = parsed.data.transcript ?? "";
    }

    if (!tripId) return jsonError("缺少 tripId", 422);

    const trip = await session.repo.getTrip(tripId);
    if (!trip) return jsonError("行程不存在", 404);

    let sttModel: string | null = null;
    if (!transcript) {
      if (!audio) return jsonError("没有收到语音或文本", 422);
      if (!sttEnabled()) {
        return jsonError(
          "未配置语音识别。可以先用文字输入，或在 .env.local 里设置 STT_API_KEY / AI_API_KEY。",
          501,
        );
      }
      const result = await transcribeAudio(audio, {
        language,
        filename: audioFileName,
        prompt: `旅行记账语音，涉及 ${trip.baseCurrency} 与多币种金额。`,
      });
      transcript = result.text;
      sttModel = result.model;
    }

    if (!transcript.trim()) return jsonError("没有识别到内容，请再说一次", 422);

    const [budgets, categories, examples, legs] = await Promise.all([
      session.repo.listBudgets(tripId),
      session.repo.listCategories(),
      recentParseExamples(session.repo, tripId),
      session.repo.listLegs(tripId),
    ]);

    const today = tripToday(trip, legs);
    const parsed = await parseCapture({
      transcript,
      // 多国行程：把「日期 → 国家/币种」交给解析器，按消费发生那天判断币种
      itinerary: legs.length
        ? legs
            .map((l) => `${l.startDate}~${l.endDate} ${l.name}（${l.currency}）`)
            .join("；")
        : undefined,
      ctx: {
        defaultCurrency: inferDefaultCurrency(trip, budgets, legs, today),
        defaultCurrencyForDate: (date) => inferDefaultCurrency(trip, budgets, legs, date),
        baseCurrency: trip.baseCurrency,
        today,
        tripStart: trip.startDate,
        tripEnd: trip.endDate,
      },
      categories: categories.map((c) => ({ key: c.key, name: c.name })),
      recentExamples: examples,
    });

    // 纠错/删除意图：服务端把「刚才那笔」定位成具体记录，前端直接展示原 → 新
    let target: Expense | null = null;
    if (parsed.intent !== "add") {
      target = await resolveCorrectionTarget(
        session.repo,
        tripId,
        parsed.correction?.target ?? { kind: "last" },
      );
      if (!target) parsed.warnings.push("没找到要改的那一笔，请到明细页手动修改。");
    }

    const captureId = await session.repo.logCapture({
      tripId,
      transcript,
      parsed,
      status: "pending",
      error: null,
      latencyMs: parsed.latencyMs ?? null,
      model: parsed.model ?? sttModel,
    });

    return NextResponse.json({ ok: true, ...parsed, target, sttModel, captureId });
  });
}

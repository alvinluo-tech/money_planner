import { NextResponse } from "next/server";
import { withMutation, withSession, jsonError, zodMessage } from "@/lib/api";
import { assistantSchema } from "@/lib/schemas";
import { loadTripContext, tripToday } from "@/lib/services/trip";
import { runAssistant } from "@/lib/ai/assistant";
import { aiEnabled } from "@/lib/ai/config";

export const runtime = "nodejs";
export const maxDuration = 120;

/** GET /api/assistant?tripId=... —— 会话列表 */
export async function GET(request: Request) {
  return withSession(async (session) => {
    const url = new URL(request.url);
    const tripId = url.searchParams.get("tripId");
    const threadId = url.searchParams.get("threadId");
    if (!tripId) return jsonError("缺少 tripId", 422);

    if (threadId) {
      // threadId 是调用方传来的，必须确认它属于这趟行程，防止跨行程读取/串历史
      const thread = await session.repo.getThread(threadId);
      if (!thread || thread.tripId !== tripId) return jsonError("会话不存在", 404);
      const messages = await session.repo.listMessages(threadId, 50);
      return NextResponse.json({ ok: true, messages });
    }
    const threads = await session.repo.listThreads(tripId, 20);
    return NextResponse.json({ ok: true, threads });
  });
}

/**
 * POST /api/assistant —— 多轮对话，SSE 流式返回。
 * 事件：thread / token / tool / done / error
 */
export async function POST(request: Request) {
  return withMutation(request, async (session) => {
    const body = await request.json().catch(() => null);
    const parsed = assistantSchema.safeParse(body);
    if (!parsed.success) return jsonError(zodMessage(parsed.error), 422);

    if (!(await aiEnabled())) {
      return jsonError("还没配置大模型（AI_API_KEY），配好之后就能对话了。", 501);
    }

    const ctx = await loadTripContext(session.repo, parsed.data.tripId);
    if (!ctx) return jsonError("行程不存在", 404);

    let thread: Awaited<ReturnType<typeof session.repo.getThread>> = null;
    if (parsed.data.threadId) {
      const existing = await session.repo.getThread(parsed.data.threadId);
      if (existing && existing.tripId !== ctx.trip.id) {
        // 会话存在但不属于这趟行程 —— 明确报错，不能静默串到别的行程的历史
        return jsonError("会话不存在", 404);
      }
      thread = existing;
    }
    if (!thread) {
      thread = await session.repo.createThread(ctx.trip.id, parsed.data.message.slice(0, 24));
    }
    const threadId = thread.id;

    // 历史只取 user/assistant 文本；工具结果每轮重新查，避免过期数字被当成上下文
    const history = await session.repo.listMessages(threadId, 20);
    await session.repo.appendMessage({
      threadId,
      role: "user",
      content: parsed.data.message,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        const send = (event: string, data: unknown) => {
          if (closed) return;
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        send("thread", { threadId, title: thread.title });
        let answer = "";

        try {
          for await (const event of runAssistant({
            repo: session.repo,
            trip: ctx.trip,
            legs: ctx.legs,
            categories: ctx.categories,
            summary: ctx.summary,
            today: tripToday(ctx.trip, ctx.legs),
            history,
            message: parsed.data.message,
          })) {
            if (event.type === "token") {
              answer += event.text;
              send("token", { text: event.text });
            } else if (event.type === "tool") {
              send("tool", { name: event.name, args: event.args, summary: event.summary });
            } else if (event.type === "error") {
              send("error", { message: event.message });
            } else if (event.type === "done") {
              answer = event.text || answer;
            }
          }

          if (answer.trim()) {
            await session.repo.appendMessage({ threadId, role: "assistant", content: answer });
          }
          send("done", { threadId });
        } catch (error) {
          console.error("[assistant]", error);
          send("error", {
            message: error instanceof Error ? error.message : "生成失败，请重试",
          });
        } finally {
          closed = true;
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  });
}

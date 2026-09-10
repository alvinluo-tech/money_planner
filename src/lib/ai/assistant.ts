import "server-only";
import { summaryForPrompt, type BudgetSummary } from "../budget";
import { describeRoute } from "../legs";
import { aiConfig, type AiConfig } from "./config";
import { ASSISTANT_TOOLS, executeTool, summarizeToolResult, type ToolContext } from "./tools";
import type { AiMessage, Category, Trip, TripLeg } from "../types";

/** 助手向客户端推送的事件（SSE） */
export type AssistantEvent =
  | { type: "token"; text: string }
  | { type: "tool"; name: string; args: unknown; summary: string }
  | { type: "done"; text: string }
  | { type: "error"; message: string };

interface WireMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
}

interface ToolCallSlot {
  id: string;
  name: string;
  args: string;
}

export interface AssistantArgs {
  repo: ToolContext["repo"];
  trip: Trip;
  legs: TripLeg[];
  categories: Category[];
  summary: BudgetSummary;
  today: string;
  history: AiMessage[];
  message: string;
  maxSteps?: number;
}

export function buildSystemPrompt(args: AssistantArgs): string {
  const { trip, legs, categories, summary, today } = args;
  const route = describeRoute(legs) || trip.destination || "未填目的地";
  const lines: string[] = [];

  lines.push("你是「Money Planner」的旅行财务助手，只服务下面这一趟旅行。");
  lines.push("");
  lines.push(
    `【行程】${trip.name}（${route}）${trip.startDate} ~ ${trip.endDate}，基准币 ${trip.baseCurrency}。今天是 ${today}。`,
  );
  lines.push("");
  lines.push("【预算概览（确定性数字，可直接引用）】");
  lines.push(summaryForPrompt(summary, trip.name));
  if (summary.byLeg.length > 0) {
    lines.push("");
    lines.push("【行程分段】");
    for (const leg of summary.byLeg) {
      lines.push(
        `${leg.name}（${leg.currency}）${leg.startDate}~${leg.endDate} ${leg.days}天：已花 ${leg.spent}，参考额度 ${leg.referenceAllowance}${leg.isActive ? "（当前所在段）" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("【分类 key】");
  lines.push(categories.map((c) => `${c.key}(${c.name})`).join(", "));
  lines.push("");
  lines.push("规则：");
  lines.push("1. 任何金额、日期、分类结论都必须来自工具返回或上面的概览，绝不凭空编数字。");
  lines.push(
    "2. 涉及明细查询（最贵的一顿、某天花了多少、在巴黎吃了什么）先调 query_expenses；涉及汇总先调 aggregate_expenses；涉及预算推演先调 get_budget_summary。",
  );
  lines.push("3. 相对时间（上个月、上周、最近三天）自己换算成 YYYY-MM-DD 再传参。");
  lines.push(
    "4. 用户问「如果…会怎样」时，先取预算概览，再用剩余预算和剩余天数推演，并把假设说清楚（例如「假设这 300 镑刷卡」）。",
  );
  lines.push("5. 回答口语化、简短（一般 2~5 句），不要用 markdown 表格，不要罗列大段原始数据。金额写成 £56 / ¥1,234 这样。");
  lines.push("6. 信息不够就直接问一句，不要瞎猜。");
  return lines.join("\n");
}

/** 单轮流式调用：边吐字边收集工具调用 */
async function* streamOnce(
  cfg: AiConfig,
  messages: WireMessage[],
  tools: unknown,
): AsyncGenerator<AssistantEvent, { content: string; calls: ToolCallSlot[] }, void> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      tools,
      tool_choice: "auto",
      temperature: 0.3,
      stream: true,
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`大模型请求失败 ${res.status}: ${detail.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  const slots: Record<number, ToolCallSlot> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let json: {
        choices?: Array<{
          delta?: {
            content?: string | null;
            tool_calls?: Array<{
              index?: number;
              id?: string;
              function?: { name?: string; arguments?: string };
            }>;
          };
        }>;
      };
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        yield { type: "token", text: delta.content };
      }

      for (const call of delta.tool_calls ?? []) {
        const index = call.index ?? 0;
        const slot = slots[index] ?? (slots[index] = { id: "", name: "", args: "" });
        if (call.id) slot.id = call.id;
        if (call.function?.name) slot.name += call.function.name;
        if (call.function?.arguments) slot.args += call.function.arguments;
      }
    }
  }

  return { content, calls: Object.values(slots).filter((s) => s.name) };
}

/**
 * 助手主循环：模型可以在「调用工具 → 看结果 → 继续回答」之间来回最多 maxSteps 轮。
 * 文本是边生成边 yield 的，所以前端能逐字显示。
 */
export async function* runAssistant(args: AssistantArgs): AsyncGenerator<AssistantEvent> {
  const cfg = aiConfig();
  if (!cfg) {
    yield {
      type: "error",
      message: "还没配置大模型。在 .env 里填 AI_API_KEY 之后就能对话了。",
    };
    return;
  }

  const toolContext: ToolContext = {
    repo: args.repo,
    trip: args.trip,
    legs: args.legs,
    categories: args.categories,
    summary: args.summary,
  };

  const messages: WireMessage[] = [
    { role: "system", content: buildSystemPrompt(args) },
    ...args.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: args.message },
  ];

  const maxSteps = args.maxSteps ?? 4;
  let fullText = "";

  for (let step = 0; step < maxSteps; step += 1) {
    const { content, calls } = yield* streamOnce(cfg, messages, ASSISTANT_TOOLS);
    fullText += content;

    if (calls.length === 0) {
      yield { type: "done", text: fullText };
      return;
    }

    messages.push({
      role: "assistant",
      content: content || null,
      tool_calls: calls.map((c, callIdx) => ({
        id: c.id || `call_${step}_${callIdx}`,
        type: "function" as const,
        function: { name: c.name, arguments: c.args || "{}" },
      })),
    });

    for (let callIdx = 0; callIdx < calls.length; callIdx += 1) {
      const call = calls[callIdx];
      const toolCallId = call.id || `call_${step}_${callIdx}`;
      const result = await executeTool(call.name, call.args, toolContext);
      let parsedArgs: unknown = call.args;
      try {
        parsedArgs = JSON.parse(call.args || "{}");
      } catch {
        // 保留原始字符串
      }
      yield {
        type: "tool",
        name: call.name,
        args: parsedArgs,
        summary: summarizeToolResult(call.name, result),
      };
      messages.push({
        role: "tool",
        tool_call_id: toolCallId,
        content: JSON.stringify(result).slice(0, 6000),
      });
    }
  }

  // 步数用尽：把已有内容给用户，并说明被截断
  yield {
    type: "done",
    text: fullText || "这个问题需要更多步骤才能答完，换个更具体的问法试试。",
  };
}

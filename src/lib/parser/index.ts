import "server-only";
import { isSupportedCurrency, parseCurrencyAlias } from "../currency";
import { aiConfig } from "../ai/config";
import { chatJson, AiUnavailableError } from "../ai/chat";
import { llmCaptureSchema } from "../schemas";
import { roundMoney } from "../money";
import type { ExpenseDraft, ParsedCapture, PaymentMethod } from "../types";
import { parseCaptureWithRules, type RuleParseContext } from "./rules";

export interface ParseCaptureArgs {
  transcript: string;
  ctx: RuleParseContext;
  /** 多国行程的日期→国家/币种说明，供模型按消费日期选币种 */
  itinerary?: string;
  /** 可用分类，用于约束模型输出 */
  categories: Array<{ key: string; name: string }>;
  /** 用户最近的真实记账样本，让模型学习本人的说话方式 */
  recentExamples?: Array<{
    transcript: string;
    amount: number;
    currency: string;
    categoryKey: string | null;
    merchant: string | null;
  }>;
}

const SYSTEM_PROMPT = `你是「旅行记账」应用的语音解析引擎。把用户的口语转写成结构化消费记录。

硬性要求：
1. 只输出 JSON，格式：
   {"intent":"add|correct|delete",
    "expenses":[{"amount":数字,"currency":"ISO代码","categoryKey":"分类key","merchant":"商家或null","note":"具体消费内容或null","spentOn":"YYYY-MM-DD","paymentMethod":"cash|card|alipay|wechat|other|null","confidence":0到1,"tags":["stay:YYYY-MM-DD~YYYY-MM-DD等可选标签"]}],
    "correction":{"target":{"kind":"last|by_date|by_merchant|by_amount","date":"YYYY-MM-DD或null","merchant":"或null","amount":数字或null},"changes":{"amount":数字或null,"currency":"或null","categoryKey":"或null","merchant":"或null","note":"或null","spentOn":"YYYY-MM-DD或null","paymentMethod":"或null","tags":["可选标签"]},"confidence":0到1},
    "warnings":["无法确定的说明"]}
1b. 判断意图：用户是在「新记一笔」→ intent=add；在「修改刚才/某一笔」→ intent=correct 并填 correction；在「删掉某一笔」→ intent=delete。
   触发词：改成/改为/应该是/记错了/不是…是 → correct；删掉/撤销/去掉 → delete。
   intent 不是 add 时，expenses 必须为空数组，changes 里只放真正要改的字段（没说到的字段留 null，不要照抄原值）。
   指代「刚才/上一笔/最后一笔」用 target.kind=last；说「昨天那笔」用 by_date 并给 date；说「在星巴克那笔」用 by_merchant。
2. 核心原则 —— 识别具体消费主体（让用户明确知道具体钱花在哪了）：
   - merchant（商家/品牌/地点主体）：提取商户、品牌或核心地点，例如「麦当劳」、「星巴克」、「Uber/打车」、「大英博物馆」等。若无独立商家可留 null 或填主要服务（如「打车」）。
   - note（具体消费内容/活动/物品/路线）：必须提取出「具体花在哪了」，例如「吃麦当劳」、「从卢浮宫打车到凯旋门」、「两件纪念品T恤」、「买防晒霜」等。绝不能把用户说出的具体内容丢弃成 null！
3. 一句话可能包含多笔消费（如「午饭 15 镑，地铁 3 镑」），必须拆成多条。
4. amount 只写数字，不带货币符号、不带千分位。
5. currency 必须是 3 位 ISO-4217 代码。口语映射：块/元/人民币→CNY，磅/镑/英镑→GBP，欧/欧元→EUR，美金/刀/美元→USD，日元/円→JPY，港币→HKD，泰铢→THB，韩元→KRW，新币/新元→SGD，澳币→AUD。
   用户没提币种时，先看这笔消费发生在哪一天、那一天在哪个国家（见 itinerary 的日期区间），用那个国家的币种；itinerary 没覆盖该日期才用 defaultCurrency。例如今天在巴黎、但用户说「昨天午饭 15」，而昨天还在伦敦，就应该是 GBP。
6. categoryKey 只能从给定分类列表里选，选不出来用 other。
7. spentOn 与预订/酒店分摊支持：
   - 普通日常消费：用户说「昨天」「前天」「3 号」要按 today 正确推算；没说就用 today。除机票/酒店预订外不要输出超过旅行结束日的日期。
   - 机票/跨城大交通：若用户提到了具体起飞/乘坐日期（如「买了16号飞罗马的机票80欧」），spentOn 设为航班乘坐日期（YYYY-MM-16），只要在 trip 范围内允许为未来日期。
   - 酒店/民宿住宿：若用户提到入住起止日期或住几晚（如「12号到14号两晚酒店910欧」或「订了15号到18号酒店」），categoryKey 设为 lodging，spentOn 设为入住第一天，并且在 tags 中必须加入 "stay:YYYY-MM-DD~YYYY-MM-DD"（例如 ["stay:2026-09-12~2026-09-14"]），以便系统在每日统计中均匀分摊这几晚的房费！
8. 听不清金额时不要编造，把该条省略并写进 warnings。
9. confidence 表示你对该条记录的把握，0~1。
`;

function buildUserPrompt(args: ParseCaptureArgs): string {
  const { ctx, categories, recentExamples } = args;
  const lines: string[] = [];
  lines.push(`today = ${ctx.today}`);
  lines.push(`defaultCurrency = ${ctx.defaultCurrency}`);
  lines.push(`baseCurrency = ${ctx.baseCurrency}`);
  if (ctx.tripStart && ctx.tripEnd) lines.push(`trip = ${ctx.tripStart} ~ ${ctx.tripEnd}`);
  lines.push(`categories = ${categories.map((c) => `${c.key}(${c.name})`).join(", ")}`);
  if (args.itinerary) lines.push(`itinerary = ${args.itinerary}`);
  if (recentExamples && recentExamples.length > 0) {
    lines.push("该用户最近的记账样本（学习他的表达习惯）：");
    for (const e of recentExamples.slice(0, 6)) {
      lines.push(
        `  "${e.transcript}" → ${e.amount} ${e.currency} / ${e.categoryKey ?? "other"} / ${e.merchant ?? "-"}`,
      );
    }
  }
  lines.push(`用户这次说：「${args.transcript}」`);
  return lines.join("\n");
}

function normalizePayment(value: string | null | undefined): PaymentMethod | null {
  if (!value) return null;
  const v = value.toLowerCase();
  if (["cash", "card", "alipay", "wechat", "other"].includes(v)) return v as PaymentMethod;
  if (v.includes("现金")) return "cash";
  if (v.includes("卡")) return "card";
  if (v.includes("支付宝")) return "alipay";
  if (v.includes("微信")) return "wechat";
  return "other";
}

/**
 * 解析入口：优先大模型，失败或未配置时退回规则解析。
 * 两条路径产出的形状完全一致，前端不需要区分。
 */
export async function parseCapture(args: ParseCaptureArgs): Promise<ParsedCapture> {
  const cfg = await aiConfig();
  const started = Date.now();

  if (!cfg) {
    return parseCaptureWithRules(args.transcript, args.ctx);
  }

  try {
    const { data, model } = await chatJson({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(args),
      schema: llmCaptureSchema,
      temperature: 0.1,
    });

    const validKeys = new Set(args.categories.map((c) => c.key));
    const drafts: Array<ExpenseDraft & { confidence: number; reason?: string }> = [];

    for (const item of data.expenses) {
      // 模型偶尔会编出不存在的币种，回退到目的地默认币种而不是让后续校验失败
      const resolved = parseCurrencyAlias(item.currency) ?? item.currency.toUpperCase().slice(0, 3);
      const currency = isSupportedCurrency(resolved) ? resolved : args.ctx.defaultCurrency;
      if (!Number.isFinite(item.amount) || item.amount <= 0) continue;
      const categoryKey =
        item.categoryKey && validKeys.has(item.categoryKey) ? item.categoryKey : "other";
      const spentOn =
        item.spentOn && /^\d{4}-\d{2}-\d{2}$/.test(item.spentOn)
          ? item.spentOn
          : args.ctx.today;
      drafts.push({
        amount: roundMoney(item.amount, currency),
        currency,
        categoryKey,
        merchant: item.merchant ?? null,
        note: item.note ?? null,
        spentOn,
        paymentMethod: normalizePayment(item.paymentMethod),
        source: "voice",
        rawInput: args.transcript,
        tags: Array.isArray(item.tags) ? item.tags : [],
        aiConfidence: item.confidence ?? 0.8,
        aiModel: model,
        confidence: item.confidence ?? 0.8,
        reason: item.reason,
      });
    }

    // ---- 纠错 / 删除意图 ----
    if (data.intent !== "add") {
      const raw = data.correction;
      if (!raw || (data.intent === "correct" && Object.keys(raw.changes ?? {}).length === 0)) {
        // 模型没给出可用的改动，交给规则再判一次
        const fallback = parseCaptureWithRules(args.transcript, args.ctx);
        if (fallback.intent !== "add") {
          return { ...fallback, model, latencyMs: Date.now() - started };
        }
      } else {
        const changes = raw.changes ?? {};
        const currency = changes.currency
          ? (parseCurrencyAlias(changes.currency) ?? changes.currency.toUpperCase())
          : null;
        return {
          transcript: args.transcript,
          intent: data.intent,
          drafts: [],
          correction: {
            target: {
              kind: raw.target?.kind ?? "last",
              date: raw.target?.date ?? null,
              merchant: raw.target?.merchant ?? null,
              amount: raw.target?.amount ?? null,
            },
            changes: {
              amount: changes.amount ?? null,
              currency: currency && isSupportedCurrency(currency) ? currency : null,
              categoryKey:
                changes.categoryKey && validKeys.has(changes.categoryKey) ? changes.categoryKey : null,
              merchant: changes.merchant ?? null,
              note: changes.note ?? null,
              spentOn:
                changes.spentOn && /^\d{4}-\d{2}-\d{2}$/.test(changes.spentOn)
                  ? changes.spentOn
                  : null,
              paymentMethod: normalizePayment(changes.paymentMethod),
            },
            confidence: raw.confidence ?? 0.8,
            reason: raw.reason,
          },
          warnings: data.warnings ?? [],
          engine: "llm",
          model,
          latencyMs: Date.now() - started,
        };
      }
    }

    if (drafts.length === 0) {
      // 模型没给出可用结果，用规则兜底并保留模型的提示
      const fallback = parseCaptureWithRules(args.transcript, args.ctx);
      return {
        ...fallback,
        warnings: [...(data.warnings ?? []), ...fallback.warnings],
        model,
        latencyMs: Date.now() - started,
      };
    }

    return {
      transcript: args.transcript,
      intent: "add",
      drafts,
      warnings: data.warnings ?? [],
      engine: "llm",
      model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    if (!(error instanceof AiUnavailableError)) {
      console.error("[parseCapture] 大模型解析失败，降级到规则解析:", error);
    }
    const fallback = parseCaptureWithRules(args.transcript, args.ctx);
    return {
      ...fallback,
      warnings: [
        ...fallback.warnings,
        "大模型暂时不可用，已用本地规则解析，请核对金额与分类。",
      ],
      latencyMs: Date.now() - started,
    };
  }
}

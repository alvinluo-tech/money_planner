import { z } from "zod";
import { isSupportedCurrency } from "./currency";

/** API 与 UI 共用的 zod 契约。所有外部输入都从这里过一遍。 */

export const currencyCode = z
  .string()
  .trim()
  .min(1)
  .max(8)
  .transform((v) => v.toUpperCase())
  .refine(isSupportedCurrency, { message: "暂不支持该币种" });

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式应为 YYYY-MM-DD");

export const paymentMethodSchema = z.enum(["cash", "card", "alipay", "wechat", "other"]);
export const expenseSourceSchema = z.enum(["voice", "manual", "receipt", "import", "recurring"]);

export const expenseDraftSchema = z.object({
  amount: z.coerce.number().positive("金额必须大于 0").max(99_999_999),
  currency: currencyCode,
  categoryKey: z.string().trim().min(1).max(40).optional().nullable(),
  merchant: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  spentAt: z.string().datetime({ offset: true }).optional().nullable(),
  spentOn: isoDate.optional().nullable(),
  paymentMethod: paymentMethodSchema.optional().nullable(),
  source: expenseSourceSchema.optional(),
  rawInput: z.string().max(4000).optional().nullable(),
  aiConfidence: z.number().min(0).max(1).optional().nullable(),
  aiModel: z.string().max(80).optional().nullable(),
  tags: z.array(z.string().trim().max(24)).max(10).optional(),
});

export const createExpensesSchema = z.object({
  tripId: z.string().uuid(),
  expenses: z.array(expenseDraftSchema).min(1).max(20),
  /** 来自 /api/capture 的日志 id，落库成功后标记为 confirmed */
  captureId: z.string().uuid().optional().nullable(),
});

export const updateExpenseSchema = expenseDraftSchema.partial().extend({
  id: z.string().uuid(),
});

/** 行程分段（多国旅行）：一段 = 一个国家/城市 + 日期区间 + 币种 + 时区 */
export const legSchema = z.object({
  name: z.string().trim().min(1, "分段需要一个名称").max(40),
  countryCode: z.string().trim().length(2).toUpperCase().nullable().optional(),
  currency: currencyCode,
  timezone: z.string().trim().min(1).max(60),
  startDate: isoDate,
  endDate: isoDate,
});

export const legsInputSchema = z.object({
  legs: z.array(legSchema).max(20),
});

export const tripBudgetInputSchema = z.object({
  currency: currencyCode,
  amount: z.coerce.number().nonnegative().max(99_999_999),
  label: z.string().trim().max(40).default(""),
  isPrimary: z.boolean().optional(),
});

export const tripBudgetsSchema = z
  .array(tripBudgetInputSchema)
  .min(1, "至少设置一种货币的预算")
  .max(8)
  .refine(
    (items) => {
      const seen = new Set<string>();
      for (const b of items) {
        const key = `${b.currency.toUpperCase()}:${(b.label ?? "").trim()}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    },
    { message: "同一币种下若有多个预算项，需要填写不同的标签区分" },
  );

export const tripInputSchema = z.object({
  name: z.string().trim().min(1, "给旅行起个名字").max(80),
  destination: z.string().trim().max(80).optional().nullable(),
  startDate: isoDate,
  endDate: isoDate,
  baseCurrency: currencyCode.default("CNY"),
  timezone: z.string().trim().max(60).default("Asia/Shanghai"),
  coverEmoji: z.string().trim().max(8).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  budgets: tripBudgetsSchema,
  /** 可选：多国旅行才需要。不填 = 单国行程 */
  legs: z.array(legSchema).max(20).optional(),
}).refine((v) => v.endDate >= v.startDate, {
  message: "结束日期不能早于开始日期",
  path: ["endDate"],
});

/** 编辑行程：只改元信息，预算走 /budgets 接口 */
export const tripUpdateSchema = z.object({
  name: z.string().trim().min(1, "给旅行起个名字").max(80).optional(),
  destination: z.string().trim().max(80).nullable().optional(),
  startDate: isoDate.optional(),
  endDate: isoDate.optional(),
  baseCurrency: currencyCode.optional(),
  timezone: z.string().trim().max(60).optional(),
  coverEmoji: z.string().trim().max(8).nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});

export const parseCaptureSchema = z.object({
  tripId: z.string().uuid(),
  /** 语音转写文本；与 audio 二选一 */
  transcript: z.string().trim().max(4000).optional(),
  /** 直接上传音频时使用（multipart 里以字段名 audio 传入） */
  language: z.string().trim().max(12).optional(),
  /** 浏览器本地识别已给出的文本，可跳过云端 STT */
  skipTranscription: z.boolean().optional(),
});

export const assistantSchema = z.object({
  tripId: z.string().uuid(),
  /** 不传则新建一个会话 */
  threadId: z.string().uuid().optional().nullable(),
  message: z.string().trim().min(1, "说点什么吧").max(1000),
});

export const analyzeSchema = z.object({
  tripId: z.string().uuid(),
  /** 可选：只分析某一天 */
  forDate: isoDate.optional(),
  /** 用户补充的问题，例如「我还能买那个包吗」 */
  question: z.string().trim().max(500).optional(),
});

/** 大模型解析消费的返回契约 */
export const llmCaptureSchema = z.object({
  /**
   * add = 新记一笔；correct = 修改最近/指定的一笔；delete = 删除最近/指定的一笔。
   * 例如「刚才那笔改成 18 镑」「昨天那笔删掉」。
   */
  intent: z.enum(["add", "correct", "delete"]).default("add"),
  correction: z
    .object({
      target: z
        .object({
          kind: z.enum(["last", "by_date", "by_merchant", "by_amount"]).default("last"),
          date: z.string().trim().max(10).nullable().optional(),
          merchant: z.string().trim().max(120).nullable().optional(),
          amount: z.coerce.number().nullable().optional(),
        })
        .default({ kind: "last" }),
      changes: z
        .object({
          amount: z.coerce.number().positive().nullable().optional(),
          currency: z.string().trim().max(8).nullable().optional(),
          categoryKey: z.string().trim().max(40).nullable().optional(),
          merchant: z.string().trim().max(120).nullable().optional(),
          note: z.string().trim().max(500).nullable().optional(),
          spentOn: z.string().trim().max(10).nullable().optional(),
          paymentMethod: z.string().trim().max(20).nullable().optional(),
        })
        .default({}),
      confidence: z.coerce.number().min(0).max(1).optional(),
      reason: z.string().trim().max(200).optional(),
    })
    .nullable()
    .optional(),
  expenses: z
    .array(
      z.object({
        amount: z.coerce.number().positive(),
        currency: z.string().trim().min(1).max(8),
        categoryKey: z.string().trim().max(40).optional().nullable(),
        merchant: z.string().trim().max(120).optional().nullable(),
        note: z.string().trim().max(500).optional().nullable(),
        spentOn: z.string().trim().max(10).optional().nullable(),
        paymentMethod: z.string().trim().max(20).optional().nullable(),
        confidence: z.coerce.number().min(0).max(1).optional(),
        reason: z.string().trim().max(200).optional(),
      }),
    )
    .max(20),
  warnings: z.array(z.string().trim().max(200)).max(10).optional(),
});

export type LlmCapture = z.infer<typeof llmCaptureSchema>;

/** 大模型预算分析的返回契约 */
export const llmInsightSchema = z.object({
  headline: z.string().trim().max(80),
  severity: z.enum(["info", "warn", "critical"]),
  body: z.string().trim().max(1200),
  verdict: z.enum(["on_track", "watch", "at_risk", "over_budget"]),
  bullets: z.array(z.string().trim().max(240)).max(8),
  actions: z.array(z.string().trim().max(200)).max(6),
  /** 对剩余行程的支出预测（基准币） */
  projectedTotal: z.coerce.number().optional(),
});

export type LlmInsight = z.infer<typeof llmInsightSchema>;

/** AI 一句话规划行程的输入契约 */
export const aiPlanTripInputSchema = z.object({
  prompt: z.string().trim().min(1, "请输入或说出旅行需求").max(2000),
  today: isoDate.optional(),
});

export type AiPlanTripInput = z.infer<typeof aiPlanTripInputSchema>;

/** AI 一句话规划行程的返回契约 */
export const aiPlanTripOutputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  destination: z.string().trim().max(80).nullable().optional(),
  coverEmoji: z.string().trim().max(8).default("✈️"),
  startDate: isoDate,
  endDate: isoDate,
  baseCurrency: currencyCode.default("CNY"),
  budgets: z
    .array(
      z.object({
        currency: currencyCode,
        amount: z.coerce.number().positive("预算金额必须大于 0"),
        label: z.string().trim().max(40).default(""),
      }),
    )
    .min(1, "至少需要一个币种的预算"),
  legs: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        countryCode: z.string().trim().length(2).toUpperCase().nullable().optional(),
        currency: currencyCode,
        timezone: z.string().trim().max(60).default("Asia/Shanghai"),
        startDate: isoDate,
        endDate: isoDate,
      }),
    )
    .optional(),
  suggestion: z.string().trim().max(500).optional(),
});

export type AiTripPlan = z.infer<typeof aiPlanTripOutputSchema>;

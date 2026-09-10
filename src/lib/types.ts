/** 跨层共享的领域类型。数据库行、API 出入参、UI 都对齐这里的形状。 */

export type TripStatus = "planning" | "active" | "completed" | "archived";
export type ExpenseSource = "voice" | "manual" | "receipt" | "import" | "recurring";
export type InsightSeverity = "info" | "warn" | "critical";
export type PaymentMethod = "cash" | "card" | "alipay" | "wechat" | "other";

export interface Profile {
  id: string;
  displayName: string | null;
  baseCurrency: string;
  locale: string;
}

export interface Trip {
  id: string;
  userId: string;
  name: string;
  destination: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  baseCurrency: string;
  timezone: string;
  status: TripStatus;
  coverEmoji: string | null;
  notes: string | null;
  createdAt: string;
}

/**
 * 行程分段：多国旅行里「某段时间待在某个国家/城市」。
 * 只用于推断默认币种、时区、以及分段复盘，不参与历史账目的重算。
 */
export interface TripLeg {
  id: string;
  tripId: string;
  seq: number;
  /** 城市/地区名，如「伦敦」 */
  name: string;
  /** ISO-3166-1 alpha-2，如 GB；未知可为 null */
  countryCode: string | null;
  currency: string;
  timezone: string;
  startDate: string;
  endDate: string;
}

/** 多币种预算条目，例如 { currency: 'GBP', amount: 1000 } */
export interface TripBudget {
  id: string;
  tripId: string;
  currency: string;
  amount: number;
  label: string;
  isPrimary: boolean;
}

export interface Category {
  id: string;
  userId: string | null;
  key: string;
  name: string;
  emoji: string;
  color: string;
  kind: "expense" | "income";
  sortOrder: number;
  isSystem: boolean;
}

export interface Expense {
  id: string;
  userId: string;
  tripId: string;
  categoryId: string | null;
  categoryKey: string | null;
  /** 原币金额 */
  amount: number;
  currency: string;
  /** 折算到旅行基准币的金额 */
  baseAmount: number;
  baseCurrency: string;
  /** 1 原币 = fxRate 基准币 */
  fxRate: number;
  fxSource: string | null;
  merchant: string | null;
  note: string | null;
  spentAt: string; // ISO
  spentOn: string; // YYYY-MM-DD（当地日期）
  paymentMethod: PaymentMethod | null;
  source: ExpenseSource;
  rawInput: string | null;
  aiConfidence: number | null;
  aiModel: string | null;
  tags: string[];
  createdAt: string;
}

/** 新增消费的输入（API / UI 共用） */
export interface ExpenseDraft {
  amount: number;
  currency: string;
  categoryKey?: string | null;
  merchant?: string | null;
  note?: string | null;
  spentAt?: string | null;
  spentOn?: string | null;
  paymentMethod?: PaymentMethod | null;
  source?: ExpenseSource;
  rawInput?: string | null;
  aiConfidence?: number | null;
  aiModel?: string | null;
  tags?: string[];
}

export interface AiInsight {
  id: string;
  tripId: string;
  kind: string;
  forDate: string | null;
  headline: string;
  body: string | null;
  severity: InsightSeverity;
  metrics: Record<string, unknown>;
  model: string | null;
  createdAt: string;
}

export interface FxQuote {
  base: string;
  quote: string;
  rate: number;
  asOf: string;
  source: string;
  /** true 表示来自离线兜底表，可能过时 */
  stale?: boolean;
}

export interface CaptureLog {
  id: string;
  tripId: string | null;
  transcript: string | null;
  parsed: unknown;
  status: "pending" | "confirmed" | "discarded" | "failed";
  error: string | null;
  latencyMs: number | null;
  model: string | null;
  createdAt: string;
}

/** 一句话的意图：新记账 / 修改最近一笔 / 删除最近一笔 */
export type CaptureIntent = "add" | "correct" | "delete";

/** 纠错要改哪一笔 */
export interface CorrectionTarget {
  kind: "last" | "by_date" | "by_merchant" | "by_amount";
  date?: string | null;
  merchant?: string | null;
  amount?: number | null;
}

/** 要改成什么（只带变化的字段） */
export interface CorrectionPatch {
  amount?: number | null;
  currency?: string | null;
  categoryKey?: string | null;
  merchant?: string | null;
  note?: string | null;
  spentOn?: string | null;
  paymentMethod?: PaymentMethod | null;
}

export interface ParsedCorrection {
  target: CorrectionTarget;
  changes: CorrectionPatch;
  confidence: number;
  reason?: string;
}

/** AI 助手会话 */
export interface AiThread {
  id: string;
  tripId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** AI 助手的一条消息（工具调用结果不入库，每轮重新查真实数据） */
export interface AiMessage {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

/** 一次语音/文本输入的解析结果（未落库，先给用户确认） */
export interface ParsedCapture {
  transcript: string;
  intent: CaptureIntent;
  drafts: Array<ExpenseDraft & { confidence: number; reason?: string }>;
  /** intent 为 correct/delete 时，解析出的目标与改动 */
  correction?: ParsedCorrection | null;
  /** 服务端已定位到的原始记录，供前端展示「原 → 新」对比 */
  target?: Expense | null;
  /** 解析器给出但无法确定的提示，例如「没听清金额」 */
  warnings: string[];
  /** 'llm' 或 'rules'，方便前端展示解析来源 */
  engine: "llm" | "rules";
  model?: string | null;
  latencyMs?: number;
}

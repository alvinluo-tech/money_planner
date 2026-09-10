import type {
  AiInsight,
  AiMessage,
  AiThread,
  Category,
  Expense,
  ExpenseDraft,
  ExpenseSource,
  InsightSeverity,
  PaymentMethod,
  Trip,
  TripBudget,
  TripLeg,
} from "../types";

/** 已经算好汇率与基准币金额、可以直接落库的消费行 */
export interface ExpenseInsert {
  tripId: string;
  categoryId: string | null;
  categoryKey: string | null;
  amount: number;
  currency: string;
  baseAmount: number;
  baseCurrency: string;
  fxRate: number;
  fxSource: string | null;
  merchant: string | null;
  note: string | null;
  spentAt: string;
  spentOn: string;
  paymentMethod: PaymentMethod | null;
  source: ExpenseSource;
  rawInput: string | null;
  aiConfidence: number | null;
  aiModel: string | null;
  tags: string[];
}

export interface TripInsert {
  name: string;
  destination: string | null;
  startDate: string;
  endDate: string;
  baseCurrency: string;
  timezone: string;
  coverEmoji: string | null;
  notes: string | null;
}

export interface BudgetInsert {
  currency: string;
  amount: number;
  label: string;
  isPrimary: boolean;
}

/** 行程分段（多国旅行）的写入形状 */
export interface LegInsert {
  name: string;
  countryCode: string | null;
  currency: string;
  timezone: string;
  startDate: string;
  endDate: string;
}

export interface InsightInsert {
  tripId: string;
  kind: string;
  forDate: string | null;
  headline: string;
  body: string | null;
  severity: InsightSeverity;
  metrics: Record<string, unknown>;
  model: string | null;
}

export interface CaptureLogInsert {
  tripId: string | null;
  transcript: string | null;
  parsed: unknown;
  status: "pending" | "confirmed" | "discarded" | "failed";
  error: string | null;
  latencyMs: number | null;
  model: string | null;
}

/**
 * 仓储接口 —— 上层业务只依赖这个形状。
 * 生产用 SupabaseRepo（RLS 保护），本地无凭据时用 MemoryRepo 跑演示数据，
 * 因此 UI / API / 预算引擎的代码一行都不用改。
 */
export interface Repo {
  readonly kind: "supabase" | "memory";

  listTrips(): Promise<Trip[]>;
  getTrip(tripId: string): Promise<Trip | null>;
  createTrip(
    input: TripInsert,
    budgets: BudgetInsert[],
    legs?: LegInsert[],
  ): Promise<{ trip: Trip; budgets: TripBudget[]; legs: TripLeg[] }>;
  updateTrip(tripId: string, patch: Partial<TripInsert>): Promise<Trip>;
  deleteTrip(tripId: string): Promise<void>;

  listBudgets(tripId: string): Promise<TripBudget[]>;
  replaceBudgets(tripId: string, budgets: BudgetInsert[]): Promise<TripBudget[]>;

  /** 行程分段（多国旅行）。未配置时返回空数组，上层自动退化为单国行为 */
  listLegs(tripId: string): Promise<TripLeg[]>;
  replaceLegs(tripId: string, legs: LegInsert[]): Promise<TripLeg[]>;

  listCategories(): Promise<Category[]>;

  listExpenses(tripId: string, options?: { limit?: number; from?: string; to?: string }): Promise<Expense[]>;
  getExpense(id: string): Promise<Expense | null>;
  createExpenses(rows: ExpenseInsert[]): Promise<Expense[]>;
  updateExpense(id: string, patch: Partial<ExpenseInsert>): Promise<Expense>;
  deleteExpense(id: string): Promise<void>;

  listInsights(tripId: string, limit?: number): Promise<AiInsight[]>;
  saveInsight(input: InsightInsert): Promise<AiInsight>;

  /** AI 助手会话 */
  listThreads(tripId: string, limit?: number): Promise<AiThread[]>;
  getThread(threadId: string): Promise<AiThread | null>;
  createThread(tripId: string, title: string): Promise<AiThread>;
  listMessages(threadId: string, limit?: number): Promise<AiMessage[]>;
  appendMessage(input: {
    threadId: string;
    role: AiMessage["role"];
    content: string;
  }): Promise<AiMessage>;

  /** 写入一条语音捕获日志，返回其 id 供后续标记状态 */
  logCapture(input: CaptureLogInsert): Promise<string>;
  /** 用户确认落库后把日志标记为 confirmed / discarded */
  updateCaptureStatus(
    id: string,
    status: CaptureLogInsert["status"],
    error?: string | null,
  ): Promise<void>;
}

export type { ExpenseDraft };

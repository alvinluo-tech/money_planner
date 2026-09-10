import { randomUUID } from "node:crypto";
import { roundMoney } from "../money";
import type {
  AiInsight, AiMessage, AiThread, Category, Expense, ExpenseSource, InsightSeverity,
  PaymentMethod, Trip, TripBudget, TripLeg,
} from "../types";
import type {
  BudgetInsert, CaptureLogInsert, ExpenseInsert, InsightInsert, LegInsert, Repo, TripInsert,
} from "./types";

/**
 * 内存仓储：没有 Supabase 凭据时用它跑「演示模式」。
 * 预置一趟 13 天的英国行程（1000 GBP + 10000 CNY 预算）和若干天真实感的消费，
 * 让首次启动就能看到预算推演与 AI 分析的效果。
 */

export const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";
const DEMO_TRIP_ID = "11111111-1111-4111-8111-111111111111";

const CATEGORY_SEED: Array<[string, string, string, string, number]> = [
  ["food", "餐饮", "🍜", "#f97316", 10],
  ["grocery", "超市杂货", "🛒", "#84cc16", 20],
  ["transport", "交通", "🚇", "#3b82f6", 30],
  ["lodging", "住宿", "🏨", "#8b5cf6", 40],
  ["shopping", "购物", "🛍️", "#ec4899", 50],
  ["attraction", "门票景点", "🎟️", "#14b8a6", 60],
  ["entertainment", "娱乐", "🎬", "#f59e0b", 70],
  ["health", "医疗健康", "💊", "#ef4444", 80],
  ["communication", "通讯网络", "📶", "#06b6d4", 90],
  ["fee", "手续费/税", "🧾", "#64748b", 100],
  ["gift", "礼物伴手", "🎁", "#a855f7", 110],
  ["other", "其他", "💸", "#94a3b8", 999],
];

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function isoAt(day: string, hour: number, minute = 0): string {
  return `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
}

interface Store {
  trips: Trip[];
  budgets: TripBudget[];
  legs: TripLeg[];
  categories: Category[];
  expenses: Expense[];
  insights: AiInsight[];
  captures: Array<CaptureLogInsert & { id: string }>;
  threads: AiThread[];
  messages: AiMessage[];
}

function seed(): Store {
  const categories: Category[] = CATEGORY_SEED.map(([key, name, emoji, color, sortOrder]) => ({
    id: `cat-${key}`,
    userId: null,
    key,
    name,
    emoji,
    color,
    kind: "expense",
    sortOrder,
    isSystem: true,
  }));

  const start = isoDate(-4);
  const end = isoDate(8);
  const trip: Trip = {
    id: DEMO_TRIP_ID,
    userId: DEMO_USER_ID,
    name: "英法瑞 13 天",
    destination: "英国 · 法国 · 瑞士",
    startDate: start,
    endDate: end,
    baseCurrency: "CNY",
    timezone: "Europe/London",
    status: "active",
    coverEmoji: "🌍",
    notes: "和姐姐一起，含往返机票与住宿预付；伦敦 → 巴黎 → 苏黎世",
    createdAt: new Date().toISOString(),
  };

  const budgets: TripBudget[] = [
    { id: randomUUID(), tripId: trip.id, currency: "GBP", amount: 1000, label: "英镑现金", isPrimary: true },
    { id: randomUUID(), tripId: trip.id, currency: "CNY", amount: 10000, label: "人民币备用", isPrimary: false },
  ];

  // 三段三个币种，正好演示多国行程的币种推断与分段复盘
  const legDefs: Array<[string, string, string, string, number, number]> = [
    // name, countryCode, currency, timezone, startOffset, endOffset
    ["伦敦", "GB", "GBP", "Europe/London", -4, -1],
    ["巴黎", "FR", "EUR", "Europe/Paris", 0, 3],
    ["苏黎世", "CH", "CHF", "Europe/Zurich", 4, 8],
  ];
  const legs: TripLeg[] = legDefs.map(([name, countryCode, currency, timezone, from, to], i) => ({
    id: `demo-leg-${i + 1}`,
    tripId: trip.id,
    seq: i,
    name,
    countryCode,
    currency,
    timezone,
    startDate: isoDate(from),
    endDate: isoDate(to),
  }));

  const rates: Record<string, number> = { GBP: 9.15, EUR: 7.75, CHF: 8.1, CNY: 1 };

  // dayOffset 是相对「今天」的天数：行程从 4 天前开始，消费只落在 -4 ~ 0 的已过去部分
  // （伦敦段 + 巴黎第 1 天），苏黎世段还没到、自然没有消费。
  // 绝不能出现未来日期，否则「今日支出」和累计趋势会把还没花的钱算进去。
  const raw: Array<[number, number, number, string, string, string | null, PaymentMethod]> = [
    // dayOffset, hour, amount, currency, categoryKey, merchant, payment
    // ---- 伦敦段（GBP）----
    [-4, 9, 68, "GBP", "transport", "Heathrow Express", "card"],
    [-4, 13, 24.5, "GBP", "food", "Pret A Manger", "card"],
    [-4, 19, 86, "GBP", "grocery", "Tesco", "card"],
    [-3, 8, 4.8, "GBP", "transport", "Oyster", "card"],
    [-3, 12, 32, "GBP", "attraction", "British Museum", "card"],
    [-3, 14, 18.6, "GBP", "food", "Dishoom", "card"],
    [-2, 9, 9.4, "GBP", "transport", "Oyster", "card"],
    [-2, 11, 128, "GBP", "shopping", "Oxford Street", "card"],
    [-2, 18, 260, "GBP", "lodging", "Premier Inn", "card"],
    [-1, 10, 7.2, "GBP", "food", "Costa Coffee", "cash"],
    [-1, 12, 55, "GBP", "attraction", "Tower of London", "card"],
    [-1, 15, 36, "CNY", "communication", "中国移动流量包", "alipay"],
    // ---- 巴黎段（EUR），今天刚到 ----
    [0, 14, 92, "EUR", "transport", "Eurostar", "card"],
    [0, 19, 38, "EUR", "food", "Le Marais", "card"],
  ];

  const expenses: Expense[] = raw.map(([offset, hour, amount, currency, categoryKey, merchant, payment], i) => {
    const day = isoDate(offset);
    const rate = rates[currency] ?? 1;
    return {
      id: `demo-exp-${i + 1}`,
      userId: DEMO_USER_ID,
      tripId: trip.id,
      categoryId: `cat-${categoryKey}`,
      categoryKey,
      amount,
      currency,
      baseAmount: roundMoney(amount * rate, "CNY"),
      baseCurrency: "CNY",
      fxRate: rate,
      fxSource: "ecb",
      merchant,
      note: null,
      spentAt: isoAt(day, hour),
      spentOn: day,
      paymentMethod: payment,
      source: (i % 5 === 0 ? "voice" : "manual") as ExpenseSource,
      rawInput: i % 5 === 0 ? `${merchant} 花了 ${amount} ${currency}` : null,
      aiConfidence: i % 5 === 0 ? 0.92 : null,
      aiModel: i % 5 === 0 ? "gpt-4o-mini" : null,
      tags: [],
      createdAt: isoAt(day, hour),
    };
  });

  return {
    trips: [trip],
    budgets,
    legs,
    categories,
    expenses,
    insights: [],
    captures: [],
    threads: [],
    messages: [],
  };
}

/**
 * 演示数据必须挂在 globalThis 上，不能用模块级变量。
 * Next.js 会为每个 route / page 分别打包服务端代码，模块级变量在构建产物里
 * 会各留一份副本 —— 那样「API 写入的消费」在页面上根本读不到（已在 next start 下复现）。
 * 注意：演示模式只适合本机 / 单实例；真实数据请配置 Supabase。
 */
type GlobalWithDemoStore = typeof globalThis & { __moneyPlannerDemoStore__?: Store };

function db(): Store {
  const g = globalThis as GlobalWithDemoStore;
  if (!g.__moneyPlannerDemoStore__) g.__moneyPlannerDemoStore__ = seed();
  return g.__moneyPlannerDemoStore__;
}

/** 测试与「重置演示数据」用 */
export function resetMemoryStore(): void {
  delete (globalThis as GlobalWithDemoStore).__moneyPlannerDemoStore__;
}

export class MemoryRepo implements Repo {
  readonly kind = "memory" as const;

  constructor(private readonly userId: string = DEMO_USER_ID) {}

  async listTrips(): Promise<Trip[]> {
    return db()
      .trips.filter((t) => t.userId === this.userId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async getTrip(tripId: string): Promise<Trip | null> {
    return db().trips.find((t) => t.id === tripId && t.userId === this.userId) ?? null;
  }

  async createTrip(
    input: TripInsert,
    budgets: BudgetInsert[],
    legs: LegInsert[] = [],
  ): Promise<{ trip: Trip; budgets: TripBudget[]; legs: TripLeg[] }> {
    const trip: Trip = {
      id: randomUUID(),
      userId: this.userId,
      name: input.name,
      destination: input.destination,
      startDate: input.startDate,
      endDate: input.endDate,
      baseCurrency: input.baseCurrency,
      timezone: input.timezone,
      status: "active",
      coverEmoji: input.coverEmoji,
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    db().trips.push(trip);
    const rows = await this.replaceBudgets(trip.id, budgets);
    const legRows = await this.replaceLegs(trip.id, legs);
    return { trip, budgets: rows, legs: legRows };
  }

  async updateTrip(tripId: string, patch: Partial<TripInsert>): Promise<Trip> {
    const trip = await this.getTrip(tripId);
    if (!trip) throw new Error("行程不存在");
    Object.assign(trip, patch);
    return trip;
  }

  async deleteTrip(tripId: string): Promise<void> {
    const s = db();
    s.trips = s.trips.filter((t) => t.id !== tripId);
    s.budgets = s.budgets.filter((b) => b.tripId !== tripId);
    s.legs = s.legs.filter((l) => l.tripId !== tripId);
    s.expenses = s.expenses.filter((e) => e.tripId !== tripId);
    s.insights = s.insights.filter((i) => i.tripId !== tripId);
    s.captures = s.captures.filter((c) => c.tripId !== tripId);
    const tripThreadIds = new Set(s.threads.filter((t) => t.tripId === tripId).map((t) => t.id));
    s.threads = s.threads.filter((t) => t.tripId !== tripId);
    s.messages = s.messages.filter((m) => !tripThreadIds.has(m.threadId));
  }

  async listBudgets(tripId: string): Promise<TripBudget[]> {
    return db().budgets.filter((b) => b.tripId === tripId);
  }

  async replaceBudgets(tripId: string, budgets: BudgetInsert[]): Promise<TripBudget[]> {
    const s = db();
    s.budgets = s.budgets.filter((b) => b.tripId !== tripId);
    const rows = budgets.map((b) => ({
      id: randomUUID(),
      tripId,
      currency: b.currency,
      amount: b.amount,
      label: b.label,
      isPrimary: b.isPrimary,
    }));
    s.budgets.push(...rows);
    return rows;
  }

  async listLegs(tripId: string): Promise<TripLeg[]> {
    return db()
      .legs.filter((l) => l.tripId === tripId)
      .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.seq - b.seq);
  }

  async replaceLegs(tripId: string, legs: LegInsert[]): Promise<TripLeg[]> {
    const s = db();
    s.legs = s.legs.filter((l) => l.tripId !== tripId);
    const rows = legs.map((leg, index) => ({
      id: randomUUID(),
      tripId,
      seq: index,
      name: leg.name,
      countryCode: leg.countryCode,
      currency: leg.currency,
      timezone: leg.timezone,
      startDate: leg.startDate,
      endDate: leg.endDate,
    }));
    s.legs.push(...rows);
    return rows;
  }

  async listCategories(): Promise<Category[]> {
    return [...db().categories].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  async listExpenses(
    tripId: string,
    options: { limit?: number; from?: string; to?: string } = {},
  ): Promise<Expense[]> {
    let rows = db().expenses.filter((e) => e.tripId === tripId && e.userId === this.userId);
    if (options.from) rows = rows.filter((e) => e.spentOn >= options.from!);
    if (options.to) rows = rows.filter((e) => e.spentOn <= options.to!);
    rows = rows.sort((a, b) => (b.spentOn + b.spentAt).localeCompare(a.spentOn + a.spentAt));
    return options.limit ? rows.slice(0, options.limit) : rows;
  }

  async getExpense(id: string): Promise<Expense | null> {
    return db().expenses.find((e) => e.id === id && e.userId === this.userId) ?? null;
  }

  async createExpenses(rows: ExpenseInsert[]): Promise<Expense[]> {
    const created = rows.map((row) => ({
      id: randomUUID(),
      userId: this.userId,
      ...row,
      createdAt: new Date().toISOString(),
    })) as Expense[];
    db().expenses.push(...created);
    return created;
  }

  async updateExpense(id: string, patch: Partial<ExpenseInsert>): Promise<Expense> {
    const row = db().expenses.find((e) => e.id === id && e.userId === this.userId);
    if (!row) throw new Error("消费记录不存在");
    // 只应用显式给出的字段：调用方（如 PATCH 路由）会预置 undefined 键，
    // Object.assign 会把它们原样写入，把已有的商家/备注/支付方式清空。
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (row as unknown as Record<string, unknown>)[key] = value;
    }
    return row;
  }

  async deleteExpense(id: string): Promise<void> {
    const s = db();
    s.expenses = s.expenses.filter((e) => !(e.id === id && e.userId === this.userId));
  }

  async listInsights(tripId: string, limit = 10): Promise<AiInsight[]> {
    return db()
      .insights.filter((i) => i.tripId === tripId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async saveInsight(input: InsightInsert): Promise<AiInsight> {
    const insight: AiInsight = {
      id: randomUUID(),
      tripId: input.tripId,
      kind: input.kind,
      forDate: input.forDate,
      headline: input.headline,
      body: input.body,
      severity: input.severity,
      metrics: input.metrics,
      model: input.model,
      createdAt: new Date().toISOString(),
    };
    db().insights.unshift(insight);
    return insight;
  }

  async listThreads(tripId: string, limit = 20): Promise<AiThread[]> {
    return db()
      .threads.filter((t) => t.tripId === tripId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit);
  }

  async getThread(threadId: string): Promise<AiThread | null> {
    return db().threads.find((t) => t.id === threadId) ?? null;
  }

  async createThread(tripId: string, title: string): Promise<AiThread> {
    const now = new Date().toISOString();
    const thread: AiThread = {
      id: randomUUID(),
      tripId,
      title,
      createdAt: now,
      updatedAt: now,
    };
    db().threads.unshift(thread);
    return thread;
  }

  async listMessages(threadId: string, limit = 50): Promise<AiMessage[]> {
    return db()
      .messages.filter((m) => m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(-limit);
  }

  async appendMessage(input: {
    threadId: string;
    role: AiMessage["role"];
    content: string;
  }): Promise<AiMessage> {
    const message: AiMessage = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      createdAt: new Date().toISOString(),
    };
    db().messages.push(message);
    const thread = db().threads.find((t) => t.id === input.threadId);
    if (thread) thread.updatedAt = message.createdAt;
    return message;
  }

  async logCapture(input: CaptureLogInsert): Promise<string> {
    const id = randomUUID();
    db().captures.unshift({ ...input, id });
    if (db().captures.length > 200) db().captures.length = 200;
    return id;
  }

  async updateCaptureStatus(
    id: string,
    status: CaptureLogInsert["status"],
    error?: string | null,
  ): Promise<void> {
    const row = db().captures.find((c) => c.id === id);
    if (!row) return;
    row.status = status;
    if (error !== undefined) row.error = error;
  }
}

export type { InsightSeverity };

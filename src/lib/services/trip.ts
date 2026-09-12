import "server-only";
import { cache } from "react";
import { buildBudgetSummary, type BudgetSummary } from "../budget";
import { getRatesTo } from "../fx";
import { roundMoney } from "../money";
import type { Repo } from "../db/types";
import type { ExpenseInsert } from "../db/types";
import { dateInTimezone, legForDate, legForInstant } from "../legs";
import type {
  Category,
  CorrectionTarget,
  Expense,
  ExpenseDraft,
  FxQuote,
  Trip,
  TripBudget,
  TripLeg,
} from "../types";

/** 聚合一趟旅行所需的全部数据 + 预算推演结果，页面和 API 都复用它 */
export interface TripContext {
  trip: Trip;
  /** 多国行程分段；单国行程为空数组 */
  legs: TripLeg[];
  budgets: TripBudget[];
  expenses: Expense[];
  categories: Category[];
  rates: Record<string, number>;
  quotes: Record<string, FxQuote>;
  staleRates: string[];
  summary: BudgetSummary;
}

/**
 * 「今天」按当前所处行程段的时区算。
 * 伦敦飞东京之后，如果还按出发地时区算，跨零点时日期会差一天，
 * 「今日支出」和按天分组就会错位。
 */
export function tripToday(trip: Pick<Trip, "timezone">, legs: TripLeg[] = []): string {
  const active = legForInstant(legs);
  return dateInTimezone(active?.timezone || trip.timezone || "Asia/Shanghai");
}

export const loadTripContext = cache(async function loadTripContext(
  repo: Repo,
  tripId: string,
  options: { expenseLimit?: number } = {},
): Promise<TripContext | null> {
  const trip = await repo.getTrip(tripId);
  if (!trip) return null;

  const [budgets, expenses, categories, legs] = await Promise.all([
    repo.listBudgets(tripId),
    repo.listExpenses(tripId, { limit: options.expenseLimit }),
    repo.listCategories(),
    repo.listLegs(tripId),
  ]);

  const currencies = [
    trip.baseCurrency,
    ...budgets.map((b) => b.currency),
    ...expenses.map((e) => e.currency),
    ...legs.map((l) => l.currency),
  ];
  const quotes = await getRatesTo(currencies, trip.baseCurrency);
  const rates: Record<string, number> = Object.fromEntries(
    Object.entries(quotes).map(([code, quote]) => [code, quote.rate]),
  );
  rates[trip.baseCurrency.toUpperCase()] = 1;
  const staleRates = Object.entries(quotes)
    .filter(([, quote]) => quote.stale)
    .map(([code]) => code);

  const summary = buildBudgetSummary({
    trip,
    budgets,
    expenses,
    rates,
    staleRates,
    categories: categories.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji, color: c.color })),
    legs,
    today: tripToday(trip, legs),
  });

  return { trip, legs, budgets, expenses, categories, rates, quotes, staleRates, summary };
});

export interface CreateExpensesArgs {
  repo: Repo;
  trip: Trip;
  drafts: ExpenseDraft[];
  /** 行程分段，用于判断「今天」的时区 */
  legs?: TripLeg[];
  fallbackSpentOn?: string;
  defaultFxSource?: string;
}

/** 把用户确认后的草稿落库：统一补汇率、基准币金额、当地日期 */
export async function createExpensesFromDrafts(args: CreateExpensesArgs): Promise<Expense[]> {
  const { repo, trip, drafts } = args;
  if (drafts.length === 0) return [];

  const base = trip.baseCurrency.toUpperCase();
  const today = args.fallbackSpentOn ?? tripToday(trip, args.legs ?? []);
  const currencies = [base, ...drafts.map((d) => d.currency)];
  const quotes = await getRatesTo(currencies, base);

  const rows: ExpenseInsert[] = drafts.map((draft) => {
    const currency = draft.currency.toUpperCase();
    const quote = quotes[currency] ?? quotes[base];
    const fxRate = currency === base ? 1 : (quote?.rate ?? 1);
    const fxSource = currency === base ? "same" : (quote?.source ?? args.defaultFxSource ?? "offline-fallback");

    let spentOn = draft.spentOn ?? (draft.spentAt ? draft.spentAt.slice(0, 10) : today);
    // 允许记录行程结束日之前的未来机酒或预订，超出行程结束日的才限制
    const maxDate = trip.endDate ? (trip.endDate > today ? trip.endDate : today) : today;
    if (spentOn > maxDate) spentOn = maxDate;
    const spentAt = draft.spentAt ?? `${spentOn}T${new Date().toISOString().slice(11, 19)}Z`;

    return {
      tripId: trip.id,
      categoryId: null,
      categoryKey: draft.categoryKey ?? "other",
      amount: roundMoney(draft.amount, currency),
      currency,
      baseAmount: roundMoney(draft.amount * fxRate, base),
      baseCurrency: base,
      fxRate,
      fxSource,
      merchant: draft.merchant ?? null,
      note: draft.note ?? null,
      spentAt,
      spentOn,
      paymentMethod: draft.paymentMethod ?? null,
      source: draft.source ?? "manual",
      rawInput: draft.rawInput ?? null,
      aiConfidence: draft.aiConfidence ?? null,
      aiModel: draft.aiModel ?? null,
      tags: draft.tags ?? [],
    };
  });

  return repo.createExpenses(rows);
}

/**
 * 把「刚才那笔 / 昨天那笔 / 在星巴克那笔」定位到一条具体记录。
 * 列表本身已按时间倒序，所以 last 就是最近一条。
 */
export async function resolveCorrectionTarget(
  repo: Repo,
  tripId: string,
  target: CorrectionTarget,
): Promise<Expense | null> {
  const rows = await repo.listExpenses(tripId, { limit: 100 });
  if (rows.length === 0) return null;

  switch (target.kind) {
    case "by_date":
      return rows.find((e) => e.spentOn === target.date) ?? null;
    case "by_merchant": {
      const q = (target.merchant ?? "").trim().toLowerCase();
      if (!q) return rows[0];
      return rows.find((e) => (e.merchant ?? "").toLowerCase().includes(q)) ?? null;
    }
    case "by_amount": {
      const amount = target.amount ?? 0;
      return rows.find((e) => Math.abs(e.amount - amount) < 0.01) ?? null;
    }
    case "last":
    default:
      return rows[0];
  }
}

/** 最近若干条消费的「原话 → 结果」样本，喂给大模型学习用户表达习惯 */
export async function recentParseExamples(
  repo: Repo,
  tripId: string,
): Promise<Array<{ transcript: string; amount: number; currency: string; categoryKey: string | null; merchant: string | null }>> {
  const rows = await repo.listExpenses(tripId, { limit: 30 });
  return rows
    .filter((e) => Boolean(e.rawInput))
    .slice(0, 6)
    .map((e) => ({
      transcript: e.rawInput as string,
      amount: e.amount,
      currency: e.currency,
      categoryKey: e.categoryKey,
      merchant: e.merchant,
    }));
}

/**
 * 「没提币种」时的默认币种。
 * 1) 多国行程：优先取该笔消费所属分段的币种（巴黎默认 EUR、苏黎世默认 CHF）；
 * 2) 单国行程：退回「预算里优先级最高的非基准币」；
 * 3) 都没有：基准币。
 */
export function inferDefaultCurrency(
  trip: Trip,
  budgets: TripBudget[],
  legs: TripLeg[] = [],
  date?: string,
): string {
  const base = trip.baseCurrency.toUpperCase();
  if (legs.length > 0) {
    const leg = date ? legForDate(legs, date) : legForInstant(legs);
    if (leg?.currency) return leg.currency.toUpperCase();
  }
  const foreign = budgets.filter((b) => b.currency.toUpperCase() !== base);
  if (foreign.length === 1) return foreign[0].currency.toUpperCase();
  const primary = foreign.find((b) => b.isPrimary);
  if (primary) return primary.currency.toUpperCase();
  if (foreign.length > 0) {
    return foreign.sort((a, b) => b.amount - a.amount)[0].currency.toUpperCase();
  }
  return base;
}

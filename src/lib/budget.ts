import { currencyExponent } from "./currency";
import { formatMoney, formatPercent, roundMoney, safeDiv } from "./money";
import { legForDate, sortLegs } from "./legs";
import type { Expense, Trip, TripBudget, TripLeg } from "./types";

/**
 * 预算推演引擎 —— 本项目的核心「判断力」所在。
 * 输入一趟旅行 + 多币种预算 + 已发生的消费，输出：
 *   · 还能不能撑到旅行结束（projectedOverrun / runwayDays）
 *   · 当前节奏是否合理（actualDaily vs allowedDaily）
 *   · 消费结构是否健康（byCategory vs 建议占比）
 * 纯函数、无 IO，方便单测与在客户端预览。
 */

export type BudgetHealth = "on_track" | "watch" | "at_risk" | "over_budget";

/** 旅行场景下的建议消费占比（住宿/餐饮/交通三项通常占 60%+） */
export const IDEAL_CATEGORY_SHARE: Record<string, number> = {
  lodging: 0.3,
  food: 0.22,
  transport: 0.12,
  shopping: 0.1,
  attraction: 0.09,
  grocery: 0.06,
  entertainment: 0.04,
  communication: 0.02,
  health: 0.02,
  fee: 0.02,
  gift: 0.05,
  other: 0.06,
};

export interface CategoryStat {
  categoryKey: string;
  name: string;
  emoji: string;
  color: string;
  amount: number;
  share: number;
  idealShare: number;
  count: number;
  dailyAverage: number;
  /** amount 超过建议占比 1.4 倍时给出提示 */
  overIndex: boolean;
}

export interface CurrencyStat {
  currency: string;
  spent: number;
  spentBase: number;
  count: number;
  share: number;
}

export interface BudgetCurrencyStat {
  currency: string;
  amount: number;
  label: string;
  rateToBase: number;
  amountBase: number;
  share: number;
  /** 该币种预算被消耗的比例（按同币种消费估算） */
  consumedRatio: number;
  consumedBase: number;
}

export interface DayStat {
  date: string;
  spent: number;
  cumulative: number;
  /** 当日「应花」额度，用于和实际对比 */
  allowed: number;
  count: number;
}

/** 分段（多国）统计：把消费按行程段归属，用于分段复盘 */
export interface LegStat {
  legId: string;
  name: string;
  countryCode: string | null;
  currency: string;
  timezone: string;
  startDate: string;
  endDate: string;
  days: number;
  /** 该段已花（折算基准币） */
  spent: number;
  /** 该段以本段币种计价的消费额 */
  spentInLegCurrency: number;
  count: number;
  /**
   * 参考额度 = 全程预算 × 该段天数占比。
   * 这是「参照物」而不是硬性约束——跨国旅行里机票、长途交通集中在移动日，
   * 按天数摊平天然会让移动日显得紧、度假日显得松。
   */
  referenceAllowance: number;
  utilization: number;
  status: "on_track" | "watch" | "over";
  /** 是否是「今天」所在的段 */
  isActive: boolean;
}

export interface BudgetAlert {
  level: "info" | "warn" | "critical";
  title: string;
  detail: string;
}

export interface BudgetSummary {
  baseCurrency: string;
  totalBudget: number;
  spent: number;
  remaining: number;
  utilization: number;
  daysTotal: number;
  daysElapsed: number;
  daysRemaining: number;
  allowedDaily: number;
  actualDaily: number;
  projectedTotal: number;
  projectedOverrun: number;
  runwayDays: number;
  health: BudgetHealth;
  todaySpent: number;
  yesterdaySpent: number;
  byCategory: CategoryStat[];
  byCurrency: CurrencyStat[];
  budgetByCurrency: BudgetCurrencyStat[];
  byDay: DayStat[];
  /** 分段统计；未配置分段时为空数组 */
  byLeg: LegStat[];
  /** 今天所在段的 id；未配置分段或不在任何段内时为 null */
  activeLegId: string | null;
  alerts: BudgetAlert[];
  /** 汇率是否含离线兜底值 */
  staleRates: string[];
}

export interface BuildBudgetInput {
  trip: Pick<Trip, "startDate" | "endDate" | "baseCurrency">;
  budgets: Array<Pick<TripBudget, "currency" | "amount" | "label">>;
  expenses: Expense[];
  /** 币种 → 到基准币的汇率（1 原币 = rate 基准币） */
  rates: Record<string, number>;
  staleRates?: string[];
  categories?: Array<{ key: string; name: string; emoji: string; color: string }>;
  /** 行程分段（多国旅行）；不传或为空时退化为单国行程的行为 */
  legs?: TripLeg[];
  /** 用于计算「已过天数」，默认取今天 */
  today?: string;
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.floor((b - a) / 86_400_000) + 1;
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

export function buildBudgetSummary(input: BuildBudgetInput): BudgetSummary {
  const { trip, budgets, expenses, rates } = input;
  const base = trip.baseCurrency.toUpperCase();
  const start = toDateOnly(trip.startDate);
  const end = toDateOnly(trip.endDate);
  const today = input.today ?? new Date().toISOString().slice(0, 10);

  const daysTotal = Math.max(1, daysBetweenInclusive(start, end));
  const isCompleted = today > end;
  const isPreTrip = today < start;
  // 旅行开始前按第 1 天算，旅行结束后按最后一天算，避免除零与诡异百分比
  const effectiveToday = clampDate(today, start, end);
  const daysElapsed = isPreTrip ? 1 : Math.max(1, daysBetweenInclusive(start, effectiveToday));
  const daysRemaining = isCompleted ? 0 : Math.max(1, daysTotal - daysElapsed + 1);
  const futureDays = isCompleted ? 0 : Math.max(0, daysTotal - daysElapsed);

  const rateOf = (currency: string): number => {
    const c = currency.toUpperCase();
    if (c === base) return 1;
    const r = rates[c];
    return Number.isFinite(r) && r > 0 ? r : 0;
  };

  const baseAmountOf = (e: Expense): number => {
    // 优先用落库时冻结的 baseAmount，保证历史账本不被汇率漂移改写
    if (Number.isFinite(e.baseAmount) && e.baseCurrency?.toUpperCase() === base) return e.baseAmount;
    return roundMoney(e.amount * rateOf(e.currency), base);
  };

  // ---- 预算 ----
  const budgetByCurrency: BudgetCurrencyStat[] = [];
  let totalBudget = 0;
  for (const b of budgets) {
    const rate = rateOf(b.currency);
    const amountBase = roundMoney(b.amount * rate, base);
    totalBudget += amountBase;
    budgetByCurrency.push({
      currency: b.currency.toUpperCase(),
      amount: b.amount,
      label: b.label ?? "",
      rateToBase: rate,
      amountBase,
      share: 0,
      consumedRatio: 0,
      consumedBase: 0,
    });
  }
  totalBudget = roundMoney(totalBudget, base);

  // ---- 消费 ----
  const catMeta = new Map((input.categories ?? []).map((c) => [c.key, c]));
  const catMap = new Map<string, CategoryStat>();
  const curMap = new Map<string, CurrencyStat>();
  const dayMap = new Map<string, DayStat>();
  const consumedByCurrency = new Map<string, number>();

  // ---- 分段归属（多国旅行）----
  const legs = sortLegs(input.legs ?? []);
  const activeLeg = legForDate(legs, today);
  const legAcc = new Map<string, { spent: number; inLegCurrency: number; count: number }>();

  let spent = 0;
  let todaySpent = 0;

  for (const e of expenses) {
    const baseAmount = baseAmountOf(e);
    if (baseAmount === 0) continue;
    spent += baseAmount;

    const day = toDateOnly(e.spentOn || e.spentAt);
    if (day === today) todaySpent += baseAmount;

    const leg = legForDate(legs, day);
    if (leg) {
      const acc = legAcc.get(leg.id) ?? { spent: 0, inLegCurrency: 0, count: 0 };
      acc.spent += baseAmount;
      if (e.currency.toUpperCase() === leg.currency.toUpperCase()) acc.inLegCurrency += e.amount;
      acc.count += 1;
      legAcc.set(leg.id, acc);
    }

    const ck = e.categoryKey ?? "other";
    const meta = catMeta.get(ck);
    const cat = catMap.get(ck) ?? {
      categoryKey: ck,
      name: meta?.name ?? "其他",
      emoji: meta?.emoji ?? "💸",
      color: meta?.color ?? "#94a3b8",
      amount: 0,
      share: 0,
      idealShare: IDEAL_CATEGORY_SHARE[ck] ?? 0.05,
      count: 0,
      dailyAverage: 0,
      overIndex: false,
    };
    cat.amount += baseAmount;
    cat.count += 1;
    catMap.set(ck, cat);

    const cur = e.currency.toUpperCase();
    const cs = curMap.get(cur) ?? { currency: cur, spent: 0, spentBase: 0, count: 0, share: 0 };
    cs.spent += e.amount;
    cs.spentBase += baseAmount;
    cs.count += 1;
    curMap.set(cur, cs);
    consumedByCurrency.set(cur, (consumedByCurrency.get(cur) ?? 0) + baseAmount);

    const ds = dayMap.get(day) ?? { date: day, spent: 0, cumulative: 0, allowed: 0, count: 0 };
    ds.spent += baseAmount;
    ds.count += 1;
    dayMap.set(day, ds);
  }

  spent = roundMoney(spent, base);
  const remaining = roundMoney(totalBudget - spent, base);
  const allowedDaily = isCompleted ? 0 : roundMoney(safeDiv(remaining, daysRemaining), base);
  const actualDaily = isPreTrip ? 0 : roundMoney(safeDiv(spent, daysElapsed), base);
  const projectedTotal = isCompleted
    ? spent
    : isPreTrip
      ? roundMoney(Math.max(spent, totalBudget), base)
      : roundMoney(spent + actualDaily * futureDays, base);
  const projectedOverrun = roundMoney(Math.max(0, projectedTotal - totalBudget), base);
  const runwayDays = !isCompleted && actualDaily > 0 ? Math.floor(safeDiv(remaining, actualDaily)) : Infinity;

  // ---- 健康度 ----
  let health: BudgetHealth = "on_track";
  if (remaining < 0) health = "over_budget";
  else if (projectedTotal > totalBudget * 1.15) health = "at_risk";
  else if (projectedTotal > totalBudget) health = "watch";

  // ---- 派生统计 ----
  for (const c of catMap.values()) {
    c.share = safeDiv(c.amount, spent);
    c.dailyAverage = roundMoney(safeDiv(c.amount, daysElapsed), base);
    c.overIndex = c.idealShare > 0 && c.share > c.idealShare * 1.4 && c.amount > totalBudget * 0.03;
  }
  for (const c of curMap.values()) c.share = safeDiv(c.spentBase, spent);
  for (const b of budgetByCurrency) {
    b.share = safeDiv(b.amountBase, totalBudget);
    const consumed = consumedByCurrency.get(b.currency) ?? 0;
    b.consumedBase = roundMoney(consumed, base);
    b.consumedRatio = safeDiv(consumed, b.amountBase);
  }

  // 逐日累计 + 当日额度（线性分配）
  const byDay: DayStat[] = [];
  let cumulative = 0;
  const perDayBudget = safeDiv(totalBudget, daysTotal);
  for (let i = 0; i < daysTotal; i += 1) {
    const date = addDays(start, i);
    const ds = dayMap.get(date) ?? { date, spent: 0, cumulative: 0, allowed: 0, count: 0 };
    cumulative += ds.spent;
    ds.cumulative = roundMoney(cumulative, base);
    ds.allowed = roundMoney(perDayBudget * (i + 1), base);
    ds.spent = roundMoney(ds.spent, base);
    byDay.push(ds);
  }

  // 旅行日之外发生的消费（补记/预支）也纳入，避免总额对不上
  for (const [date, ds] of dayMap) {
    if (date < start || date > end) {
      byDay.push({ ...ds, spent: roundMoney(ds.spent, base), cumulative: 0, allowed: 0 });
    }
  }

  const yesterday = addDays(today, -1);
  const yesterdaySpent = roundMoney(dayMap.get(yesterday)?.spent ?? 0, base);

  const byCategory = Array.from(catMap.values()).sort((a, b) => b.amount - a.amount);

  const byLeg: LegStat[] = legs.map((leg) => {
    const acc = legAcc.get(leg.id) ?? { spent: 0, inLegCurrency: 0, count: 0 };
    const legDays = Math.max(1, daysBetweenInclusive(leg.startDate, leg.endDate));
    const referenceAllowance = roundMoney((totalBudget * legDays) / daysTotal, base);
    const utilization = safeDiv(acc.spent, referenceAllowance);
    return {
      legId: leg.id,
      name: leg.name,
      countryCode: leg.countryCode,
      currency: leg.currency.toUpperCase(),
      timezone: leg.timezone,
      startDate: leg.startDate,
      endDate: leg.endDate,
      days: legDays,
      spent: roundMoney(acc.spent, base),
      spentInLegCurrency: roundMoney(acc.inLegCurrency, leg.currency),
      count: acc.count,
      referenceAllowance,
      utilization,
      status: utilization > 1.15 ? "over" : utilization > 1 ? "watch" : "on_track",
      isActive: leg.id === activeLeg?.id,
    };
  });

  return {
    baseCurrency: base,
    totalBudget,
    spent,
    remaining,
    utilization: safeDiv(spent, totalBudget),
    daysTotal,
    daysElapsed,
    daysRemaining,
    allowedDaily,
    actualDaily,
    projectedTotal,
    projectedOverrun,
    runwayDays,
    health,
    todaySpent: roundMoney(todaySpent, base),
    yesterdaySpent,
    byCategory,
    byCurrency: Array.from(curMap.values()).sort((a, b) => b.spentBase - a.spentBase),
    budgetByCurrency,
    byDay,
    byLeg,
    activeLegId: activeLeg?.id ?? null,
    alerts: buildAlerts({
      base,
      totalBudget,
      spent,
      remaining,
      daysRemaining,
      daysTotal,
      daysElapsed,
      allowedDaily,
      actualDaily,
      projectedTotal,
      projectedOverrun,
      runwayDays,
      isCompleted,
      byCategory,
      budgetByCurrency,
      byLeg,
      staleRates: input.staleRates ?? [],
    }),
    staleRates: input.staleRates ?? [],
  };
}

function buildAlerts(args: {
  base: string;
  totalBudget: number;
  spent: number;
  remaining: number;
  daysRemaining: number;
  daysTotal: number;
  daysElapsed: number;
  allowedDaily: number;
  actualDaily: number;
  projectedTotal: number;
  projectedOverrun: number;
  runwayDays: number;
  isCompleted: boolean;
  byCategory: CategoryStat[];
  budgetByCurrency: BudgetCurrencyStat[];
  byLeg: LegStat[];
  staleRates: string[];
}): BudgetAlert[] {
  const alerts: BudgetAlert[] = [];
  const {
    base, totalBudget, spent, remaining, daysTotal, daysRemaining, allowedDaily, actualDaily,
    projectedTotal, projectedOverrun, runwayDays, isCompleted, byCategory, budgetByCurrency, byLeg,
  } = args;

  if (totalBudget <= 0) {
    alerts.push({
      level: "warn",
      title: "还没有设置预算",
      detail: "设置预算后我才能判断当前节奏能否撑完整趟旅行。",
    });
    return alerts;
  }

  if (remaining < 0) {
    alerts.push({
      level: "critical",
      title: `已超支 ${formatMoney(Math.abs(remaining), base)}`,
      detail: `预算 ${formatMoney(totalBudget, base)}，已花 ${formatMoney(spent, base)}。建议立刻压缩非必要支出。`,
    });
  } else if (!isCompleted && projectedTotal > totalBudget) {
    // 轻微超支只给「注意」，与 health=watch 保持一致；明显超支才是「警告」
    const severe = projectedOverrun > totalBudget * 0.1;
    alerts.push({
      level: severe ? "critical" : "warn",
      title: `按当前节奏会超支 ${formatMoney(projectedOverrun, base)}`,
      detail: `照这个日均花下去，${daysTotal} 天预计总支出 ${formatMoney(projectedTotal, base)}。剩下的 ${daysRemaining} 天建议把日预算控制在 ${formatMoney(allowedDaily, base)} 以内。`,
    });
  }

  if (!isCompleted && Number.isFinite(runwayDays) && runwayDays < daysRemaining && remaining > 0) {
    alerts.push({
      level: "warn",
      title: `预算只够再撑 ${runwayDays} 天`,
      detail: `旅行还剩 ${daysRemaining} 天。按当前日均 ${formatMoney(actualDaily, base)}，预算会在第 ${args.daysElapsed + runwayDays} 天见底。`,
    });
  }

  if (!isCompleted && allowedDaily > 0 && actualDaily > allowedDaily * 1.25 && remaining > 0) {
    alerts.push({
      level: "warn",
      title: "当前日均超出健康节奏",
      detail: `实际日均 ${formatMoney(actualDaily, base)}，健康日均约 ${formatMoney(allowedDaily, base)}，高出 ${formatPercent(safeDiv(actualDaily, allowedDaily) - 1, 0)}。`,
    });
  }

  for (const cat of byCategory) {
    if (!cat.overIndex) continue;
    alerts.push({
      level: "info",
      title: `${cat.name}占比偏高`,
      detail: `${cat.name} 已花 ${formatMoney(cat.amount, base)}，占总支出的 ${formatPercent(cat.share, 0)}，参考占比约 ${formatPercent(cat.idealShare, 0)}。`,
    });
  }

  for (const b of budgetByCurrency) {
    if (b.consumedRatio > 0.85 && b.amountBase > 0) {
      alerts.push({
        level: b.consumedRatio > 1 ? "warn" : "info",
        title: `${b.currency} 预算已用 ${formatPercent(b.consumedRatio, 0)}`,
        detail: `${b.currency} 额度 ${formatMoney(b.amount, b.currency)}，已花约 ${formatMoney(b.consumedBase / (b.rateToBase || 1), b.currency)}。`,
      });
    }
  }

  // 分段提醒：只在真的分了多段时才有意义，避免单国行程刷屏
  if (byLeg.length > 1) {
    for (const leg of byLeg) {
      if (leg.status === "over" && leg.referenceAllowance > 0) {
        alerts.push({
          level: "warn",
          title: `${leg.name}这段花得比参考快`,
          detail: `这段 ${leg.days} 天已花 ${formatMoney(leg.spent, base)}，按天数占比的参考额度是 ${formatMoney(leg.referenceAllowance, base)}。`,
        });
      }
    }
  }

  if (args.staleRates.length > 0) {
    alerts.push({
      level: "info",
      title: "部分汇率来自离线兜底",
      detail: `${args.staleRates.join("、")} 未能获取实时汇率，折算结果仅供参考。`,
    });
  }

  return alerts;
}

/** 便捷：把 summary 压成给大模型的一段紧凑文本 */
export function summaryForPrompt(s: BudgetSummary, tripName: string): string {
  const lines: string[] = [];
  lines.push(`行程：${tripName}，${s.daysTotal} 天，基准币 ${s.baseCurrency}`);
  lines.push(
    `预算 ${formatMoney(s.totalBudget, s.baseCurrency)}（${s.budgetByCurrency
      .map((b) => `${formatMoney(b.amount, b.currency)}`)
      .join(" + ")}）`,
  );
  lines.push(
    `已花 ${formatMoney(s.spent, s.baseCurrency)}，剩余 ${formatMoney(s.remaining, s.baseCurrency)}，已用 ${formatPercent(s.utilization, 1)}`,
  );
  lines.push(
    `第 ${s.daysElapsed}/${s.daysTotal} 天；实际日均 ${formatMoney(s.actualDaily, s.baseCurrency)}，健康日均 ${formatMoney(s.allowedDaily, s.baseCurrency)}`,
  );
  lines.push(
    `预计总支出 ${formatMoney(s.projectedTotal, s.baseCurrency)}，预计超支 ${formatMoney(s.projectedOverrun, s.baseCurrency)}`,
  );
  lines.push(
    `分类占比：${s.byCategory
      .map((c) => `${c.name} ${formatMoney(c.amount, s.baseCurrency)}(${formatPercent(c.share, 0)})`)
      .join("，")}`,
  );
  return lines.join("\n");
}

/** 小数位辅助，UI 用 */
export function decimalsFor(currency: string): number {
  return currencyExponent(currency);
}

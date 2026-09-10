import "server-only";
import type { BudgetSummary } from "../budget";
import { legForDate, COUNTRY_PRESETS } from "../legs";
import { formatMoney, roundMoney } from "../money";
import type { Repo } from "../db/types";
import type { Category, Expense, Trip, TripLeg } from "../types";

/**
 * 助手可调用的工具。
 * 原则：所有数字都从真实数据里查出来，模型只负责选条件和组织语言。
 * 工具返回体做了裁剪（行数上限 + 字符串截断），避免把上下文撑爆。
 */

export interface ToolContext {
  repo: Repo;
  trip: Trip;
  legs: TripLeg[];
  categories: Category[];
  summary: BudgetSummary;
}

export const ASSISTANT_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "query_expenses",
      description:
        "按条件查询消费明细，返回匹配的记录（按需排序）。用于「上个月在日本吃的最贵的一顿」这类具体问题。",
      parameters: {
        type: "object",
        properties: {
          from: { type: "string", description: "起始日期 YYYY-MM-DD（含）。相对时间要自己换算好再传。" },
          to: { type: "string", description: "结束日期 YYYY-MM-DD（含）" },
          legName: { type: "string", description: "行程分段名称或国家，如「巴黎」「日本」" },
          categoryKey: { type: "string", description: "分类 key，如 food / transport / lodging / shopping" },
          merchant: { type: "string", description: "商家名关键词" },
          currency: { type: "string", description: "币种，如 JPY" },
          minAmount: { type: "number", description: "原币金额下限" },
          maxAmount: { type: "number", description: "原币金额上限" },
          sort: {
            type: "string",
            enum: ["recent", "amount_desc", "amount_asc"],
            description: "排序方式，默认 recent",
          },
          limit: { type: "integer", description: "返回条数，默认 10，最大 30" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "aggregate_expenses",
      description: "按维度汇总消费金额，用于「餐饮花了多少」「哪个国家花得最多」这类问题。",
      parameters: {
        type: "object",
        properties: {
          groupBy: { type: "string", enum: ["category", "currency", "leg", "day"] },
          from: { type: "string", description: "起始日期 YYYY-MM-DD" },
          to: { type: "string", description: "结束日期 YYYY-MM-DD" },
          categoryKey: { type: "string", description: "只看某个分类" },
          legName: { type: "string", description: "只看某个行程分段/国家" },
        },
        required: ["groupBy"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_budget_summary",
      description:
        "获取当前预算、已花、剩余、日均、健康日均、预计超支、分段进度等确定性数字。做「如果…会怎样」推演前先调用它。",
      parameters: { type: "object", properties: {} },
    },
  },
];

function safeJson(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

function resolveLegIds(query: string | undefined, legs: TripLeg[]): Set<string> | null {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return null;
  const ids = new Set<string>();
  const preset = COUNTRY_PRESETS.find((c) => c.name.includes(q) || q.includes(c.name));
  for (const leg of legs) {
    const haystack = `${leg.name} ${leg.countryCode ?? ""}`.toLowerCase();
    if (haystack.includes(q) || (preset && leg.countryCode === preset.code)) ids.add(leg.id);
  }
  return ids;
}

function toRow(e: Expense, ctx: ToolContext) {
  const leg = legForDate(ctx.legs, e.spentOn);
  return {
    date: e.spentOn,
    amount: e.amount,
    currency: e.currency,
    base: e.baseAmount,
    category: e.categoryKey ?? "other",
    merchant: e.merchant ? e.merchant.slice(0, 40) : null,
    leg: leg?.name ?? null,
    note: e.note ? e.note.slice(0, 40) : null,
  };
}

async function loadFiltered(args: Record<string, unknown>, ctx: ToolContext): Promise<Expense[]> {
  const rows = await ctx.repo.listExpenses(ctx.trip.id);
  const from = typeof args.from === "string" ? args.from : null;
  const to = typeof args.to === "string" ? args.to : null;
  const legIds = resolveLegIds(typeof args.legName === "string" ? args.legName : undefined, ctx.legs);
  const categoryKey = typeof args.categoryKey === "string" ? args.categoryKey : null;
  const merchant = typeof args.merchant === "string" ? args.merchant.toLowerCase() : null;
  const currency = typeof args.currency === "string" ? args.currency.toUpperCase() : null;
  const minAmount = typeof args.minAmount === "number" ? args.minAmount : null;
  const maxAmount = typeof args.maxAmount === "number" ? args.maxAmount : null;

  return rows.filter((e) => {
    if (from && e.spentOn < from) return false;
    if (to && e.spentOn > to) return false;
    if (legIds && !legIds.has(legForDate(ctx.legs, e.spentOn)?.id ?? "")) return false;
    if (categoryKey && (e.categoryKey ?? "other") !== categoryKey) return false;
    if (merchant && !(e.merchant ?? "").toLowerCase().includes(merchant)) return false;
    if (currency && e.currency.toUpperCase() !== currency) return false;
    if (minAmount !== null && e.amount < minAmount) return false;
    if (maxAmount !== null && e.amount > maxAmount) return false;
    return true;
  });
}

async function queryExpenses(args: Record<string, unknown>, ctx: ToolContext) {
  const rows = await loadFiltered(args, ctx);
  const sort = args.sort === "amount_desc" || args.sort === "amount_asc" ? args.sort : "recent";
  const limit = Math.min(Math.max(Number(args.limit) || 10, 1), 30);

  const sorted = [...rows].sort((a, b) => {
    if (sort === "amount_desc") return b.baseAmount - a.baseAmount;
    if (sort === "amount_asc") return a.baseAmount - b.baseAmount;
    return `${b.spentOn}${b.spentAt}`.localeCompare(`${a.spentOn}${a.spentAt}`);
  });

  return {
    matched: rows.length,
    returned: Math.min(rows.length, limit),
    totalBase: roundMoney(rows.reduce((s, e) => s + e.baseAmount, 0), ctx.summary.baseCurrency),
    baseCurrency: ctx.summary.baseCurrency,
    sort,
    rows: sorted.slice(0, limit).map((e) => toRow(e, ctx)),
  };
}

async function aggregateExpenses(args: Record<string, unknown>, ctx: ToolContext) {
  const rows = await loadFiltered(args, ctx);
  const groupBy = String(args.groupBy ?? "category");
  const base = ctx.summary.baseCurrency;
  const catName = new Map(ctx.categories.map((c) => [c.key, c.name]));
  const buckets = new Map<string, { label: string; amount: number; count: number }>();

  for (const e of rows) {
    let key: string;
    let label: string;
    if (groupBy === "currency") {
      key = e.currency.toUpperCase();
      label = key;
    } else if (groupBy === "leg") {
      const leg = legForDate(ctx.legs, e.spentOn);
      key = leg?.id ?? "none";
      label = leg ? `${leg.name}(${leg.currency})` : "未归属分段";
    } else if (groupBy === "day") {
      key = e.spentOn;
      label = e.spentOn;
    } else {
      key = e.categoryKey ?? "other";
      label = catName.get(key) ?? key;
    }
    const acc = buckets.get(key) ?? { label, amount: 0, count: 0 };
    acc.amount += e.baseAmount;
    acc.count += 1;
    buckets.set(key, acc);
  }

  const total = rows.reduce((s, e) => s + e.baseAmount, 0);
  return {
    groupBy,
    baseCurrency: base,
    total: roundMoney(total, base),
    groups: Array.from(buckets.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 20)
      .map((g) => ({
        label: g.label,
        amount: roundMoney(g.amount, base),
        count: g.count,
        share: total > 0 ? Math.round((g.amount / total) * 1000) / 1000 : 0,
      })),
  };
}

function budgetSummaryPayload(ctx: ToolContext) {
  const s = ctx.summary;
  const base = s.baseCurrency;
  return {
    baseCurrency: base,
    daysTotal: s.daysTotal,
    daysElapsed: s.daysElapsed,
    daysRemaining: s.daysRemaining,
    totalBudget: s.totalBudget,
    spent: s.spent,
    remaining: s.remaining,
    utilization: Math.round(s.utilization * 1000) / 1000,
    actualDaily: s.actualDaily,
    allowedDaily: s.allowedDaily,
    projectedTotal: s.projectedTotal,
    projectedOverrun: s.projectedOverrun,
    health: s.health,
    todaySpent: s.todaySpent,
    budgets: s.budgetByCurrency.map((b) => ({
      currency: b.currency,
      amount: b.amount,
      amountBase: b.amountBase,
      consumedRatio: Math.round(b.consumedRatio * 1000) / 1000,
    })),
    legs: s.byLeg.map((l) => ({
      name: l.name,
      currency: l.currency,
      days: l.days,
      spent: l.spent,
      referenceAllowance: l.referenceAllowance,
      utilization: Math.round(l.utilization * 1000) / 1000,
      isActive: l.isActive,
    })),
    topCategories: s.byCategory.slice(0, 6).map((c) => ({
      name: c.name,
      amount: c.amount,
      share: Math.round(c.share * 1000) / 1000,
    })),
    formatted: {
      remaining: formatMoney(s.remaining, base),
      allowedDaily: formatMoney(s.allowedDaily, base),
      actualDaily: formatMoney(s.actualDaily, base),
      projectedTotal: formatMoney(s.projectedTotal, base),
      projectedOverrun: formatMoney(s.projectedOverrun, base),
    },
  };
}

export async function executeTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<unknown> {
  const args = safeJson(rawArgs);
  try {
    switch (name) {
      case "query_expenses":
        return await queryExpenses(args, ctx);
      case "aggregate_expenses":
        return await aggregateExpenses(args, ctx);
      case "get_budget_summary":
        return budgetSummaryPayload(ctx);
      default:
        return { error: `未知工具：${name}` };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : "工具执行失败" };
  }
}

/** 给 UI 用的一句话摘要 */
export function summarizeToolResult(name: string, result: unknown): string {
  const r = result as Record<string, unknown>;
  if (name === "query_expenses") return `查到 ${r.matched ?? 0} 笔，返回 ${r.returned ?? 0} 条`;
  if (name === "aggregate_expenses") {
    const groups = Array.isArray(r.groups) ? r.groups.length : 0;
    return `汇总 ${groups} 组`;
  }
  if (name === "get_budget_summary") return "读取预算概览";
  return "完成";
}

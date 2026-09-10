import { beforeEach, describe, expect, it } from "vitest";
import { buildBudgetSummary } from "../budget";
import { MemoryRepo, resetMemoryStore } from "../db/memory";
import { executeTool, summarizeToolResult, type ToolContext } from "./tools";

/** 用内存演示数据（伦敦/巴黎/苏黎世三段）验证工具确实查的是真实数据 */
async function makeContext(): Promise<ToolContext> {
  const repo = new MemoryRepo();
  const [trip] = await repo.listTrips();
  const [legs, categories, budgets, expenses] = await Promise.all([
    repo.listLegs(trip.id),
    repo.listCategories(),
    repo.listBudgets(trip.id),
    repo.listExpenses(trip.id),
  ]);
  const summary = buildBudgetSummary({
    trip,
    budgets,
    expenses,
    rates: { GBP: 9.15, EUR: 7.75, CHF: 8.1, CNY: 1 },
    legs,
    categories: categories.map((c) => ({ key: c.key, name: c.name, emoji: c.emoji, color: c.color })),
    today: trip.startDate,
  });
  return { repo, trip, legs, categories, summary };
}

describe("助手工具", () => {
  let ctx: ToolContext;

  beforeEach(async () => {
    resetMemoryStore();
    ctx = await makeContext();
  });

  it("按分段/国家过滤消费明细", async () => {
    const paris = (await executeTool("query_expenses", { legName: "巴黎" }, ctx)) as {
      rows: Array<{ leg: string }>;
      matched: number;
    };
    // 种子只落了巴黎段已过去的第 1 天（Eurostar + Le Marais）
    expect(paris.matched).toBe(2);
    expect(paris.rows.every((r) => r.leg === "巴黎")).toBe(true);

    // 用中文国家名也能命中（巴黎 → FR）
    const france = (await executeTool("query_expenses", { legName: "法国" }, ctx)) as {
      matched: number;
    };
    expect(france.matched).toBe(2);
  });

  it("按金额倒序取最贵的一笔", async () => {
    const result = (await executeTool(
      "query_expenses",
      { sort: "amount_desc", limit: 1 },
      ctx,
    )) as { rows: Array<{ amount: number; currency: string }> };
    expect(result.rows).toHaveLength(1);
    // 按基准币（CNY）排序：260 GBP ≈ ¥2379 高于 210 CHF ≈ ¥1701
    expect(result.rows[0].amount).toBe(260);
    expect(result.rows[0].currency).toBe("GBP");
  });

  it("按分类过滤 + 日期过滤", async () => {
    const [trip] = await ctx.repo.listTrips();
    const legs = ctx.legs;
    const london = legs.find((l) => l.name === "伦敦")!;
    const result = (await executeTool(
      "query_expenses",
      { categoryKey: "food", from: london.startDate, to: london.endDate },
      ctx,
    )) as { rows: Array<{ currency: string }> };
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.every((r) => r.currency === "GBP")).toBe(true);
    expect(trip.id).toBeTruthy();
  });

  it("按分段汇总", async () => {
    const result = (await executeTool(
      "aggregate_expenses",
      { groupBy: "leg" },
      ctx,
    )) as { groups: Array<{ label: string; amount: number }>; total: number };
    // 苏黎世段还没开始，没有消费就不会出现在分组里
    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.label.split("(")[0])).toEqual(["伦敦", "巴黎"]);
    // 各组之和等于总额（允许两位小数的舍入差）
    const sum = result.groups.reduce((s, g) => s + g.amount, 0);
    expect(Math.abs(sum - result.total)).toBeLessThan(0.05);
  });

  it("按分类汇总的占比之和约为 1", async () => {
    const result = (await executeTool(
      "aggregate_expenses",
      { groupBy: "category" },
      ctx,
    )) as { groups: Array<{ share: number }> };
    const total = result.groups.reduce((s, g) => s + g.share, 0);
    expect(total).toBeCloseTo(1, 1);
  });

  it("预算概览返回确定性数字", async () => {
    const result = (await executeTool("get_budget_summary", {}, ctx)) as {
      remaining: number;
      spent: number;
      totalBudget: number;
      legs: unknown[];
    };
    expect(result.totalBudget).toBe(ctx.summary.totalBudget);
    expect(result.spent).toBe(ctx.summary.spent);
    expect(result.remaining).toBe(ctx.summary.remaining);
    expect(result.legs).toHaveLength(3);
  });

  it("未知工具不会抛错，而是返回 error", async () => {
    const result = (await executeTool("nope", {}, ctx)) as { error?: string };
    expect(result.error).toContain("未知工具");
  });

  it("工具结果摘要给 UI 用", async () => {
    const result = await executeTool("query_expenses", { limit: 3 }, ctx);
    expect(summarizeToolResult("query_expenses", result)).toContain("查到");
  });
});

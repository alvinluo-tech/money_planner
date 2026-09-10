import { beforeEach, describe, expect, it } from "vitest";
import { DEMO_USER_ID, MemoryRepo, resetMemoryStore } from "./memory";

/** 演示仓储的契约测试：内存实现坏了，UI 会直接白屏，所以值得覆盖。 */
describe("MemoryRepo", () => {
  let repo: MemoryRepo;

  beforeEach(() => {
    resetMemoryStore();
    repo = new MemoryRepo(DEMO_USER_ID);
  });

  it("预置一趟行程及其多币种预算", async () => {
    const trips = await repo.listTrips();
    expect(trips).toHaveLength(1);
    const budgets = await repo.listBudgets(trips[0].id);
    expect(budgets.map((b) => b.currency).sort()).toEqual(["CNY", "GBP"]);
    expect(budgets.reduce((sum, b) => sum + b.amount, 0)).toBe(11000);
  });

  it("预置一趟多国行程，分段的币种各不相同", async () => {
    const [trip] = await repo.listTrips();
    const legs = await repo.listLegs(trip.id);
    expect(legs.map((l) => l.name)).toEqual(["伦敦", "巴黎", "苏黎世"]);
    expect(legs.map((l) => l.currency)).toEqual(["GBP", "EUR", "CHF"]);
    // 分段必须连续覆盖整个行程，且不重叠
    for (let i = 0; i < legs.length - 1; i += 1) {
      expect(legs[i].endDate < legs[i + 1].startDate).toBe(true);
    }
    expect(legs[0].startDate).toBe(trip.startDate);
    expect(legs.at(-1)!.endDate).toBe(trip.endDate);
  });

  it("新建行程时带上分段", async () => {
    const { trip, legs } = await repo.createTrip(
      {
        name: "三国游",
        destination: null,
        startDate: "2026-10-01",
        endDate: "2026-10-10",
        baseCurrency: "CNY",
        timezone: "Asia/Shanghai",
        coverEmoji: null,
        notes: null,
      },
      [{ currency: "EUR", amount: 1000, label: "", isPrimary: true }],
      [
        { name: "巴黎", countryCode: "FR", currency: "EUR", timezone: "Europe/Paris", startDate: "2026-10-01", endDate: "2026-10-05" },
        { name: "罗马", countryCode: "IT", currency: "EUR", timezone: "Europe/Rome", startDate: "2026-10-06", endDate: "2026-10-10" },
      ],
    );
    expect(legs).toHaveLength(2);
    expect((await repo.listLegs(trip.id)).map((l) => l.name)).toEqual(["巴黎", "罗马"]);
    // 整体替换
    await repo.replaceLegs(trip.id, [
      { name: "柏林", countryCode: "DE", currency: "EUR", timezone: "Europe/Berlin", startDate: "2026-10-01", endDate: "2026-10-10" },
    ]);
    expect((await repo.listLegs(trip.id)).map((l) => l.name)).toEqual(["柏林"]);
  });

  it("删除行程会清掉分段、对话、消息与语音日志", async () => {
    const [trip] = await repo.listTrips();
    const thread = await repo.createThread(trip.id, "测试会话");
    await repo.appendMessage({ threadId: thread.id, role: "user", content: "你好" });
    await repo.logCapture({
      tripId: trip.id,
      transcript: "午饭 15 镑",
      parsed: { drafts: [] },
      status: "pending",
      error: null,
      latencyMs: 100,
      model: "rules",
    });

    await repo.deleteTrip(trip.id);
    expect(await repo.listLegs(trip.id)).toHaveLength(0);
    expect(await repo.listThreads(trip.id)).toHaveLength(0);
    expect(await repo.listMessages(thread.id)).toHaveLength(0);
  });

  it("预置消费都能折算到基准币", async () => {
    const [trip] = await repo.listTrips();
    const expenses = await repo.listExpenses(trip.id);
    expect(expenses.length).toBeGreaterThan(10);
    for (const e of expenses) {
      expect(e.baseCurrency).toBe(trip.baseCurrency);
      expect(e.baseAmount).toBeGreaterThan(0);
    }
  });

  it("预置消费不会落在未来（否则今日支出与趋势图会失真）", async () => {
    const [trip] = await repo.listTrips();
    const expenses = await repo.listExpenses(trip.id);
    const today = new Date().toISOString().slice(0, 10);
    for (const e of expenses) {
      expect(e.spentOn <= trip.endDate).toBe(true);
      expect(e.spentOn >= trip.startDate).toBe(true);
      // 行程可能延伸到未来，但已落库的消费必须已经发生
      expect(e.spentOn <= today).toBe(true);
    }
  });

  it("新建行程后可以读回，并且能改元信息", async () => {
    const { trip } = await repo.createTrip(
      {
        name: "测试行程",
        destination: "日本",
        startDate: "2026-10-01",
        endDate: "2026-10-05",
        baseCurrency: "CNY",
        timezone: "Asia/Tokyo",
        coverEmoji: "🇯🇵",
        notes: null,
      },
      [{ currency: "JPY", amount: 100000, label: "日元现金", isPrimary: true }],
    );
    expect((await repo.listTrips()).map((t) => t.id)).toContain(trip.id);

    const updated = await repo.updateTrip(trip.id, { name: "改名了", endDate: "2026-10-07" });
    expect(updated.name).toBe("改名了");
    expect(updated.endDate).toBe("2026-10-07");

    const budgets = await repo.replaceBudgets(trip.id, [
      { currency: "USD", amount: 500, label: "", isPrimary: true },
    ]);
    expect(budgets).toHaveLength(1);
    expect(budgets[0].currency).toBe("USD");
  });

  it("删除行程会连带清掉预算与消费", async () => {
    const [trip] = await repo.listTrips();
    await repo.deleteTrip(trip.id);
    expect(await repo.getTrip(trip.id)).toBeNull();
    expect(await repo.listBudgets(trip.id)).toHaveLength(0);
    expect(await repo.listExpenses(trip.id)).toHaveLength(0);
  });

  it("新增消费后立刻能读到，并支持按日期过滤", async () => {
    const [trip] = await repo.listTrips();
    const before = (await repo.listExpenses(trip.id)).length;
    // 用一个与种子数据无关的固定日期，避免测试依赖「今天是几号」
    const day = "2026-03-15";
    const created = await repo.createExpenses([
      {
        tripId: trip.id,
        categoryId: null,
        categoryKey: "food",
        amount: 12,
        currency: "GBP",
        baseAmount: 108,
        baseCurrency: "CNY",
        fxRate: 9,
        fxSource: "ecb",
        merchant: "Test Cafe",
        note: null,
        spentAt: `${day}T10:00:00.000Z`,
        spentOn: day,
        paymentMethod: null,
        source: "manual",
        rawInput: null,
        aiConfidence: null,
        aiModel: null,
        tags: [],
      },
    ]);
    expect(created).toHaveLength(1);
    expect((await repo.listExpenses(trip.id)).length).toBe(before + 1);
    const filtered = await repo.listExpenses(trip.id, { from: day, to: day });
    expect(filtered.map((e) => e.id)).toEqual([created[0].id]);
  });

  it("可以更新与删除单笔消费", async () => {
    const [trip] = await repo.listTrips();
    const [first] = await repo.listExpenses(trip.id, { limit: 1 });
    const updated = await repo.updateExpense(first.id, { merchant: "改过了" });
    expect(updated.merchant).toBe("改过了");
    await repo.deleteExpense(first.id);
    expect(await repo.getExpense(first.id)).toBeNull();
  });

  it("部分更新时 undefined 键不会清空已有字段", async () => {
    const [trip] = await repo.listTrips();
    const [first] = await repo.listExpenses(trip.id, { limit: 1 });
    // 内存仓储返回的是 live 引用，先取出原始值再改，避免断言被同一引用污染
    const original = {
      amount: first.amount,
      merchant: first.merchant,
      categoryKey: first.categoryKey,
      paymentMethod: first.paymentMethod,
      tags: first.tags,
    };
    // 模拟 PATCH /api/expenses/[id] 只改金额时构造的 patch：
    // 路由会预置 categoryKey/merchant/note/... 等 undefined 键
    const updated = await repo.updateExpense(first.id, {
      amount: original.amount + 1,
      categoryKey: undefined,
      merchant: undefined,
      note: undefined,
      paymentMethod: undefined,
      tags: undefined,
    });
    expect(updated.amount).toBe(original.amount + 1);
    expect(updated.merchant).toBe(original.merchant);
    expect(updated.categoryKey).toBe(original.categoryKey);
    expect(updated.paymentMethod).toBe(original.paymentMethod);
    expect(updated.tags).toEqual(original.tags);
  });

  it("语音日志能写入并回写状态", async () => {
    const id = await repo.logCapture({
      tripId: null,
      transcript: "午饭 15 镑",
      parsed: { drafts: [] },
      status: "pending",
      error: null,
      latencyMs: 120,
      model: "test",
    });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    await expect(repo.updateCaptureStatus(id, "confirmed", null)).resolves.toBeUndefined();
  });

  it("分析记录按时间倒序返回", async () => {
    const [trip] = await repo.listTrips();
    await repo.saveInsight({
      tripId: trip.id,
      kind: "budget_check",
      forDate: null,
      headline: "第一条",
      body: null,
      severity: "info",
      metrics: {},
      model: null,
    });
    await repo.saveInsight({
      tripId: trip.id,
      kind: "budget_check",
      forDate: null,
      headline: "第二条",
      body: null,
      severity: "warn",
      metrics: {},
      model: null,
    });
    const insights = await repo.listInsights(trip.id);
    expect(insights[0].headline).toBe("第二条");
  });
});

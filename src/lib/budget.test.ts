import { describe, expect, it } from "vitest";
import { buildBudgetSummary, IDEAL_CATEGORY_SHARE } from "./budget";
import type { Expense, TripLeg } from "./types";

function expense(partial: Partial<Expense> & { amount: number; currency: string; baseAmount: number; categoryKey: string; spentOn: string }): Expense {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    userId: "u1",
    tripId: "t1",
    categoryId: null,
    categoryKey: partial.categoryKey,
    amount: partial.amount,
    currency: partial.currency,
    baseAmount: partial.baseAmount,
    baseCurrency: "CNY",
    fxRate: partial.amount === 0 ? 1 : partial.baseAmount / partial.amount,
    fxSource: "ecb",
    merchant: partial.merchant ?? null,
    note: null,
    spentAt: `${partial.spentOn}T12:00:00.000Z`,
    spentOn: partial.spentOn,
    paymentMethod: null,
    source: "manual",
    rawInput: null,
    aiConfidence: null,
    aiModel: null,
    tags: [],
    createdAt: `${partial.spentOn}T12:00:00.000Z`,
  };
}

const trip = { startDate: "2026-09-01", endDate: "2026-09-13", baseCurrency: "CNY" };
const budgets = [
  { currency: "GBP", amount: 1000, label: "英镑现金" },
  { currency: "CNY", amount: 10000, label: "人民币备用" },
];
// 1 GBP = 9 CNY
const rates = { GBP: 9, CNY: 1 };

describe("buildBudgetSummary", () => {
  it("把多币种预算折算成基准币", () => {
    const s = buildBudgetSummary({ trip, budgets, expenses: [], rates, today: "2026-09-01" });
    expect(s.totalBudget).toBe(19000);
    expect(s.daysTotal).toBe(13);
    expect(s.spent).toBe(0);
    expect(s.remaining).toBe(19000);
  });

  it("计算已过天数、健康日均与剩余天数", () => {
    const expenses = [
      expense({ amount: 100, currency: "GBP", baseAmount: 900, categoryKey: "food", spentOn: "2026-09-01" }),
      expense({ amount: 1000, currency: "CNY", baseAmount: 1000, categoryKey: "transport", spentOn: "2026-09-02" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-05" });
    expect(s.daysElapsed).toBe(5);
    expect(s.daysRemaining).toBe(9);
    expect(s.spent).toBe(1900);
    expect(s.actualDaily).toBe(380);
    expect(s.allowedDaily).toBe(Math.round((19000 - 1900) / 9));
    expect(s.health).toBe("on_track");
  });

  it("消费过快时判定为有风险并给出预计超支", () => {
    const expenses = Array.from({ length: 5 }, (_, i) =>
      expense({ amount: 3000, currency: "CNY", baseAmount: 3000, categoryKey: "shopping", spentOn: `2026-09-0${i + 1}` }),
    );
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-05" });
    expect(s.spent).toBe(15000);
    expect(s.projectedOverrun).toBeGreaterThan(0);
    expect(s.health).toBe("at_risk");
    expect(s.alerts.some((a) => a.level === "critical")).toBe(true);
  });

  it("已经花超时判定为 over_budget 且剩余为负", () => {
    const expenses = [
      expense({ amount: 20000, currency: "CNY", baseAmount: 20000, categoryKey: "lodging", spentOn: "2026-09-02" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-03" });
    expect(s.remaining).toBe(-1000);
    expect(s.health).toBe("over_budget");
    expect(s.alerts[0].level).toBe("critical");
  });

  it("冻结历史汇率：优先使用落库时的 baseAmount", () => {
    const expenses = [
      expense({ amount: 100, currency: "GBP", baseAmount: 850, categoryKey: "food", spentOn: "2026-09-01" }),
    ];
    // 即使当前汇率变成 9.5，历史金额仍按 850 计算
    const s = buildBudgetSummary({ trip, budgets, expenses, rates: { GBP: 9.5, CNY: 1 }, today: "2026-09-02" });
    expect(s.spent).toBe(850);
  });

  it("标记超出参考占比的分类", () => {
    const expenses = [
      expense({ amount: 6000, currency: "CNY", baseAmount: 6000, categoryKey: "shopping", spentOn: "2026-09-01" }),
      expense({ amount: 2000, currency: "CNY", baseAmount: 2000, categoryKey: "food", spentOn: "2026-09-01" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-02" });
    const shopping = s.byCategory.find((c) => c.categoryKey === "shopping");
    expect(shopping?.share).toBeCloseTo(0.75, 2);
    expect(shopping?.overIndex).toBe(true);
    expect(IDEAL_CATEGORY_SHARE.shopping).toBe(0.1);
  });

  it("逐日累计与计划额度可对齐", () => {
    const expenses = [
      expense({ amount: 900, currency: "CNY", baseAmount: 900, categoryKey: "food", spentOn: "2026-09-03" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-03" });
    expect(s.byDay).toHaveLength(13);
    expect(s.byDay[0].cumulative).toBe(0);
    expect(s.byDay[2].cumulative).toBe(900);
    expect(s.byDay[12].allowed).toBe(19000);
  });

  it("超支提醒里引用的是真实已花金额，而不是预算总额", () => {
    const expenses = [
      expense({ amount: 20000, currency: "CNY", baseAmount: 20000, categoryKey: "lodging", spentOn: "2026-09-02" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-03" });
    const alert = s.alerts.find((a) => a.title.startsWith("已超支"));
    expect(alert).toBeDefined();
    expect(alert!.detail).toContain("已花 ¥20,000");
  });

  it("轻微超支只给 warn，明显超支才是 critical", () => {
    // 已花 2000，日均 1000，剩余 11 天 → 预计 13000，仍在预算内
    const mild = buildBudgetSummary({
      trip,
      budgets,
      expenses: [
        expense({ amount: 2000, currency: "CNY", baseAmount: 2000, categoryKey: "food", spentOn: "2026-09-01" }),
      ],
      rates,
      today: "2026-09-02",
    });
    expect(mild.alerts.some((a) => a.level === "critical")).toBe(false);

    // 预计超支比例很小（<10%）时应该是 warn 而不是 critical
    // 首日花 1500，日均 1500 × 13 天 = 19500，超预算 500（2.6%）
    const slightlyOver = buildBudgetSummary({
      trip,
      budgets,
      expenses: [
        expense({ amount: 1500, currency: "CNY", baseAmount: 1500, categoryKey: "lodging", spentOn: "2026-09-01" }),
      ],
      rates,
      today: "2026-09-01",
    });
    expect(slightlyOver.remaining).toBeGreaterThan(0);
    expect(slightlyOver.projectedOverrun).toBeGreaterThan(0);
    expect(slightlyOver.alerts.find((a) => a.title.startsWith("按当前节奏"))?.level).toBe("warn");
  });

  it("todaySpent 和 yesterdaySpent 严格跟随传入的 today 日期", () => {
    const expenses = [
      expense({ amount: 500, currency: "CNY", baseAmount: 500, categoryKey: "food", spentOn: "2026-09-04" }),
      expense({ amount: 800, currency: "CNY", baseAmount: 800, categoryKey: "shopping", spentOn: "2026-09-05" }),
    ];
    // 今天是 09-05
    const during = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-05" });
    expect(during.todaySpent).toBe(800);
    expect(during.yesterdaySpent).toBe(500);

    // 行程已结束（如 09-20），今天与昨天均无消费，不应把行程最后一天强行作为今日支出
    const ended = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-20" });
    expect(ended.todaySpent).toBe(0);
    expect(ended.yesterdaySpent).toBe(0);
    expect(ended.daysRemaining).toBe(0);
    expect(ended.projectedTotal).toBe(ended.spent);
    expect(ended.alerts.some((a) => a.title.startsWith("按当前节奏"))).toBe(false);
  });

  it("把消费归到对应分段，参考额度按天数占比", () => {
    const legs: TripLeg[] = [
      { id: "l1", tripId: "t1", seq: 0, name: "伦敦", countryCode: "GB", currency: "GBP", timezone: "Europe/London", startDate: "2026-09-01", endDate: "2026-09-05" },
      { id: "l2", tripId: "t1", seq: 1, name: "巴黎", countryCode: "FR", currency: "EUR", timezone: "Europe/Paris", startDate: "2026-09-06", endDate: "2026-09-13" },
    ];
    const expenses = [
      expense({ amount: 5000, currency: "CNY", baseAmount: 5000, categoryKey: "lodging", spentOn: "2026-09-02" }),
      expense({ amount: 3000, currency: "CNY", baseAmount: 3000, categoryKey: "food", spentOn: "2026-09-08" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, legs, today: "2026-09-08" });

    expect(s.byLeg).toHaveLength(2);
    const [london, paris] = s.byLeg;
    expect(london.name).toBe("伦敦");
    expect(london.days).toBe(5);
    expect(london.spent).toBe(5000);
    // 19000 × 5/13 ≈ 7307.69（金额按币种小数位保留两位）
    expect(london.referenceAllowance).toBeCloseTo((19000 * 5) / 13, 2);
    expect(london.status).toBe("on_track");
    expect(paris.spent).toBe(3000);
    expect(paris.days).toBe(8);
    expect(s.activeLegId).toBe("l2");
    expect(paris.isActive).toBe(true);
    expect(london.isActive).toBe(false);
  });

  it("分段只是视图，不影响总预算/总支出", () => {
    const legs: TripLeg[] = [
      { id: "l1", tripId: "t1", seq: 0, name: "伦敦", currency: "GBP", countryCode: null, timezone: "Europe/London", startDate: "2026-09-01", endDate: "2026-09-13" },
    ];
    const expenses = [
      expense({ amount: 900, currency: "CNY", baseAmount: 900, categoryKey: "food", spentOn: "2026-09-03" }),
    ];
    const without = buildBudgetSummary({ trip, budgets, expenses, rates, today: "2026-09-03" });
    const with_ = buildBudgetSummary({ trip, budgets, expenses, rates, legs, today: "2026-09-03" });
    expect(with_.spent).toBe(without.spent);
    expect(with_.totalBudget).toBe(without.totalBudget);
    expect(with_.projectedTotal).toBe(without.projectedTotal);
    expect(without.byLeg).toEqual([]);
    expect(without.activeLegId).toBeNull();
  });

  it("某一段明显超出参考额度时给出分段提醒", () => {
    const legs: TripLeg[] = [
      { id: "l1", tripId: "t1", seq: 0, name: "伦敦", currency: "GBP", countryCode: null, timezone: "Europe/London", startDate: "2026-09-01", endDate: "2026-09-05" },
      { id: "l2", tripId: "t1", seq: 1, name: "巴黎", currency: "EUR", countryCode: null, timezone: "Europe/Paris", startDate: "2026-09-06", endDate: "2026-09-13" },
    ];
    const expenses = [
      expense({ amount: 12000, currency: "CNY", baseAmount: 12000, categoryKey: "shopping", spentOn: "2026-09-02" }),
    ];
    const s = buildBudgetSummary({ trip, budgets, expenses, rates, legs, today: "2026-09-02" });
    const london = s.byLeg[0];
    expect(london.utilization).toBeGreaterThan(1.15);
    expect(london.status).toBe("over");
    expect(s.alerts.some((a) => a.title.includes("伦敦"))).toBe(true);
  });

  it("记录离线兜底汇率并在提醒中标注", () => {
    const s = buildBudgetSummary({
      trip, budgets, expenses: [], rates, staleRates: ["GBP"], today: "2026-09-01",
    });
    expect(s.staleRates).toEqual(["GBP"]);
    expect(s.alerts.some((a) => a.title.includes("离线"))).toBe(true);
  });

  it("支持酒店按入住天数平摊到各天的 byDay 统计", () => {
    const hotelExpense: Expense = {
      ...expense({ amount: 910, currency: "CNY", baseAmount: 910, categoryKey: "lodging", spentOn: "2026-09-02" }),
      tags: ["stay:2026-09-02~2026-09-04"], // 2晚
    };
    const coffeeExpense = expense({ amount: 50, currency: "CNY", baseAmount: 50, categoryKey: "food", spentOn: "2026-09-02" });

    const s = buildBudgetSummary({
      trip,
      budgets,
      expenses: [hotelExpense, coffeeExpense],
      rates,
      today: "2026-09-02",
    });

    // 910 平摊为每晚 455
    const day2 = s.byDay.find((d) => d.date === "2026-09-02");
    const day3 = s.byDay.find((d) => d.date === "2026-09-03");
    expect(day2?.spent).toBe(505); // 455 + 50
    expect(day3?.spent).toBe(455);
    expect(s.spent).toBe(960); // 总额依旧精确无误

    // 今日纯日常支出排除了酒店，只算咖啡
    expect(s.todayVariableSpent).toBe(50);
    expect(s.todayAmortizedLodging).toBe(455);
  });
});

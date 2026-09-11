import { describe, expect, it } from "vitest";
import { aiPlanTripInputSchema, aiPlanTripOutputSchema, expenseDraftSchema, tripInputSchema } from "./schemas";

describe("币种校验", () => {
  it("接受支持列表内的币种（大小写不敏感）", () => {
    const parsed = expenseDraftSchema.safeParse({ amount: 10, currency: "gbp" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe("GBP");
  });

  it("拒绝不存在的币种，避免按 1:1 静默折算", () => {
    const parsed = expenseDraftSchema.safeParse({ amount: 10, currency: "XYZ" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0].message).toContain("暂不支持");
    }
  });

  it("预算里的币种同样受限", () => {
    const bad = tripInputSchema.safeParse({
      name: "测试",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      budgets: [{ currency: "ABC", amount: 100, label: "" }],
    });
    expect(bad.success).toBe(false);
  });

  it("结束日期早于开始日期会被拒绝", () => {
    const bad = tripInputSchema.safeParse({
      name: "测试",
      startDate: "2026-10-05",
      endDate: "2026-10-01",
      budgets: [{ currency: "CNY", amount: 100, label: "" }],
    });
    expect(bad.success).toBe(false);
  });

  it("金额必须大于 0", () => {
    expect(expenseDraftSchema.safeParse({ amount: 0, currency: "CNY" }).success).toBe(false);
    expect(expenseDraftSchema.safeParse({ amount: -5, currency: "CNY" }).success).toBe(false);
  });

  it("同一币种下若有多个预算项，标签重复会被拒绝（防止破坏数据库唯一约束）", () => {
    const duplicate = tripInputSchema.safeParse({
      name: "英国游",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      budgets: [
        { currency: "GBP", amount: 1000, label: "" },
        { currency: "GBP", amount: 500, label: "" },
      ],
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.issues[0].message).toContain("不同的标签");
    }

    const duplicateWithLabel = tripInputSchema.safeParse({
      name: "英国游",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      budgets: [
        { currency: "GBP", amount: 1000, label: "现金" },
        { currency: "GBP", amount: 500, label: "现金" },
      ],
    });
    expect(duplicateWithLabel.success).toBe(false);

    const valid = tripInputSchema.safeParse({
      name: "英国游",
      startDate: "2026-10-01",
      endDate: "2026-10-10",
      budgets: [
        { currency: "GBP", amount: 1000, label: "现金" },
        { currency: "GBP", amount: 500, label: "刷卡" },
      ],
    });
    expect(valid.success).toBe(true);
  });

  it("AI规划行程输入与输出校验", () => {
    const emptyInput = aiPlanTripInputSchema.safeParse({ prompt: "  " });
    expect(emptyInput.success).toBe(false);

    const validPlan = aiPlanTripOutputSchema.safeParse({
      name: "日本关西枫叶季",
      destination: "日本 · 京都",
      coverEmoji: "🇯🇵",
      startDate: "2026-11-01",
      endDate: "2026-11-07",
      baseCurrency: "CNY",
      budgets: [
        { currency: "jpy", amount: "150000", label: "日元刷卡" },
        { currency: "cny", amount: 3000, label: "备用" },
      ],
      legs: [
        {
          name: "京都",
          countryCode: "jp",
          currency: "jpy",
          timezone: "Asia/Tokyo",
          startDate: "2026-11-01",
          endDate: "2026-11-07",
        },
      ],
      suggestion: "秋季京都红叶旺季，建议多预留现金。",
    });
    expect(validPlan.success).toBe(true);
    if (validPlan.success) {
      expect(validPlan.data.budgets[0].currency).toBe("JPY");
      expect(validPlan.data.budgets[0].amount).toBe(150000);
      expect(validPlan.data.legs?.[0].countryCode).toBe("JP");
    }
  });
});

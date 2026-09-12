import { describe, expect, it } from "vitest";
import { fallbackTripPlan } from "./trip-planner";

describe("trip-planner multi-currency fallback", () => {
  it("正确识别多种货币组合预算（如 10000rmb + 1500英镑）", () => {
    const plan = fallbackTripPlan("法国意大利9日游，预算10000rmb 1500英镑这样", "2026-09-12");

    expect(plan.destination).toBe("法国 · 意大利");
    expect(plan.baseCurrency).toBe("GBP");
    expect(plan.budgets).toEqual([
      { currency: "GBP", amount: 1500, label: "英镑预算" },
      { currency: "CNY", amount: 10000, label: "人民币备用" },
    ]);
    expect(plan.legs).toEqual([]);
  });

  it("纯英镑预算并设定 GBP 为主结算币", () => {
    const plan = fallbackTripPlan("英国伦敦5日游，预算1200英镑", "2026-09-12");

    expect(plan.baseCurrency).toBe("GBP");
    expect(plan.budgets[0]).toEqual({ currency: "GBP", amount: 1200, label: "英镑预算" });
  });
});

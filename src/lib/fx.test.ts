import { describe, expect, it } from "vitest";
import { fallbackQuote, fallbackRate, getRate } from "./fx";

/** 汇率兜底必须「要么给出正确值，要么明确表示拿不到」，绝不能静默按 1:1 折算 */
describe("fx fallback", () => {
  it("已知币种可以三角换算到基准币", () => {
    expect(fallbackRate("GBP", "CNY")).toBeGreaterThan(1);
    expect(fallbackRate("CNY", "CNY")).toBe(1);
    expect(fallbackRate("CNY", "GBP")).toBeCloseTo(1 / fallbackRate("GBP", "CNY"), 8);
  });

  it("未知币种返回 0 而不是 1", () => {
    expect(fallbackRate("XXX", "CNY")).toBe(0);
    expect(fallbackRate("CNY", "ZZZ")).toBe(0);
  });

  it("未知币种的兜底报价会标明 unsupported-currency", () => {
    const quote = fallbackQuote("XXX", "CNY");
    expect(quote.rate).toBe(0);
    expect(quote.source).toBe("unsupported-currency");
    expect(quote.stale).toBe(true);
  });

  it("同币种直接返回 1，不需要联网", async () => {
    const quote = await getRate("CNY", "CNY");
    expect(quote.rate).toBe(1);
    expect(quote.source).toBe("same");
  });
});

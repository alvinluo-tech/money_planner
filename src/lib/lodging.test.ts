import { describe, expect, it } from "vitest";
import { formatStayBadge, formatStayTag, getStayDates, parseStayTag } from "./lodging";

describe("lodging utils", () => {
  it("正确格式化与解析 stay tag", () => {
    const tag = formatStayTag("2026-09-12", "2026-09-14");
    expect(tag).toBe("stay:2026-09-12~2026-09-14");

    const parsed = parseStayTag([tag, "other-tag"]);
    expect(parsed).toEqual({
      startDate: "2026-09-12",
      endDate: "2026-09-14",
      nights: 2,
    });
  });

  it("计算入住日期间隔列表（不包含离店日）", () => {
    const stay = { startDate: "2026-09-12", endDate: "2026-09-14", nights: 2 };
    expect(getStayDates(stay)).toEqual(["2026-09-12", "2026-09-13"]);
  });

  it("生成每晚均价与徽章文案", () => {
    const stay = { startDate: "2026-09-12", endDate: "2026-09-14", nights: 2 };
    const badge = formatStayBadge(stay, 910, "EUR");
    expect(badge.label).toBe("2晚 · 455 EUR/晚");
    expect(badge.perNight).toBe(455);
  });
});

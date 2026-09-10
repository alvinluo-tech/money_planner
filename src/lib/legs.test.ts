import { describe, expect, it } from "vitest";
import {
  dateInTimezone,
  describeRoute,
  legForDate,
  legForInstant,
  validateLegs,
} from "./legs";
import type { TripLeg } from "./types";

function leg(partial: Partial<TripLeg> & { id: string; startDate: string; endDate: string }): TripLeg {
  return {
    tripId: "t1",
    seq: 0,
    name: partial.name ?? partial.id,
    countryCode: null,
    currency: "GBP",
    timezone: "Europe/London",
    ...partial,
  };
}

const london = leg({ id: "l1", name: "伦敦", startDate: "2026-09-01", endDate: "2026-09-05" });
const paris = leg({
  id: "l2",
  name: "巴黎",
  currency: "EUR",
  timezone: "Europe/Paris",
  startDate: "2026-09-06",
  endDate: "2026-09-13",
});

describe("legForDate", () => {
  it("按日期归属到正确的分段", () => {
    expect(legForDate([london, paris], "2026-09-02")?.id).toBe("l1");
    expect(legForDate([london, paris], "2026-09-06")?.id).toBe("l2");
  });

  it("不在任何分段内返回 null（由调用方回退到行程级默认值）", () => {
    expect(legForDate([london, paris], "2026-08-20")).toBeNull();
    expect(legForDate([london, paris], "2026-10-01")).toBeNull();
    expect(legForDate([], "2026-09-02")).toBeNull();
  });

  it("转机日（两段共用同一天）归到后一段", () => {
    const transit = leg({ id: "l2", name: "巴黎", startDate: "2026-09-05", endDate: "2026-09-13" });
    expect(legForDate([london, transit], "2026-09-05")?.id).toBe("l2");
  });

  it("顺序打乱也能正确归属", () => {
    expect(legForDate([paris, london], "2026-09-02")?.id).toBe("l1");
  });
});

describe("legForInstant", () => {
  it("按各段自己的时区判断「现在」在哪一段", () => {
    // 2026-09-06T23:30Z：伦敦是 09-07（超出伦敦段），巴黎是 09-07（在巴黎段内）
    const at = new Date("2026-09-06T23:30:00Z");
    expect(legForInstant([london, paris], at)?.id).toBe("l2");
  });

  it("跨时区时日期判定会跟着分段走", () => {
    const at = new Date("2026-09-06T00:30:00Z"); // 伦敦 09-06 00:30 / 巴黎 09-06 02:30
    expect(dateInTimezone("Europe/London", at)).toBe("2026-09-06");
    expect(dateInTimezone("Asia/Tokyo", at)).toBe("2026-09-06");
    const tokyo = leg({
      id: "l3",
      name: "东京",
      currency: "JPY",
      timezone: "Asia/Tokyo",
      startDate: "2026-09-06",
      endDate: "2026-09-10",
    });
    expect(legForInstant([london, tokyo], at)?.id).toBe("l3");
  });
});

describe("validateLegs", () => {
  const base = { currency: "GBP", timezone: "Europe/London" };

  it("合法分段通过", () => {
    const result = validateLegs(
      [
        { ...base, name: "伦敦", startDate: "2026-09-01", endDate: "2026-09-05" },
        { ...base, name: "巴黎", currency: "EUR", timezone: "Europe/Paris", startDate: "2026-09-06", endDate: "2026-09-13" },
      ],
      "2026-09-01",
      "2026-09-13",
    );
    expect(result.ok).toBe(true);
  });

  it("允许首尾相接（转机日）", () => {
    const result = validateLegs(
      [
        { ...base, name: "伦敦", startDate: "2026-09-01", endDate: "2026-09-05" },
        { ...base, name: "巴黎", currency: "EUR", timezone: "Europe/Paris", startDate: "2026-09-05", endDate: "2026-09-13" },
      ],
      "2026-09-01",
      "2026-09-13",
    );
    expect(result.ok).toBe(true);
  });

  it("拒绝重叠、越界、非法币种与时区", () => {
    const overlap = validateLegs(
      [
        { ...base, name: "伦敦", startDate: "2026-09-01", endDate: "2026-09-08" },
        { ...base, name: "巴黎", currency: "EUR", timezone: "Europe/Paris", startDate: "2026-09-06", endDate: "2026-09-13" },
      ],
      "2026-09-01",
      "2026-09-13",
    );
    expect(overlap.ok).toBe(false);
    expect(overlap.errors.join()).toContain("重叠");

    const outOfRange = validateLegs(
      [{ ...base, name: "伦敦", startDate: "2026-08-01", endDate: "2026-09-05" }],
      "2026-09-01",
      "2026-09-13",
    );
    expect(outOfRange.ok).toBe(false);
    expect(outOfRange.errors.join()).toContain("超出");

    const badCurrency = validateLegs(
      [{ ...base, name: "伦敦", currency: "XYZ", startDate: "2026-09-01", endDate: "2026-09-05" }],
      "2026-09-01",
      "2026-09-13",
    );
    expect(badCurrency.ok).toBe(false);

    const badTimezone = validateLegs(
      [{ ...base, name: "伦敦", timezone: "Mars/Olympus", startDate: "2026-09-01", endDate: "2026-09-05" }],
      "2026-09-01",
      "2026-09-13",
    );
    expect(badTimezone.ok).toBe(false);
  });
});

describe("describeRoute", () => {
  it("拼出路线，并合并连续的同一地名", () => {
    expect(describeRoute([london, paris])).toBe("伦敦 → 巴黎");
    expect(describeRoute([london, { ...london, id: "l1b" }, paris])).toBe("伦敦 → 巴黎");
    expect(describeRoute([])).toBe("");
  });
});

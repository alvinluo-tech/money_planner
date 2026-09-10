import { describe, expect, it } from "vitest";
import { cnNumberToArabic, parseCaptureWithRules } from "./rules";

const ctx = {
  defaultCurrency: "GBP",
  baseCurrency: "CNY",
  today: "2026-09-09",
  tripStart: "2026-09-05",
  tripEnd: "2026-09-17",
};

describe("cnNumberToArabic", () => {
  it("解析常见中文数字", () => {
    expect(cnNumberToArabic("十五")).toBe(15);
    expect(cnNumberToArabic("两百")).toBe(200);
    expect(cnNumberToArabic("三十八")).toBe(38);
    expect(cnNumberToArabic("一千")).toBe(1000);
    expect(cnNumberToArabic("十万")).toBe(100000);
  });

  it("纯单位「万」不是数字表达式（×10000 分支对空系数得 0）", () => {
    expect(cnNumberToArabic("万")).toBeNull();
    expect(cnNumberToArabic("千")).toBe(1000);
    expect(cnNumberToArabic("十")).toBe(10);
    expect(cnNumberToArabic("零")).toBe(0);
  });
});

describe("parseCaptureWithRules", () => {
  it("一句话拆成多笔消费", () => {
    const result = parseCaptureWithRules("午饭 15 镑，地铁 3 镑，超市买了 22 磅的菜", ctx);
    expect(result.drafts).toHaveLength(3);
    expect(result.drafts.map((d) => d.amount)).toEqual([15, 3, 22]);
    expect(result.drafts.map((d) => d.categoryKey)).toEqual(["food", "transport", "grocery"]);
    expect(result.drafts.every((d) => d.currency === "GBP")).toBe(true);
  });

  it("支持句号、感叹号与换行符作为多笔消费的分隔符", () => {
    const period = parseCaptureWithRules("午餐15镑。晚餐20镑。", ctx);
    expect(period.drafts).toHaveLength(2);
    expect(period.drafts.map((d) => d.amount)).toEqual([15, 20]);

    const multiline = parseCaptureWithRules("咖啡 4 镑\n打车 12 镑", ctx);
    expect(multiline.drafts).toHaveLength(2);
    expect(multiline.drafts.map((d) => d.amount)).toEqual([4, 12]);

    const exclaim = parseCaptureWithRules("午饭15镑！打车30镑！", ctx);
    expect(exclaim.drafts).toHaveLength(2);
    expect(exclaim.drafts.map((d) => d.amount)).toEqual([15, 30]);
  });

  it("识别英文币种词与商家", () => {
    const result = parseCaptureWithRules("coffee 4.5 pounds at Pret", ctx);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].amount).toBe(4.5);
    expect(result.drafts[0].currency).toBe("GBP");
    expect(result.drafts[0].merchant).toBe("Pret");
    expect(result.drafts[0].categoryKey).toBe("food");
  });

  it("支持货币符号前缀", () => {
    const result = parseCaptureWithRules("£8 breakfast", ctx);
    expect(result.drafts[0].amount).toBe(8);
    expect(result.drafts[0].currency).toBe("GBP");
  });

  it("符号前缀的金额与币种都要正确（即使与默认币种不同）", () => {
    // 默认币种是 GBP，符号指明的却是别的币种 —— 币种必须跟随符号
    expect(parseCaptureWithRules("hotel deposit ¥3000", ctx).drafts[0]).toMatchObject({
      amount: 3000,
      currency: "CNY",
    });
    expect(parseCaptureWithRules("taxi €12", ctx).drafts[0]).toMatchObject({
      amount: 12,
      currency: "EUR",
    });
    expect(parseCaptureWithRules("souvenir $30", ctx).drafts[0]).toMatchObject({
      amount: 30,
      currency: "USD",
    });
    // 小数、逗号千分位同样不能被截断
    expect(parseCaptureWithRules("£4.50 coffee", ctx).drafts[0]).toMatchObject({
      amount: 4.5,
      currency: "GBP",
    });
    expect(parseCaptureWithRules("购物 ¥12,800", ctx).drafts[0]).toMatchObject({
      amount: 12800,
      currency: "CNY",
    });
    // 无符号的 4 位以上金额同样不能被 \d{1,3} 截断
    expect(parseCaptureWithRules("酒店押金 3000 元", ctx).drafts[0]).toMatchObject({
      amount: 3000,
      currency: "CNY",
    });
  });

  it("中文数字金额也能解析", () => {
    const result = parseCaptureWithRules("打车花了十五块", ctx);
    expect(result.drafts[0].amount).toBe(15);
    expect(result.drafts[0].currency).toBe("CNY");
  });

  it("阿拉伯数字 + 万/千单位（如 1.2万日元）不能被中文数字展开破坏", () => {
    const r = parseCaptureWithRules("购物 1.2万日元", ctx);
    expect(r.drafts[0].amount).toBe(12000);
    expect(r.drafts[0].currency).toBe("JPY");
    const r2 = parseCaptureWithRules("买了十万日元的相机", ctx);
    expect(r2.drafts[0].amount).toBe(100000);
    expect(r2.drafts[0].currency).toBe("JPY");
    const r3 = parseCaptureWithRules("贴纸 1.2千日元", ctx);
    expect(r3.drafts[0].amount).toBe(1200);
    expect(r3.drafts[0].currency).toBe("JPY");
  });

  it("按「消费发生的那一天」推断币种（多国行程的关键边界）", () => {
    const multi = {
      ...ctx,
      defaultCurrency: "EUR",
      defaultCurrencyForDate: (date: string) => (date < "2026-09-09" ? "GBP" : "EUR"),
    };
    // 今天在巴黎段
    expect(parseCaptureWithRules("午饭 15", multi).drafts[0].currency).toBe("EUR");
    // 昨天还在伦敦段 —— 不能按今天所在的欧元区记
    const yesterday = parseCaptureWithRules("昨天午饭 15", multi).drafts[0];
    expect(yesterday.spentOn).toBe("2026-09-08");
    expect(yesterday.currency).toBe("GBP");
    // 句中明确说了币种，仍然以句中的为准
    expect(parseCaptureWithRules("昨天午饭 15 欧", multi).drafts[0].currency).toBe("EUR");
  });

  it("没提币种时使用默认目的地币种", () => {
    const result = parseCaptureWithRules("午餐 12", ctx);
    expect(result.drafts[0].currency).toBe("GBP");
  });

  it("把「昨天」换算成正确日期", () => {
    const result = parseCaptureWithRules("昨天买水 2 镑", ctx);
    expect(result.drafts[0].spentOn).toBe("2026-09-08");
  });

  it("识别支付方式", () => {
    const result = parseCaptureWithRules("现金付了 30 镑的晚餐", ctx);
    expect(result.drafts[0].paymentMethod).toBe("cash");
    expect(result.drafts[0].categoryKey).toBe("food");
  });

  it("不把「一起」「一共」里的「一」误认成 1 元", () => {
    const result = parseCaptureWithRules("我们一起去吃早饭 20 镑", ctx);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].amount).toBe(20);
  });

  it("「一共花了两百块」能识别出 200", () => {
    const result = parseCaptureWithRules("一共花了两百块", ctx);
    expect(result.drafts).toHaveLength(1);
    expect(result.drafts[0].amount).toBe(200);
    expect(result.drafts[0].currency).toBe("CNY");
  });

  it("识别「刚才那笔改成 18 镑」为纠错意图", () => {
    const result = parseCaptureWithRules("刚才那笔改成 18 镑", ctx);
    expect(result.intent).toBe("correct");
    expect(result.drafts).toHaveLength(0);
    expect(result.correction?.target.kind).toBe("last");
    expect(result.correction?.changes.amount).toBe(18);
    expect(result.correction?.changes.currency).toBe("GBP");
  });

  it("「不是 18 是 15」取改后的金额", () => {
    const result = parseCaptureWithRules("刚才那笔不是 18 是 15", ctx);
    expect(result.intent).toBe("correct");
    expect(result.correction?.changes.amount).toBe(15);
  });

  it("「昨天那笔删掉」为删除意图，并按日期定位", () => {
    const result = parseCaptureWithRules("昨天那笔删掉", ctx);
    expect(result.intent).toBe("delete");
    expect(result.correction?.target.kind).toBe("by_date");
    expect(result.correction?.target.date).toBe("2026-09-08");
  });

  it("提到商家时按商家定位", () => {
    const result = parseCaptureWithRules("在星巴克那笔改成 5 欧", ctx);
    expect(result.intent).toBe("correct");
    expect(result.correction?.target.kind).toBe("by_merchant");
    expect(result.correction?.target.merchant).toContain("星巴克");
    expect(result.correction?.changes.amount).toBe(5);
    expect(result.correction?.changes.currency).toBe("EUR");
  });

  it("普通记账不会被误判成纠错", () => {
    expect(parseCaptureWithRules("午饭 15 镑", ctx).intent).toBe("add");
    expect(parseCaptureWithRules("改成买菜了 20 镑", ctx).intent).toBe("correct");
  });

  it("没有金额时给出警告而不是编造记录", () => {
    const result = parseCaptureWithRules("今天好像花了不少钱", ctx);
    expect(result.drafts).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("置信度保留两位小数且不超过 0.95", () => {
    const result = parseCaptureWithRules("午饭 15 镑", ctx);
    const c = result.drafts[0].confidence;
    expect(c).toBeLessThanOrEqual(0.95);
    expect(Number(c.toFixed(2))).toBe(c);
  });
});

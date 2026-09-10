import { currencyExponent } from "./currency";

/** 金额 + 币种。所有跨币种运算都必须显式经过 fx 层。 */
export interface Money {
  amount: number;
  currency: string;
}

export function money(amount: number, currency: string): Money {
  return { amount: roundMoney(amount, currency), currency: currency.toUpperCase() };
}

/** 按币种小数位四舍五入，避免浮点误差累积 */
export function roundMoney(amount: number, currency: string): number {
  if (!Number.isFinite(amount)) return 0;
  const factor = 10 ** currencyExponent(currency);
  return Math.round((amount + Number.EPSILON) * factor) / factor;
}

export function isZero(amount: number, currency: string): boolean {
  return Math.abs(amount) < 1 / 10 ** currencyExponent(currency) / 2;
}

/** 同币种相加；币种不同直接抛错，防止静默算错账 */
export function addMoney(...items: Money[]): Money {
  if (items.length === 0) return { amount: 0, currency: "CNY" };
  const currency = items[0].currency.toUpperCase();
  for (const item of items) {
    if (item.currency.toUpperCase() !== currency) {
      throw new Error(`addMoney: 币种不一致 ${currency} vs ${item.currency}，请先换算`);
    }
  }
  return money(
    items.reduce((sum, item) => sum + item.amount, 0),
    currency,
  );
}

/** 用汇率把金额换算到目标币种。rate 语义：1 原币 = rate 目标币 */
export function convertMoney(amount: number, rate: number, toCurrency: string): Money {
  return money(amount * rate, toCurrency);
}

export function formatMoney(
  amount: number,
  currency: string,
  options: { locale?: string; compact?: boolean; signed?: boolean } = {},
): string {
  const { locale = "zh-CN", compact = false, signed = false } = options;
  const meta = { code: currency.toUpperCase() };
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: meta.code,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: currencyExponent(currency),
      signDisplay: signed ? "exceptZero" : "auto",
    }).format(amount);
  } catch {
    return `${currency.toUpperCase()} ${amount.toFixed(currencyExponent(currency))}`;
  }
}

/** 百分比，输入 0.1234 输出 "12.3%" */
export function formatPercent(ratio: number, digits = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 汇率换算时的安全除法 */
export function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  const res = a / b;
  return Number.isFinite(res) ? res : 0;
}

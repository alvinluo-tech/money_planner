import "server-only";
import type { FxQuote } from "./types";

/**
 * 汇率解析：缓存表 → 免费公开源 → 离线兜底表。
 * 永远返回一个可用汇率（宁可标注 stale 也不要让记账流程中断）。
 */

/** 进程内缓存时长，可用 FX_CACHE_TTL_HOURS 覆盖（夹在 0.1~168 小时之间，默认 6） */
const MEMORY_TTL_MS = (() => {
  const hours = Number(process.env.FX_CACHE_TTL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) return 6 * 60 * 60 * 1000;
  return Math.min(hours, 168) * 60 * 60 * 1000;
})();
const memoryCache = new Map<string, { quote: FxQuote; at: number }>();

/**
 * 离线兜底汇率（以 CNY 为锚，近似值，仅用于断网/未配置时的可用性保障）。
 * 线上运行时会被真实汇率覆盖；UI 会标注「离线汇率」。
 */
const FALLBACK_VS_CNY: Record<string, number> = {
  CNY: 1, GBP: 9.15, USD: 7.15, EUR: 7.75, JPY: 0.0475, HKD: 0.915,
  SGD: 5.35, THB: 0.2, KRW: 0.0052, TWD: 0.223, MYR: 1.62, VND: 0.00028,
  IDR: 0.00044, PHP: 0.123, INR: 0.083, AUD: 4.65, NZD: 4.2, CAD: 5.2,
  CHF: 8.1, AED: 1.95, SAR: 1.9, TRY: 0.2, EGP: 0.145, ZAR: 0.39,
  BRL: 1.28, MXN: 0.36, SEK: 0.68, NOK: 0.65, DKK: 1.04, PLN: 1.8,
  CZK: 0.31, HUF: 0.018, ISK: 0.052, RUB: 0.075, ILS: 1.95,
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 离线兜底：通过 CNY 做三角换算。
 * 未知币种返回 0（而不是 1）—— 静默按 1:1 折算会把账算错，调用方必须显式处理。
 */
export function fallbackRate(from: string, to: string): number {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) return 1;
  const fromCny = FALLBACK_VS_CNY[f];
  const toCny = FALLBACK_VS_CNY[t];
  if (!fromCny || !toCny) return 0;
  return fromCny / toCny;
}

export function fallbackQuote(from: string, to: string): FxQuote {
  const rate = fallbackRate(from, to);
  return {
    base: from.toUpperCase(),
    quote: to.toUpperCase(),
    rate,
    asOf: todayIso(),
    source: rate > 0 ? "offline-fallback" : "unsupported-currency",
    stale: true,
  };
}

async function fetchFrankfurter(from: string, to: string): Promise<FxQuote | null> {
  const base = process.env.FX_PRIMARY_URL || "https://api.frankfurter.app";
  try {
    const res = await fetch(`${base}/latest?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { date?: string; rates?: Record<string, number> };
    const rate = json.rates?.[to];
    if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
    return { base: from, quote: to, rate, asOf: json.date ?? todayIso(), source: "ecb" };
  } catch {
    return null;
  }
}

async function fetchErApi(from: string, to: string): Promise<FxQuote | null> {
  const base = process.env.FX_FALLBACK_URL || "https://open.er-api.com/v6";
  try {
    const res = await fetch(`${base}/latest/${from}`, {
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: string;
      time_last_update_utc?: string;
      rates?: Record<string, number>;
    };
    const rate = json.rates?.[to];
    if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
    const asOf = json.time_last_update_utc
      ? new Date(json.time_last_update_utc).toISOString().slice(0, 10)
      : todayIso();
    return { base: from, quote: to, rate, asOf, source: "er-api" };
  } catch {
    return null;
  }
}

export async function getRate(from: string, to: string): Promise<FxQuote> {
  const f = from.toUpperCase();
  const t = to.toUpperCase();
  if (f === t) {
    return { base: f, quote: t, rate: 1, asOf: todayIso(), source: "same" };
  }

  const key = `${f}->${t}`;
  const cached = memoryCache.get(key);
  if (cached && Date.now() - cached.at < MEMORY_TTL_MS) return cached.quote;

  const quote =
    (await fetchFrankfurter(f, t)) ?? (await fetchErApi(f, t)) ?? fallbackQuote(f, t);
  memoryCache.set(key, { quote, at: Date.now() });
  return quote;
}

/** 批量取汇率，返回 { 币种: 到基准币的汇率 } */
export async function getRatesTo(
  currencies: string[],
  base: string,
): Promise<Record<string, FxQuote>> {
  const unique = Array.from(new Set(currencies.map((c) => c.toUpperCase())));
  const entries = await Promise.all(unique.map(async (c) => [c, await getRate(c, base)] as const));
  return Object.fromEntries(entries);
}

export function clearRateCache(): void {
  memoryCache.clear();
}

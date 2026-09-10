import { CURRENCIES, isSupportedCurrency } from "./currency";
import type { TripLeg } from "./types";

/**
 * 行程分段（多国旅行）的纯函数层：币种/时区推断、日期归属、合法性校验。
 * 全部无 IO，方便单测，也方便在客户端表单里实时校验。
 */

/** 常用国家/地区预设：选国家自动带出币种和时区，避免用户猜 */
export interface CountryPreset {
  code: string;
  name: string;
  currency: string;
  timezone: string;
}

export const COUNTRY_PRESETS: CountryPreset[] = [
  { code: "GB", name: "英国", currency: "GBP", timezone: "Europe/London" },
  { code: "FR", name: "法国", currency: "EUR", timezone: "Europe/Paris" },
  { code: "DE", name: "德国", currency: "EUR", timezone: "Europe/Berlin" },
  { code: "IT", name: "意大利", currency: "EUR", timezone: "Europe/Rome" },
  { code: "ES", name: "西班牙", currency: "EUR", timezone: "Europe/Madrid" },
  { code: "PT", name: "葡萄牙", currency: "EUR", timezone: "Europe/Lisbon" },
  { code: "NL", name: "荷兰", currency: "EUR", timezone: "Europe/Amsterdam" },
  { code: "BE", name: "比利时", currency: "EUR", timezone: "Europe/Brussels" },
  { code: "AT", name: "奥地利", currency: "EUR", timezone: "Europe/Vienna" },
  { code: "GR", name: "希腊", currency: "EUR", timezone: "Europe/Athens" },
  { code: "IE", name: "爱尔兰", currency: "EUR", timezone: "Europe/Dublin" },
  { code: "FI", name: "芬兰", currency: "EUR", timezone: "Europe/Helsinki" },
  { code: "CH", name: "瑞士", currency: "CHF", timezone: "Europe/Zurich" },
  { code: "NO", name: "挪威", currency: "NOK", timezone: "Europe/Oslo" },
  { code: "SE", name: "瑞典", currency: "SEK", timezone: "Europe/Stockholm" },
  { code: "DK", name: "丹麦", currency: "DKK", timezone: "Europe/Copenhagen" },
  { code: "PL", name: "波兰", currency: "PLN", timezone: "Europe/Warsaw" },
  { code: "CZ", name: "捷克", currency: "CZK", timezone: "Europe/Prague" },
  { code: "HU", name: "匈牙利", currency: "HUF", timezone: "Europe/Budapest" },
  { code: "IS", name: "冰岛", currency: "ISK", timezone: "Atlantic/Reykjavik" },
  { code: "TR", name: "土耳其", currency: "TRY", timezone: "Europe/Istanbul" },
  { code: "US", name: "美国", currency: "USD", timezone: "America/New_York" },
  { code: "CA", name: "加拿大", currency: "CAD", timezone: "America/Toronto" },
  { code: "MX", name: "墨西哥", currency: "MXN", timezone: "America/Mexico_City" },
  { code: "BR", name: "巴西", currency: "BRL", timezone: "America/Sao_Paulo" },
  { code: "JP", name: "日本", currency: "JPY", timezone: "Asia/Tokyo" },
  { code: "KR", name: "韩国", currency: "KRW", timezone: "Asia/Seoul" },
  { code: "CN", name: "中国", currency: "CNY", timezone: "Asia/Shanghai" },
  { code: "HK", name: "中国香港", currency: "HKD", timezone: "Asia/Hong_Kong" },
  { code: "TW", name: "中国台湾", currency: "TWD", timezone: "Asia/Taipei" },
  { code: "SG", name: "新加坡", currency: "SGD", timezone: "Asia/Singapore" },
  { code: "TH", name: "泰国", currency: "THB", timezone: "Asia/Bangkok" },
  { code: "MY", name: "马来西亚", currency: "MYR", timezone: "Asia/Kuala_Lumpur" },
  { code: "VN", name: "越南", currency: "VND", timezone: "Asia/Ho_Chi_Minh" },
  { code: "ID", name: "印度尼西亚", currency: "IDR", timezone: "Asia/Jakarta" },
  { code: "PH", name: "菲律宾", currency: "PHP", timezone: "Asia/Manila" },
  { code: "IN", name: "印度", currency: "INR", timezone: "Asia/Kolkata" },
  { code: "AE", name: "阿联酋", currency: "AED", timezone: "Asia/Dubai" },
  { code: "SA", name: "沙特", currency: "SAR", timezone: "Asia/Riyadh" },
  { code: "IL", name: "以色列", currency: "ILS", timezone: "Asia/Jerusalem" },
  { code: "AU", name: "澳大利亚", currency: "AUD", timezone: "Australia/Sydney" },
  { code: "NZ", name: "新西兰", currency: "NZD", timezone: "Pacific/Auckland" },
  { code: "EG", name: "埃及", currency: "EGP", timezone: "Africa/Cairo" },
  { code: "ZA", name: "南非", currency: "ZAR", timezone: "Africa/Johannesburg" },
];

export const COUNTRY_BY_CODE = new Map(COUNTRY_PRESETS.map((c) => [c.code, c]));

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** 某个时刻在指定时区里的日期（YYYY-MM-DD） */
export function dateInTimezone(timezone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function sortLegs(legs: TripLeg[]): TripLeg[] {
  return [...legs].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.seq - b.seq,
  );
}

/**
 * 找出某一天所属的行程段。
 * 允许「首尾相接」：上一段结束日 == 下一段开始日（转机日）时，
 * 取开始日期更晚的那一段 —— 因为那天你多半已经在新国家消费了。
 * 没有任何段覆盖该日期时返回 null，由调用方回退到行程级默认值。
 */
export function legForDate(legs: TripLeg[], date: string): TripLeg | null {
  let found: TripLeg | null = null;
  for (const leg of sortLegs(legs)) {
    if (leg.startDate <= date && date <= leg.endDate) found = leg;
  }
  return found;
}

/** 当前「身处」哪一段（按各段自己的时区判断今天） */
export function legForInstant(legs: TripLeg[], at: Date = new Date()): TripLeg | null {
  let found: TripLeg | null = null;
  for (const leg of sortLegs(legs)) {
    const local = dateInTimezone(leg.timezone, at);
    if (leg.startDate <= local && local <= leg.endDate) found = leg;
  }
  return found;
}

export interface LegValidationInput {
  name: string;
  currency: string;
  timezone: string;
  startDate: string;
  endDate: string;
}

/** 分段合法性：日期在行程内、起止正确、互不重叠（允许同一天首尾相接） */
export function validateLegs(
  legs: LegValidationInput[],
  tripStart: string,
  tripEnd: string,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const sorted = [...legs].sort((a, b) => a.startDate.localeCompare(b.startDate));

  sorted.forEach((leg, index) => {
    const label = leg.name?.trim() || `第 ${index + 1} 段`;
    if (!leg.name?.trim()) errors.push(`第 ${index + 1} 段缺少名称`);
    if (!isSupportedCurrency(leg.currency)) errors.push(`${label} 的币种 ${leg.currency} 暂不支持`);
    if (!isValidTimezone(leg.timezone)) errors.push(`${label} 的时区 ${leg.timezone} 无效`);
    if (leg.endDate < leg.startDate) errors.push(`${label} 的结束日期早于开始日期`);
    if (leg.startDate < tripStart || leg.endDate > tripEnd) {
      errors.push(`${label} 的日期超出了行程范围`);
    }
    const next = sorted[index + 1];
    if (next && leg.endDate > next.startDate) {
      errors.push(`${label} 与 ${next.name?.trim() || `第 ${index + 2} 段`} 的日期重叠`);
    }
  });

  return { ok: errors.length === 0, errors };
}

/** 由分段推导行程展示名，例如「伦敦 → 巴黎 → 苏黎世」 */
export function describeRoute(legs: TripLeg[]): string {
  const names = sortLegs(legs)
    .map((l) => l.name.trim())
    .filter(Boolean);
  if (names.length === 0) return "";
  const unique = names.filter((n, i) => i === 0 || n !== names[i - 1]);
  return unique.join(" → ");
}

/** 行程涉及的所有币种（含基准币），用于一次性取汇率 */
export function legCurrencies(legs: TripLeg[]): string[] {
  return Array.from(new Set(legs.map((l) => l.currency.toUpperCase())));
}

/** 币种元数据（供 UI 展示国家预设时用） */
export function currencyName(code: string): string {
  return CURRENCIES[code.toUpperCase()]?.name ?? code;
}

/**
 * 货币元数据。
 * exponent 是 ISO-4217 的小数位（日元/韩元为 0），决定金额四舍五入到哪一位。
 */
export interface CurrencyMeta {
  code: string;
  name: string;
  nameEn: string;
  symbol: string;
  exponent: number;
  /** 旅行场景常见程度，用于在币种选择器里排序 */
  priority: number;
}

const RAW: Array<[string, string, string, string, number, number]> = [
  // code, 中文名, English, symbol, exponent, priority
  ["CNY", "人民币", "Chinese Yuan", "¥", 2, 100],
  ["GBP", "英镑", "British Pound", "£", 2, 98],
  ["USD", "美元", "US Dollar", "$", 2, 97],
  ["EUR", "欧元", "Euro", "€", 2, 96],
  ["JPY", "日元", "Japanese Yen", "¥", 0, 92],
  ["HKD", "港币", "Hong Kong Dollar", "HK$", 2, 88],
  ["SGD", "新加坡元", "Singapore Dollar", "S$", 2, 84],
  ["THB", "泰铢", "Thai Baht", "฿", 2, 82],
  ["KRW", "韩元", "Korean Won", "₩", 0, 80],
  ["TWD", "新台币", "Taiwan Dollar", "NT$", 2, 76],
  ["MYR", "马来西亚林吉特", "Malaysian Ringgit", "RM", 2, 74],
  ["VND", "越南盾", "Vietnamese Dong", "₫", 0, 72],
  ["IDR", "印尼盾", "Indonesian Rupiah", "Rp", 0, 70],
  ["PHP", "菲律宾比索", "Philippine Peso", "₱", 2, 66],
  ["INR", "印度卢比", "Indian Rupee", "₹", 2, 64],
  ["AUD", "澳元", "Australian Dollar", "A$", 2, 62],
  ["NZD", "新西兰元", "New Zealand Dollar", "NZ$", 2, 60],
  ["CAD", "加元", "Canadian Dollar", "C$", 2, 58],
  ["CHF", "瑞士法郎", "Swiss Franc", "CHF", 2, 56],
  ["AED", "迪拉姆", "UAE Dirham", "د.إ", 2, 52],
  ["SAR", "沙特里亚尔", "Saudi Riyal", "﷼", 2, 46],
  ["TRY", "土耳其里拉", "Turkish Lira", "₺", 2, 44],
  ["EGP", "埃及镑", "Egyptian Pound", "E£", 2, 40],
  ["ZAR", "南非兰特", "South African Rand", "R", 2, 38],
  ["BRL", "巴西雷亚尔", "Brazilian Real", "R$", 2, 34],
  ["MXN", "墨西哥比索", "Mexican Peso", "MX$", 2, 32],
  ["SEK", "瑞典克朗", "Swedish Krona", "kr", 2, 30],
  ["NOK", "挪威克朗", "Norwegian Krone", "kr", 2, 28],
  ["DKK", "丹麦克朗", "Danish Krone", "kr", 2, 26],
  ["PLN", "波兰兹罗提", "Polish Zloty", "zł", 2, 24],
  ["CZK", "捷克克朗", "Czech Koruna", "Kč", 2, 22],
  ["HUF", "匈牙利福林", "Hungarian Forint", "Ft", 2, 20],
  ["ISK", "冰岛克朗", "Icelandic Krona", "kr", 0, 18],
  ["RUB", "俄罗斯卢布", "Russian Ruble", "₽", 2, 16],
  ["ILS", "以色列谢克尔", "Israeli Shekel", "₪", 2, 14],
];

export const CURRENCIES: Record<string, CurrencyMeta> = Object.fromEntries(
  RAW.map(([code, name, nameEn, symbol, exponent, priority]) => [
    code,
    { code, name, nameEn, symbol, exponent, priority },
  ]),
);

export const CURRENCY_LIST: CurrencyMeta[] = Object.values(CURRENCIES).sort(
  (a, b) => b.priority - a.priority || a.code.localeCompare(b.code),
);

export const DEFAULT_BASE_CURRENCY = "CNY";

export function isSupportedCurrency(code: string): boolean {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code.toUpperCase());
}

export function currencyMeta(code: string): CurrencyMeta {
  const key = (code || "").toUpperCase();
  return (
    CURRENCIES[key] ?? {
      code: key || "???",
      name: key || "未知货币",
      nameEn: key || "Unknown",
      symbol: key || "?",
      exponent: 2,
      priority: 0,
    }
  );
}

export function currencyExponent(code: string): number {
  return currencyMeta(code).exponent;
}

/** 把货币代码或常见别名（磅/镑/块/刀/欧…）解析成 ISO 代码 */
const ALIASES: Record<string, string> = {
  人民币: "CNY", 元: "CNY", 块: "CNY", 块钱: "CNY", rmb: "CNY", cny: "CNY", "￥": "CNY",
  英镑: "GBP", 磅: "GBP", 镑: "GBP", 英磅: "GBP", gbp: "GBP", "£": "GBP", pound: "GBP", pounds: "GBP", quid: "GBP",
  美元: "USD", 美金: "USD", 刀: "USD", 美刀: "USD", usd: "USD", "$": "USD", dollar: "USD", dollars: "USD",
  欧元: "EUR", 欧: "EUR", 歐元: "EUR", eur: "EUR", "€": "EUR", euro: "EUR", euros: "EUR",
  日元: "JPY", 日币: "JPY", 日圆: "JPY", jpy: "JPY", yen: "JPY", 円: "JPY",
  港币: "HKD", 港元: "HKD", 港纸: "HKD", hkd: "HKD",
  新币: "SGD", 新元: "SGD", 新加坡元: "SGD", sgd: "SGD",
  泰铢: "THB", thb: "THB", 铢: "THB",
  韩元: "KRW", 韩币: "KRW", krw: "KRW",
  台币: "TWD", 新台币: "TWD", twd: "TWD",
  马币: "MYR", 林吉特: "MYR", myr: "MYR",
  越南盾: "VND", 盾: "VND", vnd: "VND",
  印尼盾: "IDR", 卢比: "INR", idr: "IDR",
  比索: "PHP", php: "PHP",
  澳元: "AUD", 澳币: "AUD", aud: "AUD",
  新西兰元: "NZD", nzd: "NZD",
  加元: "CAD", 加币: "CAD", cad: "CAD",
  瑞郎: "CHF", 瑞士法郎: "CHF", chf: "CHF",
  迪拉姆: "AED", aed: "AED",
  里拉: "TRY", try: "TRY",
  兰特: "ZAR", zar: "ZAR",
  雷亚尔: "BRL", brl: "BRL",
  // 英文口语（常出现在中英混说的句子里）
  sterling: "GBP", bucks: "USD", buck: "USD", yuan: "CNY",
  baht: "THB", won: "KRW", ringgit: "MYR", rupiah: "IDR", dong: "VND", peso: "PHP",
  franc: "CHF", dirham: "AED", lira: "TRY", rand: "ZAR", real: "BRL",
};

export function parseCurrencyAlias(token: string): string | null {
  if (!token) return null;
  const t = token.trim();
  const lower = t.toLowerCase();
  if (ALIASES[t]) return ALIASES[t];
  if (ALIASES[lower]) return ALIASES[lower];
  const upper = t.toUpperCase();
  if (isSupportedCurrency(upper)) return upper;
  return null;
}

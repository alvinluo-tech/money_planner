import { isSupportedCurrency, parseCurrencyAlias } from "../currency";
import { roundMoney } from "../money";
import type {
  CaptureIntent,
  CorrectionPatch,
  CorrectionTarget,
  ExpenseDraft,
  ParsedCapture,
  PaymentMethod,
} from "../types";

/**
 * 离线规则解析器。
 * 作用有两个：
 *   1) 没配大模型 / 大模型超时 / 网络抖动时，语音记账依然可用（降级而不是报错）。
 *   2) 给大模型结果做交叉校验的基准实现。
 * 支持中英混说，例如：
 *   "早餐 12 英镑" / "打车花了 45 块" / "coffee 4.5 pounds at Pret" / "午饭 15 镑，地铁 3 镑"
 */

export interface RuleParseContext {
  /** 未提到币种时的兜底币种 */
  defaultCurrency: string;
  /**
   * 按「消费发生的那一天」解析默认币种。
   * 多国行程里这很关键：今天在巴黎说「昨天午饭 15」，昨天可能还在伦敦，
   * 那就应该按英镑记，而不是按今天所在的欧元区记。
   */
  defaultCurrencyForDate?: (date: string) => string;
  baseCurrency: string;
  /** 今天，YYYY-MM-DD（旅行当地日期） */
  today: string;
  /** 旅行起止，用于把「3 号」这类日期锚定到正确月份 */
  tripStart?: string;
  tripEnd?: string;
}

const CN_DIGITS: Record<string, number> = {
  零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
};
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** 把「十三」「两百」「三十八」「一万二」这类中文数字转成阿拉伯数字 */
export function cnNumberToArabic(text: string): number | null {
  if (!text) return null;
  let total = 0;
  let section = 0;
  let current = 0;
  let seen = false;

  for (const ch of text) {
    if (ch in CN_DIGITS) {
      current = CN_DIGITS[ch];
      seen = true;
      continue;
    }
    const unit = CN_UNITS[ch];
    if (unit) {
      seen = true;
      if (unit === 10000) {
        section = (section + (current || 0)) * unit;
        total += section;
        section = 0;
      } else {
        section += (current || 1) * unit;
      }
      current = 0;
      continue;
    }
    return seen ? total + section + current : null;
  }
  const result = total + section + current;
  if (!seen) return null;
  // 纯单位字符（如「万」）结果为 0，不是数字表达式；有意义的展开交由调用方判断
  if (result === 0 && text !== "零") return null;
  return result;
}

const SYMBOL_TO_CURRENCY: Record<string, string> = {
  "£": "GBP", "€": "EUR", "$": "USD", "¥": "CNY", "￥": "CNY",
  "₩": "KRW", "฿": "THB", "₹": "INR", "₺": "TRY", "₽": "RUB", "₪": "ILS", "₫": "VND",
};

/** 分类关键词，按长度优先匹配，避免「买菜」被「买」抢走 */
const CATEGORY_KEYWORDS: Array<[string, string]> = [
  ["早餐", "food"], ["早饭", "food"], ["午餐", "food"], ["午饭", "food"], ["中饭", "food"],
  ["晚餐", "food"], ["晚饭", "food"], ["夜宵", "food"], ["宵夜", "food"], ["下午茶", "food"],
  ["早茶", "food"], ["咖啡", "food"], ["奶茶", "food"], ["星巴克", "food"], ["麦当劳", "food"],
  ["肯德基", "food"], ["汉堡", "food"], ["披萨", "food"], ["拉面", "food"], ["寿司", "food"],
  ["火锅", "food"], ["甜点", "food"], ["蛋糕", "food"], ["冰淇淋", "food"], ["啤酒", "food"],
  ["酒吧", "food"], ["饮料", "food"], ["外卖", "food"], ["小吃", "food"], ["吃饭", "food"],
  ["breakfast", "food"], ["lunch", "food"], ["dinner", "food"], ["brunch", "food"],
  ["coffee", "food"], ["cafe", "food"], ["restaurant", "food"], ["beer", "food"], ["drink", "food"],

  ["买菜", "grocery"], ["超市", "grocery"], ["便利店", "grocery"], ["杂货", "grocery"],
  ["水果", "grocery"], ["牛奶", "grocery"], ["矿泉水", "grocery"], ["grocery", "grocery"],
  ["supermarket", "grocery"],

  ["地铁", "transport"], ["公交", "transport"], ["巴士", "transport"], ["打车", "transport"],
  ["出租车", "transport"], ["优步", "transport"], ["滴滴", "transport"], ["火车", "transport"],
  ["高铁", "transport"], ["机票", "transport"], ["车票", "transport"], ["船票", "transport"],
  ["加油", "transport"], ["停车", "transport"], ["租车", "transport"], ["轮渡", "transport"],
  ["交通卡", "transport"], ["taxi", "transport"], ["uber", "transport"], ["metro", "transport"],
  ["subway", "transport"], ["bus", "transport"], ["train", "transport"], ["flight", "transport"],
  ["oyster", "transport"], ["parking", "transport"], ["fuel", "transport"],

  ["酒店", "lodging"], ["民宿", "lodging"], ["住宿", "lodging"], ["房费", "lodging"],
  ["旅馆", "lodging"], ["青旅", "lodging"], ["客栈", "lodging"], ["airbnb", "lodging"],
  ["hotel", "lodging"], ["hostel", "lodging"],

  ["门票", "attraction"], ["博物馆", "attraction"], ["美术馆", "attraction"], ["景点", "attraction"],
  ["展览", "attraction"], ["观光", "attraction"], ["城堡", "attraction"], ["教堂", "attraction"],
  ["museum", "attraction"], ["ticket", "attraction"], ["gallery", "attraction"], ["tour", "attraction"],

  ["买衣服", "shopping"], ["衣服", "shopping"], ["鞋", "shopping"], ["包包", "shopping"],
  ["化妆品", "shopping"], ["纪念品", "shopping"], ["免税", "shopping"], ["商场", "shopping"],
  ["奥特莱斯", "shopping"], ["购物", "shopping"], ["outlet", "shopping"], ["shopping", "shopping"],

  ["电影", "entertainment"], ["游戏", "entertainment"], ["演唱会", "entertainment"],
  ["剧院", "entertainment"], ["音乐会", "entertainment"], ["ktv", "entertainment"],
  ["cinema", "entertainment"], ["movie", "entertainment"], ["show", "entertainment"],

  ["药店", "health"], ["医院", "health"], ["诊所", "health"], ["看病", "health"],
  ["感冒药", "health"], ["口罩", "health"], ["pharmacy", "health"],

  ["电话卡", "communication"], ["流量", "communication"], ["漫游", "communication"],
  ["充话费", "communication"], ["sim", "communication"], ["esim", "communication"], ["wifi", "communication"],

  ["手续费", "fee"], ["服务费", "fee"], ["小费", "fee"], ["税", "fee"], ["机场费", "fee"],
  ["汇率费", "fee"], ["fee", "fee"], ["tip", "fee"], ["tax", "fee"],

  ["伴手礼", "gift"], ["礼物", "gift"], ["特产", "gift"], ["gift", "gift"], ["souvenir", "gift"],

  ["买", "shopping"], ["购", "shopping"], ["花", "other"],
];

const CATEGORY_KEYWORDS_SORTED = [...CATEGORY_KEYWORDS].sort((a, b) => b[0].length - a[0].length);

const PAYMENT_KEYWORDS: Array<[string, PaymentMethod]> = [
  ["现金", "cash"], ["cash", "cash"], ["刷卡", "card"], ["信用卡", "card"], ["银行卡", "card"],
  ["card", "card"], ["支付宝", "alipay"], ["alipay", "alipay"], ["微信", "wechat"], ["wechat", "wechat"],
];

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，、；;。！？!?\r\n]/g, ",")
    .replace(/[：]/g, ":")
    // 千分位逗号先并回数字（只消费逗号本身，1,234,567 一遍即可全部并回），
    // 否则分句会把「¥12,800」当成两段
    .replace(/(?<=\d),(?=\d{3}(?!\d))/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 中文数字后紧跟货币/量词时才当作金额。
 * 否则「我们一起去吃早饭」会被误读成「我们 1 起去吃早饭」→ 凭空多出一笔 1 元的消费。
 */
const CN_MONEY_AFTER =
  /^(?:块钱|块|元|镑|磅|英镑|人民币|美元|美金|美刀|刀|欧元|欧|日元|日币|日圆|港币|港元|新币|新元|泰铢|韩元|韩币|台币|新台币|马币|越南盾|印尼盾|卢比|比索|澳元|澳币|新西兰元|加元|加币|瑞郎|瑞士法郎|迪拉姆|里拉|兰特|雷亚尔|多|左右)/;

/** 前面出现这些记账语境词时，即使后面没有量词也认为是金额（「一共花了三百」） */
const CN_MONEY_BEFORE = /(花了|付了|用了|收了|约|大概|差不多|一共|总共|共)$/;

/** 把「十三」「两百」这类中文金额替换成阿拉伯数字，方便后续统一处理 */
function expandChineseNumbers(text: string): string {
  return text.replace(
    /[零一二两三四五六七八九十百千万]{1,8}/g,
    (match, offset: number, whole: string) => {
      // 前一位是数字/小数点时是「1.2万」「0.5千」这类「阿拉伯数字+单位」组合：
      // 展开会把「1.2万」变成「1.20」，必须留给 AMOUNT_SUFFIX 处理
      if (offset > 0 && /[\d０-９.]/.test(whole[offset - 1])) return match;
      const after = whole.slice(offset + match.length);
      const before = whole.slice(Math.max(0, offset - 4), offset);
      if (!CN_MONEY_AFTER.test(after) && !CN_MONEY_BEFORE.test(before)) return match;
      const n = cnNumberToArabic(match);
      return n === null ? match : String(n);
    },
  );
}

function splitSegments(text: string): string[] {
  return text
    .split(/[,;]+|\s+(?:然后|还有|以及|and then|and)\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

interface AmountHit {
  amount: number;
  currency: string | null;
  explicitCurrency: boolean;
  span: [number, number];
}

/** 币种词/符号，允许英文单词（pounds、euros…），统一交给 parseCurrencyAlias 判定 */
const CURRENCY_TOKEN =
  "英镑|英磅|磅|镑|人民币|块钱|块|元|美元|美金|美刀|刀|欧元|欧|日元|日币|日圆|港币|港元|新币|新元|泰铢|韩元|韩币|台币|新台币|马币|越南盾|印尼盾|卢比|比索|澳元|澳币|新西兰元|加元|加币|瑞郎|瑞士法郎|迪拉姆|里拉|兰特|雷亚尔|[£€$¥￥₩฿₹₺₽₪₫]|[A-Za-z]{3,10}";

const AMOUNT_SUFFIX = "(k|千|万|w|K)?";

function findAmount(segment: string): AmountHit | null {
  const expanded = expandChineseNumbers(segment);
  const candidates: AmountHit[] = [];

  // 形式一：金额在前，币种在后 —— "15 镑" / "4.5 pounds" / "12 GBP"
  // 交替分支的顺序很重要：必须先试「带千分位」的形式。
  // 若 \d{1,3} 允许零逗号结尾，"3000" 会被它截成 "300"（正则有序交替成功后不再回溯）。
  const afterRe = new RegExp(
    `(?:^|[^0-9.])(\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?)\\s*${AMOUNT_SUFFIX}\\s*(${CURRENCY_TOKEN})?`,
    "gi",
  );
  for (const m of expanded.matchAll(afterRe)) {
    const raw = m[1];
    if (!raw) continue;
    let value = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k" || suffix === "千") value *= 1000;
    if (suffix === "w" || suffix === "万") value *= 10000;

    const token = m[3] ?? "";
    const currency = SYMBOL_TO_CURRENCY[token] ?? (token ? parseCurrencyAlias(token) : null);
    const start = m.index ?? 0;
    candidates.push({
      amount: value,
      currency,
      explicitCurrency: Boolean(currency),
      span: [start, start + m[0].length],
    });
  }

  // 形式二：符号在前 —— "£4.50" / "€12" / "¥3000"
  // 注意 \s 与 \d 的反斜杠不能丢：丢了会变成字面量 s/d，整条正则永远匹配不上，
  // 符号前缀金额就会落到形式一里被截成前三位数字（如 ¥3000 → 300）。
  // 千分位分支（+）放在纯数字分支之前，理由同形式一。
  const beforeRe = /([£€$¥￥₩฿₹₺₽₪₫])\s*(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)/g;
  for (const m of expanded.matchAll(beforeRe)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const start = m.index ?? 0;
    candidates.push({
      amount: value,
      currency: SYMBOL_TO_CURRENCY[m[1]] ?? null,
      explicitCurrency: true,
      span: [start, start + m[0].length],
    });
  }

  // 优先取「带明确币种」的；都没有就取最后一个金额（口语里主金额通常最后说）
  let best: AmountHit | null = null;
  for (const hit of candidates) {
    if (!best) best = hit;
    else if (hit.explicitCurrency && !best.explicitCurrency) best = hit;
    else if (hit.explicitCurrency === best.explicitCurrency) best = hit;
  }
  return best;
}

function findCategory(segment: string): { key: string; matched: boolean } {
  const lower = segment.toLowerCase();
  for (const [kw, key] of CATEGORY_KEYWORDS_SORTED) {
    if (lower.includes(kw.toLowerCase())) return { key, matched: true };
  }
  return { key: "other", matched: false };
}

function findMerchant(segment: string): { merchant: string | null; span: [number, number] | null } {
  // 1. 打车 / 交通路线：从 A 到 B / 从 A 打车到 B
  const route = segment.match(/从([\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?)(?:打车到|坐车到|打车|坐车|乘车|到)([\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?)(?=\d|花了|花|了|\s|$)/);
  if (route) {
    const start = route.index ?? 0;
    return { merchant: "打车", span: [start, start + route[0].length] };
  }

  const patterns = [
    /(?:在|到)([\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?)(?:吃|喝|买|花|住|坐|订|玩|看|的|花了)/,
    /(?:吃|喝|去|逛)([\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?)(?:花了|花|了|\s|\d)/,
    /(?:at|from)\s+([A-Za-z0-9'’&\-· ]{2,20})/i,
  ];
  for (const p of patterns) {
    const m = segment.match(p);
    if (m && m[1]) {
      const merchant = m[1].trim();
      const start = m.index ?? 0;
      return { merchant, span: [start, start + m[0].length] };
    }
  }
  return { merchant: null, span: null };
}

function findPaymentMethod(segment: string): PaymentMethod | null {
  const lower = segment.toLowerCase();
  for (const [kw, method] of PAYMENT_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return method;
  }
  return null;
}

function shiftDate(base: string, days: number): string {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function findDate(segment: string, ctx: RuleParseContext): string {
  const t = segment;
  if (/(前天)/.test(t)) return shiftDate(ctx.today, -2);
  if (/(昨天|昨晚|昨儿|昨晚上)/.test(t)) return shiftDate(ctx.today, -1);
  if (/(今天|今早|今儿|刚刚|刚才|今晚|中午|晚上|早上|上午|下午)/.test(t)) return ctx.today;
  if (/(昨天|yesterday)/i.test(t)) return shiftDate(ctx.today, -1);
  if (/(today)/i.test(t)) return ctx.today;

  // 3 号 / 3 日 / 3月5日
  const md = t.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*[号日]/);
  if (md) {
    const year = ctx.today.slice(0, 4);
    const iso = `${year}-${md[1].padStart(2, "0")}-${md[2].padStart(2, "0")}`;
    if (!ctx.tripStart || !ctx.tripEnd || (iso >= ctx.tripStart && iso <= ctx.tripEnd)) return iso;
  }
  const dOnly = t.match(/(?<![\d.])(\d{1,2})\s*[号日](?!\d)/);
  if (dOnly) {
    const day = Number(dOnly[1]);
    const base = ctx.today.slice(0, 8); // YYYY-MM-
    const iso = `${base}${String(day).padStart(2, "0")}`;
    if (!ctx.tripStart || !ctx.tripEnd || (iso >= ctx.tripStart && iso <= ctx.tripEnd)) return iso;
  }
  return ctx.today;
}

/** 去掉已识别的片段，剩下的当备注 */
function buildNote(segment: string, spans: Array<[number, number] | null>): string | null {
  // 如果整句话包含明确路线（如「从卢浮宫打车到凯旋门」），优先保留完整路线描述
  const route = segment.match(/从[\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?(?:打车到|坐车到|打车|坐车|乘车|到)[\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?(?=\d|花了|花|了|\s|$)/);
  if (route) {
    return route[0];
  }

  const chars = Array.from(segment);
  const removed = new Set<number>();
  for (const span of spans) {
    if (!span) continue;
    for (let i = span[0]; i < span[1]; i += 1) removed.add(i);
  }
  const kept = chars.filter((_, i) => !removed.has(i)).join("");
  const cleaned = kept
    .replace(/(花了|花|一共|总共|大概|大约|差不多|用了|付了|支付|是|的|了|约|左右)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

/* ---------- 纠错意图（「刚才那笔改成 18 镑」）---------- */

const DELETE_RE = /(删掉|删除|撤销|去掉|取消刚才|记错了.*?删)/;
const CORRECT_RE = /(改成|改为|改一下|修正|纠正|应该是|其实是|记错|记错了|换成|不是.*?是)/;
/** 指代「最近那一笔」的说法 */
const LAST_RE = /(刚才|刚那笔|刚记的|上一笔|上一条|最后一笔|最后一条|最近一笔|最近一条)/;

function detectCorrectionIntent(segment: string): CaptureIntent | null {
  if (DELETE_RE.test(segment)) return "delete";
  if (CORRECT_RE.test(segment)) return "correct";
  return null;
}

/** 改哪一笔：默认最近一笔；提到「昨天」按日期找；提到具体商家按商家找 */
function correctionTargetOf(segment: string, ctx: RuleParseContext): CorrectionTarget {
  if (/(昨天|前天)/.test(segment)) return { kind: "by_date", date: findDate(segment, ctx) };

  // 「在星巴克那笔」「在巴黎这笔」——指代里直接带了商家/地点
  const explicit = segment.match(
    /在([\u4e00-\u9fa5A-Za-z0-9'’&\-·]{2,14}?)(?:那笔|那一条|这笔|这一条|那条|这条|的)/,
  );
  if (explicit?.[1]) return { kind: "by_merchant", merchant: explicit[1] };

  if (!LAST_RE.test(segment)) {
    const merchant = findMerchant(segment).merchant;
    if (merchant) return { kind: "by_merchant", merchant };
  }
  return { kind: "last" };
}

/** 「改成 18 镑」取改后的金额；「不是 18 是 15」取最后一个金额 */
function correctionAmountOf(segment: string): AmountHit | null {
  const tail = segment.match(/(?:改成|改为|换成|应该是|其实是|是)\s*([^,;]*)$/);
  if (tail?.[1]) {
    const hit = findAmount(tail[1]);
    if (hit) return hit;
  }
  return findAmount(segment);
}

function parseCorrectionWithRules(
  transcript: string,
  segment: string,
  intent: CaptureIntent,
  ctx: RuleParseContext,
): ParsedCapture {
  const target = correctionTargetOf(segment, ctx);
  const changes: CorrectionPatch = {};

  if (intent === "correct") {
    const hit = correctionAmountOf(segment);
    if (hit) {
      changes.amount = hit.amount;
      // 只有句中明确说了币种才改币种，否则沿用原记录的币种
      if (hit.currency) changes.currency = hit.currency;
    }
    const category = findCategory(segment);
    if (category.matched) changes.categoryKey = category.key;
    const merchantHit = findMerchant(segment);
    if (merchantHit.merchant) changes.merchant = merchantHit.merchant;
    const payment = findPaymentMethod(segment);
    if (payment) changes.paymentMethod = payment;
  }

  const hasChanges = Object.keys(changes).length > 0;
  return {
    transcript,
    intent,
    drafts: [],
    correction: {
      target,
      changes,
      confidence: intent === "delete" ? 0.75 : hasChanges ? 0.7 : 0.35,
      reason: "规则解析（未启用大模型或大模型不可用）",
    },
    warnings:
      intent === "correct" && !hasChanges
        ? ["没听清要改成什么，试试「刚才那笔改成 18 镑」。"]
        : [],
    engine: "rules",
    model: null,
  };
}

export function parseCaptureWithRules(
  transcript: string,
  ctx: RuleParseContext,
): ParsedCapture {
  const normalized = normalize(transcript);
  const segments = splitSegments(normalized);

  // 先判断是不是在改/删已有记录，是的话就不走「新记一笔」的流程
  const correctionIntent = detectCorrectionIntent(segments[0] ?? normalized);
  if (correctionIntent) {
    return parseCorrectionWithRules(transcript, segments[0] ?? normalized, correctionIntent, ctx);
  }
  const drafts: Array<ExpenseDraft & { confidence: number; reason?: string }> = [];
  const warnings: string[] = [];

  for (const segment of segments.length > 0 ? segments : [normalized]) {
    const amountHit = findAmount(segment);
    if (!amountHit || amountHit.amount <= 0) {
      if (segment.trim().length > 0) warnings.push(`没听清金额：「${segment.trim()}」`);
      continue;
    }
    const category = findCategory(segment);
    const merchantHit = findMerchant(segment);
    const payment = findPaymentMethod(segment);
    const spentOn = findDate(segment, ctx);

    // 币种优先级：句中明确说的 > 该笔消费所属分段的币种 > 兜底默认币种
    const fallback = ctx.defaultCurrencyForDate?.(spentOn) ?? ctx.defaultCurrency;
    const raw = (amountHit.currency ?? fallback).toUpperCase();
    const currency = isSupportedCurrency(raw) ? raw : fallback.toUpperCase();
    const note = buildNote(segment, [amountHit.span, merchantHit.span]);

    let confidence = 0.45;
    if (amountHit.amount > 0) confidence += 0.25;
    if (amountHit.explicitCurrency) confidence += 0.15;
    if (category.matched) confidence += 0.1;
    if (payment) confidence += 0.03;
    confidence = Math.min(0.95, Math.round(confidence * 100) / 100);

    drafts.push({
      amount: roundMoney(amountHit.amount, currency),
      currency,
      categoryKey: category.key,
      merchant: merchantHit.merchant,
      note,
      spentOn,
      paymentMethod: payment,
      source: "voice",
      rawInput: transcript,
      tags: [],
      aiConfidence: confidence,
      confidence,
      reason: "规则解析（未启用大模型或大模型不可用）",
    });
  }

  if (drafts.length === 0) {
    warnings.push("没能从这句话里识别出金额，试试「午餐 15 英镑」这样的说法。");
  }

  return { transcript, intent: "add", drafts, warnings, engine: "rules", model: null };
}

import "server-only";
import { aiConfig } from "../ai/config";
import { chatJson } from "../ai/chat";
import { aiPlanTripOutputSchema, type AiTripPlan } from "../schemas";

const SYSTEM_PROMPT = `你是专业的「旅行预算与行程规划」AI 助手。根据用户的口语或自然语言需求，生成结构化、极简实用的旅行预算方案。

硬性输出要求：
1. 只输出合法 JSON，结构必须符合规范：
   - name: 旅行名称。核心原则：忠实于用户的原话！用户若说「法国意大利9日游」，名称就直接叫「法国意大利9日游」，绝对不要擅自添加如「浪漫奢华探索之旅」等虚浮冗余的修饰词。
   - destination: 目的地名称（如：法国 · 意大利，或 日本 · 东京）
   - coverEmoji: 贴合目的地的Emoji国旗或标志物（如 🇫🇷, 🇮🇹, 🇯🇵, 🇬🇧, 🇨🇭, 🇹🇭, 🇪🇺 等）
   - startDate: YYYY-MM-DD
   - endDate: YYYY-MM-DD（天数必须与用户表达严格吻合，例如9日游即为起始日期到结束日期共9天）
   - baseCurrency: 本国结算基准币代码。关键原则：结算币种必须以用户的习惯和要求为主！
     * 若用户提了「预算1500英镑/镑」或「英镑记账」，基准币就是 GBP；
     * 若用户提了「美元/刀」，基准币就是 USD；
     * 若用户提了「人民币/元」，基准币就是 CNY；
     * 若用户人在海外或用英镑银行卡（哪怕去欧洲/日本旅游），只要提了英镑，基准币就是 GBP，方便用户与自己的银行账户对账；
     * 未提及任何特定货币时，默认 CNY。
   - budgets: 多币种预算数组。
     * 若用户指定了特定结算币种（如英镑 1500 镑），第一项主预算必须是该币种（GBP 1500，设为主预算）；
     * 若目的地使用当地货币（如法国意大利使用 EUR），可贴心地自动按大致汇率增加一项当地参考预算（例如 EUR 1750），方便在当地花现金时参照；
     * 预算金额必须是正数。
   - legs: 城市分段列表。重要原则：若用户未主动说明前几天在哪个城市、后几天在哪个城市，绝对不要擅自强行编造日程分段，legs 直接给空数组 []！只有在用户明确说了城市节奏安排时才输出分段。
   - suggestion: 简短贴心的预算建议（40字内）。

规划原则：
1. 结算基准币完全随用户：用户用什么币种看账单（英镑、美元、人民币等），基准币就定为什么，跨币种消费（如在欧洲花欧元）系统会自动按汇率折算回用户的基准币。
2. 命名尊重用户：保持简短自然，字面意思为主。
3. 极简实用：核心是帮用户管好总账和币种，不要增加虚假的城市日程负担。
`;

function fallbackTripPlan(prompt: string, today: string): AiTripPlan {
  const isJapan = /日本|东京|京都|大阪|北海道|冲绳/.test(prompt);
  const isUK = /英国|伦敦|爱丁堡|曼彻斯特/.test(prompt);
  const isEuro = /法国|意大利|欧洲|巴黎|罗马|米兰|德国|西班牙/.test(prompt);

  const hasGbp = /英镑|镑|gbp/i.test(prompt);
  const hasEur = /欧元|欧|eur/i.test(prompt);
  const hasUsd = /美元|刀|usd/i.test(prompt);
  const baseCurrency = hasGbp ? "GBP" : hasEur ? "EUR" : hasUsd ? "USD" : "CNY";

  // 提取用户可能提到的金额
  const amountMatch = prompt.match(/(\d+(?:\.\d+)?)\s*(?:万|k|千|镑|英镑|欧|欧元|元|块)?/i);
  let amount = 1500;
  if (amountMatch) {
    let raw = parseFloat(amountMatch[1]);
    if (prompt.includes("万")) raw *= 10000;
    else if (prompt.includes("k") || prompt.includes("K") || prompt.includes("千")) raw *= 1000;
    if (raw > 0) amount = raw;
  }

  // 提取用户可能提到的天数（如 9日游、9天）
  const daysMatch = prompt.match(/(\d+)\s*(?:日|天)/);
  const totalDays = daysMatch ? Math.max(1, parseInt(daysMatch[1], 10)) : 7;

  const startDate = today;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + totalDays - 1);
  const endDate = d.toISOString().slice(0, 10);

  const cleanName = prompt.replace(/^(我打算|我想去|计划去|准备去)/, "").trim() || "新旅行计划";

  if (isEuro) {
    const budgetList = baseCurrency === "GBP"
      ? [
          { currency: "GBP", amount, label: "英镑总预算" },
          { currency: "EUR", amount: Math.round(amount * 1.17), label: "折合欧元参考" },
        ]
      : [
          { currency: "EUR", amount: baseCurrency === "EUR" ? amount : 2000, label: "欧元现金/刷卡" },
          { currency: "CNY", amount: 5000, label: "人民币备用" },
        ];

    return {
      name: cleanName,
      destination: "法国 · 意大利",
      coverEmoji: "🇪🇺",
      startDate,
      endDate,
      baseCurrency,
      budgets: budgetList,
      legs: [],
      suggestion: baseCurrency === "GBP"
        ? "基准币已设为英镑，在欧洲消费欧元或英镑都会自动折算对账。"
        : "法意两国通用欧元，已为您设好预算与备用金。",
    };
  }

  if (isJapan) {
    const budgetList = baseCurrency === "GBP"
      ? [
          { currency: "GBP", amount, label: "英镑总预算" },
          { currency: "JPY", amount: Math.round(amount * 190), label: "折合日元参考" },
        ]
      : [
          { currency: "JPY", amount: 200000, label: "日元刷卡/现金" },
          { currency: "CNY", amount: 3000, label: "人民币备用" },
        ];

    return {
      name: cleanName,
      destination: "日本",
      coverEmoji: "🇯🇵",
      startDate,
      endDate,
      baseCurrency,
      budgets: budgetList,
      legs: [],
      suggestion: "已为您设置好预算方案，可在记账中随时调整。",
    };
  }

  if (isUK) {
    return {
      name: cleanName,
      destination: "英国",
      coverEmoji: "🇬🇧",
      startDate,
      endDate,
      baseCurrency: "GBP",
      budgets: [
        { currency: "GBP", amount, label: "英镑预算" },
      ],
      legs: [],
      suggestion: "已预设好英镑预算方案。",
    };
  }

  return {
    name: cleanName,
    destination: "旅行目的地",
    coverEmoji: "✈️",
    startDate,
    endDate,
    baseCurrency,
    budgets: [
      { currency: baseCurrency, amount, label: "总预算" },
    ],
    legs: [],
    suggestion: "已为您创建基础预算模板。",
  };
}

export async function generateAiTripPlan(prompt: string, clientToday?: string): Promise<AiTripPlan> {
  const today = clientToday && /^\d{4}-\d{2}-\d{2}$/.test(clientToday)
    ? clientToday
    : new Date().toISOString().slice(0, 10);

  const cfg = await aiConfig();
  if (!cfg) {
    return fallbackTripPlan(prompt, today);
  }

  try {
    const userPrompt = `today = ${today}\n用户需求：「${prompt}」`;
    const { data } = await chatJson({
      system: SYSTEM_PROMPT,
      user: userPrompt,
      schema: aiPlanTripOutputSchema,
      temperature: 0.2,
    });
    return data;
  } catch (error) {
    console.error("[generateAiTripPlan] 大模型规划失败，使用规则兜底:", error);
    return fallbackTripPlan(prompt, today);
  }
}

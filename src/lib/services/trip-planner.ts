import "server-only";
import { aiConfig } from "../ai/config";
import { chatJson } from "../ai/chat";
import { aiPlanTripOutputSchema, type AiTripPlan } from "../schemas";

const SYSTEM_PROMPT = `你是专业的「旅行预算与行程规划」AI 助手。根据用户的口语或自然语言需求，生成结构化、开箱即用的旅行预算与行程分段方案。

硬性输出要求：
1. 只输出合法 JSON，结构必须符合规范：
   - name: 旅行名称（如：日本关东关西国庆7日游）
   - destination: 目的地名称（如：日本 · 东京 · 京都）
   - coverEmoji: 贴合目的地的Emoji国旗或标志物（如 🇯🇵, 🇬🇧, 🇫🇷, 🇨🇭, 🇹🇭, 🇭🇰 等）
   - startDate: YYYY-MM-DD
   - endDate: YYYY-MM-DD（不能早于 startDate）
   - baseCurrency: 本国结算币种代码，默认 CNY
   - budgets: 多币种预算数组，至少包含目的地主要币种预算（如 JPY / GBP / EUR）以及人民币备用预算（CNY），amount 必须是正数。
   - legs: 城市/地区分段行程（若是多城市/多国旅行，按时间先后顺序合理分配各站天数，startDate 和 endDate 首尾相连无空隙；若单地旅行可给单段或空数组）。
   - suggestion: 简短温馨的预算规划亮点或贴士（50字内）。

规划原则：
1. 日期推算：以参考基准 today 为准。用户提到「国庆」推算当年 10月1日~10月7日（或对应天数）；提到「下周」「5天后」基于 today 正确计算；若未提具体日期只说了天数（如「7天」），默认从明天或 today 开始。
2. 币种：必须为 ISO 4217 三位大写代码（如 CNY, JPY, GBP, EUR, USD, THB, HKD, KRW, SGD, CHF, AUD 等）。
3. 预算换算与拆分：若用户只给了总人民币预算（如「总预算1万5」），按大致汇率折算为当地币种现金/刷卡额度，并留出合理的人民币备用预算。
4. 时区与代码：国家代码用 2 位 ISO 代码（如 JP, GB, FR, CH, TH, HK），时区标准准确（如 Asia/Tokyo, Europe/London, Europe/Paris）。
`;

function fallbackTripPlan(prompt: string, today: string): AiTripPlan {
  const isJapan = /日本|东京|京都|大阪|北海道|冲绳/.test(prompt);
  const isUK = /英国|伦敦|爱丁堡|曼彻斯特/.test(prompt);
  const isEuro = /欧洲|法国|巴黎|意大利|瑞士|德国|西班牙/.test(prompt);
  const isThai = /泰国|曼谷|清迈|普吉/.test(prompt);

  const startDate = today;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 6);
  const endDate = d.toISOString().slice(0, 10);

  if (isJapan) {
    return {
      name: "日本探索之旅",
      destination: "日本 · 东京",
      coverEmoji: "🇯🇵",
      startDate,
      endDate,
      baseCurrency: "CNY",
      budgets: [
        { currency: "JPY", amount: 200000, label: "日元现金/刷卡" },
        { currency: "CNY", amount: 3000, label: "人民币备用" },
      ],
      legs: [
        { name: "东京", countryCode: "JP", currency: "JPY", timezone: "Asia/Tokyo", startDate, endDate },
      ],
      suggestion: "为你预设了 7 天东京经典游预算，包含日元与人民币备用金。",
    };
  }

  if (isUK) {
    return {
      name: "英国漫步之旅",
      destination: "英国 · 伦敦",
      coverEmoji: "🇬🇧",
      startDate,
      endDate,
      baseCurrency: "CNY",
      budgets: [
        { currency: "GBP", amount: 1000, label: "英镑现金/刷卡" },
        { currency: "CNY", amount: 5000, label: "人民币备用" },
      ],
      legs: [
        { name: "伦敦", countryCode: "GB", currency: "GBP", timezone: "Europe/London", startDate, endDate },
      ],
      suggestion: "为你预设了伦敦 7 天出行预算方案。",
    };
  }

  return {
    name: "新旅行计划",
    destination: "旅行目的地",
    coverEmoji: "✈️",
    startDate,
    endDate,
    baseCurrency: "CNY",
    budgets: [
      { currency: "CNY", amount: 10000, label: "总预算" },
    ],
    suggestion: "已为你创建基础预算模板，可在表单中进一步调整。",
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

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
   - baseCurrency: 本国结算币种代码，默认 CNY
   - budgets: 多币种预算数组。针对目的地准确匹配币种（例如法国和意大利均通用 EUR 欧元，只需设置一个 EUR 预算和一个 CNY 备用金，不要冗余重复）。
   - legs: 城市分段列表。重要原则：若用户未主动说明前几天在哪个城市、后几天在哪个城市，绝对不要擅自强行编造日程分段，legs 直接给空数组 []！只有在用户明确说了城市节奏安排时才输出分段。
   - suggestion: 简短贴心的预算建议（40字内）。

规划原则：
1. 命名尊重用户：保持简短自然，字面意思为主。
2. 日期推算：以参考基准 today 为准。未提具体起止日期只说了天数（如「9日游」），默认从明天开始顺延9天。
3. 币种：必须为 ISO 4217 三位大写代码（如 EUR, GBP, JPY, CNY, USD, CHF 等）。欧洲多国（法意西德葡荷等）统一使用 EUR。
4. 极简实用：核心是帮用户管好总账和币种，不要增加虚假的城市日程负担。
`;

function fallbackTripPlan(prompt: string, today: string): AiTripPlan {
  const isJapan = /日本|东京|京都|大阪|北海道|冲绳/.test(prompt);
  const isUK = /英国|伦敦|爱丁堡|曼彻斯特/.test(prompt);
  const isEuro = /法国|意大利|欧洲|巴黎|罗马|米兰|德国|西班牙/.test(prompt);

  // 提取用户可能提到的天数（如 9日游、9天）
  const daysMatch = prompt.match(/(\d+)\s*(?:日|天)/);
  const totalDays = daysMatch ? Math.max(1, parseInt(daysMatch[1], 10)) : 7;

  const startDate = today;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + totalDays - 1);
  const endDate = d.toISOString().slice(0, 10);

  const cleanName = prompt.replace(/^(我打算|我想去|计划去|准备去)/, "").trim() || "新旅行计划";

  if (isEuro) {
    return {
      name: cleanName,
      destination: "法国 · 意大利",
      coverEmoji: "🇪🇺",
      startDate,
      endDate,
      baseCurrency: "CNY",
      budgets: [
        { currency: "EUR", amount: 2000, label: "欧元刷卡/现金" },
        { currency: "CNY", amount: 5000, label: "人民币备用" },
      ],
      legs: [],
      suggestion: "法意两国通用欧元，已为您设好统一的欧元预算与备用金。",
    };
  }

  if (isJapan) {
    return {
      name: cleanName,
      destination: "日本",
      coverEmoji: "🇯🇵",
      startDate,
      endDate,
      baseCurrency: "CNY",
      budgets: [
        { currency: "JPY", amount: 200000, label: "日元刷卡/现金" },
        { currency: "CNY", amount: 3000, label: "人民币备用" },
      ],
      legs: [],
      suggestion: "已预设好日元与人民币备用金预算，可在记账中随时调整。",
    };
  }

  if (isUK) {
    return {
      name: cleanName,
      destination: "英国",
      coverEmoji: "🇬🇧",
      startDate,
      endDate,
      baseCurrency: "CNY",
      budgets: [
        { currency: "GBP", amount: 1000, label: "英镑刷卡/现金" },
        { currency: "CNY", amount: 5000, label: "人民币备用" },
      ],
      legs: [],
      suggestion: "已预设好英镑与人民币备用金预算。",
    };
  }

  return {
    name: cleanName,
    destination: "旅行目的地",
    coverEmoji: "✈️",
    startDate,
    endDate,
    baseCurrency: "CNY",
    budgets: [
      { currency: "CNY", amount: 10000, label: "总预算" },
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

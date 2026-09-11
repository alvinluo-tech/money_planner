import "server-only";
import { formatMoney, formatPercent, safeDiv } from "../money";
import { summaryForPrompt, type BudgetSummary } from "../budget";
import { aiConfig } from "../ai/config";
import { chatJson } from "../ai/chat";
import { llmInsightSchema, type LlmInsight } from "../schemas";
import type { Category, Expense, Trip } from "../types";

/**
 * 预算分析。大模型负责「说人话 + 给建议」，数值判断全部来自 budget.ts 的确定性计算，
 * 所以即使模型胡说，也不会污染数字；模型不可用时用规则生成同样结构的结果。
 */

const SYSTEM_PROMPT = `你是严谨的旅行财务顾问。基于给定的确定性统计数字，判断用户这趟旅行的消费结构是否合理、预算能否撑到结束，并给出可执行建议。

要求：
1. 只输出 JSON：{"headline":"一句话结论(<=30字)","severity":"info|warn|critical","verdict":"on_track|watch|at_risk|over_budget","body":"2-4 句分析","bullets":["关键观察",...],"actions":["具体可执行建议",...],"projectedTotal":数字}
2. 绝对不要编造数字，只能用输入里给出的数据；可以在 body 里引用它们。
3. verdict 的判定：剩余预算充足且预测不超支=on_track；轻微超支风险=watch；明显超支或日均严重超标=at_risk；已经超支=over_budget。
4. actions 要具体到「接下来每天控制在 X」「哪一类该压缩」，不要写「注意节省」这种废话。
5. 语气像朋友里的那个懂理财的人，不说教。
`;

function buildUserPrompt(args: {
  trip: Trip;
  summary: BudgetSummary;
  expenses: Expense[];
  categories: Category[];
  question?: string;
}): string {
  const { trip, summary, expenses, categories } = args;
  const catName = new Map(categories.map((c) => [c.key, c.name]));
  const lines: string[] = [];
  lines.push("=== 行程与预算 ===");
  lines.push(summaryForPrompt(summary, `${trip.name}${trip.destination ? `（${trip.destination}）` : ""}`));
  if (summary.byLeg.length > 0) {
    lines.push("");
    lines.push("=== 分段（多国）===");
    for (const leg of summary.byLeg) {
      lines.push(
        `${leg.name}（${leg.currency}）${leg.startDate}~${leg.endDate} ${leg.days} 天：已花 ${formatMoney(leg.spent, summary.baseCurrency)}，参考额度 ${formatMoney(leg.referenceAllowance, summary.baseCurrency)}，用了 ${formatPercent(leg.utilization, 0)}${leg.isActive ? "（当前所在段）" : ""}`,
      );
    }
  }
  lines.push("");
  lines.push("=== 各币种预算消耗 ===");
  for (const b of summary.budgetByCurrency) {
    lines.push(
      `${b.currency} ${formatMoney(b.amount, b.currency)}（${b.label || "未命名"}）≈ ${formatMoney(b.amountBase, summary.baseCurrency)}，已用 ${formatPercent(b.consumedRatio, 0)}`,
    );
  }
  lines.push("");
  lines.push("=== 最近消费明细（最多 25 条）===");
  for (const e of expenses.slice(0, 25)) {
    lines.push(
      `${e.spentOn} ${catName.get(e.categoryKey ?? "other") ?? e.categoryKey} ${formatMoney(e.amount, e.currency)}（≈${formatMoney(e.baseAmount, e.baseCurrency)}）${e.merchant ? ` @${e.merchant}` : ""}${e.note ? `（${e.note}）` : ""}`,
    );
  }
  if (args.question) {
    lines.push("");
    lines.push(`=== 用户的问题 ===`);
    lines.push(args.question);
  }
  return lines.join("\n");
}

/** 规则兜底：完全基于确定性数字生成结论 */
export function ruleBasedInsight(summary: BudgetSummary): LlmInsight {
  const base = summary.baseCurrency;
  const top = summary.byCategory[0];
  const over = summary.byCategory.filter((c) => c.overIndex);

  let headline: string;
  let severity: LlmInsight["severity"];
  let body: string;

  if (summary.totalBudget <= 0) {
    headline = "还没设置预算，先把目标定下来";
    severity = "warn";
    body = `已经花了 ${formatMoney(summary.spent, base)}，但没有预算就无法判断节奏是否合理。建议先给这趟旅行设定一个总额。`;
  } else if (summary.health === "over_budget") {
    headline = `已超支 ${formatMoney(Math.abs(summary.remaining), base)}`;
    severity = "critical";
    body = `预算 ${formatMoney(summary.totalBudget, base)}，已花 ${formatMoney(summary.spent, base)}。剩余行程还有 ${summary.daysRemaining} 天，建议只保留住宿、交通和餐饮这类刚性支出。`;
  } else if (summary.health === "at_risk") {
    headline = `按当前节奏预计超支 ${formatMoney(summary.projectedOverrun, base)}`;
    severity = "critical";
    body = `日均已花 ${formatMoney(summary.actualDaily, base)}，健康日均是 ${formatMoney(summary.allowedDaily, base)}。照此下去 ${summary.daysTotal} 天总支出约 ${formatMoney(summary.projectedTotal, base)}。`;
  } else if (summary.health === "watch") {
    headline = "预算基本够用，但余量不多了";
    severity = "warn";
    body = `已用 ${formatPercent(summary.utilization, 0)}，预计总支出 ${formatMoney(summary.projectedTotal, base)}，略微超过预算。把日预算压到 ${formatMoney(summary.allowedDaily, base)} 以内就稳了。`;
  } else {
    headline = "节奏健康，预算撑得下来";
    severity = "info";
    body = `已用 ${formatPercent(summary.utilization, 0)}，日均 ${formatMoney(summary.actualDaily, base)} 低于健康线 ${formatMoney(summary.allowedDaily, base)}，预计总支出 ${formatMoney(summary.projectedTotal, base)}，在预算内。`;
  }

  const bullets: string[] = [];
  if (top) {
    bullets.push(
      `最大开销是${top.name}，${formatMoney(top.amount, base)}，占 ${formatPercent(top.share, 0)}（参考 ${formatPercent(top.idealShare, 0)}）`,
    );
  }
  for (const c of over.slice(0, 2)) {
    bullets.push(`${c.name}占比 ${formatPercent(c.share, 0)}，高于参考值 ${formatPercent(c.idealShare, 0)}`);
  }
  if (Number.isFinite(summary.runwayDays)) {
    bullets.push(`按当前日均，预算还能支撑约 ${summary.runwayDays} 天`);
  }
  if (summary.byCurrency.length > 1) {
    bullets.push(
      `涉及 ${summary.byCurrency.map((c) => c.currency).join("、")} 多币种消费，折算汇率见明细`,
    );
  }

  const actions: string[] = [];
  if (summary.remaining > 0) {
    actions.push(`把接下来的日预算控制在 ${formatMoney(summary.allowedDaily, base)} 以内`);
  } else {
    actions.push("只保留住宿、交通、餐饮等刚性支出，暂停购物类消费");
  }
  for (const c of over.slice(0, 2)) {
    actions.push(`压缩${c.name}：目前日均 ${formatMoney(c.dailyAverage, base)}，建议减半`);
  }
  if (actions.length < 2) actions.push("每天结束前扫一眼当日支出，避免小额消费累积");

  return {
    headline,
    severity,
    verdict: summary.health,
    body,
    bullets: bullets.slice(0, 6),
    actions: actions.slice(0, 5),
    projectedTotal: summary.projectedTotal,
  };
}

export interface AnalyzeArgs {
  trip: Trip;
  summary: BudgetSummary;
  expenses: Expense[];
  categories: Category[];
  question?: string;
}

export interface AnalyzeResult extends LlmInsight {
  engine: "llm" | "rules";
  model: string | null;
}

export async function analyzeTrip(args: AnalyzeArgs): Promise<AnalyzeResult> {
  const fallback = ruleBasedInsight(args.summary);
  if (!(await aiConfig())) return { ...fallback, engine: "rules", model: null };

  try {
    const { data, model } = await chatJson({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(args),
      schema: llmInsightSchema,
      temperature: 0.3,
    });
    return { ...data, engine: "llm", model };
  } catch (error) {
    console.error("[analyzeTrip] 大模型分析失败，降级到规则分析:", error);
    return { ...fallback, engine: "rules", model: null };
  }
}

/** 给 UI 用的一句话进度描述 */
export function paceLabel(summary: BudgetSummary): string {
  const ratio = safeDiv(summary.actualDaily, summary.allowedDaily);
  if (!Number.isFinite(ratio) || summary.allowedDaily === 0) return "—";
  if (ratio > 1.3) return "花得偏快";
  if (ratio > 1.05) return "略快于计划";
  if (ratio < 0.7) return "比计划省";
  return "节奏正常";
}

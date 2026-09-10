import type { BudgetHealth } from "@/lib/budget";

/** 纯展示辅助，客户端/服务端都能用（不依赖 server-only） */

export const HEALTH_META: Record<
  BudgetHealth,
  { label: string; tone: string; bg: string; text: string; bar: string }
> = {
  on_track: {
    label: "节奏健康",
    tone: "good",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    bar: "bg-emerald-500",
  },
  watch: {
    label: "略有压力",
    tone: "watch",
    bg: "bg-amber-50",
    text: "text-amber-700",
    bar: "bg-amber-500",
  },
  at_risk: {
    label: "有超支风险",
    tone: "risk",
    bg: "bg-rose-50",
    text: "text-rose-700",
    bar: "bg-rose-500",
  },
  over_budget: {
    label: "已经超支",
    tone: "risk",
    bg: "bg-rose-50",
    text: "text-rose-700",
    bar: "bg-rose-500",
  },
};

export const LEG_STATUS_META = {
  on_track: { label: "正常", bar: "bg-emerald-500", text: "text-emerald-700" },
  watch: { label: "略超", bar: "bg-amber-500", text: "text-amber-700" },
  over: { label: "超参考", bar: "bg-rose-500", text: "text-rose-700" },
} as const;

export const SEVERITY_META = {
  info: { label: "提示", bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-500" },
  warn: { label: "注意", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" },
  critical: { label: "警告", bg: "bg-rose-50", text: "text-rose-700", dot: "bg-rose-500" },
} as const;

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function dayLabel(date: string, today: string): string {
  if (date === today) return "今天";
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (date === yesterday.toISOString().slice(0, 10)) return "昨天";
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日 ${WEEKDAYS[d.getUTCDay()]}`;
}

export function shortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

export function timeLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function dateRangeLabel(start: string, end: string): string {
  return `${start.slice(5).replace("-", "/")} – ${end.slice(5).replace("-", "/")}`;
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

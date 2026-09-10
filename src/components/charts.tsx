"use client";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DayStat } from "@/lib/budget";
import { formatMoney } from "@/lib/money";
import { shortDate } from "@/lib/ui/format";

/** 累计支出 vs 计划额度。两条线一交叉就说明开始超节奏了。 */
export function DailyTrend({
  days,
  baseCurrency,
  today,
}: {
  days: DayStat[];
  baseCurrency: string;
  today: string;
}) {
  const data = days
    .filter((d) => d.allowed > 0)
    .map((d) => ({
      date: d.date,
      label: shortDate(d.date),
      实际累计: Math.round(d.cumulative),
      计划额度: Math.round(d.allowed),
    }));

  const compact = (v: number) =>
    v >= 10000 ? `${(v / 10000).toFixed(1)}万` : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);

  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <defs>
            <linearGradient id="actualFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0f766e" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#0f766e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8e5df" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "#6f665e" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tickFormatter={compact}
            tick={{ fontSize: 11, fill: "#6f665e" }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip
            formatter={(value, name) => [formatMoney(Number(value), baseCurrency), String(name)]}
            labelFormatter={(label) => String(label)}
            contentStyle={{
              backgroundColor: "#ffffff",
              borderRadius: 12,
              border: "1px solid #e8e5df",
              fontSize: 12,
              color: "#1c1917",
              boxShadow: "0 8px 24px -12px rgb(28 25 23 / 0.15)",
            }}
          />
          <ReferenceLine
            x={shortDate(today)}
            stroke="#b45309"
            strokeDasharray="4 4"
            label={{ value: "今天", position: "top", fontSize: 10, fill: "#b45309" }}
          />
          <Area
            type="monotone"
            dataKey="计划额度"
            stroke="#d6d2c9"
            strokeWidth={2}
            strokeDasharray="5 4"
            fill="none"
          />
          <Area
            type="monotone"
            dataKey="实际累计"
            stroke="#0f766e"
            strokeWidth={2.5}
            fill="url(#actualFill)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ChartSkeleton() {
  return (
    <div className="flex h-56 w-full animate-pulse items-center justify-center rounded-2xl bg-paper/50">
      <div className="flex items-end gap-2.5 opacity-60">
        <span className="h-10 w-4 rounded-t bg-line" />
        <span className="h-16 w-4 rounded-t bg-line" />
        <span className="h-12 w-4 rounded-t bg-line" />
        <span className="h-24 w-4 rounded-t bg-line" />
        <span className="h-20 w-4 rounded-t bg-line" />
        <span className="h-32 w-4 rounded-t bg-line" />
      </div>
    </div>
  );
}

/** 分类占比：纯 CSS 横条，比图表库更清晰也更轻 */
export function CategoryBars({
  items,
  baseCurrency,
}: {
  items: Array<{ key: string; name: string; emoji: string; color: string; amount: number; share: number; idealShare: number; overIndex: boolean; count: number }>;
  baseCurrency: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-muted">还没有消费记录</p>;
  }
  return (
    <ul className="space-y-3.5">
      {items.map((item) => (
        <li key={item.key}>
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <span className="flex items-center gap-2 text-sm text-ink">
              <span aria-hidden>{item.emoji}</span>
              {item.name}
              <span className="text-xs text-ink-muted">{item.count} 笔</span>
              {item.overIndex && (
                <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                  偏高
                </span>
              )}
            </span>
            <span className="tnum shrink-0 text-sm font-medium text-ink">
              {formatMoney(item.amount, baseCurrency)}
              <span className="ml-1.5 text-xs font-normal text-ink-muted">
                {(item.share * 100).toFixed(0)}%
              </span>
            </span>
          </div>
          <div className="relative h-2 overflow-hidden rounded-full bg-line/70">
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${Math.min(100, item.share * 100)}%`, backgroundColor: item.color }}
            />
            {item.idealShare > 0 && (
              <div
                className="absolute inset-y-0 w-px bg-ink/40"
                style={{ left: `${Math.min(100, item.idealShare * 100)}%` }}
                title={`参考占比 ${(item.idealShare * 100).toFixed(0)}%`}
              />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

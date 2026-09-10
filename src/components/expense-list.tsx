"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { formatMoney, formatPercent } from "@/lib/money";
import type { Category, Expense } from "@/lib/types";
import { cx, dayLabel, timeLabel } from "@/lib/ui/format";
import { ExpenseRowActions } from "@/components/expense-row-actions";

const PAYMENT_LABEL: Record<string, string> = {
  cash: "现金",
  card: "刷卡",
  alipay: "支付宝",
  wechat: "微信",
  other: "其他",
};

/**
 * 明细列表（客户端筛选）。
 * 行程一长，手机上纯滑动找一笔消费非常痛苦，所以把搜索和筛选放在本地做，
 * 输入即时响应，不需要往返服务端。
 */
export function ExpenseList({
  tripId,
  expenses,
  categories,
  baseCurrency,
  today,
  aiEnabled = false,
}: {
  tripId: string;
  expenses: Expense[];
  categories: Category[];
  baseCurrency: string;
  today: string;
  aiEnabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [categoryKey, setCategoryKey] = useState<string | null>(null);
  const [currency, setCurrency] = useState<string | null>(null);

  const catMeta = useMemo(() => new Map(categories.map((c) => [c.key, c])), [categories]);

  const currencies = useMemo(
    () => Array.from(new Set(expenses.map((e) => e.currency))).sort(),
    [expenses],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return expenses.filter((e) => {
      if (categoryKey && (e.categoryKey ?? "other") !== categoryKey) return false;
      if (currency && e.currency !== currency) return false;
      if (!q) return true;
      const haystack = [e.merchant, e.note, catMeta.get(e.categoryKey ?? "other")?.name, e.rawInput]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [expenses, query, categoryKey, currency, catMeta]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, e) => sum + e.baseAmount, 0),
    [filtered],
  );

  const groups = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) {
      const list = map.get(e.spentOn) ?? [];
      list.push(e);
      map.set(e.spentOn, list);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const activeFilter = categoryKey !== null || currency !== null;

  return (
    <div className="space-y-4">
      {/* 搜索 + 筛选 */}
      <div className="space-y-3">
        <input
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索商家、备注…"
          className="input"
          aria-label="搜索消费记录"
        />
        {aiEnabled && (
          <Link
            href={`/trips/${tripId}/insights?tab=chat${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ""}`}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-sm text-brand"
          >
            ✨ 用自然语言问 AI{query.trim() ? `：「${query.trim()}」` : ""}
          </Link>
        )}

        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <button
            type="button"
            onClick={() => setCategoryKey(null)}
            className={cx("chip shrink-0", categoryKey === null && "chip-active")}
          >
            全部
          </button>
          {categories.map((c) => {
            const count = expenses.filter((e) => (e.categoryKey ?? "other") === c.key).length;
            if (count === 0) return null;
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategoryKey(categoryKey === c.key ? null : c.key)}
                className={cx("chip shrink-0", categoryKey === c.key && "chip-active")}
              >
                <span aria-hidden>{c.emoji}</span>
                {c.name}
                <span className="text-ink-muted">{count}</span>
              </button>
            );
          })}
          {currencies.length > 1 &&
            currencies.map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setCurrency(currency === code ? null : code)}
                className={cx("chip shrink-0", currency === code && "chip-active")}
              >
                {code}
              </button>
            ))}
        </div>

        {(query || activeFilter) && (
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span className="tnum">
              筛出 {filtered.length} 笔 · {formatMoney(filteredTotal, baseCurrency)}
              <span className="ml-1">
                （占 {formatPercent(filteredTotal / (expenses.reduce((s, e) => s + e.baseAmount, 0) || 1), 0)}）
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategoryKey(null);
                setCurrency(null);
              }}
              className="min-h-9 font-medium text-brand"
            >
              清除筛选
            </button>
          </div>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="card flex flex-col items-center gap-2 px-5 py-12 text-center">
          <span className="text-3xl" aria-hidden>🧾</span>
          <p className="text-sm font-medium text-ink">
            {expenses.length === 0 ? "还没有任何消费记录" : "没有符合条件的记录"}
          </p>
          <p className="text-xs text-ink-muted">
            {expenses.length === 0
              ? "点击右下角按钮或底栏麦克风，说一句话立刻记下第一笔"
              : "尝试更换关键词或清除上方筛选条件"}
          </p>
        </div>
      )}

      {groups.map(([day, rows]) => {
        const dayTotal = rows.reduce((sum, e) => sum + e.baseAmount, 0);
        return (
          <section key={day} className="card overflow-hidden">
            <header className="flex items-baseline justify-between border-b border-line bg-paper/50 px-4 py-3">
              <h2 className="text-sm font-semibold">{dayLabel(day, today)}</h2>
              <span className="tnum text-xs text-ink-muted">
                {rows.length} 笔 · {formatMoney(dayTotal, baseCurrency)}
              </span>
            </header>
            <ul className="divide-y divide-line">
              {rows.map((e) => {
                const c = catMeta.get(e.categoryKey ?? "other");
                return (
                  <li key={e.id} className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base"
                        style={{ backgroundColor: `${c?.color ?? "#94a3b8"}1a` }}
                        aria-hidden
                      >
                        {c?.emoji ?? "💸"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {e.merchant || c?.name || "消费"}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-ink-muted">
                          {c?.name ?? "其他"} · {timeLabel(e.spentAt)}
                          {e.paymentMethod && ` · ${PAYMENT_LABEL[e.paymentMethod] ?? e.paymentMethod}`}
                          {e.source === "voice" && " · 语音"}
                          {e.note && ` · ${e.note}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="tnum text-sm font-semibold">{formatMoney(e.amount, e.currency)}</p>
                        {e.currency !== baseCurrency && (
                          <p className="tnum text-xs text-ink-muted">
                            ≈ {formatMoney(e.baseAmount, baseCurrency)}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* 编辑态单独占一行，避免把上面的 flex 行挤变形 */}
                    <ExpenseRowActions expense={e} categories={categories} today={today} />
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

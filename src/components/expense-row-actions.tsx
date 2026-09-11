"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CURRENCY_LIST } from "@/lib/currency";
import type { Category, Expense } from "@/lib/types";

/**
 * 明细行的编辑 / 删除。
 * 折叠时只有两个 44px 图标按钮；展开后表单单独占一行，
 * 不会把上面的「图标 + 商家 + 金额」那一行挤变形。
 */
export function ExpenseRowActions({
  expense,
  categories,
  today,
}: {
  expense: Expense;
  categories: Category[];
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(String(expense.amount));
  const [currency, setCurrency] = useState(expense.currency);
  const [categoryKey, setCategoryKey] = useState(expense.categoryKey ?? "other");
  const [merchant, setMerchant] = useState(expense.merchant ?? "");
  const [note, setNote] = useState(expense.note ?? "");
  const [spentOn, setSpentOn] = useState(expense.spentOn);

  const save = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return toast.error("金额不正确");
    setSaving(true);
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: expense.id,
          amount: value,
          currency,
          categoryKey,
          merchant: merchant.trim() || null,
          note: note.trim() || null,
          spentOn,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) return toast.error(data?.error ?? "保存失败");
      toast.success("已更新");
      setOpen(false);
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("删除这笔消费？")) return;
    try {
      const res = await fetch(`/api/expenses/${expense.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok) return toast.error(data?.error ?? "删除失败");
      toast.success("已删除");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    }
  };

  if (!open) {
    return (
      <div className="mt-1 flex items-center justify-end gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:bg-paper hover:text-ink active:scale-95"
          aria-label="编辑这笔消费"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          编辑
        </button>
        <button
          type="button"
          onClick={remove}
          className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-ink-muted transition-colors hover:bg-rose-50 hover:text-risk active:scale-95"
          aria-label="删除这笔消费"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          删除
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-3 border-t border-line pt-3">
      <div className="flex items-end gap-2.5">
        <div className="min-w-0 flex-1">
          <label className="label">金额</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="input tnum text-lg font-semibold"
          />
        </div>
        <div className="w-24 shrink-0">
          <label className="label">币种</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="input px-2">
            {CURRENCY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="label">分类</label>
        <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {categories.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setCategoryKey(c.key)}
              className={`chip shrink-0 ${categoryKey === c.key ? "chip-active" : ""}`}
            >
              <span aria-hidden>{c.emoji}</span>
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">商家</label>
          <input
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            placeholder="可留空"
            className="input"
          />
        </div>
        <div>
          <label className="label">日期</label>
          <input
            type="date"
            max={today}
            value={spentOn}
            onChange={(e) => setSpentOn(e.target.value)}
            className="input"
          />
        </div>
      </div>

      <div>
        <label className="label">备注 / 具体内容</label>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="如：吃麦当劳、从卢浮宫打车到凯旋门"
          className="input text-sm"
        />
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost flex-1">
          取消
        </button>
        <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1">
          {saving ? "保存中…" : "保存"}
        </button>
      </div>
    </div>
  );
}

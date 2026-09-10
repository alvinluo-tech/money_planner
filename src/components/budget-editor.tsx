"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CURRENCY_LIST } from "@/lib/currency";
import type { TripBudget } from "@/lib/types";
import { cx } from "@/lib/ui/format";

interface Row {
  uid: string;
  currency: string;
  amount: string;
  label: string;
}

export function BudgetEditor({
  tripId,
  budgets,
  baseCurrency,
}: {
  tripId: string;
  budgets: TripBudget[];
  baseCurrency: string;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(
    budgets.map((b, i) => ({
      uid: `${b.id}-${i}`,
      currency: b.currency,
      amount: String(b.amount),
      label: b.label,
    })),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const payload = rows
      .map((r) => ({ ...r, amount: Number(r.amount) }))
      .filter((r) => Number.isFinite(r.amount) && r.amount >= 0);
    if (payload.length === 0) return toast.error("至少保留一种货币");
    setSaving(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/budgets`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          budgets: payload.map((r, index) => ({
            currency: r.currency,
            amount: r.amount,
            label: r.label,
            isPrimary: index === 0,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) return toast.error(data.error ?? "保存失败");
      toast.success("预算已更新");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {rows.map((row, index) => (
        <div key={row.uid} className="grid grid-cols-[1fr_120px_32px] items-end gap-2">
          <div>
            {index === 0 && <label className="label">币种</label>}
            <select
              value={row.currency}
              onChange={(e) =>
                setRows((rs) => rs.map((r) => (r.uid === row.uid ? { ...r, currency: e.target.value } : r)))
              }
              className="input"
            >
              {CURRENCY_LIST.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            {index === 0 && <label className="label">金额</label>}
            <input
              type="number"
              inputMode="decimal"
              value={row.amount}
              onChange={(e) =>
                setRows((rs) => rs.map((r) => (r.uid === row.uid ? { ...r, amount: e.target.value } : r)))
              }
              className="input tnum"
            />
          </div>
          <button
            type="button"
            onClick={() => setRows((rs) => rs.filter((r) => r.uid !== row.uid))}
            disabled={rows.length <= 1}
            className={cx("pb-3 text-ink-muted transition hover:text-risk", rows.length <= 1 && "opacity-30")}
            aria-label="删除"
          >
            ×
          </button>
          <div className="col-span-3 -mt-1">
            <input
              value={row.label}
              onChange={(e) =>
                setRows((rs) => rs.map((r) => (r.uid === row.uid ? { ...r, label: e.target.value } : r)))
              }
              placeholder="备注，例如「英镑现金」"
              className="input py-2 text-xs"
            />
          </div>
        </div>
      ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() =>
            setRows((rs) => [...rs, { uid: `n${Date.now()}`, currency: "USD", amount: "", label: "" }])
          }
          className="btn-ghost flex-1"
        >
          + 加一种货币
        </button>
        <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1">
          {saving ? "保存中…" : "保存预算"}
        </button>
      </div>

      <p className="text-xs leading-relaxed text-ink-muted">
        所有消费会按记账当时的汇率折算成 {baseCurrency} 汇总。调整预算不会改写历史记录的汇率。
      </p>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { Trip } from "@/lib/types";

/** 行程元信息编辑 + 删除。预算在下面的 BudgetEditor 里单独维护。 */
export function TripSettingsForm({ trip }: { trip: Trip }) {
  const router = useRouter();
  const [name, setName] = useState(trip.name);
  const [destination, setDestination] = useState(trip.destination ?? "");
  const [emoji, setEmoji] = useState(trip.coverEmoji ?? "✈️");
  const [startDate, setStartDate] = useState(trip.startDate);
  const [endDate, setEndDate] = useState(trip.endDate);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const save = async () => {
    if (!name.trim()) return toast.error("名字不能为空");
    if (endDate < startDate) return toast.error("结束日期不能早于开始日期");
    setSaving(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          destination: destination.trim() || null,
          coverEmoji: emoji,
          startDate,
          endDate,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) return toast.error(data.error ?? "保存失败");
      toast.success("行程已更新");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`删除「${trip.name}」？预算和所有消费记录都会一起删除，无法恢复。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/trips/${trip.id}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "删除失败");
        return;
      }
      toast.success("行程已删除");
      router.push("/?all=1");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[64px_1fr] gap-3">
        <div>
          <label className="label">图标</label>
          <input
            value={emoji}
            onChange={(e) => setEmoji(e.target.value)}
            maxLength={4}
            className="input text-center text-xl"
          />
        </div>
        <div>
          <label className="label">名称</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
        </div>
      </div>
      <div>
        <label className="label">目的地</label>
        <input
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
          placeholder="英国"
          className="input"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">出发</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="input" />
        </div>
        <div>
          <label className="label">返回</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="input" />
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1 sm:flex-row">
        <button type="button" onClick={save} disabled={saving} className="btn-primary flex-1">
          {saving ? "保存中…" : "保存修改"}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="btn-ghost flex-1 border-rose-200 text-risk hover:bg-rose-50"
        >
          {deleting ? "删除中…" : "删除行程"}
        </button>
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        基准币 {trip.baseCurrency} 是历史记录的折算锚点，因此不提供修改；需要更换请新建行程。
      </p>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { TripLeg } from "@/lib/types";
import { LegsField, type LegRow } from "@/components/leg-editor";

/** 设置页里的分段编辑：单独保存，不影响预算与历史账目 */
export function LegsSettings({
  tripId,
  tripStart,
  tripEnd,
  legs,
}: {
  tripId: string;
  tripStart: string;
  tripEnd: string;
  legs: TripLeg[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState<LegRow[]>(
    legs.map((l, i) => ({
      uid: `leg-${l.id}-${i}`,
      name: l.name,
      countryCode: l.countryCode ?? "",
      currency: l.currency,
      timezone: l.timezone,
      startDate: l.startDate,
      endDate: l.endDate,
    })),
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/legs`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          legs: rows.map((r) => ({
            name: r.name,
            countryCode: r.countryCode || null,
            currency: r.currency,
            timezone: r.timezone,
            startDate: r.startDate,
            endDate: r.endDate,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) return toast.error(data.error ?? "保存失败");
      toast.success("行程分段已更新");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <LegsField value={rows} onChange={setRows} tripStart={tripStart} tripEnd={tripEnd} />
      <button type="button" onClick={save} disabled={saving} className="btn-primary w-full">
        {saving ? "保存中…" : "保存分段"}
      </button>
      <p className="text-xs leading-relaxed text-ink-muted">
        分段只影响「没说币种时的默认值」「跨时区的日期判定」和分段复盘，
        <strong className="font-medium text-ink-soft">不会改动任何已记录的金额与汇率</strong>。
      </p>
    </div>
  );
}

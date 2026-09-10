"use client";
import { CURRENCY_LIST } from "@/lib/currency";
import { COUNTRY_PRESETS, validateLegs } from "@/lib/legs";
import { cx } from "@/lib/ui/format";

export interface LegRow {
  uid: string;
  name: string;
  countryCode: string;
  currency: string;
  timezone: string;
  startDate: string;
  endDate: string;
}

export function newLegRow(startDate: string, endDate: string): LegRow {
  return {
    uid: `leg-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    countryCode: "",
    currency: "EUR",
    timezone: "Europe/Paris",
    startDate,
    endDate,
  };
}

/** 在上一段结束的次日开始，避免一添加就重叠 */
export function nextLegDates(rows: LegRow[], tripStart: string, tripEnd: string) {
  if (rows.length === 0) return { startDate: tripStart, endDate: tripEnd };
  const lastEnd = rows
    .map((r) => r.endDate)
    .sort()
    .at(-1)!;
  const next = new Date(`${lastEnd}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const start = next.toISOString().slice(0, 10);
  return { startDate: start > tripEnd ? tripEnd : start, endDate: tripEnd };
}

/**
 * 行程分段编辑器（多国旅行）。
 * 留空 = 单国行程，行为与以前完全一致；填了才会启用「按段推断币种/时区」。
 */
export function LegsField({
  value,
  onChange,
  tripStart,
  tripEnd,
}: {
  value: LegRow[];
  onChange: (rows: LegRow[]) => void;
  tripStart: string;
  tripEnd: string;
}) {
  const check = validateLegs(
    value.map((v) => ({
      name: v.name,
      currency: v.currency,
      timezone: v.timezone,
      startDate: v.startDate,
      endDate: v.endDate,
    })),
    tripStart,
    tripEnd,
  );

  const patch = (uid: string, changes: Partial<LegRow>) =>
    onChange(value.map((r) => (r.uid === uid ? { ...r, ...changes } : r)));

  const applyCountry = (uid: string, code: string) => {
    const preset = COUNTRY_PRESETS.find((c) => c.code === code);
    if (!preset) {
      patch(uid, { countryCode: code });
      return;
    }
    const current = value.find((r) => r.uid === uid);
    patch(uid, {
      countryCode: code,
      currency: preset.currency,
      timezone: preset.timezone,
      name: current?.name?.trim() ? current.name : preset.name,
    });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-ink">多国行程分段</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">
            可选。填了之后，语音里没说币种时会按当天所在国家推断；跨时区时「今天」也不会算错。
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const { startDate, endDate } = nextLegDates(value, tripStart, tripEnd);
            onChange([...value, newLegRow(startDate, endDate)]);
          }}
          className="btn-ghost shrink-0 px-3 py-2 text-xs"
        >
          + 加一段
        </button>
      </div>

      {value.length === 0 && (
        <p className="rounded-xl border border-dashed border-line bg-paper/60 px-4 py-4 text-center text-xs text-ink-muted">
          目前是单国行程。如果这趟要去多个国家，点「+ 加一段」。
        </p>
      )}

      {value.map((row, index) => (
        <div key={row.uid} className="card-flat space-y-3 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink-muted">第 {index + 1} 段</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((r) => r.uid !== row.uid))}
              className="icon-btn h-9 w-9 hover:bg-rose-50 hover:text-risk"
              aria-label={`删除第 ${index + 1} 段`}
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">国家 / 地区</label>
              <select
                value={row.countryCode}
                onChange={(e) => applyCountry(row.uid, e.target.value)}
                className="input"
              >
                <option value="">自定义</option>
                {COUNTRY_PRESETS.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">城市 / 名称</label>
              <input
                value={row.name}
                onChange={(e) => patch(row.uid, { name: e.target.value })}
                placeholder="伦敦"
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">币种</label>
              <select
                value={row.currency}
                onChange={(e) => patch(row.uid, { currency: e.target.value })}
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
              <label className="label">时区</label>
              <input
                value={row.timezone}
                onChange={(e) => patch(row.uid, { timezone: e.target.value })}
                placeholder="Europe/London"
                className="input"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">开始</label>
              <input
                type="date"
                value={row.startDate}
                min={tripStart}
                max={tripEnd}
                onChange={(e) => patch(row.uid, { startDate: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label">结束</label>
              <input
                type="date"
                value={row.endDate}
                min={tripStart}
                max={tripEnd}
                onChange={(e) => patch(row.uid, { endDate: e.target.value })}
                className="input"
              />
            </div>
          </div>
        </div>
      ))}

      {!check.ok && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          {check.errors.map((err) => (
            <li key={err} className="text-xs text-amber-800">
              · {err}
            </li>
          ))}
        </ul>
      )}

      {value.length > 0 && (
        <p className={cx("text-xs", check.ok ? "text-ink-muted" : "text-amber-700")}>
          相邻两段可以共用同一天（转机日），那天会算进后一段。
        </p>
      )}
    </div>
  );
}

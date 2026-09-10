"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { CURRENCY_LIST } from "@/lib/currency";
import { validateLegs } from "@/lib/legs";
import { cx } from "@/lib/ui/format";
import { LegsField, newLegRow, type LegRow } from "@/components/leg-editor";

interface BudgetRow {
  uid: string;
  currency: string;
  amount: string;
  label: string;
}

interface PresetLeg {
  name: string;
  countryCode: string;
  currency: string;
  timezone: string;
  /** 相对出发日的偏移 */
  from: number;
  to: number;
}

interface Preset {
  emoji: string;
  name: string;
  destination: string;
  days: number;
  currencies: Array<{ currency: string; label: string; amount: string }>;
  /** 多国行程的模板分段；不填 = 单国行程 */
  legs?: PresetLeg[];
}

const PRESETS: Preset[] = [
  {
    emoji: "🌍",
    name: "英法瑞 13 天",
    destination: "英国 · 法国 · 瑞士",
    days: 13,
    currencies: [
      { currency: "GBP", label: "英镑现金", amount: "1000" },
      { currency: "CNY", label: "人民币备用", amount: "10000" },
    ],
    legs: [
      { name: "伦敦", countryCode: "GB", currency: "GBP", timezone: "Europe/London", from: 0, to: 3 },
      { name: "巴黎", countryCode: "FR", currency: "EUR", timezone: "Europe/Paris", from: 4, to: 7 },
      { name: "苏黎世", countryCode: "CH", currency: "CHF", timezone: "Europe/Zurich", from: 8, to: 12 },
    ],
  },
  {
    emoji: "🇬🇧",
    name: "英国 13 天",
    destination: "英国",
    days: 13,
    currencies: [
      { currency: "GBP", label: "英镑现金", amount: "1000" },
      { currency: "CNY", label: "人民币备用", amount: "10000" },
    ],
  },
  {
    emoji: "🇯🇵",
    name: "日本 8 天",
    destination: "日本",
    days: 8,
    currencies: [
      { currency: "JPY", label: "日元现金", amount: "150000" },
      { currency: "CNY", label: "人民币备用", amount: "5000" },
    ],
  },
  {
    emoji: "🇹🇭",
    name: "泰国 7 天",
    destination: "泰国",
    days: 7,
    currencies: [
      { currency: "THB", label: "泰铢现金", amount: "30000" },
      { currency: "CNY", label: "人民币备用", amount: "3000" },
    ],
  },
];

function isoToday(offset = 0): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

export function TripForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [emoji, setEmoji] = useState("✈️");
  const [startDate, setStartDate] = useState(isoToday(0));
  const [endDate, setEndDate] = useState(isoToday(12));
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [budgets, setBudgets] = useState<BudgetRow[]>([
    { uid: "b1", currency: "GBP", amount: "1000", label: "英镑现金" },
    { uid: "b2", currency: "CNY", amount: "10000", label: "人民币备用" },
  ]);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [saving, setSaving] = useState(false);

  const days = useMemo(() => {
    const a = Date.parse(`${startDate}T00:00:00Z`);
    const b = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86_400_000) + 1;
  }, [startDate, endDate]);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setName(preset.name);
    setDestination(preset.destination);
    setEmoji(preset.emoji);
    setStartDate(isoToday(0));
    setEndDate(isoToday(preset.days - 1));
    setBudgets(
      preset.currencies.map((c, i) => ({
        uid: `p${i}`,
        currency: c.currency,
        amount: c.amount,
        label: c.label,
      })),
    );
    // 预设里带分段模板的话一并填好（例如「英法瑞」）
    if (preset.legs) {
      setLegs(
        preset.legs.map((l, i) => ({
          ...newLegRow(isoToday(l.from), isoToday(l.to)),
          uid: `pl${i}`,
          name: l.name,
          countryCode: l.countryCode,
          currency: l.currency,
          timezone: l.timezone,
        })),
      );
    } else {
      setLegs([]);
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.error("给旅行起个名字吧");
    if (days <= 0) return toast.error("结束日期不能早于开始日期");
    const rows = budgets
      .map((b) => ({ ...b, amount: Number(b.amount) }))
      .filter((b) => Number.isFinite(b.amount) && b.amount > 0);
    if (rows.length === 0) return toast.error("至少填一个币种的预算");
    const legCheck = validateLegs(
      legs.map((l) => ({
        name: l.name,
        currency: l.currency,
        timezone: l.timezone,
        startDate: l.startDate,
        endDate: l.endDate,
      })),
      startDate,
      endDate,
    );
    if (!legCheck.ok) return toast.error(legCheck.errors[0]);

    setSaving(true);
    try {
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          destination: destination.trim() || null,
          startDate,
          endDate,
          baseCurrency,
          timezone: "Asia/Shanghai",
          coverEmoji: emoji,
          budgets: rows.map((b, index) => ({
            currency: b.currency,
            amount: b.amount,
            label: b.label,
            isPrimary: index === 0,
          })),
          legs: legs.map((l) => ({
            name: l.name,
            countryCode: l.countryCode || null,
            currency: l.currency,
            timezone: l.timezone,
            startDate: l.startDate,
            endDate: l.endDate,
          })),
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; trip?: { id: string } };
      if (!res.ok || !data.trip) {
        toast.error(data.error ?? "创建失败");
        return;
      }
      toast.success("行程已创建");
      router.push(`/trips/${data.trip.id}`);
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <section className="card p-5">
        <h2 className="section-title mb-3">快速开始</h2>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button key={preset.name} type="button" onClick={() => applyPreset(preset)} className="chip">
              <span aria-hidden>{preset.emoji}</span>
              {preset.name}
            </button>
          ))}
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="section-title">行程</h2>
        <div className="grid grid-cols-[64px_1fr] gap-3">
          <div>
            <label className="label">图标</label>
            <input value={emoji} onChange={(e) => setEmoji(e.target.value)} className="input text-center text-xl" maxLength={4} />
          </div>
          <div>
            <label className="label">名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="伦敦 · 爱丁堡 13 天" className="input" />
          </div>
        </div>
        <div>
          <label className="label">目的地</label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="英国" className="input" />
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
        <p className="text-xs text-ink-muted">共 {days} 天</p>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="section-title">预算（可多币种组合）</h2>
          <button
            type="button"
            onClick={() =>
              setBudgets((rows) => [
                ...rows,
                { uid: `b${Date.now()}`, currency: "USD", amount: "", label: "" },
              ])
            }
            className="text-xs font-medium text-brand underline-offset-2 hover:underline"
          >
            + 加一种货币
          </button>
        </div>

        {budgets.map((row, index) => (
          <div key={row.uid} className="grid grid-cols-[1fr_120px_32px] items-end gap-2">
            <div>
              {index === 0 && <label className="label">币种</label>}
              <select
                value={row.currency}
                onChange={(e) =>
                  setBudgets((rows) => rows.map((r) => (r.uid === row.uid ? { ...r, currency: e.target.value } : r)))
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
                  setBudgets((rows) => rows.map((r) => (r.uid === row.uid ? { ...r, amount: e.target.value } : r)))
                }
                placeholder="1000"
                className="input tnum"
              />
            </div>
            <button
              type="button"
              onClick={() => setBudgets((rows) => rows.filter((r) => r.uid !== row.uid))}
              disabled={budgets.length <= 1}
              className={cx("pb-3 text-ink-muted transition hover:text-risk", budgets.length <= 1 && "opacity-30")}
              aria-label="删除该币种"
            >
              ×
            </button>
            <div className="col-span-3 -mt-1">
              <input
                value={row.label}
                onChange={(e) =>
                  setBudgets((rows) => rows.map((r) => (r.uid === row.uid ? { ...r, label: e.target.value } : r)))
                }
                placeholder="备注，例如「英镑现金」"
                className="input py-2 text-xs"
              />
            </div>
          </div>
        ))}

        <div>
          <label className="label">记账基准币（所有消费折算到这个币种汇总）</label>
          <select value={baseCurrency} onChange={(e) => setBaseCurrency(e.target.value)} className="input">
            {CURRENCY_LIST.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {c.name}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="card p-5">
        <LegsField
          value={legs}
          onChange={setLegs}
          tripStart={startDate}
          tripEnd={endDate}
        />
      </section>

      <div className="flex gap-3">
        <Link href="/" className="btn-ghost flex-1">
          取消
        </Link>
        <button type="button" onClick={submit} disabled={saving} className="btn-primary flex-1">
          {saving ? "创建中…" : "创建行程"}
        </button>
      </div>
    </div>
  );
}

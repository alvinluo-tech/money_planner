"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";
import { CURRENCY_LIST } from "@/lib/currency";
import { validateLegs } from "@/lib/legs";
import { cx } from "@/lib/ui/format";
import { LegsField, newLegRow, type LegRow } from "@/components/leg-editor";
import { VoiceInputButton } from "@/components/voice-input-button";

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
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPlanning, setAiPlanning] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");

  const handleAiPlan = async (overridePrompt?: string) => {
    const text = (overridePrompt || aiPrompt).trim();
    if (!text) {
      toast.error("请先说出或输入你的行程需求");
      return;
    }
    if (overridePrompt) {
      setAiPrompt(overridePrompt);
    }
    setAiPlanning(true);
    setAiSuggestion("");
    try {
      const res = await fetch("/api/trips/ai-plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text, today: isoToday(0) }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok || !data.plan) {
        throw new Error(data.error || "规划失败");
      }
      const p = data.plan;
      setName(p.name);
      setDestination(p.destination || "");
      setEmoji(p.coverEmoji || "✈️");
      setStartDate(p.startDate);
      setEndDate(p.endDate);
      setBaseCurrency(p.baseCurrency || "CNY");
      setBudgets(
        p.budgets.map((b: any, i: number) => ({
          uid: `ai-${i}-${Date.now()}`,
          currency: b.currency,
          amount: String(b.amount),
          label: b.label || "",
        })),
      );
      if (p.legs && p.legs.length > 0) {
        setLegs(
          p.legs.map((l: any, i: number) => ({
            ...newLegRow(l.startDate, l.endDate),
            uid: `ail-${i}-${Date.now()}`,
            name: l.name,
            countryCode: l.countryCode || "",
            currency: l.currency,
            timezone: l.timezone || "Asia/Shanghai",
          })),
        );
      } else {
        setLegs([]);
      }
      if (p.suggestion) {
        setAiSuggestion(p.suggestion);
      }
      toast.success(`✨ 已为你生成方案：「${p.name}」`);
    } catch (err: any) {
      toast.error(err.message || "AI 规划出错，请重试");
    } finally {
      setAiPlanning(false);
    }
  };

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
      {/* ---------- AI 智能一句话建行程 ---------- */}
      <section className="card border-brand/30 bg-gradient-to-br from-brand-soft/20 via-surface to-surface p-5 shadow-sm space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <h2 className="text-sm font-semibold text-ink">AI 语音 / 一句话智能建行程</h2>
          </div>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-medium text-brand">
            省心免打字
          </span>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          点击右侧麦克风说出需求，或直接输入；AI 将自动推算日期、目的地时区、换算多币种预算并智能划分城市分段。
        </p>

        <div className="relative flex items-center">
          <input
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !aiPlanning) {
                e.preventDefault();
                void handleAiPlan();
              }
            }}
            placeholder="例如：国庆去日本东京和京都7天，预算1万5人民币，主要用日元，备用人民币"
            className="input pr-24 text-sm"
            disabled={aiPlanning}
          />
          <div className="absolute right-2 flex items-center gap-1.5">
            <VoiceInputButton
              size="sm"
              title="语音说出需求"
              onTranscript={(text) => {
                setAiPrompt(text);
                void handleAiPlan(text);
              }}
            />
            <button
              type="button"
              onClick={() => void handleAiPlan()}
              disabled={aiPlanning || !aiPrompt.trim()}
              className="btn-brand h-7 px-2.5 text-xs shrink-0 flex items-center gap-1"
            >
              {aiPlanning ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  生成中
                </>
              ) : (
                "生成"
              )}
            </button>
          </div>
        </div>

        {/* 灵感快捷提示 */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-ink-muted">试试：</span>
          {[
            "国庆去日本东京和京都7天，预算1万5人民币",
            "下周去英国伦敦6天，预算1500镑",
            "法意瑞12天浪漫游，总预算2.5万",
            "周末去香港吃喝玩乐3天，预算5000港币",
          ].map((sample) => (
            <button
              key={sample}
              type="button"
              disabled={aiPlanning}
              onClick={() => {
                setAiPrompt(sample);
                void handleAiPlan(sample);
              }}
              className="rounded-lg bg-surface px-2 py-1 text-[11px] text-ink-soft border border-line hover:border-brand hover:text-brand transition-colors text-left"
            >
              {sample}
            </button>
          ))}
        </div>

        {aiSuggestion && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3 text-xs text-emerald-900 flex items-start gap-2">
            <span className="text-sm">💡</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-emerald-800">AI 规划建议</p>
              <p className="mt-0.5 text-emerald-700 leading-relaxed">{aiSuggestion}</p>
            </div>
          </div>
        )}
      </section>

      <section className="card p-5">
        <h2 className="section-title mb-3">常规模板快速开始</h2>
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

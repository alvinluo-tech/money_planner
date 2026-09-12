"use client";

import { useMemo, useState, useRef, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Sparkles,
  Loader2,
  Mic,
  MicOff,
  Check,
  Calendar,
  Coins,
  MapPin,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";
import { CURRENCY_LIST } from "@/lib/currency";
import { validateLegs } from "@/lib/legs";
import { cx } from "@/lib/ui/format";
import { LegsField, newLegRow, type LegRow } from "@/components/leg-editor";
import type { AiTripPlan } from "@/lib/schemas";

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
  from: number;
  to: number;
}

interface Preset {
  emoji: string;
  name: string;
  destination: string;
  days: number;
  currencies: Array<{ currency: string; label: string; amount: string }>;
  legs?: PresetLeg[];
}

const PRESETS: Preset[] = [
  {
    emoji: "🇯🇵",
    name: "日本经典 7 天",
    destination: "日本 · 东京 · 京都",
    days: 7,
    currencies: [
      { currency: "JPY", label: "日元刷卡/现金", amount: "180000" },
      { currency: "CNY", label: "人民币备用", amount: "3000" },
    ],
    legs: [
      { name: "东京", countryCode: "JP", currency: "JPY", timezone: "Asia/Tokyo", from: 0, to: 3 },
      { name: "京都", countryCode: "JP", currency: "JPY", timezone: "Asia/Tokyo", from: 4, to: 6 },
    ],
  },
  {
    emoji: "🇬🇧",
    name: "英国漫步 8 天",
    destination: "英国 · 伦敦 · 爱丁堡",
    days: 8,
    currencies: [
      { currency: "GBP", label: "英镑刷卡/现金", amount: "1200" },
      { currency: "CNY", label: "人民币备用", amount: "5000" },
    ],
    legs: [
      { name: "伦敦", countryCode: "GB", currency: "GBP", timezone: "Europe/London", from: 0, to: 4 },
      { name: "爱丁堡", countryCode: "GB", currency: "GBP", timezone: "Europe/London", from: 5, to: 7 },
    ],
  },
  {
    emoji: "🇹🇭",
    name: "泰国度假 6 天",
    destination: "泰国 · 曼谷 · 清迈",
    days: 6,
    currencies: [
      { currency: "THB", label: "泰铢现金", amount: "25000" },
      { currency: "CNY", label: "人民币备用", amount: "3000" },
    ],
    legs: [
      { name: "曼谷", countryCode: "TH", currency: "THB", timezone: "Asia/Bangkok", from: 0, to: 3 },
      { name: "清迈", countryCode: "TH", currency: "THB", timezone: "Asia/Bangkok", from: 4, to: 5 },
    ],
  },
  {
    emoji: "🌍",
    name: "英法 10 天",
    destination: "英国 · 法国",
    days: 10,
    currencies: [
      { currency: "GBP", label: "英镑", amount: "800" },
      { currency: "EUR", label: "欧元", amount: "900" },
      { currency: "CNY", label: "人民币备用", amount: "5000" },
    ],
    legs: [
      { name: "伦敦", countryCode: "GB", currency: "GBP", timezone: "Europe/London", from: 0, to: 4 },
      { name: "巴黎", countryCode: "FR", currency: "EUR", timezone: "Europe/Paris", from: 5, to: 9 },
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

  // 基础表单状态
  const [name, setName] = useState("");
  const [destination, setDestination] = useState("");
  const [emoji, setEmoji] = useState("✈️");
  const [startDate, setStartDate] = useState(isoToday(0));
  const [endDate, setEndDate] = useState(isoToday(6));
  const [baseCurrency, setBaseCurrency] = useState("CNY");
  const [budgets, setBudgets] = useState<BudgetRow[]>([
    { uid: "b1", currency: "CNY", amount: "10000", label: "总预算" },
  ]);
  const [legs, setLegs] = useState<LegRow[]>([]);
  const [saving, setSaving] = useState(false);

  // AI 规划与速览卡片
  const [hasPlan, setHasPlan] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiPlanning, setAiPlanning] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 原生语音录音状态与实时转写
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [liveTranscript, setLiveTranscript] = useState("");
  const recognitionRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveTranscriptRef = useRef("");

  // 天数计算
  const days = useMemo(() => {
    const a = Date.parse(`${startDate}T00:00:00Z`);
    const b = Date.parse(`${endDate}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return 0;
    return Math.round((b - a) / 86_400_000) + 1;
  }, [startDate, endDate]);

  // 调用 AI 规划服务
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
      const p = data.plan as AiTripPlan;
      setName(p.name);
      setDestination(p.destination || "");
      setEmoji(p.coverEmoji || "✈️");
      setStartDate(p.startDate);
      setEndDate(p.endDate);
      setBaseCurrency(p.baseCurrency || "CNY");
      setBudgets(
        p.budgets.map((b, i) => ({
          uid: `ai-${i}-${Date.now()}`,
          currency: b.currency,
          amount: String(b.amount),
          label: b.label || "",
        })),
      );
      if (p.legs && p.legs.length > 0) {
        setLegs(
          p.legs.map((l, i) => ({
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
      setHasPlan(true);
      toast.success(`✨ 已生成：「${p.name}」`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI 规划出错，请重试");
    } finally {
      setAiPlanning(false);
    }
  };

  // 停止录音
  const stopRecording = useCallback((andSubmit = false) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    setIsRecording(false);

    const finalText = liveTranscriptRef.current.trim();
    if (andSubmit) {
      if (finalText) {
        setAiPrompt(finalText);
        void handleAiPlan(finalText);
      } else {
        toast.error("未检测到有效声音，请重试或直接打字");
      }
    }
  }, []);

  // 启动原生语音录音与实时字字转写
  const startRecording = useCallback(() => {
    const w = typeof window !== "undefined" ? (window as any) : null;
    const Ctor = w?.SpeechRecognition || w?.webkitSpeechRecognition;
    if (!Ctor) {
      toast.error("当前浏览器暂不支持原生语音识别，请在 Chrome、Edge 或 Safari 中使用语音，或直接打字。");
      return;
    }

    try {
      liveTranscriptRef.current = "";
      setLiveTranscript("");
      setRecordingSeconds(0);

      const recognition = new Ctor();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onresult = (event: any) => {
        let interim = "";
        let final = "";
        for (let i = 0; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            final += res[0].transcript;
          } else {
            interim += res[0].transcript;
          }
        }
        const text = (final + interim).trim();
        if (text) {
          liveTranscriptRef.current = text;
          setLiveTranscript(text);
        }
      };

      recognition.onerror = (e: any) => {
        if (e.error !== "no-speech") {
          console.warn("[Speech] error:", e.error);
        }
        if (e.error === "not-allowed") {
          toast.error("请允许浏览器使用麦克风权限");
          stopRecording(false);
        }
      };

      recognition.onend = () => {
        setIsRecording(false);
        if (timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setRecordingSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err) {
      console.error("[Speech] start failed:", err);
      toast.error("启动麦克风失败，请检查浏览器权限");
      setIsRecording(false);
    }
  }, [stopRecording]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {}
      }
    };
  }, []);

  // 套用模板
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
    if (preset.legs && preset.legs.length > 0) {
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
    setAiSuggestion(`已为您套用「${preset.name}」成熟预算与城市分段模板。`);
    setHasPlan(true);
    toast.success(`已套用模板：${preset.name}`);
  };

  // 真正提交创建行程
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
      toast.success("行程创建成功，已就绪！");
      router.push(`/trips/${data.trip.id}`);
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* ---------- 1. AI 语音极速规划控制台（实时语音反馈 + 大麦克风） ---------- */}
      <section className="card border-brand/40 bg-gradient-to-br from-brand-soft/25 via-surface to-surface p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand text-white">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-ink">AI 语音一句话建行程</h2>
              <p className="text-[11px] text-ink-muted">无需繁琐手动算日期与填表单</p>
            </div>
          </div>
          <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
            零成本极速体验
          </span>
        </div>

        {/* 录音中的全景实时波形与打字机字幕反馈 */}
        {isRecording ? (
          <div className="animate-rise rounded-2xl border-2 border-brand/50 bg-surface p-5 shadow-sm space-y-4 text-center">
            <div className="flex items-center justify-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
              <span className="text-xs font-semibold text-rose-600">正在录音识别…</span>
              <span className="tnum rounded-md bg-paper px-2 py-0.5 text-xs font-mono font-medium text-ink-soft">
                {String(Math.floor(recordingSeconds / 60)).padStart(2, "0")}:
                {String(recordingSeconds % 60).padStart(2, "0")}
              </span>
            </div>

            {/* 音浪波形 */}
            <div className="flex h-12 items-end justify-center gap-1.5 py-1">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <span
                  key={i}
                  className="bar-bounce w-1.5 rounded-full bg-brand"
                  style={{ height: `${16 + (i % 4) * 10}px`, animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>

            {/* 实时动态字字转写字幕 */}
            <div className="min-h-[54px] rounded-xl bg-brand-soft/40 px-4 py-3 flex items-center justify-center">
              <p className="text-sm font-semibold text-brand leading-relaxed">
                {liveTranscript ? `「${liveTranscript}」` : "请说话…（例如：下周去日本东京和京都玩7天，预算1万5）"}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => stopRecording(false)}
                className="btn-ghost flex-1 py-2.5 text-xs"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => stopRecording(true)}
                className="btn-brand flex-[2] py-2.5 text-sm font-semibold shadow-sm"
              >
                说完并生成规划 ✨
              </button>
            </div>
          </div>
        ) : (
          /* 未录音状态：大号中心麦克风 + 快捷输入框 */
          <div className="space-y-3.5">
            <div className="flex flex-col items-center justify-center gap-2.5 py-2">
              <button
                type="button"
                onClick={startRecording}
                disabled={aiPlanning}
                className="animate-pulse-ring flex h-16 w-16 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/25 transition hover:scale-105 active:scale-95 disabled:opacity-50"
                aria-label="按一下开始说话"
              >
                <Mic className="h-7 w-7" />
              </button>
              <p className="text-xs font-medium text-ink-soft">
                {aiPlanning ? "AI 正在智能规划中…" : "点一下麦克风，说出你的旅行计划"}
              </p>
            </div>

            {/* 打字兜底输入框 */}
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
                placeholder="或直接打字：例如 国庆去日本东京和京都7天，预算1.5万"
                className="input pr-20 text-xs"
                disabled={aiPlanning}
              />
              <button
                type="button"
                onClick={() => void handleAiPlan()}
                disabled={aiPlanning || !aiPrompt.trim()}
                className="btn-brand absolute right-1.5 h-8 px-3 text-xs shrink-0 flex items-center gap-1"
              >
                {aiPlanning ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    规划中
                  </>
                ) : (
                  "生成"
                )}
              </button>
            </div>

            {/* 常用灵感快捷标签 */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <span className="text-[11px] text-ink-muted">试试灵感：</span>
              {[
                "国庆去日本东京和京都玩7天，预算1.5万",
                "下周去英国伦敦6天，预算1200镑",
                "周末去香港吃喝玩乐3天，预算5000港币",
                "泰国曼谷清迈6天度假，总预算6000",
              ].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  disabled={aiPlanning || isRecording}
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
          </div>
        )}
      </section>

      {/* ---------- 2. 核心体验成果：行程速览卡片 + 【一键直达记账】（零表单填写成本！） ---------- */}
      {hasPlan && (
        <section className="animate-rise card border-2 border-emerald-500/30 bg-surface p-5 shadow-md space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl">{emoji}</span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                    方案已生成
                  </span>
                  <span className="text-xs text-ink-muted">共 {days} 天</span>
                </div>
                <h3 className="mt-0.5 text-lg font-bold text-ink">{name}</h3>
                <p className="text-xs text-ink-soft flex items-center gap-1 mt-0.5">
                  <MapPin className="h-3 w-3 text-brand shrink-0" />
                  <span>{destination || "精彩旅行"}</span>
                  <span className="text-ink-muted mx-1">·</span>
                  <Calendar className="h-3 w-3 text-brand shrink-0" />
                  <span>{startDate} ~ {endDate}</span>
                </p>
              </div>
            </div>
          </div>

          {/* 预算结构亮点 */}
          <div className="rounded-xl bg-paper/80 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <Coins className="h-3.5 w-3.5 text-brand" />
              <span>多币种预算规划</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {budgets.map((b) => (
                <div
                  key={b.uid}
                  className="flex items-baseline gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs shadow-2xs"
                >
                  <span className="font-bold text-ink">{b.currency} {Number(b.amount).toLocaleString()}</span>
                  {b.label && <span className="text-[11px] text-ink-muted">({b.label})</span>}
                </div>
              ))}
            </div>
          </div>

          {/* 城市分段亮点 */}
          {legs.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink-soft">城市节奏安排：</p>
              <div className="flex flex-wrap items-center gap-2">
                {legs.map((leg, idx) => (
                  <div key={leg.uid} className="flex items-center gap-1.5 text-xs">
                    <span className="rounded-md bg-brand-soft/60 px-2 py-1 font-medium text-brand">
                      {leg.name}
                    </span>
                    {idx < legs.length - 1 && <span className="text-ink-muted">➔</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI 贴心建议 */}
          {aiSuggestion && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-xs text-emerald-900 leading-relaxed flex items-start gap-2">
              <span className="text-sm">💡</span>
              <p>{aiSuggestion}</p>
            </div>
          )}

          {/* 核心主动作：一键立刻出发，0表单摩擦！ */}
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={submit}
              disabled={saving}
              className="btn-brand w-full py-4 text-base font-bold shadow-md shadow-brand/20 transition hover:brightness-105 active:scale-[0.99] flex items-center justify-center gap-2"
            >
              {saving ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  正在创建并初始化账本…
                </>
              ) : (
                <>
                  <span>🚀</span>
                  <span>规划很满意，立刻创建并开始记账！</span>
                </>
              )}
            </button>
            <p className="text-center text-[11px] text-ink-muted">
              点击直接保存进入行程，无需填写下方繁琐表单
            </p>
          </div>
        </section>
      )}

      {/* ---------- 3. 经典快速模板（供不想说话的用户 1 秒套用） ---------- */}
      {!hasPlan && (
        <section className="card p-4 space-y-2.5">
          <p className="text-xs font-semibold text-ink-muted">或直接套用成熟模板快速开始：</p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                onClick={() => applyPreset(preset)}
                className="chip text-xs hover:border-brand hover:text-brand transition"
              >
                <span aria-hidden>{preset.emoji}</span>
                <span>{preset.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ---------- 4. 高级细节微调（默认折叠，降低 90% 认知成本） ---------- */}
      <section className="border-t border-line/60 pt-2 space-y-4">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="flex w-full items-center justify-between rounded-xl border border-line bg-surface px-4 py-3 text-xs font-medium text-ink-soft hover:bg-paper transition"
        >
          <span className="flex items-center gap-2">
            <span>⚙️</span>
            <span>{hasPlan ? "想要微调细节？（展开传统表单修改城市分段、多币种与日期）" : "手动填写完整表单"}</span>
          </span>
          <span className="text-ink-muted flex items-center gap-1">
            {showAdvanced ? "收起" : "展开编辑"}
            {showAdvanced ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>

        {showAdvanced && (
          <div className="animate-rise space-y-6 pt-1">
            {/* 行程基本信息 */}
            <div className="card space-y-4 p-5">
              <h2 className="section-title">行程基本信息</h2>
              <div className="grid grid-cols-[64px_1fr] gap-3">
                <div>
                  <label className="label">图标</label>
                  <input
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    className="input text-center text-xl"
                    maxLength={4}
                  />
                </div>
                <div>
                  <label className="label">行程名称</label>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：日本 7 日游"
                    className="input"
                  />
                </div>
              </div>
              <div>
                <label className="label">目的地</label>
                <input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="例如：日本 · 东京 · 京都"
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">出发日期</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">返回日期</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="input"
                  />
                </div>
              </div>
              <p className="text-xs text-ink-muted">共 {days} 天</p>
            </div>

            {/* 预算多币种编辑 */}
            <div className="card space-y-4 p-5">
              <div className="flex items-center justify-between">
                <h2 className="section-title">预算管理（支持多币种组合）</h2>
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
                        setBudgets((rows) =>
                          rows.map((r) => (r.uid === row.uid ? { ...r, currency: e.target.value } : r)),
                        )
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
                        setBudgets((rows) =>
                          rows.map((r) => (r.uid === row.uid ? { ...r, amount: e.target.value } : r)),
                        )
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
                        setBudgets((rows) =>
                          rows.map((r) => (r.uid === row.uid ? { ...r, label: e.target.value } : r)),
                        )
                      }
                      placeholder="备注，例如「日元刷卡」或「备用现金」"
                      className="input py-2 text-xs"
                    />
                  </div>
                </div>
              ))}

              <div>
                <label className="label">记账基准币（所有消费折算到这个币种汇总）</label>
                <select
                  value={baseCurrency}
                  onChange={(e) => setBaseCurrency(e.target.value)}
                  className="input"
                >
                  {CURRENCY_LIST.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 城市分段 */}
            <div className="card p-5">
              <LegsField
                value={legs}
                onChange={setLegs}
                tripStart={startDate}
                tripEnd={endDate}
              />
            </div>

            {/* 手动微调后的提交 */}
            <div className="flex gap-3">
              <Link href="/" className="btn-ghost flex-1">
                取消
              </Link>
              <button
                type="button"
                onClick={submit}
                disabled={saving}
                className="btn-primary flex-1 py-3 text-sm font-semibold"
              >
                {saving ? "创建中…" : "保存并创建行程"}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

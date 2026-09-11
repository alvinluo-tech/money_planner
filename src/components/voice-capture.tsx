"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CURRENCY_LIST } from "@/lib/currency";
import { formatMoney } from "@/lib/money";
import type { CaptureIntent, Expense, ParsedCapture, ParsedCorrection, PaymentMethod } from "@/lib/types";
import { cx } from "@/lib/ui/format";

type CategoryOption = { key: string; name: string; emoji: string; color: string };

interface DraftRow {
  uid: string;
  amount: string;
  currency: string;
  categoryKey: string;
  merchant: string;
  note: string;
  spentOn: string;
  paymentMethod: PaymentMethod | "";
  confidence: number;
  reason?: string;
  /** 默认折叠：手机上只暴露「金额 + 分类」，其余按需展开 */
  expanded: boolean;
}

type Phase = "idle" | "requesting" | "recording" | "transcribing" | "review" | "saving";

/** /api/capture 的响应体 */
type CaptureResponse = ParsedCapture & {
  ok?: boolean;
  error?: string;
  captureId?: string | null;
  target?: Expense | null;
};

/** 纠错时本地可编辑的字段 */
interface CorrectionDraft {
  amount: string;
  currency: string;
  categoryKey: string;
  merchant: string;
  note: string;
  spentOn: string;
}

const PAYMENT_LABELS: Array<{ value: PaymentMethod; label: string }> = [
  { value: "cash", label: "现金" },
  { value: "card", label: "刷卡" },
  { value: "alipay", label: "支付宝" },
  { value: "wechat", label: "微信" },
  { value: "other", label: "其他" },
];

const EXAMPLES = [
  "午餐 15 英镑",
  "打车花了 45 块",
  "coffee 4.5 pounds at Pret",
  "早饭 8 镑，地铁 3 镑，超市 22 镑",
];

export function VoiceCapture({
  tripId,
  today,
  baseCurrency,
  defaultCurrency,
  categories,
  sttEnabled,
  variant = "auto",
}: {
  tripId: string;
  today: string;
  baseCurrency: string;
  defaultCurrency: string;
  categories: CategoryOption[];
  sttEnabled: boolean;
  /** auto：手机用底部悬浮圆钮、桌面用右下角胶囊；inline：表单内整宽按钮 */
  variant?: "auto" | "inline";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [seconds, setSeconds] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [liveText, setLiveText] = useState("");
  const [manualText, setManualText] = useState("");
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [engine, setEngine] = useState<"llm" | "rules" | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [intent, setIntent] = useState<CaptureIntent>("add");
  const [correction, setCorrection] = useState<ParsedCorrection | null>(null);
  const [target, setTarget] = useState<Expense | null>(null);
  const [corr, setCorr] = useState<CorrectionDraft | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const browserTextRef = useRef("");
  const recognitionRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const submittingRef = useRef(false);
  /**
   * 面板会话代号。每次打开 / 关闭面板都自增；请求发出时记下当时的代号，
   * 响应回来代号对不上就丢弃 —— 关闭面板后在途的迟到响应不会污染下一次打开的状态。
   * （不能用可复位的布尔：reset 会把它翻回去，迟到响应就又漏进来了。）
   */
  const sessionGenRef = useRef(0);
  /** 开始录音时的会话代号，用于在 onstop 里判断录音期间面板是否被关闭 */
  const recordingGenRef = useRef(0);
  /** 本次解析对应的 capture 日志 id，落库成功后标记为 confirmed */
  const captureIdRef = useRef<string | null>(null);

  const reset = useCallback(() => {
    captureIdRef.current = null;
    setPhase("idle");
    setSeconds(0);
    setTranscript("");
    setManualText("");
    setDrafts([]);
    setWarnings([]);
    setEngine(null);
    setModel(null);
    setIntent("add");
    setCorrection(null);
    setTarget(null);
    setCorr(null);
    browserTextRef.current = "";
    setLiveText("");
  }, []);

  const openPanel = useCallback(() => {
    sessionGenRef.current += 1;
    reset();
    setOpen(true);
  }, [reset]);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      stopStream();
      recognitionRef.current?.abort();
    };
  }, [stopStream]);

  /** 浏览器自带识别作为「零成本兜底」，服务端没配 STT 时也能说话记账 */
  const startBrowserRecognition = () => {
    type SpeechCtor = new () => {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort: () => void;
    };
    const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
    const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const recognition = new Ctor();
      recognition.lang = "zh-CN";
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.onresult = (event) => {
        let text = "";
        for (let i = 0; i < event.results.length; i += 1) {
          text += event.results[i][0]?.transcript ?? "";
        }
        browserTextRef.current = text;
        setLiveText(text);
      };
      recognition.onerror = () => {};
      recognition.start();
      recognitionRef.current = recognition;
    } catch {
      // 浏览器不支持就忽略
    }
  };

  const applyParsed = useCallback(
    (data: CaptureResponse) => {
      captureIdRef.current = data.captureId ?? null;
      setTranscript(data.transcript ?? "");
      setWarnings(data.warnings ?? []);
      setEngine(data.engine ?? null);
      setModel(data.model ?? null);
      setIntent(data.intent ?? "add");
      setCorrection(data.correction ?? null);
      setTarget(data.target ?? null);

      // 纠错：把「要改成什么」摊成可编辑的本地状态
      if (data.intent && data.intent !== "add" && data.target) {
        const changes = data.correction?.changes ?? {};
        setCorr({
          amount: String(changes.amount ?? data.target.amount),
          currency: (changes.currency ?? data.target.currency).toUpperCase(),
          categoryKey: changes.categoryKey ?? data.target.categoryKey ?? "other",
          merchant: changes.merchant ?? data.target.merchant ?? "",
          note: changes.note ?? data.target.note ?? "",
          spentOn: changes.spentOn ?? data.target.spentOn ?? today,
        });
      } else {
        setCorr(null);
      }
      setDrafts(
        (data.drafts ?? []).map((d, index) => ({
          uid: `${index}-${Date.now()}`,
          amount: String(d.amount ?? ""),
          currency: (d.currency ?? defaultCurrency).toUpperCase(),
          categoryKey: d.categoryKey ?? "other",
          merchant: d.merchant ?? "",
          note: d.note ?? "",
          spentOn: d.spentOn ?? today,
          paymentMethod: d.paymentMethod ?? "",
          confidence: d.confidence ?? 0.7,
          reason: d.reason,
          expanded: false,
        })),
      );
      setPhase("review");
    },
    [defaultCurrency, today],
  );

  const submitAudio = useCallback(async () => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const gen = sessionGenRef.current;
    setPhase("transcribing");
    try {
      const blob = new Blob(chunksRef.current, {
        type: recorderRef.current?.mimeType || "audio/webm",
      });
      const browserText = browserTextRef.current.trim();

      const send = async (withAudio: boolean, text?: string) => {
        const form = new FormData();
        form.append("tripId", tripId);
        if (text) form.append("transcript", text);
        if (withAudio && blob.size > 0) form.append("audio", blob, "capture.webm");
        return fetch("/api/capture", { method: "POST", body: form });
      };

      let res = !sttEnabled && browserText ? await send(false, browserText) : await send(true);
      if (!res.ok && browserText && blob.size > 0) {
        // 云端识别不可用但浏览器听清了，用本地结果再试一次
        res = await send(false, browserText);
      }

      const data = (await res.json()) as CaptureResponse;
      if (sessionGenRef.current !== gen) return;
      if (!res.ok) {
        toast.error(data.error ?? "解析失败，请重试");
        setPhase("idle");
        return;
      }
      applyParsed(data);
    } catch (error) {
      if (sessionGenRef.current !== gen) return;
      console.error(error);
      toast.error("网络异常，请重试");
      setPhase("idle");
    } finally {
      submittingRef.current = false;
    }
  }, [sttEnabled, tripId, applyParsed]);

  const startRecording = async () => {
    setPhase("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamRef.current = stream;
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
      const mimeType = candidates.find(
        (t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t),
      );
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      browserTextRef.current = "";
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        stopStream();
        recognitionRef.current?.stop();
        // 录音期间面板被关掉的话不要提交，否则会污染下一次打开的状态
        if (sessionGenRef.current !== recordingGenRef.current) return;
        void submitAudio();
      };
      recorder.start();
      recorderRef.current = recorder;
      recordingGenRef.current = sessionGenRef.current;
      setPhase("recording");
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      startBrowserRecognition();
    } catch (error) {
      console.error(error);
      toast.error("无法访问麦克风，请检查浏览器权限，或改用文字输入");
      stopStream();
      setPhase("idle");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  };

  const submitText = async (text: string) => {
    const value = text.trim();
    if (!value) return;
    const gen = sessionGenRef.current;
    setPhase("transcribing");
    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, transcript: value }),
      });
      const data = (await res.json()) as CaptureResponse;
      if (sessionGenRef.current !== gen) return;
      if (!res.ok) {
        toast.error(data.error ?? "解析失败，请重试");
        setPhase("idle");
        return;
      }
      applyParsed(data);
    } catch {
      if (sessionGenRef.current !== gen) return;
      toast.error("网络异常，请重试");
      setPhase("idle");
    }
  };

  const patchDraft = (uid: string, patch: Partial<DraftRow>) => {
    setDrafts((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };

  const confirm = async () => {
    const payload = drafts
      .map((d) => ({
        amount: Number(d.amount),
        currency: d.currency,
        categoryKey: d.categoryKey,
        merchant: d.merchant || null,
        note: d.note || null,
        spentOn: d.spentOn,
        paymentMethod: d.paymentMethod || null,
        source: "voice" as const,
        rawInput: transcript || null,
        aiConfidence: d.confidence,
        aiModel: model,
      }))
      .filter((d) => Number.isFinite(d.amount) && d.amount > 0);

    if (payload.length === 0) {
      toast.error("至少保留一条有效记录");
      return;
    }

    setPhase("saving");
    try {
      const res = await fetch("/api/expenses", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, expenses: payload, captureId: captureIdRef.current }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; expenses?: unknown[] };
      if (!res.ok) {
        toast.error(data.error ?? "保存失败");
        setPhase("review");
        return;
      }
      toast.success(`已记下 ${data.expenses?.length ?? payload.length} 笔消费`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("保存失败，请重试");
      setPhase("review");
    }
  };

  const totalPreview = drafts.reduce((sum, d) => {
    const n = Number(d.amount);
    if (!Number.isFinite(n) || n <= 0) return sum;
    return sum + (d.currency === baseCurrency ? n : 0);
  }, 0);

  /** 纠错/删除：直接改或删掉已定位到的那一条 */
  const confirmCorrection = async () => {
    if (!target) return;
    setPhase("saving");
    try {
      if (intent === "delete") {
        const res = await fetch(`/api/expenses/${target.id}`, { method: "DELETE" });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "删除失败");
          setPhase("review");
          return;
        }
        toast.success("已删除那一笔");
      } else {
        const value = Number(corr?.amount);
        if (!Number.isFinite(value) || value <= 0) {
          toast.error("金额不对");
          setPhase("review");
          return;
        }
        const res = await fetch(`/api/expenses/${target.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: target.id,
            amount: value,
            currency: corr?.currency,
            categoryKey: corr?.categoryKey,
            merchant: corr?.merchant ? corr.merchant.trim() : null,
            note: corr?.note ? corr.note.trim() : null,
            spentOn: corr?.spentOn || undefined,
          }),
        });
        const data = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) {
          toast.error(data.error ?? "修改失败");
          setPhase("review");
          return;
        }
        toast.success("已更新那一笔");
      }
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
      setPhase("review");
    }
  };

  const close = useCallback(() => {
    // 先递增会话代号，让在途请求的响应回来时被丢弃
    const gen = sessionGenRef.current;
    sessionGenRef.current += 1;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopStream();
    recognitionRef.current?.abort();
    setOpen(false);
    // 等关闭动画结束后再清空，避免内容闪一下；
    // 期间重新打开过（代号已变）就跳过，否则会把新会话刚填的状态清掉
    window.setTimeout(() => {
      if (sessionGenRef.current === gen) reset();
    }, 200);
  }, [reset, stopStream]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <>
      {variant === "inline" ? (
        <button type="button" onClick={openPanel} className="btn-brand w-full py-3">
          <MicIcon className="h-5 w-5" />
          说一句话记账
        </button>
      ) : (
        <>
          {/* 手机：悬浮在底部标签栏的中间缺口上 */}
          <button
            type="button"
            onClick={openPanel}
            aria-label="说一句话记账"
            className="fab-bottom-mobile fixed left-1/2 z-40 flex h-14 w-14 -translate-x-1/2 items-center justify-center rounded-full bg-brand text-white shadow-lg shadow-brand/35 ring-4 ring-surface transition-transform active:scale-90 sm:hidden"
          >
            <MicIcon className="h-6 w-6" />
          </button>
          {/* 桌面：右下角胶囊 */}
          <button
            type="button"
            onClick={openPanel}
            className="fab-bottom-mobile fixed right-8 z-40 hidden items-center gap-2.5 rounded-full bg-ink px-6 py-4 text-sm font-medium text-white shadow-lg shadow-ink/25 transition-transform active:scale-95 sm:flex"
          >
            <MicIcon className="h-5 w-5" />
            说一句话记账
          </button>
        </>
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="voice-capture-title"
          className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
        >
          <button
            type="button"
            aria-label="关闭"
            onClick={close}
            className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
          />
          <div className="animate-rise relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl bg-surface sm:max-h-[88dvh] sm:rounded-3xl">
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" />
            <header className="flex items-center justify-between border-b border-line px-5 py-4">
              <div>
                <h2 id="voice-capture-title" className="text-base font-semibold">
                  {phase === "review"
                    ? intent === "delete"
                      ? "确认删除"
                      : intent === "correct"
                        ? "确认修改"
                        : "确认这笔消费"
                    : "语音记账"}
                </h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  {phase === "review"
                    ? engine === "llm"
                      ? `由 ${model ?? "大模型"} 解析，可直接修改`
                      : "本地规则解析，请核对金额与分类"
                    : sttEnabled
                      ? "说完点一下停止，AI 会自动整理"
                      : "浏览器本地识别，无需额外配置"}
                </p>
              </div>
              <button type="button" onClick={close} className="icon-btn" aria-label="关闭">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                </svg>
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {(phase === "idle" || phase === "requesting" || phase === "recording" || phase === "transcribing") && (
                <div className="space-y-6">
                  <div className="flex flex-col items-center gap-4 py-2">
                    {phase === "recording" ? (
                      <>
                        <div className="flex h-16 items-end gap-1.5">
                          {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                            <span
                              key={i}
                              className="bar-bounce w-2 rounded-full bg-brand"
                              style={{ height: `${18 + (i % 4) * 12}px`, animationDelay: `${i * 0.08}s` }}
                            />
                          ))}
                        </div>
                        <p className="tnum text-2xl font-semibold">
                          {String(Math.floor(seconds / 60)).padStart(2, "0")}:
                          {String(seconds % 60).padStart(2, "0")}
                        </p>
                        {liveText ? (
                          <div className="max-w-xs rounded-xl bg-brand-soft/40 px-3.5 py-2 text-center text-xs font-medium text-brand">
                            「{liveText}」
                          </div>
                        ) : (
                          <p className="text-xs text-ink-muted">清晰报出金额与消费项目，说完点停止</p>
                        )}
                        <button type="button" onClick={stopRecording} className="btn-primary px-8 py-3.5">
                          停止并整理
                        </button>
                      </>
                    ) : phase === "transcribing" ? (
                      <>
                        <span className="h-12 w-12 animate-spin rounded-full border-[3px] border-line border-t-brand" />
                        <p className="text-sm text-ink-soft">正在理解你说的话…</p>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={startRecording}
                          disabled={phase === "requesting"}
                          className="animate-pulse-ring flex h-20 w-20 items-center justify-center rounded-full bg-brand text-white transition hover:brightness-110 disabled:opacity-60"
                          aria-label="开始录音"
                        >
                          <MicIcon className="h-8 w-8" />
                        </button>
                        <p className="text-sm text-ink-soft">
                          {phase === "requesting" ? "正在请求麦克风权限…" : "点一下开始说话"}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="rounded-2xl border border-line bg-paper/60 p-4">
                    <p className="label">也可以直接打字</p>
                    <textarea
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      rows={2}
                      placeholder="例如：午饭 15 镑，地铁 3 镑"
                      className="input resize-none"
                    />
                    <button
                      type="button"
                      onClick={() => void submitText(manualText)}
                      disabled={!manualText.trim() || phase === "transcribing"}
                      className="btn-ghost mt-2.5 w-full"
                    >
                      解析这句话
                    </button>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {EXAMPLES.map((example) => (
                        <button
                          key={example}
                          type="button"
                          onClick={() => setManualText(example)}
                          className="chip"
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {phase === "review" || phase === "saving" ? (
                <div className="space-y-4">
                  {transcript && (
                    <div className="rounded-xl bg-paper px-4 py-3">
                      <p className="label mb-1">识别到的原话</p>
                      <p className="text-sm text-ink">「{transcript}」</p>
                    </div>
                  )}

                  {warnings.length > 0 && (
                    <ul className="space-y-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                      {warnings.map((w) => (
                        <li key={w} className="text-xs text-amber-800">
                          · {w}
                        </li>
                      ))}
                    </ul>
                  )}

                  {intent !== "add" ? (
                    <div className="card-flat p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-ink-muted">
                          {intent === "delete" ? "要删除的那一笔" : "要修改的那一笔"}
                        </span>
                        <ConfidenceBadge value={correction?.confidence ?? 0.7} />
                      </div>

                      {!target ? (
                        <p className="mt-3 text-sm text-ink-muted">
                          没找到要改的那一笔，去明细页手动改吧。
                        </p>
                      ) : (
                        <>
                          <div className="mt-3 rounded-xl bg-paper px-4 py-3">
                            <p className="text-xs text-ink-muted">原记录</p>
                            <p className="mt-1 text-sm">
                              {target.merchant || "消费"} ·{" "}
                              <span className="tnum font-medium">
                                {formatMoney(target.amount, target.currency)}
                              </span>
                              <span className="text-ink-muted">
                                {" "}
                                · {categories.find((c) => c.key === target.categoryKey)?.name ?? "其他"} ·{" "}
                                {target.spentOn}
                              </span>
                            </p>
                          </div>

                          {intent === "correct" && corr && (
                            <div className="mt-3 space-y-3">
                              <div className="flex items-end gap-2.5">
                                <div className="min-w-0 flex-1">
                                  <label className="label">改成</label>
                                  <input
                                    type="number"
                                    inputMode="decimal"
                                    step="0.01"
                                    value={corr.amount}
                                    onChange={(e) => setCorr({ ...corr, amount: e.target.value })}
                                    className="input tnum text-lg font-semibold"
                                  />
                                </div>
                                <div className="w-24 shrink-0">
                                  <label className="label">币种</label>
                                  <select
                                    value={corr.currency}
                                    onChange={(e) => setCorr({ ...corr, currency: e.target.value })}
                                    className="input px-2"
                                  >
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
                                      onClick={() => setCorr({ ...corr, categoryKey: c.key })}
                                      className={cx(
                                        "chip shrink-0",
                                        corr.categoryKey === c.key && "chip-active",
                                      )}
                                    >
                                      <span aria-hidden>{c.emoji}</span>
                                      {c.name}
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div className="flex gap-2">
                                <div className="min-w-0 flex-1">
                                  <label className="label">商家 / 地点</label>
                                  <input
                                    type="text"
                                    value={corr.merchant}
                                    onChange={(e) => setCorr({ ...corr, merchant: e.target.value })}
                                    placeholder="选填"
                                    className="input text-sm"
                                  />
                                </div>
                                <div className="w-36 shrink-0">
                                  <label className="label">日期</label>
                                  <input
                                    type="date"
                                    value={corr.spentOn}
                                    onChange={(e) => setCorr({ ...corr, spentOn: e.target.value })}
                                    className="input px-2 text-sm"
                                  />
                                </div>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  ) : drafts.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-muted">
                      没有识别出消费记录，换个说法再试试。
                    </p>
                  ) : (
                    drafts.map((draft, index) => (
                      <div key={draft.uid} className="card-flat p-4">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-medium text-ink-muted">第 {index + 1} 笔</span>
                          <div className="flex items-center gap-2">
                            <ConfidenceBadge value={draft.confidence} />
                            <button
                              type="button"
                              onClick={() => setDrafts((rows) => rows.filter((r) => r.uid !== draft.uid))}
                              className="text-xs text-ink-muted underline-offset-2 hover:text-risk hover:underline"
                            >
                              删除
                            </button>
                          </div>
                        </div>

                        {(draft.merchant || draft.note) && (
                          <div className="mb-2.5">
                            <p className="text-sm font-semibold text-ink">
                              {(draft.merchant && !["打车", "消费", "买东西"].includes(draft.merchant))
                                ? draft.merchant
                                : (draft.note || draft.merchant)}
                            </p>
                            {draft.note && draft.merchant && draft.note !== draft.merchant && (
                              <p className="mt-0.5 text-xs text-ink-muted">{draft.note}</p>
                            )}
                          </div>
                        )}

                        <div className="mt-1 flex items-end gap-2.5">
                          <div className="min-w-0 flex-1">
                            <label className="label">金额</label>
                            <input
                              type="number"
                              inputMode="decimal"
                              step="0.01"
                              value={draft.amount}
                              onChange={(e) => patchDraft(draft.uid, { amount: e.target.value })}
                              className="input tnum text-lg font-semibold"
                            />
                          </div>
                          <div className="w-24 shrink-0">
                            <label className="label">币种</label>
                            <select
                              value={draft.currency}
                              onChange={(e) => patchDraft(draft.uid, { currency: e.target.value })}
                              className="input px-2"
                            >
                              {CURRENCY_LIST.map((c) => (
                                <option key={c.code} value={c.code}>
                                  {c.code}
                                </option>
                              ))}
                              {!CURRENCY_LIST.some((c) => c.code === draft.currency) && (
                                <option value={draft.currency}>{draft.currency}</option>
                              )}
                            </select>
                          </div>
                        </div>

                        <div className="mt-3">
                          <label className="label">分类</label>
                          <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                            {categories.map((c) => (
                              <button
                                key={c.key}
                                type="button"
                                onClick={() => patchDraft(draft.uid, { categoryKey: c.key })}
                                className={cx("chip shrink-0", draft.categoryKey === c.key && "chip-active")}
                              >
                                <span aria-hidden>{c.emoji}</span>
                                {c.name}
                              </button>
                            ))}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => patchDraft(draft.uid, { expanded: !draft.expanded })}
                          className="mt-2 min-h-9 text-xs font-medium text-brand"
                        >
                          {draft.expanded ? "收起" : "更多选项：商家 / 备注 / 日期 / 支付方式"}
                        </button>

                        {draft.expanded && (
                          <div className="mt-2 space-y-3 border-t border-line pt-3">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="label">商家 / 地点</label>
                                <input
                                  value={draft.merchant}
                                  onChange={(e) => patchDraft(draft.uid, { merchant: e.target.value })}
                                  placeholder="可留空"
                                  className="input text-sm"
                                />
                              </div>
                              <div>
                                <label className="label">日期</label>
                                <input
                                  type="date"
                                  value={draft.spentOn}
                                  max={today}
                                  onChange={(e) => patchDraft(draft.uid, { spentOn: e.target.value })}
                                  className="input text-sm"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="label">备注 / 具体内容</label>
                              <input
                                value={draft.note}
                                onChange={(e) => patchDraft(draft.uid, { note: e.target.value })}
                                placeholder="如：吃麦当劳、从卢浮宫打车到凯旋门"
                                className="input text-sm"
                              />
                            </div>

                        <div className="mt-3">
                          <label className="label">支付方式</label>
                          <div className="flex flex-wrap gap-2">
                            {PAYMENT_LABELS.map((p) => (
                              <button
                                key={p.value}
                                type="button"
                                onClick={() =>
                                  patchDraft(draft.uid, {
                                    paymentMethod: draft.paymentMethod === p.value ? "" : p.value,
                                  })
                                }
                                className={cx("chip", draft.paymentMethod === p.value && "chip-active")}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        </div>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {(phase === "review" || phase === "saving") &&
              (intent !== "add" ? target !== null : drafts.length > 0) && (
                <footer className="pb-safe border-t border-line bg-surface px-5 pt-4">
                  <div className="mb-3 flex items-center justify-between text-sm">
                    <span className="text-ink-muted">
                      {intent !== "add"
                        ? intent === "delete"
                          ? "删除后无法恢复"
                          : "确认后立即生效"
                        : `共 ${drafts.length} 笔`}
                      {intent === "add" && totalPreview > 0 && ` · 其中 ${formatMoney(totalPreview, baseCurrency)}`}
                    </span>
                    <button
                      type="button"
                      onClick={reset}
                      className="min-h-9 text-xs text-ink-muted underline-offset-2 hover:underline"
                    >
                      重新开始
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={intent !== "add" ? confirmCorrection : confirm}
                    disabled={phase === "saving"}
                    className={cx(
                      "w-full py-3",
                      intent === "delete" ? "btn-primary bg-risk hover:bg-risk/90" : "btn-brand",
                    )}
                  >
                    {phase === "saving"
                      ? "处理中…"
                      : intent === "delete"
                        ? "确认删除"
                        : intent === "correct"
                          ? "确认修改"
                          : "确认记账"}
                  </button>
                </footer>
              )}
          </div>
        </div>
      )}
    </>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const tone =
    value >= 0.85
      ? "bg-emerald-50 text-emerald-700"
      : value >= 0.6
        ? "bg-amber-50 text-amber-700"
        : "bg-rose-50 text-rose-700";
  return (
    <span className={cx("rounded-full px-2 py-0.5 text-[11px] font-medium", tone)}>
      把握 {pct}%
    </span>
  );
}

function MicIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2">
      <path
        d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z"
        strokeLinecap="round"
      />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
    </svg>
  );
}

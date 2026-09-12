"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { AiInsight } from "@/lib/types";
import { cx, SEVERITY_META } from "@/lib/ui/format";
import { VoiceInputButton } from "@/components/voice-input-button";

interface InsightMetrics {
  verdict?: string;
  bullets?: string[];
  actions?: string[];
  engine?: string;
  projectedTotal?: number;
}

/** AI 分析面板：一键生成 + 可追问 */
export function InsightsPanel({
  tripId,
  insights,
  aiEnabled,
}: {
  tripId: string;
  insights: AiInsight[];
  aiEnabled: boolean;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [question, setQuestion] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [liveVoiceText, setLiveVoiceText] = useState("");
  const [items, setItems] = useState<AiInsight[]>(insights);

  const generate = async (withQuestion?: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, question: withQuestion || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; insight?: AiInsight };
      if (!res.ok || !data.insight) {
        toast.error(data.error ?? "分析失败");
        return;
      }
      setItems((prev) => [data.insight!, ...prev].slice(0, 10));
      toast.success("已生成新分析");
      setQuestion("");
      router.refresh();
    } catch {
      toast.error("网络异常，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <h2 className="section-title">让 AI 分析这趟旅行</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          {aiEnabled
            ? "会结合你的预算、日均节奏和消费结构给出判断与具体建议。"
            : "未配置大模型，将使用本地规则生成结论（数字同样准确，只是措辞更机械）。"}
        </p>
        <div className="mt-3 flex items-center gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="想问点什么？例如「我还能买那个包吗」"
            className="input flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !loading) void generate(question);
            }}
          />
          <VoiceInputButton
            onInterim={(text) => {
              setLiveVoiceText(text);
              setQuestion(text);
            }}
            onTranscript={(text) => {
              setQuestion(text);
              setIsListening(false);
              setLiveVoiceText("");
            }}
            onListeningChange={(active) => {
              setIsListening(active);
              if (!active) setLiveVoiceText("");
            }}
            title="语音提问"
          />
        </div>

        {isListening && (
          <div className="mt-2.5 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft/50 px-3.5 py-2 text-xs text-brand animate-in fade-in">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand" />
            </span>
            <span className="font-semibold shrink-0">正在聆听:</span>
            <span className="truncate font-medium text-ink">
              {liveVoiceText ? `「${liveVoiceText}」` : "请说话，如「我还能买那个包吗」..."}
            </span>
          </div>
        )}

        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => generate()} disabled={loading} className="btn-brand flex-1">
            {loading ? "分析中…" : "生成分析"}
          </button>
          <button
            type="button"
            onClick={() => generate(question)}
            disabled={loading || !question.trim()}
            className="btn-ghost"
          >
            带问题分析
          </button>
        </div>
      </section>

      {items.length === 0 && !loading && (
        <p className="py-8 text-center text-sm text-ink-muted">还没有分析记录。</p>
      )}

      {items.map((insight) => {
        const meta = SEVERITY_META[insight.severity];
        const metrics = (insight.metrics ?? {}) as InsightMetrics;
        return (
          <section key={insight.id} className="card p-5">
            <div className="flex items-start gap-2.5">
              <span className={cx("mt-1.5 h-2 w-2 shrink-0 rounded-full", meta.dot)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-base font-semibold">{insight.headline}</h3>
                  <span className={cx("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", meta.bg, meta.text)}>
                    {meta.label}
                  </span>
                </div>
                {insight.body && (
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{insight.body}</p>
                )}

                {metrics.bullets && metrics.bullets.length > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {metrics.bullets.map((b) => (
                      <li key={b} className="flex gap-2 text-sm text-ink-soft">
                        <span className="text-ink-muted">·</span>
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {metrics.actions && metrics.actions.length > 0 && (
                  <div className="mt-3 rounded-xl bg-brand-soft/60 px-4 py-3">
                    <p className="text-xs font-semibold text-brand">接下来可以这样做</p>
                    <ul className="mt-1.5 space-y-1">
                      {metrics.actions.map((a) => (
                        <li key={a} className="text-sm text-ink">
                          → {a}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="mt-3 text-xs text-ink-muted">
                  {new Date(insight.createdAt).toLocaleString("zh-CN", { hour12: false })} ·{" "}
                  {metrics.engine === "llm" ? (insight.model ?? "大模型") : "本地规则"}
                </p>
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

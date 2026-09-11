"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { AiMessage } from "@/lib/types";
import { cx } from "@/lib/ui/format";
import { VoiceInputButton } from "@/components/voice-input-button";

interface ChatItem {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: Array<{ name: string; summary: string }>;
  pending?: boolean;
  failed?: boolean;
}

const QUICK_QUESTIONS = [
  "这趟还剩多少钱？",
  "上个月在日本吃的最贵的一顿",
  "哪个国家花得最多",
  "如果我再买那个 300 镑的包会怎样",
];

const TOOL_LABEL: Record<string, string> = {
  query_expenses: "查询消费明细",
  aggregate_expenses: "汇总消费",
  get_budget_summary: "读取预算概览",
};

function toItems(messages: AiMessage[]): ChatItem[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    tools: [],
  }));
}

/**
 * AI 助手对话：多轮记忆 + 工具调用 + 流式输出。
 * 用 SSE 逐字渲染，用户能立刻看到模型在「想」什么，而不是干等一个 loading。
 */
export function AssistantChat({
  tripId,
  aiEnabled,
  initialThreadId,
  initialMessages,
  seedQuestion,
}: {
  tripId: string;
  aiEnabled: boolean;
  initialThreadId: string | null;
  initialMessages: AiMessage[];
  seedQuestion?: string;
}) {
  const [items, setItems] = useState<ChatItem[]>(() => toItems(initialMessages));
  const [input, setInput] = useState(seedQuestion ?? "");
  const [streaming, setStreaming] = useState(false);
  const threadRef = useRef<string | null>(initialThreadId);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
  }, [items, streaming]);

  const patchLast = useCallback((patch: (item: ChatItem) => ChatItem) => {
    setItems((prev) => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      next[next.length - 1] = patch(next[next.length - 1]);
      return next;
    });
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || streaming) return;

      setInput("");
      setStreaming(true);
      setItems((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: "user", content: text, tools: [] },
        { id: `a-${Date.now()}`, role: "assistant", content: "", tools: [], pending: true },
      ]);

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tripId, threadId: threadRef.current, message: text }),
        });

        if (!res.ok || !res.body) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          toast.error(data.error ?? "发送失败");
          patchLast((item) => ({ ...item, pending: false, failed: true }));
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handle = (event: string, payload: Record<string, unknown>) => {
          if (event === "thread" && typeof payload.threadId === "string") {
            threadRef.current = payload.threadId;
          } else if (event === "token" && typeof payload.text === "string") {
            const chunk = payload.text;
            patchLast((item) => ({ ...item, content: item.content + chunk }));
          } else if (event === "tool") {
            patchLast((item) => ({
              ...item,
              tools: [
                ...item.tools,
                {
                  name: String(payload.name ?? ""),
                  summary: String(payload.summary ?? ""),
                },
              ],
            }));
          } else if (event === "error") {
            toast.error(String(payload.message ?? "生成失败"));
            patchLast((item) => ({ ...item, pending: false, failed: true }));
          } else if (event === "done") {
            patchLast((item) => ({ ...item, pending: false }));
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            let event = "message";
            let data = "";
            for (const line of chunk.split("\n")) {
              if (line.startsWith("event:")) event = line.slice(6).trim();
              else if (line.startsWith("data:")) data += line.slice(5).trim();
            }
            if (!data) continue;
            try {
              handle(event, JSON.parse(data) as Record<string, unknown>);
            } catch {
              // 忽略解析不了的分片
            }
          }
        }
      } catch {
        toast.error("网络异常，请重试");
        patchLast((item) => ({ ...item, pending: false, failed: true }));
      } finally {
        setStreaming(false);
      }
    },
    [patchLast, streaming, tripId],
  );

  if (!aiEnabled) {
    return (
      <div className="card p-5">
        <p className="text-sm font-medium">还没配置大模型</p>
        <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
          在 <code className="font-mono">.env</code> 里填上{" "}
          <code className="font-mono">AI_API_KEY</code>（任何 OpenAI 兼容端点都行）并重启 dev
          server，就能用自然语言问问题了。没配置时，明细页的搜索框仍然可以按商家和备注筛选。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="card max-h-[60vh] min-h-[16rem] overflow-y-auto p-4">
        {items.length === 0 ? (
          <div className="py-6 text-center">
            <p className="text-sm text-ink-soft">
              {seedQuestion ? "问题已经帮你填好了，点发送就行" : "问点关于这趟旅行的事"}
            </p>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {QUICK_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => void send(q)}
                  className="chip"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li key={item.id} className={cx("flex", item.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[85%]", item.role === "user" ? "text-right" : "text-left")}>
                  {item.tools.length > 0 && (
                    <div className="mb-1.5 flex flex-wrap gap-1.5">
                      {item.tools.map((t, i) => (
                        <span
                          key={`${t.name}-${i}`}
                          className="rounded-full bg-paper px-2 py-0.5 text-[11px] text-ink-muted"
                        >
                          🔧 {TOOL_LABEL[t.name] ?? t.name}
                          {t.summary && ` · ${t.summary}`}
                        </span>
                      ))}
                    </div>
                  )}
                  <div
                    className={cx(
                      "whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                      item.role === "user"
                        ? "bg-ink text-white"
                        : item.failed
                          ? "border border-rose-200 bg-rose-50 text-rose-800"
                          : "bg-paper text-ink",
                    )}
                  >
                    {item.content || (item.pending ? "…" : "")}
                    {item.pending && item.content && (
                      <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-current align-middle" />
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="问点什么，比如「上个月在日本吃的最贵的一顿」"
            className="input pr-10"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            disabled={streaming}
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2">
            <VoiceInputButton
              size="sm"
              title="语音输入问题"
              onTranscript={(text) => {
                setInput((prev) => (prev ? `${prev} ${text}` : text));
              }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => void send(input)}
          disabled={streaming || !input.trim()}
          className="btn-brand shrink-0 px-5"
        >
          {streaming ? "…" : "发送"}
        </button>
      </div>

      <p className="text-[11px] leading-relaxed text-ink-muted">
        助手会调用工具查真实数据再回答，金额和日期不会凭空编。它会记住这段对话，但不会看到别的行程。
      </p>
    </div>
  );
}

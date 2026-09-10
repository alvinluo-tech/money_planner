"use client";
import { useState } from "react";
import type { AiInsight, AiMessage } from "@/lib/types";
import { cx } from "@/lib/ui/format";
import { InsightsPanel } from "@/components/insights-panel";
import { AssistantChat } from "@/components/assistant-chat";

/** 报告（结构化分析）与对话（自由问答）两种形态，共用一个 AI 入口 */
export function InsightsTabs({
  tripId,
  insights,
  aiEnabled,
  initialThreadId,
  initialMessages,
  seedQuestion,
  initialTab,
}: {
  tripId: string;
  insights: AiInsight[];
  aiEnabled: boolean;
  initialThreadId: string | null;
  initialMessages: AiMessage[];
  seedQuestion?: string;
  initialTab: "report" | "chat";
}) {
  const [tab, setTab] = useState<"report" | "chat">(initialTab);

  return (
    <div className="space-y-4">
      <div className="card-flat flex gap-1 p-1">
        {(
          [
            { key: "report", label: "分析报告" },
            { key: "chat", label: "问 AI" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={cx(
              "min-h-10 flex-1 rounded-xl text-sm font-medium transition-all",
              tab === item.key ? "bg-ink text-white shadow-sm" : "text-ink-soft hover:text-ink hover:bg-surface/50",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "report" ? (
        <InsightsPanel tripId={tripId} insights={insights} aiEnabled={aiEnabled} />
      ) : (
        <AssistantChat
          tripId={tripId}
          aiEnabled={aiEnabled}
          initialThreadId={initialThreadId}
          initialMessages={initialMessages}
          seedQuestion={seedQuestion}
        />
      )}
    </div>
  );
}

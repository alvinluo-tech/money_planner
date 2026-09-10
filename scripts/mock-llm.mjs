// 最小 OpenAI 兼容 mock：既能走工具调用（助手），也能返回结构化 JSON（记账解析）
import { createServer } from "node:http";

const PORT = 3322;

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function jsonReply(res, obj) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }));
}

createServer((req, res) => {
  if (!req.url.endsWith("/chat/completions")) {
    res.writeHead(404).end("nope");
    return;
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const json = JSON.parse(body || "{}");
    const messages = json.messages ?? [];
    const userText = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
    const hasTools = Array.isArray(json.tools) && json.tools.length > 0;

    // ---- 记账解析：返回结构化 JSON ----
    if (!hasTools) {
      if (userText.includes("改成")) {
        jsonReply(res, {
          intent: "correct",
          correction: {
            target: { kind: "last" },
            changes: { amount: 18, currency: "GBP" },
            confidence: 0.93,
            reason: "mock 解析",
          },
          expenses: [],
          warnings: [],
        });
        return;
      }
      jsonReply(res, {
        intent: "add",
        expenses: [
          {
            amount: 42,
            currency: "EUR",
            categoryKey: "food",
            merchant: "Mock Bistro",
            spentOn: "2026-09-09",
            paymentMethod: "card",
            confidence: 0.9,
          },
        ],
        warnings: [],
      });
      return;
    }

    // ---- 助手：流式 + 工具调用 ----
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    const hasToolResult = messages.some((m) => m.role === "tool");

    if (!hasToolResult) {
      sse(res, { choices: [{ delta: { content: "我先查一下明细。" } }] });
      sse(res, {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call_1", type: "function", function: { name: "query_expenses", arguments: "" } },
              ],
            },
          },
        ],
      });
      sse(res, {
        choices: [
          { delta: { tool_calls: [{ index: 0, function: { arguments: '{"sort":"amount_desc","limit":1}' } }] } },
        ],
      });
      sse(res, { choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    } else {
      const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
      const parsed = JSON.parse(toolMsg?.content ?? "{}");
      const top = parsed.rows?.[0];
      for (const chunk of ["最贵的一笔是 ", String(top?.merchant ?? "?"), "：", String(top?.amount ?? "?"), " ", String(top?.currency ?? "")]) {
        sse(res, { choices: [{ delta: { content: chunk } }] });
      }
      sse(res, { choices: [{ delta: {}, finish_reason: "stop" }] });
    }
    res.write("data: [DONE]\n\n");
    res.end();
  });
}).listen(PORT, () => console.log("mock llm on", PORT));

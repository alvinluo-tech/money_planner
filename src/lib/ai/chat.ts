import "server-only";
import { z } from "zod";
import { aiConfig } from "./config";

/**
 * 极简 OpenAI 兼容 Chat Completions 客户端。
 * 不用重型 SDK 是刻意的：只要换 AI_BASE_URL 就能在 OpenAI / DeepSeek / 通义 / Moonshot /
 * 智谱 / Ollama 之间切换，且没有版本兼容负担。
 */

export interface ChatJsonOptions<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  /** 结构化失败时的修复轮次上限 */
  repairAttempts?: number;
}

export class AiUnavailableError extends Error {
  constructor(message = "未配置大模型（AI_API_KEY 为空）") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

interface ChatChoiceMessage {
  content?: string | null;
  reasoning_content?: string | null;
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates: string[] = [trimmed];

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) candidates.push(fence[1].trim());

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    candidates.push(trimmed.slice(firstBracket, lastBracket + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // 继续尝试下一种切法
    }
  }
  throw new Error(`模型没有返回可解析的 JSON：${trimmed.slice(0, 200)}`);
}

async function callChat(
  cfg: NonNullable<ReturnType<typeof aiConfig>>,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  useJsonMode: boolean,
): Promise<string> {
  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature,
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`大模型请求失败 ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { choices?: Array<{ message?: ChatChoiceMessage }> };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("大模型返回内容为空");
  return content;
}

export interface ChatJsonResult<T> {
  data: T;
  model: string;
  raw: string;
}

/** 让模型返回符合 zod schema 的 JSON，带一轮自我修复 */
export async function chatJson<T>(options: ChatJsonOptions<T>): Promise<ChatJsonResult<T>> {
  const cfg = aiConfig();
  if (!cfg) throw new AiUnavailableError();

  const temperature = options.temperature ?? 0.1;
  const repairAttempts = options.repairAttempts ?? 1;
  const messages = [
    { role: "system", content: options.system },
    { role: "user", content: options.user },
  ];

  let useJsonMode = cfg.jsonMode;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= repairAttempts; attempt += 1) {
    let raw = "";
    try {
      raw = await callChat(cfg, messages, temperature, useJsonMode);
      const parsed = extractJson(raw);
      const result = options.schema.safeParse(parsed);
      if (result.success) return { data: result.data, model: cfg.model, raw };
      lastError = result.error;
      messages.push({ role: "assistant", content: raw.slice(0, 4000) });
      messages.push({
        role: "user",
        content: `上面的 JSON 不符合要求，请只输出修正后的 JSON，不要任何解释。错误：${result.error.issues
          .slice(0, 6)
          .map((i) => `${i.path.join(".")} ${i.message}`)
          .join("; ")}`,
      });
    } catch (error) {
      lastError = error;
      // 有的服务商不认 response_format，关掉再试一次
      if (useJsonMode) {
        useJsonMode = false;
        continue;
      }
      throw error;
    }
  }

  throw new Error(`大模型输出校验失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

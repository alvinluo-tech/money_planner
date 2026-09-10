import "server-only";

/** 大模型 / 语音识别配置。缺失时上层会自动降级到规则解析，不抛错。 */

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  jsonMode: boolean;
  timeoutMs: number;
}

import { cookies } from "next/headers";

export async function aiConfig(): Promise<AiConfig | null> {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;
  
  let model = process.env.AI_MODEL || "gpt-4o-mini";
  try {
    const cookieStore = await cookies();
    const preferredModel = cookieStore.get("ai-model-preference")?.value;
    if (preferredModel) {
      model = preferredModel;
    }
  } catch {
    // 允许在不支持 headers 的上下文中调用（例如静态构建期间）
  }

  return {
    apiKey,
    baseUrl: (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, ""),
    model,
    jsonMode: process.env.AI_JSON_MODE !== "false",
    timeoutMs: Number(process.env.AI_TIMEOUT_MS || 45000),
  };
}

export interface SttConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
}

export function sttConfig(): SttConfig | null {
  // 没单独配 STT 时复用 AI 的 key（同一家服务商的情况很常见）
  const apiKey = (process.env.STT_API_KEY || process.env.AI_API_KEY)?.trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (
      process.env.STT_BASE_URL ||
      process.env.AI_BASE_URL ||
      "https://api.openai.com/v1"
    ).replace(/\/+$/, ""),
    model: process.env.STT_MODEL || "whisper-1",
    language: process.env.STT_LANGUAGE || "zh",
  };
}

export async function aiEnabled(): Promise<boolean> {
  return (await aiConfig()) !== null;
}

export function sttEnabled(): boolean {
  return sttConfig() !== null;
}

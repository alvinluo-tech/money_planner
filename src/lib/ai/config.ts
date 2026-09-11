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

  const baseUrl = (process.env.AI_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const isDeepSeek = baseUrl.includes("deepseek.com");
  const defaultModel = isDeepSeek ? "deepseek-flash" : "gpt-4o-mini";

  let model = process.env.AI_MODEL || defaultModel;
  try {
    const cookieStore = await cookies();
    const preferredModel = cookieStore.get("ai-model-preference")?.value;
    if (preferredModel) {
      try {
        model = decodeURIComponent(preferredModel);
      } catch {
        model = preferredModel;
      }
    }
  } catch {
    // 允许在不支持 headers 的上下文中调用（例如静态构建期间）
  }

  return {
    apiKey,
    baseUrl,
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
  const sttKey = process.env.STT_API_KEY?.trim();
  const apiKey = sttKey || process.env.AI_API_KEY?.trim();
  if (!apiKey) return null;

  const baseUrl = (
    process.env.STT_BASE_URL ||
    process.env.AI_BASE_URL ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");

  // DeepSeek 纯文本/推理模型未提供 /audio/transcriptions 语音识别接口
  // 若未单独配置 STT_API_KEY 且当前使用 DeepSeek，则自动关闭云端 STT 避免抛错
  if (!sttKey && baseUrl.includes("deepseek.com")) {
    return null;
  }

  return {
    apiKey,
    baseUrl,
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

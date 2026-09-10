import "server-only";
import { sttConfig } from "./config";

export class SttUnavailableError extends Error {
  constructor(message = "未配置语音识别（STT_API_KEY / AI_API_KEY 为空）") {
    super(message);
    this.name = "SttUnavailableError";
  }
}

export interface TranscriptionResult {
  text: string;
  model: string;
  /** 若浏览器自带识别已经给出文本，可跳过云端调用 */
  engine: "cloud" | "provided";
}

/** 把音频 Blob 发给 OpenAI 兼容的 /audio/transcriptions */
export async function transcribeAudio(
  audio: Blob,
  options: { language?: string; prompt?: string; filename?: string } = {},
): Promise<TranscriptionResult> {
  const cfg = sttConfig();
  if (!cfg) throw new SttUnavailableError();

  const form = new FormData();
  form.append("file", audio, options.filename || "capture.webm");
  form.append("model", cfg.model);
  if (options.language ?? cfg.language) form.append("language", options.language ?? cfg.language);
  if (options.prompt) form.append("prompt", options.prompt);

  const res = await fetch(`${cfg.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.apiKey}` },
    body: form,
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`语音识别失败 ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = (await res.json()) as { text?: string };
  if (!json.text) throw new Error("语音识别返回为空");
  return { text: json.text.trim(), model: cfg.model, engine: "cloud" };
}

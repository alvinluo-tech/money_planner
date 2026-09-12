import { NextResponse } from "next/server";
import { aiConfig } from "@/lib/ai/config";

export async function GET() {
  const config = await aiConfig();
  if (!config) {
    return NextResponse.json({ ok: false, error: "未配置 AI_API_KEY" }, { status: 500 });
  }

  try {
    const res = await fetch(`${config.baseUrl}/models`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      next: { revalidate: 3600 } // 缓存一小时
    });
    
    if (!res.ok) {
      throw new Error(`请求大模型服务器失败: ${res.statusText}`);
    }

    const data = (await res.json()) as { data?: Array<{ id?: string }> } | Array<string | { id?: string }>;
    let models: string[] = [];
    if (Array.isArray(data)) {
      models = data.map((m) => (typeof m === "string" ? m : (m.id ?? "")));
    } else if (Array.isArray(data.data)) {
      models = data.data.map((m) => m.id ?? "");
    }

    models = models.filter(Boolean).sort();

    return NextResponse.json({ ok: true, models });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "获取模型列表失败" },
      { status: 500 },
    );
  }
}

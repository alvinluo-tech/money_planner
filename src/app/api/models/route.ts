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

    const data = await res.json();
    let models = data.data?.map((m: any) => m.id) || [];
    
    if (!data.data && Array.isArray(data)) {
      models = data.map((m: any) => m.id || m);
    }
    
    models = models.sort();

    return NextResponse.json({ ok: true, models });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

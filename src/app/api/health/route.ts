import { NextResponse } from "next/server";
import { aiEnabled, sttEnabled } from "@/lib/ai/config";
import { resolveDataMode, supabaseConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/** 健康检查 + 能力自检，方便排查「为什么没走大模型」 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    dataMode: resolveDataMode(),
    supabaseConfigured: supabaseConfigured(),
    aiEnabled: await aiEnabled(),
    sttEnabled: sttEnabled(),
    time: new Date().toISOString(),
  });
}

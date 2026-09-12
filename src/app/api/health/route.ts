import { NextResponse } from "next/server";
import { aiEnabled, sttEnabled } from "@/lib/ai/config";
import { resolveDataMode, supabaseConfigured } from "@/lib/db";
import { getSupabaseEnv } from "@/lib/data-mode";

export const dynamic = "force-dynamic";

/** 健康检查 + 能力自检，方便快速排查线上环境缺失的环境变量 */
export async function GET() {
  const { url, anonKey } = getSupabaseEnv();
  const hasSupabaseUrl = Boolean(url);
  const hasSupabaseKey = Boolean(anonKey);
  const hasAiKey = Boolean(process.env.AI_API_KEY?.trim());
  const hasPassword = Boolean(process.env.APP_PASSWORD?.trim());

  const missingForSupabase: string[] = [];
  if (!hasSupabaseUrl) missingForSupabase.push("NEXT_PUBLIC_SUPABASE_URL (或 SUPABASE_URL)");
  if (!hasSupabaseKey) missingForSupabase.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (或 SUPABASE_ANON_KEY)");

  return NextResponse.json({
    ok: true,
    dataMode: resolveDataMode(),
    supabaseConfigured: supabaseConfigured(),
    aiEnabled: await aiEnabled(),
    sttEnabled: sttEnabled(),
    missingForSupabase: missingForSupabase.length > 0 ? missingForSupabase : "none",
    envStatus: {
      SUPABASE_URL: hasSupabaseUrl ? "configured" : "missing",
      SUPABASE_ANON_KEY: hasSupabaseKey ? "configured" : "missing",
      AI_API_KEY: hasAiKey ? "configured" : "missing",
      APP_PASSWORD: hasPassword ? "configured" : "missing",
      APP_DATA_MODE: process.env.APP_DATA_MODE ?? "(not set)",
    },
    time: new Date().toISOString(),
  });
}

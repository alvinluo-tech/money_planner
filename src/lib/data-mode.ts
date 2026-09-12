/**
 * 数据源判定。抽成独立模块是为了让 proxy（中间件）和 db 层用同一套逻辑 ——
 * 否则会出现「页面走演示模式、中间件却要求登录」这种自相矛盾的情况。
 */
export type DataMode = "supabase" | "memory";

export function getSupabaseEnv() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return {
    url: url?.trim() || undefined,
    anonKey: anonKey?.trim() || undefined,
  };
}

export function resolveDataMode(): DataMode {
  const forced = process.env.APP_DATA_MODE?.trim();
  if (forced === "demo" || forced === "memory") return "memory";
  if (forced === "supabase") return "supabase";
  const { url, anonKey } = getSupabaseEnv();
  return url && anonKey ? "supabase" : "memory";
}

export function supabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseEnv();
  return Boolean(url && anonKey);
}

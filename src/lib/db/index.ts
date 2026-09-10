import "server-only";
import { resolveDataMode, supabaseConfigured, type DataMode } from "../data-mode";
import { createServerSupabase } from "../supabase/server";
import { DEMO_USER_ID, MemoryRepo } from "./memory";
import { SupabaseRepo } from "./supabase";
import type { Repo } from "./types";

/**
 * 数据源选择：
 *   · 配置了 NEXT_PUBLIC_SUPABASE_URL / ANON_KEY → Supabase（真实账号 + RLS）
 *   · 否则 → 内存演示模式（预置一趟英国行程，零配置即可体验）
 * APP_DATA_MODE=demo|memory|supabase 可强制指定。
 */

export type { DataMode };

export interface AppSession {
  mode: DataMode;
  userId: string;
  email: string | null;
  repo: Repo;
}

export { resolveDataMode, supabaseConfigured };

/** 未登录 / 未配置时返回 null，由调用方决定是跳登录还是走演示模式 */
export async function getSession(): Promise<AppSession | null> {
  const mode = resolveDataMode();

  if (mode === "memory") {
    return {
      mode: "memory",
      userId: DEMO_USER_ID,
      email: "demo@money-planner.local",
      repo: new MemoryRepo(DEMO_USER_ID),
    };
  }

  const client = await createServerSupabase();
  if (!client) return null;
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) return null;

  return {
    mode: "supabase",
    userId: user.id,
    email: user.email ?? null,
    repo: new SupabaseRepo(client, user.id),
  };
}

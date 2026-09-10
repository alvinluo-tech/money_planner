import { afterEach, describe, expect, it } from "vitest";
import { resolveDataMode, supabaseConfigured } from "./data-mode";

const KEYS = [
  "APP_DATA_MODE",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));

function setEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>) {
  for (const key of KEYS) {
    const value = values[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => setEnv(saved as Record<string, string | undefined>));

describe("resolveDataMode", () => {
  it("没配 Supabase 时走演示模式", () => {
    setEnv({ APP_DATA_MODE: undefined });
    expect(resolveDataMode()).toBe("memory");
    expect(supabaseConfigured()).toBe(false);
  });

  it("配了 Supabase 走真实模式", () => {
    setEnv({ APP_DATA_MODE: undefined, NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" });
    expect(resolveDataMode()).toBe("supabase");
  });

  it("APP_DATA_MODE=demo 优先于已配置的 Supabase（中间件与 db 层必须一致）", () => {
    setEnv({ APP_DATA_MODE: "demo", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "k" });
    expect(resolveDataMode()).toBe("memory");
    // 变量仍然存在，只是不生效 —— 这正是之前「页面能看、接口要登录」的根因
    expect(supabaseConfigured()).toBe(true);
  });

  it("APP_DATA_MODE=supabase 即使没配变量也走真实模式", () => {
    setEnv({ APP_DATA_MODE: "supabase" });
    expect(resolveDataMode()).toBe("supabase");
  });
});

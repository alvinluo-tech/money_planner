import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 服务端 Supabase 客户端（App Router 版）。
 * 在 Server Component 里写 cookie 会抛错，所以 setAll 用 try/catch 包住 ——
 * 这是 @supabase/ssr 官方推荐写法，middleware 负责真正刷新会话。
 */
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // 在 Server Component 中调用时无法写 cookie，交给 middleware 刷新
        }
      },
    },
  });
}

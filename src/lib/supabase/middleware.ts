import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { resolveDataMode } from "@/lib/data-mode";

const PUBLIC_PATHS = ["/login", "/auth", "/api/auth", "/api/health", "/manifest.webmanifest"];

/** 刷新 Supabase 会话并把未登录用户挡在 /trips 之外 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // 演示模式（含 APP_DATA_MODE=demo 强制指定）不做鉴权，
  // 必须与 db 层用同一套判定，否则会出现「页面能看、接口要登录」的矛盾。
  if (resolveDataMode() === "memory" || !url || !anonKey) {
    if (request.nextUrl.pathname === "/login" && !request.nextUrl.search.includes("force=1")) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p));

  if (!user && !isPublic) {
    // API 调用方要的是 401 JSON，而不是一个 HTML 登录页
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ ok: false, error: "请先登录" }, { status: 401 });
    }
    const redirectUrl = new URL("/login", request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }
  if (user && pathname === "/login") {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return response;
}

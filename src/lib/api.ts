import { NextResponse } from "next/server";
import { getSession, type AppSession } from "./db";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

export async function withSession(
  handler: (session: AppSession) => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("请先登录", 401);
    return await handler(session);
  } catch (error) {
    console.error("[api]", error);
    const message = error instanceof Error ? error.message : "服务器内部错误";
    return jsonError(message, 500);
  }
}

/**
 * 同源校验：浏览器发起的跨站写请求会带 Origin，与 Host 不一致就拒绝。
 * 非浏览器客户端（curl / 移动端）通常没有 Origin，放行 —— 它们仍要带会话 cookie。
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const host = forwardedHost || request.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 写操作统一入口：先做同源校验，再走会话包装 */
export async function withMutation(
  request: Request,
  handler: (session: AppSession) => Promise<NextResponse>,
): Promise<NextResponse> {
  if (!isSameOrigin(request)) return jsonError("跨站请求已被拒绝", 403);
  return withSession(handler);
}

export function zodMessage(error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }) {
  return error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "参数"}：${i.message}`)
    .join("；");
}

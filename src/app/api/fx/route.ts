import { NextResponse } from "next/server";
import { getRatesTo } from "@/lib/fx";
import { withSession, jsonError } from "@/lib/api";

export const runtime = "nodejs";

/** GET /api/fx?base=CNY&currencies=GBP,EUR */
export async function GET(request: Request) {
  // 挡住匿名滥用：汇率接口会代表你向公共汇率源发请求，必须要求会话
  // （演示模式下 withSession 自动返回演示会话，不影响本地体验）
  return withSession(async () => {
    const url = new URL(request.url);
    const base = (url.searchParams.get("base") || "CNY").toUpperCase();
    const raw = url.searchParams.get("currencies") || "";
    const currencies = raw
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    if (currencies.length === 0) return jsonError("缺少 currencies 参数", 422);

    const quotes = await getRatesTo(currencies, base);
    return NextResponse.json({ ok: true, base, quotes });
  });
}

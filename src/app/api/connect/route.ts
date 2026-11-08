import { NextResponse } from "next/server";
import { api } from "@/lib/server/http";
import { getEnv } from "@/lib/server/env";

/** ข้อมูลสำหรับหน้า "เชื่อมต่อ Claude" (เฉพาะผู้ที่ login แล้ว) */
export const GET = api(async (req) => {
  const env = await getEnv();
  const origin = new URL(req.url).origin;
  const token = env.MCP_TOKEN ?? "";
  return NextResponse.json({
    configured: token.length >= 16,
    origin,
    urlWithKey: token ? `${origin}/api/mcp/${token}` : null,
    urlBearer: `${origin}/api/mcp`,
    token: token || null,
  });
});

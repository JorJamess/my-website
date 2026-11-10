import { handleMcpPost, methodNotAllowed } from "@/lib/server/mcp/handler";
import { mcpGate } from "@/lib/server/mcp/guard";

// ใช้กับ Claude.ai / Claude Desktop "Custom Connector": ใส่ token ไว้ใน URL
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const denied = await mcpGate(req, (await params).key);
  if (denied) return denied;
  return handleMcpPost(req);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

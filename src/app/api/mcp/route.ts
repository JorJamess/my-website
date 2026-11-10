import { handleMcpPost, methodNotAllowed } from "@/lib/server/mcp/handler";
import { mcpGate } from "@/lib/server/mcp/guard";

// ใช้กับ client ที่ส่ง header ได้: Authorization: Bearer <MCP_TOKEN>
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const denied = await mcpGate(req, token);
  if (denied) return denied;
  return handleMcpPost(req);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

import { handleMcpPost, methodNotAllowed } from "@/lib/server/mcp/handler";
import { mcpGateScope } from "@/lib/server/mcp/guard";

// ใช้กับ client ที่ส่ง header ได้: Authorization: Bearer <MCP_TOKEN>
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  const gate = await mcpGateScope(req, token);
  if (gate instanceof Response) return gate;
  return handleMcpPost(req, gate.scope);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

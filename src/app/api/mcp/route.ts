import { checkMcpToken } from "@/lib/server/auth";
import { handleMcpPost, methodNotAllowed, unauthorized } from "@/lib/server/mcp/handler";

// ใช้กับ client ที่ส่ง header ได้: Authorization: Bearer <MCP_TOKEN>
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!(await checkMcpToken(token))) return unauthorized();
  return handleMcpPost(req);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

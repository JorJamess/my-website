import { checkMcpToken } from "@/lib/server/auth";
import { handleMcpPost, methodNotAllowed, unauthorized } from "@/lib/server/mcp/handler";

// ใช้กับ Claude.ai / Claude Desktop "Custom Connector": ใส่ token ไว้ใน URL
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  if (!(await checkMcpToken((await params).key))) return unauthorized();
  return handleMcpPost(req);
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;

import "server-only";
import { ZodError } from "zod";
import { InputError } from "@/lib/server/repo";
import { getTzOffset } from "@/lib/server/env";
import { localDateKey } from "@/lib/time";
import { toolList, tools } from "./tools";

/**
 * MCP server แบบ stateless ผ่าน Streamable HTTP (JSON-RPC 2.0, ตอบกลับเป็น application/json)
 * https://modelcontextprotocol.io/specification
 */
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "my-website-calendar", title: "My Website · ปฏิทินและบันทึก", version: "1.0.0" };

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string; data?: unknown } };

const rpcError = (id: JsonRpcRequest["id"], code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: "2.0",
  id: id ?? null,
  error: { code, message, ...(data ? { data } : {}) },
});

async function handleOne(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id ?? null, -32600, "Invalid Request");
  }
  const isNotification = msg.id === undefined;
  if (isNotification) return null; // notifications/initialized ฯลฯ ไม่ต้องตอบ

  const tz = await getTzOffset();
  switch (msg.method) {
    case "initialize": {
      const requested = String(msg.params?.protocolVersion ?? "");
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            `ปฏิทินงานและบันทึกส่วนตัวของเจ้าของเว็บไซต์. โซนเวลา ${tz} (วันนี้ ${localDateKey(new Date(), tz)}). ` +
            "เวลาที่ส่งโดยไม่มี offset จะถือเป็นเวลาท้องถิ่น. ใช้ get_summary เพื่อดูภาพรวม, create_event เพื่อลงงาน, create_note เพื่อจดบันทึก.",
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id!, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id!, result: { tools: toolList() } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const args = tool.schema.parse(msg.params?.arguments ?? {});
        const result = await tool.run(args as never, tz);
        return {
          jsonrpc: "2.0",
          id: msg.id!,
          result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
        };
      } catch (err) {
        // error ของ tool ส่งกลับเป็น isError เพื่อให้โมเดลแก้ไขแล้วลองใหม่ได้
        let text = "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์";
        if (err instanceof ZodError)
          text = "ข้อมูลไม่ถูกต้อง: " + err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        else if (err instanceof InputError) text = err.message;
        else console.error("[mcp]", err);
        return { jsonrpc: "2.0", id: msg.id!, result: { content: [{ type: "text", text }], isError: true } };
      }
    }
    case "resources/list":
      return { jsonrpc: "2.0", id: msg.id!, result: { resources: [] } };
    case "prompts/list":
      return { jsonrpc: "2.0", id: msg.id!, result: { prompts: [] } };
    default:
      return rpcError(msg.id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpPost(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
  }
  const headers = { "Content-Type": "application/json" };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => handleOne(m as JsonRpcRequest)))).filter(Boolean);
    return out.length ? new Response(JSON.stringify(out), { headers }) : new Response(null, { status: 202 });
  }
  const res = await handleOne(body as JsonRpcRequest);
  return res ? new Response(JSON.stringify(res), { headers }) : new Response(null, { status: 202 });
}

export function methodNotAllowed() {
  // stateless server: ไม่รองรับ SSE stream แยก (GET) และไม่มี session ให้ลบ (DELETE)
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function unauthorized() {
  return Response.json(rpcError(null, -32001, "Unauthorized: invalid MCP token"), {
    status: 401,
    headers: { "WWW-Authenticate": 'Bearer realm="mcp"' },
  });
}

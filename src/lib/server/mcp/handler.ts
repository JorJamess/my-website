import "server-only";
import { ZodError } from "zod";
import { InputError } from "@/lib/server/repo";
import { getTzOffset } from "@/lib/server/env";
import { localDateKey } from "@/lib/time";
import { logAudit, queueAction } from "@/lib/server/repo";
import { describeAction, describeRun, queuedReply, riskOf } from "./gate";
import { toolList, tools } from "./tools";
import { proposalsEnabled } from "@/modules/obsidian/documents";

/**
 * MCP server แบบ stateless ผ่าน Streamable HTTP (JSON-RPC 2.0, ตอบกลับเป็น application/json)
 * https://modelcontextprotocol.io/specification
 */
const SUPPORTED_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "my-website-calendar", title: "My Website · ปฏิทินและบันทึก", version: "1.0.0" };

/** Ready-made requests the owner can pick in Claude. They only ask Claude to read and suggest; changes still follow the approval rules. */
const PROMPTS = [
  {
    name: "weekly_review",
    title: "รีวิวสัปดาห์",
    description: "สรุปสัปดาห์นี้จากตัวเลขจริง เทียบกับสัปดาห์ก่อน พร้อมสิ่งที่ควรทำต่อ",
    text: "ช่วยรีวิวสัปดาห์นี้ของฉัน: เรียก get_analytics (week, offset 0) แล้วสรุปเป็นภาษาไทยสั้นๆ ว่า (1) งานและ habit ทำได้เท่าไหร่เทียบกับสัปดาห์ก่อน (2) อะไรเลยกำหนดหรือค้างอยู่ (3) เป้าหมายไหนคืบหน้าหรือเสี่ยงช้า (4) เสนอ 3 สิ่งที่ควรทำสัปดาห์หน้า ใช้เฉพาะตัวเลขจริง ไม่ต้องให้คะแนนรวม และอย่าแก้ข้อมูลอะไร",
  },
  {
    name: "plan_today",
    title: "วางแผนวันนี้",
    description: "ดูงาน นัด และ habit ของวันนี้ แล้วเสนอลำดับที่ควรทำ",
    text: "ช่วยวางแผนวันนี้: เรียก get_summary แล้วเสนอลำดับสิ่งที่ควรทำวันนี้ (นัดตามเวลา, to-do ที่ใกล้กำหนดหรือสำคัญ, habit ที่ยังไม่ติ๊ก) เป็นลิสต์สั้นๆ ภาษาไทย ถ้าอะไรเลยกำหนดให้บอกก่อน ยังไม่ต้องสร้างหรือแก้อะไร ให้ฉันเลือกก่อน",
  },
  {
    name: "tidy_up",
    title: "จัดระเบียบ",
    description: "หาของที่ซ้ำ เก่า หรือค้าง แล้วเสนอสิ่งที่ควรลบหรือแก้",
    text: "ช่วยจัดระเบียบข้อมูลของฉัน: ดู to-do ที่ค้างนาน, งานในปฏิทินที่เลยกำหนดแต่ยังไม่ติ๊ก, โน้ตที่ไม่มีโฟลเดอร์/แท็ก แล้วเสนอสิ่งที่ควรลบ แก้ หรือจัดเข้าโฟลเดอร์ เป็นรายการสั้นๆ ภาษาไทย ถ้าจะลงมือ การลบ/แก้ไขจะเข้าคิวรอฉันอนุมัติในหน้า Approvals อยู่แล้ว",
  },
] as const;

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
      const proposals = await proposalsEnabled();
      return {
        jsonrpc: "2.0",
        id: msg.id!,
        result: {
          protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
          capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            `ปฏิทินงานและบันทึกส่วนตัวของเจ้าของเว็บไซต์. โซนเวลา ${tz} (วันนี้ ${localDateKey(new Date(), tz)}). ` +
            "เวลาที่ส่งโดยไม่มี offset จะถือเป็นเวลาท้องถิ่น. ใช้ get_summary เพื่อดูภาพรวม, create_event เพื่อลงงาน, create_note เพื่อจดบันทึก. " +
            "ความรู้ใน Obsidian: ค้นด้วย search_obsidian_knowledge แล้วอ่านด้วย read_obsidian_note / read_obsidian_pdf (เห็นเฉพาะที่เจ้าของแชร์และซิงก์แล้ว ใช้ได้แม้ Mac ปิด และต้องอ้างแหล่งที่มาเสมอ)" + (proposals ? "; การสร้าง/แก้/ย้าย/ลบโน้ตและโฟลเดอร์ใช้ propose_* ซึ่งต้องรอเจ้าของอนุมัติและ Mac ออนไลน์. " : "; ตอนนี้เจ้าของปิดการเสนอแก้ Obsidian ไว้ จึงอ่านและค้นได้อย่างเดียว. ") +
            "กติกาความปลอดภัย: การสร้างและการติ๊กเสร็จทำทันที แต่การลบ การแก้ไขรายการเดิม และการผูก/เลิกผูก จะถูกเข้าคิวรอเจ้าของกดอนุมัติในหน้า Approvals (คุณจะได้ queued:true กลับมา ให้บอกเจ้าของ ไม่ต้องเรียกซ้ำ).",
        },
      };
    }
    case "ping":
      return { jsonrpc: "2.0", id: msg.id!, result: {} };
    case "tools/list":
      return { jsonrpc: "2.0", id: msg.id!, result: { tools: toolList({ proposals: await proposalsEnabled() }) } };
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const tool = tools.find((t) => t.name === name);
      if (!tool) return rpcError(msg.id, -32602, `Unknown tool: ${name}`);
      try {
        const args = tool.schema.parse(msg.params?.arguments ?? {});
        const input = args as Record<string, unknown>;
        // risky changes wait for the owner's yes; everything else runs and is logged
        const risk = riskOf(name, input);
        let result: unknown;
        if (risk === "vault") {
          // Obsidian proposals queue themselves (encrypted payload + approval row + audit); nothing runs here
          result = await tool.run(args as never, tz);
        } else if (risk) {
          const summary = await describeAction(name, input);
          const pending = await queueAction({ tool: name, args: input, summary, risk });
          await logAudit({ actor: "claude", action: name, summary: `Asked to: ${summary}`, pendingId: pending.id });
          result = queuedReply(pending);
        } else {
          result = await tool.run(args as never, tz);
          if (!tool.annotations?.readOnlyHint) await logAudit({ actor: "claude", action: name, summary: await describeRun(name, input) });
        }
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
      return { jsonrpc: "2.0", id: msg.id!, result: { prompts: PROMPTS.map(({ name, title, description }) => ({ name, title, description })) } };
    case "prompts/get": {
      const p = PROMPTS.find((x) => x.name === String(msg.params?.name ?? ""));
      if (!p) return rpcError(msg.id, -32602, `Unknown prompt: ${String(msg.params?.name ?? "")}`);
      return { jsonrpc: "2.0", id: msg.id!, result: { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text } }] } };
    }
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

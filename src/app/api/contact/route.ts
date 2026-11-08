import { NextResponse } from "next/server";
import { clientIp } from "@/lib/server/login-limit";
import { MESSAGE_TOPICS, saveMessage, sentRecently, type MessageTopic } from "@/lib/server/messages";

/** ฟอร์มติดต่อสาธารณะ (หน้า Portfolio) — กันสแปมแบบเบา: ช่องดักบอท + จำกัดต่อ IP */
export async function POST(req: Request) {
  let data: Record<string, string> = {};
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) data = await req.json();
    else data = Object.fromEntries([...(await req.formData()).entries()].map(([k, v]) => [k, String(v)]));
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  // ช่องที่คนมองไม่เห็น: ถ้ามีค่าแสดงว่าเป็นบอท ตอบเหมือนสำเร็จแต่ไม่บันทึก
  if ((data.website ?? "").trim()) return NextResponse.json({ ok: true });

  const name = (data.name ?? "").trim().slice(0, 120);
  const email = (data.email ?? "").trim().slice(0, 200);
  const body = (data.message ?? "").trim().slice(0, 5000);
  const topic = (MESSAGE_TOPICS as readonly string[]).includes(data.topic) ? (data.topic as MessageTopic) : "other";
  const lang = data.lang === "th" ? "th" : "en";
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.length < 2) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const ip = clientIp(req);
  if (await sentRecently(ip)) return NextResponse.json({ error: "too_many" }, { status: 429 });

  await saveMessage({ name, email, topic, body, lang, ip });
  return NextResponse.json({ ok: true }, { status: 201 });
}

import "server-only";
import { getEnv } from "./env";

export const MESSAGE_TOPICS = ["internship", "freelance", "other"] as const;
export type MessageTopic = (typeof MESSAGE_TOPICS)[number];

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  topic: MessageTopic;
  body: string;
  lang: string;
  read: boolean;
  created_at: string;
};

type Row = Omit<ContactMessage, "read"> & { read: number; ip: string | null };
const toMessage = (r: Row): ContactMessage => ({
  id: r.id,
  name: r.name,
  email: r.email,
  topic: r.topic,
  body: r.body,
  lang: r.lang,
  read: !!r.read,
  created_at: r.created_at,
});

/** ส่งได้ไม่เกิน LIMIT ข้อความต่อ IP ใน WINDOW */
const LIMIT = 3;
const WINDOW_MS = 60 * 60_000;

export async function sentRecently(ip: string) {
  const { DB } = await getEnv();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();
  const row = await DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE ip = ? AND created_at > ?").bind(ip, since).first<{ n: number }>();
  return (row?.n ?? 0) >= LIMIT;
}

export async function saveMessage(input: { name: string; email: string; topic: MessageTopic; body: string; lang: string; ip: string }) {
  const { DB } = await getEnv();
  const id = crypto.randomUUID();
  await DB.prepare(
    "INSERT INTO messages (id, name, email, topic, body, lang, read, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
  )
    .bind(id, input.name, input.email, input.topic, input.body, input.lang, input.ip, new Date().toISOString())
    .run();
  return id;
}

export async function listMessages(opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const { DB } = await getEnv();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const { results } = await DB.prepare(
    `SELECT * FROM messages ${opts.unreadOnly ? "WHERE read = 0" : ""} ORDER BY created_at DESC LIMIT ${limit}`,
  ).all<Row>();
  const unread = await DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE read = 0").first<{ n: number }>();
  return { messages: results.map(toMessage), unread: unread?.n ?? 0 };
}

export async function setMessageRead(id: string, read: boolean) {
  const { DB } = await getEnv();
  const r = await DB.prepare("UPDATE messages SET read = ? WHERE id = ?").bind(read ? 1 : 0, id).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function deleteMessage(id: string) {
  const { DB } = await getEnv();
  const r = await DB.prepare("DELETE FROM messages WHERE id = ?").bind(id).run();
  return (r.meta.changes ?? 0) > 0;
}

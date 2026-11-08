// Worker entry: Next.js (OpenNext) สำหรับ fetch + cron สำรองข้อมูลรายสัปดาห์
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- ไฟล์นี้ถูกสร้างตอน `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";
import { saveSnapshot } from "./src/lib/backup-core";

// หน้า Portfolio สาธารณะเป็นไฟล์ HTML ล้วนใน public/portfolio — เสิร์ฟจาก static assets โดยตรง
// (rewrite ใน next.config ใช้ได้แค่ตอน `next dev`; OpenNext ไม่ rewrite ไปไฟล์ static)
const PORTFOLIO: Record<string, string> = { "/": "/portfolio/index.html", "/th": "/portfolio/th.html" };

export default {
  async fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    const url = new URL(request.url);
    const file = PORTFOLIO[url.pathname];
    if (file && (request.method === "GET" || request.method === "HEAD")) {
      const res = await env.ASSETS!.fetch(new Request(new URL(file, url), request));
      // assets อาจตอบ redirect ไปที่ URL แบบไม่มี .html — ตามไปเอง เพื่อให้ผู้ใช้เห็น URL เดิม
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        return env.ASSETS!.fetch(new Request(new URL(res.headers.get("location")!, url), request));
      }
      return res;
    }
    return handler.fetch(request, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: CloudflareEnv, ctx: ExecutionContext) {
    ctx.waitUntil(
      saveSnapshot(env.DB, env.BACKUPS, "weekly").then(
        (r) => console.log(`[backup] saved ${r.key} (${r.events} events, ${r.notes} notes)`),
        (err) => console.error("[backup] failed", err),
      ),
    );
  },
} satisfies ExportedHandler<CloudflareEnv>;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- re-export Durable Objects ที่ OpenNext สร้างไว้
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

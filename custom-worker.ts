// Worker entry: Next.js (OpenNext) สำหรับ fetch + cron สำรองข้อมูลรายสัปดาห์
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore -- ไฟล์นี้ถูกสร้างตอน `opennextjs-cloudflare build`
import { default as handler } from "./.open-next/worker.js";
import { saveSnapshot } from "./src/lib/backup-core";

export default {
  fetch: handler.fetch,

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

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// ไม่ได้ใช้ ISR จึงไม่ต้องมี incremental cache (R2) — เพิ่มทีหลังได้
export default defineCloudflareConfig({});

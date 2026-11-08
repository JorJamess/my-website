# My Website

เว็บไซต์หลักส่วนตัว — ตอนนี้มี **ปฏิทินลงงาน / ดูกำหนดการ / จดบันทึก** และเชื่อมกับ Claude ผ่าน **MCP**

- Next.js 16 (App Router) + shadcn/ui + lucide-react
- Deploy บน Cloudflare Workers ผ่าน [OpenNext](https://opennext.js.org/cloudflare)
- ฐานข้อมูล Cloudflare D1 (SQLite)
- MCP server ในตัวที่ `/api/mcp` (Streamable HTTP, stateless)

## โครงสร้าง

```
src/app/                 หน้าเว็บ: / (ภาพรวม), /calendar, /notes, /connect
src/app/api/             REST API (ต้อง login) + /api/mcp (ใช้ MCP_TOKEN)
src/components/app/      UI ของแอป
src/components/ui/       shadcn components
src/lib/server/repo.ts   อ่าน/เขียน D1 (ใช้ร่วมกันทั้งเว็บและ MCP)
src/lib/server/mcp/      นิยาม tools และ JSON-RPC handler ของ MCP
src/lib/time.ts          โซนเวลา (TZ_OFFSET = +07:00) และตัวช่วยจัดการเวลา
migrations/              SQL schema ของ D1
```

## รันในเครื่อง

```bash
npm install
cp .dev.vars.example .dev.vars        # แก้รหัสผ่าน/โทเคนตามต้องการ
npm run db:migrate:local
npm run dev                            # http://localhost:3000
```

ทดสอบบน runtime ของ Cloudflare จริง (workerd): `npm run preview`

## Deploy ขึ้น Cloudflare (ครั้งแรก)

```bash
npx wrangler login
npx wrangler d1 create my-website-db
```

นำ `database_id` ที่ได้ไปแทนใน `wrangler.jsonc` แล้ว:

```bash
npm run db:migrate:remote
npx wrangler secret put ADMIN_PASSWORD    # รหัสผ่านเข้าเว็บ
npx wrangler secret put SESSION_SECRET    # สตริงสุ่มยาว ๆ เช่น จาก: openssl rand -hex 32
npx wrangler secret put MCP_TOKEN         # สตริงสุ่มยาว ๆ (≥16 ตัว) เช่น: openssl rand -hex 24
npm run deploy
```

ครั้งต่อไปแค่ `git push` — Cloudflare Workers Builds จะ build และ deploy ให้อัตโนมัติจาก branch `main`
(หรือ deploy เองจากเครื่องด้วย `npm run deploy`)

> ถ้าเพิ่มไฟล์ใน `migrations/` ให้รัน `npm run db:migrate:remote` **ก่อน** push

ตั้งค่า Workers Builds (Dashboard → Workers → my-website → Settings → Builds):
- Build command: `npx opennextjs-cloudflare build`
- Deploy command: `npx opennextjs-cloudflare deploy`
- Root directory: `/`

ใส่โดเมนของตัวเอง: Cloudflare Dashboard → Workers → my-website → Settings → Domains & Routes

## เชื่อมกับ Claude

หลัง login เข้าเว็บ ไปที่หน้า **เชื่อม Claude** (`/connect`) จะมี URL และคำสั่งให้คัดลอกพร้อมใช้

- **Claude.ai / Desktop / มือถือ**: Settings → Connectors → Add custom connector → วาง `https://<โดเมน>/api/mcp/<MCP_TOKEN>`
- **Claude Code**:
  ```bash
  claude mcp add --scope user --transport http my-calendar https://<โดเมน>/api/mcp --header "Authorization: Bearer <MCP_TOKEN>"
  ```

Tools: `get_summary`, `list_events`, `search_events`, `create_event`, `update_event`, `delete_event`, `list_notes`, `get_note`, `create_note`, `update_note`, `delete_note`

> ถ้า token หลุด: `npx wrangler secret put MCP_TOKEN` ใส่ค่าใหม่ แล้วอัปเดต URL ใน Claude

## เชื่อมแอปเงิน (money-tracker)

เว็บหลักอ่านข้อมูลเงินแบบอ่านอย่างเดียวจาก Integration API ของแอปเงิน (`/api/integration/v1/*`)

- Production: เรียกผ่าน service binding `MONEY` (ดู `wrangler.jsonc`)
- Dev: เรียกผ่าน `MONEY_API_URL` ใน `.dev.vars`
- Secrets: `INTEGRATION_KEY` (ค่าเดียวกันทั้งสอง worker) และ `INTEGRATION_USER_EMAIL` (ฝั่ง money-tracker) — ตั้งใหม่ได้ด้วย `scripts/set-money-integration-secrets.sh`
- โค้ด: `src/lib/server/money.ts`, `src/components/app/money-card.tsx`, `src/components/app/day-money.tsx`
- สเปก API: `docs/money-integration-brief.md`

## เพิ่มฟีเจอร์ใหม่

- หน้าใหม่: สร้างโฟลเดอร์ใน `src/app/` แล้วเพิ่มลิงก์ใน `NAV` ที่ `src/components/app/app-shell.tsx`
- ตารางใหม่: เพิ่มไฟล์ `migrations/0002_xxx.sql`
- ให้ Claude ใช้ได้: เพิ่ม tool ใน `src/lib/server/mcp/tools.ts` (schema ใช้ zod)

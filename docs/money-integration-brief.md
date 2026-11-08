# Brief: เปิด Integration API (อ่านอย่างเดียว) ให้เว็บหลักดึงข้อมูลเงิน

> ข้อความนี้สำหรับส่งให้ session/โปรเจกต์ที่ดูแล **แอปเงิน (money-tracker)**

## เป้าหมาย
เว็บหลักของผม (Cloudflare Worker ชื่อ `my-website`, Next.js) ต้องการแสดงข้อมูลเงินบนหน้าภาพรวมและปฏิทิน
ให้แอปเงินเพิ่ม **API แบบอ่านอย่างเดียว** สำหรับให้เว็บหลักเรียกแบบ server-to-server
ห้ามแก้หรือกระทบการทำงานเดิมของแอปเงิน (เว็บ, MCP, OAuth, login)

## การเชื่อมต่อและความปลอดภัย
- เว็บหลักจะเรียกผ่าน **Cloudflare Service Binding** ถ้าอยู่บัญชีเดียวกัน หรือผ่าน **HTTPS URL สาธารณะ** ของแอปเงินถ้าอยู่คนละบัญชี — API ต้องทำงานเหมือนกันทั้งสองแบบ (ป้องกันด้วย key เสมอ)
- ทุก endpoint ต้องเช็ค header `Authorization: Bearer <INTEGRATION_KEY>`
  - `INTEGRATION_KEY` อ่านจาก env/secret ของ worker (ไม่ต้องตั้งค่าเอง — ฝั่งเว็บหลักจะตั้ง secret ให้ทั้งสอง worker ด้วยค่าเดียวกัน)
  - เปรียบเทียบแบบ constant-time; ถ้าไม่มี secret หรือไม่ตรง → `401`
- ข้อมูลที่ส่งออกเป็นของ **ผู้ใช้คนเดียว** ระบุด้วย env `INTEGRATION_USER_EMAIL` (ค้นหา `user.id` จาก email) — ถ้าไม่ได้ตั้งหรือไม่พบ → `500` พร้อมข้อความชัดเจน
- รับเฉพาะ `GET`, ไม่เปิด CORS, ไม่ต้องใช้ session/cookie, ไม่ส่งข้อมูลจากตาราง auth (user/account/session/oauth_*) ออกมาเลย
- ไม่รวม transaction/category/wallet ที่ archived เว้นแต่ระบุไว้

## รูปแบบข้อมูล
- จำนวนเงินเป็น **บาท** แบบตัวเลขทศนิยม (แปลงจากหน่วยที่เก็บใน DB ให้ถูกต้อง เช่น ถ้าเก็บเป็นสตางค์ให้หาร 100)
- วันที่ `YYYY-MM-DD` และคำนวณตามโซนเวลา **Asia/Bangkok (+07:00)**
- error: `{ "error": "ข้อความ" }` พร้อม status code ที่เหมาะสม (400 สำหรับพารามิเตอร์ผิด)

## Endpoints

### 1) `GET /api/integration/v1/summary?month=YYYY-MM`
`month` ไม่ส่ง = เดือนปัจจุบัน
```json
{
  "currency": "THB",
  "month": "2026-11",
  "income": 45000,
  "expense": 18250.5,
  "net": 26749.5,
  "byCategory": [
    { "id": "…", "name": "อาหาร", "type": "expense", "icon": "utensils", "color": "#f97316", "amount": 6200, "monthlyBudget": 8000 }
  ],
  "wallets": [
    { "id": "…", "name": "เงินสด", "type": "cash", "balance": 3200 }
  ]
}
```
- `byCategory` เรียงตาม amount มากไปน้อย, `monthlyBudget` เป็น `null` ถ้าไม่ได้ตั้ง
- `wallets[].balance` = ยอดปัจจุบัน (initial_balance + รายรับ − รายจ่าย ตามตรรกะเดิมของแอป รวมการโอนถ้ามี)

### 2) `GET /api/integration/v1/daily?from=YYYY-MM-DD&to=YYYY-MM-DD`
ยอดรวมรายวัน (to แบบ inclusive, ช่วงไม่เกิน 62 วัน) — แสดงในช่องวันของปฏิทิน
```json
{ "days": [ { "date": "2026-11-08", "income": 0, "expense": 420, "count": 3 } ] }
```
ส่งเฉพาะวันที่มีรายการ

### 3) `GET /api/integration/v1/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=50`
รายการในช่วงวันที่ (limit ค่าเริ่มต้น 50, สูงสุด 200) เรียงใหม่ → เก่า
```json
{
  "transactions": [
    { "id": "…", "date": "2026-11-08", "time": "12:30", "type": "expense", "amount": 120,
      "category": { "id": "…", "name": "อาหาร", "icon": "utensils", "color": "#f97316" },
      "wallet": { "id": "…", "name": "เงินสด" }, "note": "ข้าวกลางวัน" }
  ]
}
```

### 4) `GET /api/integration/v1/recurring?from=YYYY-MM-DD&to=YYYY-MM-DD`
บิล/รายการประจำที่ถึงกำหนดในช่วงนั้น (ช่วงไม่เกิน 62 วัน) — จะแสดงเป็นงานในปฏิทิน
```json
{
  "items": [
    { "id": "…", "name": "ค่าเน็ต", "type": "expense", "amount": 599, "frequency": "monthly",
      "mode": "auto", "category": { "name": "บิล", "color": "#64748b" },
      "dueDates": ["2026-11-25"] }
  ]
}
```
- `dueDates` = ทุกวันที่ครบกำหนดในช่วง โดยคำนวณจาก `next_due` + `frequency` ด้วยตรรกะเดียวกับที่แอปใช้อยู่
- ไม่รวมรายการที่ archived

## เมื่อทำเสร็จ
1. เพิ่ม test หรืออย่างน้อยทดสอบด้วย curl ทั้ง 4 endpoint (ทั้งกรณี key ถูก, key ผิด, ไม่มี key)
2. Deploy
3. **ตอบกลับมาด้วย:**
   - ชื่อ Worker ของแอปเงิน (ค่า `name` ใน wrangler config), URL สาธารณะของแอป และอยู่ในบัญชี Cloudflare ไหน
   - path จริงของ endpoint ถ้าต่างจากด้านบน และหน่วยเงินที่ DB เก็บ (บาท/สตางค์)
   - ชื่อ env ที่ใช้ (`INTEGRATION_KEY`, `INTEGRATION_USER_EMAIL`) และ email ที่ควรตั้ง
   - frequency ที่รองรับ (เช่น daily/weekly/monthly/yearly)

**ไม่ต้อง**ตั้ง `INTEGRATION_KEY` เอง — ฝั่งเว็บหลักจะสุ่มค่าและตั้งให้ทั้งสอง worker

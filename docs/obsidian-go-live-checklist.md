# เช็กลิสต์ก่อนเปิดใช้ Obsidian Bridge (สำหรับเจ้าของ)

ขั้นตอนทั้งหมดในไฟล์นี้เป็นของเจ้าของ ไม่มีข้อไหนถูกทำไปแล้ว รายละเอียดและเหตุผลอยู่ใน `docs/obsidian-integration.md` (หัวข้อ "Putting it live") ติ๊กทีละข้อตามลำดับ

## A. ก่อน push (ฝั่ง Cloudflare)

- [x] **1. สำรองข้อมูล** — LifeOS → Settings → กด **Back up now** (migration ใหม่แก้ฐานข้อมูลจริง)
- [x] **2. รัน migration บน remote** — `npm run db:migrate:remote`
  ไฟล์ `0013_obsidian_integration.sql` เพิ่มตารางใหม่อย่างเดียว ไม่แก้ของเดิม รันเสร็จให้เช็กว่าสถานะเป็นสำเร็จ
- [x] **3. ตั้งคีย์เข้ารหัส** — `wrangler secret put OBSIDIAN_PAYLOAD_KEY`
  ใส่ค่า 32 ไบต์แบบ base64 สร้างด้วย `openssl rand -base64 32` แล้วเก็บสำเนาไว้ที่ปลอดภัย (ไม่ใส่ใน Git, Vault หรือแชต)
  ถ้าไม่ตั้ง: อ่านโน้ตได้ แต่ข้อเสนอแก้ของ Claude จะถูกปฏิเสธ
- [x] **4. เช็กโควตา Cloudflare** — ดูจำนวน request ต่อวันและการใช้ D1 ใน dashboard
  Bridge poll ทุก 15 วินาที เพิ่มราว 5,760 request ต่อวัน (~6% ของ 100,000 ที่ฟรี) ถ้าใกล้เต็ม ให้เพิ่มช่วง poll
- [x] **5. ตรวจโค้ดแล้ว push** — `git log 6c9268d..HEAD` (commit ทั้งหมดของงานนี้) แล้ว push ไป `main`
  Workers Builds จะ deploy เอง จุดย้อนกลับของโค้ดคือ tag `backup/before-obsidian-2026-11-11`

## B. หลัง push (ฝั่ง Mac)

- [x] **6. สร้างและเปิดแอป** — รัน `tools/obsidian-bridge/scripts/build.sh` แล้ว `build-app.sh`
  เปิดแอปครั้งแรกด้วยการคลิกขวา → Open (ยังไม่ได้ notarize)
- [x] **7. Setup Wizard** — จับคู่ด้วยโค้ดจาก LifeOS → Settings → Obsidian ดู preview การซิงก์ครั้งแรกให้ละเอียดก่อนกดยืนยัน
  ถ้า macOS ถามสิทธิ์ให้ Node เข้าถึงโฟลเดอร์ vault/backup ให้กดอนุญาต (ถ้าขึ้น "Operation not permitted" ให้ดูหัวข้อ Mac setup ในเอกสาร)
- [x] **8. ลองกับ 2–3 โน้ตก่อน** — ใส่ `lifeos_sync: true` เฉพาะโน้ตทดลอง แล้วลองให้ Claude (เว็บและมือถือ) ค้นและอ่าน
  เช็กว่าโน้ตอื่นที่ไม่ได้ใส่ flag ไม่โผล่
- [x] **9. เช็ก backup บน Mac** — ในแอปหรือ `obsidian-bridge status` ต้องเห็นผล backup local สำเร็จ (และ external ถ้าตั้งไว้) ก่อนอนุมัติการแก้/ลบใดๆ

## C. เปิดฟีเจอร์ propose ทีหลัง (ไม่บังคับ)

ค่าเริ่มต้นคือ **ปิด** Claude ค้นและอ่านได้อย่างเดียว

- [ ] **10.** เมื่อพร้อม: LifeOS → Settings → Obsidian → การ์ด "Let Claude propose changes" → **Turn on**
- [ ] **11.** ลองข้อเสนอเล็กๆ ก่อน (สร้างโน้ตใหม่) ดูใน Approvals → อ่านรายละเอียดจริง → Approve แล้วเช็กว่า Mac สร้างไฟล์ถูก
- [ ] **12.** ปิดได้ทุกเมื่อด้วยปุ่มเดิม (หยุดเฉพาะข้อเสนอใหม่ ข้อเสนอที่รออยู่ยังอนุมัติ/ปฏิเสธได้)

## ถ้าเปลี่ยนใจ / มีปัญหา

- หยุดซิงก์ชั่วคราว: Settings → **Pause sync** (หรือ `obsidian-bridge pause`)
- ตัดการเชื่อมต่อ Mac ทันที: Settings → **Revoke this Mac**
- ถอนโน้ตเดียวออกจากคลาวด์: Settings → Shared with Claude → Revoke (ประวัติฐานข้อมูลของ Cloudflare อาจเก็บได้สูงสุด 7 วัน ลบตามคำขอไม่ได้)
- อาการแปลกๆ: ตาราง Troubleshooting ใน `docs/obsidian-integration.md`, `obsidian-bridge doctor`, `obsidian-bridge logs`

## สิ่งที่ยังไม่เคยทดสอบจริง (ระวังเป็นพิเศษ)

Keychain, LaunchAgent, SSD ภายนอก, Claude มือถือ, และการคลิกผ่านเมนูแอป/Wizard บนเครื่องจริง ตัวสแกนความลับเป็นแค่ตาข่ายนิรภัย ไม่รับประกันว่าจับได้ทุกรหัสผ่าน อย่าใส่ `lifeos_sync: true` ในโน้ตที่มีข้อมูลลับ

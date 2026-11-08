// secrets/vars ที่ไม่ได้อยู่ใน wrangler.jsonc (ตั้งด้วย `wrangler secret put` หรือ .dev.vars)
interface CloudflareEnv {
  INTEGRATION_KEY?: string;
  /** ใช้ตอน dev เท่านั้น: เรียกแอปเงินผ่าน URL สาธารณะแทน service binding */
  MONEY_API_URL?: string;
}

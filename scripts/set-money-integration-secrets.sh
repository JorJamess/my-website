#!/usr/bin/env bash
# ตั้งกุญแจลับสำหรับเชื่อมเว็บหลัก (my-website) กับแอปเงิน (money-tracker)
# - สุ่ม INTEGRATION_KEY ค่าเดียวกันให้ทั้งสอง worker (ค่าไม่ถูกแสดงบนจอ)
# - ตั้ง INTEGRATION_USER_EMAIL ให้แอปเงิน
# - เก็บค่าไว้ใน .dev.vars (ไม่ถูก commit) สำหรับทดสอบในเครื่อง
set -euo pipefail
cd "$(dirname "$0")/.."

EMAIL="komolbunrueang@gmail.com"
KEY="$(openssl rand -hex 32)"

echo "→ ตั้ง INTEGRATION_KEY ให้ my-website"
printf %s "$KEY" | npx wrangler secret put INTEGRATION_KEY --name my-website
echo "→ ตั้ง INTEGRATION_KEY ให้ money-tracker"
printf %s "$KEY" | npx wrangler secret put INTEGRATION_KEY --name money-tracker
echo "→ ตั้ง INTEGRATION_USER_EMAIL ให้ money-tracker"
printf %s "$EMAIL" | npx wrangler secret put INTEGRATION_USER_EMAIL --name money-tracker

# อัปเดต .dev.vars (ลบค่าเก่าถ้ามี)
touch .dev.vars
grep -v -E '^(INTEGRATION_KEY|MONEY_API_URL)=' .dev.vars > .dev.vars.tmp || true
mv .dev.vars.tmp .dev.vars
printf 'INTEGRATION_KEY=%s\nMONEY_API_URL=https://money-tracker.komolbunrueang.workers.dev\n' "$KEY" >> .dev.vars
unset KEY

echo "✅ เสร็จแล้ว"

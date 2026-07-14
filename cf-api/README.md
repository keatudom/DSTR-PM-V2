# dstr-api — เครื่องยนต์ใหม่ (Cloudflare Workers + D1 + R2)

พอร์ตหลังบ้าน DSTR-PM จาก Apps Script + Google Sheets มาไว้บน Cloudflare
พิมพ์เขียว/หลักการ: `../docs/migration-cloudflare/BLUEPRINT.md`

## โครง
```
src/index.ts        entry: CORS + parse ?action= → authorize → route → ห่อ {ok,data}
src/router.ts       action → handler (Session 1: ping + auth; Session 2 เติม 131 actions)
src/lib/
  auth.ts           token HMAC (Web Crypto) — format เป๊ะเท่า Apps Script (token เก่าใช้ต่อได้)
  authz.ts          _authorize_ + permission matrix (port ตรงจาก auth.gs)
  resp.ts           wrapper {ok,data} + ข้อยกเว้น raw + CORS allowlist
  ids.ts            nextId ผ่านตาราง id_counters (atomic — เลิก full-scan)
  db.ts             query D1 + mapper snake_case → key เดิม
  time.ts           วันที่/เวลาโซนไทย
src/modules/auth.ts login / login_google / get_me / get_users / upsert_user / set_user_role
migrations/0001_init.sql   โครงตาราง D1 (BLUEPRINT §3)
seed/export-import.mjs      ดูด Sheets (export_all) → INSERT D1 + count เทียบ
test/auth.test.ts           พิสูจน์ token เก่า verify ผ่าน (backward compat)
```

## คำสั่ง
```
npm install
npm run typecheck        # ตรวจชนิด src
npm test                 # unit test (token roundtrip)
npm run migrate:remote   # apply migration ขึ้น D1 (หลัง wrangler login + d1 create)
npm run deploy           # deploy worker

# seed (ต้องมี ADMIN_PASSWORD จาก Script Properties เดิม)
ADMIN_PASSWORD=xxx node seed/export-import.mjs --tabs      # ลิสต์แท็บจริง
ADMIN_PASSWORD=xxx node seed/export-import.mjs --dump 00_Projects
ADMIN_PASSWORD=xxx node seed/export-import.mjs --local     # ซ้อมลง D1 local
ADMIN_PASSWORD=xxx node seed/export-import.mjs             # seed จริง (remote)
```

## Setup ครั้งเดียว (Session 1 gate — ต้อง login/secret)
1. `npx wrangler login`
2. `npx wrangler d1 create dstr-db` → เอา database_id ใส่ `wrangler.toml`
3. `npx wrangler r2 bucket create dstr-media`
4. `npm run migrate:remote`
5. `wrangler secret put <NAME>` × 10 (ดู wrangler.toml) — จดลง secrets-ledger
6. `npm run deploy`

> Rollback: หน้าเว็บสลับ engine ด้วย `CONFIG.BACKEND = 'gas' | 'cf'` (ยังไม่แตะในรอบนี้)

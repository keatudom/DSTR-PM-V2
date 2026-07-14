# SESSION 1 — ตอกเสาเข็ม (Foundation) · ต้องเสร็จก่อน Session 2/3

> **อ่านก่อนเริ่ม:** `BLUEPRINT.md` ทั้งฉบับ (โดยเฉพาะ §1 หลักการ 5 ข้อ) · memory `project-perf-audit-2026-07-14`, `project-dstr-pm-architecture` (clasp workflow), `feedback_dont-break-existing-data`
> **บทบาท:** วิศวกรโครงสร้างพื้นฐาน — สร้างให้ Session 2/3 มายืนต่อได้ทันที
> **ห้าม:** แก้โค้ดเก่าใดๆ ยกเว้น "เพิ่ม" action `export_all` · ห้ามสลับ BACKEND ใน config.js

## งาน (ตามลำดับ)

1. **Scaffold `cf-api/`** ตามโครง BLUEPRINT §2 — `npm create cloudflare@latest` (Hono + TS), ตั้งชื่อ worker `dstr-api`
2. **D1 + R2:** `wrangler d1 create dstr-db` · `wrangler r2 bucket create dstr-media` · ใส่ binding ใน wrangler.toml · migration `0001_init.sql` = โครง §3 ทั้งหมด (รวม qc_* และ id_counters)
3. **แกนกลาง `src/lib/`:**
   - `resp.ts`: wrapper `{ok,data}` + ข้อยกเว้น raw ตาม §1 ข้อ 2 + CORS (origin allowlist: GitHub Pages ของ repo นี้ + http://localhost:*)
   - `auth.ts`: port `_issueToken_/_verifyToken_/_authorize_` จาก `apps-script/auth.gs` ด้วย Web Crypto — **ใช้ AUTH_SECRET เดิม, format token เดิมเป๊ะ** (token เก่าต้อง verify ผ่าน — เขียน unit test ด้วย token จริง 1 ตัวที่ gen จากระบบเก่า) + `ALLOW_ANON_READ` flag ตาม §7
   - `ids.ts`: `nextId(prefix)` ผ่านตาราง id_counters ใน batch transaction
   - `db.ts`: helper query + mapper snake_case → key เดิมของ API (ทำเป็น mapping table ต่อ endpoint ไม่ใช่ magic)
4. **Router + ping:** `?action=ping` ตอบ shape เดิม · deploy · วัด latency จากไทย 10 ครั้ง ต้อง < 500ms
5. **Secrets:** `wrangler secret put` ครบ 10 ตัว (§4) — ค่าจาก Script Properties เดิม · **จดชื่อทุกตัวลง** `C:\Users\User\projects\INARCH-ECOSYSTEM\Inarch-Ops\secrets-ledger_HUMAN.md` (สร้าง section DSTR-CF)
6. **`export_all` ฝั่ง Apps Script (additive-only):** action ใหม่ใน route() ตาม convention (ดู memory architecture: route()/handle() wrapping rule) — รับ `tab`, ตรวจ `ADMIN_PASSWORD`, คืน `{headers, rows}` ดิบ · deploy ด้วย clasp ตาม workflow เดิม · ทดสอบดูด 1 แท็บ
7. **Seed script `seed/export-import.mjs`:** ไล่ดูดทุกแท็บ → INSERT D1 (batch 500 แถว/ครั้ง) → ตั้ง id_counters ต่อ prefix = max+1 · รัน · พิมพ์ตาราง count เก่า-ใหม่เทียบทุกตาราง
8. **Auth module (`modules/auth.ts`):** port login, login_google, get_me, get_users, upsert_user, set_user_role จาก auth.gs — เทสต์ login_google ด้วย token จริงถ้าทำได้, อย่างน้อย unit test HMAC roundtrip

## นิยามเสร็จ (Definition of Done)

- [ ] `ping` บน workers.dev ตอบ < 500ms จากไทย
- [ ] ตาราง D1 ครบทุกตัวใน §3 + seed แล้ว count ตรงกับ Sheets 100% (แนบตารางเทียบใน commit message)
- [ ] token ที่ออกโดยระบบเก่า verify ผ่านบน Worker (พิสูจน์ backward compat)
- [ ] get_me บน cf ตอบเหมือน gas (เทียบ JSON จริง)
- [ ] secrets 10 ตัวอยู่ใน Worker + จดใน ledger ครบ
- [ ] commit เป็นระยะ PR เล็ก อธิบายภาษาคนธรรมดา · จบด้วย handoff บอกสถานะให้ Session 2/3

## ส่งไม้ต่อ

เขียนไฟล์ `docs/migration-cloudflare/S1-HANDOFF.md`: URL worker จริง · database_id · ปัญหาที่เจอ+วิธีแก้ · ตาราง count เทียบ · ตัวอย่าง curl ทดสอบ auth

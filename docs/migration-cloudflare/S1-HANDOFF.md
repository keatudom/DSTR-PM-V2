# S1-HANDOFF — ตอกเสาเข็ม (Foundation) ✅ เสร็จ

> สถานะ: **เสร็จครบ DoD · deploy จริง + seed จริง 100% แล้ว** · ค้างเล็กน้อย: R2 + 3 LINE secrets (ไม่บล็อก S2)
> อัปเดตล่าสุด: 2026-07-14 · ผู้ปฏิบัติ: Session 1

## 🎯 ค่าจริง (ใช้อ้างอิงได้เลย)
- **Worker URL:** `https://dstr-api.keatudom456.workers.dev` (endpoint action = `.../api?action=xxx`)
- **D1 database_id:** `5f4125bf-59a5-4d16-9a04-5826b0b695b4` (ชื่อ `dstr-db`, region APAC)
- **Cloudflare account:** keatudom456@gmail.com (ID `385f64963c5772c9be1dbc853d39e037`) · subdomain `keatudom456`
- **GAS export URL (seed):** deployment @105 เดิม (URL ใน `js/config.js`)

## ✅ DoD ครบ
- [x] ping < 500ms: **median 170ms** (เก่า 2-3วิ) วัดจากไทย 10 ครั้ง
- [x] ตาราง D1 ครบ §3 + seed count ตรง Sheets **100% ทุกตาราง** (ดูตารางล่าง)
- [x] token ระบบเก่า (AUTH_SECRET จริง) verify ผ่านบน Worker (ยืนยันสองทาง)
- [x] get_me บน cf == gas (เทียบ JSON จริง ST01 ดิเรก — เหมือนเป๊ะ รวมชื่อไทย + projects)
- [x] token ปลอม/ไม่มี token → พฤติกรรมเหมือน gas เป๊ะ
- [x] secrets 7/10 ใน Worker + จด ledger (3 LINE ค้าง — ไม่ใช้ใน S1)
- [x] commit เป็นระยะ + handoff

## 📊 count เทียบ Sheet → D1 (seed remote สำเร็จ)
ทุกตาราง ✅ ตรง: projects 2 · ff_items 19 · tasks 369 · payments 21 · risks 5 · daily_reports 8 ·
quick_logs 3 · contractors 7 · materials 102 · material_transactions 150 · task_photos 34 ·
material_photos 4 · activity_logs **607** · teams 31 · contracts 6 · milestones 26 · contract_files 7 ·
payment_slips 4 · staff 13 · project_staff 4 · checkins 87 · site_config 1 · contractor_evaluations 2
(suppliers/project_teams/boq_items = 0 แถวในต้นทาง · staff_id_cards = ไม่มีแท็บ 30_StaffIDCard ในชีต)

## 🧪 ตัวอย่าง curl ทดสอบ (⚠️ ต้องมี User-Agent ไม่งั้น Cloudflare 403)
```bash
curl -s -A "Mozilla/5.0" "https://dstr-api.keatudom456.workers.dev/api?action=ping"
# → {"ok":true,"data":{"pong":true,"time":"..."}}
curl -s -A "Mozilla/5.0" "https://dstr-api.keatudom456.workers.dev/api?action=get_me"
# → {"ok":true,"data":{"authenticated":false}}   (ไม่มี token)
curl -s -A "Mozilla/5.0" "https://dstr-api.keatudom456.workers.dev/api?action=get_me&auth_token=<TOKEN>"
# → {"ok":true,"data":{"authenticated":true,"staff_id":...,"role":...,"projects":[...]}}
```

---

## ✅ ทำเสร็จแล้ว (ไม่ต้องรอใคร)

| งาน | สถานะ | หลักฐาน |
|---|---|---|
| Scaffold `cf-api/` (Hono + TS) | ✅ | `cf-api/` · typecheck ผ่าน |
| `migrations/0001_init.sql` (schema §3 ครบ) | ✅ | apply ลง D1 **local** สำเร็จ 34 คำสั่ง |
| `src/lib/auth.ts` — token HMAC (Web Crypto) | ✅ | **unit test 6/6 ผ่าน** — token แบบ Apps Script verify ผ่าน + byte-identical |
| `src/lib/authz.ts` — `_authorize_` + matrix | ✅ | port ตรงจาก auth.gs (ROLE_CAPS/ACTION_CAP/scope) + `ALLOW_ANON_READ` |
| `src/lib/{resp,ids,db,time}.ts` | ✅ | wrapper {ok,data}+raw+CORS · nextId atomic · เวลาไทย |
| `src/modules/auth.ts` (6 actions) | ✅ | login/login_google/get_me/get_users/upsert_user/set_user_role |
| `src/router.ts` + `index.ts` (Hono) | ✅ | ping + auth (Session 2 เติม 131 actions ที่เหลือ) |
| `export_all`/`export_tabs` ฝั่ง Apps Script | ✅ | **deploy @105 (URL เดิม)** · smoke-test: ping ok + gate unauthorized ถูกต้อง |
| `seed/export-import.mjs` | ✅ | โค้ดครบ (ยังไม่รันจริง — รอ ADMIN_PASSWORD) |
| commit 3 ก้อน (docs + gas + cf-api) | ✅ | `a302985`, `31c9fc1`, `ad0c958` — **ยังไม่ push** |

### token backward-compat (พิสูจน์แล้ว offline)
`test/auth.test.ts` สร้าง token ด้วย "อัลกอริทึมเดียวกับ Apps Script" (node crypto อิสระ)
แล้ว `verifyToken` (Web Crypto) ของ Worker ตรวจผ่าน + payload ตรงเป๊ะ (รวมชื่อไทย UTF-8)
และ `issueToken` ของเราได้ token **ไบต์ตรงกัน** → format เป๊ะ → token เก่าใช้ต่อได้ไม่ต้อง login ใหม่
(เหลือยืนยันด้วย token จริงจากระบบเก่า 1 ใบ ที่ gate — ต้องใช้ AUTH_SECRET จริง)

---

## ⛔ ค้างเล็กน้อย (ไม่บล็อก Session 2 — เป็นงานของ Session 3/เจ้าของ)

1. **R2 ยังไม่เปิด** — Cloudflare code 10042 "enable R2 ผ่าน dashboard" (ต้องผูกบัตร) →
   ผม **comment binding `[[r2_buckets]]` ใน wrangler.toml ไว้ชั่วคราว** · Session 3 (อัปรูป):
   เปิด R2 ใน dashboard → `wrangler r2 bucket create dstr-media` → ปลด comment → redeploy
2. **3 LINE secrets ยังไม่ใส่** — LINE_GROUP_ID, LINE_GROUP_OPS_ID, LINE_OWNER_UID
   (เจ้าของส่งค่า C48…/601e… มาแต่ยังแยกไม่ออกว่าตัวไหน + ยังไม่มี owner UID) →
   จำเป็นตอน Session 2 (cron digest + webhook) เท่านั้น · เจ้าของติดป้ายแล้ว `wrangler secret put`

## 🔁 ถ้าต้อง seed ซ้ำ (คืนตัดยอด)
```
ADMIN_PASSWORD=<รหัส> node cf-api/seed/export-import.mjs           # remote (DELETE+re-INSERT ทุกตาราง)
ADMIN_PASSWORD=<รหัส> node cf-api/seed/export-import.mjs --local   # ซ้อม
```
seed เป็น full-refresh (idempotent) + ตั้ง id_counters = max+1 อัตโนมัติ ทุกครั้ง

---

## 📌 บันทึกสำคัญสำหรับ Session 2/3

- **⚠️ พบไฟล์ Session 3 (QC) อยู่ใน `cf-api/` แล้ว** (`src/modules/qc.ts`, `seed/parse_qc_template.py`,
  `seed/qc_criteria*.{json,sql}`) — **Session 1 ไม่ได้ commit ให้** (ผิดลำดับ S1-before-S2/3 + วินัย
  ห้าม commit โค้ดที่ตัวเองไม่ได้เขียน) ไฟล์ยังอยู่บนดิสก์ ให้ Session 3 commit เอง
- **wrapper rules:** RAW_ACTIONS (ไม่ห่อ {ok,data}) = getAll, updateTask, updatePayment,
  upload_log_photo, upload_payment_slip, upload_contract_file → อยู่ใน `src/lib/resp.ts`
- **id_counters:** seed ตั้ง `next_seq = max+1` ต่อ prefix (แยก prefix ด้วย regex `^([A-Za-z_-]*?)(\d+)$`)
  → Session 2 ใช้ `nextId(env, prefix, pad)` จาก `src/lib/ids.ts` ให้ prefix ตรงกับที่ seed ตั้ง
- **db mapper:** `mapRow(row, {dbCol→apiKey})` ใน `src/lib/db.ts` — Session 2 นิยาม mapping ต่อ endpoint
- **actor:** `authorize()` คืน `{actor}` (แทน global `_setCurrentActor_`) → router ส่งต่อ handler เอง
- **เวลาไทย:** ใช้ `todayStr()/nowStr()` จาก `src/lib/time.ts` (Worker เป็น UTC +7)
- **ALLOW_ANON_READ='true'** ตอนนี้ = คงพฤติกรรมเดิม (read เปิด anonymous) — ปิดหลังตัดยอด

## 🧩 หมายเหตุ schema ที่ต่างจาก BLUEPRINT (Session 2 ต้องรู้)
- **activity_logs**: เพิ่ม migration `0002` — เปลี่ยน PK เป็น `row_id` (AUTOINCREMENT) เพราะ
  `log_id` ในข้อมูลจริง **ไม่ unique** (LOG0141/0372/0406/+1 ซ้ำ — บั๊ก race ระบบเก่าไม่มี LockService)
  → เก็บครบ 607 แถว · `log_id` เป็น index ธรรมดา · query by log_id อาจ match >1 (เหมือนของเดิม)
- **payments**: 2 แถว payment_id ว่าง (NULL) — SQLite ยอม NULL ซ้ำใน TEXT PK · count ยังตรง 21
- **header ต้อง override** (หัวชีตภาษาคน ≠ ชื่อคอลัมน์ D1) — อยู่ใน `seed/export-import.mjs` OVERRIDES:
  ff_items(FF Code→code, Item Name→name, Area/Room→area, Price(THB)→price) · tasks(Task ID→id, Task Name→name) ·
  payments(% of Total→pct_of_total, Amount(THB)→amount) · risks(Mitigation Plan→mitigation) ·
  task_photos(id→photo_id, drive_url→url) · material_photos(drive_url→url) · quick_logs(timestamp→created_at)
- **ข้อมูลที่ไม่มีช่องใน schema (ยอมทิ้ง)**: quick_logs.{report_id,photos,tagged_ff,tagged_contractor} (3 แถว transient)
- **ตารางที่ยังไม่มี schema**: `notifications` (20_Notifications 0 แถว) — INVENTORY บอกย้าย get_notifications แต่ §3 ไม่มีตาราง → Session 2 เพิ่มถ้าต้องใช้
- **task_photos/material_photos ไม่มี project_id ในต้นทาง** → คอลัมน์ project_id = NULL (เหมือนเดิม)

## ⚠️ เรื่อง parallel sessions
Session 2/3 รันขนานกันใน tree เดียวกัน — แก้ `router.ts` (import qc), `index.ts` (ร้อย actor `params.__actor`),
`db.ts` (เพิ่ม pidOf/projectScope/fmtDate) · S1 commit เฉพาะไฟล์ตัวเอง (explicit paths) ไม่กวาดของ session อื่น
ไฟล์ QC (`src/modules/qc.ts`, `seed/qc_*`, `seed/parse_qc_template.py`) = Session 3 commit เอง

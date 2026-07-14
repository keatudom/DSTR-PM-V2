# 🏗️ พิมพ์เขียวย้ายเครื่องยนต์: Apps Script + Sheets → Cloudflare Workers + D1 + R2

> **สถานะ:** อนุมัติโดยเจ้าของงาน 2026-07-14 · สถาปนิก: Fable (session 0)
> **ผู้ปฏิบัติ:** 3 sessions (อ่าน `SESSION-1.md` → `SESSION-2.md` ∥ `SESSION-3.md`)
> **กฎเหล็ก:** Session 1 ต้องเสร็จก่อน Session 2/3 จะเริ่ม (2 กับ 3 ขนานกันได้)

---

## 0. เป้าหมาย + ขอบเขต

- ย้าย **หลังบ้านทั้งหมด** จาก Apps Script (~3 วิ/คำสั่ง) ไป Cloudflare Workers (~0.05–0.3 วิ)
- ย้าย **ฐานข้อมูล** จาก Google Sheets ไป **D1 (SQLite)** — seed ข้อมูลเก่าครบก่อนสลับ
- ย้าย **รูปภาพใหม่** ไป **R2** (ลิงก์ Drive เก่ายังใช้ต่อได้ ไม่ย้ายไฟล์เก่า)
- **หน้าเว็บเดิมใช้ต่อทั้งหมด** (GitHub Pages) — แก้แค่ `js/config.js` + `js/api.js`
- ฟีเจอร์ใหม่ **QC Checklist** สร้างบนเครื่องยนต์ใหม่เลย (Session 3)
- **ไม่แตะ Inarch** · **ไม่ลบระบบเก่า** (เก็บเป็นร่มชูชีพ rollback)

**นอกขอบเขต (ทำหลังตัดยอด):** mirror ข้อมูลกลับ Sheets รายคืนให้พี่ชาย audit · ปิด anonymous read (ดู §7)

---

## 1. หลักการใหญ่ 5 ข้อ (ผู้ปฏิบัติทุก session ต้องท่องจำ)

1. **Contract-preserving port (ย้ายบ้านแต่เบอร์โทรเดิม):** API ใหม่รับ `?action=xxx` + พารามิเตอร์**ชื่อเดิมเป๊ะ** และตอบ JSON **โครงเดิมเป๊ะ** (รวม key เพี้ยนๆ อย่าง `ffCode` camelCase ใน tasks, `bfCode` ใน ff) — ห้าม "ปรับปรุง" ชื่อ field เด็ดขาด ไม่งั้นหน้าเว็บพัง. แหล่งความจริงของ response shape = โค้ดเก่าใน `apps-script/` + golden snapshots (§6)
2. **Wrapper rules เดิม:** ทุก action ตอบ `{ok, data}` **ยกเว้น** `getAll`/`updateTask`/`updatePayment` (ตอบ raw legacy) และ `upload_log_photo`/`upload_payment_slip`/`upload_contract_file` (raw passthrough) — ดู `Code.js:143-155`
3. **Additive-only กับระบบเก่า:** ห้ามแก้/ลบของเดิม ยกเว้น**เพิ่ม** action `export_all` (Session 1) เพื่อดูดข้อมูล
4. **Seed ก่อน Switch:** ห้ามชี้หน้าเว็บเข้าเครื่องยนต์ใหม่จนกว่า §6 verification ผ่านครบ
5. **Rollback 1 บรรทัด:** `CONFIG.BACKEND = 'gas' | 'cf'` ใน config.js — สลับกลับได้ทันทีตลอดช่วง dual-run

---

## 2. สถาปัตยกรรมปลายทาง

```
GitHub Pages (เดิม)                Cloudflare (ใหม่ ฟรี)
┌─────────────────┐    fetch     ┌──────────────────────────┐
│ *.html + js/*.js│ ───────────► │ Worker: dstr-api          │
│ (แก้ 2 ไฟล์)     │   CORS จริง  │  Hono router (action map) │
└─────────────────┘              │  ├── D1: dstr-db (SQLite) │
                                 │  ├── R2: dstr-media (รูป) │
   Apps Script เดิม ◄── ร่มชูชีพ │  ├── Cron: LINE digests   │
   (ห้ามลบ ~30 วัน)              │  └── fetch: LINE/Gemini/  │
                                 │      Google tokeninfo      │
                                 └──────────────────────────┘
```

**โครงโปรเจกต์ใหม่ (โฟลเดอร์ `cf-api/` ใน repo นี้):**
```
cf-api/
  wrangler.toml            # binding: DB(d1), MEDIA(r2), secrets, cron
  src/index.ts             # entry: CORS + dispatch ?action= → module
  src/router.ts            # action → handler map (149 ชื่อเดิม)
  src/lib/{db,auth,resp,ids,gemini,line,r2}.ts
  src/modules/auth.ts      # ← port จาก auth.gs
  src/modules/projects.ts  # ← projects_patch.gs + projects_wizard.gs
  src/modules/ff_tasks.ts  # ← Code.js (FF/tasks/payments/getAll)
  src/modules/materials.ts # ← Code.js (materials/transactions/boq/inventory/ai_alerts)
  src/modules/daily.ts     # ← Code.js (daily/activity/ai summaries/today_stats/daily_bundle)
  src/modules/checkin.ts   # ← checkin.gs
  src/modules/teams_finance.ts # ← Code.js teams/contracts/milestones + client_finance.gs + project_teams.gs
  src/modules/risks.ts     # ← risks.gs
  src/modules/evals.ts     # ← evaluations.gs
  src/modules/photos.ts    # ← Code.js uploads/photos (→ R2)
  src/modules/client_view.ts # ← Code.js client_get_*
  src/modules/notifications.ts # ← notifications.gs
  src/modules/line_webhook.ts  # ← line.gs (webhook + digests, cron-triggered)
  src/modules/qc.ts        # ★ ใหม่ (Session 3)
  migrations/0001_init.sql # โครงตาราง §3
  seed/export-import.mjs   # Node script: ดูด export_all → INSERT D1
  test/golden/*.json       # snapshot เทียบเก่า-ใหม่ (§6)
```

---

## 3. โครงฐานข้อมูล D1 (แปลงจากแท็บ Sheets ตามคอลัมน์จริงที่ดัมป์มา)

กติกา: ชื่อตาราง = snake_case ไม่มีเลขนำหน้า · คอลัมน์ = ชื่อเดียวกับ header เดิม (แปลง snake_case) · handler แปลงกลับเป็น key เดิมของ API ตอนตอบ · ทุกตารางธุรกรรมมี `project_id TEXT` + index · วันที่เก็บ TEXT (YYYY-MM-DD) ตามเดิม · เวลาจริงเก็บ epoch ms INTEGER (บทเรียน checkin ts)

```sql
-- 00_Projects
CREATE TABLE projects (project_id TEXT PRIMARY KEY, name TEXT, client TEXT,
  quote_no TEXT, start_date TEXT, end_date TEXT, total_days INTEGER,
  total_value REAL, contractor TEXT, status TEXT, sheets_id TEXT, created_at TEXT);

-- 02_FF_Items
CREATE TABLE ff_items (project_id TEXT, code TEXT, bf_code TEXT, name TEXT,
  area TEXT, zone TEXT, price REAL, scope_type TEXT, status TEXT,
  risk_level TEXT, notes TEXT, PRIMARY KEY (project_id, code));

-- 03_Tasks_Checklist
CREATE TABLE tasks (id TEXT PRIMARY KEY, project_id TEXT, ff_code TEXT,
  zone TEXT, phase TEXT, name TEXT, status TEXT, start_date TEXT,
  end_date TEXT, done_date TEXT, person_in_charge TEXT, notes TEXT, weight INTEGER);

-- 04_Payments
CREATE TABLE payments (payment_id TEXT PRIMARY KEY, project_id TEXT,
  milestone TEXT, sub_item TEXT, zone TEXT, pct_of_total REAL, amount REAL,
  due_date TEXT, status TEXT, paid_date TEXT, receipt_no TEXT, notes TEXT);

-- 05_Risks (รวมคอลัมน์ R1)
CREATE TABLE risks (risk_id TEXT PRIMARY KEY, project_id TEXT, category TEXT,
  description TEXT, affected_ff TEXT, severity TEXT, likelihood TEXT, impact TEXT,
  likelihood_score INTEGER, impact_score INTEGER, risk_score INTEGER,
  causes TEXT, affected_parties TEXT, mitigation TEXT, status TEXT,
  owner TEXT, date_identified TEXT);

-- 07_Daily_Reports
CREATE TABLE daily_reports (id TEXT PRIMARY KEY, project_id TEXT, date TEXT,
  reporter_name TEXT, reporter_role TEXT, weather TEXT, tasks_done TEXT,
  workers_count INTEGER, workers_list TEXT, issues TEXT, summary_text TEXT,
  time_start TEXT, time_end TEXT, quick_log_raw TEXT, ai_processed TEXT,
  status TEXT, created_at TEXT, updated_at TEXT);

-- 08_Quick_Logs
CREATE TABLE quick_logs (id TEXT PRIMARY KEY, project_id TEXT, date TEXT,
  text TEXT, created_at TEXT);

-- 09_Contractors / 10_Suppliers
CREATE TABLE contractors (id TEXT PRIMARY KEY, name TEXT, type TEXT, role TEXT,
  phone TEXT, payment_type TEXT, notes TEXT, active TEXT, created_at TEXT);
CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT, category TEXT,
  contact_person TEXT, phone TEXT, address TEXT, payment_terms TEXT,
  notes TEXT, active TEXT, created_at TEXT);

-- 11_Materials
CREATE TABLE materials (id TEXT PRIMARY KEY, project_id TEXT, name TEXT,
  unit TEXT, category TEXT, spec TEXT, size TEXT, default_price REAL,
  default_supplier_id TEXT, linked_ffs TEXT, min_stock_alert REAL,
  current_stock REAL, notes TEXT, active TEXT, created_at TEXT,
  tracking_mode TEXT, last_status_update TEXT);

-- 12_Material_Transactions
CREATE TABLE material_transactions (id TEXT PRIMARY KEY, project_id TEXT,
  date TEXT, type TEXT, material_id TEXT, quantity REAL, unit_price REAL,
  total_value REAL, supplier_id TEXT, contractor_id TEXT, ff_code TEXT,
  report_id TEXT, remaining_after REAL, receipt_no TEXT, notes TEXT,
  created_by TEXT, created_at TEXT);

-- 13_Task_Photos / 16_Material_Photos
CREATE TABLE task_photos (photo_id TEXT PRIMARY KEY, project_id TEXT,
  task_id TEXT, report_id TEXT, url TEXT, drive_id TEXT, r2_key TEXT,
  caption TEXT, client_visible TEXT, uploaded_at TEXT, uploaded_by TEXT);
CREATE TABLE material_photos (photo_id TEXT PRIMARY KEY, project_id TEXT,
  linked_to TEXT, link_id TEXT, url TEXT, drive_id TEXT, r2_key TEXT,
  caption TEXT, uploaded_at TEXT, uploaded_by TEXT);

-- 14_BOQ_Items
CREATE TABLE boq_items (id TEXT PRIMARY KEY, project_id TEXT, ff_code TEXT,
  material_id TEXT, planned_qty REAL, unit TEXT, notes TEXT, created_at TEXT);

-- 17_Activity_Logs
CREATE TABLE activity_logs (log_id TEXT PRIMARY KEY, project_id TEXT,
  date TEXT, timestamp TEXT, type TEXT, source TEXT, text TEXT,
  tags_ff TEXT, tags_ctr TEXT, tags_issue TEXT, tags_phase TEXT,
  photo_url TEXT, meta_json TEXT);
CREATE INDEX idx_activity_proj_date ON activity_logs(project_id, date);

-- 21_Teams / 29_Project_Teams
CREATE TABLE teams (team_id TEXT PRIMARY KEY, name TEXT, type TEXT,
  lead_name TEXT, phone TEXT, category TEXT, members TEXT, active TEXT,
  notes TEXT, created_at TEXT);
CREATE TABLE project_teams (assignment_id TEXT PRIMARY KEY, project_id TEXT,
  team_id TEXT, active TEXT, added_at TEXT);

-- 22_Contracts / 23_Milestones / 25_ContractFiles / 26_PaymentSlips
CREATE TABLE contracts (contract_id TEXT PRIMARY KEY, project_id TEXT,
  team_id TEXT, contract_no TEXT, type TEXT, title TEXT, value REAL,
  sign_date TEXT, paid_total REAL, tax_pct REAL, file_link TEXT,
  parent_id TEXT, status TEXT, party TEXT, notes TEXT, created_at TEXT);
CREATE TABLE milestones (milestone_id TEXT PRIMARY KEY, project_id TEXT,
  contract_id TEXT, seq INTEGER, name TEXT, condition TEXT, pct REAL,
  amount REAL, status TEXT, paid_amount REAL, paid_date TEXT,
  evidence_status TEXT, notes TEXT);
CREATE TABLE contract_files (file_id TEXT PRIMARY KEY, contract_id TEXT,
  url TEXT, drive_id TEXT, r2_key TEXT, name TEXT, file_type TEXT,
  uploaded_at TEXT, uploaded_by TEXT);
CREATE TABLE payment_slips (slip_id TEXT PRIMARY KEY, milestone_id TEXT,
  contract_id TEXT, url TEXT, drive_id TEXT, r2_key TEXT, name TEXT,
  file_type TEXT, uploaded_at TEXT, uploaded_by TEXT);

-- 24_Staff (+Phase G) / 27_Project_Staff
CREATE TABLE staff (staff_id TEXT PRIMARY KEY, name TEXT, role TEXT,
  phone TEXT, active TEXT, notes TEXT, email TEXT, auth_role TEXT, created_at TEXT);
CREATE TABLE project_staff (assignment_id TEXT PRIMARY KEY, project_id TEXT,
  staff_id TEXT, role_in_project TEXT, assigned_date TEXT, active TEXT);

-- 28_CheckIns / 29_SiteConfig / 30_StaffIDCard
CREATE TABLE checkins (checkin_id TEXT PRIMARY KEY, project_id TEXT,
  staff_id TEXT, staff_name TEXT, role TEXT, date TEXT, time TEXT,
  ts INTEGER, period TEXT, on_time TEXT, location_type TEXT,
  off_site_reason TEXT, distance_m REAL, is_far TEXT, lat REAL, lng REAL,
  accuracy REAL, activity TEXT, ff_code TEXT, note TEXT, photo_url TEXT,
  created_at TEXT);
CREATE INDEX idx_checkins_proj_date ON checkins(project_id, date);
CREATE TABLE site_config (project_id TEXT PRIMARY KEY, site_lat REAL,
  site_lng REAL, radius_m REAL, updated_at TEXT, updated_by TEXT);
CREATE TABLE staff_id_cards (staff_name TEXT PRIMARY KEY, national_id TEXT,
  updated_at TEXT);

-- 28_Contractor_Evaluations (ชื่อแท็บชนเลข 28 กับ CheckIns — คนละตาราง!)
CREATE TABLE contractor_evaluations (eval_id TEXT PRIMARY KEY, project_id TEXT,
  team_id TEXT, team_name TEXT, eval_date TEXT, evaluator TEXT,
  manpower REAL, progress REAL, quality REAL, first_pass REAL, delivery REAL,
  response REAL, discipline REAL, finance REAL, total_score REAL, grade TEXT,
  status TEXT, remark TEXT, sub_scores TEXT, created_at TEXT);

-- ตัวออกเลขรายการ (แทนการ scan หา max — เร็ว + กันชนด้วย transaction)
CREATE TABLE id_counters (prefix TEXT PRIMARY KEY, next_seq INTEGER);

-- ★ QC (ใหม่ — Session 3, จากไฟล์ QC บ้านคุณวริษฐา)
CREATE TABLE qc_criteria (criteria_id TEXT PRIMARY KEY, section TEXT,
  section_name TEXT, seq REAL, item TEXT, acceptance TEXT, method TEXT,
  defects TEXT, defect_class TEXT, active TEXT);           -- master 24 ข้อ A–H
CREATE TABLE qc_inspections (inspection_id TEXT PRIMARY KEY, project_id TEXT,
  ff_code TEXT, item_name TEXT, location TEXT, maker TEXT, drawing_ref TEXT,
  inspector TEXT, inspect_date TEXT, round INTEGER, status TEXT,
  summary_pass INTEGER, summary_fail INTEGER, summary_na INTEGER,
  notes TEXT, created_at TEXT);
CREATE TABLE qc_results (result_id TEXT PRIMARY KEY, inspection_id TEXT,
  criteria_id TEXT, result TEXT,           -- pass | fail | na
  defect_class TEXT,                       -- C | M | Mn (ถ้า fail)
  note TEXT, photo_url TEXT, fixed_date TEXT, recheck_result TEXT);
```

**การออกเลข ID:** ใช้ `id_counters` + `INSERT ... RETURNING` ใน batch transaction ของ D1 — เลิก scan ทั้งตาราง (แก้ทั้งเรื่องช้าและเรื่องเลขซ้ำที่ไม่มี LockService ในระบบเก่า) · seed script ต้องตั้ง `next_seq` = max ที่พบจากข้อมูลเก่า + 1 ต่อ prefix (`T-`, `LOG-`, `CHK-`, `MAT-`, `TXN-`, `CT`, `MS-`, `EV-`, `RSK-` ฯลฯ ตามที่พบจริงตอน seed)

---

## 4. การย้าย "ของนอกตาราง"

| ของเดิม (Apps Script) | ของใหม่ (Workers) | หมายเหตุ |
|---|---|---|
| `Utilities.computeHmacSha256Signature` (token) | Web Crypto `crypto.subtle.sign('HMAC')` | ใช้ `AUTH_SECRET` ตัวเดิม → **token เก่ายังใช้ได้ ผู้ใช้ไม่ต้อง login ใหม่** |
| Google tokeninfo (`auth.gs:106`) | `fetch('https://oauth2.googleapis.com/tokeninfo?...')` | เหมือนเดิม |
| DriveApp upload + `setSharing` | R2 `MEDIA.put(key)` + เสิร์ฟผ่าน route `GET /media/<key>` | key: `<project>/<subtype>/<ts>_<name>` · ลิงก์เก่า `drive.google.com/...` ใน DB ใช้ต่อ ไม่ย้ายไฟล์ |
| LINE push **ใน request path** | `ctx.waitUntil(fetch(api.line.me))` | ผู้ใช้ไม่ต้องรอ LINE อีกต่อไป |
| LINE webhook (POST มี `destination`+`events`) | route `/line/webhook` | ตรวจ signature ด้วย channel secret ถ้ามี |
| digest triggers (`_install_line_digest`) | **Cron Triggers** ใน wrangler.toml (daily/weekly/ops — คัดเวลาเดิมจาก line.gs) | |
| Gemini `callGemini`/`callGeminiJSON_`/vision | `fetch(generativelanguage.googleapis.com)` โมเดลเดิมจาก env | consumers 9 ตัว ดู inventory |
| Script Properties (secrets) | `wrangler secret put` — **ทุกตัวต้องจดลง** `Inarch-Ops/secrets-ledger_HUMAN.md` | รายชื่อ: AUTH_SECRET, GEMINI_API_KEY, GEMINI_MODEL, GEMINI_VISION_MODEL, ADMIN_PASSWORD, CLIENT_PASSWORD, LINE_TOKEN, LINE_GROUP_ID, LINE_GROUP_OPS_ID, LINE_OWNER_UID |
| JSONP + no-cors + iframe upload hack | ❌ ทิ้งทั้งหมด — Workers ตอบ CORS header จริง ทุก call เป็น `fetch` ปกติ | บทเรียน `callwrite-loses-post-body` หมดยุค |

---

## 5. ฝั่งหน้าเว็บ (แก้ 2 ไฟล์เท่านั้น)

`js/config.js`: เพิ่ม `BACKEND: 'gas'` (ค่าเริ่ม) + `CF_API_URL: 'https://dstr-api.<account>.workers.dev'`
`js/api.js`: ใน `callRead/callWrite/callPost/callUpload` — ถ้า `CONFIG.BACKEND==='cf'` ให้ยิง `fetch` ปกติ (GET query / POST JSON / POST multipart สำหรับรูป) ไปที่ `CF_API_URL + '/api'` · ถ้า `'gas'` ใช้โค้ดเดิมทุกบรรทัด **ห้ามลบ path เดิม** จนพ้นช่วง dual-run
- `callWrite` บน cf ต้องอ่าน response จริงได้แล้ว → คืน `{ok, ...}` จริงแทน `{ok:true}` หลอกๆ (หน้าเว็บเดิมรองรับอยู่แล้วเพราะ shape เดียวกัน)
- `callUpload` บน cf = `fetch` POST ธรรมดา (base64 ใน JSON ได้เลย ไม่ติด redirect) — โค้ด iframe เดิมคงไว้ให้ path gas

---

## 6. Seed + Verification (หัวใจของ "ไม่พังข้อมูล")

1. **Session 1 เพิ่ม action `export_all` ใน Apps Script** (additive-only, ผ่าน route()/handle() ตาม convention เดิม, จำกัดด้วย `ADMIN_PASSWORD`): รับ `tab=<ชื่อแท็บ>` คืน `{headers:[], rows:[][]}` ดิบๆ ของแท็บนั้น → deploy ด้วย clasp ตาม workflow ใน memory
2. `seed/export-import.mjs`: ไล่ดูดทุกแท็บใน §3 → แปลง → `wrangler d1 execute` INSERT เป็น batch → ตั้ง id_counters
3. **Verification ต้องผ่านครบก่อนสลับ:**
   - จำนวนแถวทุกตาราง เก่า = ใหม่ (พิมพ์ตาราง count เทียบ)
   - Golden snapshots: เรียก read actions หลัก 15 ตัว (get_ff_list, get_tasks, get_checkins, get_materials, get_transactions, get_projects, get_client_finance, get_teams_bundle, get_evals, get_daily_bundle, get_today_stats, get_timesheet, get_notifications, get_inventory_summary, client_get_overview) จากทั้ง 2 ระบบด้วย params เดียวกัน → JSON ต้อง deep-equal (ยกเว้น field เวลา generate)
   - เช็คธุรกิจ 3 ตัวเลขกับหน้าจอจริง: % ความคืบหน้ารวม bow-house · ยอด paid_total ต่อสัญญา CT004/CT005/CT006 · จำนวนเช็คอินเดือนล่าสุด
4. **คืนวันตัดยอด:** ประกาศหยุดบันทึก 30 นาที → seed รอบสุดท้าย (ดูดเฉพาะแถวใหม่กว่า watermark หรือดูดทับทั้งหมด — ข้อมูลหลักพันแถว ดูดทับได้) → verify ซ้ำ → สลับ `BACKEND:'cf'` → push GitHub Pages

---

## 7. ความปลอดภัย (ยกระดับจากของเดิม 1 ขั้น ไม่มากกว่านั้น)

- Token HMAC + สิทธิ์ role/project: **port ตรรกะ `_authorize_` เดิมเป๊ะ** (อย่าออกแบบ RBAC ใหม่ในรอบนี้)
- ช่องโหว่เดิมที่รู้แล้ว: read ทั้งหมดเปิด anonymous — **คงพฤติกรรมเดิมไว้ก่อน** ด้วย env `ALLOW_ANON_READ='true'` (กันหน้าเว็บ/PWA ที่ยังไม่ส่ง token พัง) → ปิดทีหลังเป็นงานแยกหลังตัดยอด (จดใน backlog แล้ว)
- CORS: อนุญาต origin ของ GitHub Pages + localhost เท่านั้น (ดีกว่าเดิมที่ JSONP เปิดหมด)
- Secrets ทุกตัวจดลง ledger ตามวินัย [[project-phase0-security-partA]]

---

## 8. สิ่งที่เจ้าของงานต้องทำเอง (ครั้งเดียว ตอนเริ่ม Session 1)

1. สมัคร Cloudflare ฟรี: https://dash.cloudflare.com/sign-up — **ใช้อีเมล keatudom456@gmail.com (เคาะแล้ว 2026-07-14)**
2. ใน session ที่รัน ให้พิมพ์ `! npx wrangler login` (เบราว์เซอร์จะเด้งให้กด Allow)
3. เตรียมค่า secrets 10 ตัว (§4) — Claude จะไล่ขอทีละตัวตอน `wrangler secret put` (ค่าอยู่ใน Script Properties ของ Apps Script เดิม: เปิด script.google.com → โปรเจกต์ → Settings → Script Properties)

## 9. นิยาม "เสร็จ" ของทั้งงาน

- [ ] ทุก action ใน SESSION-2 checklist ตอบถูกบน Worker (golden เทียบผ่าน)
- [ ] Seed verification §6 ผ่านครบ 3 ชั้น
- [ ] หน้าเว็บทุกหน้าใช้งานได้บน `BACKEND:'cf'` (Playwright smoke: login → dashboard → เช็คอิน → วัสดุ → การเงิน → QC)
- [ ] เวลาตอบ: read เดี่ยว < 500ms (วัดจากไทย) · เปิด dashboard ครบ < 2 วิ
- [ ] ระบบเก่ายังแตะได้ทาง `BACKEND:'gas'` (rollback ทดสอบแล้วจริง 1 ครั้ง)
- [ ] Secrets ครบใน ledger · commit + PR เล่าเป็นภาษาคนธรรมดาตามวินัย 4-Debts

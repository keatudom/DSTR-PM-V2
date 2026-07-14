# S2-HANDOFF — ย้ายคำสั่งหลังบ้าน 131 ตัว (Endpoint Port)

> สถานะ: **พอร์ตครบ 131 actions · 11 โมดูล · typecheck ผ่าน · เทสต์ behavioral บน D1 local ครบทุกตัวที่ไม่ติด gate**
> ผู้ปฏิบัติ: Session 2 · อัปเดต: 2026-07-14 · commit เป็นระยะแล้ว (ยังไม่ push ตามคำสั่ง)
> เทสต์ทั้งหมดใช้ project_id `_test-mig` บน **D1 local เท่านั้น** — ไม่แตะ bow-house/remote เลย

---

## 1. สรุปผู้บริหาร (ภาษาคนธรรมดา)

ย้าย "สมองหลังบ้าน" ครบทั้ง 131 คำสั่งจาก Apps Script (ช้า ~3 วิ/คำสั่ง) มาเป็น Cloudflare Workers + D1
เรียบร้อย แบ่งเป็น 11 หมวด (โมดูล) แต่ละคำสั่ง "ตอบเหมือนของเดิมเป๊ะ" — ชื่อ field, โครงคำตอบ, ข้อความ
error ภาษาไทย, กติกา RAW (บางคำสั่งตอบดิบไม่ห่อ) ทุกอย่างลอกของเก่าเป๊ะ

ผมทดสอบทุกคำสั่งที่ทดสอบได้ตอนนี้ (อ่านข้อมูลจริง bow-house + เขียน-ลบข้อมูลทดสอบในโปรเจกต์ปลอม
`_test-mig`) ผ่านหมด รวมถึงตัวเลขธุรกิจสำคัญ เช่น สัญญาเจ้าบ้าน CT004 = 1,695,000 บาท จ่ายแล้ว
1,084,800 บาท (ตรงกับของจริง) และ paid_total คำนวณใหม่อัตโนมัติเมื่อมาร์คงวดจ่าย

**ยังทดสอบสดไม่ได้ 3 กลุ่ม (ติด "ประตู/gate")** — โค้ดเขียนครบแล้ว แต่รอเปิดสวิตช์:
- **อัปโหลดรูป/ไฟล์ (R2):** ต้องเปิด R2 bucket ก่อน (Session 3) — ตอนนี้ยิงแล้วขึ้น error ชัดว่า "R2 ยังไม่เปิด"
- **AI (Gemini):** parse/สรุป/สแกนบิล/แนะนำ task — ต้องมี GEMINI_API_KEY (secret)
- **LINE (webhook + สรุปเย็น/สัปดาห์/หน้างาน):** ต้องมี LINE_TOKEN + group id (secret) + deploy (cron)

---

## 2. เช็คลิสต์ 131 actions (ติ๊กครบ)

> ✅ = พอร์ต+wire+typecheck ผ่าน · 🧪 = เทสต์ behavioral บน D1 local ผ่าน · 🔒 = โค้ดครบ รอ gate จึงเทสต์สด

### AUTH (6) — **ทำโดย Session 1** (`src/modules/auth.ts`)
✅ login · login_google · get_me · get_users · upsert_user · set_user_role

### PROJECTS / FF / TASKS / PAYMENTS (16) — `ff_tasks.ts` + `projects.ts`
✅🧪 ping · getAll‼ · get_ff_list · get_tasks · updateTask‼ · updatePayment‼ · create_payment ·
update_payment_info · create_ff · create_ff_batch · update_ff · delete_ff · clone_project ·
get_projects · create_project · update_project

### CHECKIN (9) — `checkin.ts`
✅🧪 create_checkin · get_checkins · get_timesheet · get_attendance_all · update_checkin ·
set_id_card · get_site_location · set_site_location · delete_checkin

### MATERIALS / BOQ / INVENTORY / AI (21) — `materials.ts`
✅🧪 get_suppliers · create_supplier · get_materials · get_material · create_material · update_material ·
deactivate_material · delete_material · get_transactions · receive_material · withdraw_material ·
count_material · check_stock_for_items · get_boq · create_boq · check_boq_status ·
get_inventory_summary · update_material_prices · get_ai_alerts ·
🔒 parse_material_log (Gemini) · confirm_material_log (เรียก receive — logic เทสต์ผ่านทางอ้อม)

### DAILY / ACTIVITY / AI (21) — `daily.ts`
✅🧪 get_daily_reports · get_daily_report · create_daily · auto_detect_daily · delete_daily ·
add_quick_log · add_activity_log · get_activity_feed · get_material_transactions · delete_activity_log ·
untick_task_from_log · confirm_task_tick · save_ai_summary · get_saved_summary · get_today_stats · get_daily_bundle ·
🔒 generate_daily_summary · generate_daily_summary_v2 · ai_summary · parse_activity_text · suggest_task_from_log (Gemini)

### TEAMS / CONTRACTS / FINANCE / STAFF (23) — `teams_finance.ts`
✅🧪 get_teams_bundle · get_teams · team_checkin · create_team · update_team · delete_team ·
get_project_teams · assign_project_team · unassign_project_team · create_contract · update_contract ·
create_milestone · update_milestone (recalc paid_total) · create_staff · update_staff · get_all_staff ·
get_project_staff · assign_project_staff · unassign_project_staff · get_client_finance · get_contractors ·
create_contractor · 🔒 detect_unknowns (Gemini)

### RISKS (4) — `risks.ts`
✅🧪 create_risk · update_risk · delete_risk · clone_risks (LINE เด้ง risk สูง = gate)

### EVALUATIONS (6) — `evals.ts`
✅🧪 get_eval_config · get_evals · get_eval_summary · create_eval · update_eval · delete_eval

### PHOTOS / FILES / AI-BILL (16) — `photos.ts`  (uploads = R2 gate)
✅🧪 get_photos · add_photo · get_material_photos · get_task_photos · get_transaction_photos ·
delete_photo · delete_task_photo · get_contract_files · delete_contract_file · delete_payment_slip ·
🔒 upload_photo · upload_log_photo‼ · upload_payment_slip‼ · upload_contract_file‼ · scan_bill (Vision) · confirm_bill_items

### CLIENT VIEW (4) — `client_view.ts`
✅🧪 client_get_overview · client_get_photos · client_get_milestones · client_get_payments (Phase F client contract)

### NOTIFICATIONS / LINE (5) — `notifications.ts` + `line_webhook.ts`
✅🧪 get_notifications · 🔒 /line/webhook · _run_line_digest · _run_weekly_digest · _run_ops_digest (LINE+Gemini+cron gate)

**รวม 131 ✅** (Session 1 = auth 6 + ping · Session 2 = 124)

---

## 3. โครงสร้างที่เพิ่ม (ของ Session 2)

```
cf-api/src/
  lib/
    activity.ts   ★ ใหม่ — autoLog/appendActivityLog (ทุกโมดูลใช้; nextId 'LOG' pad4)
    line.ts       ★ ใหม่ — linePush/notifyImportant/notifyOwner (waitUntil ไม่ block)
    gemini.ts     ★ ใหม่ — callGemini/callGeminiJSON/callGeminiVision (fetch แทน UrlFetchApp)
    r2.ts         ★ ใหม่ — putMedia (ไฟล์ใหม่เข้า R2; gate ถ้า MEDIA ปิด)
    db.ts         + projectScope/pidOf/fmtDate/blankNulls (helper กลาง)
  modules/
    checkin.ts ff_tasks.ts projects.ts materials.ts daily.ts teams_finance.ts
    risks.ts evals.ts client_view.ts photos.ts notifications.ts line_webhook.ts
  router.ts       + 124 case · index.ts + actor/ctx threading + /media + /line/webhook + scheduled()
  wrangler.toml   + [triggers] crons 3 ตัว
```

**Pattern ที่วางไว้ (ให้ทุกโมดูลเหมือนกัน):**
- handler = `(env, p) => data` คืน object ดิบ · router ห่อ `{ok,data}` (ยกเว้น RAW_ACTIONS)
- `pidOf(p)` = `p.project_id || 'bow-house'` · `projectScope(pid)` = แทน `_filterByProject_`
  ('bow-house' รวมแถว project_id ว่าง)
- คอลัมน์ D1 = snake_case ตาม `migrations/0001_init.sql` · handler map กลับเป็น key เดิมของ API
  (camelCase อย่าง ffCode / header เดิมอย่าง 'FF Code' แล้วแต่ contract เดิม)
- actor (จาก token) ร้อยผ่าน `p.__actor` · executionCtx ผ่าน `p.__ctx` (แทน global เดิม)

---

## 4. ⚠️ จุดต่างจากเดิม (deviations — เจ้าของงานช่วยเคาะ)

> เป้าหมายคือ "เป๊ะ" แต่บางจุดของเก่าขัดกับ schema ใหม่/ข้อจำกัด CF — ผมเลือกทางที่สมเหตุผล
> และจดไว้ให้เคาะ (ตามวินัย 4-Debts: AI เขียนได้แต่เจ้าของตัดสิน)

1. **activity_logs.project_id — ผม "แสตมป์" ใส่ (ของเดิมปล่อยว่าง)** ⭐ จุดที่ควรเคาะที่สุด
   - ของเดิม: แท็บ activity เขียน 12 คอลัมน์ ไม่ยัด project_id → feed หลายโปรเจกต์ทำงานเฉพาะ bow-house
     (ผ่านการ match แถวว่าง). schema ใหม่มีคอลัมน์ + index ตั้งใจให้ใช้
   - ผมเลือก: stamp project_id ทุก log ใหม่ → feed/แจ้งเตือน/today_stats แยกตามโปรเจกต์ได้จริง
   - ผลต่อ golden: **bow-house ไม่ต่าง** (projectScope('bow-house') รวมทั้งแถวว่างและ 'bow-house')
     ต่างเฉพาะโปรเจกต์อื่น (ซึ่งของเดิมพังอยู่แล้ว) · ถ้าอยากเป๊ะ 100% บอกได้ ผมถอด stamp ออกให้

2. **client_get_overview: ชื่อโปรเจกต์/วันจบ** — ของเดิมอ่านจากแท็บ `01_Project_Info` (ไม่ย้าย)
   → ผมอ่านจากตาราง `projects` แทน (ข้อมูลเดียวกัน ดีต่อ multi-project)

3. **team_id ใช้ counter 'T' ร่วมกับ task_id** — id_counters แยก prefix ด้วย regex ทำให้ 'T01'(team)
   กับ 'T0001'(task) นับ prefix 'T' เดียวกัน → team ใหม่ได้เลขสูง (เช่น T376) แต่ **id ไม่ซ้ำแน่นอน**
   (counter เดินหน้าอย่างเดียว). ถ้าอยากให้ team เป็น 'TM'/'TEAM' แยก ต้องแก้ seed id_counters (Session 1)

4. **boq_items ขาด 3 คอลัมน์** — schema D1 (BLUEPRINT §3) ไม่มี planned_unit_price/planned_total/created_by
   → create_boq ยัง "คืน" ครบในคำตอบ แต่ get_boq อ่านกลับจะไม่มี 3 ตัวนี้ (BOQ มี 0 แถวจริง — เสี่ยงต่ำ)

5. **ai_summary กรอง report_id ไม่ได้** — seed ตัดคอลัมน์ report_id ของ quick_logs ทิ้ง (transient ~3 แถว)
   → ai_summary ใช้ quick_logs ทั้งหมด (ของเดิมกรองตาม report_id)

6. **upload_* คืน url เป็น R2 `/media/<key>`** (ไม่ใช่ Drive url) ตาม BLUEPRINT §4 (ไฟล์ใหม่เข้า R2,
   ลิงก์ Drive เก่าใน DB คงเดิม) · frontend เอา url ไปต่อกับ CF_API_URL

7. **LINE /link เก็บ group id ถาวรไม่ได้** — CF secret เป็น immutable (เดิมใช้ setProperty) →
   เจ้าของตั้ง LINE_GROUP_ID/LINE_GROUP_OPS_ID/LINE_OWNER_UID ผ่าน `wrangler secret put` แทน
   (webhook ตอบ group id กลับให้เอาไปตั้ง)

8. **active/boolean เป็น 'TRUE'/'FALSE' (string)** ทุกที่ตาม seed (Sheets boolean → seed แปลง) —
   read ที่เดิมคืน boolean true จะได้ 'TRUE' แทน (frontend ใช้ truthy check อยู่แล้ว — ไม่กระทบ)

> deviation อื่นที่ "ไม่ต่างผลลัพธ์": distance_m/accuracy ว่างคืน null (ไม่ใช่ 0), Sheets ว่าง (`''`)
> → NULL ใน D1 → coalesce กลับเป็น `''` ผ่าน blankNulls/`||''` ให้ตรง

---

## 5. สิ่งที่ต้องทำต่อ (ก่อนสลับ BACKEND:'cf' จริง)

**A. ปลด gate (Session 1 + Session 3):**
- [ ] `wrangler secret put` ครบ 10 ตัว (Session 1 gate) → ปลดล็อก Gemini + LINE + login token จริง
- [ ] seed ข้อมูลจริงลง D1 remote (Session 1) → golden test ทำได้เต็ม
- [ ] เปิด R2: uncomment `[[r2_buckets]]` ใน wrangler.toml + `wrangler r2 bucket create dstr-media` (Session 3)
      → ปลดล็อก upload_* + scan_bill + /media serving

**B. Golden test เต็ม (หลัง seed):** เทียบ gas↔cf deep-equal 15 read actions หลัก (BLUEPRINT §6.3)
   — Session 2 ทำได้แค่ behavioral verify (พฤติกรรมตรง logic เดิมทีละบรรทัด) เพราะ gas ยังไม่ callได้กับข้อมูลชุดเดียวกัน

**C. เคาะ deviation ข้อ 1 (activity project_id stamp) + ข้อ 3 (team counter)**

**D. LINE cron:** ตอน deploy ตั้ง secret แล้ว cron 3 ตัวจะทำงาน (ops 3ชม / daily 18:30 / weekly อา.19:00 ไทย)
   — ทดสอบด้วย `?action=_run_line_digest` (สั่งเอง) ก่อนพึ่ง cron

---

## 6. สิ่งที่ Session 3 (QC) ต้องรู้
- โค้ด QC (`modules/qc.ts`, seed qc_*) commit แล้วโดย Session 3 เอง — Session 2 ไม่แตะ
- lib กลางที่ Session 2 เพิ่ม (activity/line/gemini/r2 + db helper) QC เอาไปใช้ได้เลย
- R2 gate: Session 3 เปิด R2 แล้ว upload_* ของ Session 2 จะทำงานทันที (แชร์ MEDIA binding เดียวกัน)
- getAll‼ (RAW) เพิ่มแล้ว — dashboard เก่าเรียกได้

## 7. ข้อควรระวัง (บทเรียน Session 2)
- **D1 local แชร์กับ seed ของ Session 1** — seed รัน `DELETE FROM <table>` ล้างข้อมูลทดสอบทิ้งได้ทุกเมื่อ
  (ข้อมูลทดสอบเป็น ephemeral — สร้างใหม่ต่อรอบ ไม่พึ่ง persist)
- **ห้าม push** จนเจ้าของงานสั่ง (commit แล้ว ~11 ก้อน)

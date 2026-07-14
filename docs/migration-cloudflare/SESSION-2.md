# SESSION 2 — ย้ายคำสั่งหลังบ้าน 131 ตัว (Endpoint Port) · เริ่มได้เมื่อ S1-HANDOFF.md มีจริง

> **อ่านก่อนเริ่ม:** `BLUEPRINT.md` (§1 หลักการ 5 ข้อ = คัมภีร์) · `S1-HANDOFF.md` · โค้ดต้นทางใน `apps-script/`
> **บทบาท:** ช่างย้ายเครื่องยนต์ — **ย้ายพฤติกรรมเดิมเป๊ะๆ ห้ามปรับปรุง/ห้ามรีแฟกเตอร์ logic ธุรกิจ** (ยกเว้น 3 อย่างที่ BLUEPRINT สั่ง: id จาก counters, LINE/Gemini ไม่ block response, SQL แทน full-scan)
> **แหล่งความจริง response shape:** โค้ด .gs เดิม — เปิดอ่านฟังก์ชันต้นทางทุกตัวก่อน port (มี file:line ครบใน inventory ด้านล่าง)

## ลำดับโมดูล (ตามความเจ็บหน้างาน — ทำเสร็จทีละโมดูล เทสต์แล้วค่อยไปต่อ)

1. `checkin.ts` ← checkin.gs (10 actions: create/get_checkins, get_timesheet, get_attendance_all, update/delete_checkin, set_id_card, get/set_site_location) — GPS haversine + period/on_time logic ลอกเดิมเป๊ะ
2. `ff_tasks.ts` ← Code.js (getAll‼raw, get_ff_list, get_tasks, updateTask‼raw, create_ff, create_ff_batch, update_ff, delete_ff, clone_project, create_payment, update_payment_info, updatePayment‼raw)
3. `projects.ts` ← projects_patch.gs (get/create/update_project)
4. `materials.ts` ← Code.js (21 actions: materials CRUD, transactions, receive/withdraw/count, boq, inventory_summary, ai_alerts, check_stock_for_items, parse_material_log→Gemini, confirm_material_log, update_material_prices)
5. `daily.ts` ← Code.js (21 actions: daily CRUD, activity feed/log, today_stats, daily_bundle, AI summaries v1/v2, parse_activity_text, suggest_task_from_log, confirm_task_tick, untick_task_from_log, save/get_saved_summary, add_quick_log)
6. `teams_finance.ts` ← Code.js + project_teams.gs + client_finance.gs (teams CRUD, team_checkin, project_teams, contracts, milestones, staff CRUD, project_staff, get_client_finance, get_teams_bundle, contractors, suppliers, detect_unknowns)
7. `photos.ts` ← Code.js (upload_photo, upload_log_photo‼raw, upload_payment_slip‼raw, upload_contract_file, get_*_photos, delete_*, scan_bill→Gemini Vision, confirm_bill_items) — อัปโหลดลง R2 ตาม §4, ตอบ shape เดิม (photo_url ฯลฯ)
8. `risks.ts` ← risks.gs (create/update/delete_risk, clone_risks)
9. `evals.ts` ← evaluations.gs (get_eval_config, get_evals, get_eval_summary, create/update/delete_eval)
10. `client_view.ts` ← Code.js (client_get_overview/photos/milestones/payments — field whitelist เดิม)
11. `notifications.ts` + `line_webhook.ts` ← notifications.gs + line.gs (get_notifications, /line/webhook route, digests 3 ตัวเป็น cron handler — เวลา cron ลอกจาก trigger เดิมใน line.gs)

**Skip list (ห้าม port):** ดู inventory §3 — `_phase_*`, `_seed_*`, `_init_auth_secret`, `*_test`, `_diag_*`, `_install_line_digest`, `_set_line_config`, `_task_weights_backfill`, `_ensure_eval_sheets`

## กติกาเทสต์ (ทุกโมดูลก่อนนับว่าเสร็จ)

- **Golden test:** read actions ของโมดูล → เรียก gas กับ cf ด้วย params เดียวกัน → deep-equal (เก็บ snapshot ใน `test/golden/`) · write actions → เขียนบน cf → อ่านกลับตรวจค่า → ลบทิ้ง (ใช้ project_id ทดสอบ `_test-mig` ที่สร้างเฉพาะกิจใน D1 — **ห้ามเขียนทดสอบลง bow-house**)
- getAll/updateTask/updatePayment/upload_* ต้องตอบ **raw** ไม่ห่อ {ok,data} (BLUEPRINT §1 ข้อ 2)
- Gemini/LINE: mock ไม่ได้ก็เทสต์ของจริงเบาๆ (LINE ยิงเข้า owner UID ไม่ใช่กรุ๊ป)

## นิยามเสร็จ

- [ ] 131 actions ตอบบน Worker ครบ (เทียบ checklist inventory ทีละตัว ติ๊กใน S2-HANDOFF.md)
- [ ] golden ผ่านทุก read หลัก 15 ตัว (รายชื่อใน BLUEPRINT §6.3)
- [ ] ไม่มี write ใดแตะ bow-house จริงระหว่างเทสต์
- [ ] เขียน `S2-HANDOFF.md`: ติ๊กครบ 131 + จุดที่พฤติกรรมต่างจากเดิม (ควรเป็นศูนย์) + สิ่งที่ Session 3 ต้องรู้

# สารบัญคำสั่งหลังบ้านทั้งหมด (149 actions) — แหล่งอ้างอิงสำหรับ Session 2

> สร้างโดย audit 2026-07-14 · 131 ย้าย / 18 ทิ้ง · handler อยู่ Code.js เว้นแต่ระบุ
> Wrapper: ทุกตัวตอบ `{ok,data}` ยกเว้น ‼raw = getAll, updateTask, updatePayment, upload_log_photo, upload_payment_slip, upload_contract_file (Code.js:143-155)
> LINE webhook POST (body มี destination+events) ตัดเข้า lineWebhook_ ก่อนถึง route (Code.js:132-135)

## Secrets ใน Script Properties เดิม (ย้ายเป็น wrangler secrets)
SHEETS_ID · GEMINI_API_KEY · GEMINI_MODEL (default gemini-2.5-flash) · GEMINI_VISION_MODEL · ADMIN_PASSWORD · CLIENT_PASSWORD · AUTH_SECRET · LINE_TOKEN · LINE_GROUP_ID · LINE_GROUP_OPS_ID · LINE_OWNER_UID

## แท็บ Sheets ↔ ตาราง D1
| แท็บเดิม | ตาราง D1 | หมายเหตุ |
|---|---|---|
| 00_Projects | projects | |
| 02_FF_Items | ff_items | |
| 03_Tasks_Checklist | tasks | |
| 04_Payments | payments | |
| 05_Risks | risks | รวมคอลัมน์ R1 (Likelihood/Impact/Risk Score, Causes, Affected Parties) |
| 07_Daily_Reports | daily_reports | |
| 08_Quick_Logs | quick_logs | |
| 09_Contractors / 10_Suppliers | contractors / suppliers | |
| 11_Materials / 12_Material_Transactions | materials / material_transactions | |
| 13_Task_Photos / 16_Material_Photos | task_photos / material_photos | |
| 14_BOQ_Items | boq_items | |
| 17_Activity_Logs | activity_logs | meta_json มี actor/actor_role/kind |
| 21_Teams / 29_Project_Teams | teams / project_teams | ⚠️ เลข 29 ซ้ำกันสามแท็บ — ชื่อเต็มไม่ชนกัน |
| 22_Contracts / 23_Milestones / 25_ContractFiles / 26_PaymentSlips | contracts / milestones / contract_files / payment_slips | party = contractor|client |
| 24_Staff / 27_Project_Staff | staff / project_staff | Staff มี email+auth_role (Phase G) |
| 28_CheckIns / 29_SiteConfig / 30_StaffIDCard | checkins / site_config / staff_id_cards | ⚠️ 28 ซ้ำกับ Evaluations |
| 28_Contractor_Evaluations / 29_Eval_Rubric | contractor_evaluations / (rubric = ค่าคงที่ในโค้ด ไม่ต้องมีตาราง) | |
| 01_Project_Info, 06_Timeline, 15_Variance_Reasons | ไม่ย้าย (ไม่มี route ใช้) | ตรวจยืนยันตอน seed ว่าไม่มีหน้าเว็บเรียก |

## AUTH (auth.gs)
| action | ref | R/W | sheets | ย้าย? |
|---|---|---|---|---|
| login | Code.js:894 | R | — | ✅ |
| login_google | auth.gs:101 | RW | STAFF, PROJECT_STAFF | ✅ (fetch tokeninfo) |
| get_me | auth.gs:165 | R | STAFF, PROJECT_STAFF | ✅ |
| get_users | auth.gs:360 | R | STAFF, PROJECT_STAFF | ✅ |
| upsert_user | auth.gs:392 | W | STAFF | ✅ |
| set_user_role | auth.gs:450 | W | STAFF | ✅ |
| _phase_g_migrate / _init_auth_secret / _auth_selftest | auth.gs:469/47/490 | — | — | ❌ ทิ้ง |

## PROJECTS / FF / TASKS / PAYMENTS
| action | ref | R/W | sheets | ย้าย? |
|---|---|---|---|---|
| ping | Code.js:280 | R | — | ✅ |
| getAll ‼raw | Code.js:617 | R | FF,TASKS,PAYMENTS,RISKS,CONTRACTORS,MATERIALS | ✅ |
| get_projects / create_project / update_project | projects_patch.gs:44/115/83 | R/W | 00_Projects | ✅ |
| get_ff_list | Code.js:628 | R | FF | ✅ |
| get_tasks | Code.js:644 | R | TASKS+PHOTOS(count) | ✅ |
| updateTask ‼raw | Code.js:855 | W | TASKS+ACTIVITY(autoLog) | ✅ |
| create_ff / update_ff / delete_ff(cascade tasks) | projects_wizard.gs:15/83/131 | W | FF(,TASKS) | ✅ |
| create_ff_batch | projects_wizard.gs:216 | W | FF,TASKS | ✅ |
| clone_project | projects_wizard.gs:326 | W | FF,TASKS | ✅ |
| updatePayment ‼raw / create_payment / update_payment_info | Code.js:876/735/767 | W | PAYMENTS | ✅ |
| _task_weights_backfill | Code.js:786 | — | — | ❌ |

## MATERIALS / BOQ / INVENTORY
| action | ref | R/W | หมายเหตุ | ย้าย? |
|---|---|---|---|---|
| get_suppliers / create_supplier | :335/:935 | R/W | | ✅ |
| get_materials / get_material | :1037/:1046 | R | | ✅ |
| create/update/deactivate/delete_material | :1055/:1080/:1096/:1109 | W | delete มี guard ถ้ามี txn อ้าง | ✅ |
| get_transactions | :1126 | R | | ✅ |
| receive/withdraw/count_material | :1134/:1188/:1264 | W | อัป stock + autoLog · withdraw เช็ค BOQ | ✅ |
| parse_material_log | :1315 | R | Gemini JSON | ✅ |
| confirm_material_log | :1413 | W | วน receive/withdraw ต่อ item | ✅ |
| check_stock_for_items | :3792 | R | | ✅ |
| get_boq / create_boq / check_boq_status | :1469/:1474/:1517 | R/W | | ✅ |
| get_inventory_summary | :979 | R | | ✅ |
| update_material_prices | :959 | W | | ✅ |
| get_ai_alerts | :1540 | R | heuristics ในโค้ด | ✅ |

## DAILY / ACTIVITY / AI
| action | ref | R/W | หมายเหตุ | ย้าย? |
|---|---|---|---|---|
| get_daily_reports / get_daily_report | :360/:1710 | R | | ✅ |
| create_daily | :1656 | W | +LINE notify (→waitUntil) | ✅ |
| auto_detect_daily / delete_daily | :1728/:1868 | W | | ✅ |
| generate_daily_summary / ai_summary / generate_daily_summary_v2 | :1795/:1897/:3234 | RW | Gemini | ✅ |
| add_quick_log | :1882 | W | QUICK | ✅ |
| add_activity_log / get_activity_feed / delete_activity_log | :2807/:2878/:3089 | RW | | ✅ |
| untick_task_from_log / confirm_task_tick / suggest_task_from_log | :3111/:3740/:3588 | RW | | ✅ |
| parse_activity_text | :2717 | R | Gemini JSON | ✅ |
| get_today_stats | :3148 | R | ⚠️เดิมอ่าน Activity 2 รอบ — SQL รอบเดียว | ✅ |
| get_daily_bundle | :3428 | R | ⚠️เดิมอ่าน Activity 3 รอบ | ✅ |
| save_ai_summary / get_saved_summary | :3463/:3540 | RW | | ✅ |
| get_material_transactions | :2969 | R | | ✅ |

## CHECKIN (checkin.gs)
create_checkin :137 (GPS haversine + site_config) · get_checkins :319 · get_timesheet :341 · get_attendance_all :385 (+StaffIDCard+Projects) · update_checkin :214 · set_id_card :228 · get/set_site_location :82/:105 · delete_checkin :269 — ✅ ทั้งหมด · _diag_activity_photos :250 ❌

## TEAMS / CONTRACTS / FINANCE / STAFF
| action | ref | ย้าย? |
|---|---|---|
| get_teams_bundle :3944 · get_teams :4049 · team_checkin :4092 · create_team :4174 · update_team :4196 | Code.js | ✅ |
| delete_team · get_project_teams · assign/unassign_project_team | project_teams.gs:93/41/66/84 | ✅ |
| create_contract :4210 (+LINE) · update_contract :4245 · create_milestone :4261 · update_milestone :4288 (+recalc paid_total +LINE) | Code.js | ✅ |
| create_staff :4333 · update_staff :4352 · get_all_staff :4389 · get_project_staff :4404 · assign/unassign_project_staff :4437/:4466 | Code.js | ✅ |
| upload_contract_file :4485 · get_contract_files :4542 · delete_contract_file :4561 · upload_log_photo ‼raw :4591 · upload_payment_slip ‼raw :4639 · delete_payment_slip :4685 | Code.js → R2 | ✅ |
| get_client_finance | client_finance.gs:50 | ✅ |
| get_contractors :904 · create_contractor :914 · detect_unknowns :3885 | Code.js | ✅ |
| _phase_f_migrate · _seed_craft_teams | | ❌ |

## RISKS (risks.gs)
create_risk :294 (+LINE) · update_risk :336 · delete_risk :394 · clone_risks :217 — ✅ · _phase_r1_migrate :29 / _seed_direk_template :157 ❌

## EVALUATIONS (evaluations.gs)
get_eval_config :256 (ค่าคงที่ EVAL_KPIS_/BANDS_ — ลอกลง TS) · get_evals :275 · get_eval_summary :309 · create_eval :356 · update_eval :413 · delete_eval :462 — ✅ · _ensure_eval_sheets / _seed_eval_rubric ❌

## PHOTOS / AI VISION
get_photos :369 · add_photo :1915 · upload_photo :2084 (→R2) · get_material_photos :2140 · get_task_photos :2172 · get_transaction_photos :2203 · delete_photo :2231 · delete_task_photo :2257 · scan_bill :2312 (Gemini Vision) · confirm_bill_items :2447 (⚠️เดิม N+1 ต่อ item — ใช้ D1 batch) — ✅ ทั้งหมด

## CLIENT VIEW (read-only, field whitelist เดิมเป๊ะ)
client_get_overview :4727 · client_get_photos :4861 · client_get_milestones :4922 · client_get_payments :4978 — ✅

## NOTIFICATIONS / LINE (notifications.gs, line.gs)
get_notifications :19 ✅ · lineWebhook_ line.gs:88 → route `/line/webhook` ✅ · _run_line_digest :188 / _run_weekly_digest :323 / _run_ops_digest :402 → cron handlers ✅ (เวลา cron ดูจาก trigger เดิม) · _set_line_config/_line_status/line_test/_line_diag/_gemini_test/_install_line_digest ❌

## ADMIN ทิ้งทั้งหมด
_phase_a_fix (projects_patch.gs:163) · _phase_b1_migrate (projects_migration.gs:101)

## Drive URL เดิม
รูปเก่าเก็บเป็น drive.google.com/file/d/<id>/view หรือ lh3.googleusercontent.com — **เก็บ url เดิมใน D1 ใช้ต่อ** ไฟล์ใหม่เท่านั้นเข้า R2

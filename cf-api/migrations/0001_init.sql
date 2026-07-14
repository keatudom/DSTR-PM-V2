-- ============================================================
-- 0001_init.sql — โครงฐานข้อมูล D1 (แปลงจากแท็บ Google Sheets)
-- อ้างอิง: docs/migration-cloudflare/BLUEPRINT.md §3
-- กติกา: ชื่อตาราง snake_case ไม่มีเลขนำหน้า · คอลัมน์ = header เดิม (snake_case)
--        วันที่ TEXT (YYYY-MM-DD) · เวลาจริง epoch ms INTEGER (บทเรียน checkin ts)
-- ============================================================

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

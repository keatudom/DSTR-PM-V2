-- ============================================================
-- 0009_multi_project.sql — ทำให้ระบบรองรับ "หลายโครงการ" ได้จริง
--
-- ปัญหาเดิม: ค่าตั้งต้นรายโครงการ (แผน Gantt รายชิ้น · ชื่อ/สัดส่วนงวดจ่าย ·
--   รายการงานเพิ่ม) ถูกฝังตายไว้ใน js/config.js → เปิดโครงการใหม่ต้องให้
--   โปรแกรมเมอร์แก้ไฟล์โค้ดทุกครั้ง = ไม่ใช่แพลตฟอร์ม
--
-- แก้: ย้ายลง D1 รายโครงการ
--   1) projects.settings  — JSON: งวดจ่าย (label/sub/pct) + addon_ffs
--   2) ff_plans           — แผน Gantt ราย (โครงการ, ชิ้นงาน, งวด)
--
-- ⚠️ additive-only: ไม่ DROP / ไม่ RENAME / ไม่ลบข้อมูลใด
-- ⚠️ seed ค่าปัจจุบันของ bow-house ลงไปครบ → พฤติกรรมของบ้านคุณโบว์ต้องเท่าเดิมเป๊ะ
-- ============================================================

-- ── 1) ค่าตั้งต้นรายโครงการ ──────────────────────────────────
ALTER TABLE projects ADD COLUMN settings TEXT;

-- ── 2) แผนไทม์ไลน์ (Gantt) ราย โครงการ × ชิ้นงาน × งวด ───────
-- เดิม CONFIG.GANTT_PLAN ผูกกับ "รหัส F-xx" เฉยๆ → บ้านคนละหลังที่ใช้รหัส F-01
-- เหมือนกันจะยืมแผนกันมั่ว. ตารางนี้ผูก project_id เข้าไปด้วยเลย
CREATE TABLE ff_plans (
  project_id TEXT NOT NULL,
  ff_code    TEXT NOT NULL,
  phase      INTEGER NOT NULL,   -- 1..4 (งวด)
  start_week INTEGER NOT NULL,   -- สัปดาห์ที่เริ่ม (นับจากวันเริ่มโครงการ, 1 = สัปดาห์แรก)
  end_week   INTEGER NOT NULL,   -- สัปดาห์ที่จบ
  PRIMARY KEY (project_id, ff_code, phase)
);

CREATE INDEX idx_ff_plans_project ON ff_plans (project_id);

-- ── 3) seed: แผนของบ้านคุณโบว์ (ยกมาจาก CONFIG.GANTT_PLAN ตรงตัว) ──
-- 18 ชิ้นงาน × 4 งวด = 72 แถว
INSERT INTO ff_plans (project_id, ff_code, phase, start_week, end_week) VALUES
  ('bow-house','F-01',1,1,2),   ('bow-house','F-01',2,3,5),   ('bow-house','F-01',3,9,11),  ('bow-house','F-01',4,18,19),
  ('bow-house','F-15',1,1,2),   ('bow-house','F-15',2,3,5),   ('bow-house','F-15',3,9,11),  ('bow-house','F-15',4,18,19),
  ('bow-house','F-16',1,1,2),   ('bow-house','F-16',2,3,5),   ('bow-house','F-16',3,9,11),  ('bow-house','F-16',4,18,19),
  ('bow-house','F-02',1,1,2),   ('bow-house','F-02',2,5,8),   ('bow-house','F-02',3,11,13), ('bow-house','F-02',4,18,19),
  ('bow-house','F-02B',1,1,2),  ('bow-house','F-02B',2,5,8),  ('bow-house','F-02B',3,11,13),('bow-house','F-02B',4,18,19),
  ('bow-house','F-04',1,1,2),   ('bow-house','F-04',2,5,8),   ('bow-house','F-04',3,11,13), ('bow-house','F-04',4,18,19),
  ('bow-house','F-05',1,1,2),   ('bow-house','F-05',2,5,8),   ('bow-house','F-05',3,11,13), ('bow-house','F-05',4,18,19),
  ('bow-house','F-17',1,1,2),   ('bow-house','F-17',2,5,8),   ('bow-house','F-17',3,11,13), ('bow-house','F-17',4,18,19),
  ('bow-house','F-03',1,1,2),   ('bow-house','F-03',2,7,10),  ('bow-house','F-03',3,13,15), ('bow-house','F-03',4,18,19),
  ('bow-house','F-09',1,1,2),   ('bow-house','F-09',2,7,10),  ('bow-house','F-09',3,13,15), ('bow-house','F-09',4,18,19),
  ('bow-house','F-10',1,1,2),   ('bow-house','F-10',2,7,10),  ('bow-house','F-10',3,13,15), ('bow-house','F-10',4,18,19),
  ('bow-house','F-11',1,1,2),   ('bow-house','F-11',2,9,12),  ('bow-house','F-11',3,14,16), ('bow-house','F-11',4,18,19),
  ('bow-house','F-14',1,1,2),   ('bow-house','F-14',2,9,12),  ('bow-house','F-14',3,14,16), ('bow-house','F-14',4,18,19),
  ('bow-house','F-18',1,1,2),   ('bow-house','F-18',2,9,12),  ('bow-house','F-18',3,14,16), ('bow-house','F-18',4,18,19),
  ('bow-house','F-19',1,1,2),   ('bow-house','F-19',2,9,12),  ('bow-house','F-19',3,14,16), ('bow-house','F-19',4,18,19),
  ('bow-house','F-20',1,1,2),   ('bow-house','F-20',2,9,12),  ('bow-house','F-20',3,14,16), ('bow-house','F-20',4,18,19),
  ('bow-house','F-21',1,10,11), ('bow-house','F-21',2,11,13), ('bow-house','F-21',3,13,15), ('bow-house','F-21',4,16,16),
  ('bow-house','F-22',1,10,11), ('bow-house','F-22',2,11,13), ('bow-house','F-22',3,13,15), ('bow-house','F-22',4,16,16);

-- ── 4) seed: settings ของบ้านคุณโบว์ ──────────────────────────
-- phases[].key ต้องตรงกับคอลัมน์ milestone ใน payments เป๊ะ ('งวด 1'..'งวด 4') — ห้ามแก้
-- label/sub/pct = สิ่งที่ผู้ใช้แก้เองได้ในหน้าตั้งค่า
UPDATE projects SET settings = '{"phases":[{"key":"งวด 1","label":"งวด 1","sub":"มัดจำสั่งผลิต","pct":50},{"key":"งวด 2","label":"งวด 2","sub":"วัสดุเข้า+โครง","pct":22.5},{"key":"งวด 3","label":"งวด 3","sub":"ติดตั้งเฟอร์นิเจอร์","pct":22.5},{"key":"งวด 4","label":"งวด 4","sub":"ส่งมอบงาน","pct":5}],"addon_ffs":["F-21","F-22"]}'
WHERE project_id = 'bow-house';

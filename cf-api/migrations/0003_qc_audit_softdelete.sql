-- ============================================================
-- 0003 — QC: บันทึก "ใครทำอะไร" (audit trail) + ถังขยะ 30 วัน (soft delete)
--
-- ที่มา: docs/superpowers/specs/2026-08-06-qc-sharing-audit-trash-pdf-design.md
--   เจ้าของงานต้องการรู้ว่า ใครเปิดการตรวจ · ใครติ๊กข้อไหน · ใครปิด · ใครลบ
--   และการลบต้องกู้คืนได้ภายใน 30 วัน (ตาข่ายกันกดพลาด)
--
-- วินัย: additive-only — ADD COLUMN อย่างเดียว ไม่ DROP/RENAME/แก้ของเดิม
--        (deploy pattern ของโปรเจกต์: โค้ดเก่าที่ยังไม่ deploy ต้องอ่านตารางนี้ได้ต่อ)
--        ค่าเริ่มต้น '' ทุกตัว → แถวเก่าอ่านได้ปกติ แสดงผลเป็น "—" บนหน้าเว็บ
-- ============================================================

-- ── qc_inspections: ใครเปิด / ใครปิด / ใครทิ้งลงถังขยะ ──
ALTER TABLE qc_inspections ADD COLUMN created_by TEXT DEFAULT '';   -- ชื่อผู้เปิดการตรวจ (จาก token)
ALTER TABLE qc_inspections ADD COLUMN closed_by  TEXT DEFAULT '';   -- ชื่อผู้กด "สรุป & ปิดการตรวจ"
ALTER TABLE qc_inspections ADD COLUMN closed_at  TEXT DEFAULT '';   -- 'YYYY-MM-DD HH:mm:ss' โซนไทย
ALTER TABLE qc_inspections ADD COLUMN deleted_by TEXT DEFAULT '';   -- ชื่อผู้ทิ้งลงถังขยะ
ALTER TABLE qc_inspections ADD COLUMN deleted_at TEXT DEFAULT '';   -- '' = ยังไม่ถูกลบ (ตัวชี้ขาดของถังขยะ)

-- ── qc_results: ใครติ๊กผลข้อนี้ เมื่อไหร่ (รายข้อ — ตรวจร่วมกันหลายคนได้) ──
ALTER TABLE qc_results ADD COLUMN checked_by TEXT DEFAULT '';
ALTER TABLE qc_results ADD COLUMN checked_at TEXT DEFAULT '';

-- รายการตรวจของโครงการ (กรอง deleted_at ทุกครั้ง) — ช่วย query หน้ารายการ + การกวาดถังขยะ
CREATE INDEX IF NOT EXISTS idx_qc_insp_proj_del ON qc_inspections(project_id, deleted_at);

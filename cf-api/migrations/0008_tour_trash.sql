-- ============================================================
-- 0008 — ถังขยะ 30 วันของ "เดินดูหน้างาน 360"
--   เจ้าของงานเคาะ 2026-08-19: "ถ้าเพิ่มจุดผิด มันควรลบได้ และไปอยู่ถังขยะ 30 วัน"
--
-- เดิม: ลบจุด = ปิด active + ลบลูกศรทิ้งถาวร → กู้คืนแล้วทางเดินหายไป ต้องมาโยงใหม่
-- ใหม่: ทั้งจุดและลูกศรประทับเวลาที่ทิ้ง → กู้คืนได้ครบทั้งชุดภายใน 30 วัน
--       ใช้กติกาเดียวกับถังขยะของโมดูล QC (ลบจริงแบบ lazy ตอนมีคนเปิดหน้า)
--
-- วินัย: additive-only — เพิ่มคอลัมน์เท่านั้น ข้อมูลเดิมไม่ถูกแตะ
-- ============================================================

ALTER TABLE tour_points ADD COLUMN trashed_at TEXT;
ALTER TABLE tour_links  ADD COLUMN trashed_at TEXT;

CREATE INDEX idx_tour_points_trash ON tour_points (project_id, trashed_at);
CREATE INDEX idx_tour_links_trash  ON tour_links (project_id, trashed_at);

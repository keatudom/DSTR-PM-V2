-- ============================================================
-- 0010_tour_owner.sql — จดว่า "ใครเป็นคนสร้าง" ของแต่ละชิ้นในทัวร์ 360
--
-- ที่มา (เจ้าของงานเคาะ 2026-09-03):
--   "ลบผัง/ล้างถังขยะ โฟร์แมน HR จัดซื้อ ผู้รับเหมา ก็ทำได้
--    แต่ต้องเป็นของตัวเองที่สแกนมา ไม่ใช่ไปลบของคนอื่น"
--
-- ปัญหาของเดิม: มีคอลัมน์ created_by/uploaded_by อยู่แล้ว แต่เก็บเป็น "ชื่อคน"
--   → ชื่อซ้ำกันได้ · เปลี่ยนชื่อแล้วความเป็นเจ้าของหลุด · เทียบไม่ได้อย่างมั่นใจ
--   จึงเพิ่มคอลัมน์ที่เก็บ "รหัสพนักงาน" (staff_id) ซึ่งไม่เปลี่ยน
--
-- ⚠️ additive-only · แถวเก่ามีค่าเป็น NULL = "ไม่รู้ว่าใครสร้าง"
--    กติกา: ของที่ไม่รู้เจ้าของ → เฉพาะหัวหน้า (สิทธิ์ตั้งค่าไซต์) เท่านั้นที่ลบได้
--    ปลอดภัยไว้ก่อน ไม่ปล่อยให้ใครก็ได้ไปลบของเก่าที่ไม่มีเจ้าของ
-- ============================================================

ALTER TABLE tour_plans    ADD COLUMN owner_sid TEXT;
ALTER TABLE tour_points   ADD COLUMN owner_sid TEXT;
ALTER TABLE tour_links    ADD COLUMN owner_sid TEXT;
ALTER TABLE tour_versions ADD COLUMN owner_sid TEXT;
ALTER TABLE tour_shots    ADD COLUMN owner_sid TEXT;
ALTER TABLE tour_pins     ADD COLUMN owner_sid TEXT;

CREATE INDEX idx_tour_versions_owner ON tour_versions (owner_sid);
CREATE INDEX idx_tour_points_owner   ON tour_points (owner_sid);

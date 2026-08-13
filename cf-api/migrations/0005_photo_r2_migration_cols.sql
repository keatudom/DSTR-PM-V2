-- ============================================================
-- 0005 — คอลัมน์รองรับการย้ายรูปเก่าจาก Google Drive → R2
--
-- ทำไม: รูปที่อัปก่อนย้ายมา Cloudflare ยังชี้ไป lh3.googleusercontent.com
--       (324 รูป ณ 2026-08-13) → หน้าเว็บดาวน์โหลดตรงไม่ได้ (คนละ origin ไม่มี CORS)
--       + ผูกชะตากับ Google Drive ของบัญชีเดิม ถ้าไฟล์ถูกลบ/เปลี่ยนสิทธิ์ = รูปหาย
--
-- วินัย: additive-only — ADD COLUMN อย่างเดียว ค่าเริ่มต้น '' แถวเก่าอ่านได้ปกติ
--        *_legacy_url = เก็บลิงก์ Drive เดิมไว้ (ร่มชูชีพ — ย้อนกลับได้ถ้าย้ายพลาด)
--        *_r2_key     = key ใน R2 หลังย้ายสำเร็จ (ไว้ลบไฟล์ทิ้งตามรูปเมื่อลบ record)
-- ============================================================

ALTER TABLE activity_logs ADD COLUMN photo_r2_key     TEXT DEFAULT '';
ALTER TABLE activity_logs ADD COLUMN photo_legacy_url TEXT DEFAULT '';

ALTER TABLE checkins      ADD COLUMN photo_r2_key     TEXT DEFAULT '';
ALTER TABLE checkins      ADD COLUMN photo_legacy_url TEXT DEFAULT '';

-- task_photos / material_photos มี r2_key อยู่แล้ว — เติมเฉพาะที่เก็บลิงก์เดิม
ALTER TABLE task_photos     ADD COLUMN legacy_url TEXT DEFAULT '';
ALTER TABLE material_photos ADD COLUMN legacy_url TEXT DEFAULT '';

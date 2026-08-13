-- ============================================================
-- 0006 — ท่อคอนเทนต์ (สถานี 2-4: คัด / เขียน / เคาะ)
--   อ้างอิงกลยุทธ์ DSTR-MKT-2569-002 · เจ้าของงานเคาะ 2026-08-13
--
-- โจทย์: โฟร์แมนผลิตวัตถุดิบอยู่แล้วทุกวัน (วัดจริง 30 วัน: บันทึก 10.5/วัน · รูป 2.8/วัน)
--        แต่ของไปไม่ถึงเพจ → ตารางพวกนี้คือ "สายพาน" ที่พาของจาก Daily Log ไปถึงโพสต์
--
-- วินัย: additive-only — สร้างตารางใหม่ + ADD COLUMN เท่านั้น ไม่แตะของเดิม
-- ============================================================

-- ── ชิ้นงานคอนเทนต์ 1 แถว = 1 โพสต์ที่กำลังเดินอยู่บนสายพาน ──
CREATE TABLE content_items (
  content_id   TEXT PRIMARY KEY,
  project_id   TEXT,
  status       TEXT,     -- draft(รอเคาะ) | approved(ผ่านแล้ว) | scheduled(ตั้งเวลา) | posted(ลงแล้ว) | rejected(ตก)
  style        TEXT,     -- behind | educate | showcase | pro | developer  (5 สไตล์ตามกลยุทธ์ §5)
  platform     TEXT,     -- fb | ig | tiktok | line  ('' = ยังไม่เลือก)

  -- วัตถุดิบต้นทาง (ตามรอยกลับไปหาที่มาได้เสมอ)
  source_kind  TEXT,     -- daily | task | checkin | qc | upload
  source_id    TEXT,     -- log_id / photo_id / checkin_id ...
  ff_code      TEXT,
  raw_text     TEXT,     -- ข้อความที่โฟร์แมนพิมพ์ไว้จริง (ห้ามแก้ — ใช้เทียบตอนสงสัย)
  photo_url    TEXT,
  -- ⭐ แยก "รูปรายงาน" ออกจาก "รูปที่ตั้งใจถ่าย" (เจ้าของงานเคาะ 2026-08-13)
  --   รูปไม่ต้องสวยเสมอ — รูปรายงานโฟร์แมนใช้เป็นวัตถุดิบได้เลย
  --   ระบบจึงไม่ตัดรูปไม่สวยทิ้ง แค่ติดป้ายให้คนเลือกเองว่าจะหยิบอันไหน
  shot_intent  TEXT DEFAULT 'report',   -- report(รูปรายงาน) | styled(ตั้งใจถ่าย)

  -- ผลงาน AI + การเคาะของคน
  caption      TEXT,
  hashtags     TEXT,
  reroll_count INTEGER DEFAULT 0,
  notes        TEXT,     -- หมายเหตุตอนกดรี/ตก

  scheduled_at TEXT,
  posted_at    TEXT,
  posted_by    TEXT,
  created_at   TEXT,
  created_by   TEXT,
  updated_at   TEXT
);
CREATE INDEX idx_content_proj_status ON content_items(project_id, status);
-- กันหยิบวัตถุดิบชิ้นเดิมมาทำซ้ำ (คิวจะเต็มไปด้วยของซ้ำ)
CREATE UNIQUE INDEX idx_content_source ON content_items(source_kind, source_id);

-- ── คู่มือเสียงแบรนด์: ทุกครั้งที่คนกด "รี" เก็บคำสั่งไว้ แล้วส่งให้ AI อ่านทุกครั้ง ──
-- เป้าหมายตามกลยุทธ์ §3: เดือนที่ 1 กดรี 8/10 → เดือนที่ 3 แทบไม่ต้องรี
-- (ไม่ใช่จ้างฟรีแลนซ์ใหม่ทุกวัน แต่คือฝึกลูกน้องคนเดิม)
CREATE TABLE brand_voice (
  rule_id    TEXT PRIMARY KEY,
  project_id TEXT,          -- '' = ใช้ทุกโครงการ
  style      TEXT,          -- '' = ใช้ทุกสไตล์
  rule       TEXT,          -- เช่น 'สั้นลง', 'อย่าใช้อีโมจิ', 'เน้นวัสดุ'
  hits       INTEGER DEFAULT 1,   -- ถูกสั่งซ้ำกี่ครั้ง — ยิ่งเยอะยิ่งสำคัญ
  active     TEXT DEFAULT 'TRUE',
  created_at TEXT,
  created_by TEXT
);

-- ── สิทธิ์ใช้ภาพลูกค้า (กลยุทธ์ §10 — ต้องทำก่อนสุด) ──
-- ระบบล็อกไม่ให้ดึงวัตถุดิบจากโครงการที่ยังไม่ได้ติ๊กยินยอม
-- ถ้าไม่ทำตอนนี้ อีก 6 เดือนจะมีรูปหลายพันรูปที่ไม่รู้ว่าโพสต์ได้ไหม
ALTER TABLE projects ADD COLUMN photo_consent    TEXT DEFAULT '';   -- 'TRUE' = ยินยอมแล้ว
ALTER TABLE projects ADD COLUMN photo_consent_at TEXT DEFAULT '';
ALTER TABLE projects ADD COLUMN photo_consent_by TEXT DEFAULT '';

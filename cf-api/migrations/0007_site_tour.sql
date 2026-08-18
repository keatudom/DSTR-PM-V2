-- ============================================================
-- 0007 — เดินดูหน้างาน 360 (Site Tour)
--   สเปก: docs/site-tour-360/TOUR-SPEC.md · เจ้าของงานเคาะ 2026-08-18
--
-- โจทย์: พนักงานถ่ายพาโนจากมือถือทุกจุดในไซต์ → เดินไปมาด้วยลูกศรแบบ Street View
--        → ย้อนดูได้ทุก "เวอร์ชัน" (ก่อนโพรเทค / หลังโพรเทค / ติดตั้ง 30%)
--
-- กฎที่ฝังอยู่ในโครงตาราง:
--   จุด + ลูกศร + แผนผัง = สมบัติของ "โครงการ" (วางครั้งเดียว ใช้ตลอด)
--   ภาพ (tour_shots)     = สมบัติของ "เวอร์ชัน" (เกิดใหม่ทุกรอบ ไม่เขียนทับของเก่า)
--
-- วินัย: additive-only — สร้างตารางใหม่อย่างเดียว ไม่แตะของเดิม
-- ============================================================

-- ── แผนผังพื้น (1 แถว = 1 ชั้น) ──
CREATE TABLE tour_plans (
  plan_id     TEXT PRIMARY KEY,
  project_id  TEXT,
  floor_label TEXT,              -- 'ชั้น 1'
  media_key   TEXT,              -- คีย์ไฟล์ใน R2
  url         TEXT,              -- '/media/<key>'
  width       INTEGER,
  height      INTEGER,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT,
  created_by  TEXT
);

-- ── จุดถ่าย (ตำแหน่งคงที่ในไซต์) ──
CREATE TABLE tour_points (
  point_id    TEXT PRIMARY KEY,
  project_id  TEXT,
  plan_id     TEXT,              -- อยู่ชั้นไหน ('' ได้ ถ้ายังไม่มีแปลน)
  name        TEXT,              -- 'ห้องนอนใหญ่ – มุมประตู'
  plan_x      REAL,              -- 0..1 สัดส่วนบนแผนผัง (ไม่ใช่พิกเซล — ย่อขยายแล้วไม่เพี้ยน)
  plan_y      REAL,
  sort_order  INTEGER DEFAULT 0, -- ลำดับที่ควรเดินถ่าย
  active      INTEGER DEFAULT 1,
  created_at  TEXT,
  created_by  TEXT
);

-- ── ลูกศรเดิน (ทางเดียว — อยากเดินกลับต้องมี 2 แถว) ──
CREATE TABLE tour_links (
  link_id     TEXT PRIMARY KEY,
  project_id  TEXT,
  from_point  TEXT,
  to_point    TEXT,
  yaw         REAL,              -- องศา 0-360 ตำแหน่งลูกศรในภาพ
  pitch       REAL DEFAULT -10,  -- ก้ม/เงย (ลูกศรพื้นควรติดลบเล็กน้อย)
  label       TEXT,              -- ทับชื่อปลายทาง เช่น 'ออกไประเบียง'
  created_at  TEXT
);

-- ── เวอร์ชัน (การกลับไปถ่ายทุกจุดอีกครั้ง 1 รอบ) ──
CREATE TABLE tour_versions (
  version_id   TEXT PRIMARY KEY,
  project_id   TEXT,
  name         TEXT,                    -- 'หลังโพรเทค'
  note         TEXT,
  status       TEXT DEFAULT 'draft',    -- draft(กำลังถ่าย) | published(เผยแพร่แล้ว) | trashed
  captured_at  TEXT,                    -- 'YYYY-MM-DD' วันที่ถ่าย (ใช้เรียง + หาภาพสำรองย้อนหลัง)
  published_at TEXT,
  visibility   TEXT DEFAULT 'internal', -- internal | client | public  ← เฟส 1 ใช้ internal อย่างเดียว
  created_at   TEXT,
  created_by   TEXT,
  trashed_at   TEXT                     -- ถังขยะ 30 วัน
);

-- ── ภาพ (1 จุด × 1 เวอร์ชัน = 1 แถว) ──
CREATE TABLE tour_shots (
  shot_id     TEXT PRIMARY KEY,
  project_id  TEXT,
  version_id  TEXT,
  point_id    TEXT,
  media_key   TEXT,
  url         TEXT,              -- '/media/<key>'
  kind        TEXT,              -- sphere(360 เต็มใบ) | pano(พาโนมือถือ) | flat(รูปธรรมดา)
  width       INTEGER,
  height      INTEGER,
  haov        REAL,              -- มุมมองแนวนอน (องศา)
  vaov        REAL,              -- มุมมองแนวตั้ง (องศา)
  yaw_offset  REAL DEFAULT 0,    -- ค่าปรับหมุนให้ทับเวอร์ชันอื่นพอดี
  taken_at    TEXT,              -- เวลาถ่ายจริงจากไฟล์ (ถ้ามี)
  uploaded_at TEXT,
  uploaded_by TEXT,
  trashed_at  TEXT               -- ถ่ายทับ → ของเก่าลงถังขยะ 30 วัน
);

-- ── หมุดคอมเมนต์บนภาพ ──
CREATE TABLE tour_pins (
  pin_id      TEXT PRIMARY KEY,
  project_id  TEXT,
  point_id    TEXT,
  version_id  TEXT,              -- '' = ติดทุกเวอร์ชัน / ระบุ = เฉพาะเวอร์ชันนั้น
  yaw         REAL,
  pitch       REAL,
  kind        TEXT,              -- note | ff | qc
  ref_id      TEXT,              -- รหัส F-XX หรือ id ผลตรวจ QC
  text        TEXT,
  resolved    INTEGER DEFAULT 0,
  created_at  TEXT,
  created_by  TEXT
);

CREATE INDEX idx_tour_plans_project  ON tour_plans (project_id);
CREATE INDEX idx_tour_points_project ON tour_points (project_id);
CREATE INDEX idx_tour_links_project  ON tour_links (project_id, from_point);
CREATE INDEX idx_tour_versions_proj  ON tour_versions (project_id, status);
CREATE INDEX idx_tour_shots_version  ON tour_shots (version_id, point_id);
CREATE INDEX idx_tour_shots_point    ON tour_shots (project_id, point_id);
CREATE INDEX idx_tour_pins_point     ON tour_pins (project_id, point_id);

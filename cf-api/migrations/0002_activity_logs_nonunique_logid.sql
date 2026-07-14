-- ============================================================
-- 0002 — activity_logs: log_id ในข้อมูลจริง "ไม่ unique"
-- สาเหตุ: ระบบเก่าไม่มี LockService → nextLogId_ แข่งกัน → LOG id ซ้ำ 4 แถว
--         (LOG0141, LOG0372, LOG0406, +1) จาก 607 แถว
-- แก้: ใช้ row_id (rowid) เป็น PK แทน · log_id เป็น index ธรรมดา (ไม่ unique)
--      → seed เก็บครบทุกแถว ไม่ทิ้งข้อมูล (วินัย feedback_dont-break-existing-data)
-- ผลต่อ Session 2: query by log_id ยังทำได้ (อาจ match >1 แถวในเคสซ้ำ = พฤติกรรมเดียวกับของเดิม)
-- ============================================================
CREATE TABLE activity_logs_new (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id TEXT, project_id TEXT, date TEXT, timestamp TEXT, type TEXT, source TEXT, text TEXT,
  tags_ff TEXT, tags_ctr TEXT, tags_issue TEXT, tags_phase TEXT, photo_url TEXT, meta_json TEXT
);
INSERT INTO activity_logs_new
  (log_id, project_id, date, timestamp, type, source, text, tags_ff, tags_ctr, tags_issue, tags_phase, photo_url, meta_json)
  SELECT log_id, project_id, date, timestamp, type, source, text, tags_ff, tags_ctr, tags_issue, tags_phase, photo_url, meta_json
  FROM activity_logs;
DROP TABLE activity_logs;
ALTER TABLE activity_logs_new RENAME TO activity_logs;
CREATE INDEX idx_activity_proj_date ON activity_logs(project_id, date);
CREATE INDEX idx_activity_log_id ON activity_logs(log_id);

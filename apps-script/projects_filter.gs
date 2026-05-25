// ============================================================
// projects_filter.gs — Phase B-2 (read filter) + B-4 (write stamp)
// ============================================================
// READ: _filterByProject_(rows, projectId) — เรียกใน getFFList ฯลฯ
// WRITE: _CURRENT_PROJECT_ID_ — ตั้งใน handle() แล้ว appendRow() auto-stamp
// ============================================================

// Phase B-4: เก็บ project_id ของ request ปัจจุบัน (ตั้งใน handle, ใช้ใน appendRow)
// Apps Script เรียก script context ใหม่ทุก request → ปลอดภัยจาก race condition
let _CURRENT_PROJECT_ID_ = null;

function _setCurrentProjectId_(pid) {
  _CURRENT_PROJECT_ID_ = (pid && String(pid).trim()) ? String(pid).trim() : null;
}

function _getCurrentProjectId_() {
  return _CURRENT_PROJECT_ID_;
}

/**
 * กรอง rows ตาม project_id
 * - projectId ว่าง/null → ไม่กรอง (legacy compat)
 * - projectId='bow-house' → รวม row ที่ project_id ว่าง ด้วย (legacy/yet-to-be-stamped)
 * - projectId อื่นๆ → exact match
 *
 * @param {Array<object>} rows - rows จาก getAllRows()
 * @param {string} projectId
 * @returns {Array<object>}
 */
function _filterByProject_(rows, projectId) {
  if (!projectId) return rows;
  return rows.filter(r => {
    const rpid = String(r.project_id || '').trim();
    if (projectId === 'bow-house' && rpid === '') return true;  // legacy empty = bow-house
    return rpid === projectId;
  });
}

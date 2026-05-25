// ============================================================
// projects_filter.gs — Phase B-2: Project-scoped read helper
// ============================================================
// ใช้กรอง rows ตาม project_id — ถูกเรียกใน getFFList, getTasksAsObjects,
// getMaterials, getTransactions, getBOQ ฯลฯ
// ============================================================

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

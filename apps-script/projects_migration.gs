// ============================================================
// projects_migration.gs — Phase B-1: Schema migration
// ============================================================
// เพิ่มคอลัมน์ project_id ลงในตารางที่เป็น per-project + backfill 'bow-house'
// เรียกผ่าน endpoint '_phase_b1_migrate' (idempotent — รันซ้ำได้)
// ============================================================

// ตารางที่ต้อง project_id (per-project data)
const PHASE_B1_TABLES_ = [
  '02_FF_Items',
  '03_Tasks_Checklist',
  '04_Payments',
  '05_Risks',
  '06_Timeline',
  '07_Daily_Reports',
  '08_Quick_Logs',
  '11_Materials',
  '12_Material_Transactions',
  '14_BOQ_Items',
  '15_Variance_Reasons',
  '17_Activity_Logs',
  '22_Contracts',
  '23_Milestones'
];

const PHASE_B1_DEFAULT_PROJECT_ = 'bow-house';

/**
 * เพิ่มคอลัมน์ project_id ในตาราง 1 ตัว + backfill ค่า default ทุก row เดิม
 * Idempotent: ถ้ามีคอลัมน์ project_id อยู่แล้ว → backfill เฉพาะที่ว่าง
 *
 * @param {Sheet} sh - sheet object
 * @param {string} defaultProjectId - ค่าที่ backfill ลง row เดิม
 * @returns {object} { sheet, added_column, backfilled_rows, total_rows }
 */
function migrateSheetAddProjectId_(sh, defaultProjectId) {
  const sheetName = sh.getName();
  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();

  if (lastCol === 0) {
    return { sheet: sheetName, error: 'sheet ว่าง (ไม่มี header)' };
  }

  // อ่าน header
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  let pidCol = headers.indexOf('project_id') + 1; // 1-based
  let added = false;

  if (pidCol === 0) {
    // ยังไม่มีคอลัมน์ project_id → เพิ่ม
    pidCol = lastCol + 1;
    sh.getRange(1, pidCol).setValue('project_id');
    // header style (เหมือนสไตล์ header เดิม)
    sh.getRange(1, pidCol).setFontWeight('bold');
    added = true;
  }

  // Backfill เฉพาะ row ที่ project_id ว่าง
  let backfilled = 0;
  const sampleValues = [];
  if (lastRow >= 2) {
    const numRows = lastRow - 1;
    const range = sh.getRange(2, pidCol, numRows, 1);
    const values = range.getValues();
    const newValues = values.map(r => {
      const cur = String(r[0] || '').trim();
      if (cur === '') {
        backfilled++;
        return [defaultProjectId];
      }
      return [cur];
    });
    if (backfilled > 0) {
      range.setValues(newValues);
    }
    // เก็บ sample (max 3 distinct values) — ช่วย debug ตารางที่มี project_id ผิดค่า
    const seen = {};
    values.forEach(v => {
      const cur = String(v[0] || '').trim();
      if (!seen[cur] && sampleValues.length < 3) {
        seen[cur] = true;
        sampleValues.push(cur || '(empty)');
      }
    });
  }

  return {
    sheet: sheetName,
    added_column: added,
    backfilled_rows: backfilled,
    total_rows: Math.max(0, lastRow - 1),
    sample_values: sampleValues
  };
}

/**
 * รัน migration กับทุกตารางใน PHASE_B1_TABLES_
 * Idempotent — รันซ้ำได้
 */
function phaseB1Migrate_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const results = [];

  // หา sheet names ทั้งหมดที่มีจริง — เผื่อ 17_Activity_Logs ถูก rename
  const allSheets = ss.getSheets().map(s => s.getName());

  PHASE_B1_TABLES_.forEach(tableName => {
    let sh = ss.getSheetByName(tableName);
    let resolvedName = tableName;
    if (!sh) {
      // Fuzzy: หา sheet ที่ trim แล้วเท่ากับ tableName (กรณีมี trailing space)
      const candidate = allSheets.find(n => n.trim() === tableName.trim());
      if (candidate) {
        sh = ss.getSheetByName(candidate);
        resolvedName = candidate;
      }
    }
    if (!sh) {
      const prefix = tableName.split('_')[0] + '_';
      const candidate = allSheets.find(n => n.indexOf(prefix) === 0);
      results.push({
        sheet: tableName,
        error: 'sheet not found',
        possible_match: candidate || null
      });
      return;
    }
    try {
      const r = migrateSheetAddProjectId_(sh, PHASE_B1_DEFAULT_PROJECT_);
      if (resolvedName !== tableName) r.resolved_from = tableName;
      results.push(r);
    } catch (err) {
      results.push({ sheet: tableName, error: err.message });
    }
  });

  return {
    default_project_id: PHASE_B1_DEFAULT_PROJECT_,
    tables_total: PHASE_B1_TABLES_.length,
    all_sheets_in_spreadsheet: allSheets,
    results: results
  };
}

// ============================================================
// projects_patch.gs — Phase A: Project Registry (multi-project)
// ============================================================
// ไฟล์นี้ถูก push เป็น script file แยกใน Apps Script (ไม่ต้องรวมเข้า Code.js)
// router cases เพิ่มใน Code.js: get_projects, create_project
//
// 📐 Schema 00_Projects:
//   project_id | name | client | quote_no | start_date | end_date
//   total_days | total_value | contractor | status | sheets_id | created_at
//
// 🌱 Seed bow-house — รันจาก Apps Script editor ครั้งเดียว: seedBowHouse_()
// ============================================================

const PROJECTS_SHEET_NAME_ = '00_Projects';
const PROJECTS_HEADERS_ = [
  'project_id', 'name', 'client', 'quote_no',
  'start_date', 'end_date', 'total_days', 'total_value',
  'contractor', 'status', 'sheets_id', 'created_at'
];

/**
 * เปิด (หรือสร้าง) sheet 00_Projects + ใส่ header ครั้งแรก
 * ใช้ SHEETS_ID (top-level const ใน Code.js) — เหมือน getSheet()
 */
function getOrCreateProjectsSheet_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sh = ss.getSheetByName(PROJECTS_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(PROJECTS_SHEET_NAME_);
    sh.getRange(1, 1, 1, PROJECTS_HEADERS_.length).setValues([PROJECTS_HEADERS_]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, PROJECTS_HEADERS_.length)
      .setFontWeight('bold')
      .setBackground('#1F3864')
      .setFontColor('#ffffff');
  }
  return sh;
}

/**
 * อ่านโปรเจกต์ทั้งหมด — active ก่อน, ใหม่ก่อนเก่า
 * Return: array (raw) — handle() จะ wrap เป็น {ok:true, data:[...]} เอง
 */
function getProjects_() {
  const sh = getOrCreateProjectsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return [];

  const rows = sh.getRange(2, 1, lastRow - 1, PROJECTS_HEADERS_.length).getValues();

  const out = rows
    .filter(function(r) { return r[0]; }) // ต้องมี project_id
    .map(function(r) {
      const obj = {};
      PROJECTS_HEADERS_.forEach(function(h, i) {
        let v = r[i];
        if (v instanceof Date) {
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          v = y + '-' + m + '-' + d;
        }
        obj[h] = v;
      });
      return obj;
    });

  out.sort(function(a, b) {
    const sa = (a.status || '').toString();
    const sb = (b.status || '').toString();
    if (sa === 'active' && sb !== 'active') return -1;
    if (sb === 'active' && sa !== 'active') return 1;
    return (b.created_at || '').toString().localeCompare((a.created_at || '').toString());
  });

  return out;
}

/**
 * update_project — แก้ meta โครงการใน 00_Projects (total_value/end_date/status ฯลฯ)
 * แก้เฉพาะ field ที่ส่งมา — field อื่นคงเดิม · ห้ามแก้ project_id
 */
function updateProject_(p) {
  p = p || {};
  if (!p.project_id) throw new Error('project_id required');
  const sh = getOrCreateProjectsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('ไม่มีโครงการในระบบ');

  const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues();
  let rowIdx = -1;
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(p.project_id).trim()) { rowIdx = i + 2; break; }
  }
  if (rowIdx === -1) throw new Error('ไม่พบโครงการ: ' + p.project_id);

  const editable = ['name', 'client', 'quote_no', 'start_date', 'end_date',
                    'total_days', 'total_value', 'contractor', 'status'];
  let updated = 0;
  editable.forEach(function(f) {
    if (p[f] === undefined) return;
    const colIdx = PROJECTS_HEADERS_.indexOf(f);
    if (colIdx === -1) return;
    sh.getRange(rowIdx, colIdx + 1).setValue(p[f]);
    updated++;
  });
  return { ok: true, project_id: p.project_id, updated: updated };
}

/**
 * สร้างโปรเจกต์ใหม่ — append row + auto-gen project_id
 * Return: { project_id, project } (raw) — handle() wrap เป็น {ok:true, data:{...}} เอง
 * Throw ถ้า invalid — handle() จับเป็น {ok:false, error}
 */
function createProject_(p) {
  p = p || {};
  if (!p.name || !String(p.name).trim()) {
    throw new Error('ต้องระบุชื่อโครงการ');
  }

  const sh = getOrCreateProjectsSheet_();
  const projectId = 'prj_' + Date.now().toString(36);

  let totalDays = parseInt(p.total_days, 10) || 0;
  if (!totalDays && p.start_date && p.end_date) {
    const sd = new Date(p.start_date);
    const ed = new Date(p.end_date);
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
      totalDays = Math.max(0, Math.round((ed - sd) / 86400000));
    }
  }

  const row = [
    projectId,
    String(p.name).trim(),
    String(p.client || '').trim(),
    String(p.quote_no || '').trim(),
    String(p.start_date || '').trim(),
    String(p.end_date || '').trim(),
    totalDays,
    parseFloat(p.total_value) || 0,
    String(p.contractor || 'บริษัท ดีไซน์ ทีเรีย จำกัด').trim(),
    'active',
    String(p.sheets_id || SHEETS_ID).trim(),
    new Date().toISOString()
  ];

  sh.appendRow(row);

  const project = {};
  PROJECTS_HEADERS_.forEach(function(h, i) { project[h] = row[i]; });

  return { project_id: projectId, project: project };
}

/**
 * One-shot cleanup หลัง deploy:
 *  1. ลบ row test smoke ใน 00_Projects (name='Test Smoke' หรือ 'PhaseC-Test')
 *  2. ลบ row F-TEST-* ใน 02_FF_Items
 *  3. Seed bow-house ถ้ายังไม่มี
 * เรียกได้หลายครั้ง (idempotent) — ใช้ผ่าน endpoint '_phase_a_fix'
 */
function phaseAFix_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);

  // 1. Clean test rows ใน 00_Projects
  const shProj = getOrCreateProjectsSheet_();
  const lastRowProj = shProj.getLastRow();
  let removedProj = 0;
  const TEST_PROJECT_NAMES = ['Test Smoke', 'PhaseC-Test'];
  if (lastRowProj >= 2) {
    const data = shProj.getRange(2, 1, lastRowProj - 1, PROJECTS_HEADERS_.length).getValues();
    for (let i = data.length - 1; i >= 0; i--) {
      const name = String(data[i][1] || '').trim();
      if (TEST_PROJECT_NAMES.indexOf(name) !== -1) {
        shProj.deleteRow(i + 2);
        removedProj++;
      }
    }
  }

  // 2. Clean test rows ใน 02_FF_Items (FF Code ขึ้นต้น 'F-TEST-')
  const shFF = ss.getSheetByName(SHEET.FF);
  let removedFF = 0;
  if (shFF) {
    const lastRowFF = shFF.getLastRow();
    if (lastRowFF >= 2) {
      const lastCol = shFF.getLastColumn();
      const headers = shFF.getRange(1, 1, 1, lastCol).getValues()[0];
      const codeCol = headers.indexOf('FF Code');
      if (codeCol !== -1) {
        const data = shFF.getRange(2, 1, lastRowFF - 1, lastCol).getValues();
        for (let i = data.length - 1; i >= 0; i--) {
          const code = String(data[i][codeCol] || '').trim();
          if (code.indexOf('F-TEST-') === 0) {
            shFF.deleteRow(i + 2);
            removedFF++;
          }
        }
      }
    }
  }

  // 3. Seed bow-house
  seedBowHouse_();

  return {
    removed_test_projects: removedProj,
    removed_test_ffs: removedFF,
    seeded: 'bow-house'
  };
}

/**
 * (Optional) seed โปรเจกต์ bow-house ที่ hardcode ใน frontend
 * Idempotent — ถ้ามี bow-house แล้วจะข้าม
 */
function seedBowHouse_() {
  const sh = getOrCreateProjectsSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow >= 2) {
    const ids = sh.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    if (ids.indexOf('bow-house') !== -1) {
      Logger.log('bow-house มีอยู่แล้ว — ข้าม');
      return;
    }
  }
  sh.appendRow([
    'bow-house',
    'Kun Beau House',
    'คุณอสณบรีย อิสสระเสรี (คุณโบว์)',
    'QT-690400007',
    '2026-04-09',
    '2026-08-07',
    120,
    1695000,
    'บริษัท ดีไซน์ ทีเรีย จำกัด',
    'active',
    SHEETS_ID,
    new Date().toISOString()
  ]);
  Logger.log('seed bow-house เรียบร้อย');
}

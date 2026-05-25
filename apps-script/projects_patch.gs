// ============================================================
// projects_patch.gs — Phase A: Project Registry
// ============================================================
// 📌 วิธีใช้:
//   1) เปิด Apps Script project ของ DSTR-PM
//   2) คัดลอกฟังก์ชันทั้งหมดในไฟล์นี้ไปวางไว้ใน Code.gs
//      (วางต่อท้ายไฟล์เดิม — ฟังก์ชันชื่อไม่ชนกับของเดิม)
//   3) เพิ่ม 2 case ใน doGet (router) ตรง switch(action):
//        case 'get_projects':   return jsonpOut_(cb, getProjects_());
//        case 'create_project': return jsonpOut_(cb, createProject_(e.parameter));
//      (หรือใช้ pattern ที่ไฟล์ Code.gs ใช้อยู่ก็ได้ — ฟังก์ชันทั้งคู่คืน plain object พร้อม ok/data)
//   4) Deploy เวอร์ชันใหม่ (Deploy → Manage deployments → Edit → New version)
//   5) URL deploy ใหม่ → อัปเดตใน js/config.js → CONFIG.APPS_SCRIPT_URL
//   6) Sheet 00_Projects: ไม่ต้องสร้างเองมือ — createProject_ จะสร้างให้อัตโนมัติ
//      ครั้งแรกที่ถูกเรียก พร้อม header columns ตามที่กำหนด
//
// 📐 Schema 00_Projects:
//   project_id | name | client | quote_no | start_date | end_date
//   total_days | total_value | contractor | status | sheets_id | created_at
//
// 🌱 Seed bow-house (run once จาก Apps Script editor):
//   seedBowHouse_()
// ============================================================

const PROJECTS_SHEET_NAME_ = '00_Projects';
const PROJECTS_HEADERS_ = [
  'project_id', 'name', 'client', 'quote_no',
  'start_date', 'end_date', 'total_days', 'total_value',
  'contractor', 'status', 'sheets_id', 'created_at'
];

/**
 * เปิด (หรือสร้าง) sheet 00_Projects + ใส่ header ครั้งแรก
 */
function getOrCreateProjectsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(PROJECTS_SHEET_NAME_);
  if (!sh) {
    sh = ss.insertSheet(PROJECTS_SHEET_NAME_);
    sh.getRange(1, 1, 1, PROJECTS_HEADERS_.length).setValues([PROJECTS_HEADERS_]);
    sh.setFrozenRows(1);
    // header style
    sh.getRange(1, 1, 1, PROJECTS_HEADERS_.length)
      .setFontWeight('bold')
      .setBackground('#1F3864')
      .setFontColor('#ffffff');
    sh.autoResizeColumns(1, PROJECTS_HEADERS_.length);
  }
  return sh;
}

/**
 * อ่านโปรเจกต์ทั้งหมด (active ก่อน — เรียงตาม created_at มาก→น้อย)
 * Returns: { ok:true, data:[{project_id, name, client, ...}] }
 */
function getProjects_() {
  try {
    const sh = getOrCreateProjectsSheet_();
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return { ok: true, data: [] };

    const range = sh.getRange(2, 1, lastRow - 1, PROJECTS_HEADERS_.length);
    const rows = range.getValues();

    const out = rows
      .filter(function(r) { return r[0]; }) // มี project_id เท่านั้น
      .map(function(r) {
        const obj = {};
        PROJECTS_HEADERS_.forEach(function(h, i) {
          let v = r[i];
          // normalize date → ISO string (yyyy-mm-dd)
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

    // active ขึ้นก่อน archived
    out.sort(function(a, b) {
      const sa = (a.status || '').toString();
      const sb = (b.status || '').toString();
      if (sa === 'active' && sb !== 'active') return -1;
      if (sb === 'active' && sa !== 'active') return 1;
      // ใหม่ก่อน
      return (b.created_at || '').toString().localeCompare((a.created_at || '').toString());
    });

    return { ok: true, data: out };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * สร้างโปรเจกต์ใหม่
 * @param {object} p - { name (req), client, quote_no, start_date, end_date, total_value, contractor }
 * Returns: { ok:true, project_id, project: {...} }
 */
function createProject_(p) {
  try {
    p = p || {};
    if (!p.name || !String(p.name).trim()) {
      return { ok: false, error: 'ต้องระบุชื่อโครงการ' };
    }

    const sh = getOrCreateProjectsSheet_();

    // gen project_id — สั้น อ่านง่าย ไม่ชน
    const ts = Date.now();
    const projectId = 'prj_' + ts.toString(36);

    // total_days = คำนวณจาก start→end ถ้ามีทั้งคู่
    let totalDays = parseInt(p.total_days, 10) || 0;
    if (!totalDays && p.start_date && p.end_date) {
      const sd = new Date(p.start_date);
      const ed = new Date(p.end_date);
      if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
        totalDays = Math.max(0, Math.round((ed - sd) / 86400000));
      }
    }

    const createdAt = new Date().toISOString();

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
      String(p.sheets_id || SpreadsheetApp.getActiveSpreadsheet().getId()).trim(),
      createdAt
    ];

    sh.appendRow(row);

    // เตรียม return object
    const project = {};
    PROJECTS_HEADERS_.forEach(function(h, i) { project[h] = row[i]; });

    return { ok: true, project_id: projectId, project: project };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * (Optional) seed โปรเจกต์ bow-house ที่ hardcode ใน frontend
 * รันครั้งเดียวจาก Apps Script editor — ไม่ผูกกับ HTTP endpoint
 */
function seedBowHouse_() {
  const sh = getOrCreateProjectsSheet_();
  // เช็คซ้ำ — กันรัน 2 ครั้ง
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
    SpreadsheetApp.getActiveSpreadsheet().getId(),
    new Date().toISOString()
  ]);
  Logger.log('seed bow-house เรียบร้อย');
}

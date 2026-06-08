// ============================================================
// risks.gs — Phase R-1/R-2/R-3: Risk management upgrade
// ============================================================
// R-1: schema migration — เพิ่ม Likelihood/Impact/Risk Score + Causes + Affected Parties
// R-3: seed 13 risks ของคุณดิเรกเป็น template (project_id='direk-template')
// R-3b: clone risks จาก template ไป target project
// + CRUD: create_risk, update_risk, delete_risk
// ============================================================

const RISK_NEW_COLUMNS_ = [
  'Likelihood Score',  // 1-5
  'Impact Score',      // 1-5
  'Risk Score',        // L * I = 1-25 (เก็บไว้เพื่อ filter/sort เร็ว)
  'Causes',
  'Affected Parties'   // comma-separated: พนักงาน, องค์กร, ลูกค้า, โครงการ
];

const RISK_TEMPLATE_PROJECT_ = 'direk-template';

// ============================================================
// R-1: schema migration
// ============================================================

/**
 * เพิ่ม columns ใหม่ใน 05_Risks (idempotent) + backfill score จาก Severity เก่า
 * Heuristic: Critical=25, High=16, Medium=9, Low=4 (mid-cell ของแต่ละ band)
 * เรียกผ่าน endpoint '_phase_r1_migrate'
 */
function phaseR1Migrate_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const sh = ss.getSheetByName(SHEET.RISKS);
  if (!sh) throw new Error('Sheet not found: ' + SHEET.RISKS);

  const lastCol = sh.getLastColumn();
  const lastRow = sh.getLastRow();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];

  // 1. เพิ่ม columns ที่ยังไม่มี
  const addedCols = [];
  RISK_NEW_COLUMNS_.forEach(function(col) {
    if (headers.indexOf(col) === -1) {
      const newColIdx = sh.getLastColumn() + 1;
      sh.getRange(1, newColIdx).setValue(col).setFontWeight('bold');
      addedCols.push(col);
      headers.push(col);  // sync headers in memory
    }
  });

  // 2. Re-read headers หลังเพิ่ม
  const headers2 = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const colIdx = {};
  ['Severity', 'Likelihood', 'Impact', 'Likelihood Score', 'Impact Score', 'Risk Score'].forEach(function(c) {
    colIdx[c] = headers2.indexOf(c);
  });

  // 3. Backfill score จาก severity เก่า (ถ้า score ว่าง)
  let backfilled = 0;
  if (lastRow >= 2 && colIdx['Risk Score'] !== -1) {
    const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
    const updates = [];
    data.forEach(function(row, i) {
      const curScore = row[colIdx['Risk Score']];
      if (curScore !== '' && curScore !== null && curScore !== undefined) return;

      // map severity → score
      const sev = String(row[colIdx['Severity']] || '').toLowerCase();
      let lScore = 0, iScore = 0;
      if (sev.indexOf('critical') !== -1 || sev.indexOf('วิกฤต') !== -1) { lScore = 5; iScore = 5; }
      else if (sev.indexOf('high') !== -1 || sev.indexOf('สูง') !== -1) { lScore = 4; iScore = 4; }
      else if (sev.indexOf('medium') !== -1 || sev.indexOf('กลาง') !== -1) { lScore = 3; iScore = 3; }
      else if (sev.indexOf('low') !== -1 || sev.indexOf('ต่ำ') !== -1) { lScore = 2; iScore = 2; }

      if (lScore && iScore) {
        updates.push({ rowIdx: i + 2, lScore: lScore, iScore: iScore });
      }
    });

    updates.forEach(function(u) {
      if (colIdx['Likelihood Score'] !== -1) sh.getRange(u.rowIdx, colIdx['Likelihood Score'] + 1).setValue(u.lScore);
      if (colIdx['Impact Score'] !== -1) sh.getRange(u.rowIdx, colIdx['Impact Score'] + 1).setValue(u.iScore);
      if (colIdx['Risk Score'] !== -1) sh.getRange(u.rowIdx, colIdx['Risk Score'] + 1).setValue(u.lScore * u.iScore);
      backfilled++;
    });
  }

  return {
    added_columns: addedCols,
    total_rows: Math.max(0, lastRow - 1),
    backfilled_score_rows: backfilled
  };
}

// ============================================================
// R-3: Seed 13 risks ของดิเรก เป็น template (idempotent)
// ============================================================

const DIREK_RISK_TEMPLATE_ = [
  { cat: 'Schedule', desc: 'โครงการเสร็จไม่ทันตามกำหนด/ความล่าช้าในการส่งมอบงาน',
    affected: 'พนักงาน, โครงการ', l: 5, i: 4, owner: 'ผู้บริหาร',
    causes: 'ขาดการเตรียมการข้อมูลสำคัญ เช่น Vendor list, พนักงานขาดประสบการณ์',
    mitigation: 'จัดทำ Vendor list, จัดอบรมพนักงานเรื่อง Project Management, จัดหาพนักงานในตำแหน่งสำคัญ' },
  { cat: 'Procurement', desc: 'ความล่าช้าในการสรรหาผู้รับเหมา',
    affected: 'ลูกค้า, โครงการ', l: 5, i: 4, owner: 'ผู้จัดการโครงการ, ฝ่ายสรรหา',
    causes: 'ขาด connection, Vendor list',
    mitigation: 'จัดทำ Vendor list, การสื่อสาร, connection' },
  { cat: 'Procurement', desc: 'ผู้รับเหมาไม่มีความรับผิดชอบ/ทิ้งงาน',
    affected: 'องค์กร, ลูกค้า', l: 5, i: 4, owner: 'ผู้จัดการโครงการ, ฝ่ายสรรหา',
    causes: 'ระยะเวลาจำกัด, Vendor list, connection, ไม่มีข้อมูลเชิงลึก, ไม่จัดเก็บประวัติ',
    mitigation: 'จัดทำ Vendor list, จัดทำสัญญา, ระบบการตรวจสอบ, การติดตามงาน' },
  { cat: 'Procurement', desc: 'ผู้รับเหมาไม่มีฝีมือ',
    affected: 'องค์กร, ลูกค้า', l: 5, i: 3, owner: 'ผู้จัดการโครงการ, ฝ่ายสรรหา',
    causes: 'ระยะเวลาจำกัด, Vendor list, connection, ไม่เห็นผลงานจริง, ไม่มีหลักเกณฑ์มาตรฐาน',
    mitigation: 'จัดทำ Vendor list, Portfolio, connection, communication, ตรวจผลงานปัจจุบัน' },
  { cat: 'Procurement', desc: 'ความเสี่ยงการจัดซื้อ จัดหาวัสดุอุปกรณ์',
    affected: 'องค์กร, ลูกค้า', l: 5, i: 3, owner: 'ผู้บริหาร, ผู้จัดการฝ่าย',
    causes: 'พนักงานเก่าลาออก, พนักงานใหม่ขาดประสบการณ์',
    mitigation: 'จัดทำระบบควบคุมเชิงปริมาณ คุณภาพ ราคา การส่งมอบ + จัดทำ Vendor list (Supplier)' },
  { cat: 'Quality', desc: 'การผลิตล่าช้า/ไม่มีคุณภาพ',
    affected: 'องค์กร, ลูกค้า', l: 4, i: 3, owner: 'ผู้บริหาร, ผู้จัดการฝ่าย, ผู้จัดการโครงการ',
    causes: 'การจัดซื้อวัสดุอุปกรณ์ล่าช้า/ไม่ตรงสเปค, พนักงานขาดฝีมือ, ทำงานไม่ได้ตามแผน',
    mitigation: 'ระบบควบคุมเชิงปริมาณ คุณภาพ ราคา การส่งมอบ + บริหารเวลา + การสื่อสาร' },
  { cat: 'HR', desc: 'พนักงานระดับ Project ลาออก',
    affected: 'องค์กร, ลูกค้า', l: 3, i: 2, owner: 'ผู้บริหาร',
    causes: 'วัฒนธรรมองค์กร, การสื่อสารภายใน, การยอมรับจากเพื่อนพนักงาน, การประสานงานภายใน',
    mitigation: 'จัดหาบุคลากรภายนอกเพื่อสำรอง + จัดหาพนักงานภายในที่มีความรู้ความสามารถ' },
  { cat: 'HR', desc: 'ศักยภาพ/ประสิทธิภาพการทำงานของพนักงาน',
    affected: 'องค์กร, ลูกค้า', l: 4, i: 4, owner: 'ผู้บริหาร',
    causes: 'ประสบการณ์ในการบริหารงานและบริหารโครงการขนาดใหญ่',
    mitigation: 'ระบบควบคุมเชิงปริมาณ คุณภาพ ราคา การส่งมอบ + อบรมการสื่อสาร' },
  { cat: 'Safety', desc: 'เกิดอุบัติเหตุในที่ทำงาน',
    affected: 'พนักงาน', l: 4, i: 4, owner: 'ผู้จัดการฝ่ายผลิต, ผู้จัดการโครงการ, ฝ่ายบุคคล',
    causes: 'สภาพแวดล้อมไม่ปลอดภัย, ขาดอุปกรณ์ป้องกัน',
    mitigation: 'ปรับปรุงสภาพแวดล้อม + จัดหาอุปกรณ์ป้องกันให้เพียงพอ + อบรมความปลอดภัย' },
  { cat: 'Finance', desc: 'เงินทุนหมุนเวียน',
    affected: 'องค์กร, ลูกค้า', l: 3, i: 3, owner: 'ผู้จัดการฝ่ายผลิต, ผู้จัดการโครงการ, ฝ่ายบุคคล',
    causes: 'การทำงานที่ล่าช้า',
    mitigation: 'จัดหาแหล่งเงินทุน / ทำงานให้เร็ว / ส่งมอบตามงวดงาน' },
  { cat: 'Operations', desc: 'ประสิทธิภาพในการประสานงาน',
    affected: 'องค์กร, ลูกค้า', l: 4, i: 4, owner: 'ผู้จัดการฝ่ายผลิต, ผู้จัดการโครงการ, ฝ่ายบุคคล',
    causes: 'ไม่ประสานงานกัน + ขาดความรู้ความเข้าใจในงาน',
    mitigation: 'MINDSET / ACKNOWLEDGE / COLLABORATION TEAM / COMMUNICATION' },
  { cat: 'Operations', desc: 'การแก้ไขปัญหาที่หน้างาน',
    affected: 'องค์กร, ลูกค้า', l: 4, i: 4, owner: 'ผู้จัดการฝ่ายผลิต, ผู้จัดการโครงการ, ฝ่ายบุคคล',
    causes: 'สภาพหน้างานเปลี่ยนแปลง/ไม่เป็นไปตามแบบ',
    mitigation: 'MINDSET / ACKNOWLEDGE / COLLABORATION TEAM / COMMUNICATION' },
  { cat: 'Cost Control', desc: 'การควบคุมต้นทุนโครงการ',
    affected: 'องค์กร', l: 5, i: 4, owner: 'ผู้จัดการฝ่ายผลิต, ผู้จัดการโครงการ, ฝ่ายบุคคล',
    causes: 'พนักงานความรู้ความเข้าใจในหลักการ + ขาดประสานงาน 3 ส่วน (Estimate/Site/Production)',
    mitigation: 'MINDSET / ACKNOWLEDGE / COLLABORATION TEAM' }
];

/**
 * Seed 13 risks ของดิเรกใน 05_Risks ภายใต้ project_id='direk-template'
 * Idempotent: ถ้ามี risks ใน direk-template อยู่แล้ว → ข้าม
 * เรียกผ่าน endpoint '_seed_direk_template'
 */
function seedDirekTemplate_() {
  // เช็คก่อนว่า direk-template มี risks อยู่แล้วหรือไม่
  const existing = _filterByProject_(getAllRows(SHEET.RISKS), RISK_TEMPLATE_PROJECT_);
  if (existing.length > 0) {
    return {
      skipped: true,
      reason: 'มี ' + existing.length + ' risks ใน ' + RISK_TEMPLATE_PROJECT_ + ' อยู่แล้ว',
      existing_count: existing.length
    };
  }

  // pre-compute next Risk ID number
  const allRisks = getAllRows(SHEET.RISKS);
  let maxNum = 0;
  allRisks.forEach(function(r) {
    const m = String(r['Risk ID'] || '').match(/(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });

  const today = todayStr();
  const rows = DIREK_RISK_TEMPLATE_.map(function(t) {
    maxNum++;
    return {
      'Risk ID':          'R' + String(maxNum).padStart(3, '0'),
      'Category':         t.cat,
      'Description':      t.desc,
      'Affected FF':      '',
      'Severity':         t.l * t.i >= 16 ? 'High' : (t.l * t.i >= 9 ? 'Medium' : 'Low'),
      'Likelihood':       String(t.l),
      'Impact':           String(t.i),
      'Likelihood Score': t.l,
      'Impact Score':     t.i,
      'Risk Score':       t.l * t.i,
      'Causes':           t.causes,
      'Affected Parties': t.affected,
      'Mitigation Plan':  t.mitigation,
      'Status':           'Open',
      'Owner':            t.owner,
      'Date Identified':  today
    };
  });

  const written = _batchAppendRows_(SHEET.RISKS, rows, RISK_TEMPLATE_PROJECT_);
  return {
    seeded: true,
    template_project_id: RISK_TEMPLATE_PROJECT_,
    risks_added: written
  };
}

// ============================================================
// R-3b: Clone risks จาก template ไป target project
// ============================================================

/**
 * Clone risks จาก source (default: direk-template) → target project
 * - target ต้องยังไม่มี risks (กัน clone ซ้ำ)
 * - reset Status เป็น 'Open' + Date Identified = วันนี้
 * @param {object} p - { target_project_id (req — fallback p.project_id), source_project_id ('direk-template' default) }
 */
function cloneRisks_(p) {
  p = p || {};
  const target = String(p.target_project_id || p.project_id || '').trim();
  const source = String(p.source_project_id || RISK_TEMPLATE_PROJECT_).trim();

  if (!target) throw new Error('target_project_id ต้องระบุ');
  if (target === source) throw new Error('target และ source ต้องไม่ใช่อันเดียวกัน');
  if (target === RISK_TEMPLATE_PROJECT_) throw new Error('ไม่อนุญาตให้คัดลอกเข้า template');

  // กัน clone ซ้ำ
  const existing = _filterByProject_(getAllRows(SHEET.RISKS), target);
  if (existing.length > 0) {
    throw new Error('โปรเจกต์ปลายทางมี risk อยู่แล้ว ' + existing.length + ' รายการ — ยกเลิก');
  }

  // อ่าน source
  const sourceRisks = _filterByProject_(getAllRows(SHEET.RISKS), source);
  if (sourceRisks.length === 0) {
    throw new Error('โปรเจกต์ต้นแบบไม่มี risk: ' + source);
  }

  // pre-compute next Risk ID
  const allRisks = getAllRows(SHEET.RISKS);
  let maxNum = 0;
  allRisks.forEach(function(r) {
    const m = String(r['Risk ID'] || '').match(/(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });

  const today = todayStr();
  const rows = sourceRisks.map(function(r) {
    maxNum++;
    return {
      'Risk ID':          'R' + String(maxNum).padStart(3, '0'),
      'Category':         r['Category'] || '',
      'Description':      r['Description'] || '',
      'Affected FF':      '',  // FF ของ source ไม่เกี่ยวกับ target
      'Severity':         r['Severity'] || '',
      'Likelihood':       r['Likelihood'] || '',
      'Impact':           r['Impact'] || '',
      'Likelihood Score': r['Likelihood Score'] || '',
      'Impact Score':     r['Impact Score'] || '',
      'Risk Score':       r['Risk Score'] || '',
      'Causes':           r['Causes'] || '',
      'Affected Parties': r['Affected Parties'] || '',
      'Mitigation Plan':  r['Mitigation Plan'] || '',
      'Status':           'Open',
      'Owner':            r['Owner'] || '',
      'Date Identified':  today
    };
  });

  const written = _batchAppendRows_(SHEET.RISKS, rows, target);
  return { source: source, target: target, risks_cloned: written };
}

// ============================================================
// CRUD: create_risk, update_risk, delete_risk
// ============================================================

function _validateScore_(v, name) {
  const n = parseInt(v, 10);
  if (isNaN(n) || n < 1 || n > 5) throw new Error(name + ' ต้องเป็นเลข 1-5');
  return n;
}

function _severityFromScore_(score) {
  if (score >= 16) return 'High';
  if (score >= 9) return 'Medium';
  return 'Low';
}

/**
 * เพิ่ม risk 1 รายการ
 * @param {object} p - { description (req), likelihood_score (req 1-5), impact_score (req 1-5),
 *                       category, affected_parties, affected_ff, causes, mitigation, owner, status }
 */
function createRisk_(p) {
  p = p || {};
  const desc = String(p.description || p.desc || '').trim();
  if (!desc) throw new Error('Description ต้องระบุ');

  const lScore = _validateScore_(p.likelihood_score, 'Likelihood Score');
  const iScore = _validateScore_(p.impact_score, 'Impact Score');
  const score = lScore * iScore;

  const id = generateId('R', SHEET.RISKS, 'Risk ID');
  const row = {
    'Risk ID':          id,
    'Category':         String(p.category || '').trim(),
    'Description':      desc,
    'Affected FF':      String(p.affected_ff || '').trim(),
    'Severity':         _severityFromScore_(score),
    'Likelihood':       String(lScore),
    'Impact':           String(iScore),
    'Likelihood Score': lScore,
    'Impact Score':     iScore,
    'Risk Score':       score,
    'Causes':           String(p.causes || '').trim(),
    'Affected Parties': String(p.affected_parties || '').trim(),
    'Mitigation Plan':  String(p.mitigation || p.mitigation_plan || '').trim(),
    'Status':           String(p.status || 'Open').trim(),
    'Owner':            String(p.owner || '').trim(),
    'Date Identified':  todayStr()
  };
  appendRow(SHEET.RISKS, row);  // B-4 auto-stamps project_id
  // Phase H: auto-log
  try { autoLog_('⚠️ เพิ่มความเสี่ยง: ' + desc + ' (ระดับ ' + row['Severity'] + ')',
    { meta: { kind: 'risk', risk_id: id } }); } catch (e) {}
  return row;
}

/**
 * แก้ไข risk (scope by project_id)
 * @param {object} p - { id (req), description?, likelihood_score?, impact_score?, ... }
 */
function updateRisk_(p) {
  p = p || {};
  const id = String(p.id || p.risk_id || '').trim();
  if (!id) throw new Error('Risk ID ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  // verify risk อยู่ใน project ปัจจุบัน
  const allRisks = getAllRows(SHEET.RISKS);
  const target = allRisks.find(function(r) {
    if (String(r['Risk ID'] || '').trim() !== id) return false;
    const rpid = String(r.project_id || '').trim();
    return rpid === pid || (pid === 'bow-house' && rpid === '');
  });
  if (!target) throw new Error('ไม่พบ risk ในโปรเจกต์: ' + id);

  // map fields
  const fieldMap = {
    description: 'Description', desc: 'Description',
    category: 'Category', cat: 'Category',
    affected_ff: 'Affected FF',
    affected_parties: 'Affected Parties',
    causes: 'Causes',
    mitigation: 'Mitigation Plan', mitigation_plan: 'Mitigation Plan',
    owner: 'Owner',
    status: 'Status'
  };
  const updates = {};
  Object.keys(fieldMap).forEach(function(k) {
    if (p[k] === undefined || p[k] === null) return;
    updates[fieldMap[k]] = String(p[k]).trim();
  });

  // score recompute ถ้าส่ง L หรือ I มา
  let newL = (p.likelihood_score !== undefined && p.likelihood_score !== null && p.likelihood_score !== '')
    ? _validateScore_(p.likelihood_score, 'Likelihood Score') : null;
  let newI = (p.impact_score !== undefined && p.impact_score !== null && p.impact_score !== '')
    ? _validateScore_(p.impact_score, 'Impact Score') : null;
  if (newL !== null || newI !== null) {
    const finalL = newL !== null ? newL : parseInt(target['Likelihood Score'] || 0, 10);
    const finalI = newI !== null ? newI : parseInt(target['Impact Score'] || 0, 10);
    if (finalL && finalI) {
      updates['Likelihood Score'] = finalL;
      updates['Impact Score'] = finalI;
      updates['Risk Score'] = finalL * finalI;
      updates['Likelihood'] = String(finalL);
      updates['Impact'] = String(finalI);
      updates['Severity'] = _severityFromScore_(finalL * finalI);
    }
  }

  if (Object.keys(updates).length === 0) throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');
  updateRowByCol(SHEET.RISKS, 'Risk ID', id, updates);
  return { id: id, updated_fields: Object.keys(updates) };
}

/**
 * ลบ risk (scope by project_id)
 */
function deleteRisk_(p) {
  p = p || {};
  const id = String(p.id || p.risk_id || '').trim();
  if (!id) throw new Error('Risk ID ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const sh = ss.getSheetByName(SHEET.RISKS);
  if (!sh) throw new Error('Sheet not found: ' + SHEET.RISKS);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('ไม่พบ risk: ' + id);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf('Risk ID');
  const pidCol = headers.indexOf('project_id');
  if (idCol === -1) throw new Error('Risk ID column not found');

  const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idCol] || '').trim() !== id) continue;
    if (pidCol !== -1) {
      const rpid = String(data[i][pidCol] || '').trim();
      if (rpid !== pid && !(pid === 'bow-house' && rpid === '')) continue;
    }
    sh.deleteRow(i + 2);
    return { id: id, deleted: 1 };
  }
  throw new Error('ไม่พบ risk: ' + id);
}

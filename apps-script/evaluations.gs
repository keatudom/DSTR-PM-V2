// ============================================================
// evaluations.gs — Contractor Performance Evaluation (Core)
// ============================================================
// ฟีเจอร์ประเมินผู้รับเหมา — KPI 100 คะแนน 8 หมวด (ถ่วงน้ำหนักตามงาน interior)
// + Checklist หัวข้อย่อย → เฉลี่ยเป็นคะแนน KPI → คิด Total/Grade/Status
// + Ranking + Blacklist (เกรด F) ข้ามโครงการ
//
// ออกแบบตามแพตเทิร์น risks.gs:
//   - sheet ใหม่ 2 ตู้ (idempotent สร้างถ้ายังไม่มี — ไม่แตะข้อมูลเดิม)
//   - CRUD scope ด้วย project_id (ใช้ _filterByProject_ / appendRow auto-stamp)
//   - route() wrapping rule: คืน raw object ให้ handle() ห่อ {ok,data} เอง
//
// ตู้ที่สร้าง:
//   28_Contractor_Evaluations — 1 แถว = 1 ครั้งการประเมิน (per project + per team)
//   29_Eval_Rubric            — เกณฑ์มาตรฐานบริษัท (อ่านอย่างเดียว/อ้างอิง)
// ============================================================

const EVAL_SHEET_        = '28_Contractor_Evaluations';
const EVAL_RUBRIC_SHEET_ = '29_Eval_Rubric';

// header ของ 28_Contractor_Evaluations
const EVAL_COLUMNS_ = [
  'Eval ID', 'project_id', 'team_id', 'Team Name', 'Eval Date', 'Evaluator',
  'Manpower', 'Progress', 'Quality', 'First Pass',
  'Delivery', 'Response', 'Discipline', 'Finance',
  'Total Score', 'Grade', 'Status', 'Remark', 'Sub Scores', 'created_at'
];

// header ของ 29_Eval_Rubric
const EVAL_RUBRIC_COLUMNS_ = ['KPI', 'Weight %', 'Sub No', 'Sub-criteria', 'What to check'];

// ============================================================
// 🎚️ KPI definition — น้ำหนักถ่วงตามงาน interior/built-in
// (Quality + Delivery + First Pass + Progress = แกนหลัก = 65%)
// น้ำหนักรวมต้อง = 1.00  ·  ลำดับ key ต้องตรงกับ column ใน EVAL_COLUMNS_
// ============================================================
const EVAL_KPIS_ = [
  { key: 'Manpower',   label: 'กำลังคน',            weight: 0.10, subs: [
    { no: '1.1', name: 'คนเข้างานครบตามแผน',                check: '' },
    { no: '1.2', name: 'ช่างมาตรงเวลา ไม่สายประจำ',          check: '' },
    { no: '1.3', name: 'ไม่ขาด/หยุดงานกะทันหันโดยไม่แจ้ง',   check: '' },
    { no: '1.4', name: 'มีหัวหน้าคุมงานประจำทุกวัน',         check: '' }
  ]},
  { key: 'Progress',   label: 'ความคืบหน้า',        weight: 0.15, subs: [
    { no: '2.1', name: 'งานคืบหน้าตามแผน ไม่ล่าช้า',     check: '' },
    { no: '2.2', name: 'ส่งงานตามงวด/Milestone ครบ',     check: '' },
    { no: '2.3', name: 'วางแผนคิวงานล่วงหน้า',            check: '' },
    { no: '2.4', name: 'เมื่อช้า มีแผนเร่งงานชัดเจน',     check: '' }
  ]},
  { key: 'Quality',    label: 'คุณภาพงาน',          weight: 0.20, subs: [
    { no: '3.1', name: 'งานตรงตามแบบ/สเปก',          check: '' },
    { no: '3.2', name: 'เก็บงานละเอียด เรียบร้อย',    check: '' },
    { no: '3.3', name: 'ไม่ต้องรื้อแก้ (rework) บ่อย', check: '' },
    { no: '3.4', name: 'ใช้วัสดุตามที่อนุมัติ',       check: '' }
  ]},
  { key: 'First Pass', label: 'ตรวจผ่านครั้งแรก',    weight: 0.15, subs: [
    { no: '4.1', name: 'งานผ่านตรวจครั้งแรก ไม่ต้องตรวจซ้ำหลายรอบ', check: '' },
    { no: '4.2', name: 'จุดบกพร่อง (defect) น้อย',                 check: '' },
    { no: '4.3', name: 'ตรวจงานตัวเองก่อนเรียกตรวจ',               check: '' },
    { no: '4.4', name: 'แก้จุดบกพร่องเร็ว',                        check: '' }
  ]},
  { key: 'Delivery',   label: 'ส่งมอบตรงเวลา',       weight: 0.15, subs: [
    { no: '5.1', name: 'ส่งมอบงานตรงเวลา',           check: '' },
    { no: '5.2', name: 'ถ้าช้า แจ้งล่วงหน้า',        check: '' },
    { no: '5.3', name: 'ส่งเอกสาร/แบบส่งมอบครบ',      check: '' },
    { no: '5.4', name: 'ปิดงานค้าง (punch list) ครบ', check: '' }
  ]},
  { key: 'Response',   label: 'การตอบสนอง',          weight: 0.05, subs: [
    { no: '6.1', name: 'ตอบกลับเร็วเมื่อมีเรื่องแจ้ง', check: '' },
    { no: '6.2', name: 'เข้าประชุม/ตามนัดครบ',         check: '' },
    { no: '6.3', name: 'ส่งรายงานความคืบหน้าตามรอบ',   check: '' }
  ]},
  { key: 'Discipline', label: 'วินัย/ความปลอดภัย',   weight: 0.10, subs: [
    { no: '7.1', name: 'เข้า-ออกงานตรงเวลา',                check: '' },
    { no: '7.2', name: 'ไม่หยุดงานพร่ำเพรื่อ',              check: '' },
    { no: '7.3', name: 'ใส่อุปกรณ์เซฟตี้ (PPE) ครบ',        check: '' },
    { no: '7.4', name: 'เก็บพื้นที่งานสะอาดเรียบร้อย',      check: '' },
    { no: '7.5', name: 'ปฏิบัติตามกฎไซต์ (ไม่ดื่ม/สูบในเขตห้าม)', check: '' }
  ]},
  { key: 'Finance',    label: 'วินัยการเงิน',        weight: 0.10, subs: [
    { no: '8.1', name: 'เบิกเงินตามงวดงานจริง ไม่เบิกล่วงหน้าก่อนขึ้นชิ้นงาน', check: '' },
    { no: '8.2', name: 'เอกสารเบิก/บิลถูกต้องครบ',                          check: '' },
    { no: '8.3', name: 'จ่ายค่าแรงคนงานตรงเวลา ไม่มีร้องเรียน',             check: '' },
    { no: '8.4', name: 'ทำตามสัญญา ไม่ทิ้งงาน/ขอเลื่อนพร่ำเพรื่อ',          check: '' }
  ]}
];

// เกณฑ์การให้คะแนน (band) — มาตรฐานเดียวกันทุก KPI สำหรับ Core
const EVAL_BANDS_ = [
  { range: '9-10', level: 'ดีเยี่ยม',     desc: 'ทำได้ครบถ้วน เกินมาตรฐาน แทบไม่มีข้อบกพร่อง' },
  { range: '7-8',  level: 'ดี',           desc: 'ได้ตามมาตรฐาน มีจุดต้องเตือนเล็กน้อย' },
  { range: '5-6',  level: 'ปานกลาง',      desc: 'พอใช้ มีข้อบกพร่องที่ต้องตามแก้' },
  { range: '3-4',  level: 'ต้องปรับปรุง', desc: 'ต่ำกว่ามาตรฐาน มีปัญหาซ้ำ ๆ' },
  { range: '1-2',  level: 'ไม่ยอมรับ',    desc: 'ไม่ผ่าน กระทบงานรุนแรง' }
];

// ============================================================
// 🛠️ Sheet setup (idempotent) — สร้างตู้ใหม่ ไม่แตะตู้เดิม
// ============================================================

/**
 * สร้าง sheet พร้อม header ถ้ายังไม่มี (idempotent)
 * - ถ้ามี sheet อยู่แล้ว → การันตี header ครบ (เพิ่ม column ที่ขาดต่อท้าย)
 */
function _ensureEvalSheets_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const created = [];

  [[EVAL_SHEET_, EVAL_COLUMNS_], [EVAL_RUBRIC_SHEET_, EVAL_RUBRIC_COLUMNS_]].forEach(function(pair) {
    const name = pair[0], cols = pair[1];
    let sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
      sh.setFrozenRows(1);
      created.push(name);
    } else {
      // การันตี header ครบ (เพิ่มที่ขาดต่อท้าย — ไม่ทับของเดิม)
      const lastCol = Math.max(1, sh.getLastColumn());
      const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      cols.forEach(function(c) {
        if (headers.indexOf(c) === -1) {
          sh.getRange(1, sh.getLastColumn() + 1).setValue(c).setFontWeight('bold');
        }
      });
    }
  });

  return { ensured: [EVAL_SHEET_, EVAL_RUBRIC_SHEET_], created: created };
}

/**
 * seed 29_Eval_Rubric ด้วยเกณฑ์มาตรฐานบริษัท (idempotent)
 * ถ้ามีข้อมูลอยู่แล้ว → ข้าม (ไม่เขียนซ้ำ)
 * เรียกผ่าน endpoint '_seed_eval_rubric'
 */
function seedEvalRubric_() {
  _ensureEvalSheets_();
  const existing = getAllRows(EVAL_RUBRIC_SHEET_);
  if (existing.length > 0) {
    return { skipped: true, reason: 'มี rubric อยู่แล้ว ' + existing.length + ' แถว' };
  }
  const rows = [];
  EVAL_KPIS_.forEach(function(kpi) {
    kpi.subs.forEach(function(s) {
      rows.push({
        'KPI':          kpi.label + ' (' + kpi.key + ')',
        'Weight %':     Math.round(kpi.weight * 100),
        'Sub No':       s.no,
        'Sub-criteria': s.name,
        'What to check': s.check
      });
    });
  });
  const written = _batchAppendRows_(EVAL_RUBRIC_SHEET_, rows, null);
  return { seeded: true, rows_added: written };
}

// ============================================================
// 🧮 Scoring helpers
// ============================================================

function _evalGradeFromTotal_(total) {
  if (total >= 90) return 'A';
  if (total >= 80) return 'B';
  if (total >= 70) return 'C';
  if (total >= 60) return 'D';
  return 'F';
}

function _evalStatusFromTotal_(total) {
  if (total >= 90) return 'Excellent';
  if (total >= 80) return 'Very Good';
  if (total >= 70) return 'Good';
  if (total >= 60) return 'Warning';
  return 'Blacklist';
}

function _evalParseSubScores_(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

/**
 * คำนวณคะแนน KPI 8 หมวด + Total จาก input
 * @param {object} subScores - { '1.1': 8, '1.2': 9, ... } (ถ้ามี — เฉลี่ยเป็น KPI)
 * @param {object} kpiScores - { Manpower: 8, ... } (override/fallback ถ้าไม่มี subScores ของหมวดนั้น)
 * @returns {object} { kpi: {Manpower:..}, total: number }
 */
function _evalCompute_(subScores, kpiScores) {
  subScores = subScores || {};
  kpiScores = kpiScores || {};
  const kpi = {};
  let total = 0;
  let weightUsed = 0;

  EVAL_KPIS_.forEach(function(def) {
    // 1) ลองเฉลี่ยจาก sub-criteria ก่อน
    const subVals = def.subs
      .map(function(s) { return Number(subScores[s.no]); })
      .filter(function(v) { return !isNaN(v) && v > 0; });

    let score;
    if (subVals.length > 0) {
      score = subVals.reduce(function(a, b) { return a + b; }, 0) / subVals.length;
    } else if (kpiScores[def.key] !== undefined && kpiScores[def.key] !== '' && !isNaN(Number(kpiScores[def.key]))) {
      score = Number(kpiScores[def.key]);  // fallback: ให้คะแนน KPI ตรง ๆ
    } else {
      score = 0;  // ยังไม่ได้ให้คะแนนหมวดนี้
    }

    score = Math.max(0, Math.min(10, score));
    kpi[def.key] = Math.round(score * 100) / 100;
    if (score > 0) {
      total += score * def.weight;
      weightUsed += def.weight;
    }
  });

  // ถ้าให้คะแนนไม่ครบทุกหมวด → normalize ด้วยน้ำหนักที่ใช้จริง (กันคะแนนต่ำเทียม)
  let totalScore = 0;
  if (weightUsed > 0) totalScore = (total / weightUsed) * 10;
  return { kpi: kpi, total: Math.round(totalScore * 100) / 100, weightUsed: weightUsed };
}

/**
 * คิดคะแนนจาก kpi_scores ที่ frontend ส่งมา (โหมดเช็กลิสต์)
 * - key ที่ "มี" ใน kpiScores = หมวดที่ประเมินแล้ว → นับน้ำหนักเสมอ แม้คะแนน = 0
 *   (ต่างจาก _evalCompute_ ที่ตัดคะแนน 0 ทิ้ง — โหมดเช็กลิสต์ 0 = ตกทุกข้อ ต้องนับ)
 * - key ที่ "ไม่มี" = หมวดที่ข้ามทั้งหมด → ไม่นับน้ำหนัก
 * @param {object} kpiScores - { Manpower: 7.5, ... } (0-10, 0 ถือว่า valid)
 */
function _evalComputeFromKpi_(kpiScores) {
  kpiScores = kpiScores || {};
  const kpi = {};
  let total = 0, weightUsed = 0;
  EVAL_KPIS_.forEach(function(def) {
    const raw = kpiScores[def.key];
    if (raw !== undefined && raw !== null && raw !== '' && !isNaN(Number(raw))) {
      const s = Math.max(0, Math.min(10, Number(raw)));
      kpi[def.key] = Math.round(s * 100) / 100;
      total += s * def.weight;
      weightUsed += def.weight;
    } else {
      kpi[def.key] = 0;
    }
  });
  const totalScore = weightUsed > 0 ? (total / weightUsed) * 10 : 0;
  return { kpi: kpi, total: Math.round(totalScore * 100) / 100, weightUsed: weightUsed };
}

// ============================================================
// 📤 Config endpoint — ส่ง KPI/น้ำหนัก/เกณฑ์ ให้ frontend สร้างฟอร์ม
// ============================================================
function getEvalConfig_() {
  return {
    kpis: EVAL_KPIS_.map(function(k) {
      return { key: k.key, label: k.label, weight: k.weight, subs: k.subs };
    }),
    bands: EVAL_BANDS_,
    grade_scale: [
      { grade: 'A', min: 90, status: 'Excellent' },
      { grade: 'B', min: 80, status: 'Very Good' },
      { grade: 'C', min: 70, status: 'Good' },
      { grade: 'D', min: 60, status: 'Warning' },
      { grade: 'F', min: 0,  status: 'Blacklist' }
    ]
  };
}

// ============================================================
// 📋 READ — list evals (scope by project)
// ============================================================
function getEvals_(p) {
  _ensureEvalSheets_();
  p = p || {};
  const projectId = p.project_id || _getCurrentProjectId_() || 'bow-house';
  let rows = _filterByProject_(getAllRows(EVAL_SHEET_), projectId);
  if (p.team_id) rows = rows.filter(function(r) { return String(r.team_id) === String(p.team_id); });

  return rows.map(_evalRowToObj_).sort(function(a, b) {
    return String(b.evalDate).localeCompare(String(a.evalDate));
  });
}

function _evalRowToObj_(r) {
  const kpi = {};
  EVAL_KPIS_.forEach(function(def) { kpi[def.key] = Number(r[def.key] || 0); });
  return {
    id:        r['Eval ID'] || '',
    teamId:    r['team_id'] || '',
    teamName:  r['Team Name'] || '',
    evalDate:  formatDateValue(r['Eval Date']),
    evaluator: r['Evaluator'] || '',
    kpi:       kpi,
    total:     Number(r['Total Score'] || 0),
    grade:     r['Grade'] || '',
    status:    r['Status'] || '',
    remark:    r['Remark'] || '',
    subScores: _evalParseSubScores_(r['Sub Scores'])
  };
}

// ============================================================
// 🏆 SUMMARY — คะแนนเฉลี่ย/เกรด/Ranking ต่อทีม (ข้ามโครงการ)
// ใช้ในหน้า team.html → "สมุดพกผู้รับเหมา" + Ranking + Blacklist
// ============================================================
function getEvalSummary_(p) {
  _ensureEvalSheets_();
  // ไม่กรอง project — คะแนนผู้รับเหมาเป็นภาพรวมทุกโครงการ
  const rows = getAllRows(EVAL_SHEET_);
  const byTeam = {};

  rows.forEach(function(r) {
    const tid = String(r['team_id'] || '').trim();
    if (!tid) return;
    const total = Number(r['Total Score'] || 0);
    if (!byTeam[tid]) {
      byTeam[tid] = { teamId: tid, teamName: r['Team Name'] || tid, sum: 0, count: 0, lastDate: '' };
    }
    byTeam[tid].sum += total;
    byTeam[tid].count += 1;
    const d = formatDateValue(r['Eval Date']);
    if (d > byTeam[tid].lastDate) byTeam[tid].lastDate = d;
    if (r['Team Name']) byTeam[tid].teamName = r['Team Name'];
  });

  const list = Object.keys(byTeam).map(function(tid) {
    const t = byTeam[tid];
    const avg = t.count > 0 ? Math.round((t.sum / t.count) * 100) / 100 : 0;
    return {
      teamId:   t.teamId,
      teamName: t.teamName,
      avg:      avg,
      grade:    _evalGradeFromTotal_(avg),
      status:   _evalStatusFromTotal_(avg),
      count:    t.count,
      lastDate: t.lastDate
    };
  });

  // เรียงคะแนนมาก→น้อย แล้วใส่อันดับ
  list.sort(function(a, b) { return b.avg - a.avg; });
  list.forEach(function(item, i) { item.rank = i + 1; });
  return list;
}

// ============================================================
// ✏️ CREATE
// ============================================================
/**
 * @param {object} p - { team_id (req), eval_date?, evaluator?, remark?,
 *                        sub_scores? (JSON {'1.1':8,...}), kpi_scores? (JSON {Manpower:8,...}) }
 */
function createEval_(p) {
  _ensureEvalSheets_();
  p = p || {};
  const teamId = String(p.team_id || '').trim();
  if (!teamId) throw new Error('team_id ต้องระบุ (เลือกผู้รับเหมาก่อน)');

  // โหมดเช็กลิสต์: frontend คิดคะแนนหมวด (kpi_scores) + ส่งผลติ๊กรายข้อ (item_results) มาเก็บ
  // โหมดเก่า (sub_scores 1-10): ยัง backward-compatible
  const kpiScores = _evalParseSubScores_(p.kpi_scores);
  const itemResults = _evalParseSubScores_(p.item_results);
  let computed, auditStore;
  if (Object.keys(kpiScores).length > 0) {
    computed = _evalComputeFromKpi_(kpiScores);
    auditStore = Object.keys(itemResults).length > 0 ? itemResults : kpiScores;
  } else {
    const subScores = _evalParseSubScores_(p.sub_scores);
    computed = _evalCompute_(subScores, {});
    auditStore = subScores;
  }
  if (computed.weightUsed <= 0) throw new Error('ต้องประเมินอย่างน้อย 1 หมวด');

  // หาชื่อทีมจาก 21_Teams (fallback = ที่ frontend ส่งมา / team_id)
  let teamName = String(p.team_name || '').trim();
  if (!teamName) {
    try {
      const t = getAllRows(SHEET.TEAMS).find(function(x) { return String(x.team_id) === teamId; });
      if (t) teamName = t.name || teamId;
    } catch (e) {}
  }
  if (!teamName) teamName = teamId;

  const id = generateId('EV', EVAL_SHEET_, 'Eval ID');
  const row = {
    'Eval ID':     id,
    'team_id':     teamId,
    'Team Name':   teamName,
    'Eval Date':   p.eval_date || todayStr(),
    'Evaluator':   String(p.evaluator || '').trim(),
    'Total Score': computed.total,
    'Grade':       _evalGradeFromTotal_(computed.total),
    'Status':      _evalStatusFromTotal_(computed.total),
    'Remark':      String(p.remark || '').trim(),
    'Sub Scores':  JSON.stringify(auditStore),
    'created_at':  nowStr()
  };
  EVAL_KPIS_.forEach(function(def) { row[def.key] = computed.kpi[def.key]; });

  appendRow(EVAL_SHEET_, row);  // B-4 auto-stamps project_id
  // Phase H: auto-log
  try { autoLog_('📋 ประเมินผู้รับเหมา ' + teamName + ' — ' + computed.total + ' คะแนน (เกรด ' + row['Grade'] + ')',
    { meta: { kind: 'eval', eval_id: id, team_id: teamId } }); } catch (e) {}
  return _evalRowToObj_(row);
}

// ============================================================
// ✏️ UPDATE (scope by project_id)
// ============================================================
function updateEval_(p) {
  _ensureEvalSheets_();
  p = p || {};
  const id = String(p.id || p.eval_id || '').trim();
  if (!id) throw new Error('Eval ID ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  const all = getAllRows(EVAL_SHEET_);
  const target = all.find(function(r) {
    if (String(r['Eval ID'] || '').trim() !== id) return false;
    const rpid = String(r.project_id || '').trim();
    return rpid === pid || (pid === 'bow-house' && rpid === '');
  });
  if (!target) throw new Error('ไม่พบการประเมินในโปรเจกต์: ' + id);

  const updates = {};
  if (p.eval_date !== undefined) updates['Eval Date'] = p.eval_date;
  if (p.evaluator !== undefined) updates['Evaluator'] = String(p.evaluator).trim();
  if (p.remark !== undefined)    updates['Remark']    = String(p.remark).trim();

  // ถ้าส่งคะแนนใหม่มา → recompute ทุกอย่าง
  if (p.sub_scores !== undefined || p.kpi_scores !== undefined || p.item_results !== undefined) {
    const kpiScores = _evalParseSubScores_(p.kpi_scores);
    const itemResults = _evalParseSubScores_(p.item_results);
    let computed, auditStore;
    if (Object.keys(kpiScores).length > 0) {
      computed = _evalComputeFromKpi_(kpiScores);
      auditStore = Object.keys(itemResults).length > 0 ? itemResults : kpiScores;
    } else {
      const subScores = _evalParseSubScores_(p.sub_scores);
      computed = _evalCompute_(subScores, {});
      auditStore = subScores;
    }
    if (computed.weightUsed <= 0) throw new Error('ต้องประเมินอย่างน้อย 1 หมวด');
    EVAL_KPIS_.forEach(function(def) { updates[def.key] = computed.kpi[def.key]; });
    updates['Total Score'] = computed.total;
    updates['Grade']       = _evalGradeFromTotal_(computed.total);
    updates['Status']      = _evalStatusFromTotal_(computed.total);
    updates['Sub Scores']  = JSON.stringify(auditStore);
  }

  if (Object.keys(updates).length === 0) throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');
  updateRowByCol(EVAL_SHEET_, 'Eval ID', id, updates);
  return { id: id, updated_fields: Object.keys(updates) };
}

// ============================================================
// 🗑️ DELETE (scope by project_id)
// ============================================================
function deleteEval_(p) {
  _ensureEvalSheets_();
  p = p || {};
  const id = String(p.id || p.eval_id || '').trim();
  if (!id) throw new Error('Eval ID ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const sh = ss.getSheetByName(EVAL_SHEET_);
  if (!sh) throw new Error('Sheet not found: ' + EVAL_SHEET_);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) throw new Error('ไม่พบการประเมิน: ' + id);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idCol = headers.indexOf('Eval ID');
  const pidCol = headers.indexOf('project_id');
  if (idCol === -1) throw new Error('Eval ID column not found');

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
  throw new Error('ไม่พบการประเมิน: ' + id);
}

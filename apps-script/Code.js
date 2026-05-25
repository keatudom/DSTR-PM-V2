/**
 * ============================================================
 * Bow House Dashboard — Backend v29
 * ============================================================
 * Version: 4.29 (2026-05-19)
 *
 * 🆕 v29 — Bug fixes:
 *   - callGemini: robust error handling (no candidates, content filter,
 *     quota, rate limit) → throw error message ที่อ่านเข้าใจ
 *   - generateDailySummaryV2: retry 1 ครั้ง + fallback summary จาก stats
 *     ถ้า Gemini ล้ม → ไม่แสดง error เปล่า ๆ ให้ user
 *   - Secrets ย้ายไป Script Properties (จาก v28)
 *
 * 🆕 v28 — แก้ปัญหาอัปโหลดรูป log ไม่ได้ ("image_base64 required")
 *   - สาเหตุ: fetch POST เจอ 302 redirect ของ Apps Script
 *     → method เปลี่ยนเป็น GET → body หาย → เข้า doGet
 *   - แก้: เพิ่ม respondUpload_() ตอบ HTML postMessage สำหรับ
 *     คำขอที่มี upload_token (มาจาก api.js callUpload / hidden iframe)
 *   - handle() รองรับ form-urlencoded body จาก iframe form submit
 *   - upload_log_photo / upload_payment_slip / upload_contract_file
 *     ส่ง response ตรง ไม่ห่อใน {ok,data} (หน้าเว็บอ่าน res.photo_url ตรงๆ)
 *
 * Compatible with:
 *   - Old Dashboard (api.js JSONP): getAll, updateTask, updatePayment
 *   - New Materials.html: get_materials, parse_material_log, etc.
 *
 * Schema:
 *   - 09_Contractors: + role + payment_type
 *   - 11_Materials: + tracking_mode (COUNT/STATUS) + last_status_update
 *   - 12_Material_Transactions: type IN (รับ/เบิก/นับ)
 *
 * Features:
 *   - JSONP support for cross-origin GET
 *   - no-cors POST support
 *   - hidden-iframe upload (callUpload) — payload ใหญ่ + อ่าน response ได้
 *   - AI parse material log (Gemini)
 *   - BOQ early warning
 *   - 2-mode materials (COUNT + STATUS)
 * ============================================================
 */


// ============================================================
// 🔧 CONFIG (loaded from Script Properties)
// To change values: Apps Script editor → ⚙️ Project Settings →
//   Script Properties → Edit script properties
// Required keys: SHEETS_ID, GEMINI_API_KEY, ADMIN_PASSWORD, CLIENT_PASSWORD
// Optional keys: GEMINI_MODEL, GEMINI_VISION_MODEL (have defaults)
// ============================================================
function _readSecret_(key, fallback) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (v !== null && v !== '') return v;
  if (fallback !== undefined) return fallback;
  throw new Error('Missing Script Property: ' + key +
    ' — set it in Project Settings → Script Properties');
}

const SHEETS_ID           = _readSecret_('SHEETS_ID');
const GEMINI_API_KEY      = _readSecret_('GEMINI_API_KEY');
const GEMINI_MODEL        = _readSecret_('GEMINI_MODEL',        'gemini-2.5-flash');
const GEMINI_VISION_MODEL = _readSecret_('GEMINI_VISION_MODEL', 'gemini-2.5-flash');
const ADMIN_PASSWORD      = _readSecret_('ADMIN_PASSWORD');
const CLIENT_PASSWORD     = _readSecret_('CLIENT_PASSWORD');

// Google Drive folder structure
const DRIVE_ROOT_NAME = 'DSTR-PM-V2-Photos';
const PROJECT_KEY = 'bow-house';


// ============================================================
// 📋 SHEET NAMES
// ============================================================
const SHEET = {
  PROJECT:      '01_Project_Info',
  FF:           '02_FF_Items',
  TASKS:        '03_Tasks_Checklist',
  PAYMENTS:     '04_Payments',
  RISKS:        '05_Risks',
  TIMELINE:     '06_Timeline',
  DAILY:        '07_Daily_Reports',
  QUICK:        '08_Quick_Logs',
  CONTRACTORS:  '09_Contractors',
  SUPPLIERS:    '10_Suppliers',
  MATERIALS:    '11_Materials',
  TRANSACTIONS: '12_Material_Transactions',
  PHOTOS:       '13_Task_Photos',
  BOQ:          '14_BOQ_Items',
  VARIANCE:     '15_Variance_Reasons',
  MAT_PHOTOS:   '16_Material_Photos',
  ACTIVITY:     '17_Activity_Logs',
  TEAMS:        '21_Teams',
  CONTRACTS:    '22_Contracts',
  MILESTONES:   '23_Milestones',
  STAFF:        '24_Staff',
  CONTRACT_FILES: '25_ContractFiles',
  PAYMENT_SLIPS:  '26_PaymentSlips',
  PROJECT_STAFF:  '27_Project_Staff',
};


// ============================================================
// 🚪 ENTRY POINT
// ============================================================
function doGet(e)  { return handle(e, 'GET'); }
function doPost(e) { return handle(e, 'POST'); }

function handle(e, method) {
  const callback = (e && e.parameter) ? e.parameter.callback : null;
  // upload_token: มาจาก api.js callUpload() — ถ้ามี ต้องตอบเป็น HTML postMessage
  const uploadToken = (e && e.parameter) ? e.parameter.upload_token : null;
  let result;
  let action = 'ping';
  try {
    action = (e && e.parameter && e.parameter.action) || 'ping';
    const params = e.parameter || {};
    let body = {};
    if (method === 'POST' && e.postData && e.postData.contents) {
      // รองรับทั้ง JSON body (callPost/callWrite) และ form-urlencoded (callUpload)
      const ctype = (e.postData.type || '').toLowerCase();
      if (ctype.indexOf('application/json') !== -1 ||
          ctype.indexOf('text/plain') !== -1) {
        try { body = JSON.parse(e.postData.contents); } catch(err) { body = {}; }
      }
      // form-urlencoded → ค่าอยู่ใน e.parameter อยู่แล้ว ไม่ต้อง parse
    }
    const payload = Object.assign({}, params, body);
    const data = route(payload.action || action, payload);

    // 🔄 Legacy actions ไม่ wrap ใน {ok,data} เพื่อ backward compat กับ Dashboard เก่า
    // (api.js เดิม เรียก fetchAll() แล้วใช้ data.ffs ตรงๆ)
    const legacyActions = ['getAll', 'updateTask', 'updatePayment'];
    // 📤 Upload actions: หน้าเว็บอ่าน res.photo_url / res.url ตรงๆ (ไม่ผ่าน .data)
    //    จึงส่ง object ที่ endpoint คืนมาตรงๆ ไม่ห่อ
    const passthroughActions = ['upload_log_photo', 'upload_payment_slip', 'upload_contract_file'];
    if (legacyActions.indexOf(action) !== -1) {
      result = data;  // คืน object ตรงๆ ไม่ห่อ
    } else if (passthroughActions.indexOf(action) !== -1) {
      result = data;  // upload endpoints — ส่งตรง (มี ok อยู่แล้ว)
    } else {
      result = { ok: true, data: data };
    }
  } catch (err) {
    result = { ok: false, error: err.message, stack: String(err.stack || '') };
  }

  const json = JSON.stringify(result);

  // 📤 ตอบแบบ HTML postMessage — สำหรับ callUpload (hidden iframe)
  if (uploadToken) {
    return respondUpload_(uploadToken, json);
  }

  // ตอบแบบ JSONP — สำหรับ callRead
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  // ตอบ JSON ธรรมดา — สำหรับ callPost / callWrite
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * respondUpload_ — ตอบกลับ callUpload ด้วยหน้า HTML ที่ postMessage
 * ผลลัพธ์ JSON กลับไปหาหน้าเว็บจริง
 *
 * ⚠️ จุดที่ต้องระวัง: HtmlService ของ Apps Script ห่อ output ไว้ใน
 * iframe ซ้อนหลายชั้น (script.googleusercontent.com) ดังนั้น
 * window.parent = iframe ชั้นกลางของ Apps Script — ไม่ใช่หน้าเว็บเรา
 * → ต้อง postMessage ไล่ขึ้นทุกชั้น (parent, parent.parent, ..., top)
 *   ให้ข้อความทะลุไปถึงหน้า daily.html จริง
 *
 * @param {string} token - upload_token เพื่อให้ฝั่ง client จับคู่ถูก request
 * @param {string} jsonStr - JSON ผลลัพธ์ (stringify แล้ว)
 */
function respondUpload_(token, jsonStr) {
  // ฝัง payload แบบปลอดภัย — escape ปิด </script> และอักขระพิเศษ
  const safeToken = JSON.stringify(String(token));
  const safeJson  = jsonStr
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const html =
    '<!DOCTYPE html><html><body><script>' +
    '(function(){' +
    '  var payload;' +
    "  try { payload = JSON.parse('" + safeJson + "'); }" +
    '  catch(e){ payload = { ok:false, error:"parse failed" }; }' +
    '  var msg = { __dstrUpload: ' + safeToken + ', payload: payload };' +
    // ส่งข้อความไล่ขึ้นทุกชั้น window — เพราะ Apps Script ซ้อน iframe หลายชั้น
    '  var targets = [];' +
    '  try { var w = window; var guard = 0;' +
    '    while (w && guard < 10) {' +
    '      if (targets.indexOf(w) === -1) targets.push(w);' +
    '      if (w === w.parent) break;' +
    '      w = w.parent; guard++;' +
    '    }' +
    '    if (window.top && targets.indexOf(window.top) === -1) targets.push(window.top);' +
    '  } catch(e){}' +
    '  for (var i = 0; i < targets.length; i++) {' +
    '    try { targets[i].postMessage(msg, "*"); } catch(e){}' +
    '  }' +
    '})();' +
    '<\/script>OK<\/body><\/html>';

  return HtmlService
    .createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}


// ============================================================
// 🔐 ROLE-BASED ACCESS CONTROL (Client View MVP)
// ============================================================
// admin = ทุก action เดิม (backward compatible — frontend admin pages
// ไม่ส่ง role; ปฏิบัติเหมือน admin สำหรับ action เดิม)
// client = whitelist ที่ระบุชัดเจน — action นอก list จะถูกปฏิเสธ
// action ที่ขึ้นต้น 'client_' = ต้องมี role ที่ valid (ไม่ใช่ guest)
//
// หมายเหตุ: นี่คือ MVP shield ขั้นต่ำ — ยังไม่มี per-project password,
// token HMAC, audit log (ดองเฟส 2). คุณค่า: ปิดทาง client browser
// (ที่เห็น URL ใน DevTools) เรียก action admin โดยตรง
const CLIENT_ALLOWED_ACTIONS = {
  'client_get_overview': true,
  'client_get_photos': true,
  'client_get_milestones': true,
  'client_get_payments': true,
  // ping เปิดให้ทุก role เพื่อ health-check
  'ping': true,
  'login': true,
};

function _requireRole_(action, role) {
  // role: 'admin' | 'client' | undefined (no role = legacy admin compat)
  if (role === 'admin') return true; // admin ทำได้ทุก action
  if (role === 'client') {
    if (!CLIENT_ALLOWED_ACTIONS[action]) {
      throw new Error('Access denied: client role cannot call ' + action);
    }
    return true;
  }
  // ไม่มี role → backward compat กับ admin pages เดิม (ไม่ส่ง role)
  // แต่ block action ขึ้นต้น 'client_' กันใครก็ยิงได้แบบ guest
  if (String(action).indexOf('client_') === 0) {
    throw new Error('Access denied: authentication required for ' + action);
  }
  return true;
}


// ============================================================
// 🗺️ ROUTER
// ============================================================
function route(action, p) {
  // Role gate (Client View MVP) — ต้องอยู่ก่อน switch
  // p.role ส่งจาก frontend (admin หรือ client) — ถ้าไม่ส่ง = legacy admin compat
  _requireRole_(action, p && p.role);

  switch (action) {

    case 'ping': return { pong: true, time: new Date().toISOString() };

    case 'getAll': return getAll();
    case 'updateTask': return updateTask(p);
    case 'updatePayment': return updatePayment(p);

    case 'login': return login(p.password);

    case 'get_ff_list': return getFFList();
    case 'get_tasks': return getTasksAsObjects(p.ff_code);

    case 'get_contractors': return getContractors(p.role);
    case 'create_contractor': return createContractor(p);
    case 'detect_unknowns': return detectUnknowns(p);

    // 👷 TEAM SYSTEM
    case 'get_teams_bundle': return getTeamsBundle(p);
    case 'get_teams': return getTeams(p);
    case 'team_checkin': return teamCheckin(p);
    case 'create_team': return createTeam(p);
    case 'update_team': return updateTeam(p);
    case 'create_contract': return createContract(p);
    case 'update_contract': return updateContract(p);
    case 'update_milestone': return updateMilestone(p);
    case 'create_milestone': return createMilestone(p);
    case 'create_staff': return createStaff(p);
    case 'update_staff': return updateStaff(p);
    case 'upload_contract_file': return uploadContractFile(p);
    case 'get_contract_files': return getContractFiles(p);
    case 'delete_contract_file': return deleteContractFile(p);
    case 'upload_log_photo': return uploadLogPhoto(p);
    case 'upload_payment_slip': return uploadPaymentSlip(p);
    case 'delete_payment_slip': return deletePaymentSlip(p);

    case 'get_suppliers': return getAllRows(SHEET.SUPPLIERS);
    case 'create_supplier': return createSupplier(p);

    case 'get_materials': return getMaterials(p.mode, p.category);
    case 'get_material': return getMaterial(p.mat_id);
    case 'create_material': return createMaterial(p);
    case 'update_material': return updateMaterial(p);
    case 'deactivate_material': return deactivateMaterial(p);
    case 'delete_material': return deleteMaterial(p);

    case 'get_transactions': return getTransactions(p.mat_id, p.type, p.ff_code);
    case 'receive_material': return receiveMaterial(p);
    case 'withdraw_material': return withdrawMaterial(p);
    case 'count_material': return countMaterial(p);

    case 'parse_material_log': return parseMaterialLog(p.text);
    case 'confirm_material_log': return confirmMaterialLog(p.items);
    case 'check_stock_for_items': return checkStockForItems(p);

    case 'get_boq': return getBOQ(p.ff_code);
    case 'create_boq': return createBOQ(p);
    case 'check_boq_status': return checkBoqStatus(p.ff_code);

    case 'get_ai_alerts': return getAiAlerts();

    case 'get_daily_reports': return getAllRows(SHEET.DAILY);
    case 'get_daily_report': return getDailyReport(p);
    case 'create_daily': return createDaily(p);
    case 'auto_detect_daily': return autoDetectDaily(p);
    case 'generate_daily_summary': return generateDailySummary(p);
    case 'delete_daily': return deleteDaily(p);
    case 'add_quick_log': return addQuickLog(p);
    case 'ai_summary': return aiSummary(p.report_id);

    case 'get_photos': return getAllRows(SHEET.PHOTOS);
    case 'add_photo': return addPhoto(p);

    case 'upload_photo': return uploadPhoto(p);
    case 'get_material_photos': return getMaterialPhotos(p.mat_id);
    case 'get_task_photos': return getTaskPhotos(p.task_id);
    case 'get_transaction_photos': return getTransactionPhotos(p.trans_id);
    case 'delete_photo': return deletePhoto(p.photo_id);
    case 'delete_task_photo': return deleteTaskPhoto(p.photo_id);
    case 'scan_bill': return scanBill(p);
    case 'confirm_bill_items': return confirmBillItems(p);

    case 'add_activity_log': return addActivityLog(p);
    case 'get_activity_feed': return getActivityFeed(p);
    case 'get_material_transactions': return getMaterialTransactions(p);
    case 'delete_activity_log': return deleteActivityLog(p.log_id);
    case 'untick_task_from_log': return untickTaskFromLog(p);
    case 'generate_daily_summary_v2': return generateDailySummaryV2(p);
    case 'save_ai_summary': return saveAiSummary(p);
    case 'get_saved_summary': return getSavedSummary(p);
    case 'parse_activity_text': return parseActivityText(p);
    case 'suggest_task_from_log': return suggestTaskFromLog(p);
    case 'confirm_task_tick': return confirmTaskTick(p);
    case 'get_today_stats': return getTodayStats(p);
    case 'get_daily_bundle': return getDailyBundle(p);

    // 👥 Project Staff — assign คนในบริษัทเข้าโปรเจค (27_Project_Staff)
    case 'get_all_staff': return getAllStaff();
    case 'get_project_staff': return getProjectStaff(p.project_id);
    case 'assign_project_staff': return assignProjectStaff(p);
    case 'unassign_project_staff': return unassignProjectStaff(p.assignment_id);

    // 🏗️ PROJECTS — multi-project registry (Phase A) — ดู projects_patch.gs
    case 'get_projects': return getProjects_();
    case 'create_project': return createProject_(p);
    case '_phase_a_fix': return phaseAFix_();  // เก็บกวาดข้อมูล test smoke + seed bow-house (idempotent)

    // 🪟 CLIENT VIEW — read-only routes with field whitelist
    // (role gate ใน _requireRole_ ด้านบน บังคับให้ p.role='client' หรือ 'admin')
    case 'client_get_overview':   return clientGetOverview(p);
    case 'client_get_photos':     return clientGetPhotos(p);
    case 'client_get_milestones': return clientGetMilestones(p);
    case 'client_get_payments':   return clientGetPayments(p);

    default:
      throw new Error('Unknown action: ' + action);
  }
}


// ============================================================
// 🛠️ CORE HELPERS
// ============================================================
function getSheet(name) {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) {
    // Fallback to fuzzy finder (handles imported sheets with name variations)
    try { sh = findSheet_(ss, name); } catch (e) {}
  }
  if (!sh) throw new Error('Sheet not found: ' + name);
  return sh;
}

function getAllRows(sheetName) {
  const sh = getSheet(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  const data = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = data[0];
  const result = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const hasData = row.some(v => v !== null && v !== '' && v !== undefined);
    if (!hasData) continue;
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i]; });
    result.push(obj);
  }
  return result;
}

function appendRow(sheetName, obj) {
  const sh = getSheet(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const row = headers.map(h => (h && obj[h] !== undefined ? obj[h] : ''));
  sh.appendRow(row);
  return obj;
}

function findRowByCol(sheetName, colName, value) {
  const sh = getSheet(sheetName);
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const data = sh.getRange(1, 1, lastRow, sh.getLastColumn()).getValues();
  const headers = data[0];
  const colIdx = headers.indexOf(colName);
  if (colIdx === -1) throw new Error('Column not found: ' + colName + ' in ' + sheetName);
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][colIdx]) === String(value)) {
      return { rowIndex: r + 1, headers, values: data[r] };
    }
  }
  return null;
}

function updateRowByCol(sheetName, colName, value, updates) {
  const sh = getSheet(sheetName);
  const found = findRowByCol(sheetName, colName, value);
  if (!found) throw new Error('Row not found: ' + colName + '=' + value);
  Object.keys(updates).forEach(k => {
    const colIdx = found.headers.indexOf(k);
    if (colIdx !== -1) {
      sh.getRange(found.rowIndex, colIdx + 1).setValue(updates[k]);
    }
  });
  return true;
}

/**
 * ensureColumn_ — สร้าง column ใหม่ถ้ายังไม่มีใน sheet
 * กันปัญหา updateRowByCol ข้ามเงียบเมื่อ column หาย
 */
function ensureColumn_(sheetName, colName) {
  const sh = getSheet(sheetName);
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  if (headers.indexOf(colName) !== -1) return;  // มีอยู่แล้ว
  // เพิ่ม column ใหม่ท้ายสุด
  sh.getRange(1, lastCol + 1).setValue(colName);
}

/**
 * ensureMaterialColumns_ — M2: การันตี 11_Materials มี column spec + size
 * idempotent: ใช้ ensureColumn_ ซึ่งเช็ค headers.indexOf ก่อนเพิ่ม
 * รันซ้ำได้ ไม่เพิ่มซ้ำ ไม่ทับ/ลบ column เดิม (เพิ่มต่อท้าย header เท่านั้น)
 */
function ensureMaterialColumns_() {
  ensureColumn_(SHEET.MATERIALS, 'spec');
  ensureColumn_(SHEET.MATERIALS, 'size');
}

/**
 * ensureTaskPhotoColumns_ — Client View MVP: การันตี 13_Task_Photos มี
 * column client_visible (boolean flag สำหรับ curated photo gallery ฝั่งลูกค้า)
 * idempotent: ใช้ ensureColumn_ ซึ่งเช็ค headers.indexOf ก่อนเพิ่ม
 * default ของ row เดิม = '' (falsy) → filter `client_visible === true` ปลอดภัย
 */
function ensureTaskPhotoColumns_() {
  ensureColumn_(SHEET.PHOTOS, 'client_visible');
}

function generateId(prefix, sheetName, colName) {
  const rows = getAllRows(sheetName);
  let maxNum = 0;
  rows.forEach(r => {
    const id = String(r[colName] || '');
    const m = id.match(/(\d+)$/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  });
  return prefix + String(maxNum + 1).padStart(3, '0');
}

function nowStr() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd HH:mm:ss');
}

function todayStr() {
  return Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyy-MM-dd');
}


// ============================================================
// 🔄 LEGACY COMPATIBILITY (Old Dashboard)
// ============================================================

/**
 * รวมข้อมูลทุก sheet สำหรับ Dashboard เก่า
 * Map field names ให้ตรงกับที่ Dashboard ใช้ (camelCase)
 */
function getAll() {
  return {
    ffs: getFFList(),
    tasks: getTasksAsObjects(),
    payments: getPaymentsAsObjects(),
    risks: getRisksAsObjects(),
    contractors: getContractors(),
    materials: getMaterials(),
  };
}

function getFFList() {
  const rows = getAllRows(SHEET.FF);
  return rows.map(r => ({
    code: r['FF Code'] || '',
    bfCode: r['BF Code'] || '',
    name: r['Item Name'] || '',
    area: r['Area / Room'] || '',
    zone: r['Zone'] || '',
    price: Number(r['Price (THB)'] || 0),
    scopeType: r['Scope Type'] || '',
    status: r['Status'] || '',
    riskLevel: r['Risk Level'] || '',
    notes: r['Notes'] || '',
  }));
}

function getTasksAsObjects(ffCode) {
  const rows = getAllRows(SHEET.TASKS);

  // 📷 อ่าน 13_Task_Photos ครั้งเดียว → map {task_id: count} กัน N+1
  // ถ้า sheet ยังไม่มี/ว่าง ต้องไม่ throw (default count = 0)
  const photoCountMap = {};
  try {
    getAllRows(SHEET.PHOTOS).forEach(pr => {
      const tid = String(pr.task_id || '');
      if (!tid) return;
      photoCountMap[tid] = (photoCountMap[tid] || 0) + 1;
    });
  } catch (e) {
    // sheet หาย/อ่านไม่ได้ → ปล่อย count = 0 ทั้งหมด
  }

  const mapped = rows.map(r => {
    const phase = String(r['Phase'] || '');
    let phaseKey = '';
    if (phase.indexOf('1') >= 0) phaseKey = 'p1';
    else if (phase.indexOf('2') >= 0) phaseKey = 'p2';
    else if (phase.indexOf('3') >= 0) phaseKey = 'p3';
    else if (phase.indexOf('4') >= 0) phaseKey = 'p4';
    return {
      id: r['Task ID'] || '',
      ffCode: r['FF Code'] || '',
      zone: r['Zone'] || '',
      phase: phaseKey,
      phaseRaw: phase,
      name: r['Task Name'] || '',
      status: r['Status'] || '',
      startDate: formatDateValue(r['Start Date']),
      endDate: formatDateValue(r['End Date']),
      doneDate: formatDateValue(r['Done Date']),
      personInCharge: r['Person In Charge'] || '',
      notes: r['Notes'] || '',
      photoCount: photoCountMap[String(r['Task ID'] || '')] || 0,
    };
  });
  return ffCode ? mapped.filter(t => t.ffCode === ffCode) : mapped;
}

function getPaymentsAsObjects() {
  const rows = getAllRows(SHEET.PAYMENTS);
  return rows
    .filter(r => {
      // กรอง summary rows (GRAND TOTAL, PAID, REMAINING) ออก
      const id = String(r['Payment ID'] || '').trim();
      const milestone = String(r['Milestone'] || '').trim().toUpperCase();
      if (!id) return false;
      if (milestone === 'GRAND TOTAL') return false;
      if (milestone === 'PAID') return false;
      if (milestone === 'REMAINING') return false;
      if (milestone === 'TOTAL') return false;
      return true;
    })
    .map(r => {
      // Normalize milestone: "งวด 1 - มัดจำ" → "งวด 1"
      const rawMilestone = String(r['Milestone'] || '');
      let milestone = rawMilestone;
      const match = rawMilestone.match(/งวด\s*[1234]/);
      if (match) milestone = match[0].replace(/\s+/g, ' ').trim();

      return {
        id: r['Payment ID'] || '',
        milestone: milestone,
        milestoneRaw: rawMilestone,
        sub: r['Sub-Item'] || '',
        zone: r['Zone'] || '',
        pct: r['% of Total'] || '',
        amount: Number(r['Amount (THB)'] || 0),
        dueDate: formatDateValue(r['Due Date']),
        status: r['Status'] || '',
        paidDate: formatDateValue(r['Paid Date']),
        receipt: r['Receipt No.'] || '',
        notes: r['Notes'] || '',
      };
    });
}

function getRisksAsObjects() {
  const rows = getAllRows(SHEET.RISKS);
  return rows.map(r => ({
    id: r['Risk ID'] || '',
    cat: r['Category'] || '',
    desc: r['Description'] || '',
    affected: r['Affected FF'] || '',
    sev: r['Severity'] || '',
    likelihood: r['Likelihood'] || '',
    impact: r['Impact'] || '',
    mitigation: r['Mitigation Plan'] || '',
    status: r['Status'] || '',
    owner: r['Owner'] || '',
    identified: formatDateValue(r['Date Identified']),
  }));
}

function formatDateValue(v) {
  if (!v) return '';
  if (v instanceof Date) {
    return Utilities.formatDate(v, 'Asia/Bangkok', 'yyyy-MM-dd');
  }
  return String(v);
}

/**
 * Legacy: updateTask(taskId, status, doneDate)
 */
function updateTask(p) {
  const updates = { 'Status': p.status };
  if (p.status === 'Done') {
    updates['Done Date'] = p.doneDate || todayStr();
  } else if (p.status === 'Not Started') {
    updates['Done Date'] = '';
  }
  updateRowByCol(SHEET.TASKS, 'Task ID', p.taskId, updates);

  // 🔗 Auto-log to activity feed
  try {
    const taskRow = getAllRows(SHEET.TASKS).find(t => t['Task ID'] === p.taskId);
    if (taskRow) hookTaskDone_(taskRow, p.status);
  } catch (e) {}

  return { ok: true, taskId: p.taskId, status: p.status };
}

/**
 * Legacy: updatePayment(paymentId, status, receipt)
 */
function updatePayment(p) {
  const updates = { 'Status': p.status };
  if (p.status === 'Paid') {
    updates['Paid Date'] = todayStr();
  } else if (p.status === 'Pending') {
    updates['Paid Date'] = '';
  }
  if (p.receipt !== undefined && p.receipt !== '') {
    updates['Receipt No.'] = p.receipt;
  }
  updateRowByCol(SHEET.PAYMENTS, 'Payment ID', p.paymentId, updates);
  return { ok: true, paymentId: p.paymentId, status: p.status };
}


// ============================================================
// 🔐 AUTH
// ============================================================
function login(password) {
  if (password === ADMIN_PASSWORD)  return { role: 'admin',  authenticated: true };
  if (password === CLIENT_PASSWORD) return { role: 'client', authenticated: true };
  throw new Error('Invalid password');
}


// ============================================================
// 👷 CONTRACTORS
// ============================================================
function getContractors(role) {
  let rows = getAllRows(SHEET.CONTRACTORS).filter(c =>
    c.active === true || c.active === 'TRUE' || c.active === 'true');
  if (role) {
    const roles = String(role).split(',').map(r => r.trim());
    rows = rows.filter(c => roles.indexOf(c.role) !== -1);
  }
  return rows;
}

function createContractor(p) {
  const id = generateId('C', SHEET.CONTRACTORS, 'id');
  const row = {
    id,
    name: p.name,
    type: p.type || '',
    role: p.role || 'CONTRACTOR',
    phone: p.phone || '',
    payment_type: p.payment_type || 'per_job',
    notes: p.notes || '',
    active: true,
    created_at: todayStr(),
  };
  appendRow(SHEET.CONTRACTORS, row);
  return row;
}


// ============================================================
// 🏪 SUPPLIERS
// ============================================================
function createSupplier(p) {
  const id = generateId('S', SHEET.SUPPLIERS, 'id');
  const row = {
    id,
    name: p.name,
    category: p.category || '',
    contact_person: p.contact_person || '',
    phone: p.phone || '',
    address: p.address || '',
    payment_terms: p.payment_terms || '',
    notes: p.notes || '',
    active: true,
    created_at: todayStr(),
  };
  appendRow(SHEET.SUPPLIERS, row);
  return row;
}


// ============================================================
// 📦 MATERIALS
// ============================================================
function getMaterials(mode, category) {
  ensureMaterialColumns_();  // M2: การันตี header มี spec/size (idempotent)
  let rows = getAllRows(SHEET.MATERIALS).filter(m =>
    m.active === true || m.active === 'TRUE' || m.active === 'true');
  if (mode) rows = rows.filter(m => m.tracking_mode === mode);
  if (category) rows = rows.filter(m => m.category === category);
  return rows;
}

function getMaterial(mat_id) {
  const found = findRowByCol(SHEET.MATERIALS, 'id', mat_id);
  if (!found) throw new Error('Material not found: ' + mat_id);
  const obj = {};
  found.headers.forEach((h, i) => { obj[h] = found.values[i]; });
  obj.transactions = getTransactions(mat_id);
  return obj;
}

function createMaterial(p) {
  ensureMaterialColumns_();  // M2: การันตี column spec/size ก่อนเขียน
  const id = generateId('M', SHEET.MATERIALS, 'id');
  const row = {
    id,
    name: p.name,
    unit: p.unit,
    category: p.category || '',
    spec: p.spec || '',
    size: p.size || '',
    default_price: Number(p.default_price || 0),
    default_supplier_id: p.default_supplier_id || '',  // free text optional ไม่ผูก FK 10_Suppliers
    linked_ffs: p.linked_ffs || '',
    min_stock_alert: Number(p.min_stock_alert || 0),
    current_stock: Number(p.current_stock || 0),
    notes: p.notes || '',
    active: true,
    created_at: todayStr(),
    tracking_mode: p.tracking_mode || 'COUNT',
    last_status_update: p.tracking_mode === 'STATUS' ? todayStr() : '',
  };
  appendRow(SHEET.MATERIALS, row);
  return row;
}

function updateMaterial(p) {
  ensureMaterialColumns_();  // M2: การันตี column spec/size ก่อน update
  const updates = {};
  ['name','unit','category','spec','size','default_price','default_supplier_id',
   'linked_ffs','min_stock_alert','notes','tracking_mode','active'].forEach(k => {
    if (p[k] !== undefined) updates[k] = p[k];
  });
  updateRowByCol(SHEET.MATERIALS, 'id', p.mat_id, updates);
  return { mat_id: p.mat_id, updated: true };
}

/**
 * deactivateMaterial — M4: ลบแบบ soft (default ที่ปลอดภัย)
 * set active=false ผ่าน updateRowByCol — ไม่แตะ transaction/stock
 * params: p.material_id
 */
function deactivateMaterial(p) {
  const mat = findRowByCol(SHEET.MATERIALS, 'id', p.material_id);
  if (!mat) throw new Error('Material not found: ' + p.material_id);
  updateRowByCol(SHEET.MATERIALS, 'id', p.material_id, { active: false });
  return { deactivated: p.material_id };
}

/**
 * deleteMaterial — M4: ลบถาวร (hard) เฉพาะเมื่อไม่มี transaction อ้างถึง
 * ถ้ามี transaction ใน 12_Material_Transactions อ้าง material_id นั้น → ปฏิเสธ
 * แนะนำให้ใช้ deactivate แทน (กันข้อมูลธุรกรรมกำพร้า)
 * params: p.material_id
 */
function deleteMaterial(p) {
  const found = findRowByCol(SHEET.MATERIALS, 'id', p.material_id);
  if (!found) throw new Error('Material not found: ' + p.material_id);
  const txns = getAllRows(SHEET.TRANSACTIONS)
    .filter(t => String(t.material_id) === String(p.material_id));
  if (txns.length > 0) {
    throw new Error('ลบถาวรไม่ได้: วัสดุนี้มีธุรกรรมอ้างถึง ' + txns.length +
      ' รายการ กรุณาใช้ "ปิดใช้งาน" (deactivate_material) แทน');
  }
  getSheet(SHEET.MATERIALS).deleteRow(found.rowIndex);
  return { deleted: p.material_id };
}


// ============================================================
// 💰 MATERIAL TRANSACTIONS
// ============================================================
function getTransactions(mat_id, type, ff_code) {
  let rows = getAllRows(SHEET.TRANSACTIONS);
  if (mat_id)  rows = rows.filter(t => t.material_id === mat_id);
  if (type)    rows = rows.filter(t => t.type === type);
  if (ff_code) rows = rows.filter(t => t.ff_code === ff_code);
  return rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

function receiveMaterial(p) {
  const mat = findRowByCol(SHEET.MATERIALS, 'id', p.material_id);
  if (!mat) throw new Error('Material not found: ' + p.material_id);
  const matObj = {};
  mat.headers.forEach((h, i) => { matObj[h] = mat.values[i]; });

  const qty = Number(p.quantity || 0);
  const isStatus = matObj.tracking_mode === 'STATUS';
  const unitPrice = Number(p.unit_price || 0);

  let newStock;
  if (isStatus) {
    // M1: วัสดุโหมด STATUS — ใช้สถานะที่ผู้ใช้ระบุ (0-3) ถ้าส่ง p.new_stock มา
    // (สอดคล้อง countMaterial). เดิม force = 3 เสมอ ทิ้งค่าที่กรอกเงียบ ๆ →
    // ข้อมูลผิดทุกครั้งที่รับวัสดุ STATUS. ถ้าไม่ส่งมา default = เต็ม(3) กัน regression
    const hasStatus = !(p.new_stock === '' || p.new_stock === undefined || p.new_stock === null);
    newStock = hasStatus ? Math.max(0, Math.min(3, Number(p.new_stock))) : 3;
  } else {
    newStock = Number(matObj.current_stock || 0) + qty;
  }

  const id = generateId('MT', SHEET.TRANSACTIONS, 'id');
  const txn = {
    id,
    date: p.date || todayStr(),
    type: 'รับ',
    material_id: p.material_id,
    quantity: qty,
    unit_price: unitPrice,
    total_value: qty * unitPrice,
    supplier_id: p.supplier_id || '',
    contractor_id: '',
    ff_code: p.ff_code || '',
    report_id: p.report_id || '',
    remaining_after: newStock,
    receipt_no: p.receipt_no || '',
    notes: p.notes || '',
    created_by: p.created_by || 'ST02',
    created_at: nowStr(),
  };
  appendRow(SHEET.TRANSACTIONS, txn);

  const updates = { current_stock: newStock };
  if (isStatus) updates.last_status_update = todayStr();
  if (unitPrice > 0) updates.default_price = unitPrice;
  if (p.supplier_id) updates.default_supplier_id = p.supplier_id;
  updateRowByCol(SHEET.MATERIALS, 'id', p.material_id, updates);

  // 🔗 Auto-log
  hookReceive_(p.material_id, qty, matObj.unit, matObj.name, p.receipt_no);

  return { transaction: txn, new_stock: newStock };
}

function withdrawMaterial(p) {
  const mat = findRowByCol(SHEET.MATERIALS, 'id', p.material_id);
  if (!mat) throw new Error('Material not found: ' + p.material_id);
  const matObj = {};
  mat.headers.forEach((h, i) => { matObj[h] = mat.values[i]; });

  const qty = Number(p.quantity || 0);
  const isStatus = matObj.tracking_mode === 'STATUS';
  const currentStock = Number(matObj.current_stock || 0);

  let newStock = currentStock;
  if (!isStatus) {
    if (qty > currentStock && !p.force) {
      throw new Error('เบิกเกินสต๊อก! เหลือ ' + currentStock + ' ' + matObj.unit);
    }
    newStock = currentStock - qty;
  }

  let isOverBoq = false;
  let boqInfo = null;
  if (!isStatus && p.ff_code) {
    boqInfo = checkBoqForWithdrawal(p.material_id, p.ff_code, qty);
    isOverBoq = boqInfo.is_over;
  }

  const id = generateId('MT', SHEET.TRANSACTIONS, 'id');
  const txn = {
    id,
    date: p.date || todayStr(),
    type: 'เบิก',
    material_id: p.material_id,
    quantity: qty,
    unit_price: matObj.default_price || 0,
    total_value: qty * Number(matObj.default_price || 0),
    supplier_id: '',
    contractor_id: p.contractor_id || '',
    ff_code: p.ff_code || '',
    report_id: p.report_id || '',
    remaining_after: newStock,
    receipt_no: '',
    notes: (p.notes || '') + (isOverBoq ? ' [⚠️ เกิน BOQ]' : ''),
    created_by: p.created_by || 'ST02',
    created_at: nowStr(),
  };
  appendRow(SHEET.TRANSACTIONS, txn);

  if (!isStatus) {
    updateRowByCol(SHEET.MATERIALS, 'id', p.material_id, { current_stock: newStock });
  }

  // 🔗 Auto-log: lookup contractor name (09_Contractors → fallback 21_Teams)
  //    09_Contractors ตายแล้ว (data ว่าง) แต่ frontend ส่ง team_id (T01/T02) ใน
  //    field contractor_id เพราะใช้ master ทีมแทน (ตาม HUB doc ส่วนที่ 3)
  //    → lookup CONTRACTORS ก่อน, ถ้าไม่เจอลอง TEAMS ต่อ → log แสดงชื่อทีมเต็ม
  let ctrName = '';
  if (p.contractor_id) {
    try {
      const c = getAllRows(SHEET.CONTRACTORS).find(x => x.id === p.contractor_id);
      if (c) ctrName = c.name;
      if (!ctrName) {
        const t = getAllRows(SHEET.TEAMS).find(x => x.team_id === p.contractor_id);
        if (t) ctrName = t.name;
      }
    } catch (e) {}
  }
  hookWithdraw_(p.material_id, qty, matObj.unit, matObj.name, p.contractor_id, ctrName, p.ff_code);

  return {
    transaction: txn,
    new_stock: newStock,
    is_over_boq: isOverBoq,
    boq_info: boqInfo,
    requires_status_update: isStatus,
  };
}

function countMaterial(p) {
  const mat = findRowByCol(SHEET.MATERIALS, 'id', p.material_id);
  if (!mat) throw new Error('Material not found: ' + p.material_id);
  const matObj = {};
  mat.headers.forEach((h, i) => { matObj[h] = mat.values[i]; });

  const isStatus = matObj.tracking_mode === 'STATUS';
  const oldStock = Number(matObj.current_stock || 0);
  const newStock = Number(p.new_stock || 0);
  const variance = newStock - oldStock;

  const id = generateId('MT', SHEET.TRANSACTIONS, 'id');
  const txn = {
    id,
    date: p.date || todayStr(),
    type: 'นับ',
    material_id: p.material_id,
    quantity: variance,
    unit_price: matObj.default_price || 0,
    total_value: 0,
    supplier_id: '',
    contractor_id: '',
    ff_code: '',
    report_id: '',
    remaining_after: newStock,
    receipt_no: '',
    notes: (p.notes || '') + ' [trigger: ' + (p.trigger_source || 'manual') + ']',
    created_by: p.created_by || 'ST02',
    created_at: nowStr(),
  };
  appendRow(SHEET.TRANSACTIONS, txn);

  const updates = { current_stock: newStock };
  if (isStatus) updates.last_status_update = todayStr();
  updateRowByCol(SHEET.MATERIALS, 'id', p.material_id, updates);

  // 🔗 Auto-log
  hookCount_(p.material_id, newStock, matObj.name, matObj.unit, matObj.tracking_mode);

  return { transaction: txn, old_stock: oldStock, new_stock: newStock, variance };
}


// ============================================================
// 🤖 AI MATERIAL LOG PARSER
// ============================================================

/**
 * รับข้อความ Quick Log → ส่งให้ Gemini แปลงเป็น structured data
 * Return: { items: [...], needs_clarification: [...] }
 */
function parseMaterialLog(text) {
  if (!text || !text.trim()) {
    throw new Error('ข้อความว่างเปล่า');
  }

  const materials = getMaterials();
  const contractors = getContractors().filter(c => c.role === 'CONTRACTOR' || c.role === 'FOREMAN');
  const ffs = getFFList();

  const matList = materials.map(m =>
    `- ${m.id}: ${m.name} (หน่วย: ${m.unit}, สต๊อก: ${m.current_stock}, mode: ${m.tracking_mode})`
  ).join('\n');

  const ctList = contractors.map(c =>
    `- ${c.id}: ${c.name} (${c.role}, ${c.type || '-'})`
  ).join('\n');

  const ffList = ffs.map(f => `- ${f.code}: ${f.name}`).join('\n');

  const prompt =
'คุณคือ AI ช่วยจัดการสต๊อกวัสดุก่อสร้าง โฟร์แมนจะส่งข้อความสั้นๆ มา ' +
'หน้าที่ของคุณคือแปลงเป็นรายการ transactions (รับ/เบิก/นับ)\n\n' +
'## รายการ Materials ที่มีอยู่:\n' + matList + '\n\n' +
'## รายชื่อ Contractors:\n' + ctList + '\n\n' +
'## รายการ FF Items:\n' + ffList + '\n\n' +
'## ข้อความจากโฟร์แมน:\n"' + text + '"\n\n' +
'## คำสั่ง:\n' +
'1. แยกข้อความเป็น transactions แต่ละรายการ\n' +
'2. แต่ละรายการต้องระบุ: type (รับ/เบิก/นับ), material_id, quantity\n' +
'3. ถ้าเป็น "เบิก" ต้องระบุ contractor_id และ ff_code ด้วย\n' +
'4. ถ้าข้อมูลไม่ครบหรือคลุมเครือ ให้ใส่ใน needs_clarification พร้อม options\n' +
'5. fuzzy match ชื่อ material (เช่น "ไม้ 18 มิล" = M003 HMR-V70 18 มิล)\n' +
'6. fuzzy match ชื่อคน (เช่น "สากล" = C001)\n\n' +
'## Response format (JSON เท่านั้น ไม่ต้องมี markdown หรือคำอธิบาย):\n' +
'{\n' +
'  "items": [\n' +
'    {\n' +
'      "type": "เบิก",\n' +
'      "material_id": "M003",\n' +
'      "material_name": "HMR-V70 18 มิล",\n' +
'      "quantity": 5,\n' +
'      "unit": "แผ่น",\n' +
'      "contractor_id": "C001",\n' +
'      "contractor_name": "สากล พาสี",\n' +
'      "ff_code": "F-03",\n' +
'      "confidence": "high",\n' +
'      "raw_text": "สากลเบิกไม้ 18 มิล 5 แผ่น F-03",\n' +
'      "missing": []\n' +
'    }\n' +
'  ],\n' +
'  "needs_clarification": [\n' +
'    {\n' +
'      "raw_text": "เบิกสกรู 2 กล่อง",\n' +
'      "issue": "ไม่ระบุขนาดสกรู",\n' +
'      "options": [\n' +
'        {"id": "M018", "name": "สกรู 1 นิ้ว"},\n' +
'        {"id": "M019", "name": "สกรู 1-1/2 นิ้ว"}\n' +
'      ],\n' +
'      "field": "material_id"\n' +
'    }\n' +
'  ]\n' +
'}\n\n' +
'## ระดับ confidence:\n' +
'- "high": ข้อมูลครบทุก field\n' +
'- "medium": ขาด ff_code (ใช้สำหรับเบิก) → ใส่ "ff_code" ใน missing array\n' +
'- "low": ขาดข้อมูลสำคัญ → ใส่ใน needs_clarification แทน items';

  const response = callGemini(prompt);

  try {
    let cleaned = response.trim();
    cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned);
    return {
      raw_input: text,
      items: parsed.items || [],
      needs_clarification: parsed.needs_clarification || [],
      ai_raw: response.substring(0, 500),
    };
  } catch (e) {
    return {
      raw_input: text,
      items: [],
      needs_clarification: [{
        raw_text: text,
        issue: 'AI ไม่สามารถ parse ข้อความได้',
        options: [],
        field: 'unknown',
      }],
      error: 'parse_error',
      ai_raw: response.substring(0, 500),
    };
  }
}

/**
 * ยืนยัน items ที่ AI parse ได้ → insert ลง transactions
 */
function confirmMaterialLog(itemsJson) {
  let items;
  if (typeof itemsJson === 'string') {
    items = JSON.parse(itemsJson);
  } else {
    items = itemsJson;
  }

  const results = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      let result;
      if (item.type === 'รับ') {
        result = receiveMaterial({
          material_id: item.material_id,
          quantity: item.quantity,
          unit_price: item.unit_price || 0,
          supplier_id: item.supplier_id || '',
          receipt_no: item.receipt_no || '',
          notes: '[Quick Log] ' + (item.raw_text || ''),
          created_by: item.created_by || 'ST02',
        });
      } else if (item.type === 'เบิก') {
        result = withdrawMaterial({
          material_id: item.material_id,
          quantity: item.quantity,
          contractor_id: item.contractor_id,
          ff_code: item.ff_code || '',
          notes: '[Quick Log] ' + (item.raw_text || ''),
          force: item.force || false,
          created_by: item.created_by || 'ST02',
        });
      } else if (item.type === 'นับ') {
        result = countMaterial({
          material_id: item.material_id,
          new_stock: item.quantity,
          notes: '[Quick Log] ' + (item.raw_text || ''),
          trigger_source: 'quick_log',
          created_by: item.created_by || 'ST02',
        });
      } else {
        throw new Error('Unknown type: ' + item.type);
      }
      results.push({ ok: true, item, result });
    } catch (err) {
      results.push({ ok: false, item, error: err.message });
    }
  }
  return { results, total: items.length, success: results.filter(r => r.ok).length };
}


// ============================================================
// 📋 BOQ
// ============================================================
function getBOQ(ff_code) {
  const rows = getAllRows(SHEET.BOQ);
  return ff_code ? rows.filter(b => b.ff_code === ff_code) : rows;
}

function createBOQ(p) {
  const id = generateId('BOQ', SHEET.BOQ, 'id');
  const planned_quantity = Number(p.planned_quantity || 0);
  const planned_unit_price = Number(p.planned_unit_price || 0);
  const row = {
    id,
    ff_code: p.ff_code,
    material_id: p.material_id,
    planned_quantity,
    unit: p.unit || '',
    planned_unit_price,
    planned_total: planned_quantity * planned_unit_price,
    notes: p.notes || '',
    created_by: p.created_by || 'ST03',
    created_at: todayStr(),
  };
  appendRow(SHEET.BOQ, row);
  return row;
}

function checkBoqForWithdrawal(mat_id, ff_code, withdraw_qty) {
  const boq = getAllRows(SHEET.BOQ).find(b =>
    b.material_id === mat_id && b.ff_code === ff_code);
  if (!boq) return { has_boq: false, is_over: false };

  const withdrawn = getAllRows(SHEET.TRANSACTIONS)
    .filter(t => t.type === 'เบิก' && t.material_id === mat_id && t.ff_code === ff_code)
    .reduce((sum, t) => sum + Number(t.quantity || 0), 0);

  const total_after = withdrawn + Number(withdraw_qty);
  const planned = Number(boq.planned_quantity || 0);
  const is_over = total_after > planned;

  return {
    has_boq: true,
    is_over,
    planned,
    withdrawn,
    total_after,
    overage: Math.max(0, total_after - planned),
  };
}

function checkBoqStatus(ff_code) {
  const boqs = getBOQ(ff_code);
  return boqs.map(boq => {
    const withdrawn = getAllRows(SHEET.TRANSACTIONS)
      .filter(t => t.type === 'เบิก' && t.material_id === boq.material_id && t.ff_code === ff_code)
      .reduce((sum, t) => sum + Number(t.quantity || 0), 0);
    const planned = Number(boq.planned_quantity || 0);
    return {
      boq_id: boq.id,
      material_id: boq.material_id,
      planned,
      withdrawn,
      remaining: planned - withdrawn,
      pct_used: planned > 0 ? Math.round((withdrawn / planned) * 100) : 0,
      is_over: withdrawn > planned,
    };
  });
}


// ============================================================
// 🤖 AI HYBRID TRIGGERS
// ============================================================
function getAiAlerts() {
  const alerts = [];
  alerts.push.apply(alerts, getFrequentWithdrawalAlerts());
  alerts.push.apply(alerts, getStaleStatusAlerts());
  alerts.push.apply(alerts, getLowStockAlerts());
  return alerts;
}

function getFrequentWithdrawalAlerts() {
  const materials = getMaterials();
  const txns = getAllRows(SHEET.TRANSACTIONS).filter(t => t.type === 'เบิก');
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const alerts = [];
  materials.forEach(m => {
    const recent = txns.filter(t => {
      if (t.material_id !== m.id) return false;
      const txnDate = new Date(t.date);
      return txnDate >= sevenDaysAgo;
    });
    if (recent.length >= 3 && m.tracking_mode === 'STATUS' && Number(m.current_stock) > 1) {
      alerts.push({
        type: 'frequent_withdrawal',
        severity: 'medium',
        mat_id: m.id,
        mat_name: m.name,
        current_status: Number(m.current_stock),
        count: recent.length,
        message: m.name + ' ถูกเบิก ' + recent.length + ' ครั้งใน 7 วัน — ยังพอใช้ไหม?',
      });
    }
  });
  return alerts;
}

function getStaleStatusAlerts() {
  const materials = getMaterials('STATUS');
  const today = new Date();
  const alerts = [];
  materials.forEach(m => {
    if (!m.last_status_update) return;
    const lastUpdate = new Date(m.last_status_update);
    const days = Math.floor((today - lastUpdate) / (1000 * 60 * 60 * 24));
    if (days >= 14) {
      alerts.push({
        type: 'stale_status',
        severity: 'low',
        mat_id: m.id,
        mat_name: m.name,
        days_since_update: days,
        current_status: Number(m.current_stock),
        message: m.name + ' ไม่ได้อัปเดตสถานะ ' + days + ' วัน — เช็คหน่อย?',
      });
    }
  });
  return alerts;
}

function getLowStockAlerts() {
  const materials = getMaterials('COUNT');
  const alerts = [];
  materials.forEach(m => {
    const stock = Number(m.current_stock || 0);
    const minAlert = Number(m.min_stock_alert || 0);
    if (minAlert > 0 && stock <= minAlert) {
      alerts.push({
        type: 'low_stock',
        severity: stock === 0 ? 'high' : 'medium',
        mat_id: m.id,
        mat_name: m.name,
        current_stock: stock,
        min_alert: minAlert,
        message: stock === 0
          ? m.name + ' หมดสต๊อก!'
          : m.name + ' เหลือ ' + stock + ' ' + m.unit + ' (เตือนที่ ' + minAlert + ')',
      });
    }
  });
  return alerts;
}


// ============================================================
// 📝 DAILY REPORTS
// ============================================================
// ============================================================
// 📝 DAILY REPORT
// ============================================================

/**
 * Ensure daily sheet has all required columns
 */
function ensureDailySheet_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sheet = ss.getSheetByName(SHEET.DAILY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.DAILY);
    sheet.appendRow([
      'id', 'project_id', 'date', 'reporter_name', 'reporter_role',
      'weather', 'tasks_done', 'workers_count', 'workers_list',
      'issues', 'summary_text', 'ai_processed',
      'created_at', 'updated_at'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 14);
    headerRange.setFontWeight('bold').setBackground('#1F3864').setFontColor('#fff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * create_daily — สร้าง/อัปเดต daily report
 * ถ้ามีรายงานวันนั้นแล้ว → update; ไม่มี → create
 */
function createDaily(p) {
  ensureDailySheet_();
  const date = p.date || todayStr();
  const reporter = p.reporter_name || '';

  // Check if report already exists for this date+reporter
  const existing = getAllRows(SHEET.DAILY).find(r =>
    r.date === date && r.reporter_name === reporter
  );

  if (existing) {
    // Update existing
    const updates = {
      reporter_role: p.reporter_role || existing.reporter_role,
      weather: p.weather || existing.weather,
      tasks_done: p.tasks_done || existing.tasks_done,
      workers_count: p.workers_count || existing.workers_count,
      workers_list: p.workers_list || existing.workers_list,
      issues: p.issues !== undefined ? p.issues : existing.issues,
      summary_text: p.summary_text !== undefined ? p.summary_text : existing.summary_text,
      updated_at: nowStr(),
    };
    updateRowByCol(SHEET.DAILY, 'id', existing.id, updates);
    return Object.assign({}, existing, updates);
  }

  // Create new
  const id = generateId('DR', SHEET.DAILY, 'id');
  const row = {
    id,
    project_id: p.project_id || 'bow-house',
    date: date,
    reporter_name: reporter,
    reporter_role: p.reporter_role || 'FOREMAN',
    weather: p.weather || '',
    tasks_done: p.tasks_done || '',
    workers_count: p.workers_count || 0,
    workers_list: p.workers_list || '',
    issues: p.issues || '',
    summary_text: p.summary_text || '',
    ai_processed: false,
    created_at: nowStr(),
    updated_at: nowStr(),
  };
  appendRow(SHEET.DAILY, row);
  return row;
}

/**
 * get_daily_report — by id or by date+reporter
 */
function getDailyReport(p) {
  ensureDailySheet_();
  const rows = getAllRows(SHEET.DAILY);
  if (p.id) return rows.find(r => r.id === p.id) || null;
  if (p.date) {
    if (p.reporter_name) {
      return rows.find(r => r.date === p.date && r.reporter_name === p.reporter_name) || null;
    }
    return rows.filter(r => r.date === p.date);
  }
  return rows;
}

/**
 * auto_detect_daily — รวบรวมข้อมูลจาก tasks/transactions/quick_logs ของวันนั้น
 * คืน suggested fields ให้ user
 */
function autoDetectDaily(p) {
  const date = p.date || todayStr();
  ensureDailySheet_();

  // 1. Tasks done today (ใช้ formatDateValue กัน Done Date เป็น Date object)
  const tasks = getAllRows(SHEET.TASKS).filter(t =>
    formatDateValue(t['Done Date']) === date && t.Status === 'Done'
  );
  const tasksDone = tasks.map(t => ({
    task_id: t['Task ID'],
    ff_code: t['FF Code'],
    name: t['Task Name'] || t.name,
    phase: t['Phase'],
  }));

  // 2. Transactions today (รับ/เบิก/นับ)
  let transactions = [];
  try {
    const tRows = getAllRows(SHEET.TRANSACTIONS);
    transactions = tRows.filter(t =>
      formatDateValue(t.date) === date
    ).map(t => ({
      type: t.type,
      material_id: t.material_id,
      quantity: t.quantity,
      contractor_id: t.contractor_id || '',
      ff_code: t.ff_code || '',
      notes: t.notes || '',
    }));
  } catch (e) {}

  // 3. Quick logs today (if any sheet exists)
  let quickLogs = [];
  try {
    const qRows = getAllRows(SHEET.QUICK);
    quickLogs = qRows.filter(q =>
      String(q.timestamp || '').slice(0, 10) === date
    ).map(q => ({ time: q.timestamp, text: q.text }));
  } catch (e) {}

  // 4. Unique contractors involved
  const contractorIds = [...new Set(transactions
    .map(t => t.contractor_id)
    .filter(c => c))];

  // 5. Get contractor details
  const allContractors = getAllRows(SHEET.CONTRACTORS);
  const workers = contractorIds.map(cid => {
    const c = allContractors.find(x => x.id === cid);
    return c ? { id: c.id, name: c.name, role: c.role } : null;
  }).filter(Boolean);

  return {
    date: date,
    tasks_done: tasksDone,
    tasks_count: tasksDone.length,
    transactions: transactions,
    transactions_count: transactions.length,
    quick_logs: quickLogs,
    workers_detected: workers,
    workers_count: workers.length,
  };
}

/**
 * generate_daily_summary — ใช้ AI สรุปจากข้อมูลทั้งหมดของวันนั้น
 */
function generateDailySummary(p) {
  const detected = autoDetectDaily({ date: p.date });

  // Build context
  let context = `วันที่: ${detected.date}\n\n`;

  if (detected.tasks_done.length > 0) {
    context += 'งานที่เสร็จวันนี้:\n';
    detected.tasks_done.forEach(t => {
      context += `- ${t.ff_code}: ${t.name}\n`;
    });
    context += '\n';
  }

  if (detected.transactions.length > 0) {
    context += 'กิจกรรมวัสดุ:\n';
    detected.transactions.forEach(t => {
      let line = `- ${t.type}: ${t.material_id} จำนวน ${t.quantity}`;
      if (t.ff_code) line += ` (${t.ff_code})`;
      if (t.contractor_id) line += ` โดย ${t.contractor_id}`;
      context += line + '\n';
    });
    context += '\n';
  }

  if (detected.workers_detected.length > 0) {
    context += `ช่างที่ทำงาน: ${detected.workers_detected.map(w => w.name).join(', ')}\n\n`;
  }

  if (detected.quick_logs.length > 0) {
    context += 'บันทึกเพิ่มเติม:\n';
    detected.quick_logs.forEach(q => {
      context += `- ${q.text}\n`;
    });
    context += '\n';
  }

  if (context.length < 100) {
    return {
      summary: 'ยังไม่มีกิจกรรมในวันนี้',
      details: detected
    };
  }

  // Call Gemini
  const prompt = `คุณคือผู้ช่วยสรุปรายงานหน้างานก่อสร้าง สรุปข้อมูลด้านล่างเป็นภาษาไทยกระชับ 2-3 บรรทัด

เน้น:
- ความคืบหน้าของวัน (FF ไหนทำอะไร)
- การใช้/รับวัสดุที่สำคัญ
- ปัญหาที่ต้องระวัง (เช่น วัสดุใกล้หมด, งานล่าช้า)

ห้าม: ใส่หัวข้อ, bullet, markdown — เขียนเป็นย่อหน้าธรรมดา

ข้อมูล:
${context}`;

  let summary = '';
  try {
    summary = callGemini(prompt);
  } catch (err) {
    summary = 'ไม่สามารถสร้างสรุป AI ได้ (' + err.message + ')';
  }

  return {
    summary: summary,
    details: detected
  };
}

/**
 * delete_daily — ลบรายงาน (admin only)
 */
function deleteDaily(p) {
  if (!p.id) throw new Error('id required');
  ensureDailySheet_();
  const sheet = SpreadsheetApp.openById(SHEETS_ID).getSheetByName(SHEET.DAILY);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === p.id) {
      sheet.deleteRow(i + 1);
      return { deleted: p.id };
    }
  }
  throw new Error('Report not found: ' + p.id);
}

function addQuickLog(p) {
  const id = generateId('QL', SHEET.QUICK, 'id');
  const row = {
    id,
    report_id: p.report_id,
    timestamp: nowStr(),
    text: p.text || '',
    photos: p.photos || '',
    tagged_ff: p.tagged_ff || '',
    tagged_contractor: p.tagged_contractor || '',
  };
  appendRow(SHEET.QUICK, row);
  return row;
}

function aiSummary(report_id) {
  const logs = getAllRows(SHEET.QUICK).filter(q => q.report_id === report_id);
  if (logs.length === 0) throw new Error('No logs for report ' + report_id);
  const text = logs.map(l => '- [' + l.timestamp + '] ' + l.text).join('\n');
  const prompt = 'สรุปบันทึกหน้างานต่อไปนี้ให้กระชับ เน้นความคืบหน้าและปัญหา:\n\n' + text;
  const summary = callGemini(prompt);
  updateRowByCol(SHEET.DAILY, 'id', report_id, {
    summary_text: summary,
    ai_processed: true,
    updated_at: nowStr(),
  });
  return { report_id, summary };
}


// ============================================================
// 📷 PHOTOS
// ============================================================
function addPhoto(p) {
  // กัน column client_visible หาย — ensure ก่อนเขียน
  // (idempotent — เช็ค headers.indexOf ก่อนเพิ่ม)
  try { ensureTaskPhotoColumns_(); } catch (e) {}
  const id = generateId('P', SHEET.PHOTOS, 'id');
  // client_visible: optional flag จาก foreman — default false (ไม่ curated)
  // รับทั้ง boolean true / string 'true' กัน frontend ส่งแบบไหนก็ได้
  const cv = (p.client_visible === true || p.client_visible === 'true');
  const row = {
    id,
    task_id: p.task_id || '',
    report_id: p.report_id || '',
    drive_url: p.drive_url || '',
    drive_id: p.drive_id || '',
    caption: p.caption || '',
    uploaded_at: nowStr(),
    uploaded_by: p.uploaded_by || '',
    client_visible: cv,
  };
  appendRow(SHEET.PHOTOS, row);
  return row;
}


// ============================================================
// 🧠 GEMINI AI
// ============================================================
function callGemini(prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              GEMINI_MODEL + ':generateContent?key=' + GEMINI_API_KEY;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
  };
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const text = res.getContentText();

  // HTTP error
  if (code === 429) throw new Error('Gemini quota เต็ม/rate limit (HTTP 429) — รอสักครู่แล้วลองใหม่');
  if (code === 401 || code === 403) throw new Error('Gemini API key ไม่ถูกต้องหรือถูก revoke (HTTP ' + code + ')');
  if (code >= 500) throw new Error('Gemini server error (HTTP ' + code + ')');

  let data;
  try { data = JSON.parse(text); }
  catch (e) { throw new Error('Gemini ตอบไม่ใช่ JSON: ' + text.slice(0, 200)); }

  if (data.error) throw new Error('Gemini error: ' + (data.error.message || JSON.stringify(data.error)));

  // candidates อาจหาย — content filter, safety block
  if (!data.candidates || data.candidates.length === 0) {
    const reason = (data.promptFeedback && data.promptFeedback.blockReason) || 'ไม่ทราบสาเหตุ';
    throw new Error('Gemini ไม่ตอบ — ' + reason + ' (อาจเป็น content filter หรือ safety)');
  }

  const cand = data.candidates[0];
  if (!cand.content || !cand.content.parts || cand.content.parts.length === 0) {
    const finish = cand.finishReason || 'unknown';
    throw new Error('Gemini ตอบไม่มีเนื้อหา (finishReason: ' + finish + ')');
  }

  return cand.content.parts[0].text || '';
}


// ============================================================
// 🧪 TEST FUNCTIONS
// ============================================================
function testPing() {
  Logger.log(route('ping', {}));
}

function testGetAll() {
  const result = getAll();
  Logger.log('ffs: ' + result.ffs.length);
  Logger.log('tasks: ' + result.tasks.length);
  Logger.log('payments: ' + result.payments.length);
  Logger.log('materials: ' + result.materials.length);
  Logger.log('contractors: ' + result.contractors.length);
  Logger.log('Sample task: ' + JSON.stringify(result.tasks[0]));
  Logger.log('Sample ff: ' + JSON.stringify(result.ffs[0]));
}

function testParseLog() {
  const result = parseMaterialLog('สากลเบิกไม้ 18 มิล 5 แผ่น F-03');
  Logger.log(JSON.stringify(result, null, 2));
}

function testAiAlerts() {
  Logger.log(JSON.stringify(getAiAlerts(), null, 2));
}


// ============================================================
// 📷 PHOTO + GOOGLE DRIVE
// ============================================================

/**
 * Get or create root Drive folder structure
 * DSTR-PM-V2-Photos/
 *   bow-house/
 *     materials/
 *     bills/
 *     transactions/
 */
function getOrCreateFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent.createFolder(name);
}

function getDriveFolder_(subType) {
  const root = getOrCreateFolder_(DriveApp, DRIVE_ROOT_NAME);
  const project = getOrCreateFolder_(root, PROJECT_KEY);
  const sub = getOrCreateFolder_(project, subType);
  return sub;
}

/**
 * Ensure photo sheet exists with proper headers
 */
function ensureMaterialPhotoSheet_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sheet = findSheet_(ss, SHEET.MAT_PHOTOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.MAT_PHOTOS);
    sheet.appendRow([
      'photo_id', 'linked_to', 'link_id', 'drive_url',
      'drive_id', 'caption', 'uploaded_at', 'uploaded_by'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 8);
    headerRange.setFontWeight('bold').setBackground('#1F3864').setFontColor('#fff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * Generate next photo ID (PH001, PH002, ...)
 */
function nextPhotoId_() {
  const sheet = ensureMaterialPhotoSheet_();
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    const m = id.match(/PH(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  return 'PH' + String(maxNum + 1).padStart(3, '0');
}

/**
 * upload_photo
 * Save base64 image to Drive and record in sheet
 *
 * params:
 *   image_base64 - "data:image/jpeg;base64,/9j/4AAQ..." or just "/9j/4AAQ..."
 *   linked_to    - 'material' | 'bill' | 'transaction' | 'count'
 *   link_id      - M001 | BILL-xxx | T-RCV-xxx | T-CNT-xxx
 *   caption      - optional text
 *   uploaded_by  - user role
 */
function uploadPhoto(p) {
  if (!p.image_base64) throw new Error('image_base64 required');
  if (!p.linked_to)    throw new Error('linked_to required');
  if (!p.link_id)      throw new Error('link_id required');

  // Strip data: prefix if present
  let b64 = String(p.image_base64);
  let mimeType = 'image/jpeg';
  const m = b64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) {
    mimeType = m[1];
    b64 = m[2];
  }

  // Determine folder
  const folderType = (p.linked_to === 'material') ? 'materials' :
                     (p.linked_to === 'bill') ? 'bills' : 'transactions';
  const folder = getDriveFolder_(folderType);

  // Create file
  const blob = Utilities.newBlob(
    Utilities.base64Decode(b64),
    mimeType,
    p.link_id + '_' + Date.now() + '.jpg'
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const driveId = file.getId();
  const driveUrl = 'https://lh3.googleusercontent.com/d/' + driveId;
  const photoId = nextPhotoId_();

  // Save to sheet
  const sheet = ensureMaterialPhotoSheet_();
  sheet.appendRow([
    photoId,
    p.linked_to,
    p.link_id,
    driveUrl,
    driveId,
    p.caption || '',
    new Date().toISOString(),
    p.uploaded_by || 'admin'
  ]);

  return {
    photo_id: photoId,
    drive_id: driveId,
    drive_url: driveUrl,
    thumbnail: 'https://lh3.googleusercontent.com/d/' + driveId + '=w400'
  };
}

/**
 * get_material_photos - list photos for a material
 */
function getMaterialPhotos(matId) {
  if (!matId) return [];
  ensureMaterialPhotoSheet_();
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.MAT_PHOTOS);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[1] === 'material' && r[2] === matId) {
      out.push({
        photo_id: r[0],
        linked_to: r[1],
        link_id: r[2],
        drive_url: r[3],
        drive_id: r[4],
        thumbnail: 'https://lh3.googleusercontent.com/d/' + r[4] + '=w400',
        caption: r[5],
        uploaded_at: r[6],
        uploaded_by: r[7]
      });
    }
  }
  return out;
}

/**
 * get_task_photos - list photos for a task from 13_Task_Photos
 * NB: คนละ schema กับ 16_Material_Photos — sheet นี้ใช้ task_id ตรงๆ
 * (schema ตาม addPhoto: id, task_id, report_id, drive_url, drive_id,
 *  caption, uploaded_at, uploaded_by). คืน array ดิบ (route wrap {ok,data}).
 */
function getTaskPhotos(taskId) {
  if (!taskId) return [];
  let rows;
  try {
    rows = getAllRows(SHEET.PHOTOS);
  } catch (e) {
    return [];
  }
  const want = String(taskId);
  const out = [];
  rows.forEach(r => {
    if (String(r.task_id) === want) {
      out.push({
        id: r.id || '',
        task_id: r.task_id || '',
        drive_url: r.drive_url || '',
        drive_id: r.drive_id || '',
        caption: r.caption || '',
        uploaded_at: formatDateValue(r.uploaded_at),
        uploaded_by: r.uploaded_by || '',
      });
    }
  });
  // เรียง uploaded_at เก่า→ใหม่ (String compare ปลอดภัยหลัง formatDateValue)
  out.sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
  return out;
}

/**
 * get_transaction_photos - list photos for transactions (bills + transactions)
 */
function getTransactionPhotos(transId) {
  if (!transId) return [];
  ensureMaterialPhotoSheet_();
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.MAT_PHOTOS);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[2] === transId) {
      out.push({
        photo_id: r[0],
        linked_to: r[1],
        link_id: r[2],
        drive_url: r[3],
        drive_id: r[4],
        thumbnail: 'https://lh3.googleusercontent.com/d/' + r[4] + '=w400',
        caption: r[5],
        uploaded_at: r[6]
      });
    }
  }
  return out;
}

/**
 * delete_photo - delete from Drive + remove sheet row (16_Material_Photos)
 */
function deletePhoto(photoId) {
  if (!photoId) throw new Error('photo_id required');
  const sheet = ensureMaterialPhotoSheet_();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === photoId) {
      const driveId = data[i][4];
      // Try to delete from Drive (ignore if already gone)
      try {
        DriveApp.getFileById(driveId).setTrashed(true);
      } catch (e) {}
      sheet.deleteRow(i + 1);
      return { deleted: photoId };
    }
  }
  throw new Error('Photo not found: ' + photoId);
}

/**
 * delete_task_photo - delete from Drive + remove sheet row (13_Task_Photos)
 * คนละ sheet กับ deletePhoto (16_Material_Photos) — schema task_id ตรงๆ
 * ตาม addPhoto: id, task_id, report_id, drive_url, drive_id, caption,
 * uploaded_at, uploaded_by (drive_id อยู่ index 4)
 * ripple: photoCount (computed ใน getTasksAsObjects) จะ refresh เองครั้งถัดไป
 * — ไม่กระทบ Tasks Status / Activity_Logs / stock / เงิน (HUB-safe)
 */
function deleteTaskPhoto(photoId) {
  if (!photoId) throw new Error('photo_id required');
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const sheet = ss.getSheetByName(SHEET.PHOTOS);
  if (!sheet) throw new Error('Sheet not found: ' + SHEET.PHOTOS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(photoId)) {
      const driveId = data[i][4];
      try {
        if (driveId) DriveApp.getFileById(driveId).setTrashed(true);
      } catch (e) {}
      sheet.deleteRow(i + 1);
      return { deleted: photoId };
    }
  }
  throw new Error('Task photo not found: ' + photoId);
}


// ============================================================
// 🤖 AI BILL SCANNER (Gemini Vision)
// ============================================================

/**
 * scan_bill
 * Use Gemini Vision to extract structured data from bill/receipt photo
 *
 * params:
 *   image_base64 - bill photo
 *
 * returns:
 *   {
 *     bill_photo_id: "PH001",       // photo saved
 *     invoice_no: "IV6905126",
 *     date: "2026-05-15",
 *     supplier: "...",
 *     total: 5290,
 *     items: [
 *       {
 *         raw_name: "HMR 18 มิล",
 *         quantity: 5,
 *         unit: "แผ่น",
 *         unit_price: 850,
 *         line_total: 4250,
 *         matched_material_id: "M003",     // best guess
 *         matched_material_name: "HMR-V70 18 มิล E1 (PS)",
 *         match_confidence: 0.95,
 *         needs_review: false
 *       },
 *       ...
 *     ],
 *     unmatched_count: 0
 *   }
 */
function scanBill(p) {
  if (!p.image_base64) throw new Error('image_base64 required');

  // Step 1: Save bill photo to Drive first
  const billId = 'BILL-' + Date.now();
  const photoResult = uploadPhoto({
    image_base64: p.image_base64,
    linked_to: 'bill',
    link_id: billId,
    caption: 'Bill scan',
    uploaded_by: p.uploaded_by || 'admin'
  });

  // Step 2: Strip data: prefix
  let b64 = String(p.image_base64);
  let mimeType = 'image/jpeg';
  const m = b64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) {
    mimeType = m[1];
    b64 = m[2];
  }

  // Step 3: Get current materials list for matching context
  const materials = getMaterials();
  const matListText = materials.map(mat =>
    `${mat.id}|${mat.name}|${mat.unit}|${mat.category}`
  ).join('\n');

  // Step 4: Build prompt
  const prompt = `คุณคือผู้ช่วยอ่านใบส่งของ/ใบเสร็จของบริษัทรับเหมาก่อสร้าง

หน้าที่:
1. อ่านข้อความในรูป (ใบส่งของ/ใบเสร็จ)
2. ดึงข้อมูล: เลขที่บิล, วันที่, ชื่อร้าน, รายการสินค้า
3. แต่ละรายการ: ชื่อ, จำนวน, หน่วย, ราคา/หน่วย, ราคารวม
4. จับคู่ชื่อสินค้ากับ Master Materials List ด้านล่าง

Master Materials List (id|ชื่อ|หน่วย|หมวด):
${matListText}

ตอบเป็น JSON เท่านั้น (ไม่ต้องมี markdown หรือคำอธิบาย):
{
  "invoice_no": "...",
  "date": "YYYY-MM-DD",
  "supplier": "...",
  "total": 0,
  "items": [
    {
      "raw_name": "ชื่อที่อ่านจากบิล",
      "quantity": 0,
      "unit": "...",
      "unit_price": 0,
      "line_total": 0,
      "matched_material_id": "Mxxx หรือ null ถ้าหาไม่เจอ",
      "matched_material_name": "ชื่อจริงในระบบ",
      "match_confidence": 0.0,
      "needs_review": false
    }
  ]
}

กฎ:
- match_confidence: 1.0 = แน่ใจ, 0.7-0.9 = น่าจะใช่, 0.5-0.7 = ไม่แน่ใจ
- needs_review = true ถ้า confidence < 0.7 หรือมีหลายความเป็นไปได้
- ถ้าจับคู่ไม่ได้เลย: matched_material_id = null, needs_review = true
- ตัวเลข: ตัด ฿ comma ออก ใช้เป็น number
- ถ้าอ่านไม่ออกจริงๆ: items = []
- ถ้าวันที่ไม่มี: ใช้วันที่วันนี้`;

  // Step 5: Call Gemini Vision
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: b64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json'
    }
  };

  let parsed;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code !== 200) {
      throw new Error('Gemini ' + code + ': ' + response.getContentText().slice(0, 200));
    }
    const result = JSON.parse(response.getContentText());
    const aiText = result.candidates[0].content.parts[0].text;
    parsed = JSON.parse(aiText);
  } catch (err) {
    return {
      bill_photo_id: photoResult.photo_id,
      bill_thumbnail: photoResult.thumbnail,
      error: 'AI ไม่สามารถอ่านบิลได้: ' + err.message,
      items: []
    };
  }

  // Step 6: Count unmatched
  const items = parsed.items || [];
  const unmatched = items.filter(i => !i.matched_material_id).length;

  return {
    bill_photo_id: photoResult.photo_id,
    bill_drive_url: photoResult.drive_url,
    bill_thumbnail: photoResult.thumbnail,
    invoice_no: parsed.invoice_no || '',
    date: parsed.date || todayStr(),
    supplier: parsed.supplier || '',
    total: Number(parsed.total) || 0,
    items: items,
    unmatched_count: unmatched
  };
}

/**
 * confirm_bill_items
 * After user reviewed AI parse, create transactions + update stock
 *
 * params:
 *   bill_photo_id - photo ID from scan_bill
 *   invoice_no    - confirmed invoice number
 *   items         - array of { material_id, quantity, unit_price, notes }
 */
function confirmBillItems(p) {
  const items = (typeof p.items === 'string') ? JSON.parse(p.items) : p.items;
  if (!items || !items.length) throw new Error('No items to confirm');

  const results = [];
  items.forEach(item => {
    if (!item.material_id || !item.quantity) return;
    try {
      const res = receiveMaterial({
        material_id: item.material_id,
        quantity: item.quantity,
        unit_price: item.unit_price || 0,
        receipt_no: p.invoice_no || '',
        notes: item.notes || ('สแกนบิล ' + (p.invoice_no || ''))
      });
      results.push({
        material_id: item.material_id,
        success: true,
        transaction_id: res.id
      });

      // Link bill photo to this transaction
      if (p.bill_photo_id && res.id) {
        try {
          const sheet = ensureMaterialPhotoSheet_();
          sheet.appendRow([
            nextPhotoId_(),
            'transaction',
            res.id,
            'linked_to_bill:' + p.bill_photo_id,
            '',
            'อ้างอิงบิล ' + (p.invoice_no || ''),
            new Date().toISOString(),
            'admin'
          ]);
        } catch (e) {}
      }
    } catch (err) {
      results.push({
        material_id: item.material_id,
        success: false,
        error: err.message
      });
    }
  });

  return {
    bill_photo_id: p.bill_photo_id,
    invoice_no: p.invoice_no,
    count: results.length,
    success_count: results.filter(r => r.success).length,
    results: results
  };
}


// ============================================================
// 🧪 TESTS
// ============================================================

function testCreateDriveFolders() {
  const f = getDriveFolder_('materials');
  Logger.log('Materials folder: ' + f.getUrl());
  const b = getDriveFolder_('bills');
  Logger.log('Bills folder: ' + b.getUrl());
}

function testEnsurePhotoSheet() {
  const s = ensureMaterialPhotoSheet_();
  Logger.log('Sheet OK: ' + s.getName());
}

/**
 * 🔧 SETUP ALL SHEETS — Run นี้ครั้งเดียวเพื่อสร้าง sheet ทั้งหมด
 * เรียกใช้: เลือก function → กด Run
 */
function setupAllSheets() {
  Logger.log('🔧 Setting up all sheets...');

  try {
    // Sheet 16: Material Photos
    const photoSheet = ensureMaterialPhotoSheet_();
    Logger.log('✅ Sheet 16 OK: ' + photoSheet.getName());
  } catch (e) {
    Logger.log('❌ Sheet 16 failed: ' + e.message);
  }

  try {
    // Sheet 17: Activity Logs
    const activitySheet = ensureActivitySheet_();
    Logger.log('✅ Sheet 17 OK: ' + activitySheet.getName());
  } catch (e) {
    Logger.log('❌ Sheet 17 failed: ' + e.message);
  }

  try {
    // Drive folders
    const matFolder = getDriveFolder_('materials');
    Logger.log('✅ Materials folder: ' + matFolder.getUrl());
    const billFolder = getDriveFolder_('bills');
    Logger.log('✅ Bills folder: ' + billFolder.getUrl());
    const txFolder = getDriveFolder_('transactions');
    Logger.log('✅ Transactions folder: ' + txFolder.getUrl());
    const dailyFolder = getDriveFolder_('daily');
    Logger.log('✅ Daily folder: ' + dailyFolder.getUrl());
  } catch (e) {
    Logger.log('❌ Drive folders failed: ' + e.message);
  }

  Logger.log('🎉 Setup complete! ดูใน Google Sheets และ Google Drive');
  return 'Setup complete - check logs';
}


// ============================================================
// 📜 ACTIVITY FEED (Phase 2)
// ============================================================

/**
 * Ensure activity_logs sheet
 */
/**
 * 🛡️ Defensive sheet finder
 * ค้นหา sheet ด้วย name โดยรองรับ:
 * - Exact match
 * - Case-insensitive
 * - Trim whitespace
 * - Match by number prefix (เช่น "17" จะ match "17_Activity_Logs")
 */
function findSheet_(ss, targetName) {
  if (!targetName) return null;
  const target = String(targetName).trim();
  const targetLower = target.toLowerCase();

  // Try exact match first
  let sheet = ss.getSheetByName(target);
  if (sheet) return sheet;

  // Try all sheets with fuzzy matching
  const allSheets = ss.getSheets();
  for (const s of allSheets) {
    const name = String(s.getName()).trim();
    // Case-insensitive
    if (name.toLowerCase() === targetLower) return s;
    // Number prefix match (e.g. "17" matches "17_Activity_Logs")
    const targetNum = target.match(/^(\d+)/);
    const nameNum = name.match(/^(\d+)/);
    if (targetNum && nameNum && targetNum[1] === nameNum[1]) {
      // Same prefix number AND similar name
      const targetBase = target.replace(/^\d+_?/, '').toLowerCase();
      const nameBase = name.replace(/^\d+_?/, '').toLowerCase();
      if (targetBase === nameBase || targetBase.startsWith(nameBase) || nameBase.startsWith(targetBase)) {
        return s;
      }
    }
  }
  return null;
}

function ensureActivitySheet_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sheet = findSheet_(ss, SHEET.ACTIVITY);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.ACTIVITY);
    sheet.appendRow([
      'log_id', 'date', 'timestamp', 'type', 'source', 'text',
      'tags_ff', 'tags_ctr', 'tags_issue', 'tags_phase', 'photo_url', 'meta_json'
    ]);
    const headerRange = sheet.getRange(1, 1, 1, 12);
    headerRange.setFontWeight('bold').setBackground('#1F3864').setFontColor('#fff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function nextLogId_() {
  ensureActivitySheet_();
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
  const data = sheet.getDataRange().getValues();
  let maxNum = 0;
  for (let i = 1; i < data.length; i++) {
    const id = String(data[i][0] || '');
    const m = id.match(/LOG(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1]));
  }
  return 'LOG' + String(maxNum + 1).padStart(4, '0');
}

/**
 * Core: Append a log row to sheet
 * Used by both manual logs (via addActivityLog) and auto-events (internal)
 */
function appendActivityLog_(opts) {
  ensureActivitySheet_();
  const now = new Date();
  const date = opts.date || now.toISOString().slice(0, 10);
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);

  if (!sheet) {
    throw new Error('Sheet 17_Activity_Logs not found');
  }

  const logId = nextLogId_();

  const row = [
    logId,
    date,
    opts.timestamp || now.toISOString(),
    opts.type || 'manual', // manual | auto
    opts.source || 'admin', // user role or system source
    opts.text || '',
    Array.isArray(opts.tags_ff) ? opts.tags_ff.join(',') : (opts.tags_ff || ''),
    Array.isArray(opts.tags_ctr) ? opts.tags_ctr.join(',') : (opts.tags_ctr || ''),
    Array.isArray(opts.tags_issue) ? opts.tags_issue.join(',') : (opts.tags_issue || ''),
    opts.tags_phase || '',
    opts.photo_url || '',
    typeof opts.meta === 'object' ? JSON.stringify(opts.meta) : (opts.meta || '{}')
  ];

  sheet.appendRow(row);

  return {
    log_id: logId,
    date: date,
    timestamp: row[2],
    type: row[3],
    text: opts.text,
  };
}

/**
 * Public: Auto-log helper (called from other functions)
 * Safe — fails silently to never break parent action
 */
function autoLog_(text, opts) {
  try {
    return appendActivityLog_({
      type: 'auto',
      source: 'system',
      text: text,
      tags_ff: opts && opts.tags_ff,
      tags_ctr: opts && opts.tags_ctr,
      tags_issue: opts && opts.tags_issue,
      tags_phase: opts && opts.tags_phase,
      meta: opts && opts.meta
    });
  } catch (e) {
    return null;
  }
}

/**
 * parse_activity_text — AI extract tags from free text
 * Use Gemini to identify FF codes, contractors, issues
 * Returns: { text, tags_ff, tags_ctr, tags_issue, confidence, ambiguous }
 */
function parseActivityText(p) {
  if (!p.text) throw new Error('text required');

  // Get reference data
  const ffs = getFFList();
  const contractors = getAllRows(SHEET.CONTRACTORS).filter(c => c.active !== false);
  const ffList = ffs.map(f => `${f.code}|${f.name}|${f.area}`).join('\n');
  const ctrList = contractors.map(c => `${c.id}|${c.name}|${c.role}`).join('\n');

  const prompt = `คุณคือผู้ช่วย tagging บันทึกหน้างานก่อสร้าง วิเคราะห์ข้อความและสกัด tags ออกมา

ข้อความ:
"${p.text}"

อ้างอิง FF Items (code|name|area):
${ffList}

อ้างอิง Contractors (id|name|role):
${ctrList}

คืน JSON เท่านั้น (ไม่ต้อง markdown):
{
  "tags_ff": ["F-XX", ...],
  "tags_ctr": ["C001", ...],
  "tags_issue": ["ฝน", "พักงาน", "วัสดุหมด", ...],
  "tags_phase": "p1|p2|p3|p4|",
  "ambiguous": [
    {
      "term": "ห้องลูก",
      "options": ["F-09", "F-10"],
      "reason": "ทั้ง F-09 และ F-10 อยู่ใน DAUGHTER'S ROOM"
    }
  ],
  "confidence": 0.95,
  "summary": "สรุปสั้นๆ ว่า AI เข้าใจอะไรจากข้อความนี้"
}

กฎ:
- tags_ff: รหัส FF ที่กล่าวถึงตรงๆ หรือเดาได้จากบริบท (ห้องนั่งเล่น = F-02, ห้องทำงาน = F-03, etc.)
- tags_ctr: ID ของช่าง ถ้ามีชื่อตรง (สากล = C001, เวียงชัย = C002, เกียรติ/เกียรติอุดม = C003)
- tags_issue: คีย์เวิร์ดปัญหา (ฝน, ฝนตก, พักงาน, วัสดุหมด, ขาด, ล่าช้า, ทำซ้ำ, ผิดพลาด, รอ)
- tags_phase: ระบุงวด ถ้ามี keyword (สั่งซื้อ=p1, กรุไม้/ปิดผิว=p2, ติดตั้ง/พ่นสี=p3, ส่งมอบ=p4)
- ambiguous: ถ้ามีความคลุมเครือเช่น "ห้องลูก" "ห้องนอน" — ใส่ option หลายอัน
- confidence: 0.0-1.0 ถ้า ambiguous เยอะ → ต่ำลง
- summary: 1 ประโยค ว่า AI เข้าใจว่าเกิดอะไร`;

  const aiResp = callGeminiJSON_(prompt);
  return aiResp;
}

/**
 * Helper: call Gemini with JSON response mode
 */
function callGeminiJSON_(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1024,
      responseMimeType: 'application/json'
    }
  };
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error('AI: ' + response.getContentText().slice(0, 200));
  }
  const result = JSON.parse(response.getContentText());
  return JSON.parse(result.candidates[0].content.parts[0].text);
}

/**
 * add_activity_log — manual log + auto-tag
 * params:
 *   text - log text
 *   source - user (admin / foreman)
 *   auto_tag - boolean (default true) — ถ้า frontend ส่ง tags ตรง (structured
 *              composer ขั้น 3) ส่ง auto_tag=false เพื่อข้าม AI parse ทั้งหมด
 *   tags_ff, tags_ctr, tags_issue - user-provided tags (optional, array หรือ csv)
 *   tags_team - (Smart Daily ขั้น 3) team_id ที่เลือกจาก chip (array หรือ csv)
 *               เก็บใน meta.tags_team — ไม่ใช้ tags_ctr คอลัมน์ เพราะ
 *               getTodayStats นับ tags_ctr เป็น contractors_involved (จะปนกัน)
 *   photo_url - optional
 *   date - optional override (default today)
 */
function addActivityLog(p) {
  if (!p.text || !String(p.text).trim()) {
    throw new Error('text required');
  }

  // Helper: parse tags - support both array and CSV string
  function parseTagsList(v) {
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v) return v.split(',').map(s => s.trim()).filter(Boolean);
    return [];
  }

  let tags_ff = parseTagsList(p.tags_ff);
  let tags_ctr = parseTagsList(p.tags_ctr);
  let tags_issue = parseTagsList(p.tags_issue);
  // Structured team chips (Smart Daily ขั้น 3) — เก็บใน meta ไม่ใช่ tags_ctr
  let tags_team = parseTagsList(p.tags_team);
  let tags_phase = p.tags_phase || '';
  let aiInfo = null;

  // Auto-tag if requested (default true)
  const wantsAutoTag = p.auto_tag !== false && p.auto_tag !== 'false';

  if (wantsAutoTag) {
    try {
      aiInfo = parseActivityText({ text: p.text });
      if (aiInfo) {
        tags_ff = mergeUnique_(tags_ff, aiInfo.tags_ff || []);
        tags_ctr = mergeUnique_(tags_ctr, aiInfo.tags_ctr || []);
        tags_issue = mergeUnique_(tags_issue, aiInfo.tags_issue || []);
        if (!tags_phase) tags_phase = aiInfo.tags_phase || '';
      }
    } catch (e) {
      // If AI fails, save log without auto-tags
    }
  }

  const logged = appendActivityLog_({
    type: 'manual',
    source: p.source || 'admin',
    text: p.text,
    tags_ff: tags_ff,
    tags_ctr: tags_ctr,
    tags_issue: tags_issue,
    tags_phase: tags_phase,
    photo_url: p.photo_url || '',
    date: p.date,
    meta: { ai: aiInfo, tags_team: tags_team }
  });

  return {
    log: logged,
    ai_info: aiInfo,
    tags_team: tags_team
  };
}

function mergeUnique_(a, b) {
  const set = new Set();
  (a || []).forEach(x => x && set.add(String(x).trim()));
  (b || []).forEach(x => x && set.add(String(x).trim()));
  return Array.from(set);
}

/**
 * get_activity_feed — list logs by date
 * params:
 *   date - YYYY-MM-DD (default today)
 *   include_auto - default true
 *   limit - default 200
 */
function getActivityFeed(p) {
  ensureActivitySheet_();
  const date = p.date || todayStr();
  const includeAuto = p.include_auto !== false && p.include_auto !== 'false';
  const limit = Number(p.limit || 200);

  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
  const data = sheet.getDataRange().getValues();
  const out = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const r = data[i];
    // Normalize date value — could be Date object, string, or other format
    let rowDate = r[1];
    if (rowDate instanceof Date) {
      // Convert Date to YYYY-MM-DD using local timezone
      const y = rowDate.getFullYear();
      const m = String(rowDate.getMonth() + 1).padStart(2, '0');
      const d = String(rowDate.getDate()).padStart(2, '0');
      rowDate = y + '-' + m + '-' + d;
    } else {
      rowDate = String(rowDate || '').slice(0, 10);
    }

    if (rowDate !== date) continue;
    if (!includeAuto && r[3] === 'auto') continue;

    let meta = {};
    try { meta = JSON.parse(r[11] || '{}'); } catch (e) {}

    // Normalize timestamp too
    let ts = r[2];
    if (ts instanceof Date) ts = ts.toISOString();

    out.push({
      log_id: r[0],
      date: rowDate,
      timestamp: String(ts || ''),
      type: r[3],
      source: r[4],
      text: r[5],
      tags_ff: String(r[6] || '').split(',').filter(Boolean),
      tags_ctr: String(r[7] || '').split(',').filter(Boolean),
      tags_issue: String(r[8] || '').split(',').filter(Boolean),
      tags_phase: r[9] || '',
      photo_url: r[10] || '',
      // tags_team อยู่ใน meta.tags_team — ยกขึ้น top-level ให้ frontend ขั้น 3
      // ใช้ได้ตรง (cross-ref กับ get_teams เพื่อ render ชื่อทีม). default []
      tags_team: Array.isArray(meta && meta.tags_team) ? meta.tags_team : [],
      meta: meta
    });
    if (out.length >= limit) break;
  }

  // Newest first (descending timestamp)
  out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
  return out;
}

/**
 * get_material_transactions — ประวัติการรับ/เบิก/นับวัสดุ (read-only, audit trail)
 *
 * Frontend หน้า materials ใช้เป็น timeline ดู "วันนี้ใครเบิกอะไร" + ดูย้อนหลัง
 * เลือกช่วงวันได้. Read-only path ล้วน ไม่แตะ write ของ receive/withdraw/count
 *
 * params (ทั้งหมด optional):
 *   date_from    'YYYY-MM-DD' (default = วันนี้)
 *   date_to      'YYYY-MM-DD' (default = date_from)
 *   type         'รับ' | 'เบิก' | 'นับ' | '' (ว่าง = ทั้งหมด)
 *   material_id  string filter (ว่าง = ทั้งหมด)
 *   limit        number (default 500)
 *
 * Date filtering ใช้ formatDateValue(r.date) เสมอ — กันบั๊กคลาส Date-object
 * (cell ที่ format เป็นวันที่ใน Sheets อ่านกลับมาเป็น JS Date ไม่ใช่ string)
 *
 * Lookup map (อ่าน sheet master ครั้งเดียวต้นฟังก์ชัน กัน N+1):
 *   materials → name/unit/tracking_mode
 *   suppliers → name (ว่างถ้าไม่เจอ)
 *   contractors → name (ลองก่อน), ถ้าไม่เจอลอง teams (frontend ส่ง T0xx มาใน
 *   contractor_id เพราะ 09_Contractors ตายแล้ว ใช้ 21_Teams เป็น master) —
 *   pattern เดียวกับ withdrawMaterial (~891-901)
 */
function getMaterialTransactions(p) {
  p = p || {};
  const dateFrom = String(p.date_from || todayStr()).slice(0, 10);
  const dateTo = String(p.date_to || dateFrom).slice(0, 10);
  const typeFilter = String(p.type || '').trim();
  const matFilter = String(p.material_id || '').trim();
  const limit = Math.max(1, Number(p.limit || 500));

  let rows;
  try {
    rows = getAllRows(SHEET.TRANSACTIONS);
  } catch (e) {
    return [];
  }
  if (!rows || rows.length === 0) return [];

  // Build lookup maps (1 read per master sheet — กัน N+1)
  const materialsMap = {};
  try {
    getAllRows(SHEET.MATERIALS).forEach(m => {
      if (m && m.id) materialsMap[m.id] = m;
    });
  } catch (e) {}

  const suppliersMap = {};
  try {
    getAllRows(SHEET.SUPPLIERS).forEach(s => {
      if (s && s.id) suppliersMap[s.id] = s;
    });
  } catch (e) {}

  const contractorsMap = {};
  try {
    getAllRows(SHEET.CONTRACTORS).forEach(c => {
      if (c && c.id) contractorsMap[c.id] = c;
    });
  } catch (e) {}

  const teamsMap = {};
  try {
    getAllRows(SHEET.TEAMS).forEach(t => {
      if (t && t.team_id) teamsMap[t.team_id] = t;
    });
  } catch (e) {}

  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;

    // Date filter ผ่าน formatDateValue (Date-object safe + timezone Asia/Bangkok)
    const dStr = formatDateValue(r.date);
    if (!dStr) continue;
    if (dStr < dateFrom || dStr > dateTo) continue;

    if (typeFilter && String(r.type || '') !== typeFilter) continue;
    if (matFilter && String(r.material_id || '') !== matFilter) continue;

    const mat = materialsMap[r.material_id] || null;

    // contractor lookup: contractors ก่อน → fallback teams (pattern จาก withdrawMaterial)
    let ctrName = '';
    if (r.contractor_id) {
      const c = contractorsMap[r.contractor_id];
      if (c && c.name) ctrName = c.name;
      if (!ctrName) {
        const t = teamsMap[r.contractor_id];
        if (t && t.name) ctrName = t.name;
      }
    }

    let supName = '';
    if (r.supplier_id) {
      const s = suppliersMap[r.supplier_id];
      if (s && s.name) supName = s.name;
    }

    // created_at: raw string (frontend parse เอง). ถ้าเป็น Date → ISO
    let createdAt = r.created_at;
    if (createdAt instanceof Date) createdAt = createdAt.toISOString();
    createdAt = String(createdAt || '');

    out.push({
      id: r.id || '',
      date: dStr,
      created_at: createdAt,
      type: r.type || '',
      material_id: r.material_id || '',
      material_name: mat ? (mat.name || '') : '',
      material_unit: mat ? (mat.unit || '') : '',
      material_tracking_mode: mat ? (mat.tracking_mode || '') : '',
      quantity: Number(r.quantity || 0),
      unit_price: Number(r.unit_price || 0),
      total_value: Number(r.total_value || 0),
      supplier_id: r.supplier_id || '',
      supplier_name: supName,
      contractor_id: r.contractor_id || '',
      contractor_name: ctrName,
      ff_code: r.ff_code || '',
      remaining_after: Number(r.remaining_after || 0),
      receipt_no: r.receipt_no || '',
      notes: r.notes || '',
      created_by: r.created_by || '',
    });
  }

  // Sort: created_at desc → id desc (ใหม่ → เก่า)
  out.sort((a, b) => {
    const ca = String(a.created_at || '');
    const cb = String(b.created_at || '');
    if (ca !== cb) return cb.localeCompare(ca);
    return String(b.id || '').localeCompare(String(a.id || ''));
  });

  return out.slice(0, limit);
}

/**
 * delete_activity_log — remove a log
 */
function deleteActivityLog(logId) {
  if (!logId) throw new Error('log_id required');
  ensureActivitySheet_();
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === logId) {
      sheet.deleteRow(i + 1);
      return { deleted: logId };
    }
  }
  throw new Error('Log not found: ' + logId);
}

/**
 * 🎯 PHASE 1C: untick_task_from_log
 * ยกเลิกการติ๊ก task (จาก auto-log) → task กลับเป็นไม่เสร็จ + ลบ log
 *
 * params:
 *   log_id - ID ของ activity log
 *   task_id - Task ID ที่จะยกเลิก
 */
function untickTaskFromLog(p) {
  if (!p.task_id) throw new Error('task_id required');

  // 1. Revert task status to Not Started
  const allTasks = getAllRows(SHEET.TASKS);
  const task = allTasks.find(t => String(t['Task ID']) === String(p.task_id));
  if (!task) throw new Error('ไม่พบ task: ' + p.task_id);

  updateRowByCol(SHEET.TASKS, 'Task ID', p.task_id, {
    'Status': 'Not Started',
    'Done Date': ''
  });

  // 2. Delete the original "done" log if log_id given
  if (p.log_id) {
    try { deleteActivityLog(p.log_id); } catch (e) {}
  }

  // 3. Create an "undo" auto-log for the record trail
  try {
    autoLog_('🔄 ยกเลิกติ๊ก: ' + task['Task Name'] + ' (' + task['FF Code'] + ')', {
      type: 'auto',
      tags_ff: [task['FF Code']],
      meta: { task_id: p.task_id, event: 'task_undo' }
    });
  } catch (e) {}

  return {
    ok: true,
    task_id: p.task_id,
    task_name: task['Task Name']
  };
}

/**
 * get_today_stats — quick stats for header
 */
function getTodayStats(p) {
  const date = p.date || todayStr();

  // Activity count
  const feed = getActivityFeed({ date: date, limit: 500 });
  const manualCount = feed.filter(l => l.type === 'manual').length;
  const autoCount = feed.filter(l => l.type === 'auto').length;

  // Tasks done today (ใช้ formatDateValue กัน Done Date เป็น Date object)
  const tasks = getAllRows(SHEET.TASKS).filter(t =>
    formatDateValue(t['Done Date']) === date && t['Status'] === 'Done'
  );

  // Transactions today (transaction row ใช้ field `date` ไม่ใช่ `timestamp`)
  let txCount = 0, recvCount = 0, wdrCount = 0;
  let todayTxns = [];
  try {
    const txns = getAllRows(SHEET.TRANSACTIONS);
    todayTxns = txns.filter(t =>
      formatDateValue(t.date) === date
    );
    txCount = todayTxns.length;
    recvCount = todayTxns.filter(t => t.type === 'รับ').length;
    wdrCount = todayTxns.filter(t => t.type === 'เบิก').length;
  } catch (e) {}

  // Contractors involved today (from logs + transactions)
  const ctrSet = new Set();
  feed.forEach(l => (l.tags_ctr || []).forEach(c => c && ctrSet.add(c)));
  todayTxns.forEach(t => { if (t.contractor_id) ctrSet.add(t.contractor_id); });

  // Issues count
  const issuesCount = feed.reduce((sum, l) => sum + (l.tags_issue || []).length, 0);

  // Teams on-site today — นับ distinct team_id จาก team_checkin entries ของวันนั้น
  // (อ่านตรงจาก 17_Activity_Logs filter source='team_checkin' + formatDateValue(date))
  const teamsMap = {}; // team_id -> { team_id, name, worker_count }
  try {
    const aSheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
    if (aSheet) {
      const aData = aSheet.getDataRange().getValues();
      for (let i = 1; i < aData.length; i++) {
        const r = aData[i];
        if (r[3] !== 'auto' || r[4] !== 'team_checkin') continue;
        if (formatDateValue(r[1]) !== date) continue;
        let m = {};
        try { m = JSON.parse(r[11] || '{}'); } catch (e) { m = {}; }
        const tid = String(m.team_id || '').trim();
        if (!tid) continue;
        if (m.action === 'out') continue; // ออกแล้วไม่นับว่าอยู่หน้างาน
        const wc = (m.worker_count === undefined || m.worker_count === null) ? null : Number(m.worker_count);
        teamsMap[tid] = {
          team_id: tid,
          name: m.team_name || tid,
          worker_count: (wc !== null && !isNaN(wc)) ? wc : null
        };
      }
    }
  } catch (e) {}
  const teamsOnsiteList = Object.keys(teamsMap).map(k => teamsMap[k]);

  return {
    date: date,
    logs_total: feed.length,
    logs_manual: manualCount,
    logs_auto: autoCount,
    tasks_done: tasks.length,
    transactions_total: txCount,
    received: recvCount,
    withdrawn: wdrCount,
    contractors_involved: ctrSet.size,
    issues_count: issuesCount,
    teams_onsite: teamsOnsiteList.length,
    teams_onsite_list: teamsOnsiteList
  };
}

/**
 * generate_daily_summary_v2 — AI summary using activity feed
 */
function generateDailySummaryV2(p) {
  const date = p.date || todayStr();
  const feed = getActivityFeed({ date: date, limit: 500 });
  const stats = getTodayStats({ date: date });

  if (feed.length === 0) {
    return {
      summary: 'ยังไม่มีกิจกรรมในวันที่ ' + date,
      stats: stats
    };
  }

  // Build chronological context (oldest first for narrative flow)
  const chrono = feed.slice().reverse();
  let context = `วันที่: ${date}\nรวม ${feed.length} เหตุการณ์\n\n`;
  chrono.forEach(log => {
    const time = String(log.timestamp || '').slice(11, 16);
    const tags = [];
    if (log.tags_ff.length) tags.push('FF: ' + log.tags_ff.join(','));
    if (log.tags_ctr.length) tags.push('ช่าง: ' + log.tags_ctr.join(','));
    if (log.tags_issue.length) tags.push('⚠ ' + log.tags_issue.join(','));
    context += `[${time}] ${log.text}${tags.length ? ' {' + tags.join(' | ') + '}' : ''}\n`;
  });

  const prompt = `คุณคือผู้ช่วยสรุปรายงานหน้างานก่อสร้าง สรุปกิจกรรมต่อไปนี้เป็นรายงานประจำวันสำหรับส่งผู้บริหาร

ข้อมูล:
${context}

สถิติ:
- งานเสร็จ: ${stats.tasks_done} task
- รับวัสดุ: ${stats.received} ครั้ง
- เบิกวัสดุ: ${stats.withdrawn} ครั้ง
- ช่างทำงาน: ${stats.contractors_involved} คน
- ปัญหา: ${stats.issues_count} เรื่อง

สรุปแบบนี้ (เป็นภาษาไทยกระชับ ไม่ใส่ markdown):
1. ภาพรวม (1-2 ประโยค)
2. ความคืบหน้าที่สำคัญ (FF ไหนทำอะไร)
3. การใช้วัสดุ (รับ/เบิก ที่สำคัญ)
4. ปัญหา/อุปสรรค (ถ้ามี)
5. ข้อเสนอแนะ (ถ้ามี)

ใช้ format:
ภาพรวม: ...
ความคืบหน้า: ...
วัสดุ: ...
ปัญหา: ...
ข้อเสนอแนะ: ...`;

  let summary = '';
  let aiError = null;

  // ลอง Gemini ก่อน — retry 1 ครั้งถ้าล้ม (handle transient errors)
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      summary = callGemini(prompt);
      if (summary && summary.trim()) { aiError = null; break; }
    } catch (err) {
      aiError = err.message;
      if (attempt === 1) Utilities.sleep(1500);  // wait then retry
    }
  }

  // ถ้า AI ล้มทั้ง 2 ครั้ง → fallback เป็น template summary จาก stats ดิบ
  if (!summary || !summary.trim()) {
    summary = _buildFallbackSummary_(date, feed, stats, aiError);
  }

  return {
    summary: summary,
    stats: stats,
    log_count: feed.length,
    ai_error: aiError  // เก็บไว้ debug ฝั่ง frontend
  };
}

/**
 * Fallback summary — เมื่อ AI ล้ม ใช้ template สรุปจาก stats + feed
 * ผู้ใช้จะเห็นข้อมูลพื้นฐานเสมอ ไม่ใช่ error เปล่า
 */
function _buildFallbackSummary_(date, feed, stats, aiError) {
  const tasksDone = stats.tasks_done || 0;
  const received = stats.received || 0;
  const withdrawn = stats.withdrawn || 0;
  const ctrCount = stats.contractors_involved || 0;
  const issues = feed.filter(l => (l.tags_issue || []).length > 0);

  let s = '⚠ AI สรุปไม่สำเร็จ — แสดงสรุปอัตโนมัติแทน\n\n';
  s += 'ภาพรวม: วันนี้มี ' + feed.length + ' เหตุการณ์';
  if (ctrCount > 0) s += ' · ช่างทำงาน ' + ctrCount + ' คน';
  s += '\n';
  s += 'ความคืบหน้า: ติ๊กงานเสร็จ ' + tasksDone + ' รายการ\n';
  s += 'วัสดุ: รับ ' + received + ' ครั้ง · เบิก ' + withdrawn + ' ครั้ง\n';
  s += 'ปัญหา: ' + issues.length + ' รายการ';
  if (issues.length > 0) {
    const issueTags = issues.slice(0, 3)
      .map(i => (i.tags_issue || []).join(', '))
      .filter(Boolean)
      .join('; ');
    if (issueTags) s += ' (' + issueTags + ')';
  }
  s += '\nข้อเสนอแนะ: -';
  if (aiError) s += '\n\n(เทคนิค: ' + aiError + ')';
  return s;
}


// ============================================================
// 🔄 AUTO-EVENT HOOKS — เพิ่มเข้า functions เดิม
// ============================================================
// (จะถูกเรียกจาก updateTask, receiveMaterial, withdrawMaterial, countMaterial)

/**
 * Hook: เมื่อ tick task done
 */
function hookTaskDone_(taskRow, newStatus) {
  try {
    if (newStatus === 'Done') {
      const taskName = taskRow['Task Name'] || taskRow.name || '';
      const ffCode = taskRow['FF Code'] || '';
      const phase = taskRow['Phase'] || '';
      autoLog_('✓ เสร็จ: ' + taskName + (ffCode ? ' (' + ffCode + ')' : ''), {
        tags_ff: ffCode ? [ffCode] : [],
        tags_phase: phase,
        meta: { task_id: taskRow['Task ID'] || taskRow.id, event: 'task_done' }
      });
    } else if (newStatus === 'Not Started') {
      const taskName = taskRow['Task Name'] || taskRow.name || '';
      const ffCode = taskRow['FF Code'] || '';
      autoLog_('↩️ ยกเลิกเสร็จ: ' + taskName + (ffCode ? ' (' + ffCode + ')' : ''), {
        tags_ff: ffCode ? [ffCode] : [],
        meta: { task_id: taskRow['Task ID'] || taskRow.id, event: 'task_undo' }
      });
    }
  } catch (e) {}
}

/**
 * Hook: เมื่อรับวัสดุ
 */
function hookReceive_(matId, qty, unit, matName, invoice) {
  try {
    let text = '📥 รับ ' + (matName || matId) + ' จำนวน ' + qty + ' ' + (unit || '');
    if (invoice) text += ' (บิล ' + invoice + ')';
    autoLog_(text, {
      meta: { mat_id: matId, qty: qty, event: 'receive' }
    });
  } catch (e) {}
}

/**
 * Hook: เมื่อเบิกวัสดุ
 */
function hookWithdraw_(matId, qty, unit, matName, ctrId, ctrName, ffCode) {
  try {
    let text = '📤 ' + (ctrName || ctrId || 'ไม่ระบุ') + ' เบิก ' + (matName || matId) + ' จำนวน ' + qty + ' ' + (unit || '');
    if (ffCode) text += ' → ' + ffCode;
    autoLog_(text, {
      tags_ff: ffCode ? [ffCode] : [],
      tags_ctr: ctrId ? [ctrId] : [],
      meta: { mat_id: matId, qty: qty, event: 'withdraw' }
    });
  } catch (e) {}
}

/**
 * Hook: เมื่อนับสต๊อก
 */
function hookCount_(matId, newStock, matName, unit, mode) {
  try {
    let text;
    if (mode === 'STATUS') {
      const lbls = ['🔴 หมด', '🟡 ใกล้หมด', '🔵 ใช้ได้', '🟢 เต็ม'];
      text = '📝 นับ ' + (matName || matId) + ' = ' + (lbls[Number(newStock)] || newStock);
    } else {
      text = '📝 นับ ' + (matName || matId) + ' = ' + newStock + ' ' + (unit || '');
    }
    autoLog_(text, {
      meta: { mat_id: matId, new_stock: newStock, event: 'count' }
    });
  } catch (e) {}
}



/**
 * 🚀 PERFORMANCE: Bundle endpoint
 * รวม 4 requests เป็น 1 → ลดเวลา 70%
 *
 * params:
 *   date - YYYY-MM-DD (default today)
 *   skip_refs - ถ้า true จะข้าม contractors+ff_list (ใช้กับครั้งที่ 2 เป็นต้นไปที่ cache แล้ว)
 */
function getDailyBundle(p) {
  const date = p.date || todayStr();
  const skipRefs = p.skip_refs === true || p.skip_refs === 'true';

  const bundle = {
    date: date,
    stats: null,
    feed: [],
    contractors: null,
    ffs: null,
    teams: null
  };

  try { bundle.stats = getTodayStats({ date: date }); } catch(e) { bundle.stats = { error: e.message }; }
  try { bundle.feed = getActivityFeed({ date: date }); } catch(e) { bundle.feed = []; }

  if (!skipRefs) {
    try { bundle.contractors = getAllRows(SHEET.CONTRACTORS); } catch(e) { bundle.contractors = []; }
    try { bundle.ffs = getFFList(); } catch(e) { bundle.ffs = []; }
    try { bundle.teams = getTeams({}); } catch(e) { bundle.teams = []; }
  }

  return bundle;
}


/**
 * 💾 PHASE 2.5: Save AI Summary to 07_Daily_Reports
 * บันทึก AI summary เข้า Daily Reports — ถ้ามีรายงานวันนั้นแล้ว update, ไม่มี create
 *
 * params:
 *   date - YYYY-MM-DD
 *   summary - ข้อความสรุป (แก้ไขแล้วได้)
 *   author - ชื่อผู้บันทึก (default 'Admin')
 */
function saveAiSummary(p) {
  ensureDailySheet_();
  const date = p.date || todayStr();
  const summary = String(p.summary || '').trim();
  const author = p.author || 'Admin';

  if (!summary) throw new Error('summary required');

  // Get today's stats to fill report fields
  let stats = {};
  try { stats = getTodayStats({ date: date }); } catch (e) {}

  // Check if a report already exists for this date
  const allReports = getAllRows(SHEET.DAILY);
  const existing = allReports.find(r => {
    let rDate = r.date;
    if (rDate instanceof Date) {
      const y = rDate.getFullYear();
      const m = String(rDate.getMonth() + 1).padStart(2, '0');
      const d = String(rDate.getDate()).padStart(2, '0');
      rDate = y + '-' + m + '-' + d;
    } else {
      rDate = String(rDate || '').slice(0, 10);
    }
    return rDate === date;
  });

  if (existing) {
    // Update existing report
    const updates = {
      summary_text: summary,
      tasks_done: stats.tasks_done || existing.tasks_done || 0,
      issues: (stats.issues_count || 0) + ' เรื่อง',
      ai_processed: true,
      updated_at: nowStr(),
    };
    updateRowByCol(SHEET.DAILY, 'id', existing.id, updates);
    return {
      ok: true,
      mode: 'updated',
      report_id: existing.id,
      date: date,
      summary: summary
    };
  }

  // Create new report
  const id = generateId('DR', SHEET.DAILY, 'id');
  const row = {
    id: id,
    project_id: p.project_id || 'bow-house',
    date: date,
    reporter_name: author,
    reporter_role: 'ADMIN',
    weather: '',
    tasks_done: stats.tasks_done || 0,
    workers_count: stats.contractors_involved || 0,
    workers_list: '',
    issues: (stats.issues_count || 0) + ' เรื่อง',
    summary_text: summary,
    ai_processed: true,
    created_at: nowStr(),
    updated_at: nowStr(),
  };
  appendRow(SHEET.DAILY, row);
  return {
    ok: true,
    mode: 'created',
    report_id: id,
    date: date,
    summary: summary
  };
}

/**
 * get_saved_summary — ดึง summary ที่ save แล้วของวันนั้น (ถ้ามี)
 */
function getSavedSummary(p) {
  ensureDailySheet_();
  const date = p.date || todayStr();
  const allReports = getAllRows(SHEET.DAILY);
  const found = allReports.find(r => {
    let rDate = r.date;
    if (rDate instanceof Date) {
      const y = rDate.getFullYear();
      const m = String(rDate.getMonth() + 1).padStart(2, '0');
      const d = String(rDate.getDate()).padStart(2, '0');
      rDate = y + '-' + m + '-' + d;
    } else {
      rDate = String(rDate || '').slice(0, 10);
    }
    return rDate === date;
  });

  if (found && found.summary_text) {
    return {
      exists: true,
      report_id: found.id,
      summary: found.summary_text,
      author: found.reporter_name,
      saved_at: found.updated_at || found.created_at
    };
  }
  return { exists: false };
}


// ============================================================
// 🎯 PHASE 1A: AUTO-TICK TASK FROM LOG
// ============================================================

/**
 * suggest_task_from_log — วิเคราะห์ log text → หา task ที่ควรติ๊ก
 *
 * params:
 *   text - ข้อความ log
 *   tags_ff - (optional) FF codes ที่ AI หาเจอแล้ว เช่น "F-03"
 *   ff_code - (optional, Smart Daily ขั้น 3) FF ที่ผู้ใช้ "เลือก" จาก chip
 *             (string เดี่ยว, csv หรือ array) — scope candidate task เฉพาะ FF
 *             นั้น (status != Done) ก่อนส่งให้ AI → แม่นขึ้น ลด false positive.
 *             ไม่ส่ง = พฤติกรรมเดิม (backward compatible 100%)
 *
 * returns:
 *   { has_suggestion, confidence, candidates: [...], reason }
 */
function suggestTaskFromLog(p) {
  if (!p.text) throw new Error('text required');
  const text = String(p.text);

  // ── Step 1: หา FF codes จาก param (tags_ff / ff_code) หรือ text ──────
  // helper: normalize "F3" / "f-03" → "F-03" pattern เดียวกับ regex ด้านล่าง
  function normFf_(v) {
    return String(v).trim().toUpperCase().replace(/^F-?/, 'F-');
  }
  function toFfList_(v) {
    if (v === undefined || v === null || v === '') return [];
    return (Array.isArray(v) ? v : String(v).split(','))
      .map(s => String(s).trim()).filter(Boolean).map(normFf_);
  }

  let ffCodes = [];
  // p.tags_ff (เดิม) — คง pattern เดิมไว้ แต่ normalize ให้ตรงกับ ff_code/regex
  toFfList_(p.tags_ff).forEach(c => { if (ffCodes.indexOf(c) < 0) ffCodes.push(c); });
  // p.ff_code (ใหม่) — FF ที่ผู้ใช้เลือกจาก chip (deterministic scope)
  toFfList_(p.ff_code).forEach(c => { if (ffCodes.indexOf(c) < 0) ffCodes.push(c); });
  // เผื่อ text มี F-XX ตรงๆ
  const ffMatches = text.match(/F-?\d{1,2}/gi) || [];
  ffMatches.forEach(m => {
    const norm = m.toUpperCase().replace(/^F-?/, 'F-');
    if (ffCodes.indexOf(norm) < 0) ffCodes.push(norm);
  });

  // ── Step 2: เช็คว่า text สื่อถึง "เสร็จ" ไหม ──────────────
  const doneKeywords = ['เสร็จ', 'เรียบร้อย', 'done', 'จบ', 'ปิดงาน', 'สำเร็จ', 'ทำเสร็จ', 'ออเค', 'โอเค', 'ผ่าน'];
  const hasDoneWord = doneKeywords.some(k => text.toLowerCase().indexOf(k.toLowerCase()) >= 0);

  if (!hasDoneWord) {
    return {
      has_suggestion: false,
      reason: 'ไม่พบคำที่สื่อถึงงานเสร็จ',
      candidates: []
    };
  }

  // ── Step 3: ดึง tasks ที่ยังไม่เสร็จ ───────────────────────
  const allTasks = getAllRows(SHEET.TASKS);
  let pool = allTasks.filter(t => {
    const status = String(t['Status'] || '');
    return status !== 'Done' && status !== 'เสร็จ';
  });

  // ถ้ามี FF code → filter เฉพาะ FF นั้น
  if (ffCodes.length > 0) {
    pool = pool.filter(t => ffCodes.indexOf(String(t['FF Code'] || '')) >= 0);
  }

  if (pool.length === 0) {
    return {
      has_suggestion: false,
      reason: ffCodes.length > 0
        ? 'ไม่พบ task ที่ค้างอยู่ใน ' + ffCodes.join(', ')
        : 'ไม่พบ task ที่ค้างอยู่',
      candidates: []
    };
  }

  // ── Step 4: ให้ AI จับคู่ text กับ task ────────────────────
  const taskListStr = pool.map(t =>
    `${t['Task ID']}|${t['FF Code']}|${t['Task Name']}|${t['Phase']||''}`
  ).join('\n');

  const prompt = `คุณคือผู้ช่วยจับคู่บันทึกหน้างานก่อสร้างกับ task ที่ควรติ๊กว่าเสร็จ

ข้อความบันทึก:
"${text}"

รายการ task ที่ยังไม่เสร็จ (TaskID|FFCode|TaskName|Phase):
${taskListStr}

วิเคราะห์ว่าข้อความนี้สื่อถึง task ไหนที่ทำเสร็จ คืน JSON เท่านั้น:
{
  "matches": [
    { "task_id": "...", "confidence": 0.0-1.0, "why": "เหตุผลสั้นๆ" }
  ],
  "overall_confidence": 0.0-1.0
}

กฎ:
- จับคู่ด้วยความหมาย เช่น "ไฟ/ไฟฟ้า/เดินไฟ" → task ที่มีคำว่า "สายไฟ" หรือ "ไฟฟ้า"
- "กรุไม้/กรุโครง" → task กรุโครงไม้
- "สี/พ่นสี/ทาสี" → task เกี่ยวกับสี
- ถ้าตรงหลาย task ใส่ได้หลายอัน เรียงจาก confidence สูงสุด
- ถ้าไม่ตรงเลย → matches: []
- confidence: 0.9+ ถ้าชื่อตรงมาก, 0.7-0.9 ถ้าเดาได้จากบริบท, ต่ำกว่า 0.65 ถ้าไม่มั่นใจ
- ใส่เฉพาะ task ที่ confidence >= 0.5`;

  let aiResp;
  try {
    aiResp = callGeminiJSON_(prompt);
  } catch (e) {
    return {
      has_suggestion: false,
      reason: 'AI วิเคราะห์ไม่สำเร็จ: ' + e.message,
      candidates: []
    };
  }

  const matches = (aiResp && aiResp.matches) || [];
  if (matches.length === 0) {
    return {
      has_suggestion: false,
      reason: 'AI ไม่พบ task ที่ตรงกับข้อความ',
      candidates: []
    };
  }

  // ── Step 5: ประกอบผลลัพธ์ + เติมรายละเอียด task ───────────
  const candidates = matches
    .filter(m => Number(m.confidence) >= 0.5)
    .map(m => {
      const task = pool.find(t => String(t['Task ID']) === String(m.task_id));
      if (!task) return null;
      return {
        task_id: task['Task ID'],
        task_name: task['Task Name'],
        ff_code: task['FF Code'],
        phase: task['Phase'] || '',
        status: task['Status'] || '',
        confidence: Number(m.confidence),
        why: m.why || ''
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.confidence - a.confidence);

  if (candidates.length === 0) {
    return { has_suggestion: false, reason: 'ความมั่นใจต่ำเกินไป', candidates: [] };
  }

  return {
    has_suggestion: true,
    confidence: candidates[0].confidence,
    overall_confidence: aiResp.overall_confidence || candidates[0].confidence,
    candidates: candidates,
    ff_codes: ffCodes
  };
}

/**
 * confirm_task_tick — ติ๊ก task ว่าเสร็จ (หลังผู้ใช้ยืนยันใน modal)
 *
 * params:
 *   task_id - Task ID ที่จะติ๊ก
 *   done_date - (optional) วันที่เสร็จ
 *
 * returns: { ok, task_id, task_name }
 */
function confirmTaskTick(p) {
  if (!p.task_id) throw new Error('task_id required');

  const allTasks = getAllRows(SHEET.TASKS);
  const task = allTasks.find(t => String(t['Task ID']) === String(p.task_id));
  if (!task) throw new Error('ไม่พบ task: ' + p.task_id);

  // อัพเดท status เป็น Done
  const updates = {
    'Status': 'Done',
    'Done Date': p.done_date || todayStr()
  };
  updateRowByCol(SHEET.TASKS, 'Task ID', p.task_id, updates);

  // 🔗 Auto-log ลง activity feed
  try {
    const updatedTask = Object.assign({}, task, updates);
    hookTaskDone_(updatedTask, 'Done');
  } catch (e) {}

  // 📷 ถ้ามีรูปจาก log → ผูกรูปเข้า task (13_Task_Photos)
  let photoLinked = false;
  if (p.photo_url) {
    try {
      addPhoto({
        task_id: p.task_id,
        drive_url: p.photo_url,
        drive_id: p.photo_drive_id || '',
        caption: 'หลักฐานงาน: ' + (task['Task Name'] || ''),
        uploaded_by: p.uploaded_by || 'admin'
      });
      photoLinked = true;
    } catch (e) {}
  }

  return {
    ok: true,
    task_id: p.task_id,
    task_name: task['Task Name'],
    ff_code: task['FF Code'],
    photo_linked: photoLinked
  };
}


/**
 * 🔍 PHASE 1C: Stock check for material items (pre-confirm warning)
 * เช็ค stock + BOQ ก่อนยืนยัน เพื่อเตือน user ล่วงหน้า
 *
 * params: items - JSON string หรือ array ของ material items
 * returns: { warnings: [...], all_ok }
 */
function checkStockForItems(p) {
  let items = p.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (e) { items = []; }
  }
  if (!Array.isArray(items)) items = [];

  const warnings = [];

  items.forEach((it, idx) => {
    if (it.type !== 'เบิก') return; // เช็คเฉพาะการเบิก
    if (!it.material_id) return;

    const mat = findRowByCol(SHEET.MATERIALS, 'id', it.material_id);
    if (!mat) {
      warnings.push({
        index: idx,
        level: 'error',
        material_name: it.material_name || it.material_id,
        message: 'ไม่พบวัสดุนี้ในระบบ'
      });
      return;
    }

    const matObj = {};
    mat.headers.forEach((h, i) => { matObj[h] = mat.values[i]; });

    const isStatus = matObj.tracking_mode === 'STATUS';
    if (isStatus) return; // STATUS mode ไม่มี stock

    const currentStock = Number(matObj.current_stock || 0);
    const qty = Number(it.quantity || 0);

    // เช็ค stock ไม่พอ
    if (qty > currentStock) {
      warnings.push({
        index: idx,
        level: 'error',
        material_name: matObj.name,
        message: 'เบิก ' + qty + ' ' + matObj.unit +
                 ' แต่เหลือแค่ ' + currentStock + ' ' + matObj.unit,
        current_stock: currentStock,
        requested: qty
      });
    } else if (qty > currentStock * 0.8 && currentStock > 0) {
      // เตือนถ้าเบิกแล้วเหลือน้อย
      warnings.push({
        index: idx,
        level: 'warning',
        material_name: matObj.name,
        message: 'เบิกแล้วจะเหลือ ' + (currentStock - qty) + ' ' + matObj.unit + ' (น้อย)',
        current_stock: currentStock,
        requested: qty
      });
    }

    // เช็ค BOQ ถ้ามี ff_code
    if (it.ff_code) {
      try {
        const boqCheck = checkBoqForWithdrawal(it.material_id, it.ff_code, qty);
        if (boqCheck && boqCheck.is_over) {
          warnings.push({
            index: idx,
            level: 'warning',
            material_name: matObj.name,
            message: 'เบิกเกิน BOQ ที่วางแผนไว้สำหรับ ' + it.ff_code
          });
        }
      } catch (e) {}
    }
  });

  return {
    warnings: warnings,
    all_ok: warnings.filter(w => w.level === 'error').length === 0,
    has_warnings: warnings.length > 0
  };
}


// ============================================================
// 🆕 PHASE 1: DETECT UNKNOWN CONTRACTORS / MATERIALS
// ============================================================

/**
 * detect_unknowns — วิเคราะห์ log text หาช่าง/วัสดุที่ระบบไม่รู้จัก
 *
 * params: text - ข้อความ log
 * returns: {
 *   unknown_contractors: [{ mentioned, suggested_type }],
 *   unknown_materials: [{ mentioned, suggested_unit }]
 * }
 */
function detectUnknowns(p) {
  if (!p.text) throw new Error('text required');
  const text = String(p.text);

  // ── ดึงรายการที่มีอยู่ ──────────────────────────────
  const contractors = getAllRows(SHEET.CONTRACTORS)
    .filter(c => c.active !== false);
  const materials = getMaterials();

  const ctrNames = contractors.map(c => c.name).join(', ');
  const matNames = materials.map(m => m.name).join(', ');

  // ── ให้ AI วิเคราะห์ ────────────────────────────────
  const prompt =
'คุณคือผู้ช่วยตรวจจับ "ช่าง" และ "วัสดุ" ที่ยังไม่มีในระบบก่อสร้าง\n\n' +
'ข้อความบันทึกหน้างาน:\n"' + text + '"\n\n' +
'## ช่างที่มีในระบบแล้ว:\n' + (ctrNames || '(ไม่มี)') + '\n\n' +
'## วัสดุที่มีในระบบแล้ว:\n' + (matNames || '(ไม่มี)') + '\n\n' +
'## คำสั่ง:\n' +
'หาช่างหรือวัสดุที่ถูกกล่าวถึงในข้อความ แต่ยังไม่มีในระบบ\n' +
'- ถ้าชื่อตรงหรือใกล้เคียงกับที่มีอยู่แล้ว = ไม่ใช่ของใหม่ (ข้าม)\n' +
'- ระวังคำที่เป็น "อาชีพ" ไม่ใช่ชื่อคน เช่น "ช่างสี" "ช่างไฟ" อาจเป็นตำแหน่ง — ใส่มาได้แต่ mark ไว้\n\n' +
'## คืน JSON เท่านั้น (ไม่ต้อง markdown):\n' +
'{\n' +
'  "unknown_contractors": [\n' +
'    { "mentioned": "ช่างสมชาย", "suggested_type": "ช่างทั่วไป", "is_likely_role": false }\n' +
'  ],\n' +
'  "unknown_materials": [\n' +
'    { "mentioned": "สีกันสนิม", "suggested_unit": "ถัง" }\n' +
'  ]\n' +
'}\n\n' +
'กฎ:\n' +
'- suggested_type: เดาประเภทช่าง (ช่างไม้/ช่างสี/ช่างไฟ/ช่างทั่วไป)\n' +
'- is_likely_role: true ถ้าน่าจะเป็นอาชีพมากกว่าชื่อคน\n' +
'- suggested_unit: เดาหน่วยวัสดุ (ถัง/แผ่น/กล่อง/ชิ้น/เส้น/กิโลกรัม)\n' +
'- ถ้าไม่มีของใหม่เลย คืน array ว่าง';

  let aiResp;
  try {
    aiResp = callGeminiJSON_(prompt);
  } catch (e) {
    return { unknown_contractors: [], unknown_materials: [], error: e.message };
  }

  return {
    unknown_contractors: (aiResp && aiResp.unknown_contractors) || [],
    unknown_materials: (aiResp && aiResp.unknown_materials) || []
  };
}


// ============================================================
// 👷 TEAM SYSTEM — Teams, Contracts, Milestones, Staff
// ============================================================

/**
 * get_teams_bundle — ดึงข้อมูลทั้งหมดของระบบ Team ในครั้งเดียว
 * returns: { teams, contracts, milestones, staff }
 */
function getTeamsBundle(p) {
  const teams = getAllRows(SHEET.TEAMS)
    .filter(t => t.active !== false && t.active !== 'FALSE')
    .map(t => ({
      team_id: t.team_id,
      name: t.name,
      type: t.type,
      lead_name: t.lead_name,
      phone: t.phone || '',
      category: t.category || 'contractor',
      members: t.members || '',
      notes: t.notes || ''
    }));

  const contracts = getAllRows(SHEET.CONTRACTS).map(c => ({
    contract_id: c.contract_id,
    team_id: c.team_id,
    contract_no: c.contract_no || '',
    type: c.type || 'main',
    title: c.title || '',
    value: Number(c.value || 0),
    sign_date: formatDateValue(c.sign_date),
    paid_total: Number(c.paid_total || 0),
    tax_pct: Number(c.tax_pct || 0),
    file_link: c.file_link || '',
    parent_id: c.parent_id || '',
    status: c.status || 'active',
    notes: c.notes || ''
  }));

  const milestones = getAllRows(SHEET.MILESTONES).map(m => ({
    milestone_id: m.milestone_id,
    contract_id: m.contract_id,
    seq: Number(m.seq || 0),
    name: m.name || '',
    condition: m.condition || '',
    pct: Number(m.pct || 0),
    amount: Number(m.amount || 0),
    status: m.status || 'pending',
    paid_amount: Number(m.paid_amount || 0),
    paid_date: formatDateValue(m.paid_date),
    evidence_status: m.evidence_status || 'none',
    notes: m.notes || ''
  }));

  // Payment slips (all)
  let paymentSlips = [];
  try {
    paymentSlips = getAllRows(SHEET.PAYMENT_SLIPS).map(s => ({
      slip_id: s.slip_id,
      milestone_id: s.milestone_id,
      contract_id: s.contract_id,
      url: s.url,
      name: s.name || '',
      file_type: s.file_type || 'file'
    }));
  } catch (e) {}

  const staff = getAllRows(SHEET.STAFF)
    .filter(s => s.active !== false && s.active !== 'FALSE')
    .map(s => ({
      staff_id: s.staff_id,
      name: s.name,
      role: s.role || '',
      phone: s.phone || '',
      notes: s.notes || ''
    }));

  // Contract files (all)
  let contractFiles = [];
  try {
    contractFiles = getAllRows(SHEET.CONTRACT_FILES).map(f => ({
      file_id: f.file_id,
      contract_id: f.contract_id,
      url: f.url,
      name: f.name || '',
      file_type: f.file_type || 'file'
    }));
  } catch (e) {}

  return { teams: teams, contracts: contracts, milestones: milestones,
           staff: staff, contract_files: contractFiles, payment_slips: paymentSlips };
}

/**
 * get_teams — list ทีมที่ active (สำหรับ Smart Daily Input team chip)
 * คืนเฉพาะ field ที่ frontend ต้องใช้: team_id, name, type, lead_name
 * reuse logic ส่วน teams จาก getTeamsBundle (ไม่เขียน getAllRows ซ้ำซ้อน)
 */
function getTeams(p) {
  // คืน array ดิบ — route()/handle() จะ wrap เป็น {ok,data} ให้เอง
  // (consistent กับ getTodayStats ฯลฯ ที่คืน payload ดิบ ไม่ wrap ซ้อน)
  return getAllRows(SHEET.TEAMS)
    .filter(t => t.active !== false && t.active !== 'FALSE')
    .map(t => ({
      team_id: t.team_id,
      name: t.name,
      type: t.type || '',
      lead_name: t.lead_name || ''
    }));
}

/**
 * team_checkin — บันทึกว่าทีมเข้า/ออกหน้างานในวันนั้น
 * เก็บเป็น entry ใน 17_Activity_Logs ชนิด type='auto' source='team_checkin'
 * (query กลับได้ชัดผ่าน source — ไม่กระทบ type filter ของ feed/stats เดิม)
 *
 * params:
 *   team_id      - จำเป็น
 *   date         - YYYY-MM-DD (default todayStr)
 *   worker_count - จำนวนคน (optional ตัวเลข)
 *   action       - 'in' | 'out' (optional, default 'in')
 *
 * กันเช็คอินซ้ำทีม/วันเดียวกัน: ถ้ามี entry team_checkin ของ team_id+date อยู่แล้ว
 * → อัปเดต text + meta_json (worker_count/action) ไม่สร้าง row ใหม่
 */
function teamCheckin(p) {
  if (!p.team_id) throw new Error('team_id required');
  const teamId = String(p.team_id).trim();
  const date = p.date || todayStr();
  const action = (p.action === 'out') ? 'out' : 'in';
  const workerCount = (p.worker_count === undefined || p.worker_count === null ||
                       p.worker_count === '') ? null : Number(p.worker_count);

  // หาชื่อทีมจาก 21_Teams (fallback = team_id ถ้าไม่เจอ)
  let teamName = teamId;
  try {
    const team = getAllRows(SHEET.TEAMS).find(t => String(t.team_id) === teamId);
    if (team && team.name) teamName = team.name;
  } catch (e) {}

  // ข้อความ human-readable ให้โผล่ใน feed ได้สวย
  const verb = (action === 'out') ? 'ออกจากหน้างาน' : 'เข้าหน้างาน';
  const cntStr = (workerCount !== null && !isNaN(workerCount)) ? ` (${workerCount} คน)` : '';
  const text = '👷 ' + teamName + ' ' + verb + cntStr;

  const meta = {
    event: 'team_checkin',
    team_id: teamId,
    team_name: teamName,
    worker_count: (workerCount !== null && !isNaN(workerCount)) ? workerCount : null,
    action: action
  };

  ensureActivitySheet_();
  const sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
  if (!sheet) throw new Error('Sheet 17_Activity_Logs not found');

  // กันซ้ำ: หา row team_checkin ของ team_id เดียวกัน + วันเดียวกัน
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const r = data[i];
    if (r[3] !== 'auto' || r[4] !== 'team_checkin') continue;
    if (formatDateValue(r[1]) !== date) continue;
    let m = {};
    try { m = JSON.parse(r[11] || '{}'); } catch (e) { m = {}; }
    if (String(m.team_id || '') !== teamId) continue;

    // เจอแล้ว → อัปเดต text(col 6) + meta_json(col 12) ไม่สร้าง entry ใหม่
    const rowNum = i + 1;
    sheet.getRange(rowNum, 6).setValue(text);
    sheet.getRange(rowNum, 12).setValue(JSON.stringify(meta));
    return {
      ok: true,
      updated: true,
      log_id: r[0],
      team_id: teamId,
      team_name: teamName,
      date: date,
      action: action,
      worker_count: meta.worker_count
    };
  }

  // ไม่ซ้ำ → append entry ใหม่ ผ่าน helper เดิม
  const logged = appendActivityLog_({
    type: 'auto',
    source: 'team_checkin',
    text: text,
    date: date,
    meta: meta
  });

  return {
    ok: true,
    updated: false,
    log_id: logged.log_id,
    team_id: teamId,
    team_name: teamName,
    date: date,
    action: action,
    worker_count: meta.worker_count
  };
}

/**
 * create_team — เพิ่มทีมใหม่
 */
function createTeam(p) {
  if (!p.name) throw new Error('name required');
  const id = generateId('T', SHEET.TEAMS, 'team_id');
  const row = {
    team_id: id,
    name: p.name,
    type: p.type || '',
    lead_name: p.lead_name || '',
    phone: p.phone || '',
    category: p.category || 'contractor',
    members: p.members || '',
    active: true,
    notes: p.notes || '',
    created_at: todayStr()
  };
  appendRow(SHEET.TEAMS, row);
  return { ok: true, team: row };
}

/**
 * update_team — แก้ข้อมูลทีม
 */
function updateTeam(p) {
  if (!p.team_id) throw new Error('team_id required');
  const updates = {};
  ['name', 'type', 'lead_name', 'phone', 'members', 'notes'].forEach(f => {
    if (p[f] !== undefined) updates[f] = p[f];
  });
  if (p.active !== undefined) updates.active = p.active;
  updateRowByCol(SHEET.TEAMS, 'team_id', p.team_id, updates);
  return { ok: true, team_id: p.team_id };
}

/**
 * create_contract — เพิ่มสัญญา (หลัก หรือ งานเพิ่ม)
 */
function createContract(p) {
  if (!p.team_id) throw new Error('team_id required');
  const id = generateId('CT', SHEET.CONTRACTS, 'contract_id');
  const row = {
    contract_id: id,
    team_id: p.team_id,
    contract_no: p.contract_no || '',
    type: p.type || 'main',
    title: p.title || '',
    value: Number(p.value || 0),
    sign_date: p.sign_date || todayStr(),
    paid_total: Number(p.paid_total || 0),
    tax_pct: Number(p.tax_pct || 0),
    file_link: p.file_link || '',
    parent_id: p.parent_id || '',
    status: p.status || 'active',
    notes: p.notes || '',
    created_at: todayStr()
  };
  appendRow(SHEET.CONTRACTS, row);
  return { ok: true, contract: row };
}

/**
 * update_contract — แก้สัญญา
 */
function updateContract(p) {
  if (!p.contract_id) throw new Error('contract_id required');
  const updates = {};
  ['contract_no', 'title', 'file_link', 'status', 'notes'].forEach(f => {
    if (p[f] !== undefined) updates[f] = p[f];
  });
  if (p.value !== undefined) updates.value = Number(p.value);
  if (p.paid_total !== undefined) updates.paid_total = Number(p.paid_total);
  if (p.sign_date !== undefined) updates.sign_date = p.sign_date;
  updateRowByCol(SHEET.CONTRACTS, 'contract_id', p.contract_id, updates);
  return { ok: true, contract_id: p.contract_id };
}

/**
 * create_milestone — เพิ่มงวด
 */
function createMilestone(p) {
  if (!p.contract_id) throw new Error('contract_id required');
  const id = generateId('MS', SHEET.MILESTONES, 'milestone_id');
  const row = {
    milestone_id: id,
    contract_id: p.contract_id,
    seq: Number(p.seq || 0),
    name: p.name || '',
    condition: p.condition || '',
    pct: Number(p.pct || 0),
    amount: Number(p.amount || 0),
    status: p.status || 'pending',
    paid_amount: Number(p.paid_amount || 0),
    paid_date: p.paid_date || '',
    notes: p.notes || ''
  };
  appendRow(SHEET.MILESTONES, row);
  return { ok: true, milestone: row };
}

/**
 * update_milestone — อัพเดทสถานะงวด (จ่ายเงิน/ครบ/ค้าง)
 * เมื่ออัพเดท → คำนวณ paid_total ของสัญญาใหม่ด้วย
 */
function updateMilestone(p) {
  if (!p.milestone_id) throw new Error('milestone_id required');
  const updates = {};
  ['name', 'condition', 'notes'].forEach(f => {
    if (p[f] !== undefined) updates[f] = p[f];
  });
  if (p.status !== undefined) updates.status = p.status;
  if (p.amount !== undefined) updates.amount = Number(p.amount);
  if (p.pct !== undefined) updates.pct = Number(p.pct);
  if (p.paid_amount !== undefined) updates.paid_amount = Number(p.paid_amount);
  if (p.paid_date !== undefined) updates.paid_date = p.paid_date;
  if (p.evidence_status !== undefined) {
    updates.evidence_status = p.evidence_status;
    // กัน column หาย — สร้างให้อัตโนมัติถ้ายังไม่มี
    ensureColumn_(SHEET.MILESTONES, 'evidence_status');
  }

  updateRowByCol(SHEET.MILESTONES, 'milestone_id', p.milestone_id, updates);

  // Recalculate contract paid_total from all its milestones
  if (p.contract_id) {
    try {
      const allMs = getAllRows(SHEET.MILESTONES)
        .filter(m => m.contract_id === p.contract_id);
      const totalPaid = allMs.reduce((sum, m) => sum + Number(m.paid_amount || 0), 0);
      updateRowByCol(SHEET.CONTRACTS, 'contract_id', p.contract_id,
        { paid_total: totalPaid });
    } catch (e) {}
  }

  return { ok: true, milestone_id: p.milestone_id };
}

/**
 * create_staff — เพิ่มทีมงานบริษัท
 */
function createStaff(p) {
  if (!p.name) throw new Error('name required');
  const id = generateId('ST', SHEET.STAFF, 'staff_id');
  const row = {
    staff_id: id,
    name: p.name,
    role: p.role || '',
    phone: p.phone || '',
    active: true,
    notes: p.notes || '',
    created_at: todayStr()
  };
  appendRow(SHEET.STAFF, row);
  return { ok: true, staff: row };
}

/**
 * update_staff — แก้ข้อมูลทีมงาน
 */
function updateStaff(p) {
  if (!p.staff_id) throw new Error('staff_id required');
  const updates = {};
  ['name', 'role', 'phone', 'notes'].forEach(f => {
    if (p[f] !== undefined) updates[f] = p[f];
  });
  if (p.active !== undefined) updates.active = p.active;
  updateRowByCol(SHEET.STAFF, 'staff_id', p.staff_id, updates);
  return { ok: true, staff_id: p.staff_id };
}


// ============================================================
// 👥 PROJECT STAFF — assign คนในบริษัทเข้าโปรเจค (27_Project_Staff)
// many-to-many ระหว่าง 01_Project_Info ↔ 24_Staff
// schema: assignment_id, project_id, staff_id, role_in_project, assigned_date, active
// soft delete (active=false) ไม่ลบ row จริง — กัน history สูญหาย
// ============================================================
function ensureProjectStaffSheet_() {
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  let sheet = ss.getSheetByName(SHEET.PROJECT_STAFF);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET.PROJECT_STAFF);
    sheet.appendRow([
      'assignment_id', 'project_id', 'staff_id',
      'role_in_project', 'assigned_date', 'active'
    ]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold')
         .setBackground('#1F3864').setFontColor('#fff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * get_all_staff — list ทุกคนที่ active=true (สำหรับ picker ใน team.html)
 */
function getAllStaff() {
  return getAllRows(SHEET.STAFF)
    .filter(s => s.active !== false && s.active !== 'FALSE')
    .map(s => ({
      staff_id: s.staff_id,
      name: s.name,
      role: s.role || '',
      phone: s.phone || '',
      notes: s.notes || ''
    }));
}

/**
 * get_project_staff — รายชื่อคนที่ assign ในโปรเจคนี้ (join 24_Staff ให้ชื่อ/role)
 */
function getProjectStaff(projectId) {
  if (!projectId) return [];
  ensureProjectStaffSheet_();
  const assignments = getAllRows(SHEET.PROJECT_STAFF)
    .filter(a =>
      String(a.project_id) === String(projectId) &&
      a.active !== false && a.active !== 'FALSE'
    );
  if (assignments.length === 0) return [];

  // join กับ 24_Staff เพื่อ enrich data
  const staffMap = {};
  getAllRows(SHEET.STAFF).forEach(s => { staffMap[s.staff_id] = s; });

  return assignments.map(a => {
    const s = staffMap[a.staff_id] || {};
    return {
      assignment_id: a.assignment_id,
      project_id: a.project_id,
      staff_id: a.staff_id,
      name: s.name || '(ไม่พบข้อมูล)',
      role: s.role || '',
      phone: s.phone || '',
      role_in_project: a.role_in_project || '',
      assigned_date: formatDateValue(a.assigned_date)
    };
  });
}

/**
 * assign_project_staff — เพิ่มคนเข้าโปรเจค
 * ป้องกัน duplicate (project_id + staff_id ซ้ำ & active=true) → ตอบ existing ID
 */
function assignProjectStaff(p) {
  if (!p.project_id) throw new Error('project_id required');
  if (!p.staff_id) throw new Error('staff_id required');
  ensureProjectStaffSheet_();

  // กัน duplicate
  const existing = getAllRows(SHEET.PROJECT_STAFF).find(a =>
    String(a.project_id) === String(p.project_id) &&
    String(a.staff_id) === String(p.staff_id) &&
    a.active !== false && a.active !== 'FALSE'
  );
  if (existing) return { ok: true, assignment_id: existing.assignment_id, duplicate: true };

  const id = generateId('AS', SHEET.PROJECT_STAFF, 'assignment_id');
  const row = {
    assignment_id: id,
    project_id: p.project_id,
    staff_id: p.staff_id,
    role_in_project: p.role_in_project || '',
    assigned_date: todayStr(),
    active: true
  };
  appendRow(SHEET.PROJECT_STAFF, row);
  return { ok: true, assignment_id: id };
}

/**
 * unassign_project_staff — soft delete (active=false) ไม่ลบ row จริง
 */
function unassignProjectStaff(assignmentId) {
  if (!assignmentId) throw new Error('assignment_id required');
  ensureProjectStaffSheet_();
  updateRowByCol(SHEET.PROJECT_STAFF, 'assignment_id', assignmentId, { active: false });
  return { ok: true, assignment_id: assignmentId };
}


/**
 * upload_contract_file — อัปโหลดไฟล์สัญญา (รูป หรือ PDF) ขึ้น Drive
 * แล้วบันทึก link เข้า contract
 *
 * params:
 *   contract_id  - สัญญาที่จะแนบไฟล์
 *   file_base64  - "data:image/jpeg;base64,..." หรือ "data:application/pdf;base64,..."
 *   file_name    - ชื่อไฟล์ (optional)
 *
 * returns: { ok, file_url }
 */
function uploadContractFile(p) {
  if (!p.contract_id) throw new Error('contract_id required');
  if (!p.file_base64) throw new Error('file_base64 required');

  let b64 = String(p.file_base64);
  let mimeType = 'application/octet-stream';
  let ext = 'bin';
  let fileType = 'file';

  // Parse data URI — รองรับทั้ง image/* และ application/pdf
  const m = b64.match(/^data:([\w\/\-\.]+);base64,(.+)$/);
  if (m) {
    mimeType = m[1];
    b64 = m[2];
  }

  // กำหนดนามสกุลไฟล์จาก mime
  if (mimeType.indexOf('pdf') >= 0) { ext = 'pdf'; fileType = 'pdf'; }
  else if (mimeType.indexOf('jpeg') >= 0 || mimeType.indexOf('jpg') >= 0) { ext = 'jpg'; fileType = 'image'; }
  else if (mimeType.indexOf('png') >= 0) { ext = 'png'; fileType = 'image'; }
  else if (mimeType.indexOf('image') >= 0) { ext = 'jpg'; fileType = 'image'; }
  else throw new Error('รองรับเฉพาะไฟล์รูปภาพ หรือ PDF เท่านั้น');

  // เก็บใน folder "contracts"
  const folder = getDriveFolder_('contracts');
  const fileName = (p.file_name || ('contract_' + p.contract_id)) + '_' + Date.now() + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const driveId = file.getId();
  const fileUrl = 'https://drive.google.com/file/d/' + driveId + '/view';

  // บันทึกเข้า sheet 25_ContractFiles (รองรับหลายไฟล์)
  const fileId = generateId('CF', SHEET.CONTRACT_FILES, 'file_id');
  appendRow(SHEET.CONTRACT_FILES, {
    file_id: fileId,
    contract_id: p.contract_id,
    url: fileUrl,
    drive_id: driveId,
    name: p.file_name || ('สัญญา ' + fileId),
    file_type: fileType,
    uploaded_at: nowStr(),
    uploaded_by: p.uploaded_by || 'admin'
  });

  // อัพเดท contract.file_link = ไฟล์ล่าสุด (เพื่อ backward compat)
  try {
    updateRowByCol(SHEET.CONTRACTS, 'contract_id', p.contract_id, { file_link: fileUrl });
  } catch (e) {}

  return { ok: true, file_id: fileId, file_url: fileUrl };
}

/**
 * get_contract_files — ดึงไฟล์ทั้งหมดของสัญญา
 */
function getContractFiles(p) {
  if (!p.contract_id) throw new Error('contract_id required');
  const files = getAllRows(SHEET.CONTRACT_FILES)
    .filter(f => String(f.contract_id) === String(p.contract_id))
    .map(f => ({
      file_id: f.file_id,
      contract_id: f.contract_id,
      url: f.url,
      drive_id: f.drive_id,
      name: f.name || '',
      file_type: f.file_type || 'file',
      uploaded_at: formatDateValue(f.uploaded_at)
    }));
  return { files: files };
}

/**
 * delete_contract_file — ลบไฟล์สัญญา (ลบจาก sheet + ย้าย Drive file ไป trash)
 */
function deleteContractFile(p) {
  if (!p.file_id) throw new Error('file_id required');

  const found = findRowByCol(SHEET.CONTRACT_FILES, 'file_id', p.file_id);
  if (!found) throw new Error('ไม่พบไฟล์: ' + p.file_id);

  // หา drive_id เพื่อลบไฟล์จริง
  const driveIdIdx = found.headers.indexOf('drive_id');
  const driveId = driveIdIdx >= 0 ? found.values[driveIdIdx] : '';

  // ลบ row จาก sheet
  const sh = getSheet(SHEET.CONTRACT_FILES);
  sh.deleteRow(found.rowIndex);

  // ย้าย Drive file ไป trash (ไม่ลบถาวร — กู้คืนได้)
  if (driveId) {
    try { DriveApp.getFileById(driveId).setTrashed(true); } catch (e) {}
  }

  return { ok: true, file_id: p.file_id };
}


/**
 * upload_log_photo — อัปโหลดรูปประกอบ activity log
 * เก็บใน folder "activity" — คืน url + drive_id
 *
 * params: image_base64
 * returns: { ok, photo_url, drive_id }
 */
function uploadLogPhoto(p) {
  if (!p.image_base64) throw new Error('image_base64 required');

  let b64 = String(p.image_base64);
  let mimeType = 'image/jpeg';
  const m = b64.match(/^data:(image\/\w+);base64,(.+)$/);
  if (m) {
    mimeType = m[1];
    b64 = m[2];
  }

  const ext = mimeType.indexOf('png') >= 0 ? 'png' : 'jpg';
  const folder = getDriveFolder_('activity');

  const blob = Utilities.newBlob(
    Utilities.base64Decode(b64),
    mimeType,
    'log_' + Date.now() + '.' + ext
  );
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const driveId = file.getId();
  // ใช้ lh3.googleusercontent.com — ไม่โดน CORB block (uc?export=view โดนบล็อก)
  const photoUrl = 'https://lh3.googleusercontent.com/d/' + driveId;

  return {
    ok: true,
    photo_url: photoUrl,
    drive_id: driveId,
    thumbnail: 'https://lh3.googleusercontent.com/d/' + driveId + '=w400'
  };
}


// ============================================================
// 📎 PAYMENT SLIPS — หลักฐานการจ่ายเงินงวด
// ============================================================

/**
 * upload_payment_slip — อัปโหลดสลิป/หลักฐานการจ่ายเงินงวด
 *
 * params:
 *   milestone_id, contract_id
 *   file_base64  - รูป หรือ PDF
 *   file_name
 * returns: { ok, slip_id, url }
 */
function uploadPaymentSlip(p) {
  if (!p.milestone_id) throw new Error('milestone_id required');
  if (!p.file_base64) throw new Error('file_base64 required');

  let b64 = String(p.file_base64);
  let mimeType = 'application/octet-stream';
  let ext = 'bin';
  let fileType = 'file';

  const m = b64.match(/^data:([\w\/\-\.]+);base64,(.+)$/);
  if (m) { mimeType = m[1]; b64 = m[2]; }

  if (mimeType.indexOf('pdf') >= 0) { ext = 'pdf'; fileType = 'pdf'; }
  else if (mimeType.indexOf('jpeg') >= 0 || mimeType.indexOf('jpg') >= 0) { ext = 'jpg'; fileType = 'image'; }
  else if (mimeType.indexOf('png') >= 0) { ext = 'png'; fileType = 'image'; }
  else if (mimeType.indexOf('image') >= 0) { ext = 'jpg'; fileType = 'image'; }
  else throw new Error('รองรับเฉพาะรูปภาพ หรือ PDF เท่านั้น');

  const folder = getDriveFolder_('payment_slips');
  const fileName = 'slip_' + p.milestone_id + '_' + Date.now() + '.' + ext;
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), mimeType, fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const driveId = file.getId();
  const fileUrl = 'https://drive.google.com/file/d/' + driveId + '/view';

  const slipId = generateId('SL', SHEET.PAYMENT_SLIPS, 'slip_id');
  appendRow(SHEET.PAYMENT_SLIPS, {
    slip_id: slipId,
    milestone_id: p.milestone_id,
    contract_id: p.contract_id || '',
    url: fileUrl,
    drive_id: driveId,
    name: p.file_name || ('สลิป ' + slipId),
    file_type: fileType,
    uploaded_at: nowStr(),
    uploaded_by: p.uploaded_by || 'admin'
  });

  return { ok: true, slip_id: slipId, url: fileUrl };
}

/**
 * delete_payment_slip — ลบสลิป
 */
function deletePaymentSlip(p) {
  if (!p.slip_id) throw new Error('slip_id required');

  const found = findRowByCol(SHEET.PAYMENT_SLIPS, 'slip_id', p.slip_id);
  if (!found) throw new Error('ไม่พบสลิป: ' + p.slip_id);

  const driveIdIdx = found.headers.indexOf('drive_id');
  const driveId = driveIdIdx >= 0 ? found.values[driveIdIdx] : '';

  const sh = getSheet(SHEET.PAYMENT_SLIPS);
  sh.deleteRow(found.rowIndex);

  if (driveId) {
    try { DriveApp.getFileById(driveId).setTrashed(true); } catch (e) {}
  }

  return { ok: true, slip_id: p.slip_id };
}


// ============================================================
// 🪟 CLIENT VIEW — read-only routes for client.html
// ============================================================
// ทุก function ที่นี่ถูกเรียกผ่าน callRead (JSONP GET) จาก client.html
// หลังผ่าน _requireRole_(action, p.role='client'|'admin') แล้ว
//
// **กฎเหล็ก field whitelist:**
// - ห้าม return ทั้ง row จาก sheet — เลือก field ที่ลูกค้าควรเห็นเท่านั้น
// - ห้ามคืน: progress %, internal cost, BOQ, supplier, weight, defect,
//   variation note, contractor phone, uploaded_by ภายใน, margin
// - try/catch ครอบทุก getAllRows — sheet หาย/ว่าง → คืน [] หรือ default
//   ไม่ throw (กัน client.html จอขาว)
// - formatDateValue สำหรับทุก date field (กัน Date-object trap)
// ============================================================

/**
 * client_get_overview — ข้อมูล hero ของ client.html
 * คืน object เดียว (ไม่ใช่ array). ลูกค้าเห็น: ชื่อโปรเจค + รูปปก +
 * ทีมที่มาวันนี้ + เฟสปัจจุบัน + คาดเสร็จ + อัปเดตล่าสุด
 *
 * **ไม่มี progress %** (เจ้าของไม่อยากให้ลูกค้าเห็นตัวเลข % ที่แปรปรวน)
 */
function clientGetOverview(p) {
  const date = (p && p.date) || todayStr();

  // 1) Project info (01_Project_Info) — sheet นี้ไม่มี reader เดิม ใช้ row แรก
  //    schema ลูกค้าตั้งเอง → header-agnostic (ลอง key หลายแบบ)
  let projectName = '';
  let endDate = '';
  try {
    const projRows = getAllRows(SHEET.PROJECT);
    if (projRows && projRows.length > 0) {
      const r0 = projRows[0];
      projectName = String(
        r0['project_name'] || r0['Project Name'] || r0['name'] ||
        r0['Name'] || ''
      );
      const ed = r0['end_date'] || r0['End Date'] || r0['target_end'] ||
                 r0['Target End'] || '';
      endDate = formatDateValue(ed);
    }
  } catch (e) {}

  // 2) Cover photo — รูปล่าสุดจาก 13_Task_Photos ที่ client_visible=true
  let coverPhotoUrl = '';
  let lastUpdate = '';
  try {
    ensureTaskPhotoColumns_();
    const photos = getAllRows(SHEET.PHOTOS);
    let newest = null;
    photos.forEach(r => {
      const cv = (r.client_visible === true || r.client_visible === 'TRUE' ||
                  r.client_visible === 'true');
      if (!cv) return;
      const ts = formatDateValue(r.uploaded_at) || String(r.uploaded_at || '');
      if (!newest || ts > newest._ts) {
        newest = {
          drive_id: r.drive_id || '',
          drive_url: r.drive_url || '',
          _ts: ts
        };
      }
    });
    if (newest) {
      // ใช้ thumbnail googleusercontent (เร็วกว่า drive_url) ถ้ามี drive_id
      if (newest.drive_id) {
        coverPhotoUrl = 'https://lh3.googleusercontent.com/d/' +
                        newest.drive_id + '=w1200';
      } else {
        coverPhotoUrl = newest.drive_url;
      }
      lastUpdate = newest._ts;
    }
  } catch (e) {}

  // 3) Teams today — reuse logic จาก getTodayStats.teams_onsite_list
  //    คืน count + ชื่อทีม (ไม่มี contact info, lead name, phone)
  let teamsTodayCount = 0;
  const teamsTodayNames = [];
  try {
    const stats = getTodayStats({ date: date });
    teamsTodayCount = Number(stats.teams_onsite || 0);
    (stats.teams_onsite_list || []).forEach(t => {
      if (t && t.name) teamsTodayNames.push(String(t.name));
    });
  } catch (e) {}

  // 4) Current phase — derive จาก task status (ไม่มี master phase tracker)
  //    pattern: นับ task Done / total = ratio → map เป็นชื่อเฟสภาษาคน
  //    ⚠️ ไม่ return ratio/% ออกไป — ใช้แค่ map ภายในเป็นชื่อ
  let currentPhase = '';
  try {
    const tasks = getAllRows(SHEET.TASKS);
    if (tasks.length > 0) {
      const done = tasks.filter(t => String(t['Status'] || '') === 'Done').length;
      const ratio = done / tasks.length;
      if (ratio < 0.05)      currentPhase = 'เตรียมงาน';
      else if (ratio < 0.25) currentPhase = 'งานโครงสร้าง';
      else if (ratio < 0.55) currentPhase = 'งานระบบและฝ้า';
      else if (ratio < 0.85) currentPhase = 'งานติดตั้งและตกแต่ง';
      else if (ratio < 1.0)  currentPhase = 'เก็บงานและส่งมอบ';
      else                   currentPhase = 'ส่งมอบเรียบร้อย';
    }
  } catch (e) {}

  // 5) Expected completion — milestone ถัดไปที่ยังไม่ done, หรือ project end_date
  let expectedCompletion = '';
  try {
    const ms = getAllRows(SHEET.MILESTONES);
    // หา milestone ที่ยังไม่ paid/done เรียง seq น้อย → มาก แล้วเอาตัวสุดท้าย
    // (= งวดสุดท้ายของสัญญา) เพื่อเดาวันส่งมอบ
    const pending = ms.filter(m => {
      const st = String(m.status || '').toLowerCase();
      return st !== 'paid' && st !== 'done' && st !== 'completed';
    });
    if (pending.length > 0) {
      pending.sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
      const last = pending[0];
      expectedCompletion = formatDateValue(last.paid_date) ||
                           formatDateValue(last.target_date) ||
                           formatDateValue(last.due_date) || '';
    }
  } catch (e) {}
  // fallback → project end_date
  if (!expectedCompletion) expectedCompletion = endDate;

  // 6) last_update fallback — activity log ล่าสุดของวันนี้ (ถ้ายังไม่ได้ค่าจากรูป)
  if (!lastUpdate) {
    try {
      const feed = getActivityFeed({ date: date, limit: 1 });
      if (feed && feed.length > 0) {
        lastUpdate = feed[0].timestamp || feed[0].date || '';
      }
    } catch (e) {}
  }

  return {
    project_name: projectName,
    cover_photo_url: coverPhotoUrl,
    teams_today: teamsTodayCount,
    teams_today_names: teamsTodayNames,
    current_phase: currentPhase,
    expected_completion: expectedCompletion,
    last_update: lastUpdate,
  };
}


/**
 * client_get_photos — curated photo gallery สำหรับ client.html
 * อ่าน 13_Task_Photos filter client_visible=true เท่านั้น
 * join 03_Tasks_Checklist เพื่อแปลง task_id → caption ภาษาคน (task name)
 *
 * ❌ ห้าม: uploaded_by, FF code ดิบ, weight, internal note
 * params: limit (default 20, max 100)
 */
function clientGetPhotos(p) {
  p = p || {};
  const limit = Math.min(100, Math.max(1, Number(p.limit || 20)));

  // อ่าน photos
  let photos;
  try {
    ensureTaskPhotoColumns_();
    photos = getAllRows(SHEET.PHOTOS);
  } catch (e) {
    return [];
  }
  if (!photos || photos.length === 0) return [];

  // Build task lookup map (อ่าน sheet ครั้งเดียว กัน N+1)
  const taskMap = {};
  try {
    getAllRows(SHEET.TASKS).forEach(t => {
      const tid = String(t['Task ID'] || '');
      if (!tid) return;
      taskMap[tid] = {
        name: String(t['Task Name'] || ''),
        ff: String(t['FF Code'] || ''),
      };
    });
  } catch (e) {}

  // Filter + map → whitelisted shape
  const out = [];
  photos.forEach(r => {
    const cv = (r.client_visible === true || r.client_visible === 'TRUE' ||
                r.client_visible === 'true');
    if (!cv) return;
    const tid = String(r.task_id || '');
    const task = taskMap[tid] || {};
    // caption priority: caption field ที่ foreman ใส่เอง → task name → ''
    let caption = String(r.caption || '').trim();
    if (!caption) caption = task.name || '';
    out.push({
      id: r.id || '',
      drive_id: r.drive_id || '',
      drive_url: r.drive_url || '',
      caption: caption,
      uploaded_at: formatDateValue(r.uploaded_at),
    });
  });

  // เรียงใหม่ → เก่า แล้ว limit
  out.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  return out.slice(0, limit);
}


/**
 * client_get_milestones — ผังเฟสงานสำหรับลูกค้า
 * อ่าน 23_Milestones — เรียงตาม seq → คืน status เป็น
 * 'completed' | 'in_progress' | 'upcoming' (ไม่ใช่ raw status ของ DB)
 *
 * ❌ ห้าม: linked_payment_amount, internal note, pct, paid_amount,
 *    evidence_status (เปิดเฉพาะใน client_get_payments)
 */
function clientGetMilestones(p) {
  let rows;
  try {
    rows = getAllRows(SHEET.MILESTONES);
  } catch (e) {
    return [];
  }
  if (!rows || rows.length === 0) return [];

  // Sort by seq (ascending — งวดแรกขึ้นก่อน)
  rows.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));

  // หา "in_progress" — milestone แรกที่ยังไม่ paid (อันก่อนหน้านี้ paid หมด)
  let inProgressIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const st = String(rows[i].status || '').toLowerCase();
    if (st !== 'paid' && st !== 'done' && st !== 'completed') {
      inProgressIdx = i;
      break;
    }
  }

  return rows.map((m, i) => {
    const rawStatus = String(m.status || '').toLowerCase();
    let status = 'upcoming';
    if (rawStatus === 'paid' || rawStatus === 'done' ||
        rawStatus === 'completed') {
      status = 'completed';
    } else if (i === inProgressIdx) {
      status = 'in_progress';
    }
    const completedAt = (status === 'completed')
      ? formatDateValue(m.paid_date) : '';
    // target_date: หาในหลาย key (sheet user-defined) — ไม่บังคับ
    const targetDate = formatDateValue(
      m.target_date || m.due_date || m.paid_date || ''
    );
    return {
      id: m.milestone_id || '',
      seq: Number(m.seq || 0),
      name: String(m.name || ''),
      target_date: targetDate,
      status: status,
      completed_at: completedAt,
    };
  });
}


/**
 * client_get_payments — งวดงาน/การชำระเงิน
 * อ่าน 04_Payments (legacy schema — column ชื่อเป็นภาษาอังกฤษพิมพ์ใหญ่)
 * คืน array เรียงตาม Due Date
 *
 * ❌ ห้าม: supplier_payments, internal_cost, margin, receipt no. ภายใน
 */
function clientGetPayments(p) {
  let rows;
  try {
    rows = getAllRows(SHEET.PAYMENTS);
  } catch (e) {
    return [];
  }
  if (!rows || rows.length === 0) return [];

  // Filter summary rows (GRAND TOTAL, PAID, REMAINING) ออก
  // (logic เดียวกับ getPaymentsAsObjects ~520-532)
  const cleaned = rows.filter(r => {
    const id = String(r['Payment ID'] || '').trim();
    const milestone = String(r['Milestone'] || '').trim().toUpperCase();
    if (!id) return false;
    if (milestone === 'GRAND TOTAL') return false;
    if (milestone === 'PAID') return false;
    if (milestone === 'REMAINING') return false;
    if (milestone === 'TOTAL') return false;
    return true;
  });

  // Determine status (paid/pending/upcoming) จาก Status + Paid Date
  const today = todayStr();
  const out = cleaned.map((r, i) => {
    const rawStatus = String(r['Status'] || '').toLowerCase();
    const paidDate = formatDateValue(r['Paid Date']);
    const dueDate = formatDateValue(r['Due Date']);
    let status = 'upcoming';
    if (paidDate || rawStatus === 'paid' || rawStatus === 'จ่ายแล้ว') {
      status = 'paid';
    } else if (dueDate && dueDate <= today) {
      status = 'pending'; // ถึงกำหนดแล้วยังไม่จ่าย
    } else {
      // pending สำหรับงวดถัดไปที่กำลังจะมา (ใกล้ที่สุด) — แบ่งจาก upcoming
      status = 'upcoming';
    }
    // Installment no. — extract เลขจาก milestone string "งวด 1" → 1
    let installmentNo = 0;
    const milestone = String(r['Milestone'] || '');
    const m = milestone.match(/งวด\s*(\d+)/);
    if (m) installmentNo = Number(m[1]);
    return {
      id: String(r['Payment ID'] || ''),
      installment_no: installmentNo,
      name: String(r['Sub-Item'] || milestone || ''),
      milestone: milestone,
      amount: Number(r['Amount (THB)'] || 0),
      due_date: dueDate,
      paid_date: paidDate,
      status: status,
      condition: String(r['Notes'] || ''), // condition/เงื่อนไขปลดงวด ถ้าทีมใส่ใน Notes
    };
  });

  // เรียง due_date เก่า → ใหม่ (งวดแรกขึ้นก่อน)
  out.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return out;
}

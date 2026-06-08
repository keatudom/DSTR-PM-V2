// ============================================================
// 🔐 PHASE G — IDENTITY & PERMISSIONS (Auth)
// ============================================================
// login ด้วย Google (Sign in with Google) → verify id_token →
// จับคู่อีเมลกับ 24_Staff → ออก "บัตรผ่าน" (HMAC token) ของเราเอง
//
// หลักการ:
//  - ตัวตน = อีเมล (column `email` ใน 24_Staff)
//  - บทบาทสิทธิ์ = column `auth_role` ใน 24_Staff (owner|pm|foreman|contractor|client)
//    *** แยกจาก column `role` เดิม (ตำแหน่งงานแบบ free-text เช่น 'Foreman') ***
//  - 1 คน = 1 บทบาท · เจ้าของงานกำหนด · ผู้ใช้เปลี่ยนเองไม่ได้
//  - token = stateless HMAC (ไม่ต้องเขียน session ทุก request)
//  - บังคับสิทธิ์ที่ server (_authorize_) — MIGRATION-SAFE:
//      ไม่มี token → fallback เป็นพฤติกรรมเดิม (_requireRole_) ไม่ล็อกใครออก
//
// strategy: DSTR-PM จะ merge เข้า Inarch (Better Auth) — auth ตรงนี้ทำ
// "พอดีกับทีมเล็กที่ไว้ใจกัน" ไม่ลงทุนระดับธนาคาร
// ============================================================

// Client ID นี้เป็นข้อมูลสาธารณะ (ไม่ใช่ secret) — ใช้ verify aud ของ Google token
var GOOGLE_CLIENT_ID = '1007106153160-bih4m06f6qdrche186s7ng4u85ghs6t0.apps.googleusercontent.com';

var AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // บัตรผ่านอยู่ได้ 30 วัน
var OWNER_SEED_EMAIL = 'keatudom456@gmail.com';   // เจ้าของงาน — seed เป็น owner

// actor context (ใช้ Phase H ติดป้าย "ใครทำ" ใน activity log)
var _CURRENT_ACTOR_ = null;
function _setCurrentActor_(a) { _CURRENT_ACTOR_ = a || null; }
function _getCurrentActor_() { return _CURRENT_ACTOR_; }

// ============================================================
// 🔑 SECRET — กุญแจเซ็น token (auto-generate ถ้ายังไม่มี)
// ============================================================
function _getAuthSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('AUTH_SECRET');
  if (s && s.length >= 32) return s;
  // generate random 256-bit hex แล้วเก็บถาวร
  var raw = Utilities.getUuid() + Utilities.getUuid() + new Date().getTime();
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  s = bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
  props.setProperty('AUTH_SECRET', s);
  return s;
}

// idempotent endpoint — รันครั้งเดียวเพื่อสร้าง secret ล่วงหน้า (ไม่บังคับ)
function initAuthSecret_() {
  var s = _getAuthSecret_();
  return { ok: true, has_secret: !!s, length: s.length };
}

// ============================================================
// 🎫 TOKEN — stateless HMAC ( payloadB64 . signatureB64 )
// ============================================================
function _b64url_(strOrBytes) {
  return Utilities.base64EncodeWebSafe(strOrBytes).replace(/=+$/, '');
}
function _b64urlDecodeToString_(b64) {
  // เติม padding กลับก่อน decode
  var pad = b64.length % 4;
  if (pad) b64 += '===='.slice(pad);
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(b64)).getDataAsString();
}

function _signPayload_(payloadB64) {
  var sig = Utilities.computeHmacSha256Signature(payloadB64, _getAuthSecret_());
  return _b64url_(sig);
}

function _issueToken_(user) {
  var payload = {
    sid: user.staff_id || '',
    email: user.email || '',
    name: user.name || '',
    // ⚠️ ใช้ auth_role เท่านั้น — ไม่ fallback ไป column `role` (นั่นคือตำแหน่งงาน free-text)
    role: user.auth_role || 'foreman',
    exp: new Date().getTime() + AUTH_TOKEN_TTL_MS
  };
  var payloadB64 = _b64url_(JSON.stringify(payload));
  return payloadB64 + '.' + _signPayload_(payloadB64);
}

function _verifyToken_(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  var payloadB64 = parts[0];
  var sig = parts[1];
  // ตรวจลายเซ็น (กันปลอม payload)
  if (_signPayload_(payloadB64) !== sig) return null;
  var payload;
  try { payload = JSON.parse(_b64urlDecodeToString_(payloadB64)); }
  catch (e) { return null; }
  if (!payload || !payload.exp || payload.exp < new Date().getTime()) return null; // หมดอายุ
  return payload;
}

// ============================================================
// 🟢 GOOGLE LOGIN — verify id_token แล้วออก token ของเรา
// ============================================================
function loginGoogle_(p) {
  var idToken = p && (p.id_token || p.credential);
  if (!idToken) throw new Error('id_token required');

  // ให้ Google ตรวจ token ให้ (ลายเซ็น+หมดอายุ) ผ่าน tokeninfo endpoint
  var resp = UrlFetchApp.fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
    { muteHttpExceptions: true }
  );
  if (resp.getResponseCode() !== 200) {
    throw new Error('Google ปฏิเสธ token (โค้ด ' + resp.getResponseCode() + ')');
  }
  var info;
  try { info = JSON.parse(resp.getContentText()); } catch (e) { throw new Error('อ่าน token ไม่ได้'); }

  // ตรวจว่า token ออกให้แอปเรา (aud) + อีเมลยืนยันแล้ว
  if (String(info.aud) !== GOOGLE_CLIENT_ID) {
    throw new Error('token ไม่ใช่ของแอปนี้');
  }
  var emailVerified = (info.email_verified === true || info.email_verified === 'true');
  if (!info.email || !emailVerified) {
    throw new Error('อีเมล Google ยังไม่ได้ยืนยัน');
  }

  var email = String(info.email).toLowerCase().trim();

  // จับคู่กับ 24_Staff (อีเมลที่เจ้าของงาน "ออกบัตร" ไว้ล่วงหน้า)
  var staff = _findStaffByEmail_(email);
  if (!staff) {
    // ไม่อยู่ในรายชื่อ → ยังไม่ได้รับอนุญาต (เจ้าของงานต้องเพิ่มก่อน)
    return {
      authorized: false,
      email: email,
      name: info.name || '',
      message: 'อีเมลนี้ยังไม่ได้รับอนุญาต — แจ้งเจ้าของงาน/แอดมินให้เพิ่มสิทธิ์ก่อน'
    };
  }
  if (staff.active === false || staff.active === 'FALSE') {
    return { authorized: false, email: email, message: 'บัญชีถูกปิดใช้งาน — ติดต่อแอดมิน' };
  }

  var token = _issueToken_(staff);
  return {
    authorized: true,
    token: token,
    user: {
      staff_id: staff.staff_id,
      email: email,
      name: staff.name || info.name || '',
      role: staff.auth_role || 'foreman'
    }
  };
}

function _findStaffByEmail_(email) {
  email = String(email).toLowerCase().trim();
  var rows = getAllRows(SHEET.STAFF);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].email || '').toLowerCase().trim() === email) return rows[i];
  }
  return null;
}

// get_me — frontend เรียกเช็คว่าใคร login อยู่ + บทบาท (ไว้ซ่อน/แสดง UI)
function getMe_(p) {
  var payload = _verifyToken_(p && (p.auth_token || p.token));
  if (!payload) return { authenticated: false };
  return {
    authenticated: true,
    staff_id: payload.sid,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    projects: _userProjectIds_(payload.sid)
  };
}

// ============================================================
// 🗂️ PERMISSION MATRIX — capability tiers × roles
// ============================================================
// READ    = ดูข้อมูล
// OPS     = งานหน้างาน (ติ๊กงาน, daily, เบิก/รับ/นับของ, อัปรูป)
// MANAGE  = จัดการโครงสร้างโครงการ (FF, วัสดุ, ความเสี่ยง, ประเมิน, ทีม)
// FINANCE = สัญญา/งวด/หลักฐานการเงิน
// PRICING = ราคา/มูลค่า/ส่วนลด (เจ้าของงานเท่านั้น)
// ADMIN   = จัดการผู้ใช้/สิทธิ์/สร้างโครงการ/migration (เจ้าของงานเท่านั้น)
var _ROLE_CAPS_ = {
  owner:      { READ: 1, OPS: 1, MANAGE: 1, FINANCE: 1, PRICING: 1, ADMIN: 1 },
  pm:         { READ: 1, OPS: 1, MANAGE: 1, FINANCE: 1 },
  foreman:    { READ: 1, OPS: 1 },
  contractor: { READ: 1 },
  client:     {} // client ใช้ whitelist แยก (CLIENT_ALLOWED_ACTIONS)
};

// action → capability ที่ต้องมี (action ที่ไม่ระบุ = ถือว่า READ สำหรับ logged-in)
var _ACTION_CAP_ = (function () {
  var m = {};
  function add(cap, list) { list.forEach(function (a) { m[a] = cap; }); }

  add('READ', [
    'ping', 'getAll', 'get_ff_list', 'get_tasks', 'get_contractors',
    'get_teams_bundle', 'get_teams', 'get_suppliers', 'get_materials',
    'get_material', 'get_transactions', 'get_boq', 'check_boq_status',
    'get_ai_alerts', 'get_daily_reports', 'get_daily_report', 'ai_summary',
    'get_photos', 'get_material_photos', 'get_task_photos',
    'get_transaction_photos', 'get_activity_feed', 'get_material_transactions',
    'get_saved_summary', 'get_today_stats', 'get_daily_bundle',
    'get_all_staff', 'get_project_staff', 'get_projects',
    'get_eval_config', 'get_evals', 'get_eval_summary',
    'get_inventory_summary', 'get_client_finance', 'get_contract_files',
    'suggest_task_from_log', 'parse_activity_text', 'parse_material_log',
    'scan_bill', 'detect_unknowns', 'login', 'login_google', 'get_me',
    'check_stock_for_items', 'get_notifications'
  ]);

  add('OPS', [
    'updateTask', 'team_checkin', 'receive_material', 'withdraw_material',
    'count_material', 'confirm_material_log', 'create_daily',
    'auto_detect_daily', 'generate_daily_summary', 'generate_daily_summary_v2',
    'add_quick_log', 'add_photo', 'upload_photo', 'delete_photo',
    'delete_task_photo', 'add_activity_log', 'untick_task_from_log',
    'save_ai_summary', 'confirm_task_tick', 'upload_log_photo',
    'confirm_bill_items'
  ]);

  add('MANAGE', [
    'create_ff', 'create_ff_batch', 'update_ff', 'delete_ff', 'clone_project',
    'create_material', 'update_material', 'deactivate_material',
    'delete_material', 'create_boq', 'create_team', 'update_team',
    'create_supplier', 'create_contractor', 'create_risk', 'update_risk',
    'delete_risk', 'clone_risks', 'create_eval', 'update_eval', 'delete_eval',
    'delete_daily', 'delete_activity_log'
  ]);

  add('FINANCE', [
    'updatePayment', 'create_contract', 'update_contract', 'create_milestone',
    'update_milestone', 'upload_payment_slip', 'delete_payment_slip',
    'upload_contract_file', 'delete_contract_file'
  ]);

  add('PRICING', ['update_material_prices', 'create_project']);

  add('ADMIN', [
    'create_staff', 'update_staff', 'assign_project_staff',
    'unassign_project_staff', 'get_users', 'upsert_user', 'set_user_role',
    // maintenance / migration endpoints
    '_phase_a_fix', '_phase_b1_migrate', '_phase_r1_migrate',
    '_seed_direk_template', '_phase_f_migrate', '_phase_g_migrate',
    '_init_auth_secret', '_ensure_eval_sheets', '_seed_eval_rubric',
    '_auth_selftest'
  ]);

  return m;
})();

// scope: write caps เหล่านี้ต้องเช็คว่า user อยู่ในโครงการนั้น (owner ข้าม)
var _SCOPED_CAPS_ = { OPS: 1, MANAGE: 1, FINANCE: 1 };

function _userProjectIds_(staffId) {
  if (!staffId) return [];
  var out = [];
  try {
    getAllRows(SHEET.PROJECT_STAFF).forEach(function (a) {
      if (String(a.staff_id) === String(staffId) &&
          a.active !== false && a.active !== 'FALSE') {
        out.push(String(a.project_id));
      }
    });
  } catch (e) {}
  return out;
}

// ============================================================
// 🛡️ _authorize_ — ตัวบังคับสิทธิ์ที่ server (เรียกใน route())
// ============================================================
function _authorize_(action, p) {
  var token = p && (p.auth_token || p.token);

  // ── MIGRATION-SAFE: ไม่มี token → พฤติกรรมเดิม (ไม่ล็อกใครออก) ──
  if (!token) {
    return _requireRole_(action, p && p.role);
  }

  var payload = _verifyToken_(token);
  if (!payload) throw new Error('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่');

  _setCurrentActor_(payload); // ไว้ Phase H ติดป้ายคนทำ

  var role = payload.role || 'foreman';

  // owner = ทำได้ทุกอย่าง
  if (role === 'owner') return true;

  // client = whitelist เดิม
  if (role === 'client') {
    if (!CLIENT_ALLOWED_ACTIONS[action]) {
      throw new Error('Access denied: client ทำ ' + action + ' ไม่ได้');
    }
    return true;
  }

  var cap = _ACTION_CAP_[action];

  // action ที่ยังไม่ map → ช่วงเปลี่ยนผ่าน: อนุญาต + log เตือน (จะเก็บกวาดทีหลัง)
  if (!cap) {
    try { console.warn('[_authorize_] unmapped action (allowed): ' + action); } catch (e) {}
    return true;
  }

  var caps = _ROLE_CAPS_[role] || {};
  if (!caps[cap]) {
    throw new Error('ไม่มีสิทธิ์: บทบาท "' + role + '" ทำ ' + action + ' ไม่ได้');
  }

  // project scope สำหรับ write — pm/foreman/contractor ทำได้เฉพาะโครงการที่ถูก assign
  if (_SCOPED_CAPS_[cap]) {
    var pid = String((p && p.project_id) || '');
    if (pid) {
      var allowed = _userProjectIds_(payload.sid);
      // ถ้า user ไม่มีรายการ assign เลย = ยังไม่ถูกมอบโครงการ → ไม่ให้แก้
      if (allowed.indexOf(pid) === -1) {
        throw new Error('ไม่มีสิทธิ์ในโครงการนี้ — ติดต่อแอดมินให้เพิ่มคุณเข้าโครงการ');
      }
    }
  }

  return true;
}

// ============================================================
// 👤 USER MANAGEMENT (owner only — gate ผ่าน _ACTION_CAP_=ADMIN)
// ============================================================
// ใช้ 24_Staff เป็น user store: email + auth_role + name + active
function getUsers_() {
  // อ่าน assignment ทั้งหมดครั้งเดียว แล้ว group ตาม staff_id (กันอ่านซ้ำต่อคน)
  var byStaff = {};
  try {
    getAllRows(SHEET.PROJECT_STAFF).forEach(function (a) {
      if (a.active === false || a.active === 'FALSE') return;
      var sid = String(a.staff_id);
      if (!byStaff[sid]) byStaff[sid] = [];
      byStaff[sid].push({ assignment_id: a.assignment_id, project_id: String(a.project_id) });
    });
  } catch (e) {}

  return getAllRows(SHEET.STAFF).map(function (s) {
    var assigns = byStaff[String(s.staff_id)] || [];
    return {
      staff_id: s.staff_id,
      name: s.name || '',
      email: String(s.email || '').toLowerCase().trim(),
      role: s.role || '',                 // ตำแหน่งงาน (free text เดิม)
      auth_role: s.auth_role || '',       // บทบาทสิทธิ์
      phone: s.phone || '',
      active: !(s.active === false || s.active === 'FALSE'),
      projects: assigns.map(function (a) { return a.project_id; }),
      assignments: assigns               // [{assignment_id, project_id}] — ไว้ถอดออกจากโครงการ
    };
  });
}

var _VALID_AUTH_ROLES_ = { owner: 1, pm: 1, foreman: 1, contractor: 1, client: 1 };

// upsert_user — เพิ่ม/แก้ผู้ใช้ (อีเมล + บทบาทสิทธิ์)
// param: { staff_id?, name, email, auth_role, phone?, role?, active? }
function upsertUser_(p) {
  if (!p.email) throw new Error('email required');
  var email = String(p.email).toLowerCase().trim();
  var authRole = String(p.auth_role || '').toLowerCase().trim();
  if (authRole && !_VALID_AUTH_ROLES_[authRole]) {
    throw new Error('auth_role ไม่ถูกต้อง: ' + authRole + ' (owner|pm|foreman|contractor|client)');
  }
  ensureColumn_(SHEET.STAFF, 'email');
  ensureColumn_(SHEET.STAFF, 'auth_role');

  // มีอยู่แล้ว (ตาม staff_id หรืออีเมล) → update
  var existing = null;
  if (p.staff_id) existing = _findStaffById_(p.staff_id);
  if (!existing) existing = _findStaffByEmail_(email);

  if (existing) {
    var updates = { email: email };
    if (authRole) updates.auth_role = authRole;
    if (p.name !== undefined) updates.name = p.name;
    if (p.phone !== undefined) updates.phone = p.phone;
    if (p.role !== undefined) updates.role = p.role;
    if (p.active !== undefined) updates.active = !(p.active === false || p.active === 'false' || p.active === 'FALSE' || p.active === 0 || p.active === '0');
    updateRowByCol(SHEET.STAFF, 'staff_id', existing.staff_id, updates);
    return { ok: true, staff_id: existing.staff_id, updated: true };
  }

  // ใหม่
  var id = generateId('ST', SHEET.STAFF, 'staff_id');
  appendRow(SHEET.STAFF, {
    staff_id: id,
    name: p.name || email,
    email: email,
    role: p.role || '',
    auth_role: authRole || 'foreman',
    phone: p.phone || '',
    active: true,
    notes: p.notes || '',
    created_at: todayStr()
  });
  return { ok: true, staff_id: id, created: true };
}

function _findStaffById_(staffId) {
  var rows = getAllRows(SHEET.STAFF);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].staff_id) === String(staffId)) return rows[i];
  }
  return null;
}

// set_user_role — เปลี่ยนบทบาทสิทธิ์อย่างเดียว
function setUserRole_(p) {
  if (!p.staff_id && !p.email) throw new Error('staff_id หรือ email required');
  var authRole = String(p.auth_role || '').toLowerCase().trim();
  if (!_VALID_AUTH_ROLES_[authRole]) throw new Error('auth_role ไม่ถูกต้อง');
  ensureColumn_(SHEET.STAFF, 'auth_role');
  var staff = p.staff_id ? _findStaffById_(p.staff_id) : _findStaffByEmail_(p.email);
  if (!staff) throw new Error('ไม่พบผู้ใช้');
  updateRowByCol(SHEET.STAFF, 'staff_id', staff.staff_id, { auth_role: authRole });
  return { ok: true, staff_id: staff.staff_id, auth_role: authRole };
}

// ============================================================
// 🚚 MIGRATION + SEED (idempotent)
// ============================================================
function phaseGMigrate_() {
  ensureColumn_(SHEET.STAFF, 'email');
  ensureColumn_(SHEET.STAFF, 'auth_role');
  _getAuthSecret_(); // สร้าง secret ถ้ายังไม่มี

  // seed เจ้าของงานเป็น owner (ให้ login ทดสอบได้ทันที)
  var owner = _findStaffByEmail_(OWNER_SEED_EMAIL);
  if (owner) {
    updateRowByCol(SHEET.STAFF, 'staff_id', owner.staff_id, { auth_role: 'owner' });
  } else {
    var id = generateId('ST', SHEET.STAFF, 'staff_id');
    appendRow(SHEET.STAFF, {
      staff_id: id, name: 'เจ้าของงาน', email: OWNER_SEED_EMAIL,
      role: 'Owner', auth_role: 'owner', phone: '', active: true,
      notes: 'seed by Phase G', created_at: todayStr()
    });
  }
  return { ok: true, seeded_owner: OWNER_SEED_EMAIL };
}

// self-test การ์ดผ่าน (issue→verify roundtrip) — ไม่ปล่อย token ออก
function authSelfTest_() {
  var t = _issueToken_({ staff_id: 'TEST', email: 'x@y.z', name: 'T', auth_role: 'owner' });
  var v = _verifyToken_(t);
  var bad = _verifyToken_(t.slice(0, -3) + 'zzz'); // ลายเซ็นผิด → ต้องเป็น null
  return {
    ok: true,
    issued: !!t,
    verified: !!(v && v.role === 'owner'),
    rejects_tampered: bad === null
  };
}

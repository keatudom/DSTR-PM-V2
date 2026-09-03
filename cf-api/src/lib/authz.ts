// ============================================================
// authz.ts — บังคับสิทธิ์ที่ server (port _authorize_ + permission matrix จาก auth.gs)
// ★ port ตรรกะเดิมเป๊ะ — ไม่ออกแบบ RBAC ใหม่ในรอบนี้ (BLUEPRINT §7)
//
// ต่างจากเดิม: Workers ไม่มี global actor ต่อ request → authorize() คืน actor (payload)
// ให้ router ส่งต่อ handler (แทน _setCurrentActor_)
// ============================================================
import type { Env } from './env.ts';
import { verifyToken, type TokenPayload } from './auth.ts';

// action ที่เปิดตลอด (health-check / login) แม้ปิด anonymous read แล้ว
export const ALWAYS_OPEN = new Set<string>(['ping', 'login', 'login_google', 'get_me']);

// ── 🔒 action ที่ "ต้องมีบัตรผ่านเสมอ" แม้ ALLOW_ANON_READ จะยังเปิดอยู่ ──
//
// ⚠️ ที่มา (ตรวจเจอ 2026-09-03): ตอนนี้ ALLOW_ANON_READ='true' ทำให้ "ไม่มี token = ผ่านทุก action"
//    ไม่ใช่แค่ action อ่าน — ใครก็ตามที่รู้ URL ของ Worker เรียกได้หมดโดยไม่ต้องล็อกอิน
//    (ทดสอบจริงแล้ว: get_users คืนรายชื่อพนักงานพร้อมอีเมลครบ · get_attendance_all คืนเวลาเข้างาน)
//    → แปลว่าตาราง "บทบาท × สิทธิ์" ด้านล่างมีผลเฉพาะคนที่ล็อกอินด้วย Google (มี token) เท่านั้น
//
//    ปิด ALLOW_ANON_READ ทั้งหมดเลยยังทำไม่ได้ทันที เพราะการล็อกอินด้วย "รหัสผ่านรวม" (Auth.login)
//    ไม่ได้ออก token ให้ → ปิดปุ๊บคนกลุ่มนั้นเขียนอะไรไม่ได้เลยกลางคัน
//
//    ระหว่างรอเจ้าของงานเคาะวันตัดยอดให้ทุกคนใช้ Google login: ปิดเฉพาะ action ที่
//    "อันตราย + งานประจำวันไม่ได้ใช้" ก่อน — กันความเสียหายหนักโดยไม่ล็อกใครออกจากงาน
export const TOKEN_REQUIRED = new Set<string>([
  // ข้อมูลส่วนบุคคล / บัญชีผู้ใช้
  'get_users', 'upsert_user', 'set_user_role',
  'create_staff', 'update_staff', 'get_all_staff', 'set_id_card',
  'assign_project_staff', 'unassign_project_staff',
  'get_attendance_all', 'update_checkin', 'delete_checkin',
  // ลบถาวร / ย้อนกลับไม่ได้
  'delete_project', 'tour_purge', 'migrate_drive_photos',
  'delete_ff', 'delete_team', 'delete_daily', 'delete_material',
  // เรื่องเงิน
  'create_contract', 'update_contract', 'create_milestone', 'update_milestone',
  'updatePayment', 'create_payment', 'update_payment_info',
  'upload_payment_slip', 'delete_payment_slip',
  'upload_contract_file', 'delete_contract_file',
  //   ⚠️ ไม่ใส่ get_client_finance ตรงนี้ — แดชบอร์ดเรียกทุกครั้งที่เปิดหน้า
  //      ถ้าปิดตอนนี้ แท็บการเงินจะว่างเงียบๆ สำหรับคนที่ล็อกอินด้วยรหัสผ่านรวม
  //      → ปิดพร้อมกันตอนตัดยอดให้ทุกคนใช้ Google login
  // ยิงข้อความเข้ากลุ่ม LINE ของบริษัท
  '_run_line_digest', '_run_ops_digest', '_run_weekly_digest',
  // เสียเงินค่า AI ทุกครั้งที่กด
  'generate_content',
]);

// client เรียกได้เฉพาะ whitelist (Code.js:242)
export const CLIENT_ALLOWED_ACTIONS = new Set<string>([
  'client_get_overview',
  'client_get_photos',
  'client_get_milestones',
  'client_get_payments',
  'ping',
  'login',
]);

// capability tiers × roles (auth.gs:191 _ROLE_CAPS_)
type Caps = Record<string, 1>;
const ROLE_CAPS: Record<string, Caps> = {
  creator: { READ: 1, OPS: 1, PROCURE: 1, MANAGE: 1, FINANCE: 1, PRICING: 1, ADMIN: 1, SITECFG: 1, ATTEND: 1 },
  owner: { READ: 1, OPS: 1, PROCURE: 1, MANAGE: 1, FINANCE: 1, PRICING: 1, ADMIN: 1, SITECFG: 1, ATTEND: 1 },
  director: { READ: 1, OPS: 1, PROCURE: 1, MANAGE: 1, FINANCE: 1, SITECFG: 1, ATTEND: 1 },
  pm: { READ: 1, OPS: 1, PROCURE: 1, MANAGE: 1, FINANCE: 1, SITECFG: 1, ATTEND: 1 },
  // ⚠️ 2026-09-03: เดิม hr มีแค่ ATTEND → อ่าน get_projects/get_all_staff ไม่ได้เลย
  //    หน้าใบลงเวลาจึงโหลดรายชื่อโครงการ/พนักงานไม่ขึ้น (ชลธิชาใช้งานไม่ได้)
  hr: { READ: 1, ATTEND: 1 },
  site_engineer: { READ: 1, OPS: 1, PROCURE: 1, SITECFG: 1 },
  foreman: { READ: 1, OPS: 1, PROCURE: 1 },
  purchaser: { READ: 1, PROCURE: 1 },
  contractor: { READ: 1 },
  client: {},
};

// action → capability (auth.gs:205 _ACTION_CAP_)
const ACTION_CAP: Record<string, string> = {};
function addCap(cap: string, list: string[]) {
  for (const a of list) ACTION_CAP[a] = cap;
}
addCap('READ', [
  'ping', 'getAll', 'get_ff_list', 'get_tasks', 'get_contractors',
  'get_teams_bundle', 'get_teams', 'get_suppliers', 'get_materials',
  'get_material', 'get_transactions', 'get_boq', 'check_boq_status',
  'get_ai_alerts', 'get_daily_reports', 'get_daily_report', 'ai_summary',
  'get_photos', 'get_material_photos', 'get_task_photos',
  'get_transaction_photos', 'get_activity_feed', 'get_material_transactions',
  'get_saved_summary', 'get_today_stats', 'get_daily_bundle',
  'get_all_staff', 'get_project_staff', 'get_project_teams', 'get_projects',
  'get_eval_config', 'get_evals', 'get_eval_summary',
  'get_inventory_summary', 'get_client_finance', 'get_contract_files',
  'suggest_task_from_log', 'parse_activity_text', 'parse_material_log',
  'scan_bill', 'detect_unknowns', 'login', 'login_google', 'get_me',
  'check_stock_for_items', 'get_notifications', 'get_gallery',
  // ท่อคอนเทนต์: อ่านคิว/วัตถุดิบ/คู่มือเสียงแบรนด์ = ใครในทีมก็ดูได้
  'get_content_candidates', 'list_content', 'get_brand_voice', 'content_stats',
  // เดินดูหน้างาน 360: ดูทัวร์ = ทุกคนในโครงการ (เฟส 1 ยังไม่เปิดฝั่งเจ้าบ้าน)
  'tour_get_config', 'tour_get_version', 'tour_get_trash',
]);
addCap('OPS', [
  'updateTask', 'team_checkin', 'withdraw_material', 'create_daily',
  'auto_detect_daily', 'generate_daily_summary', 'generate_daily_summary_v2',
  'add_quick_log', 'add_photo', 'upload_photo', 'delete_photo',
  'delete_task_photo', 'add_activity_log', 'untick_task_from_log',
  'save_ai_summary', 'confirm_task_tick', 'upload_log_photo',
  'delete_activity_log',
  // เคาะ/แก้/รีคอนเทนต์ = งานประจำสัปดาห์ของคนเข้าเวร
  'update_content', 'reroll_content',
  // 🧭 เดินดูหน้างาน 360 — ถ่าย/อัป/ปักหมุด = งานหน้าไซต์ (โฟร์แมนขึ้นไป)
  'tour_upload_shot', 'tour_update_shot', 'tour_delete_shot',
  'tour_save_pin', 'tour_delete_pin', 'tour_resolve_pin',
  // ⚠️ 2026-09-03: ย้ายมาจาก SITECFG — คนที่ถือมือถือเดินสแกนจริงคือโฟร์แมน
  //    เดิม "สร้างจุดสแกน / วางผัง / ลากลูกศร" ถูกจัดเป็นงานตั้งค่าไซต์ (SITECFG)
  //    โฟร์แมนจึงอัปภาพเข้าจุดที่มีอยู่ได้ แต่ "สร้างจุดใหม่ไม่ได้"
  //    → พอเปิดโครงการใหม่ที่ยังไม่มีจุดเลย โฟร์แมนเริ่มงานไม่ได้เลยสักขั้น
  //    (เจ้าของงานเจอจริงที่บ้านคุณนัชชา — มีแต่เจ้าของงานที่สแกนได้)
  //    ลบ/กู้/คุมเวอร์ชัน ยังอยู่ SITECFG เหมือนเดิม
  'tour_save_plan', 'tour_save_point', 'tour_save_link', 'tour_delete_point',
  // ⚠️ รอบแรกลืมตัวนี้ — หน้าเว็บเรียก tour_create_version ก่อนอัปภาพใบแรกเสมอ
  //    (สร้าง "ฉบับร่าง" ของรอบสแกน) ถ้าเรียกไม่ได้ = กดสแกนแล้วตายตั้งแต่ก้าวแรก
  //    สร้างฉบับร่าง = เริ่มงาน · ส่วน "ประกาศใช้" (publish) ยังเป็นสิทธิ์หัวหน้าเหมือนเดิม
  'tour_create_version', 'tour_update_version',
]);
addCap('PROCURE', [
  'create_material', 'update_material', 'deactivate_material',
  'delete_material', 'update_material_prices', 'receive_material',
  'count_material', 'confirm_material_log', 'confirm_bill_items',
]);
addCap('MANAGE', [
  'create_ff', 'create_ff_batch', 'update_ff', 'delete_ff', 'clone_project',
  'create_boq', 'create_team', 'update_team',
  'create_supplier', 'create_contractor', 'create_risk', 'update_risk',
  'delete_risk', 'clone_risks', 'create_eval', 'update_eval', 'delete_eval',
  'delete_daily', 'delete_team', 'assign_project_team', 'unassign_project_team',
  // generate_content = เสียเงินค่า AI ทุกครั้งที่กด → จำกัดระดับหัวหน้าขึ้นไป
  // set_photo_consent = เรื่องสิทธิ์ใช้ภาพลูกค้า (กฎหมาย) ไม่ใช่คนหน้างานติ๊กเอง
  'generate_content', 'set_photo_consent',
]);
addCap('FINANCE', [
  'updatePayment', 'create_contract', 'update_contract', 'create_milestone',
  'update_milestone', 'upload_payment_slip', 'delete_payment_slip',
  'upload_contract_file', 'delete_contract_file',
]);
addCap('PRICING', ['create_project']);
addCap('SITECFG', [
  'set_site_location',
  // 🧭 เดินดูหน้างาน 360 — วางแผนที่จุด/ลูกศร + คุมเวอร์ชัน = งานตั้งค่าไซต์ (วิศวกรไซต์/PM ขึ้นไป)
  // (save_plan / save_point / save_link / delete_point ย้ายไป OPS แล้ว — ดูหมายเหตุด้านบน)
  'tour_delete_plan', 'tour_restore_point', 'tour_delete_link',
  'tour_publish_version',                        // ประกาศใช้ = ตัดสินว่าเวอร์ชันไหนเป็นตัวจริง
  'tour_delete_version', 'tour_restore_version',
  'tour_purge',   // ลบถาวร กู้ไม่ได้ — ระดับวิศวกรไซต์/PM ขึ้นไปเท่านั้น
]);
addCap('ATTEND', ['get_attendance_all', 'update_checkin', 'set_id_card',
  'delete_checkin',        // ลบบันทึกเวลา = แตะหลักฐานการจ่ายค่าแรง ต้องระดับ HR/แอดมิน
]);

// ── 🔒 2026-09-03: เก็บกวาด action ที่ยังไม่เคยกำหนดสิทธิ์ (31 ตัว) ──
// ก่อนหน้านี้ action ที่ไม่อยู่ในตารางจะ "ผ่านหมด" (ดูโค้ด authorize: ไม่มี cap = อนุญาต+เตือน)
// ตั้งใจไว้เป็นทางผ่านช่วงย้ายระบบ แต่ลืมเก็บกวาด → โมดูล QC / เช็คอิน / งวดเงิน
// และ action ใหม่ที่เพิ่งเพิ่ม (update_project, delete_project, save_ff_plan)
// เปิดโล่งให้ทุกบทบาทเรียกได้หมด รวมถึงบทบาทที่ควรอ่านได้อย่างเดียว
addCap('READ', [
  'get_projects_progress', 'get_ff_plans', 'get_task_weight_hints',
  'get_checkins', 'get_timesheet', 'get_site_location',
  'get_qc_criteria', 'get_qc_inspections', 'get_qc_inspection', 'get_qc_trash', 'qc_summary',
  // มุมมองเจ้าบ้าน — บทบาท client ผ่านทาง CLIENT_ALLOWED_ACTIONS อยู่แล้ว (เช็คก่อนถึงตารางนี้)
  'client_get_overview', 'client_get_photos', 'client_get_milestones', 'client_get_payments',
]);
addCap('OPS', [
  'create_checkin',                              // ลงเวลาตัวเอง = งานหน้าไซต์
  'create_qc_inspection', 'update_qc_result', 'close_qc_inspection',
]);
addCap('MANAGE', [
  'update_project',                              // แก้ชื่อ/วันที่/มูลค่า/ปิดโครงการ
  'save_ff_plan', 'delete_ff_plan',              // แผนไทม์ไลน์รายชิ้น = งานวางแผน
  'delete_qc_inspection', 'restore_qc_inspection',
]);
addCap('FINANCE', ['create_payment', 'update_payment_info']);
addCap('ADMIN', [
  'delete_project',                              // ลบโครงการถาวร
  // สั่งยิงรายงานเข้ากลุ่ม LINE ของบริษัทด้วยมือ — ไม่ใช่ของที่ใครก็กดได้
  '_run_line_digest', '_run_ops_digest', '_run_weekly_digest',
]);
addCap('ADMIN', [
  'create_staff', 'update_staff', 'assign_project_staff',
  'unassign_project_staff', 'get_users', 'upsert_user', 'set_user_role',
  // ย้ายรูปเก่า Drive → R2 (แตะ url ในฐานข้อมูลตรงๆ — เจ้าของ/แอดมินเท่านั้น)
  'migrate_drive_photos',
]);

// write caps ที่ต้องเช็ค project scope (auth.gs:278)
const SCOPED_CAPS: Record<string, 1> = { OPS: 1, PROCURE: 1, MANAGE: 1, FINANCE: 1 };
// บทบาทข้ามทุกโครงการ — ข้าม project scope (auth.gs:282)
const CROSS_PROJECT_ROLES: Record<string, 1> = {
  creator: 1, owner: 1, director: 1, purchaser: 1, admin: 1, hr: 1,
};

async function userProjectIds(env: Env, staffId: string): Promise<string[]> {
  if (!staffId) return [];
  try {
    const rows = await env.DB.prepare(
      `SELECT project_id FROM project_staff
       WHERE staff_id = ? AND active NOT IN ('FALSE','false','0') AND active IS NOT NULL`,
    )
      .bind(staffId)
      .all<{ project_id: string }>();
    return (rows.results ?? []).map((r) => String(r.project_id));
  } catch {
    return [];
  }
}

// migration-safe: ไม่มี token → พฤติกรรมเดิม (_requireRole_ Code.js:252)
function requireRole(action: string, role: string | undefined): void {
  if (role === 'admin') return;
  if (role === 'client') {
    if (!CLIENT_ALLOWED_ACTIONS.has(action)) {
      throw new Error('Access denied: client role cannot call ' + action);
    }
    return;
  }
  if (String(action).indexOf('client_') === 0) {
    throw new Error('Access denied: authentication required for ' + action);
  }
}

export interface AuthResult {
  actor: TokenPayload | null;
}

// ── _authorize_ (auth.gs:301) — throw เมื่อไม่มีสิทธิ์, คืน actor เมื่อผ่าน ──
export async function authorize(
  env: Env,
  action: string,
  p: Record<string, unknown>,
): Promise<AuthResult> {
  const token = (p.auth_token || p.token) as string | undefined;

  if (!token) {
    // ไม่มี token: ถ้า ALLOW_ANON_READ ยังเปิด → พฤติกรรมเดิม; ปิดแล้ว → บังคับ login (ยกเว้น ALWAYS_OPEN)
    const anon = String(env.ALLOW_ANON_READ) === 'true';
    if (!anon && !ALWAYS_OPEN.has(action)) {
      throw new Error('authentication required');
    }
    // ปิดเฉพาะกลุ่มอันตรายก่อน แม้ยังเปิด anonymous อยู่ (ดูหมายเหตุที่ TOKEN_REQUIRED)
    if (TOKEN_REQUIRED.has(action)) {
      throw new Error('ต้องเข้าสู่ระบบด้วยบัญชี Google ก่อนจึงจะทำรายการนี้ได้');
    }
    requireRole(action, p.role as string | undefined);
    return { actor: null };
  }

  const payload = await verifyToken(token, env.AUTH_SECRET);
  if (!payload) throw new Error('เซสชันหมดอายุ — กรุณาเข้าสู่ระบบใหม่');

  const role = payload.role || 'foreman';

  // creator/owner = ทำได้ทุกอย่าง
  if (role === 'creator' || role === 'owner') return { actor: payload };

  if (role === 'client') {
    if (!CLIENT_ALLOWED_ACTIONS.has(action)) {
      throw new Error('Access denied: client ทำ ' + action + ' ไม่ได้');
    }
    return { actor: payload };
  }

  const cap = ACTION_CAP[action];
  if (!cap) {
    // action ยังไม่ map → ช่วงเปลี่ยนผ่าน: อนุญาต + เตือน (เก็บกวาดทีหลัง)
    console.warn('[authorize] unmapped action (allowed): ' + action);
    return { actor: payload };
  }

  const caps = ROLE_CAPS[role] || {};
  if (!caps[cap]) {
    throw new Error('ไม่มีสิทธิ์: บทบาท "' + role + '" ทำ ' + action + ' ไม่ได้');
  }

  // project scope สำหรับ write — pm/SE/foreman ทำได้เฉพาะโครงการที่ถูก assign
  if (SCOPED_CAPS[cap] && !CROSS_PROJECT_ROLES[role]) {
    const pid = String(p.project_id || '');
    if (pid) {
      const allowed = await userProjectIds(env, payload.sid);
      if (allowed.indexOf(pid) === -1) {
        throw new Error('ไม่มีสิทธิ์ในโครงการนี้ — ติดต่อแอดมินให้เพิ่มคุณเข้าโครงการ');
      }
    }
  }

  return { actor: payload };
}

export const VALID_AUTH_ROLES = new Set<string>([
  'creator', 'owner', 'director', 'pm', 'hr',
  'site_engineer', 'foreman', 'purchaser', 'contractor', 'client',
]);

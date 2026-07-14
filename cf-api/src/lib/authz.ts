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
  hr: { ATTEND: 1 },
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
  'check_stock_for_items', 'get_notifications',
]);
addCap('OPS', [
  'updateTask', 'team_checkin', 'withdraw_material', 'create_daily',
  'auto_detect_daily', 'generate_daily_summary', 'generate_daily_summary_v2',
  'add_quick_log', 'add_photo', 'upload_photo', 'delete_photo',
  'delete_task_photo', 'add_activity_log', 'untick_task_from_log',
  'save_ai_summary', 'confirm_task_tick', 'upload_log_photo',
  'delete_activity_log',
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
]);
addCap('FINANCE', [
  'updatePayment', 'create_contract', 'update_contract', 'create_milestone',
  'update_milestone', 'upload_payment_slip', 'delete_payment_slip',
  'upload_contract_file', 'delete_contract_file',
]);
addCap('PRICING', ['create_project']);
addCap('SITECFG', ['set_site_location']);
addCap('ATTEND', ['get_attendance_all', 'update_checkin', 'set_id_card']);
addCap('ADMIN', [
  'create_staff', 'update_staff', 'assign_project_staff',
  'unassign_project_staff', 'get_users', 'upsert_user', 'set_user_role',
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

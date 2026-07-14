// ============================================================
// modules/auth.ts — port จาก apps-script/auth.gs + login (Code.js:894)
// actions: login, login_google, get_me, get_users, upsert_user, set_user_role
// ★ contract-preserving: response shape เดิมเป๊ะ (BLUEPRINT §1)
// ============================================================
import type { Env } from '../lib/env.ts';
import { issueToken, verifyToken } from '../lib/auth.ts';
import { VALID_AUTH_ROLES } from '../lib/authz.ts';
import { queryAll, queryFirst, exec, toBool } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr } from '../lib/time.ts';

interface StaffRow {
  staff_id: string;
  name: string;
  role: string;
  phone: string;
  active: unknown;
  notes: string;
  email: string;
  auth_role: string;
  created_at: string;
}

async function findStaffByEmail(env: Env, email: string): Promise<StaffRow | null> {
  const e = String(email).toLowerCase().trim();
  return queryFirst<StaffRow>(env, 'SELECT * FROM staff WHERE LOWER(TRIM(email)) = ?', e);
}

async function findStaffById(env: Env, staffId: string): Promise<StaffRow | null> {
  return queryFirst<StaffRow>(env, 'SELECT * FROM staff WHERE staff_id = ?', String(staffId));
}

async function userProjectIds(env: Env, staffId: string): Promise<string[]> {
  if (!staffId) return [];
  const rows = await queryAll<{ project_id: string }>(
    env,
    `SELECT project_id FROM project_staff
     WHERE staff_id = ? AND active NOT IN ('FALSE','false','0') AND active IS NOT NULL`,
    String(staffId),
  );
  return rows.map((r) => String(r.project_id));
}

// ── login (Code.js:894) — รหัสผ่านรวม admin/client ──
export function login(env: Env, p: Record<string, unknown>): unknown {
  const password = p.password;
  if (password === env.ADMIN_PASSWORD) return { role: 'admin', authenticated: true };
  if (password === env.CLIENT_PASSWORD) return { role: 'client', authenticated: true };
  throw new Error('Invalid password');
}

// ── login_google (auth.gs:101) — verify id_token กับ Google แล้วออก token ของเรา ──
export async function loginGoogle(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const idToken = (p.id_token || p.credential) as string | undefined;
  if (!idToken) throw new Error('id_token required');

  const resp = await fetch(
    'https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
  );
  if (resp.status !== 200) {
    throw new Error('Google ปฏิเสธ token (โค้ด ' + resp.status + ')');
  }
  let info: Record<string, unknown>;
  try {
    info = (await resp.json()) as Record<string, unknown>;
  } catch {
    throw new Error('อ่าน token ไม่ได้');
  }

  if (String(info.aud) !== env.GOOGLE_CLIENT_ID) {
    throw new Error('token ไม่ใช่ของแอปนี้');
  }
  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  if (!info.email || !emailVerified) {
    throw new Error('อีเมล Google ยังไม่ได้ยืนยัน');
  }

  const email = String(info.email).toLowerCase().trim();
  const staff = await findStaffByEmail(env, email);
  if (!staff) {
    return {
      authorized: false,
      email,
      name: info.name || '',
      message: 'อีเมลนี้ยังไม่ได้รับอนุญาต — แจ้งเจ้าของงาน/แอดมินให้เพิ่มสิทธิ์ก่อน',
    };
  }
  if (!toBool(staff.active)) {
    return { authorized: false, email, message: 'บัญชีถูกปิดใช้งาน — ติดต่อแอดมิน' };
  }

  const token = await issueToken(
    { staff_id: staff.staff_id, email, name: staff.name, auth_role: staff.auth_role },
    env.AUTH_SECRET,
  );
  return {
    authorized: true,
    token,
    user: {
      staff_id: staff.staff_id,
      email,
      name: staff.name || info.name || '',
      role: staff.auth_role || 'foreman',
    },
  };
}

// ── get_me (auth.gs:165) ──
export async function getMe(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const payload = await verifyToken((p.auth_token || p.token) as string, env.AUTH_SECRET);
  if (!payload) return { authenticated: false };
  return {
    authenticated: true,
    staff_id: payload.sid,
    email: payload.email,
    name: payload.name,
    role: payload.role,
    projects: await userProjectIds(env, payload.sid),
  };
}

// ── get_users (auth.gs:360) ──
export async function getUsers(env: Env): Promise<unknown> {
  const byStaff: Record<string, { assignment_id: string; project_id: string }[]> = {};
  const assigns = await queryAll<{ assignment_id: string; staff_id: string; project_id: string; active: unknown }>(
    env,
    'SELECT assignment_id, staff_id, project_id, active FROM project_staff',
  );
  for (const a of assigns) {
    if (!toBool(a.active)) continue;
    const sid = String(a.staff_id);
    (byStaff[sid] ||= []).push({ assignment_id: a.assignment_id, project_id: String(a.project_id) });
  }

  const staff = await queryAll<StaffRow>(env, 'SELECT * FROM staff');
  return staff.map((s) => {
    const a = byStaff[String(s.staff_id)] || [];
    return {
      staff_id: s.staff_id,
      name: s.name || '',
      email: String(s.email || '').toLowerCase().trim(),
      role: s.role || '',
      auth_role: s.auth_role || '',
      phone: s.phone || '',
      active: toBool(s.active),
      projects: a.map((x) => x.project_id),
      assignments: a,
    };
  });
}

// ── upsert_user (auth.gs:392) ──
export async function upsertUser(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.email) throw new Error('email required');
  const email = String(p.email).toLowerCase().trim();
  const authRole = String(p.auth_role || '').toLowerCase().trim();
  if (authRole && !VALID_AUTH_ROLES.has(authRole)) {
    throw new Error('auth_role ไม่ถูกต้อง: ' + authRole);
  }
  if (authRole === 'creator') throw new Error('ไม่อนุญาตให้ตั้งบทบาท "ผู้สร้าง" ผ่านหน้าจัดการผู้ใช้');

  let existing: StaffRow | null = null;
  if (p.staff_id) existing = await findStaffById(env, String(p.staff_id));
  if (!existing) existing = await findStaffByEmail(env, email);

  if (existing && String(existing.auth_role || '').toLowerCase() === 'creator') {
    throw new Error('บัญชี "ผู้สร้าง" ถูกล็อก — แก้ไขผ่านหน้านี้ไม่ได้');
  }

  if (existing) {
    const sets: string[] = ['email = ?'];
    const vals: unknown[] = [email];
    if (authRole) { sets.push('auth_role = ?'); vals.push(authRole); }
    if (p.name !== undefined) { sets.push('name = ?'); vals.push(p.name); }
    if (p.phone !== undefined) { sets.push('phone = ?'); vals.push(p.phone); }
    if (p.role !== undefined) { sets.push('role = ?'); vals.push(p.role); }
    if (p.active !== undefined) {
      sets.push('active = ?');
      vals.push(toBool(p.active) ? 'TRUE' : 'FALSE');
    }
    vals.push(existing.staff_id);
    await exec(env, `UPDATE staff SET ${sets.join(', ')} WHERE staff_id = ?`, ...vals);
    return { ok: true, staff_id: existing.staff_id, updated: true };
  }

  const id = await nextId(env, 'ST', 3);
  await exec(
    env,
    `INSERT INTO staff (staff_id, name, email, role, auth_role, phone, active, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    p.name || email,
    email,
    p.role || '',
    authRole || 'foreman',
    p.phone || '',
    'TRUE',
    p.notes || '',
    todayStr(),
  );
  return { ok: true, staff_id: id, created: true };
}

// ── set_user_role (auth.gs:450) ──
export async function setUserRole(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.staff_id && !p.email) throw new Error('staff_id หรือ email required');
  const authRole = String(p.auth_role || '').toLowerCase().trim();
  if (!VALID_AUTH_ROLES.has(authRole)) throw new Error('auth_role ไม่ถูกต้อง');
  if (authRole === 'creator') throw new Error('ตั้งบทบาท "ผู้สร้าง" ผ่านหน้านี้ไม่ได้ (ล็อกไว้)');

  const staff = p.staff_id
    ? await findStaffById(env, String(p.staff_id))
    : await findStaffByEmail(env, String(p.email));
  if (!staff) throw new Error('ไม่พบผู้ใช้');
  if (String(staff.auth_role || '').toLowerCase() === 'creator') {
    throw new Error('บัญชี "ผู้สร้าง" ถูกล็อก — เปลี่ยนบทบาทไม่ได้');
  }
  await exec(env, 'UPDATE staff SET auth_role = ? WHERE staff_id = ?', authRole, staff.staff_id);
  return { ok: true, staff_id: staff.staff_id, auth_role: authRole };
}

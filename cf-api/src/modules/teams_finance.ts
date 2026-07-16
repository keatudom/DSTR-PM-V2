// ============================================================
// modules/teams_finance.ts — port จาก Code.js (teams/contracts/milestones/staff)
//   + project_teams.gs + client_finance.gs
// 23 actions: get_teams_bundle, get_teams, team_checkin, create_team, update_team,
//   delete_team, get_project_teams, assign_project_team, unassign_project_team,
//   create_contract, update_contract, create_milestone, update_milestone,
//   create_staff, update_staff, get_all_staff, get_project_staff, assign_project_staff,
//   unassign_project_staff, get_client_finance, get_contractors, create_contractor, detect_unknowns
//
// ★ contract-preserving · milestone update → recalc contract.paid_total · LINE ผ่าน waitUntil
//   activity (team_checkin) stamp project_id (ดู S2-HANDOFF: จุด deviation activity project_id)
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, fmtDate, toBool } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr, nowStr } from '../lib/time.ts';
import { autoLog, appendActivityLog } from '../lib/activity.ts';
import { lineNotifyImportant, lineNotifyOwner, ctxOf } from '../lib/line.ts';
import { callGeminiJSON } from '../lib/gemini.ts';
import { getMaterials } from './materials.ts';

function actorOf(p: Record<string, unknown>): TokenPayload | null { return (p.__actor as TokenPayload | null) ?? null; }
function activeRow(v: unknown): boolean { return v !== false && v !== 'FALSE'; }

// ── get_contractors (Code.js:908) / create_contractor (918) ──
export async function getContractors(env: Env, role?: unknown): Promise<Record<string, unknown>[]> {
  let rows = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')).filter((c) => c.active === true || c.active === 'TRUE' || c.active === 'true');
  if (role) { const roles = String(role).split(',').map((r) => r.trim()); rows = rows.filter((c) => roles.indexOf(String(c.role)) !== -1); }
  return rows;
}
export function getContractorsAction(env: Env, p: Record<string, unknown>): Promise<unknown> { return getContractors(env, p.role); }
export async function createContractor(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = await nextId(env, 'C', 3);
  const row: Record<string, unknown> = { id, name: p.name, type: p.type || '', role: p.role || 'CONTRACTOR', phone: p.phone || '', payment_type: p.payment_type || 'per_job', notes: p.notes || '', active: true, created_at: todayStr() };
  await exec(env, `INSERT INTO contractors (id, name, type, role, phone, payment_type, notes, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'TRUE', ?)`,
    id, row.name, row.type, row.role, row.phone, row.payment_type, row.notes, row.created_at);
  return row; // contractors ไม่มี project_id
}

// ── TEAMS ──
export async function getTeams(env: Env, p: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  let teams = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM teams')).filter((t) => activeRow(t.active));
  const pid = String(p.project_id || '').trim() || pidOf(p);
  if (pid) {
    const set: Record<string, number> = {};
    for (const id of await projectTeamIds(env, pid)) set[String(id)] = 1;
    try {
      const scope = projectScope(pid);
      const contracts = (await queryAll<Record<string, unknown>>(env, `SELECT team_id, party FROM contracts WHERE ${scope.sql}`, ...scope.binds)).filter((c) => String(c.party || '') !== 'client');
      for (const c of contracts) if (c.team_id) set[String(c.team_id)] = 1;
    } catch { /* ignore */ }
    if (Object.keys(set).length) teams = teams.filter((t) => set[String(t.team_id)]);
  }
  return teams.map((t) => ({ team_id: t.team_id, name: t.name, type: t.type || '', lead_name: t.lead_name || '' }));
}
export function getTeamsAction(env: Env, p: Record<string, unknown>): Promise<unknown> { return getTeams(env, p); }

export async function getTeamsBundle(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const teams = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM teams')).filter((t) => activeRow(t.active))
    .map((t) => ({ team_id: t.team_id, name: t.name || '', type: t.type || '', lead_name: t.lead_name || '', phone: t.phone || '', category: t.category || 'contractor', members: t.members || '', notes: t.notes || '' }));
  const scope = projectScope(pid);
  const contracts = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM contracts WHERE ${scope.sql}`, ...scope.binds))
    .filter((c) => String(c.party || 'contractor').toLowerCase() !== 'client')
    .map((c) => ({ contract_id: c.contract_id, team_id: c.team_id, contract_no: c.contract_no || '', type: c.type || 'main', title: c.title || '', value: Number(c.value || 0), sign_date: fmtDate(c.sign_date), paid_total: Number(c.paid_total || 0), tax_pct: Number(c.tax_pct || 0), file_link: c.file_link || '', parent_id: c.parent_id || '', status: c.status || 'active', notes: c.notes || '' }));
  const cids: Record<string, boolean> = {};
  for (const c of contracts) cids[String(c.contract_id)] = true;
  const milestones = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM milestones')).filter((m) => cids[String(m.contract_id)])
    .map((m) => ({ milestone_id: m.milestone_id, contract_id: m.contract_id, seq: Number(m.seq || 0), name: m.name || '', condition: m.condition || '', pct: Number(m.pct || 0), amount: Number(m.amount || 0), status: m.status || 'pending', paid_amount: Number(m.paid_amount || 0), paid_date: fmtDate(m.paid_date), evidence_status: m.evidence_status || 'none', notes: m.notes || '' }));
  let paymentSlips: unknown[] = [];
  try { paymentSlips = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM payment_slips')).filter((s) => cids[String(s.contract_id)]).map((s) => ({ slip_id: s.slip_id, milestone_id: s.milestone_id, contract_id: s.contract_id, url: s.url, name: s.name || '', file_type: s.file_type || 'file' })); } catch { /* ignore */ }
  const staff = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM staff')).filter((s) => activeRow(s.active)).map((s) => ({ staff_id: s.staff_id, name: s.name, role: s.role || '', phone: s.phone || '', notes: s.notes || '' }));
  let contractFiles: unknown[] = [];
  try { contractFiles = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contract_files')).filter((f) => cids[String(f.contract_id)]).map((f) => ({ file_id: f.file_id, contract_id: f.contract_id, url: f.url, name: f.name || '', file_type: f.file_type || 'file' })); } catch { /* ignore */ }
  return { teams, contracts, milestones, staff, contract_files: contractFiles, payment_slips: paymentSlips };
}

export async function createTeam(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.name) throw new Error('name required');
  const id = await nextId(env, 'T', 3);
  const row: Record<string, unknown> = { team_id: id, name: p.name, type: p.type || '', lead_name: p.lead_name || '', phone: p.phone || '', category: p.category || 'contractor', members: p.members || '', active: true, notes: p.notes || '', created_at: todayStr() };
  await exec(env, `INSERT INTO teams (team_id, name, type, lead_name, phone, category, members, active, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'TRUE', ?, ?)`,
    id, row.name, row.type, row.lead_name, row.phone, row.category, row.members, row.notes, row.created_at);
  return { ok: true, team: row };
}
export async function updateTeam(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.team_id) throw new Error('team_id required');
  const cols = ['name', 'type', 'lead_name', 'phone', 'members', 'notes'];
  const setCols: string[] = []; const vals: unknown[] = [];
  for (const f of cols) if (p[f] !== undefined) { setCols.push(`${f} = ?`); vals.push(p[f]); }
  if (p.active !== undefined) { setCols.push('active = ?'); vals.push(toBool(p.active) ? 'TRUE' : 'FALSE'); }
  if (setCols.length) await exec(env, `UPDATE teams SET ${setCols.join(', ')} WHERE team_id = ?`, ...vals, p.team_id);
  return { ok: true, team_id: p.team_id };
}
export async function deleteTeam(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.team_id) throw new Error('team_id required');
  await exec(env, "UPDATE teams SET active = 'FALSE' WHERE team_id = ?", p.team_id);
  try { await exec(env, "UPDATE project_teams SET active = 'FALSE' WHERE team_id = ? AND active NOT IN ('FALSE','false')", p.team_id); } catch { /* ignore */ }
  return { ok: true, team_id: p.team_id, deactivated: true };
}

// ── PROJECT TEAMS ──
async function projectTeamIds(env: Env, projectId: string): Promise<string[]> {
  if (!projectId) return [];
  try {
    const rows = await queryAll<{ team_id: string }>(env, "SELECT team_id FROM project_teams WHERE project_id = ? AND active NOT IN ('FALSE','false')", projectId);
    return rows.map((r) => String(r.team_id));
  } catch { return []; }
}
export async function getProjectTeams(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = String(p.project_id || '') || pidOf(p);
  const assigns = await queryAll<Record<string, unknown>>(env, "SELECT * FROM project_teams WHERE project_id = ? AND active NOT IN ('FALSE','false')", pid);
  if (!assigns.length) return [];
  const teamMap: Record<string, Record<string, unknown>> = {};
  for (const t of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM teams')) teamMap[String(t.team_id)] = t;
  return assigns.map((a) => { const t = teamMap[String(a.team_id)] || {}; return { assignment_id: a.assignment_id, team_id: a.team_id, name: t.name || '(ไม่พบทีม)', type: t.type || '', lead_name: t.lead_name || '', phone: t.phone || '' }; });
}
export async function assignProjectTeam(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.team_id) throw new Error('team_id required');
  const pid = String(p.project_id || '') || pidOf(p);
  const existing = await queryFirst<{ assignment_id: string }>(env, "SELECT assignment_id FROM project_teams WHERE project_id = ? AND team_id = ? AND active NOT IN ('FALSE','false')", pid, p.team_id);
  if (existing) return { ok: true, assignment_id: existing.assignment_id, duplicate: true };
  const id = await nextId(env, 'PT', 3);
  await exec(env, "INSERT INTO project_teams (assignment_id, project_id, team_id, active, added_at) VALUES (?, ?, ?, 'TRUE', ?)", id, pid, p.team_id, nowStr());
  return { ok: true, assignment_id: id };
}
export async function unassignProjectTeam(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.assignment_id) throw new Error('assignment_id required');
  await exec(env, "UPDATE project_teams SET active = 'FALSE' WHERE assignment_id = ?", p.assignment_id);
  return { ok: true, assignment_id: p.assignment_id };
}

// ── team_checkin (Code.js:4096) → activity_logs source=team_checkin, dedup team+date ──
export async function teamCheckin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.team_id) throw new Error('team_id required');
  const teamId = String(p.team_id).trim();
  const date = (p.date as string) || todayStr();
  // ทิศทางเช็คอิน ใช้คีย์ checkin_action — ห้ามใช้ 'action' เพราะชนกับชื่อ route ('team_checkin')
  // ที่ frontend รวมลง body เดียวกัน (เคยทำ CF ตอบ "Unknown action: in")
  const action = p.checkin_action === 'out' ? 'out' : 'in';
  const workerCount = p.worker_count === undefined || p.worker_count === null || p.worker_count === '' ? null : Number(p.worker_count);
  let teamName = teamId;
  try { const team = await queryFirst<{ name: string }>(env, 'SELECT name FROM teams WHERE team_id = ?', teamId); if (team && team.name) teamName = team.name; } catch { /* ignore */ }
  const verb = action === 'out' ? 'ออกจากหน้างาน' : 'เข้าหน้างาน';
  const cntStr = workerCount !== null && !isNaN(workerCount) ? ` (${workerCount} คน)` : '';
  const text = '👷 ' + teamName + ' ' + verb + cntStr;
  const meta = { event: 'team_checkin', team_id: teamId, team_name: teamName, worker_count: workerCount !== null && !isNaN(workerCount) ? workerCount : null, action };

  // dedup: หา team_checkin ของ team+date (ไม่ scope project — ตรงต้นฉบับ)
  const existing = (await queryAll<Record<string, unknown>>(env, "SELECT * FROM activity_logs WHERE type='auto' AND source='team_checkin'"))
    .filter((r) => fmtDate(r.date) === date).find((r) => { let m: Record<string, unknown> = {}; try { m = JSON.parse(String(r.meta_json || '{}')); } catch { /* */ } return String(m.team_id || '') === teamId; });
  if (existing) {
    await exec(env, 'UPDATE activity_logs SET text = ?, meta_json = ? WHERE log_id = ?', text, JSON.stringify(meta), existing.log_id);
    return { ok: true, updated: true, log_id: existing.log_id, team_id: teamId, team_name: teamName, date, action, worker_count: meta.worker_count };
  }
  const logged = await appendActivityLog(env, { type: 'auto', source: 'team_checkin', text, date, meta, project_id: pidOf(p) });
  return { ok: true, updated: false, log_id: logged.log_id, team_id: teamId, team_name: teamName, date, action, worker_count: meta.worker_count };
}

// ── CONTRACTS ──
export async function createContract(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const party = p.party === 'client' ? 'client' : 'contractor';
  if (party !== 'client' && !p.team_id) throw new Error('team_id required');
  const id = await nextId(env, 'CT', 3);
  const row: Record<string, unknown> = { contract_id: id, team_id: p.team_id || '', contract_no: p.contract_no || '', type: p.type || 'main', title: p.title || '', value: Number(p.value || 0), sign_date: p.sign_date || todayStr(), paid_total: Number(p.paid_total || 0), tax_pct: Number(p.tax_pct || 0), file_link: p.file_link || '', parent_id: p.parent_id || '', status: p.status || 'active', party, notes: p.notes || '', created_at: todayStr() };
  await exec(env, `INSERT INTO contracts (contract_id, project_id, team_id, contract_no, type, title, value, sign_date, paid_total, tax_pct, file_link, parent_id, status, party, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pid, row.team_id, row.contract_no, row.type, row.title, row.value, row.sign_date, row.paid_total, row.tax_pct, row.file_link, row.parent_id, row.status, party, row.notes, row.created_at);
  row.project_id = pid;
  const side = party === 'client' ? 'สัญญาเจ้าบ้าน' : 'สัญญาผู้รับเหมา';
  const cMsg = '📄 เพิ่ม' + side + ': ' + (row.title || row.contract_no || id) + (row.value ? ' (' + Number(row.value).toLocaleString() + ' บาท)' : '');
  await autoLog(env, cMsg, { meta: { kind: 'contract', contract_id: id, party }, actor: actorOf(p) });
  try { lineNotifyImportant(env, cMsg, ctxOf(p)); lineNotifyOwner(env, cMsg, ctxOf(p)); } catch { /* ignore */ }
  return { ok: true, contract: row };
}
export async function updateContract(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.contract_id) throw new Error('contract_id required');
  const setCols: string[] = []; const vals: unknown[] = [];
  for (const f of ['contract_no', 'title', 'file_link', 'status', 'notes']) if (p[f] !== undefined) { setCols.push(`${f} = ?`); vals.push(p[f]); }
  if (p.value !== undefined) { setCols.push('value = ?'); vals.push(Number(p.value)); }
  if (p.paid_total !== undefined) { setCols.push('paid_total = ?'); vals.push(Number(p.paid_total)); }
  if (p.sign_date !== undefined) { setCols.push('sign_date = ?'); vals.push(p.sign_date); }
  if (setCols.length) await exec(env, `UPDATE contracts SET ${setCols.join(', ')} WHERE contract_id = ?`, ...vals, p.contract_id);
  return { ok: true, contract_id: p.contract_id };
}
export async function createMilestone(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.contract_id) throw new Error('contract_id required');
  const pid = pidOf(p);
  const id = await nextId(env, 'MS', 3);
  const row: Record<string, unknown> = { milestone_id: id, contract_id: p.contract_id, seq: Number(p.seq || 0), name: p.name || '', condition: p.condition || '', pct: Number(p.pct || 0), amount: Number(p.amount || 0), status: p.status || 'pending', paid_amount: Number(p.paid_amount || 0), paid_date: p.paid_date || '', notes: p.notes || '' };
  await exec(env, `INSERT INTO milestones (milestone_id, project_id, contract_id, seq, name, condition, pct, amount, status, paid_amount, paid_date, evidence_status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?)`,
    id, pid, row.contract_id, row.seq, row.name, row.condition, row.pct, row.amount, row.status, row.paid_amount, row.paid_date, row.notes);
  row.project_id = pid;
  await autoLog(env, '🧾 เพิ่มงวด: ' + (row.name || ('งวด ' + row.seq)) + (row.amount ? ' (' + Number(row.amount).toLocaleString() + ' บาท)' : ''), { meta: { kind: 'milestone', milestone_id: id, contract_id: p.contract_id }, actor: actorOf(p) });
  return { ok: true, milestone: row };
}
export async function updateMilestone(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.milestone_id) throw new Error('milestone_id required');
  const setCols: string[] = []; const vals: unknown[] = [];
  for (const f of ['name', 'condition', 'notes']) if (p[f] !== undefined) { setCols.push(`${f} = ?`); vals.push(p[f]); }
  if (p.status !== undefined) { setCols.push('status = ?'); vals.push(p.status); }
  if (p.amount !== undefined) { setCols.push('amount = ?'); vals.push(Number(p.amount)); }
  if (p.pct !== undefined) { setCols.push('pct = ?'); vals.push(Number(p.pct)); }
  if (p.paid_amount !== undefined) { setCols.push('paid_amount = ?'); vals.push(Number(p.paid_amount)); }
  if (p.paid_date !== undefined) { setCols.push('paid_date = ?'); vals.push(p.paid_date); }
  if (p.evidence_status !== undefined) { setCols.push('evidence_status = ?'); vals.push(p.evidence_status); }
  if (setCols.length) await exec(env, `UPDATE milestones SET ${setCols.join(', ')} WHERE milestone_id = ?`, ...vals, p.milestone_id);
  // recalc contract.paid_total
  if (p.contract_id) {
    try {
      const allMs = await queryAll<{ paid_amount: number }>(env, 'SELECT paid_amount FROM milestones WHERE contract_id = ?', p.contract_id);
      const totalPaid = allMs.reduce((s, m) => s + Number(m.paid_amount || 0), 0);
      await exec(env, 'UPDATE contracts SET paid_total = ? WHERE contract_id = ?', totalPaid, p.contract_id);
    } catch { /* ignore */ }
  }
  try {
    const st = String(p.status || '').toLowerCase();
    if ((st === 'paid' || st === 'done' || st === 'completed') && Number(p.paid_amount || 0) > 0) {
      const mMsg = '💰 รับ/จ่ายเงินงวด ' + Number(p.paid_amount).toLocaleString() + ' บาท';
      lineNotifyImportant(env, mMsg, ctxOf(p)); lineNotifyOwner(env, mMsg, ctxOf(p));
    }
  } catch { /* ignore */ }
  return { ok: true, milestone_id: p.milestone_id };
}

// ── STAFF ──
export async function createStaff(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.name) throw new Error('name required');
  const id = await nextId(env, 'ST', 3);
  const row: Record<string, unknown> = { staff_id: id, name: p.name, role: p.role || '', phone: p.phone || '', active: true, notes: p.notes || '', created_at: todayStr() };
  await exec(env, `INSERT INTO staff (staff_id, name, role, phone, active, notes, created_at) VALUES (?, ?, ?, ?, 'TRUE', ?, ?)`, id, row.name, row.role, row.phone, row.notes, row.created_at);
  return { ok: true, staff: row };
}
export async function updateStaff(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.staff_id) throw new Error('staff_id required');
  const setCols: string[] = []; const vals: unknown[] = [];
  for (const f of ['name', 'role', 'phone', 'notes']) if (p[f] !== undefined) { setCols.push(`${f} = ?`); vals.push(p[f]); }
  if (p.active !== undefined) { setCols.push('active = ?'); vals.push(toBool(p.active) ? 'TRUE' : 'FALSE'); }
  if (setCols.length) await exec(env, `UPDATE staff SET ${setCols.join(', ')} WHERE staff_id = ?`, ...vals, p.staff_id);
  return { ok: true, staff_id: p.staff_id };
}
export async function getAllStaff(env: Env): Promise<unknown> {
  return (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM staff')).filter((s) => activeRow(s.active)).map((s) => ({ staff_id: s.staff_id, name: s.name, role: s.role || '', phone: s.phone || '', notes: s.notes || '' }));
}
export async function getProjectStaff(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = p.project_id;
  if (!projectId) return [];
  const assignments = await queryAll<Record<string, unknown>>(env, "SELECT * FROM project_staff WHERE project_id = ? AND active NOT IN ('FALSE','false')", projectId);
  if (!assignments.length) return [];
  const staffMap: Record<string, Record<string, unknown>> = {};
  for (const s of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM staff')) staffMap[String(s.staff_id)] = s;
  return assignments.map((a) => { const s = staffMap[String(a.staff_id)] || {}; return { assignment_id: a.assignment_id, project_id: a.project_id, staff_id: a.staff_id, name: s.name || '(ไม่พบข้อมูล)', role: s.role || '', phone: s.phone || '', role_in_project: a.role_in_project || '', assigned_date: fmtDate(a.assigned_date) }; });
}
export async function assignProjectStaff(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.project_id) throw new Error('project_id required');
  if (!p.staff_id) throw new Error('staff_id required');
  const existing = await queryFirst<{ assignment_id: string }>(env, "SELECT assignment_id FROM project_staff WHERE project_id = ? AND staff_id = ? AND active NOT IN ('FALSE','false')", p.project_id, p.staff_id);
  if (existing) return { ok: true, assignment_id: existing.assignment_id, duplicate: true };
  const id = await nextId(env, 'AS', 3);
  await exec(env, "INSERT INTO project_staff (assignment_id, project_id, staff_id, role_in_project, assigned_date, active) VALUES (?, ?, ?, ?, ?, 'TRUE')", id, p.project_id, p.staff_id, p.role_in_project || '', todayStr());
  return { ok: true, assignment_id: id };
}
export async function unassignProjectStaff(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const assignmentId = p.assignment_id;
  if (!assignmentId) throw new Error('assignment_id required');
  await exec(env, "UPDATE project_staff SET active = 'FALSE' WHERE assignment_id = ?", assignmentId);
  return { ok: true, assignment_id: assignmentId };
}

// ── CLIENT FINANCE (client_finance.gs) ──
export async function getClientFinance(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const contracts = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM contracts WHERE ${scope.sql}`, ...scope.binds))
    .filter((c) => String(c.party || '').toLowerCase() === 'client')
    .map((c) => ({ contract_id: c.contract_id, contract_no: c.contract_no || '', title: c.title || '', value: Number(c.value || 0), sign_date: fmtDate(c.sign_date), paid_total: Number(c.paid_total || 0), tax_pct: Number(c.tax_pct || 0), file_link: c.file_link || '', status: c.status || 'active', notes: c.notes || '' }));
  const cids: Record<string, boolean> = {};
  for (const c of contracts) cids[String(c.contract_id)] = true;
  const milestones = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM milestones')).filter((m) => cids[String(m.contract_id)])
    .map((m) => ({ milestone_id: m.milestone_id, contract_id: m.contract_id, seq: Number(m.seq || 0), name: m.name || '', condition: m.condition || '', pct: Number(m.pct || 0), amount: Number(m.amount || 0), status: m.status || 'pending', paid_amount: Number(m.paid_amount || 0), paid_date: fmtDate(m.paid_date), evidence_status: m.evidence_status || 'none', notes: m.notes || '' }))
    .sort((a, b) => a.seq - b.seq);
  let paymentSlips: unknown[] = [];
  try { paymentSlips = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM payment_slips')).filter((s) => cids[String(s.contract_id)]).map((s) => ({ slip_id: s.slip_id, milestone_id: s.milestone_id, contract_id: s.contract_id, url: s.url, name: s.name || '', file_type: s.file_type || 'file' })); } catch { /* ignore */ }
  let contractFiles: unknown[] = [];
  try { contractFiles = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contract_files')).filter((f) => cids[String(f.contract_id)]).map((f) => ({ file_id: f.file_id, contract_id: f.contract_id, url: f.url, name: f.name || '', file_type: f.file_type || 'file' })); } catch { /* ignore */ }
  return { contracts, milestones, payment_slips: paymentSlips, contract_files: contractFiles };
}

// _clientMilestonesForView_ — สำหรับ client_view (คืน null ถ้าไม่มีสัญญาเจ้าบ้าน)
export async function clientMilestonesForView(env: Env, pid: string): Promise<unknown[] | null> {
  const scope = projectScope(pid);
  let contracts: Record<string, unknown>[];
  try { contracts = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM contracts WHERE ${scope.sql}`, ...scope.binds)).filter((c) => String(c.party || '').toLowerCase() === 'client'); } catch { return null; }
  if (!contracts.length) return null;
  const cids: Record<string, boolean> = {};
  for (const c of contracts) cids[String(c.contract_id)] = true;
  let ms: Record<string, unknown>[];
  try { ms = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM milestones')).filter((m) => cids[String(m.contract_id)]); } catch { return null; }
  if (!ms.length) return null;
  let slipsAll: Record<string, unknown>[] = [];
  try { slipsAll = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM payment_slips')).filter((s) => cids[String(s.contract_id)]); } catch { /* ignore */ }
  ms.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  return ms.map((m) => {
    const raw = String(m.status || '').toLowerCase();
    const paidDate = fmtDate(m.paid_date);
    const isPaid = raw === 'paid' || raw === 'done' || raw === 'completed' || !!paidDate;
    const evidence = slipsAll.filter((s) => String(s.milestone_id) === String(m.milestone_id)).map((s) => ({ url: s.url || '', name: s.name || 'หลักฐาน', file_type: s.file_type || 'file' }));
    return { id: String(m.milestone_id || ''), installment_no: Number(m.seq || 0), name: String(m.name || ''), milestone: String(m.name || ''), amount: Number(m.amount || 0), due_date: '', paid_date: paidDate, status: isPaid ? 'paid' : 'pending', condition: String(m.condition || ''), evidence };
  });
}

// ── detect_unknowns (AI) (Code.js:3889) ──
export async function detectUnknowns(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.text) throw new Error('text required');
  const text = String(p.text);
  const contractors = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')).filter((c) => c.active !== false && c.active !== 'FALSE');
  const materials = await getMaterials(env);
  const ctrNames = contractors.map((c) => c.name).join(', ');
  const matNames = materials.map((m) => m.name).join(', ');
  const prompt = 'คุณคือผู้ช่วยตรวจจับ "ช่าง" และ "วัสดุ" ที่ยังไม่มีในระบบก่อสร้าง\n\nข้อความบันทึกหน้างาน:\n"' + text + '"\n\n## ช่างที่มีในระบบแล้ว:\n' + (ctrNames || '(ไม่มี)') + '\n\n## วัสดุที่มีในระบบแล้ว:\n' + (matNames || '(ไม่มี)') + '\n\n## คำสั่ง:\nหาช่างหรือวัสดุที่ถูกกล่าวถึงแต่ยังไม่มีในระบบ คืน JSON เท่านั้น:\n{ "unknown_contractors": [ { "mentioned": "", "suggested_type": "", "is_likely_role": false } ], "unknown_materials": [ { "mentioned": "", "suggested_unit": "" } ] }';
  let aiResp: { unknown_contractors?: unknown[]; unknown_materials?: unknown[] };
  try { aiResp = (await callGeminiJSON(env, prompt)) as typeof aiResp; }
  catch (e) { return { unknown_contractors: [], unknown_materials: [], error: e instanceof Error ? e.message : String(e) }; }
  return { unknown_contractors: (aiResp && aiResp.unknown_contractors) || [], unknown_materials: (aiResp && aiResp.unknown_materials) || [] };
}

// ============================================================
// modules/client_view.ts — port จาก Code.js (client_get_*)
// actions (read-only, field whitelist เดิม): client_get_overview, client_get_photos,
//   client_get_milestones, client_get_payments
//
// ★ ห้ามหลุด field ภายใน (uploaded_by, weight, internal note, pct, paid_amount ฯลฯ)
//   deviation: ต้นฉบับ clientGetOverview อ่านชื่อ/วันจบจาก 01_Project_Info (ไม่ย้าย)
//     → ใช้ตาราง projects แทน · tasks/milestones/photos ต้นฉบับไม่ scope project (ตามเดิม)
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, pidOf, fmtDate, fmtDateTime } from '../lib/db.ts';
import { todayStr } from '../lib/time.ts';
import { getTodayStats, getActivityFeed } from './daily.ts';
import { clientMilestonesForView } from './teams_finance.ts';

function cvTrue(v: unknown): boolean { return v === true || v === 'TRUE' || v === 'true'; }

// ── client_get_overview (Code.js:4731) ──
export async function clientGetOverview(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const date = (p.date as string) || todayStr();
  const pid = pidOf(p);

  // 1) project info — ต้นฉบับใช้ 01_Project_Info (ไม่ย้าย) → ใช้ projects แทน
  let projectName = '';
  let endDate = '';
  try {
    const proj = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM projects WHERE project_id = ?', pid);
    if (proj) { projectName = String(proj.name || ''); endDate = fmtDate(proj.end_date); }
  } catch { /* ignore */ }

  // 2) cover photo — รูปล่าสุดจาก task_photos client_visible=true
  let coverPhotoUrl = '';
  let lastUpdate = '';
  try {
    const photos = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM task_photos');
    let newest: { drive_id: string; drive_url: string; _ts: string } | null = null;
    for (const r of photos) {
      if (!cvTrue(r.client_visible)) continue;
      const ts = fmtDate(r.uploaded_at) || String(r.uploaded_at || '');
      if (!newest || ts > newest._ts) newest = { drive_id: String(r.drive_id || ''), drive_url: String(r.url || ''), _ts: ts };
    }
    if (newest) {
      coverPhotoUrl = newest.drive_id ? 'https://lh3.googleusercontent.com/d/' + newest.drive_id + '=w1200' : newest.drive_url;
      lastUpdate = newest._ts;
    }
  } catch { /* ignore */ }

  // 3) teams today
  let teamsTodayCount = 0;
  const teamsTodayNames: string[] = [];
  try {
    const stats = await getTodayStats(env, { date, project_id: p.project_id });
    teamsTodayCount = Number(stats.teams_onsite || 0);
    for (const t of (stats.teams_onsite_list as { name?: unknown }[]) || []) if (t && t.name) teamsTodayNames.push(String(t.name));
  } catch { /* ignore */ }

  // 4) current phase — จาก task Done ratio (ต้นฉบับไม่ scope project)
  let currentPhase = '';
  try {
    const tasks = await queryAll<Record<string, unknown>>(env, 'SELECT status FROM tasks');
    if (tasks.length > 0) {
      const done = tasks.filter((t) => String(t.status || '') === 'Done').length;
      const ratio = done / tasks.length;
      if (ratio < 0.05) currentPhase = 'เตรียมงาน';
      else if (ratio < 0.25) currentPhase = 'งานโครงสร้าง';
      else if (ratio < 0.55) currentPhase = 'งานระบบและฝ้า';
      else if (ratio < 0.85) currentPhase = 'งานติดตั้งและตกแต่ง';
      else if (ratio < 1.0) currentPhase = 'เก็บงานและส่งมอบ';
      else currentPhase = 'ส่งมอบเรียบร้อย';
    }
  } catch { /* ignore */ }

  // 5) expected completion — milestone ที่ยังไม่ done เรียง seq มาก→น้อย เอาตัวแรก
  let expectedCompletion = '';
  try {
    const ms = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM milestones');
    const pending = ms.filter((m) => { const st = String(m.status || '').toLowerCase(); return st !== 'paid' && st !== 'done' && st !== 'completed'; });
    if (pending.length > 0) {
      pending.sort((a, b) => Number(b.seq || 0) - Number(a.seq || 0));
      const last = pending[0];
      expectedCompletion = fmtDate(last.paid_date) || fmtDate((last as Record<string, unknown>).target_date) || fmtDate((last as Record<string, unknown>).due_date) || '';
    }
  } catch { /* ignore */ }
  if (!expectedCompletion) expectedCompletion = endDate;

  // 6) last_update fallback — activity ล่าสุดของวันนี้
  if (!lastUpdate) {
    try { const feed = await getActivityFeed(env, { date, limit: 1, project_id: p.project_id }); if (feed.length > 0) lastUpdate = String(feed[0].timestamp || feed[0].date || ''); } catch { /* ignore */ }
  }

  return { project_name: projectName, cover_photo_url: coverPhotoUrl, teams_today: teamsTodayCount, teams_today_names: teamsTodayNames, current_phase: currentPhase, expected_completion: expectedCompletion, last_update: lastUpdate };
}

// ── client_get_photos (Code.js:4865) ──
export async function clientGetPhotos(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const limit = Math.min(100, Math.max(1, Number(p.limit || 20)));
  let photos: Record<string, unknown>[];
  try { photos = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM task_photos'); } catch { return []; }
  if (!photos.length) return [];
  const taskMap: Record<string, { name: string; ff: string }> = {};
  try { for (const t of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM tasks')) { const tid = String(t.id || ''); if (tid) taskMap[tid] = { name: String(t.name || ''), ff: String(t.ff_code || '') }; } } catch { /* ignore */ }
  const out: Record<string, unknown>[] = [];
  for (const r of photos) {
    if (!cvTrue(r.client_visible)) continue;
    const task = taskMap[String(r.task_id || '')] || { name: '', ff: '' };
    let caption = String(r.caption || '').trim();
    if (!caption) caption = task.name || '';
    out.push({ id: r.photo_id || '', drive_id: r.drive_id || '', drive_url: r.url || '', caption, uploaded_at: fmtDateTime(r.uploaded_at) });
  }
  out.sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)));
  return out.slice(0, limit);
}

// ── client_get_milestones (Code.js:4926) ──
export async function clientGetMilestones(env: Env): Promise<unknown> {
  let rows: Record<string, unknown>[];
  try { rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM milestones'); } catch { return []; }
  if (!rows.length) return [];
  rows.sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0));
  let inProgressIdx = -1;
  for (let i = 0; i < rows.length; i++) { const st = String(rows[i].status || '').toLowerCase(); if (st !== 'paid' && st !== 'done' && st !== 'completed') { inProgressIdx = i; break; } }
  return rows.map((m, i) => {
    const raw = String(m.status || '').toLowerCase();
    let status = 'upcoming';
    if (raw === 'paid' || raw === 'done' || raw === 'completed') status = 'completed';
    else if (i === inProgressIdx) status = 'in_progress';
    const completedAt = status === 'completed' ? fmtDate(m.paid_date) : '';
    const targetDate = fmtDate((m as Record<string, unknown>).target_date || (m as Record<string, unknown>).due_date || m.paid_date || '');
    return { id: m.milestone_id || '', seq: Number(m.seq || 0), name: String(m.name || ''), target_date: targetDate, status, completed_at: completedAt };
  });
}

// ── client_get_payments (Code.js:4982) — Phase F ก่อน (party=client) → fallback 04_Payments ──
export async function clientGetPayments(env: Env, p: Record<string, unknown>): Promise<unknown> {
  try { const fromContract = await clientMilestonesForView(env, pidOf(p)); if (fromContract) return fromContract; } catch { /* ignore */ }
  let rows: Record<string, unknown>[];
  try { rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM payments'); } catch { return []; }
  if (!rows.length) return [];
  const cleaned = rows.filter((r) => { const id = String(r.payment_id || '').trim(); const mst = String(r.milestone || '').trim().toUpperCase(); if (!id) return false; if (mst === 'GRAND TOTAL' || mst === 'PAID' || mst === 'REMAINING' || mst === 'TOTAL') return false; return true; });
  const today = todayStr();
  const out = cleaned.map((r) => {
    const rawStatus = String(r.status || '').toLowerCase();
    const paidDate = fmtDate(r.paid_date);
    const dueDate = fmtDate(r.due_date);
    let status = 'upcoming';
    if (paidDate || rawStatus === 'paid' || rawStatus === 'จ่ายแล้ว') status = 'paid';
    else if (dueDate && dueDate <= today) status = 'pending';
    const milestone = String(r.milestone || '');
    let installmentNo = 0;
    const mt = milestone.match(/งวด\s*(\d+)/);
    if (mt) installmentNo = Number(mt[1]);
    return { id: String(r.payment_id || ''), installment_no: installmentNo, name: String(r.sub_item || milestone || ''), milestone, amount: Number(r.amount || 0), due_date: dueDate, paid_date: paidDate, status, condition: String(r.notes || ''), evidence: [] };
  });
  out.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  return out;
}

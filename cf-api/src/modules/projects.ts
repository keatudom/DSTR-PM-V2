// ============================================================
// modules/projects.ts — port จาก apps-script/projects_patch.gs
// actions: get_projects, create_project, update_project
//   (skip: _phase_a_fix, seedBowHouse_ = admin/seed)
//
// ★ contract-preserving: คืน key snake_case ตาม PROJECTS_HEADERS_ เดิม
//   Sheets ช่องว่าง = '' แต่ seed แปลงเป็น NULL → coalesce null→'' ให้ตรงพฤติกรรมเดิม
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, exec } from '../lib/db.ts';

const PROJECTS_HEADERS = [
  'project_id', 'name', 'client', 'quote_no', 'start_date', 'end_date',
  'total_days', 'total_value', 'contractor', 'status', 'sheets_id', 'created_at',
] as const;

function blank(v: unknown): unknown {
  return v == null ? '' : v;
}

// ── get_projects (projects_patch.gs:44) — active ก่อน, ใหม่ก่อนเก่า ──
export async function getProjects(env: Env): Promise<unknown> {
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM projects');
  const out = rows
    .filter((r) => r.project_id)
    .map((r) => {
      const obj: Record<string, unknown> = {};
      for (const h of PROJECTS_HEADERS) obj[h] = blank(r[h]);
      return obj;
    });
  out.sort((a, b) => {
    const sa = String(a.status || '');
    const sb = String(b.status || '');
    if (sa === 'active' && sb !== 'active') return -1;
    if (sb === 'active' && sa !== 'active') return 1;
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return out;
}

// ── create_project (projects_patch.gs:115) ──
export async function createProject(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.name || !String(p.name).trim()) throw new Error('ต้องระบุชื่อโครงการ');

  const projectId = 'prj_' + Date.now().toString(36);

  let totalDays = parseInt(String(p.total_days), 10) || 0;
  if (!totalDays && p.start_date && p.end_date) {
    const sd = new Date(String(p.start_date));
    const ed = new Date(String(p.end_date));
    if (!isNaN(sd.getTime()) && !isNaN(ed.getTime())) {
      totalDays = Math.max(0, Math.round((ed.getTime() - sd.getTime()) / 86400000));
    }
  }

  // ต้นฉบับ sheets_id default = SHEETS_ID (Google Sheet id) — บน CF ไม่มีแล้ว → เก็บที่ส่งมา หรือ ''
  const row: Record<string, unknown> = {
    project_id: projectId,
    name: String(p.name).trim(),
    client: String(p.client || '').trim(),
    quote_no: String(p.quote_no || '').trim(),
    start_date: String(p.start_date || '').trim(),
    end_date: String(p.end_date || '').trim(),
    total_days: totalDays,
    total_value: parseFloat(String(p.total_value)) || 0,
    contractor: String(p.contractor || 'บริษัท ดีไซน์ ทีเรีย จำกัด').trim(),
    status: 'active',
    sheets_id: String(p.sheets_id || '').trim(),
    created_at: new Date().toISOString(),
  };
  await exec(
    env,
    `INSERT INTO projects (project_id, name, client, quote_no, start_date, end_date, total_days, total_value, contractor, status, sheets_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...PROJECTS_HEADERS.map((h) => row[h]),
  );
  return { project_id: projectId, project: row };
}

// ── update_project (projects_patch.gs:83) ──
export async function updateProject(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.project_id) throw new Error('project_id required');
  const exists = await queryFirst(env, 'SELECT project_id FROM projects WHERE TRIM(project_id) = TRIM(?)', p.project_id);
  if (!exists) throw new Error('ไม่พบโครงการ: ' + p.project_id);

  const editable = ['name', 'client', 'quote_no', 'start_date', 'end_date', 'total_days', 'total_value', 'contractor', 'status'];
  const setCols: string[] = [];
  const vals: unknown[] = [];
  let updated = 0;
  for (const f of editable) {
    if (p[f] === undefined) continue;
    setCols.push(`${f} = ?`);
    vals.push(p[f]);
    updated++;
  }
  if (setCols.length) {
    await exec(env, `UPDATE projects SET ${setCols.join(', ')} WHERE TRIM(project_id) = TRIM(?)`, ...vals, p.project_id);
  }
  return { ok: true, project_id: p.project_id, updated };
}

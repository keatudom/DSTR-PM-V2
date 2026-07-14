// ============================================================
// modules/evals.ts — port จาก apps-script/evaluations.gs
// actions: get_eval_config, get_evals, get_eval_summary, create_eval, update_eval, delete_eval
//   (skip: _ensure_eval_sheets, _seed_eval_rubric)
//
// ★ contract-preserving: get_evals/create คืน camelCase (id/teamId/kpi{...}/total/grade...)
//   KPI key เดิม ('First Pass' ฯลฯ) → D1 col snake (first_pass) · update updated_fields = ชื่อ header เดิม
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, fmtDate } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr, nowStr } from '../lib/time.ts';
import { autoLog } from '../lib/activity.ts';

interface Kpi { key: string; col: string; label: string; weight: number; subs: { no: string; name: string; check: string }[]; }
const EVAL_KPIS: Kpi[] = [
  { key: 'Manpower', col: 'manpower', label: 'กำลังคน', weight: 0.10, subs: [
    { no: '1.1', name: 'คนเข้างานครบตามแผน', check: '' }, { no: '1.2', name: 'ช่างมาตรงเวลา ไม่สายประจำ', check: '' },
    { no: '1.3', name: 'ไม่ขาด/หยุดงานกะทันหันโดยไม่แจ้ง', check: '' }, { no: '1.4', name: 'มีหัวหน้าคุมงานประจำทุกวัน', check: '' }] },
  { key: 'Progress', col: 'progress', label: 'ความคืบหน้า', weight: 0.15, subs: [
    { no: '2.1', name: 'งานคืบหน้าตามแผน ไม่ล่าช้า', check: '' }, { no: '2.2', name: 'ส่งงานตามงวด/Milestone ครบ', check: '' },
    { no: '2.3', name: 'วางแผนคิวงานล่วงหน้า', check: '' }, { no: '2.4', name: 'เมื่อช้า มีแผนเร่งงานชัดเจน', check: '' }] },
  { key: 'Quality', col: 'quality', label: 'คุณภาพงาน', weight: 0.20, subs: [
    { no: '3.1', name: 'งานตรงตามแบบ/สเปก', check: '' }, { no: '3.2', name: 'เก็บงานละเอียด เรียบร้อย', check: '' },
    { no: '3.3', name: 'ไม่ต้องรื้อแก้ (rework) บ่อย', check: '' }, { no: '3.4', name: 'ใช้วัสดุตามที่อนุมัติ', check: '' }] },
  { key: 'First Pass', col: 'first_pass', label: 'ตรวจผ่านครั้งแรก', weight: 0.15, subs: [
    { no: '4.1', name: 'งานผ่านตรวจครั้งแรก ไม่ต้องตรวจซ้ำหลายรอบ', check: '' }, { no: '4.2', name: 'จุดบกพร่อง (defect) น้อย', check: '' },
    { no: '4.3', name: 'ตรวจงานตัวเองก่อนเรียกตรวจ', check: '' }, { no: '4.4', name: 'แก้จุดบกพร่องเร็ว', check: '' }] },
  { key: 'Delivery', col: 'delivery', label: 'ส่งมอบตรงเวลา', weight: 0.15, subs: [
    { no: '5.1', name: 'ส่งมอบงานตรงเวลา', check: '' }, { no: '5.2', name: 'ถ้าช้า แจ้งล่วงหน้า', check: '' },
    { no: '5.3', name: 'ส่งเอกสาร/แบบส่งมอบครบ', check: '' }, { no: '5.4', name: 'ปิดงานค้าง (punch list) ครบ', check: '' }] },
  { key: 'Response', col: 'response', label: 'การตอบสนอง', weight: 0.05, subs: [
    { no: '6.1', name: 'ตอบกลับเร็วเมื่อมีเรื่องแจ้ง', check: '' }, { no: '6.2', name: 'เข้าประชุม/ตามนัดครบ', check: '' },
    { no: '6.3', name: 'ส่งรายงานความคืบหน้าตามรอบ', check: '' }] },
  { key: 'Discipline', col: 'discipline', label: 'วินัย/ความปลอดภัย', weight: 0.10, subs: [
    { no: '7.1', name: 'เข้า-ออกงานตรงเวลา', check: '' }, { no: '7.2', name: 'ไม่หยุดงานพร่ำเพรื่อ', check: '' },
    { no: '7.3', name: 'ใส่อุปกรณ์เซฟตี้ (PPE) ครบ', check: '' }, { no: '7.4', name: 'เก็บพื้นที่งานสะอาดเรียบร้อย', check: '' },
    { no: '7.5', name: 'ปฏิบัติตามกฎไซต์ (ไม่ดื่ม/สูบในเขตห้าม)', check: '' }] },
  { key: 'Finance', col: 'finance', label: 'วินัยการเงิน', weight: 0.10, subs: [
    { no: '8.1', name: 'เบิกเงินตามงวดงานจริง ไม่เบิกล่วงหน้าก่อนขึ้นชิ้นงาน', check: '' }, { no: '8.2', name: 'เอกสารเบิก/บิลถูกต้องครบ', check: '' },
    { no: '8.3', name: 'จ่ายค่าแรงคนงานตรงเวลา ไม่มีร้องเรียน', check: '' }, { no: '8.4', name: 'ทำตามสัญญา ไม่ทิ้งงาน/ขอเลื่อนพร่ำเพรื่อ', check: '' }] },
];
const EVAL_BANDS = [
  { range: '9-10', level: 'ดีเยี่ยม', desc: 'ทำได้ครบถ้วน เกินมาตรฐาน แทบไม่มีข้อบกพร่อง' },
  { range: '7-8', level: 'ดี', desc: 'ได้ตามมาตรฐาน มีจุดต้องเตือนเล็กน้อย' },
  { range: '5-6', level: 'ปานกลาง', desc: 'พอใช้ มีข้อบกพร่องที่ต้องตามแก้' },
  { range: '3-4', level: 'ต้องปรับปรุง', desc: 'ต่ำกว่ามาตรฐาน มีปัญหาซ้ำ ๆ' },
  { range: '1-2', level: 'ไม่ยอมรับ', desc: 'ไม่ผ่าน กระทบงานรุนแรง' },
];

function actorOf(p: Record<string, unknown>): TokenPayload | null {
  return (p.__actor as TokenPayload | null) ?? null;
}
function gradeFromTotal(t: number): string { return t >= 90 ? 'A' : t >= 80 ? 'B' : t >= 70 ? 'C' : t >= 60 ? 'D' : 'F'; }
function statusFromTotal(t: number): string { return t >= 90 ? 'Excellent' : t >= 80 ? 'Very Good' : t >= 70 ? 'Good' : t >= 60 ? 'Warning' : 'Blacklist'; }
function parseSub(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}
function computeFromSub(subScores: Record<string, unknown>): { kpi: Record<string, number>; total: number; weightUsed: number } {
  const kpi: Record<string, number> = {};
  let total = 0, weightUsed = 0;
  for (const def of EVAL_KPIS) {
    const subVals = def.subs.map((s) => Number(subScores[s.no])).filter((v) => !isNaN(v) && v > 0);
    let score: number;
    if (subVals.length > 0) score = subVals.reduce((a, b) => a + b, 0) / subVals.length;
    else score = 0;
    score = Math.max(0, Math.min(10, score));
    kpi[def.key] = Math.round(score * 100) / 100;
    if (score > 0) { total += score * def.weight; weightUsed += def.weight; }
  }
  const totalScore = weightUsed > 0 ? (total / weightUsed) * 10 : 0;
  return { kpi, total: Math.round(totalScore * 100) / 100, weightUsed };
}
function computeFromKpi(kpiScores: Record<string, unknown>): { kpi: Record<string, number>; total: number; weightUsed: number } {
  const kpi: Record<string, number> = {};
  let total = 0, weightUsed = 0;
  for (const def of EVAL_KPIS) {
    const raw = kpiScores[def.key];
    if (raw !== undefined && raw !== null && raw !== '' && !isNaN(Number(raw))) {
      const s = Math.max(0, Math.min(10, Number(raw)));
      kpi[def.key] = Math.round(s * 100) / 100;
      total += s * def.weight; weightUsed += def.weight;
    } else kpi[def.key] = 0;
  }
  const totalScore = weightUsed > 0 ? (total / weightUsed) * 10 : 0;
  return { kpi, total: Math.round(totalScore * 100) / 100, weightUsed };
}

// อ่าน row D1 (snake) → camelCase (Code.js _evalRowToObj_)
function evalRowToObj(r: Record<string, unknown>): Record<string, unknown> {
  const kpi: Record<string, number> = {};
  for (const def of EVAL_KPIS) kpi[def.key] = Number(r[def.col] || 0);
  return {
    id: r.eval_id || '', teamId: r.team_id || '', teamName: r.team_name || '',
    evalDate: fmtDate(r.eval_date), evaluator: r.evaluator || '', kpi,
    total: Number(r.total_score || 0), grade: r.grade || '', status: r.status || '',
    remark: r.remark || '', subScores: parseSub(r.sub_scores),
  };
}

export function getEvalConfig(): unknown {
  return {
    kpis: EVAL_KPIS.map((k) => ({ key: k.key, label: k.label, weight: k.weight, subs: k.subs })),
    bands: EVAL_BANDS,
    grade_scale: [
      { grade: 'A', min: 90, status: 'Excellent' }, { grade: 'B', min: 80, status: 'Very Good' },
      { grade: 'C', min: 70, status: 'Good' }, { grade: 'D', min: 60, status: 'Warning' }, { grade: 'F', min: 0, status: 'Blacklist' },
    ],
  };
}

export async function getEvals(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = String(p.project_id || '') || pidOf(p);
  const scope = projectScope(projectId);
  let rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM contractor_evaluations WHERE ${scope.sql}`, ...scope.binds);
  if (p.team_id) rows = rows.filter((r) => String(r.team_id) === String(p.team_id));
  return rows.map(evalRowToObj).sort((a, b) => String(b.evalDate).localeCompare(String(a.evalDate)));
}

export async function getEvalSummary(env: Env): Promise<unknown> {
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractor_evaluations');
  const byTeam: Record<string, { teamId: string; teamName: string; sum: number; count: number; lastDate: string }> = {};
  for (const r of rows) {
    const tid = String(r.team_id || '').trim();
    if (!tid) continue;
    const total = Number(r.total_score || 0);
    if (!byTeam[tid]) byTeam[tid] = { teamId: tid, teamName: String(r.team_name || tid), sum: 0, count: 0, lastDate: '' };
    byTeam[tid].sum += total; byTeam[tid].count += 1;
    const d = fmtDate(r.eval_date);
    if (d > byTeam[tid].lastDate) byTeam[tid].lastDate = d;
    if (r.team_name) byTeam[tid].teamName = String(r.team_name);
  }
  const list = Object.keys(byTeam).map((tid) => {
    const t = byTeam[tid];
    const avg = t.count > 0 ? Math.round((t.sum / t.count) * 100) / 100 : 0;
    return { teamId: t.teamId, teamName: t.teamName, avg, grade: gradeFromTotal(avg), status: statusFromTotal(avg), count: t.count, lastDate: t.lastDate };
  });
  list.sort((a, b) => b.avg - a.avg);
  return list.map((item, i) => ({ ...item, rank: i + 1 }));
}

export async function createEval(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const teamId = String(p.team_id || '').trim();
  if (!teamId) throw new Error('team_id ต้องระบุ (เลือกผู้รับเหมาก่อน)');
  const kpiScores = parseSub(p.kpi_scores);
  const itemResults = parseSub(p.item_results);
  let computed: { kpi: Record<string, number>; total: number; weightUsed: number };
  let auditStore: Record<string, unknown>;
  if (Object.keys(kpiScores).length > 0) {
    computed = computeFromKpi(kpiScores);
    auditStore = Object.keys(itemResults).length > 0 ? itemResults : kpiScores;
  } else {
    const subScores = parseSub(p.sub_scores);
    computed = computeFromSub(subScores);
    auditStore = subScores;
  }
  if (computed.weightUsed <= 0) throw new Error('ต้องประเมินอย่างน้อย 1 หมวด');

  let teamName = String(p.team_name || '').trim();
  if (!teamName) {
    try {
      const t = await queryFirst<{ name: string }>(env, 'SELECT name FROM teams WHERE team_id = ?', teamId);
      if (t) teamName = t.name || teamId;
    } catch { /* ignore */ }
  }
  if (!teamName) teamName = teamId;

  const id = await nextId(env, 'EV', 3);
  const total = computed.total;
  const dbRow: Record<string, unknown> = {
    eval_id: id, project_id: pid, team_id: teamId, team_name: teamName, eval_date: p.eval_date || todayStr(),
    evaluator: String(p.evaluator || '').trim(), total_score: total, grade: gradeFromTotal(total),
    status: statusFromTotal(total), remark: String(p.remark || '').trim(), sub_scores: JSON.stringify(auditStore), created_at: nowStr(),
  };
  for (const def of EVAL_KPIS) dbRow[def.col] = computed.kpi[def.key];

  await exec(
    env,
    `INSERT INTO contractor_evaluations (eval_id, project_id, team_id, team_name, eval_date, evaluator,
       manpower, progress, quality, first_pass, delivery, response, discipline, finance,
       total_score, grade, status, remark, sub_scores, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pid, teamId, teamName, dbRow.eval_date, dbRow.evaluator,
    dbRow.manpower, dbRow.progress, dbRow.quality, dbRow.first_pass, dbRow.delivery, dbRow.response, dbRow.discipline, dbRow.finance,
    total, dbRow.grade, dbRow.status, dbRow.remark, dbRow.sub_scores, dbRow.created_at,
  );
  try {
    await autoLog(env, '📋 ประเมินผู้รับเหมา ' + teamName + ' — ' + total + ' คะแนน (เกรด ' + dbRow.grade + ')',
      { meta: { kind: 'eval', eval_id: id, team_id: teamId }, actor: actorOf(p) });
  } catch { /* ignore */ }
  return evalRowToObj(dbRow);
}

export async function updateEval(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.id || p.eval_id || '').trim();
  if (!id) throw new Error('Eval ID ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const target = await queryFirst<Record<string, unknown>>(env, `SELECT * FROM contractor_evaluations WHERE TRIM(eval_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  if (!target) throw new Error('ไม่พบการประเมินในโปรเจกต์: ' + id);

  const order: string[] = []; // header names สำหรับ response
  const setCols: string[] = [];
  const vals: unknown[] = [];
  const put = (header: string, col: string, v: unknown) => { order.push(header); setCols.push(`${col} = ?`); vals.push(v); };

  if (p.eval_date !== undefined) put('Eval Date', 'eval_date', p.eval_date);
  if (p.evaluator !== undefined) put('Evaluator', 'evaluator', String(p.evaluator).trim());
  if (p.remark !== undefined) put('Remark', 'remark', String(p.remark).trim());

  if (p.sub_scores !== undefined || p.kpi_scores !== undefined || p.item_results !== undefined) {
    const kpiScores = parseSub(p.kpi_scores);
    const itemResults = parseSub(p.item_results);
    let computed: { kpi: Record<string, number>; total: number; weightUsed: number };
    let auditStore: Record<string, unknown>;
    if (Object.keys(kpiScores).length > 0) { computed = computeFromKpi(kpiScores); auditStore = Object.keys(itemResults).length > 0 ? itemResults : kpiScores; }
    else { const subScores = parseSub(p.sub_scores); computed = computeFromSub(subScores); auditStore = subScores; }
    if (computed.weightUsed <= 0) throw new Error('ต้องประเมินอย่างน้อย 1 หมวด');
    for (const def of EVAL_KPIS) put(def.key, def.col, computed.kpi[def.key]);
    put('Total Score', 'total_score', computed.total);
    put('Grade', 'grade', gradeFromTotal(computed.total));
    put('Status', 'status', statusFromTotal(computed.total));
    put('Sub Scores', 'sub_scores', JSON.stringify(auditStore));
  }

  if (!order.length) throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');
  await exec(env, `UPDATE contractor_evaluations SET ${setCols.join(', ')} WHERE TRIM(eval_id) = ? AND ${scope.sql}`, ...vals, id, ...scope.binds);
  return { id, updated_fields: order };
}

export async function deleteEval(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.id || p.eval_id || '').trim();
  if (!id) throw new Error('Eval ID ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const target = await queryFirst(env, `SELECT eval_id FROM contractor_evaluations WHERE TRIM(eval_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  if (!target) throw new Error('ไม่พบการประเมิน: ' + id);
  await exec(env, `DELETE FROM contractor_evaluations WHERE TRIM(eval_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  return { id, deleted: 1 };
}

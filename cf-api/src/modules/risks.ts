// ============================================================
// modules/risks.ts — port จาก apps-script/risks.gs
// actions: create_risk, update_risk, delete_risk, clone_risks
//   (skip: _phase_r1_migrate, _seed_direk_template)
// + getRisksAsObjects (camelCase) สำหรับ getAll (Code.js:819)
//
// ★ contract-preserving: create/update คืน key = ชื่อ header เดิม (ตรง response เก่า)
//   getRisksAsObjects คืน camelCase (id/cat/desc/affected/sev/lScore/iScore/score...)
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, fmtDate } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr } from '../lib/time.ts';
import { autoLog } from '../lib/activity.ts';
import { lineNotifyImportant, ctxOf } from '../lib/line.ts';

const RISK_TEMPLATE_PROJECT = 'direk-template';

// header → D1 col
const H2C: Record<string, string> = {
  'Risk ID': 'risk_id', 'Category': 'category', 'Description': 'description', 'Affected FF': 'affected_ff',
  'Severity': 'severity', 'Likelihood': 'likelihood', 'Impact': 'impact', 'Likelihood Score': 'likelihood_score',
  'Impact Score': 'impact_score', 'Risk Score': 'risk_score', 'Causes': 'causes', 'Affected Parties': 'affected_parties',
  'Mitigation Plan': 'mitigation', 'Status': 'status', 'Owner': 'owner', 'Date Identified': 'date_identified',
};

function actorOf(p: Record<string, unknown>): TokenPayload | null {
  return (p.__actor as TokenPayload | null) ?? null;
}
function validateScore(v: unknown, name: string): number {
  const n = parseInt(String(v), 10);
  if (isNaN(n) || n < 1 || n > 5) throw new Error(name + ' ต้องเป็นเลข 1-5');
  return n;
}
function severityFromScore(score: number): string {
  if (score >= 16) return 'High';
  if (score >= 9) return 'Medium';
  return 'Low';
}

// ── getRisksAsObjects (Code.js:819) — camelCase สำหรับ getAll ──
export async function getRisksAsObjects(env: Env, projectId: string): Promise<Record<string, unknown>[]> {
  const scope = projectScope(projectId);
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM risks WHERE ${scope.sql}`, ...scope.binds);
  return rows.map((r) => {
    const lScore = parseInt(String(r.likelihood_score || 0), 10) || 0;
    const iScore = parseInt(String(r.impact_score || 0), 10) || 0;
    let score = parseInt(String(r.risk_score || 0), 10) || 0;
    if (!score && lScore && iScore) score = lScore * iScore;
    return {
      id: r.risk_id || '', cat: r.category || '', desc: r.description || '', affected: r.affected_ff || '',
      affectedParties: r.affected_parties || '', sev: r.severity || '', likelihood: r.likelihood || '',
      impact: r.impact || '', lScore, iScore, score, causes: r.causes || '', mitigation: r.mitigation || '',
      status: r.status || '', owner: r.owner || '', identified: fmtDate(r.date_identified),
    };
  });
}

// ── create_risk (risks.gs:294) ──
export async function createRisk(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const desc = String(p.description || p.desc || '').trim();
  if (!desc) throw new Error('Description ต้องระบุ');
  const lScore = validateScore(p.likelihood_score, 'Likelihood Score');
  const iScore = validateScore(p.impact_score, 'Impact Score');
  const score = lScore * iScore;
  const id = await nextId(env, 'R', 3);
  const row: Record<string, unknown> = {
    'Risk ID': id, 'Category': String(p.category || '').trim(), 'Description': desc,
    'Affected FF': String(p.affected_ff || '').trim(), 'Severity': severityFromScore(score),
    'Likelihood': String(lScore), 'Impact': String(iScore), 'Likelihood Score': lScore, 'Impact Score': iScore,
    'Risk Score': score, 'Causes': String(p.causes || '').trim(), 'Affected Parties': String(p.affected_parties || '').trim(),
    'Mitigation Plan': String(p.mitigation || p.mitigation_plan || '').trim(), 'Status': String(p.status || 'Open').trim(),
    'Owner': String(p.owner || '').trim(), 'Date Identified': todayStr(),
  };
  await exec(
    env,
    `INSERT INTO risks (risk_id, project_id, category, description, affected_ff, severity, likelihood, impact,
       likelihood_score, impact_score, risk_score, causes, affected_parties, mitigation, status, owner, date_identified)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pid, row['Category'], desc, row['Affected FF'], row['Severity'], row['Likelihood'], row['Impact'],
    lScore, iScore, score, row['Causes'], row['Affected Parties'], row['Mitigation Plan'], row['Status'], row['Owner'], row['Date Identified'],
  );
  row.project_id = pid;
  try {
    const rMsg = '⚠️ เพิ่มความเสี่ยง: ' + desc + ' (ระดับ ' + row['Severity'] + ')';
    await autoLog(env, rMsg, { meta: { kind: 'risk', risk_id: id }, actor: actorOf(p) });
    if (score >= 12) lineNotifyImportant(env, rMsg, ctxOf(p));
  } catch { /* ignore */ }
  return row;
}

// ── update_risk (risks.gs:336) ──
export async function updateRisk(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.id || p.risk_id || '').trim();
  if (!id) throw new Error('Risk ID ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const target = await queryFirst<Record<string, unknown>>(env, `SELECT * FROM risks WHERE TRIM(risk_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  if (!target) throw new Error('ไม่พบ risk ในโปรเจกต์: ' + id);

  // fieldMap เดิม (header) — order สำคัญ
  const fieldMap: { param: string; header: string }[] = [
    { param: 'description', header: 'Description' }, { param: 'desc', header: 'Description' },
    { param: 'category', header: 'Category' }, { param: 'cat', header: 'Category' },
    { param: 'affected_ff', header: 'Affected FF' }, { param: 'affected_parties', header: 'Affected Parties' },
    { param: 'causes', header: 'Causes' }, { param: 'mitigation', header: 'Mitigation Plan' },
    { param: 'mitigation_plan', header: 'Mitigation Plan' }, { param: 'owner', header: 'Owner' }, { param: 'status', header: 'Status' },
  ];
  const updates: Record<string, unknown> = {};
  const order: string[] = [];
  for (const f of fieldMap) {
    if (p[f.param] === undefined || p[f.param] === null) continue;
    if (!(f.header in updates)) order.push(f.header);
    updates[f.header] = String(p[f.param]).trim();
  }

  const newL = p.likelihood_score !== undefined && p.likelihood_score !== null && p.likelihood_score !== '' ? validateScore(p.likelihood_score, 'Likelihood Score') : null;
  const newI = p.impact_score !== undefined && p.impact_score !== null && p.impact_score !== '' ? validateScore(p.impact_score, 'Impact Score') : null;
  if (newL !== null || newI !== null) {
    const finalL = newL !== null ? newL : parseInt(String(target.likelihood_score || 0), 10);
    const finalI = newI !== null ? newI : parseInt(String(target.impact_score || 0), 10);
    if (finalL && finalI) {
      for (const [h, v] of [['Likelihood Score', finalL], ['Impact Score', finalI], ['Risk Score', finalL * finalI], ['Likelihood', String(finalL)], ['Impact', String(finalI)], ['Severity', severityFromScore(finalL * finalI)]] as [string, unknown][]) {
        if (!(h in updates)) order.push(h);
        updates[h] = v;
      }
    }
  }
  if (!order.length) throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');

  const setCols = order.map((h) => `${H2C[h]} = ?`);
  const vals = order.map((h) => updates[h]);
  await exec(env, `UPDATE risks SET ${setCols.join(', ')} WHERE TRIM(risk_id) = ? AND ${scope.sql}`, ...vals, id, ...scope.binds);
  return { id, updated_fields: order };
}

// ── delete_risk (risks.gs:394) ──
export async function deleteRisk(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.id || p.risk_id || '').trim();
  if (!id) throw new Error('Risk ID ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const target = await queryFirst(env, `SELECT risk_id FROM risks WHERE TRIM(risk_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  if (!target) throw new Error('ไม่พบ risk: ' + id);
  await exec(env, `DELETE FROM risks WHERE TRIM(risk_id) = ? AND ${scope.sql}`, id, ...scope.binds);
  return { id, deleted: 1 };
}

// ── clone_risks (risks.gs:217) ──
export async function cloneRisks(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const target = String(p.target_project_id || p.project_id || '').trim();
  const source = String(p.source_project_id || RISK_TEMPLATE_PROJECT).trim();
  if (!target) throw new Error('target_project_id ต้องระบุ');
  if (target === source) throw new Error('target และ source ต้องไม่ใช่อันเดียวกัน');
  if (target === RISK_TEMPLATE_PROJECT) throw new Error('ไม่อนุญาตให้คัดลอกเข้า template');

  const tScope = projectScope(target);
  const existing = await queryAll(env, `SELECT risk_id FROM risks WHERE ${tScope.sql}`, ...tScope.binds);
  if (existing.length > 0) throw new Error('โปรเจกต์ปลายทางมี risk อยู่แล้ว ' + existing.length + ' รายการ — ยกเลิก');

  const sScope = projectScope(source);
  const sourceRisks = await queryAll<Record<string, unknown>>(env, `SELECT * FROM risks WHERE ${sScope.sql}`, ...sScope.binds);
  if (sourceRisks.length === 0) throw new Error('โปรเจกต์ต้นแบบไม่มี risk: ' + source);

  const today = todayStr();
  let cloned = 0;
  for (const r of sourceRisks) {
    const id = await nextId(env, 'R', 3);
    await exec(
      env,
      `INSERT INTO risks (risk_id, project_id, category, description, affected_ff, severity, likelihood, impact,
         likelihood_score, impact_score, risk_score, causes, affected_parties, mitigation, status, owner, date_identified)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)`,
      id, target, r.category || '', r.description || '', r.severity || '', r.likelihood || '', r.impact || '',
      r.likelihood_score || '', r.impact_score || '', r.risk_score || '', r.causes || '', r.affected_parties || '',
      r.mitigation || '', r.owner || '', today,
    );
    cloned++;
  }
  return { source, target, risks_cloned: cloned };
}

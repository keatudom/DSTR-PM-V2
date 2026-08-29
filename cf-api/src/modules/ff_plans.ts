// ============================================================
// modules/ff_plans.ts — แผนไทม์ไลน์ (Gantt) รายโครงการ
//
// เดิม: แผนอยู่ใน js/config.js เป็น CONFIG.GANTT_PLAN ผูกกับ "รหัส F-xx" เฉยๆ
//   → บ้านคนละหลังที่ใช้รหัส F-01 เหมือนกันจะยืมแผนกันมั่ว
//   → เปิดโครงการใหม่ต้องให้โปรแกรมเมอร์แก้ไฟล์ทุกครั้ง
// ตอนนี้: ตาราง ff_plans ผูก (project_id, ff_code, phase) — ผู้ใช้ตั้งเองได้จากหน้าเว็บ
//
// ★ รูปแบบที่คืนออกไปตั้งใจให้ "เหมือน CONFIG.GANTT_PLAN เดิมเป๊ะ"
//   { 'F-01': [[phase, startWeek, endWeek], ...] }
//   → frontend สลับมาอ่านจากตรงนี้ได้โดยไม่ต้องแก้สูตรคำนวณเลย
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, exec, projectScope, pidOf } from '../lib/db.ts';

export type GanttPlan = Record<string, [number, number, number][]>;

// ── get_ff_plans ──
export async function getFFPlans(env: Env, projectId: string): Promise<GanttPlan> {
  const scope = projectScope(projectId);
  const rows = await queryAll<{ ff_code: string; phase: number; start_week: number; end_week: number }>(
    env,
    `SELECT ff_code, phase, start_week, end_week FROM ff_plans WHERE ${scope.sql} ORDER BY ff_code, phase`,
    ...scope.binds,
  );
  const out: GanttPlan = {};
  for (const r of rows) {
    const code = String(r.ff_code || '').trim();
    if (!code) continue;
    (out[code] ||= []).push([Number(r.phase), Number(r.start_week), Number(r.end_week)]);
  }
  return out;
}

// รับ phases ได้ทั้ง array จริง (callPost) และ JSON string (callRead ที่ต่อมาทาง URL)
export function parsePhases(v: unknown): [number, number, number][] {
  let raw: unknown = v;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { throw new Error('phases ไม่ใช่ JSON ที่อ่านได้'); }
  }
  if (!Array.isArray(raw)) throw new Error('phases ต้องเป็น array');

  const out: [number, number, number][] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 3) throw new Error('แต่ละงวดต้องเป็น [งวด, สัปดาห์เริ่ม, สัปดาห์จบ]');
    const phase = parseInt(String(item[0]), 10);
    const start = parseInt(String(item[1]), 10);
    const end = parseInt(String(item[2]), 10);
    if (!(phase >= 1 && phase <= 4)) throw new Error('งวดต้องอยู่ระหว่าง 1-4 (ได้ ' + item[0] + ')');
    if (!(start >= 1) || !(end >= 1)) throw new Error('สัปดาห์ต้องเป็นตัวเลขตั้งแต่ 1 ขึ้นไป');
    if (end < start) throw new Error('งวด ' + phase + ': สัปดาห์จบต้องไม่น้อยกว่าสัปดาห์เริ่ม');
    out.push([phase, start, end]);
  }
  return out;
}

// ── save_ff_plan — เขียนทับแผนของชิ้นงานนั้นทั้งชิ้น (ส่ง phases ว่าง = ลบแผน) ──
export async function saveFFPlan(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const code = String(p.ff_code || p.code || '').trim();
  if (!code) throw new Error('ff_code required');

  const phases = parsePhases(p.phases ?? []);
  const seen = new Set<number>();
  for (const [phase] of phases) {
    if (seen.has(phase)) throw new Error('งวด ' + phase + ' ซ้ำ — ใส่ได้งวดละครั้ง');
    seen.add(phase);
  }

  await exec(env, 'DELETE FROM ff_plans WHERE project_id = ? AND ff_code = ?', pid, code);
  for (const [phase, start, end] of phases) {
    await exec(
      env,
      'INSERT INTO ff_plans (project_id, ff_code, phase, start_week, end_week) VALUES (?, ?, ?, ?, ?)',
      pid, code, phase, start, end,
    );
  }
  return { ok: true, project_id: pid, ff_code: code, phases_saved: phases.length };
}

// ── delete_ff_plan ──
export async function deleteFFPlan(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const code = String(p.ff_code || p.code || '').trim();
  if (!code) throw new Error('ff_code required');
  await exec(env, 'DELETE FROM ff_plans WHERE project_id = ? AND ff_code = ?', pid, code);
  return { ok: true, project_id: pid, ff_code: code };
}

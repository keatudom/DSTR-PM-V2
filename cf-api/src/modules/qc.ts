// ============================================================
// modules/qc.ts — ★ ฟีเจอร์ใหม่ (Session 3): QC Checklist บ้านคุณวริษฐา
// ตรวจคุณภาพงานเฟอร์นิเจอร์บิวท์อินก่อนส่งมอบ (26 ข้อ หมวด A–I)
//
// actions (7):
//   get_qc_criteria      — รายการเกณฑ์มาตรฐาน (จาก qc_criteria; seed จาก xlsx ต้นแบบ)
//   get_qc_inspections   — รายการการตรวจต่อโครงการ (filter ff_code / status)
//   get_qc_inspection    — หัวการตรวจ + ผลรายข้อ (join criteria)
//   create_qc_inspection — สร้างหัว + แถวผลตามเกณฑ์ active (รอบใหม่ = round+1)
//   update_qc_result     — ติ๊ก pass/fail/na + defect_class + note + photo_url + แก้ไข/ตรวจซ้ำ
//   close_qc_inspection  — สรุป pass/fail/na → สถานะ (ผ่าน / ผ่านมีเงื่อนไข / ไม่ผ่าน)
//   qc_summary           — สรุปต่อ FF (รอบล่าสุด + defect ค้าง C/M/Mn) เลี้ยง dashboard
//
// กติกาสถานะ (จากไฟล์ต้นแบบ):
//   มี C ค้าง        → ไม่ผ่าน (fail)
//   มี M ค้าง        → ผ่านมีเงื่อนไข ต้องแก้+ตรวจซ้ำ (conditional)
//   มี Mn ค้าง       → ผ่านมีเงื่อนไข บันทึกการแก้ไข (conditional)
//   ไม่มี defect ค้าง → ผ่าน (pass)
//   "ค้าง" = ผล fail ที่ยังไม่ถูกตรวจซ้ำผ่าน (recheck_result != 'pass')
//
// ★ ทดสอบบน project "_test-mig" เท่านั้น — ห้ามเขียนลง bow-house จริง
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, exec } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr } from '../lib/time.ts';

const VALID_RESULTS = new Set(['pass', 'fail', 'na', '']); // '' = ยังไม่ตรวจ
const VALID_DEFECT_CLASS = new Set(['C', 'M', 'Mn', '']);

interface CriteriaRow {
  criteria_id: string;
  section: string;
  section_name: string;
  seq: number;
  item: string;
  acceptance: string;
  method: string;
  defects: string;
  defect_class: string;
  active: unknown;
}

interface InspectionRow {
  inspection_id: string;
  project_id: string;
  ff_code: string;
  item_name: string;
  location: string;
  maker: string;
  drawing_ref: string;
  inspector: string;
  inspect_date: string;
  round: number;
  status: string;
  summary_pass: number;
  summary_fail: number;
  summary_na: number;
  notes: string;
  created_at: string;
}

interface ResultRow {
  result_id: string;
  inspection_id: string;
  criteria_id: string;
  result: string;
  defect_class: string;
  note: string;
  photo_url: string;
  fixed_date: string;
  recheck_result: string;
}

// สถานะ machine → ป้ายไทย (ไว้โชว์บนหน้าเว็บ)
const STATUS_LABEL: Record<string, string> = {
  pending: 'รอตรวจ',
  pass: 'ผ่าน — พร้อมส่งมอบ',
  conditional: 'ผ่านมีเงื่อนไข — ต้องแก้ไข/ตรวจซ้ำ',
  fail: 'ไม่ผ่าน — มี defect วิกฤต (C) ต้องแก้ก่อนส่งมอบ',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] || status;
}

// ── get_qc_criteria — เกณฑ์ที่ยัง active เรียงตาม seq ──
export async function getQcCriteria(env: Env): Promise<unknown> {
  const rows = await queryAll<CriteriaRow>(
    env,
    `SELECT criteria_id, section, section_name, seq, item, acceptance, method, defects, defect_class
     FROM qc_criteria
     WHERE active NOT IN ('FALSE','false','0') AND active IS NOT NULL
     ORDER BY seq`,
  );
  return rows;
}

// ── get_qc_inspections — รายการตรวจต่อโครงการ (filter ff_code/status) ──
export async function getQcInspections(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = String(p.project_id || '');
  const conds = ['project_id = ?'];
  const args: unknown[] = [projectId];
  if (p.ff_code) { conds.push('ff_code = ?'); args.push(String(p.ff_code)); }
  if (p.status) { conds.push('status = ?'); args.push(String(p.status)); }

  const rows = await queryAll<InspectionRow>(
    env,
    `SELECT * FROM qc_inspections WHERE ${conds.join(' AND ')}
     ORDER BY created_at DESC, round DESC`,
    ...args,
  );
  return rows.map((r) => ({ ...r, status_label: statusLabel(r.status) }));
}

// ── get_qc_inspection — หัว + ผลรายข้อ (join criteria เพื่อโชว์ครบ) ──
export async function getQcInspection(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const inspectionId = String(p.inspection_id || '');
  if (!inspectionId) throw new Error('inspection_id required');

  const inspection = await queryFirst<InspectionRow>(
    env,
    'SELECT * FROM qc_inspections WHERE inspection_id = ?',
    inspectionId,
  );
  if (!inspection) throw new Error('ไม่พบการตรวจ inspection_id นี้');

  const results = await queryAll<ResultRow & Partial<CriteriaRow>>(
    env,
    `SELECT r.result_id, r.inspection_id, r.criteria_id, r.result, r.defect_class,
            r.note, r.photo_url, r.fixed_date, r.recheck_result,
            c.section, c.section_name, c.seq, c.item, c.acceptance, c.method,
            c.defects, c.defect_class AS criteria_defect_class
     FROM qc_results r
     JOIN qc_criteria c ON r.criteria_id = c.criteria_id
     WHERE r.inspection_id = ?
     ORDER BY c.seq`,
    inspectionId,
  );

  return {
    inspection: { ...inspection, status_label: statusLabel(inspection.status) },
    results,
  };
}

// ── create_qc_inspection — สร้างหัว + แถวผลตามเกณฑ์ active (atomic ผ่าน batch) ──
export async function createQcInspection(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = String(p.project_id || '');
  if (!projectId) throw new Error('project_id required');
  const ffCode = String(p.ff_code || '');

  // รอบตรวจ: ถ้าส่งมา ใช้ตามนั้น; ไม่ส่ง → รอบล่าสุดของ FF นี้ + 1 (เริ่ม 1)
  let round = Number(p.round || 0);
  if (!round) {
    const maxRow = await queryFirst<{ mx: number | null }>(
      env,
      'SELECT MAX(round) AS mx FROM qc_inspections WHERE project_id = ? AND ff_code = ?',
      projectId,
      ffCode,
    );
    round = (maxRow?.mx || 0) + 1;
  }

  const criteria = await queryAll<CriteriaRow>(
    env,
    `SELECT criteria_id FROM qc_criteria
     WHERE active NOT IN ('FALSE','false','0') AND active IS NOT NULL
     ORDER BY seq`,
  );
  if (criteria.length === 0) throw new Error('ยังไม่มีเกณฑ์ QC (ยังไม่ได้ seed qc_criteria)');

  const inspectionId = await nextId(env, 'QCI-', 4);
  const now = todayStr();
  const inspectDate = String(p.inspect_date || now);

  // header + N ผลรายข้อ ยิงเป็น batch เดียว (atomic)
  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    env.DB.prepare(
      `INSERT INTO qc_inspections
        (inspection_id, project_id, ff_code, item_name, location, maker, drawing_ref,
         inspector, inspect_date, round, status, summary_pass, summary_fail, summary_na,
         notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, 0, 0, ?, ?)`,
    ).bind(
      inspectionId,
      projectId,
      ffCode,
      String(p.item_name || ''),
      String(p.location || ''),
      String(p.maker || ''),
      String(p.drawing_ref || ''),
      String(p.inspector || ''),
      inspectDate,
      round,
      String(p.notes || ''),
      now,
    ),
  );
  for (const c of criteria) {
    // result_id = natural key (inspection + criteria) → unique เสมอ ไม่ต้องใช้ counter
    const resultId = `${inspectionId}__${c.criteria_id}`;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO qc_results
          (result_id, inspection_id, criteria_id, result, defect_class, note, photo_url, fixed_date, recheck_result)
         VALUES (?, ?, ?, '', '', '', '', '', '')`,
      ).bind(resultId, inspectionId, c.criteria_id),
    );
  }
  await env.DB.batch(stmts);

  // คืน data ดิบ — router ห่อ {ok,data} ให้ (ห้ามใส่ ok เองซ้ำ)
  return {
    inspection_id: inspectionId,
    round,
    results_created: criteria.length,
  };
}

// ── update_qc_result — ติ๊กผลรายข้อ (pass/fail/na) + defect + note + รูป + ตรวจซ้ำ ──
export async function updateQcResult(env: Env, p: Record<string, unknown>): Promise<unknown> {
  // ระบุแถวด้วย result_id หรือ (inspection_id + criteria_id)
  let resultId = String(p.result_id || '');
  if (!resultId) {
    const insId = String(p.inspection_id || '');
    const critId = String(p.criteria_id || '');
    if (!insId || !critId) throw new Error('ต้องระบุ result_id หรือ (inspection_id + criteria_id)');
    resultId = `${insId}__${critId}`;
  }

  const existing = await queryFirst<ResultRow>(
    env,
    'SELECT * FROM qc_results WHERE result_id = ?',
    resultId,
  );
  if (!existing) throw new Error('ไม่พบผลตรวจ (result_id นี้)');

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (p.result !== undefined) {
    const result = String(p.result);
    if (!VALID_RESULTS.has(result)) throw new Error('result ต้องเป็น pass/fail/na');
    sets.push('result = ?');
    vals.push(result);
    // ถ้าไม่ใช่ fail → เคลียร์ defect_class (defect มีความหมายเฉพาะตอน fail)
    if (result !== 'fail') {
      sets.push('defect_class = ?');
      vals.push('');
    }
  }
  if (p.defect_class !== undefined) {
    const dc = String(p.defect_class);
    if (!VALID_DEFECT_CLASS.has(dc)) throw new Error('defect_class ต้องเป็น C/M/Mn');
    // เขียน defect_class เฉพาะเมื่อผลเป็น fail (หรือกำลังตั้งเป็น fail)
    const willBeFail = p.result !== undefined ? String(p.result) === 'fail' : existing.result === 'fail';
    if (willBeFail) {
      // แทนที่ค่าเดิม (ถ้ามี set ไปแล้วจากบล็อกบน)
      const idx = sets.indexOf('defect_class = ?');
      if (idx !== -1) { vals[idx] = dc; } else { sets.push('defect_class = ?'); vals.push(dc); }
    }
  }
  if (p.note !== undefined) { sets.push('note = ?'); vals.push(String(p.note)); }
  if (p.photo_url !== undefined) { sets.push('photo_url = ?'); vals.push(String(p.photo_url)); }
  if (p.fixed_date !== undefined) { sets.push('fixed_date = ?'); vals.push(String(p.fixed_date)); }
  if (p.recheck_result !== undefined) {
    const rr = String(p.recheck_result);
    if (!VALID_RESULTS.has(rr)) throw new Error('recheck_result ต้องเป็น pass/fail/na');
    sets.push('recheck_result = ?');
    vals.push(rr);
  }

  if (sets.length === 0) throw new Error('ไม่มีข้อมูลให้แก้');

  vals.push(resultId);
  await exec(env, `UPDATE qc_results SET ${sets.join(', ')} WHERE result_id = ?`, ...vals);

  const updated = await queryFirst<ResultRow>(env, 'SELECT * FROM qc_results WHERE result_id = ?', resultId);
  return { result: updated };
}

// นับ defect ค้าง (fail ที่ยังไม่ตรวจซ้ำผ่าน) แยกตามระดับ
function countPendingDefects(results: ResultRow[]): { C: number; M: number; Mn: number } {
  const out = { C: 0, M: 0, Mn: 0 };
  for (const r of results) {
    if (r.result !== 'fail') continue;
    if (r.recheck_result === 'pass') continue; // แก้แล้ว ตรวจซ้ำผ่าน → ไม่ค้าง
    if (r.defect_class === 'C') out.C++;
    else if (r.defect_class === 'M') out.M++;
    else if (r.defect_class === 'Mn') out.Mn++;
    else out.M++; // fail แต่ไม่ระบุระดับ → นับเป็น M (กันหลุด)
  }
  return out;
}

function computeStatus(defects: { C: number; M: number; Mn: number }): string {
  if (defects.C > 0) return 'fail';
  if (defects.M > 0 || defects.Mn > 0) return 'conditional';
  return 'pass';
}

// ── close_qc_inspection — สรุปผล + ตั้งสถานะตามกติกา C/M/Mn ──
export async function closeQcInspection(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const inspectionId = String(p.inspection_id || '');
  if (!inspectionId) throw new Error('inspection_id required');

  const inspection = await queryFirst<InspectionRow>(
    env,
    'SELECT * FROM qc_inspections WHERE inspection_id = ?',
    inspectionId,
  );
  if (!inspection) throw new Error('ไม่พบการตรวจ inspection_id นี้');

  const results = await queryAll<ResultRow>(
    env,
    'SELECT * FROM qc_results WHERE inspection_id = ?',
    inspectionId,
  );

  const summaryPass = results.filter((r) => r.result === 'pass').length;
  const summaryFail = results.filter((r) => r.result === 'fail').length;
  const summaryNa = results.filter((r) => r.result === 'na').length;
  const defects = countPendingDefects(results);
  const status = computeStatus(defects);

  await exec(
    env,
    `UPDATE qc_inspections
     SET status = ?, summary_pass = ?, summary_fail = ?, summary_na = ?
     WHERE inspection_id = ?`,
    status,
    summaryPass,
    summaryFail,
    summaryNa,
    inspectionId,
  );

  return {
    inspection_id: inspectionId,
    status,
    status_label: statusLabel(status),
    summary: { pass: summaryPass, fail: summaryFail, na: summaryNa },
    pending_defects: defects,
  };
}

// ── delete_qc_inspection — ลบหัว + ผลรายข้อทั้งหมด (กดผิด/ทดสอบ) ──
export async function deleteQcInspection(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const inspectionId = String(p.inspection_id || '');
  if (!inspectionId) throw new Error('inspection_id required');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM qc_results WHERE inspection_id = ?').bind(inspectionId),
    env.DB.prepare('DELETE FROM qc_inspections WHERE inspection_id = ?').bind(inspectionId),
  ]);
  return { deleted: inspectionId };
}

// ── qc_summary — สรุปต่อ FF (รอบล่าสุด + defect ค้าง) เลี้ยงการ์ด dashboard ──
export async function qcSummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = String(p.project_id || '');
  if (!projectId) throw new Error('project_id required');

  // การตรวจล่าสุด (รอบสูงสุด) ต่อ ff_code
  const inspections = await queryAll<InspectionRow>(
    env,
    `SELECT * FROM qc_inspections WHERE project_id = ? ORDER BY ff_code, round DESC`,
    projectId,
  );

  const latestByFf = new Map<string, InspectionRow>();
  for (const ins of inspections) {
    if (!latestByFf.has(ins.ff_code)) latestByFf.set(ins.ff_code, ins);
  }

  const perFf: unknown[] = [];
  const tally = { pass: 0, conditional: 0, fail: 0, pending: 0 };
  for (const ins of latestByFf.values()) {
    const results = await queryAll<ResultRow>(
      env,
      'SELECT * FROM qc_results WHERE inspection_id = ?',
      ins.inspection_id,
    );
    const defects = countPendingDefects(results);
    tally[ins.status as keyof typeof tally] = (tally[ins.status as keyof typeof tally] || 0) + 1;
    perFf.push({
      ff_code: ins.ff_code,
      item_name: ins.item_name,
      inspection_id: ins.inspection_id,
      round: ins.round,
      status: ins.status,
      status_label: statusLabel(ins.status),
      inspect_date: ins.inspect_date,
      pending_defects: defects,
    });
  }

  return {
    project_id: projectId,
    tally,
    ff_count: perFf.length,
    items: perFf,
  };
}

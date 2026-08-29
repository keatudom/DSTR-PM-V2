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

// ── settings (0009) — ค่าตั้งต้นรายโครงการที่เดิมฝังตายใน js/config.js ──
// เก็บเป็น JSON string ใน D1 · ส่งออกเป็น object ให้ frontend ใช้ตรงๆ
// รูปแบบ: { phases:[{key,label,sub,pct}], addon_ffs:[...] }
function parseSettings(v: unknown): Record<string, unknown> {
  if (v == null || v === '') return {};
  if (typeof v === 'object') return v as Record<string, unknown>;
  try {
    const o = JSON.parse(String(v));
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

// ตารางที่ถือ "ข้อมูลงานจริง" — มีแถวอยู่ = ห้ามลบโครงการ
const DATA_TABLES = [
  'activity_logs', 'boq_items', 'checkins', 'content_items', 'contractor_evaluations',
  'contracts', 'daily_reports', 'ff_items', 'material_photos', 'material_transactions',
  'materials', 'milestones', 'payments', 'project_staff', 'project_teams',
  'qc_inspections', 'quick_logs', 'risks', 'task_photos', 'tasks',
  'tour_links', 'tour_pins', 'tour_plans', 'tour_points', 'tour_shots', 'tour_versions',
] as const;

// ตารางที่เป็นแค่ "ค่าตั้งค่า" — ลบทิ้งไปพร้อมโครงการได้ ไม่ต้องกันการลบ
const SETTINGS_TABLES = ['site_config', 'brand_voice', 'ff_plans'] as const;

// ชื่อไทยของตาราง (ไว้บอกผู้ใช้ว่าลบไม่ได้เพราะติดอะไร)
const TABLE_LABELS: Record<string, string> = {
  activity_logs: 'บันทึกกิจกรรม', boq_items: 'รายการ BOQ', checkins: 'การเช็คอิน',
  content_items: 'คอนเทนต์', contractor_evaluations: 'การประเมินผู้รับเหมา',
  contracts: 'สัญญา', daily_reports: 'รายงานประจำวัน', ff_items: 'ชิ้นงาน (FF)',
  material_photos: 'รูปวัสดุ', material_transactions: 'การเบิก-รับวัสดุ',
  materials: 'วัสดุ', milestones: 'งวดสัญญา', payments: 'งวดเบิกผู้รับเหมา',
  project_staff: 'พนักงานที่ผูกไว้', project_teams: 'ทีมช่างที่ผูกไว้',
  qc_inspections: 'รอบตรวจ QC', quick_logs: 'บันทึกด่วน', risks: 'ความเสี่ยง',
  task_photos: 'รูปงาน', tasks: 'งานย่อย', tour_links: 'ลิงก์ทัวร์',
  tour_pins: 'หมุดทัวร์', tour_plans: 'ผังทัวร์', tour_points: 'จุดทัวร์',
  tour_shots: 'ภาพทัวร์', tour_versions: 'เวอร์ชันทัวร์',
};

// เงื่อนไข SQL ของ scope โครงการ — ธรรมเนียมเดิม: 'bow-house' ครอบแถว legacy ที่ project_id ว่าง
function scopeSql(col: string, pid: string): string {
  return pid === 'bow-house'
    ? `(${col} = ? OR ${col} IS NULL OR TRIM(${col}) = '')`
    : `${col} = ?`;
}

// ── get_projects (projects_patch.gs:44) — active ก่อน, ใหม่ก่อนเก่า ──
export async function getProjects(env: Env): Promise<unknown> {
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM projects');
  const out = rows
    .filter((r) => r.project_id)
    .map((r) => {
      const obj: Record<string, unknown> = {};
      for (const h of PROJECTS_HEADERS) obj[h] = blank(r[h]);
      obj.settings = parseSettings(r.settings);
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

  const editable = ['name', 'client', 'quote_no', 'start_date', 'end_date', 'total_days', 'total_value', 'contractor', 'status', 'settings'];
  const setCols: string[] = [];
  const vals: unknown[] = [];
  let updated = 0;
  for (const f of editable) {
    if (p[f] === undefined) continue;
    setCols.push(`${f} = ?`);
    // settings ส่งมาได้ทั้ง object (จาก callPost) และ JSON string (จาก callRead ที่ต่อ URL)
    vals.push(f === 'settings' && typeof p[f] === 'object' ? JSON.stringify(p[f]) : p[f]);
    updated++;
  }
  if (setCols.length) {
    await exec(env, `UPDATE projects SET ${setCols.join(', ')} WHERE TRIM(project_id) = TRIM(?)`, ...vals, p.project_id);
  }
  return { ok: true, project_id: p.project_id, updated };
}

// ── delete_project (ใหม่ 2026-08-29) ────────────────────────────
// ลบได้ "เฉพาะโครงการที่ว่างเปล่า" เท่านั้น — ถ้ามีข้อมูลงานจริงแม้แถวเดียวจะไม่ลบ
// และบอกกลับไปว่าติดอะไรอยู่บ้าง (กันลบโครงการจริงพลาด)
// อยากเอาโครงการที่ทำจริงออกจากสายตา → ใช้ update_project status='archived' แทน
export async function deleteProject(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = String(p.project_id || '').trim();
  if (!pid) throw new Error('project_id required');

  const exists = await queryFirst(env, 'SELECT project_id FROM projects WHERE TRIM(project_id) = TRIM(?)', pid);
  if (!exists) throw new Error('ไม่พบโครงการ: ' + pid);

  const blockers: { table: string; label: string; count: number }[] = [];
  for (const t of DATA_TABLES) {
    const row = await queryFirst<{ c: number }>(
      env, `SELECT COUNT(*) AS c FROM ${t} WHERE ${scopeSql('project_id', pid)}`, pid,
    );
    const c = Number(row?.c || 0);
    if (c > 0) blockers.push({ table: t, label: TABLE_LABELS[t] || t, count: c });
  }

  if (blockers.length) {
    const detail = blockers.map((b) => `${b.label} ${b.count}`).join(' · ');
    throw new Error(
      'ลบไม่ได้ — โครงการนี้ยังมีข้อมูลอยู่: ' + detail +
      '. ถ้าต้องการเอาออกจากรายการ ให้ใช้ "ปิดโครงการ" แทน',
    );
  }

  // ว่างจริง → เก็บกวาดค่าตั้งค่าที่ห้อยอยู่ แล้วลบตัวโครงการ
  for (const t of SETTINGS_TABLES) {
    await exec(env, `DELETE FROM ${t} WHERE ${scopeSql('project_id', pid)}`, pid);
  }
  await exec(env, 'DELETE FROM projects WHERE TRIM(project_id) = TRIM(?)', pid);
  return { ok: true, deleted: pid };
}

// ── get_projects_progress (ใหม่ 2026-08-29) ─────────────────────
// ความคืบหน้าจริงของ "ทุกโครงการ" ในคิวรีเดียว — ใช้วาดการ์ดในหน้ารายการโครงการ
// เดิมหน้ารายการคำนวณ % ให้ bow-house ตัวเดียว โครงการอื่นขึ้น "รอเพิ่มงาน" ตลอดกาล
//
// สูตรต้องตรงกับ frontend เป๊ะ (js/state.js buildWeights + calcFFProgressWeighted):
//   %ชิ้นงาน = น้ำหนักงานที่เสร็จ ÷ น้ำหนักงานทั้งชิ้น   (effort-based, PHASE_PROGRESS_WEIGHT=null)
//   %โครงการ = Σ (ราคาชิ้น ÷ ราคารวม) × %ชิ้นงาน
//   ถ้าทุกชิ้นราคา 0 (โครงการใหม่ที่ยังไม่ใส่ราคา) → ถ่วงเท่ากันทุกชิ้น ไม่งั้นได้ 0% ตลอด
export async function getProjectsProgress(env: Env): Promise<unknown> {
  const rows = await queryAll<{
    pid: string; code: string; price: number; zone: string | null;
    total_w: number; done_w: number; task_count: number;
  }>(env, `
    WITH ff AS (
      SELECT COALESCE(NULLIF(TRIM(project_id), ''), 'bow-house') AS pid,
             code, COALESCE(price, 0) AS price, zone
      FROM ff_items
    ),
    tk AS (
      SELECT COALESCE(NULLIF(TRIM(project_id), ''), 'bow-house') AS pid,
             ff_code, status, COALESCE(weight, 1) AS w
      FROM tasks
    )
    SELECT ff.pid AS pid, ff.code AS code, ff.price AS price, ff.zone AS zone,
           COALESCE(SUM(tk.w), 0) AS total_w,
           COALESCE(SUM(CASE WHEN tk.status = 'Done' THEN tk.w ELSE 0 END), 0) AS done_w,
           COUNT(tk.ff_code) AS task_count
    FROM ff LEFT JOIN tk ON tk.pid = ff.pid AND tk.ff_code = ff.code
    GROUP BY ff.pid, ff.code
  `);

  const byProject: Record<string, typeof rows> = {};
  for (const r of rows) (byProject[r.pid] ||= []).push(r);

  // มูลค่าโครงการ "ของจริง" = ผลรวมสัญญาฝั่งเจ้าบ้าน (party='client')
  // projects.total_value เป็นเลขพิมพ์มือที่ซ้ำกับสัญญา → ใช้เป็นแค่ค่าประมาณตอนยังไม่มีสัญญา
  const contractRows = await queryAll<{ pid: string; contract_value: number; paid: number }>(env, `
    SELECT COALESCE(NULLIF(TRIM(c.project_id), ''), 'bow-house') AS pid,
           COALESCE(SUM(COALESCE(c.value, 0)), 0) AS contract_value,
           COALESCE((SELECT SUM(COALESCE(m.paid_amount, 0)) FROM milestones m
                     WHERE m.contract_id IN (SELECT c2.contract_id FROM contracts c2
                       WHERE COALESCE(NULLIF(TRIM(c2.project_id), ''), 'bow-house') = COALESCE(NULLIF(TRIM(c.project_id), ''), 'bow-house')
                         AND LOWER(COALESCE(c2.party, '')) = 'client')), 0) AS paid
    FROM contracts c
    WHERE LOWER(COALESCE(c.party, '')) = 'client'
    GROUP BY pid
  `);
  const contractBy: Record<string, { contract_value: number; paid: number }> = {};
  for (const r of contractRows) contractBy[r.pid] = { contract_value: Number(r.contract_value || 0), paid: Number(r.paid || 0) };

  const projects = await queryAll<{ project_id: string; total_value: number }>(env, 'SELECT project_id, total_value FROM projects');
  const out: Record<string, unknown>[] = [];

  for (const p of projects) {
    const pid = String(p.project_id || '').trim();
    if (!pid) continue;
    const ffs = byProject[pid] || [];
    const totalPrice = ffs.reduce((s, f) => s + Number(f.price || 0), 0);
    const equalWeight = totalPrice <= 0;   // ยังไม่ใส่ราคา → ถ่วงเท่ากัน

    let pct = 0;
    for (const f of ffs) {
      const ffWeight = equalWeight ? (1 / ffs.length) : (Number(f.price || 0) / totalPrice);
      const ffPct = Number(f.total_w) > 0 ? Number(f.done_w) / Number(f.total_w) : 0;
      pct += ffWeight * ffPct;
    }

    const zones = new Set(ffs.map((f) => String(f.zone || '').trim()).filter(Boolean));
    const ct = contractBy[pid] || { contract_value: 0, paid: 0 };
    const typedValue = Number(p.total_value || 0);
    out.push({
      project_id: pid,
      // มูลค่าตามสัญญาเจ้าบ้าน (0 = ยังไม่มีสัญญา) · value_source บอกว่าเลขที่ควรโชว์มาจากไหน
      contract_value: ct.contract_value,
      contract_paid: ct.paid,
      typed_value: typedValue,
      effective_value: ct.contract_value > 0 ? ct.contract_value : typedValue,
      value_source: ct.contract_value > 0 ? 'contract' : (typedValue > 0 ? 'typed' : 'none'),
      ff_price_sum: Math.round(totalPrice * 100) / 100,
      ff_count: ffs.length,
      task_count: ffs.reduce((s, f) => s + Number(f.task_count || 0), 0),
      done_task_weight: ffs.reduce((s, f) => s + Number(f.done_w || 0), 0),
      total_task_weight: ffs.reduce((s, f) => s + Number(f.total_w || 0), 0),
      zone_count: zones.size,
      progress_pct: Math.round(pct * 100 * 10) / 10,
    });
  }
  return out;
}

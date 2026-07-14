// ============================================================
// db.ts — helper query D1 + mapper snake_case → key เดิมของ API
//
// หลักการ (BLUEPRINT §3): ตาราง D1 = header เดิมแปลง snake_case;
// handler แปลงกลับเป็น key ที่หน้าเว็บรอ "ตอนตอบ" ผ่าน mapping table
// ต่อ endpoint (ไม่ใช่ magic auto-convert) — Session 2 เพิ่ม mapping ราย endpoint
// ============================================================
import type { Env } from './env.ts';

// query หลายแถว
export async function queryAll<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const res = await env.DB.prepare(sql).bind(...params).all<T>();
  return res.results ?? [];
}

// query แถวเดียว (หรือ null)
export async function queryFirst<T = Record<string, unknown>>(
  env: Env,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  return (await env.DB.prepare(sql).bind(...params).first<T>()) ?? null;
}

// exec (INSERT/UPDATE/DELETE)
export async function exec(env: Env, sql: string, ...params: unknown[]): Promise<D1Result> {
  return env.DB.prepare(sql).bind(...params).run();
}

// ── mapper: แปลง row ตาม mapping {dbCol → apiKey} ──
// คอลัมน์ที่ไม่อยู่ใน mapping จะถูกตัดทิ้ง (ทำ whitelist ไปในตัว)
export type ColMap = Record<string, string>;

export function mapRow(row: Record<string, unknown>, map: ColMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const dbCol in map) {
    out[map[dbCol]] = row[dbCol];
  }
  return out;
}

export function mapRows(rows: Record<string, unknown>[], map: ColMap): Record<string, unknown>[] {
  return rows.map((r) => mapRow(r, map));
}

// ── ตัวช่วยแปลงค่า boolean เดิมของ Sheets ('TRUE'/'FALSE'/true/false/1/0) ──
// ระบบเก่าเก็บ active เป็นได้หลายชนิด — normalize เป็น boolean เดียว
export function toBool(v: unknown): boolean {
  return !(v === false || v === 'FALSE' || v === 'false' || v === 0 || v === '0' || v === '' || v == null);
}

// project_id ของ request (แทน _getCurrentProjectId_() || 'bow-house' เดิม)
export function pidOf(p: Record<string, unknown>): string {
  return String(p.project_id ?? '').trim() || 'bow-house';
}

// project scope SQL — เทียบ _filterByProject_ (projects_filter.gs:30)
//   'bow-house' รวมแถวที่ project_id ว่าง/null (legacy ยังไม่ stamp) · อื่น = exact match
export function projectScope(pid: string, col = 'project_id'): { sql: string; binds: unknown[] } {
  if (pid === 'bow-house') {
    return { sql: `(${col} = ? OR ${col} IS NULL OR TRIM(${col}) = '')`, binds: [pid] };
  }
  return { sql: `${col} = ?`, binds: [pid] };
}

// formatDateValue (Code.js:848) — D1 เก็บวันที่เป็น TEXT อยู่แล้ว → String; ว่าง → ''
export function fmtDate(v: unknown): string {
  return v == null || v === '' ? '' : String(v);
}

// raw read: Sheets ช่องว่าง = '' แต่ seed แปลงเป็น NULL → coalesce null→'' ให้ตรงพฤติกรรมเดิม
// (ใช้กับ action ที่คืน getAllRows(...) ดิบ เช่น get_materials/get_suppliers/get_daily_reports)
export function blankNulls(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k in row) out[k] = row[k] == null ? '' : row[k];
  return out;
}

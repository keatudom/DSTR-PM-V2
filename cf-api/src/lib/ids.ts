// ============================================================
// ids.ts — ออกเลขรายการแบบ atomic ผ่านตาราง id_counters
// แทน generateId เดิม (Code.js:589) ที่ full-scan หา max ทุก insert
//   → แก้ทั้งเรื่องช้า และเรื่องเลขซ้ำ (ระบบเก่าไม่มี LockService)
//
// seed ตั้ง next_seq = maxเดิม + 1 ต่อ prefix (ดู seed/export-import.mjs)
// รูปแบบเลขเดิม: prefix + zero-pad (Code.js:597 = pad 3, nextLogId_ = pad 4)
// ============================================================
import type { Env } from './env.ts';

// เพิ่มเลขถัดไปแบบ atomic แล้วคืนค่าตัวเลข (upsert: ถ้ายังไม่มี prefix เริ่มที่ 1)
export async function nextSeq(env: Env, prefix: string): Promise<number> {
  const row = await env.DB.prepare(
    `INSERT INTO id_counters (prefix, next_seq) VALUES (?, 1)
     ON CONFLICT(prefix) DO UPDATE SET next_seq = next_seq + 1
     RETURNING next_seq`,
  )
    .bind(prefix)
    .first<{ next_seq: number }>();
  if (!row) throw new Error('nextSeq failed for prefix ' + prefix);
  return row.next_seq;
}

// คืนรหัสเต็ม เช่น nextId(env,'ST',3) → 'ST007'
export async function nextId(env: Env, prefix: string, pad = 3): Promise<string> {
  const seq = await nextSeq(env, prefix);
  return prefix + String(seq).padStart(pad, '0');
}

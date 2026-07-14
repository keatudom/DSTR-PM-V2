// ============================================================
// activity.ts — เขียน Activity Log (port appendActivityLog_ + autoLog_)
//   ต้นทาง: Code.js:2643 (appendActivityLog_) / Code.js:2698 (autoLog_)
//
// ★ พฤติกรรมเดิมเป๊ะ:
//   - log_id = 'LOG' + pad4 (nextLogId_ Code.js:2626 → ตอนนี้ผ่าน id_counters prefix 'LOG')
//   - แท็บ 17_Activity_Logs เดิมมี 12 คอลัมน์ "ไม่มี project_id" (ensureActivitySheet_ Code.js:2610)
//     → เราเก็บ project_id = null ตามเดิม (ตาราง D1 มีคอลัมน์นี้ แต่คงว่างให้ตรงพฤติกรรมเก่า
//        _filterByProject_ เดิมจึงเห็น log เหล่านี้เฉพาะตอน pid='bow-house' = แถวว่าง)
//   - date default = วันที่ UTC (now.toISOString().slice(0,10)) — ไม่ใช่โซนไทย (ตามโค้ดเดิม)
//   - actor auto-stamp ลง meta จาก token (แทน _getCurrentActor_ global) — ส่งผ่าน opts.actor
//   - autoLog_ กลืน error เงียบ (ไม่ทำให้ action แม่พัง)
// ============================================================
import type { Env } from './env.ts';
import type { TokenPayload } from './auth.ts';
import { nextId } from './ids.ts';

export interface ActivityOpts {
  type?: string;
  source?: string;
  text?: string;
  tags_ff?: string | string[];
  tags_ctr?: string | string[];
  tags_issue?: string | string[];
  tags_phase?: string;
  date?: string;
  timestamp?: string;
  photo_url?: string;
  meta?: Record<string, unknown> | string;
  actor?: TokenPayload | null;
  project_id?: string | null;
}

function joinTags(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v.join(',');
  return v || '';
}

// ── appendActivityLog_ (Code.js:2643) ──
export async function appendActivityLog(env: Env, opts: ActivityOpts): Promise<{
  log_id: string;
  date: string;
  timestamp: string;
  type: string;
  text: string | undefined;
}> {
  const now = new Date();
  const date = opts.date || now.toISOString().slice(0, 10);
  const timestamp = opts.timestamp || now.toISOString();
  const logId = await nextId(env, 'LOG', 4);

  // Phase H: ติดป้าย "ใครทำ" อัตโนมัติจาก token (แทน _getCurrentActor_)
  let meta: Record<string, unknown> =
    typeof opts.meta === 'object' && opts.meta ? (opts.meta as Record<string, unknown>) : {};
  const actor = opts.actor;
  if (actor && !meta.actor) {
    meta.actor = actor.name || '';
    meta.actor_id = actor.sid || '';
    meta.actor_role = actor.role || '';
  }

  const type = opts.type || 'manual';
  const source = opts.source || 'admin';
  const metaJson =
    typeof opts.meta === 'string' ? opts.meta || '{}' : JSON.stringify(meta);

  await env.DB.prepare(
    `INSERT INTO activity_logs
       (log_id, project_id, date, timestamp, type, source, text,
        tags_ff, tags_ctr, tags_issue, tags_phase, photo_url, meta_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      logId,
      opts.project_id ?? null, // เดิมแท็บไม่มีคอลัมน์นี้ → คงว่าง
      date,
      timestamp,
      type,
      source,
      opts.text || '',
      joinTags(opts.tags_ff),
      joinTags(opts.tags_ctr),
      joinTags(opts.tags_issue),
      opts.tags_phase || '',
      opts.photo_url || '',
      metaJson,
    )
    .run();

  return { log_id: logId, date, timestamp, type, text: opts.text };
}

// ── autoLog_ (Code.js:2698) — best-effort, กลืน error เงียบ ──
export async function autoLog(
  env: Env,
  text: string,
  opts?: Omit<ActivityOpts, 'text' | 'type' | 'source'> & { type?: string; source?: string },
): Promise<unknown> {
  try {
    return await appendActivityLog(env, {
      type: 'auto',
      source: 'system',
      text,
      tags_ff: opts?.tags_ff,
      tags_ctr: opts?.tags_ctr,
      tags_issue: opts?.tags_issue,
      tags_phase: opts?.tags_phase,
      date: opts?.date,
      meta: opts?.meta,
      actor: opts?.actor,
      project_id: opts?.project_id,
    });
  } catch {
    return null;
  }
}

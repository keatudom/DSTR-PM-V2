// ============================================================
// modules/notifications.ts — port จาก apps-script/notifications.gs
// action: get_notifications (กระดิ่งแจ้งเตือน — event ล่าสุด scope project + actor)
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, pidOf, projectScope } from '../lib/db.ts';

// get_notifications (notifications.gs:19)
export async function getNotifications(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const scope = projectScope(pidOf(p));
  let rows: Record<string, unknown>[];
  try { rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM activity_logs WHERE ${scope.sql}`, ...scope.binds); }
  catch { return { events: [] }; }
  const limit = Number(p.limit || 40);
  const out: Record<string, unknown>[] = [];
  // ใหม่สุดก่อน (เดินจากท้าย)
  for (let i = rows.length - 1; i >= 0 && out.length < limit; i--) {
    const r = rows[i];
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(String(r.meta_json || '{}')) || {}; } catch { /* ignore */ }
    out.push({
      log_id: r.log_id,
      timestamp: String(r.timestamp || ''),
      type: String(r.type || ''),
      source: String(r.source || ''),
      actor: meta.actor || '',
      actor_role: meta.actor_role || '',
      kind: meta.kind || '',
      text: String(r.text || ''),
    });
  }
  return { events: out };
}

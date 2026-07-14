// ============================================================
// line.ts — LINE Messaging API push (port _linePush_/_lineNotify*_ จาก line.gs)
//   ★ ต่างจากเดิม: ใช้ fetch + ctx.waitUntil (ไม่ block request path — BLUEPRINT §4)
//   fail-safe: ไม่มี token/target → เงียบ (ไม่ทำให้ action แม่พัง)
// ============================================================
import type { Env } from './env.ts';

export interface CtxLike { waitUntil(p: Promise<unknown>): void; }

// ยิง push จริง (async) — คืน Promise<boolean>
async function pushNow(env: Env, to: string, text: string): Promise<boolean> {
  const token = env.LINE_TOKEN || '';
  if (!token || !to) return false;
  try {
    const res = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
    });
    return res.status === 200;
  } catch { return false; }
}

// schedule push แบบไม่ block (ผ่าน waitUntil ถ้ามี ctx, ไม่งั้น fire-and-forget)
export function linePush(env: Env, to: string, text: string, ctx?: CtxLike): void {
  const token = env.LINE_TOKEN || '';
  if (!token || !to) return;
  const promise = pushNow(env, to, text);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(promise);
  else void promise.catch(() => {});
}

// 🔔 เรื่องสำคัญ → กลุ่มทีม (LINE_GROUP_ID)
export function lineNotifyImportant(env: Env, text: string, ctx?: CtxLike): void {
  const gid = env.LINE_GROUP_ID || '';
  if (gid) linePush(env, gid, '🔔 ' + text, ctx);
}

// 💼 เงิน/สัญญา → เจ้าของ (LINE_OWNER_UID)
export function lineNotifyOwner(env: Env, text: string, ctx?: CtxLike): void {
  const uid = env.LINE_OWNER_UID || '';
  if (uid) linePush(env, uid, '💼 ' + text, ctx);
}

export function ctxOf(p: Record<string, unknown>): CtxLike | undefined {
  return (p.__ctx as CtxLike | undefined) ?? undefined;
}

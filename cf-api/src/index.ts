// ============================================================
// index.ts — entry ของ Worker dstr-api (Hono shell)
// รับ ?action=xxx (GET query / POST JSON) → authorize → route → ห่อ {ok,data} → CORS
// ★ contract-preserving: พารามิเตอร์ชื่อเดิม + response โครงเดิม (BLUEPRINT §1)
// Hono ใช้เป็นเปลือก HTTP (routing /api, /media/*, /line/webhook + method); การ dispatch
// ตาม ?action= ยังเป็น switch ใน router.ts (endpoint เดียวแบบเดิม)
// ============================================================
import { Hono } from 'hono';
import type { Env } from './lib/env.ts';
import { route } from './router.ts';
import { authorize } from './lib/authz.ts';
import { corsHeaders, jsonResponse, wrapResult } from './lib/resp.ts';
import { lineWebhook, lineDailyDigest, lineWeeklyDigest, lineOpsDigest } from './modules/line_webhook.ts';

const app = new Hono<{ Bindings: Env }>();

// preflight CORS (ทุก path)
app.options('*', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin') ?? null, c.env) }));

// GET /media/<key> — เสิร์ฟไฟล์จาก R2 (ไฟล์ใหม่ · ลิงก์ Drive เก่าอยู่ที่ url เดิม)
//   ⛔ R2 (MEDIA) ยังปิดใน wrangler.toml (Session 3) → คืน 501 จนกว่าจะเปิด
app.get('/media/*', async (c) => {
  if (!c.env.MEDIA) return c.text('R2 (MEDIA) not enabled yet', 501);
  const key = c.req.path.replace(/^\/media\//, '');
  const obj = await c.env.MEDIA.get(key);
  if (!obj) return c.text('not found', 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000');
  return new Response(obj.body, { headers });
});

// POST /line/webhook — LINE ส่ง {destination, events[]} · ตอบ 200 'OK' เร็ว (งานจริงใน waitUntil)
app.post('/line/webhook', async (c) => {
  let body: Record<string, unknown> = {};
  try { body = (await c.req.json()) as Record<string, unknown>; } catch { /* */ }
  const ctx = c.executionCtx;
  ctx.waitUntil(lineWebhook(c.env, body, ctx).catch(() => {}));
  return c.text('OK');
});

// action dispatch — path ใดก็ได้ (/, /api) ตาม ?action=
app.all('*', async (c) => {
  const req = c.req.raw;
  const env = c.env;
  const origin = c.req.header('Origin') ?? null;

  // รวมพารามิเตอร์: query string + JSON body
  const params: Record<string, unknown> = {};
  const url = new URL(req.url);
  for (const [k, v] of url.searchParams) params[k] = v;
  if (req.method === 'POST') {
    const ctype = (req.headers.get('Content-Type') || '').toLowerCase();
    if (ctype.includes('application/json') || ctype.includes('text/plain')) {
      try {
        const body = (await req.json()) as Record<string, unknown>;
        if (body && typeof body === 'object') Object.assign(params, body);
      } catch {
        // body ว่าง/พัง → ใช้ query อย่างเดียว
      }
    }
    // multipart/form-data (อัปโหลดรูป) — Session 3
  }

  const action = String(params.action || 'ping');

  let result: unknown;
  try {
    const auth = await authorize(env, action, params);
    // ร้อย actor (จาก token) ให้ handler อ่านผ่าน params.__actor — แทน global _setCurrentActor_ เดิม
    // ใช้ตอน autoLog เพื่อติดป้าย "ใครทำ" (Code.js:2655)
    params.__actor = auth.actor;
    // ร้อย executionCtx ให้ handler ยิง LINE/Gemini แบบ waitUntil (ไม่ให้ผู้ใช้รอ — BLUEPRINT §4)
    params.__ctx = c.executionCtx;
    const data = await route(env, action, params);
    result = wrapResult(action, data);
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  return jsonResponse(result, origin, env);
});

// ── Cron Triggers (LINE digests) — เวลาจาก line.gs (ops ทุก 3 ชม · daily 18:30 · weekly อา. 19:00 ไทย)
//    ต้องตั้ง crons ใน wrangler.toml + LINE_TOKEN/GROUP secrets (Session 3 gate)
async function scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  const cron = event.cron;
  const forward = { __ctx: ctx } as Record<string, unknown>;
  try {
    if (cron === '0 */3 * * *') await lineOpsDigest(env, forward);        // ทุก 3 ชม → กลุ่มหน้างาน
    else if (cron === '30 11 * * *') await lineDailyDigest(env, forward);  // 18:30 ไทย → กลุ่มหลัก
    else if (cron === '0 12 * * 0') await lineWeeklyDigest(env, forward);  // อา. 19:00 ไทย → กลุ่มหลัก
  } catch { /* best-effort */ }
}

export default { fetch: app.fetch, scheduled };

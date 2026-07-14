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

const app = new Hono<{ Bindings: Env }>();

// preflight CORS (ทุก path)
app.options('*', (c) => new Response(null, { status: 204, headers: corsHeaders(c.req.header('Origin') ?? null, c.env) }));

// /media/<key> (Session 3) + /line/webhook (Session 2) — ยังไม่รองรับในรอบนี้
app.all('/media/*', (c) =>
  jsonResponse({ ok: false, error: 'not implemented in Session 1' }, c.req.header('Origin') ?? null, c.env, 501),
);
app.post('/line/webhook', (c) =>
  jsonResponse({ ok: false, error: 'not implemented in Session 1' }, c.req.header('Origin') ?? null, c.env, 501),
);

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

export default app;

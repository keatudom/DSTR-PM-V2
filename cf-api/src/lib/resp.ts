// ============================================================
// resp.ts — CORS + wrapper rules ({ok,data} + ข้อยกเว้น raw)
// อ้างอิง BLUEPRINT §1 ข้อ 2 + Code.js:143-155
// ============================================================
import type { Env } from './env.ts';

// actions ที่ "ไม่" ห่อใน {ok,data} — คืน object ดิบ (backward compat กับหน้าเว็บเดิม)
//  - legacy: getAll / updateTask / updatePayment (หน้าเว็บอ่าน data.ffs ตรงๆ)
//  - upload passthrough: หน้าเว็บอ่าน res.photo_url / res.url ตรงๆ
export const RAW_ACTIONS = new Set<string>([
  'getAll',
  'updateTask',
  'updatePayment',
  'upload_log_photo',
  'upload_payment_slip',
  'upload_contract_file',
]);

// ห่อผลลัพธ์ตามกติกา wrapper
export function wrapResult(action: string, data: unknown): unknown {
  if (RAW_ACTIONS.has(action)) return data; // ดิบ
  return { ok: true, data };
}

// ── CORS ──
// อนุญาตเฉพาะ origin ใน allowlist (GitHub Pages + localhost) — ดีกว่าเดิมที่ JSONP เปิดหมด
export function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allow = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && allow.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

export function jsonResponse(
  body: unknown,
  origin: string | null,
  env: Env,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(origin, env),
    },
  });
}

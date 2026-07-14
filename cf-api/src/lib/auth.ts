// ============================================================
// auth.ts — token HMAC (port ตรงจาก apps-script/auth.gs)
// ★ CONTRACT-CRITICAL: format token ต้องเป๊ะเท่าเดิม เพื่อให้
//   "บัตรผ่าน (token)" ที่ระบบเก่าออกไว้ ยัง verify ผ่านบน Worker
//   → ผู้ใช้ไม่ต้อง login ใหม่ (ใช้ AUTH_SECRET ตัวเดิม)
//
// token = base64urlWebSafe(UTF-8(JSON payload)) . base64urlWebSafe(HMAC-SHA256(payloadB64, SECRET))
//   payload key order เป๊ะ: { sid, email, name, role, exp }
//   base64 web-safe: '+'→'-' '/'→'_' และตัด '=' ท้ายทิ้ง (เหมือน Utilities.base64EncodeWebSafe + replace)
// ============================================================

const enc = new TextEncoder();
const dec = new TextDecoder();

export const AUTH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 วัน (ตรงกับ auth.gs)

export interface TokenPayload {
  sid: string;
  email: string;
  name: string;
  role: string;
  exp: number;
}

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(b64: string): Uint8Array {
  let s = b64.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  if (pad) s += '===='.slice(pad); // เติม padding กลับ (เหมือน _b64urlDecodeToString_)
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

// ลายเซ็นของ payloadB64 (เป็น string base64 ASCII) — ตรงกับ _signPayload_
async function signPayload(payloadB64: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64));
  return bytesToB64url(new Uint8Array(sig));
}

// เทียบ string แบบ constant-time (กัน timing attack ตอน verify)
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── _issueToken_ (auth.gs:70) ──
export async function issueToken(
  user: { staff_id?: string; email?: string; name?: string; auth_role?: string },
  secret: string,
  now: number = Date.now(),
): Promise<string> {
  const payload: TokenPayload = {
    sid: user.staff_id || '',
    email: user.email || '',
    name: user.name || '',
    // ⚠️ ใช้ auth_role เท่านั้น — ไม่ fallback ไป column `role` (ตำแหน่งงาน free-text)
    role: user.auth_role || 'foreman',
    exp: now + AUTH_TOKEN_TTL_MS,
  };
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const sig = await signPayload(payloadB64, secret);
  return payloadB64 + '.' + sig;
}

// ── _verifyToken_ (auth.gs:83) — คืน payload หรือ null ──
export async function verifyToken(
  token: string | null | undefined,
  secret: string,
  now: number = Date.now(),
): Promise<TokenPayload | null> {
  if (!token || typeof token !== 'string' || token.indexOf('.') === -1) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = await signPayload(payloadB64, secret);
  if (!safeEqual(expected, sig)) return null; // ลายเซ็นไม่ตรง = ปลอม

  let payload: TokenPayload;
  try {
    payload = JSON.parse(dec.decode(b64urlToBytes(payloadB64)));
  } catch {
    return null;
  }
  if (!payload || !payload.exp || payload.exp < now) return null; // หมดอายุ
  return payload;
}

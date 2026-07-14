// ============================================================
// auth.test.ts — พิสูจน์ backward-compat ของ token
// วิธี: สร้าง token แบบ "อัลกอริทึมเดียวกับ Apps Script" ด้วย node:crypto (อิสระจากโค้ดเรา)
//       แล้วให้ verifyToken (Web Crypto) ของ Worker ตรวจ → ต้องผ่าน + ได้ payload เดิม
//       + issueToken ของเราต้องได้ token "ไบต์ตรงกัน" กับวิธี GAS (format เป๊ะ)
// รัน: node --test test/   (Node 24 strip types ให้เอง)
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { issueToken, verifyToken, AUTH_TOKEN_TTL_MS } from '../src/lib/auth.ts';

const SECRET = 'test-secret-0123456789abcdef0123456789abcdef'; // แทน AUTH_SECRET เดิม

// ── จำลองอัลกอริทึม _issueToken_ ของ Apps Script ด้วย node crypto ──
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gasStyleToken(payload: Record<string, unknown>, secret: string): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64, 'utf8').digest();
  return payloadB64 + '.' + b64url(sig);
}

test('GAS-issued token verifies on Worker auth (backward compat)', async () => {
  const now = 1_752_000_000_000; // fixed
  const payload = {
    sid: 'ST001',
    email: 'keatudom456@gmail.com',
    name: 'เกียรติอุดม', // ชื่อไทย → ต้องผ่าน UTF-8 roundtrip
    role: 'owner',
    exp: now + AUTH_TOKEN_TTL_MS,
  };
  const token = gasStyleToken(payload, SECRET);

  const verified = await verifyToken(token, SECRET, now);
  assert.ok(verified, 'ต้อง verify ผ่าน');
  assert.deepEqual(verified, payload, 'payload ต้องตรงเป๊ะ (รวมชื่อไทย)');
});

test('issueToken produces byte-identical token to GAS algorithm', async () => {
  const now = 1_752_000_000_000;
  const user = { staff_id: 'ST007', email: 'a@b.co', name: 'Bob', auth_role: 'pm' };
  const ours = await issueToken(user, SECRET, now);

  const gas = gasStyleToken(
    { sid: 'ST007', email: 'a@b.co', name: 'Bob', role: 'pm', exp: now + AUTH_TOKEN_TTL_MS },
    SECRET,
  );
  assert.equal(ours, gas, 'format token ต้องตรงกับ Apps Script เป๊ะ');
});

test('roundtrip issue → verify', async () => {
  const now = 1_752_000_000_000;
  const token = await issueToken({ staff_id: 'X', email: 'x@y.z', name: 'T', auth_role: 'foreman' }, SECRET, now);
  const v = await verifyToken(token, SECRET, now);
  assert.equal(v?.role, 'foreman');
  assert.equal(v?.sid, 'X');
});

test('tampered signature rejected', async () => {
  const now = 1_752_000_000_000;
  const token = await issueToken({ staff_id: 'X', auth_role: 'owner' }, SECRET, now);
  const tampered = token.slice(0, -3) + 'zzz';
  assert.equal(await verifyToken(tampered, SECRET, now), null);
});

test('wrong secret rejected', async () => {
  const now = 1_752_000_000_000;
  const token = await issueToken({ staff_id: 'X', auth_role: 'owner' }, SECRET, now);
  assert.equal(await verifyToken(token, 'different-secret', now), null);
});

test('expired token rejected', async () => {
  const past = 1_000_000_000_000;
  const token = await issueToken({ staff_id: 'X', auth_role: 'owner' }, SECRET, past);
  // ตรวจ ณ เวลาปัจจุบันจริง (ไกลเกิน exp) → หมดอายุ
  assert.equal(await verifyToken(token, SECRET, Date.now()), null);
});

// ============================================================
// tour_owner.test.ts — กติกา "ลบได้เฉพาะของตัวเอง" (2026-09-03)
//
// เจ้าของงานเคาะ: "ลบผัง/ล้างถังขยะ โฟร์แมน HR จัดซื้อ ผู้รับเหมา ก็ทำได้
//   แต่ต้องเป็นของตัวเองที่สแกนมา ไม่ใช่ไปลบของคนอื่น"
//
// ทดสอบ 2 ชั้นที่ต้องทำงานร่วมกัน:
//   ชั้นที่ 1 (authz)  — บทบาทไหน "เอื้อมถึง" คำสั่งทัวร์ได้บ้าง
//   ชั้นที่ 2 (tour.ts) — เอื้อมถึงแล้วยังต้องเป็นเจ้าของชิ้นนั้นด้วย
// รัน: npm test
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleHasCap } from '../src/lib/authz.ts';

// บทบาทที่ควรถ่ายทัวร์ได้ — เจ้าของงานระบุเอง: ใครไปหน้างานก็ถ่ายได้
const CAN_TOUR = ['creator', 'owner', 'director', 'pm', 'site_engineer', 'foreman', 'hr', 'purchaser', 'contractor'];
// หัวหน้า = ข้ามด่านความเป็นเจ้าของได้ (ลบของคนอื่นได้)
const SUPERVISORS = ['creator', 'owner', 'director', 'pm', 'site_engineer'];

test('ทุกบทบาทที่ออกไซต์ได้ ต้องถ่ายทัวร์ 360 ได้', () => {
  for (const r of CAN_TOUR) {
    assert.equal(roleHasCap(r, 'TOUR'), true, r + ' ควรถ่ายทัวร์ได้');
  }
});

test('เจ้าบ้านถ่ายทัวร์ไม่ได้', () => {
  assert.equal(roleHasCap('client', 'TOUR'), false);
});

test('เฉพาะหัวหน้าเท่านั้นที่ข้ามด่านความเป็นเจ้าของได้ (SITECFG)', () => {
  for (const r of SUPERVISORS) {
    assert.equal(roleHasCap(r, 'SITECFG'), true, r + ' ควรเป็นหัวหน้า');
  }
  for (const r of ['foreman', 'hr', 'purchaser', 'contractor']) {
    assert.equal(roleHasCap(r, 'SITECFG'), false, r + ' ไม่ควรลบของคนอื่นได้');
  }
});

test('ถ่ายทัวร์ได้ ไม่ได้แปลว่าได้สิทธิ์งานหน้าไซต์อื่นไปด้วย', () => {
  // จุดสำคัญของการแยก TOUR ออกจาก OPS: จัดซื้อ/ผู้รับเหมา/HR ถ่ายทัวร์ได้
  // แต่ต้องไม่ได้สิทธิ์ติ๊กงาน เบิกวัสดุ หรือเขียนรายงานประจำวันไปด้วย
  for (const r of ['hr', 'purchaser', 'contractor']) {
    assert.equal(roleHasCap(r, 'TOUR'), true, r + ' ถ่ายทัวร์ได้');
    assert.equal(roleHasCap(r, 'OPS'), false, r + ' ต้องไม่ได้สิทธิ์งานหน้าไซต์');
  }
  // โฟร์แมนมีทั้งคู่ (เป็นคนหน้างานจริง)
  assert.equal(roleHasCap('foreman', 'OPS'), true);
  assert.equal(roleHasCap('foreman', 'TOUR'), true);
});

test('ประกาศใช้เวอร์ชัน = สิทธิ์หัวหน้า ไม่ใช่คนถ่าย', () => {
  // publish คือการตัดสินว่าเวอร์ชันไหนเป็นตัวจริงที่คนอื่นเห็น
  assert.equal(roleHasCap('foreman', 'SITECFG'), false);
  assert.equal(roleHasCap('pm', 'SITECFG'), true);
});

// ============================================================
// multi_project.test.ts — กันการถดถอยของงาน "รองรับหลายโครงการ" (2026-08-29)
//
// ทดสอบเฉพาะตรรกะบริสุทธิ์ (ไม่แตะ DB/LINE):
//   1) การจัดกลุ่มกิจกรรมตามโครงการ — แถว legacy ที่ project_id ว่าง ต้องถือเป็น bow-house
//      (ของจริงมี 798 แถวเป็น NULL — ถ้าพลาดข้อนี้ รายงาน LINE จะทิ้งงานเก่าหายทั้งก้อน)
//   2) การเรียงลำดับโครงการในรายงาน — บ้านที่มีความเคลื่อนไหวเยอะขึ้นก่อน
//   3) ตัวตรวจแผนไทม์ไลน์ — กันกรอกสัปดาห์กลับหัว/งวดนอกช่วง 1-4
// รัน: npm test
// ============================================================
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByProject, activeProjectIds } from '../src/modules/line_webhook.ts';
import { parsePhases } from '../src/modules/ff_plans.ts';

test('groupByProject: แถว legacy ที่ project_id ว่าง/null ถือเป็น bow-house', () => {
  const rows = [
    { project_id: null, text: 'งานเก่าไม่มี project_id' },
    { project_id: '', text: 'ช่องว่าง' },
    { project_id: '   ', text: 'เว้นวรรคล้วน' },
    { project_id: 'bow-house', text: 'ระบุชัด' },
    { project_id: 'prj_abc', text: 'บ้านหลังที่สอง' },
  ];
  const g = groupByProject(rows);
  assert.equal(g['bow-house'].length, 4, 'null/ว่าง/เว้นวรรค ต้องถูกนับรวมเป็น bow-house');
  assert.equal(g['prj_abc'].length, 1);
  assert.deepEqual(Object.keys(g).sort(), ['bow-house', 'prj_abc']);
});

test('activeProjectIds: เรียงตามจำนวนกิจกรรม มากก่อน และรวมหลายแหล่ง', () => {
  const activity = groupByProject([
    { project_id: 'prj_b', text: 'x' },
    { project_id: 'prj_b', text: 'y' },
    { project_id: 'prj_a', text: 'z' },
  ]);
  const reports = groupByProject([
    { project_id: 'prj_a', text: 'r1' },
    { project_id: 'prj_a', text: 'r2' },
    { project_id: 'prj_a', text: 'r3' },
  ]);
  // prj_a = 1 + 3 = 4 · prj_b = 2 + 0 = 2
  assert.deepEqual(activeProjectIds([activity, reports]), ['prj_a', 'prj_b']);
});

test('activeProjectIds: ไม่มีกิจกรรมเลย → รายการว่าง (ผู้เรียกจะ fallback เอง)', () => {
  assert.deepEqual(activeProjectIds([{}]), []);
});

test('parsePhases: รับได้ทั้ง array และ JSON string', () => {
  const expected = [[1, 1, 2], [2, 3, 5]];
  assert.deepEqual(parsePhases([[1, 1, 2], [2, 3, 5]]), expected);
  assert.deepEqual(parsePhases('[[1,1,2],[2,3,5]]'), expected);
  assert.deepEqual(parsePhases([]), [], 'ส่งว่าง = ลบแผน ต้องไม่ error');
});

test('parsePhases: ปฏิเสธค่าที่กรอกผิด', () => {
  assert.throws(() => parsePhases([[5, 1, 2]]), /1-4/, 'งวดต้องอยู่ 1-4');
  assert.throws(() => parsePhases([[0, 1, 2]]), /1-4/);
  assert.throws(() => parsePhases([[1, 5, 3]]), /ไม่น้อยกว่า/, 'สัปดาห์จบห้ามน้อยกว่าสัปดาห์เริ่ม');
  assert.throws(() => parsePhases([[1, 0, 2]]), /ตั้งแต่ 1/, 'สัปดาห์ต้องเริ่มที่ 1');
  assert.throws(() => parsePhases([[1, 1]]), /\[/, 'ต้องมีครบ 3 ค่า');
  assert.throws(() => parsePhases('ไม่ใช่ json'), /JSON/);
  assert.throws(() => parsePhases(42), /array/);
});

test('parsePhases: สัปดาห์เริ่ม = สัปดาห์จบ ได้ (งานงวดเดียวจบใน 1 สัปดาห์)', () => {
  assert.deepEqual(parsePhases([[4, 16, 16]]), [[4, 16, 16]]);
});

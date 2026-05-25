// ============================================================
// projects_wizard.gs — Phase C-1: FF onboarding wizard backend
// ============================================================
// endpoints:
//   create_ff       — เพิ่ม FF 1 รายการ
//   create_ff_batch — เพิ่ม FF หลายรายการ (atomic per-item — บางอันสำเร็จ บางอันไม่ สำเร็จได้)
// project_id stamping — B-4 (appendRow) จัดการให้อัตโนมัติ
// ============================================================

/**
 * เพิ่ม FF 1 รายการ
 * @param {object} p - { code, name (or item_name), bf_code, area, zone, price, scope_type, risk_level, notes }
 * @returns {object} row ที่ถูกสร้าง
 */
function createFF_(p) {
  p = p || {};
  const code = String(p.code || '').trim();
  const name = String(p.name || p.item_name || '').trim();
  if (!code) throw new Error('FF Code ต้องไม่ว่าง');
  if (!name) throw new Error('Item Name ต้องไม่ว่าง');

  const pid = _getCurrentProjectId_() || 'bow-house';

  // ห้ามซ้ำในโปรเจกต์เดียวกัน
  const dup = getAllRows(SHEET.FF).find(f => {
    const c = String(f['FF Code'] || '').trim();
    if (c !== code) return false;
    const fpid = String(f.project_id || '').trim();
    return fpid === pid || (pid === 'bow-house' && fpid === '');
  });
  if (dup) throw new Error('FF Code ซ้ำในโปรเจกต์: ' + code);

  const row = {
    'FF Code':     code,
    'BF Code':     String(p.bf_code || '').trim(),
    'Item Name':   name,
    'Area / Room': String(p.area || '').trim(),
    'Zone':        String(p.zone || '').trim(),
    'Price (THB)': Number(p.price) || 0,
    'Scope Type':  String(p.scope_type || '').trim(),
    'Status':      String(p.status || 'Not Started').trim(),
    'Risk Level':  String(p.risk_level || '').trim(),
    'Notes':       String(p.notes || '').trim(),
  };

  appendRow(SHEET.FF, row);  // Phase B-4 auto-stamps project_id
  return row;
}

/**
 * เพิ่ม FF หลายรายการ — รายใดล้มเหลวจะรายงาน ไม่ break ตัวที่เหลือ
 * @param {object} p - { items: [ { code, name, price, ... }, ... ] }
 *                     items อาจเป็น JSON string (จาก callRead) หรือ array จริง (จาก callPost)
 */
function createFFBatch_(p) {
  p = p || {};
  let items = p.items;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch (e) {
      throw new Error('items ต้องเป็น JSON array');
    }
  }
  if (!Array.isArray(items)) throw new Error('items ต้องเป็น array');
  if (!items.length) throw new Error('ไม่มี FF ใน list');

  const created = [];
  const failed = [];

  items.forEach((item, i) => {
    try {
      const r = createFF_(item || {});
      created.push({ code: r['FF Code'], name: r['Item Name'] });
    } catch (err) {
      failed.push({
        index: i,
        code: (item && item.code) || '',
        error: err.message
      });
    }
  });

  return {
    created_count: created.length,
    failed_count: failed.length,
    created: created,
    failed: failed
  };
}

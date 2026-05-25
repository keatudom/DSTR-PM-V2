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
 * สร้าง task 1 รายการ — ใช้ภายใน batch
 * @param {object} p - { ff_code (req), zone, phase (1-4), name (req) }
 */
function createTask_(p) {
  p = p || {};
  const ffCode = String(p.ff_code || '').trim();
  const name = String(p.name || p.task_name || '').trim();
  if (!ffCode) throw new Error('Task: FF Code ต้องไม่ว่าง');
  if (!name) throw new Error('Task: ชื่อ task ต้องไม่ว่าง');

  const phaseNum = parseInt(p.phase, 10);
  const phaseStr = (phaseNum >= 1 && phaseNum <= 4) ? ('งวด ' + phaseNum) : '';

  const id = generateId('T', SHEET.TASKS, 'Task ID');
  const row = {
    'Task ID':    id,
    'FF Code':    ffCode,
    'Zone':       String(p.zone || '').trim(),
    'Phase':      phaseStr,
    'Task Name':  name,
    'Status':     'Not Started',
    'Start Date': '',
    'End Date':   '',
    'Done Date':  '',
    'Person In Charge': '',
    'Notes':      '',
  };
  appendRow(SHEET.TASKS, row);  // Phase B-4 auto-stamps project_id
  return row;
}

/**
 * เพิ่ม FF หลายรายการ + tasks (optional ต่อ FF) — รายใดล้มเหลวจะรายงาน ไม่ break ตัวที่เหลือ
 * @param {object} p - { items: [ { code, name, price, zone, tasks: [{ name, phase }] }, ... ] }
 *                     items อาจเป็น JSON string (จาก callRead) หรือ array จริง (จาก callPost)
 *                     tasks ต่อ item เป็น optional
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
  let tasksCreated = 0;
  const taskErrors = [];

  items.forEach((item, i) => {
    item = item || {};
    try {
      const ff = createFF_(item);
      const ffCode = ff['FF Code'];
      const zone = ff['Zone'];

      // สร้าง tasks ของ FF นี้ (ถ้ามี) — error ใน task ไม่ rollback FF
      let taskCountThisFF = 0;
      if (Array.isArray(item.tasks)) {
        item.tasks.forEach(t => {
          if (!t || !t.name) return;
          try {
            createTask_({
              ff_code: ffCode,
              zone: zone,
              phase: t.phase,
              name: t.name
            });
            taskCountThisFF++;
            tasksCreated++;
          } catch (te) {
            taskErrors.push({ ff_code: ffCode, task: t.name, error: te.message });
          }
        });
      }

      created.push({
        code: ffCode,
        name: ff['Item Name'],
        tasks: taskCountThisFF
      });
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
    tasks_created: tasksCreated,
    created: created,
    failed: failed,
    task_errors: taskErrors
  };
}

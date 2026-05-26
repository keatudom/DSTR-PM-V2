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

// ============================================================
// Phase D-1: Edit/Delete FF
// ============================================================

/**
 * helper: หา row index (1-based, รวม header) ใน sheet ที่ตรง FF Code + project scope
 * @returns {number} row index หรือ -1 ถ้าไม่พบ
 */
function _findFFRowIndex_(sh, code, pid) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const codeCol = headers.indexOf('FF Code');
  const pidCol = headers.indexOf('project_id');
  if (codeCol === -1) return -1;
  const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  for (let i = 0; i < data.length; i++) {
    const c = String(data[i][codeCol] || '').trim();
    if (c !== code) continue;
    if (pidCol !== -1) {
      const rpid = String(data[i][pidCol] || '').trim();
      if (rpid !== pid && !(pid === 'bow-house' && rpid === '')) continue;
    }
    return i + 2;  // 1-based + skip header
  }
  return -1;
}

/**
 * แก้ไข FF — ค้นหาด้วย FF Code + project_id (scope)
 * ไม่อนุญาต rename code (cascade ซับซ้อน — ดอง phase ต่อไป)
 * @param {object} p - { code (req), name?, zone?, price?, bf_code?, area?, scope_type?, status?, risk_level?, notes? }
 */
function updateFF_(p) {
  p = p || {};
  const code = String(p.code || '').trim();
  if (!code) throw new Error('FF Code ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  const ss = SpreadsheetApp.openById(SHEETS_ID);
  const sh = ss.getSheetByName(SHEET.FF);
  if (!sh) throw new Error('Sheet not found: ' + SHEET.FF);

  const rowIdx = _findFFRowIndex_(sh, code, pid);
  if (rowIdx === -1) throw new Error('ไม่พบ FF ในโปรเจกต์: ' + code);

  // map ฟิลด์ที่อนุญาตแก้
  const fieldMap = {
    name: 'Item Name',
    item_name: 'Item Name',
    zone: 'Zone',
    price: 'Price (THB)',
    bf_code: 'BF Code',
    area: 'Area / Room',
    scope_type: 'Scope Type',
    status: 'Status',
    risk_level: 'Risk Level',
    notes: 'Notes'
  };
  const updates = {};
  Object.keys(fieldMap).forEach(k => {
    if (p[k] === undefined || p[k] === null) return;
    let val = p[k];
    if (k === 'price') val = parseFloat(val) || 0;
    else val = String(val).trim();
    updates[fieldMap[k]] = val;
  });
  if (Object.keys(updates).length === 0) {
    throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');
  }

  // เขียนกลับ — ใช้ existing helper updateRowByCol
  updateRowByCol(SHEET.FF, 'FF Code', code, updates);

  return { code: code, updated_fields: Object.keys(updates) };
}

/**
 * ลบ FF + ลบ tasks ที่ผูกกับ FF นั้น (cascade) — scope ตาม project_id
 * @param {object} p - { code (req) }
 */
function deleteFF_(p) {
  p = p || {};
  const code = String(p.code || '').trim();
  if (!code) throw new Error('FF Code ต้องระบุ');

  const pid = _getCurrentProjectId_() || 'bow-house';
  const ss = SpreadsheetApp.openById(SHEETS_ID);

  // ลบ tasks ก่อน (cascade) — เดินจากล่างขึ้นบนกัน index ขยับ
  let tasksDeleted = 0;
  const shTasks = ss.getSheetByName(SHEET.TASKS);
  if (shTasks) {
    const lastRow = shTasks.getLastRow();
    if (lastRow >= 2) {
      const headers = shTasks.getRange(1, 1, 1, shTasks.getLastColumn()).getValues()[0];
      const codeCol = headers.indexOf('FF Code');
      const pidCol = headers.indexOf('project_id');
      if (codeCol !== -1) {
        const data = shTasks.getRange(2, 1, lastRow - 1, shTasks.getLastColumn()).getValues();
        for (let i = data.length - 1; i >= 0; i--) {
          const c = String(data[i][codeCol] || '').trim();
          if (c !== code) continue;
          if (pidCol !== -1) {
            const rpid = String(data[i][pidCol] || '').trim();
            if (rpid !== pid && !(pid === 'bow-house' && rpid === '')) continue;
          }
          shTasks.deleteRow(i + 2);
          tasksDeleted++;
        }
      }
    }
  }

  // ลบ FF row
  const shFF = ss.getSheetByName(SHEET.FF);
  if (!shFF) throw new Error('Sheet not found: ' + SHEET.FF);
  const ffRowIdx = _findFFRowIndex_(shFF, code, pid);
  if (ffRowIdx === -1) throw new Error('ไม่พบ FF ที่จะลบ: ' + code);
  shFF.deleteRow(ffRowIdx);

  return { code: code, ff_deleted: 1, tasks_deleted: tasksDeleted };
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

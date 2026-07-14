// ============================================================
// modules/ff_tasks.ts — port จาก Code.js + projects_wizard.gs
// actions: get_ff_list, get_tasks, updateTask‼raw, updatePayment‼raw,
//   create_payment, update_payment_info, create_ff, create_ff_batch,
//   update_ff, delete_ff, clone_project
//   (getAll‼raw = aggregate — เติมตอนท้าย Session 2 หลังโมดูล risks/materials/teams)
//
// ★ contract-preserving: getFFList/getTasks คืน "camelCase" เดิมเป๊ะ (ffCode, bfCode,
//   scopeType, riskLevel, phaseRaw, personInCharge ฯลฯ) · create_ff/update_ff/update_payment_info
//   คืน object/updated ที่ใช้ "ชื่อ header เดิม" (contract เดิม) — ห้ามแก้
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, fmtDate } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr } from '../lib/time.ts';
import { autoLog } from '../lib/activity.ts';

function actorOf(p: Record<string, unknown>): TokenPayload | null {
  return (p.__actor as TokenPayload | null) ?? null;
}

// ── get_ff_list (Code.js:632 getFFList) ──
export async function getFFList(env: Env, projectId: string): Promise<Record<string, unknown>[]> {
  const scope = projectScope(projectId);
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM ff_items WHERE ${scope.sql}`, ...scope.binds);
  return rows.map((r) => ({
    code: r.code || '',
    bfCode: r.bf_code || '',
    name: r.name || '',
    area: r.area || '',
    zone: r.zone || '',
    price: Number(r.price || 0),
    scopeType: r.scope_type || '',
    status: r.status || '',
    riskLevel: r.risk_level || '',
    notes: r.notes || '',
  }));
}

// ── get_tasks (Code.js:648 getTasksAsObjects) ──
export async function getTasksAsObjects(env: Env, ffCode: unknown, projectId: string): Promise<Record<string, unknown>[]> {
  // photoCount: อ่าน task_photos ครั้งเดียว (กัน N+1)
  const photoCountMap: Record<string, number> = {};
  try {
    const pc = await queryAll<{ task_id: string; c: number }>(env, 'SELECT task_id, COUNT(*) c FROM task_photos GROUP BY task_id');
    for (const r of pc) {
      const tid = String(r.task_id || '');
      if (tid) photoCountMap[tid] = Number(r.c) || 0;
    }
  } catch { /* sheet หาย → count 0 */ }

  const scope = projectScope(projectId);
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM tasks WHERE ${scope.sql}`, ...scope.binds);
  const mapped = rows.map((r) => {
    const phase = String(r.phase || '');
    let phaseKey = '';
    if (phase.indexOf('1') >= 0) phaseKey = 'p1';
    else if (phase.indexOf('2') >= 0) phaseKey = 'p2';
    else if (phase.indexOf('3') >= 0) phaseKey = 'p3';
    else if (phase.indexOf('4') >= 0) phaseKey = 'p4';
    return {
      id: r.id || '',
      ffCode: r.ff_code || '',
      zone: r.zone || '',
      phase: phaseKey,
      phaseRaw: phase,
      name: r.name || '',
      status: r.status || '',
      startDate: fmtDate(r.start_date),
      endDate: fmtDate(r.end_date),
      doneDate: fmtDate(r.done_date),
      personInCharge: r.person_in_charge || '',
      notes: r.notes || '',
      photoCount: photoCountMap[String(r.id || '')] || 0,
      weight: Number(r.weight || 1) || 1,
    };
  });
  return ffCode ? mapped.filter((t) => t.ffCode === ffCode) : mapped;
}

// ── payments (Code.js:693 getPaymentsAsObjects) ──
export async function getPaymentsAsObjects(env: Env, projectId: string): Promise<Record<string, unknown>[]> {
  const scope = projectScope(projectId);
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM payments WHERE ${scope.sql}`, ...scope.binds);
  return rows
    .filter((r) => {
      const id = String(r.payment_id || '').trim();
      const milestone = String(r.milestone || '').trim().toUpperCase();
      if (!id) return false;
      if (milestone === 'GRAND TOTAL' || milestone === 'PAID' || milestone === 'REMAINING' || milestone === 'TOTAL') return false;
      return true;
    })
    .map((r) => {
      const rawMilestone = String(r.milestone || '');
      let milestone = rawMilestone;
      const match = rawMilestone.match(/^งวด\s*[1234]/);
      if (match) milestone = match[0].replace(/\s+/g, ' ').trim();
      return {
        id: r.payment_id || '',
        milestone,
        milestoneRaw: rawMilestone,
        sub: r.sub_item || '',
        zone: r.zone || '',
        pct: r.pct_of_total || '',
        amount: Number(r.amount || 0),
        dueDate: fmtDate(r.due_date),
        status: r.status || '',
        paidDate: fmtDate(r.paid_date),
        receipt: r.receipt_no || '',
        notes: r.notes || '',
      };
    });
}

// ── action wrappers ──
export function getFfListAction(env: Env, p: Record<string, unknown>): Promise<unknown> {
  return getFFList(env, pidOf(p));
}
export function getTasksAction(env: Env, p: Record<string, unknown>): Promise<unknown> {
  return getTasksAsObjects(env, p.ff_code, pidOf(p));
}

// ── updateTask (Code.js:859) ‼raw ──
export async function updateTask(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const sets: string[] = ['status = ?'];
  const vals: unknown[] = [p.status];
  if (p.status === 'Done') {
    sets.push('done_date = ?');
    vals.push((p.doneDate as string) || todayStr());
  } else if (p.status === 'Not Started') {
    sets.push('done_date = ?');
    vals.push('');
  }
  const exists = await queryFirst(env, 'SELECT id FROM tasks WHERE id = ?', p.taskId);
  if (!exists) throw new Error('Row not found: Task ID=' + p.taskId);
  await exec(env, `UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, ...vals, p.taskId);

  try {
    const taskRow = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM tasks WHERE id = ?', p.taskId);
    if (taskRow) await hookTaskDone(env, taskRow, String(p.status), actorOf(p));
  } catch { /* autolog best-effort */ }

  return { ok: true, taskId: p.taskId, status: p.status };
}

// hookTaskDone_ (Code.js:3354) — autolog เมื่อ task done/undo
async function hookTaskDone(env: Env, taskRow: Record<string, unknown>, newStatus: string, actor: TokenPayload | null): Promise<void> {
  try {
    if (newStatus === 'Done') {
      const taskName = taskRow.name || '';
      const ffCode = (taskRow.ff_code as string) || '';
      const phase = (taskRow.phase as string) || '';
      await autoLog(env, '✓ เสร็จ: ' + taskName + (ffCode ? ' (' + ffCode + ')' : ''), {
        tags_ff: ffCode ? [ffCode] : [], tags_phase: phase,
        meta: { task_id: taskRow.id, event: 'task_done' }, actor,
      });
    } else if (newStatus === 'Not Started') {
      const taskName = taskRow.name || '';
      const ffCode = (taskRow.ff_code as string) || '';
      await autoLog(env, '↩️ ยกเลิกเสร็จ: ' + taskName + (ffCode ? ' (' + ffCode + ')' : ''), {
        tags_ff: ffCode ? [ffCode] : [],
        meta: { task_id: taskRow.id, event: 'task_undo' }, actor,
      });
    }
  } catch { /* ignore */ }
}

// ── updatePayment (Code.js:880) ‼raw ──
export async function updatePayment(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const sets: string[] = ['status = ?'];
  const vals: unknown[] = [p.status];
  if (p.status === 'Paid') { sets.push('paid_date = ?'); vals.push(todayStr()); }
  else if (p.status === 'Pending') { sets.push('paid_date = ?'); vals.push(''); }
  if (p.receipt !== undefined && p.receipt !== '') { sets.push('receipt_no = ?'); vals.push(p.receipt); }
  const exists = await queryFirst(env, 'SELECT payment_id FROM payments WHERE payment_id = ?', p.paymentId);
  if (!exists) throw new Error('Row not found: Payment ID=' + p.paymentId);
  await exec(env, `UPDATE payments SET ${sets.join(', ')} WHERE payment_id = ?`, ...vals, p.paymentId);
  return { ok: true, paymentId: p.paymentId, status: p.status };
}

// ── create_payment (Code.js:739) ──
export async function createPayment(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.milestone) throw new Error('milestone required');
  if (p.amount === undefined) throw new Error('amount required');
  const pid = pidOf(p);
  const id = String(p.payment_id || '').trim() || (await nextId(env, 'PAY-', 3));
  const dup = await queryFirst(env, 'SELECT payment_id FROM payments WHERE payment_id = ?', id);
  if (dup) throw new Error('Payment ID ซ้ำ: ' + id);
  const pct = p.pct !== undefined && p.pct !== '' ? Number(p.pct) : null;
  const amount = Number(p.amount || 0);
  await exec(
    env,
    `INSERT INTO payments (payment_id, project_id, milestone, sub_item, zone, pct_of_total, amount, due_date, status, paid_date, receipt_no, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pid, String(p.milestone), p.sub || '', p.zone || '', pct, amount,
    p.due_date || '', p.status || 'Pending', p.paid_date || '', p.receipt || '', p.notes || '',
  );
  await autoLog(env, '🧾 เพิ่มงวดเบิก: ' + String(p.milestone) + ' (' + amount.toLocaleString() + ' บาท)',
    { meta: { kind: 'payment', payment_id: id }, actor: actorOf(p) });
  return { ok: true, payment_id: id };
}

// ── update_payment_info (Code.js:771) — response 'updated' = ชื่อ header เดิม ──
export async function updatePaymentInfo(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.payment_id) throw new Error('payment_id required');
  const defs: { param: string; header: string; col: string; num?: boolean }[] = [
    { param: 'sub', header: 'Sub-Item', col: 'sub_item' },
    { param: 'milestone', header: 'Milestone', col: 'milestone' },
    { param: 'zone', header: 'Zone', col: 'zone' },
    { param: 'notes', header: 'Notes', col: 'notes' },
    { param: 'amount', header: 'Amount (THB)', col: 'amount', num: true },
    { param: 'pct', header: '% of Total', col: 'pct_of_total', num: true },
  ];
  const updatedHeaders: string[] = [];
  const setCols: string[] = [];
  const vals: unknown[] = [];
  for (const d of defs) {
    if (p[d.param] === undefined) continue;
    updatedHeaders.push(d.header);
    setCols.push(`${d.col} = ?`);
    vals.push(d.num ? Number(p[d.param]) : p[d.param]);
  }
  if (!setCols.length) throw new Error('ไม่มี field ให้แก้');
  const exists = await queryFirst(env, 'SELECT payment_id FROM payments WHERE payment_id = ?', p.payment_id);
  if (!exists) throw new Error('Row not found: Payment ID=' + p.payment_id);
  await exec(env, `UPDATE payments SET ${setCols.join(', ')} WHERE payment_id = ?`, ...vals, p.payment_id);
  return { ok: true, payment_id: p.payment_id, updated: updatedHeaders };
}

// ── FF wizard (projects_wizard.gs) ──
// createFF core — pid ส่งเข้ามาชัด (batch เรียกด้วย pid ของ request) · คืน object key=header เดิม
async function createFFRow(env: Env, pid: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = String(p.code || '').trim();
  const name = String(p.name || p.item_name || '').trim();
  if (!code) throw new Error('FF Code ต้องไม่ว่าง');
  if (!name) throw new Error('Item Name ต้องไม่ว่าง');

  const scope = projectScope(pid);
  const dup = await queryFirst(env, `SELECT code FROM ff_items WHERE code = ? AND ${scope.sql}`, code, ...scope.binds);
  if (dup) throw new Error('FF Code ซ้ำในโปรเจกต์: ' + code);

  const row: Record<string, unknown> = {
    'FF Code': code,
    'BF Code': String(p.bf_code || '').trim(),
    'Item Name': name,
    'Area / Room': String(p.area || '').trim(),
    'Zone': String(p.zone || '').trim(),
    'Price (THB)': Number(p.price) || 0,
    'Scope Type': String(p.scope_type || '').trim(),
    'Status': String(p.status || 'Not Started').trim(),
    'Risk Level': String(p.risk_level || '').trim(),
    'Notes': String(p.notes || '').trim(),
  };
  await exec(
    env,
    `INSERT INTO ff_items (project_id, code, bf_code, name, area, zone, price, scope_type, status, risk_level, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    pid, code, row['BF Code'], name, row['Area / Room'], row['Zone'], row['Price (THB)'],
    row['Scope Type'], row['Status'], row['Risk Level'], row['Notes'],
  );
  return row;
}
export function createFF(env: Env, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  return createFFRow(env, pidOf(p), p);
}

// createTask core (projects_wizard.gs:178) — คืน object key=header เดิม
async function createTaskRow(env: Env, pid: string, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ffCode = String(p.ff_code || '').trim();
  const name = String(p.name || p.task_name || '').trim();
  if (!ffCode) throw new Error('Task: FF Code ต้องไม่ว่าง');
  if (!name) throw new Error('Task: ชื่อ task ต้องไม่ว่าง');
  const phaseNum = parseInt(String(p.phase), 10);
  const phaseStr = phaseNum >= 1 && phaseNum <= 4 ? 'งวด ' + phaseNum : '';
  const id = await nextId(env, 'T', 3);
  const weight = Number(p.weight) || 1;
  const row: Record<string, unknown> = {
    'Task ID': id, 'FF Code': ffCode, 'Zone': String(p.zone || '').trim(), 'Phase': phaseStr,
    'Task Name': name, 'Status': 'Not Started', 'Start Date': '', 'End Date': '', 'Done Date': '',
    'Person In Charge': '', 'Notes': '', 'Weight': weight,
  };
  await exec(
    env,
    `INSERT INTO tasks (id, project_id, ff_code, zone, phase, name, status, start_date, end_date, done_date, person_in_charge, notes, weight)
     VALUES (?, ?, ?, ?, ?, ?, 'Not Started', '', '', '', '', '', ?)`,
    id, pid, ffCode, row['Zone'], phaseStr, name, weight,
  );
  return row;
}

// create_ff_batch (projects_wizard.gs:216)
export async function createFFBatch(env: Env, p: Record<string, unknown>): Promise<unknown> {
  let items = p.items as unknown;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch { throw new Error('items ต้องเป็น JSON array'); }
  }
  if (!Array.isArray(items)) throw new Error('items ต้องเป็น array');
  if (!items.length) throw new Error('ไม่มี FF ใน list');
  const pid = pidOf(p);

  const created: { code: unknown; name: unknown; tasks: number }[] = [];
  const failed: { index: number; code: unknown; error: string }[] = [];
  let tasksCreated = 0;
  const taskErrors: { ff_code: unknown; task: unknown; error: string }[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = (items[i] || {}) as Record<string, unknown>;
    try {
      const ff = await createFFRow(env, pid, item);
      const ffCode = ff['FF Code'];
      const zone = ff['Zone'];
      let taskCountThisFF = 0;
      if (Array.isArray(item.tasks)) {
        for (const t of item.tasks as Record<string, unknown>[]) {
          if (!t || !t.name) continue;
          try {
            await createTaskRow(env, pid, { ff_code: ffCode, zone, phase: t.phase, name: t.name, weight: t.weight });
            taskCountThisFF++;
            tasksCreated++;
          } catch (te) {
            taskErrors.push({ ff_code: ffCode, task: t.name, error: te instanceof Error ? te.message : String(te) });
          }
        }
      }
      created.push({ code: ffCode, name: ff['Item Name'], tasks: taskCountThisFF });
    } catch (err) {
      failed.push({ index: i, code: item.code || '', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return {
    created_count: created.length, failed_count: failed.length, tasks_created: tasksCreated,
    created, failed, task_errors: taskErrors,
  };
}

// update_ff (projects_wizard.gs:83) — response updated_fields = ชื่อ header เดิม
export async function updateFF(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const code = String(p.code || '').trim();
  if (!code) throw new Error('FF Code ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const existing = await queryFirst(env, `SELECT code FROM ff_items WHERE code = ? AND ${scope.sql}`, code, ...scope.binds);
  if (!existing) throw new Error('ไม่พบ FF ในโปรเจกต์: ' + code);

  // fieldMap เดิม (order สำคัญ) — header → d1 col
  const fieldMap: { param: string; header: string; col: string; price?: boolean }[] = [
    { param: 'name', header: 'Item Name', col: 'name' },
    { param: 'item_name', header: 'Item Name', col: 'name' },
    { param: 'zone', header: 'Zone', col: 'zone' },
    { param: 'price', header: 'Price (THB)', col: 'price', price: true },
    { param: 'bf_code', header: 'BF Code', col: 'bf_code' },
    { param: 'area', header: 'Area / Room', col: 'area' },
    { param: 'scope_type', header: 'Scope Type', col: 'scope_type' },
    { param: 'status', header: 'Status', col: 'status' },
    { param: 'risk_level', header: 'Risk Level', col: 'risk_level' },
    { param: 'notes', header: 'Notes', col: 'notes' },
  ];
  // updates keyed by header (ให้ name/item_name ยุบเป็น 'Item Name' เดียว เหมือน Object.keys เดิม)
  const byHeader: Record<string, { col: string; val: unknown }> = {};
  const orderHeaders: string[] = [];
  for (const f of fieldMap) {
    if (p[f.param] === undefined || p[f.param] === null) continue;
    let val: unknown = p[f.param];
    val = f.price ? parseFloat(String(val)) || 0 : String(val).trim();
    if (!(f.header in byHeader)) orderHeaders.push(f.header);
    byHeader[f.header] = { col: f.col, val };
  }
  if (!orderHeaders.length) throw new Error('ไม่มี field ใหม่ที่จะอัปเดต');

  const setCols = orderHeaders.map((h) => `${byHeader[h].col} = ?`);
  const vals = orderHeaders.map((h) => byHeader[h].val);
  await exec(env, `UPDATE ff_items SET ${setCols.join(', ')} WHERE code = ? AND ${scope.sql}`, ...vals, code, ...scope.binds);
  return { code, updated_fields: orderHeaders };
}

// delete_ff (projects_wizard.gs:131) — cascade tasks ก่อน แล้วลบ FF
export async function deleteFF(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const code = String(p.code || '').trim();
  if (!code) throw new Error('FF Code ต้องระบุ');
  const pid = pidOf(p);
  const scope = projectScope(pid);

  const delTasks = await exec(env, `DELETE FROM tasks WHERE ff_code = ? AND ${scope.sql}`, code, ...scope.binds);
  const tasksDeleted = delTasks.meta?.changes ?? 0;

  const ff = await queryFirst(env, `SELECT code FROM ff_items WHERE code = ? AND ${scope.sql}`, code, ...scope.binds);
  if (!ff) throw new Error('ไม่พบ FF ที่จะลบ: ' + code);
  await exec(env, `DELETE FROM ff_items WHERE code = ? AND ${scope.sql}`, code, ...scope.binds);
  return { code, ff_deleted: 1, tasks_deleted: tasksDeleted };
}

// clone_project (projects_wizard.gs:326)
export async function cloneProject(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const target = String(p.target_project_id || p.project_id || '').trim();
  const source = String(p.source_project_id || 'bow-house').trim();
  const includeTasks = !(p.include_tasks === false || p.include_tasks === 'false' || p.include_tasks === '0');
  if (!target) throw new Error('target_project_id ต้องระบุ');
  if (target === source) throw new Error('target และ source ต้องไม่ใช่อันเดียวกัน');

  const targetProject = await queryFirst(env, 'SELECT project_id FROM projects WHERE project_id = ?', target);
  if (!targetProject) throw new Error('ไม่พบโปรเจกต์ target: ' + target);

  const tScope = projectScope(target);
  const existingFF = await queryAll(env, `SELECT code FROM ff_items WHERE ${tScope.sql}`, ...tScope.binds);
  if (existingFF.length > 0) throw new Error('โปรเจกต์ปลายทางมี FF อยู่แล้ว ' + existingFF.length + ' รายการ — ยกเลิก clone');

  const sScope = projectScope(source);
  const sourceFFs = await queryAll<Record<string, unknown>>(env, `SELECT * FROM ff_items WHERE ${sScope.sql}`, ...sScope.binds);
  if (sourceFFs.length === 0) throw new Error('โปรเจกต์ต้นแบบไม่มี FF: ' + source);

  let ffCloned = 0;
  for (const ff of sourceFFs) {
    await exec(
      env,
      `INSERT INTO ff_items (project_id, code, bf_code, name, area, zone, price, scope_type, status, risk_level, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Not Started', ?, ?)`,
      target, ff.code, ff.bf_code, ff.name, ff.area, ff.zone, ff.price, ff.scope_type, ff.risk_level, ff.notes,
    );
    ffCloned++;
  }

  let tasksCloned = 0;
  if (includeTasks) {
    const sourceTasks = await queryAll<Record<string, unknown>>(env, `SELECT * FROM tasks WHERE ${sScope.sql}`, ...sScope.binds);
    for (const t of sourceTasks) {
      const id = await nextId(env, 'T', 3);
      // ต้นฉบับ clone "ไม่ copy weight" (row ใหม่เว้นว่าง → getTasks อ่านเป็น 1) → reset = NULL
      await exec(
        env,
        `INSERT INTO tasks (id, project_id, ff_code, zone, phase, name, status, start_date, end_date, done_date, person_in_charge, notes, weight)
         VALUES (?, ?, ?, ?, ?, ?, 'Not Started', '', '', '', '', ?, NULL)`,
        id, target, t.ff_code || '', t.zone || '', t.phase || '', t.name || '', t.notes || '',
      );
      tasksCloned++;
    }
  }
  return { source, target, ff_cloned: ffCloned, tasks_cloned: tasksCloned };
}

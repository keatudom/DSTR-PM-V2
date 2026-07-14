// ============================================================
// modules/materials.ts — port จาก Code.js (§MATERIALS/BOQ/INVENTORY/AI)
// 21 actions: get_suppliers, create_supplier, get_materials, get_material,
//   create_material, update_material, deactivate_material, delete_material,
//   get_transactions, receive_material, withdraw_material, count_material,
//   parse_material_log, confirm_material_log, check_stock_for_items,
//   get_boq, create_boq, check_boq_status, get_inventory_summary,
//   update_material_prices, get_ai_alerts
//
// ★ contract-preserving: raw read คืน key snake_case เดิม (materials/suppliers เก็บ snake อยู่แล้ว)
//   · active เก็บเป็น 'TRUE'/'FALSE' ตาม seed (Sheets boolean → seed แปลง) · create คืน object
//     ที่ appendRow เดิม stamp project_id ให้ → เรา stamp เองใน object ที่คืน
//   · boq: sheet header 'planned_quantity' → D1 col 'planned_qty' (seed override) → alias กลับ
//   · Gemini action (parse_material_log) ต้องมี GEMINI_API_KEY (secret) จึงทดสอบสด
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, toBool, blankNulls } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr, nowStr } from '../lib/time.ts';
import { autoLog } from '../lib/activity.ts';
import { callGemini } from '../lib/gemini.ts';

const SHEET_MAT = 'materials';
function actorOf(p: Record<string, unknown>): TokenPayload | null {
  return (p.__actor as TokenPayload | null) ?? null;
}
function activeTruthy(v: unknown): boolean {
  return v === true || v === 'TRUE' || v === 'true';
}

// ── SUPPLIERS ──
export async function getSuppliers(env: Env): Promise<unknown> {
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM suppliers');
  return rows.map(blankNulls);
}
export async function createSupplier(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = await nextId(env, 'S', 3);
  const row: Record<string, unknown> = {
    id, name: p.name, category: p.category || '', contact_person: p.contact_person || '',
    phone: p.phone || '', address: p.address || '', payment_terms: p.payment_terms || '',
    notes: p.notes || '', active: true, created_at: todayStr(),
  };
  await exec(
    env,
    `INSERT INTO suppliers (id, name, category, contact_person, phone, address, payment_terms, notes, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'TRUE', ?)`,
    id, row.name, row.category, row.contact_person, row.phone, row.address, row.payment_terms, row.notes, row.created_at,
  );
  return row; // suppliers ไม่มีคอลัมน์ project_id → ไม่ stamp
}

// ── update_material_prices (Code.js:963) ──
export async function updateMaterialPrices(env: Env, p: Record<string, unknown>): Promise<unknown> {
  let map = p.prices as unknown;
  if (typeof map === 'string') { try { map = JSON.parse(map); } catch { map = {}; } }
  const m = (map || {}) as Record<string, unknown>;
  let n = 0;
  for (const id of Object.keys(m)) {
    const v = Number(m[id]);
    if (isNaN(v) || v < 0) continue;
    try {
      const r = await exec(env, 'UPDATE materials SET default_price = ? WHERE id = ?', v, id);
      if ((r.meta?.changes ?? 0) > 0) n++;
    } catch { /* ข้าม */ }
  }
  return { updated: n };
}

// ── MATERIALS ──
export async function getMaterials(env: Env, mode?: unknown, category?: unknown, projectId?: string): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM materials';
  const binds: unknown[] = [];
  if (projectId) { const s = projectScope(projectId); sql += ' WHERE ' + s.sql; binds.push(...s.binds); }
  let rows = await queryAll<Record<string, unknown>>(env, sql, ...binds);
  rows = rows.filter((mm) => activeTruthy(mm.active));
  if (mode) rows = rows.filter((mm) => mm.tracking_mode === mode);
  if (category) rows = rows.filter((mm) => mm.category === category);
  return rows.map(blankNulls);
}
export function getMaterialsAction(env: Env, p: Record<string, unknown>): Promise<unknown> {
  return getMaterials(env, p.mode, p.category, pidOf(p));
}

async function matById(env: Env, id: unknown): Promise<Record<string, unknown> | null> {
  return queryFirst<Record<string, unknown>>(env, 'SELECT * FROM materials WHERE id = ?', id);
}

export async function getMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const found = await matById(env, p.mat_id);
  if (!found) throw new Error('Material not found: ' + p.mat_id);
  const obj = blankNulls(found);
  obj.transactions = await getTransactions(env, p.mat_id);
  return obj;
}

export async function createMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const id = await nextId(env, 'M', 3);
  const row: Record<string, unknown> = {
    id, name: p.name, unit: p.unit, category: p.category || '', spec: p.spec || '', size: p.size || '',
    default_price: Number(p.default_price || 0), default_supplier_id: p.default_supplier_id || '',
    linked_ffs: p.linked_ffs || '', min_stock_alert: Number(p.min_stock_alert || 0),
    current_stock: Number(p.current_stock || 0), notes: p.notes || '', active: true, created_at: todayStr(),
    tracking_mode: p.tracking_mode || 'COUNT', last_status_update: p.tracking_mode === 'STATUS' ? todayStr() : '',
  };
  await exec(
    env,
    `INSERT INTO materials (id, project_id, name, unit, category, spec, size, default_price, default_supplier_id,
       linked_ffs, min_stock_alert, current_stock, notes, active, created_at, tracking_mode, last_status_update)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TRUE', ?, ?, ?)`,
    id, pid, row.name, row.unit, row.category, row.spec, row.size, row.default_price, row.default_supplier_id,
    row.linked_ffs, row.min_stock_alert, row.current_stock, row.notes, row.created_at, row.tracking_mode, row.last_status_update,
  );
  row.project_id = pid; // stamp เหมือน appendRow เดิม
  return row;
}

export async function updateMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const cols = ['name', 'unit', 'category', 'spec', 'size', 'default_price', 'default_supplier_id',
    'linked_ffs', 'min_stock_alert', 'notes', 'tracking_mode', 'active'];
  const setCols: string[] = [];
  const vals: unknown[] = [];
  for (const k of cols) {
    if (p[k] === undefined) continue;
    let v: unknown = p[k];
    if (k === 'active') v = toBool(v) ? 'TRUE' : 'FALSE';
    setCols.push(`${k} = ?`);
    vals.push(v);
  }
  const exists = await matById(env, p.mat_id);
  if (!exists) throw new Error('Row not found: id=' + p.mat_id);
  if (setCols.length) await exec(env, `UPDATE materials SET ${setCols.join(', ')} WHERE id = ?`, ...vals, p.mat_id);
  return { mat_id: p.mat_id, updated: true };
}

export async function deactivateMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const mat = await matById(env, p.material_id);
  if (!mat) throw new Error('Material not found: ' + p.material_id);
  await exec(env, "UPDATE materials SET active = 'FALSE' WHERE id = ?", p.material_id);
  return { deactivated: p.material_id };
}

export async function deleteMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const found = await matById(env, p.material_id);
  if (!found) throw new Error('Material not found: ' + p.material_id);
  const txns = await queryAll(env, 'SELECT id FROM material_transactions WHERE material_id = ?', p.material_id);
  if (txns.length > 0) {
    throw new Error('ลบถาวรไม่ได้: วัสดุนี้มีธุรกรรมอ้างถึง ' + txns.length + ' รายการ กรุณาใช้ "ปิดใช้งาน" (deactivate_material) แทน');
  }
  await exec(env, 'DELETE FROM materials WHERE id = ?', p.material_id);
  return { deleted: p.material_id };
}

// ── TRANSACTIONS ──
export async function getTransactions(env: Env, matId?: unknown, type?: unknown, ffCode?: unknown, projectId?: string): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM material_transactions';
  const binds: unknown[] = [];
  if (projectId) { const s = projectScope(projectId); sql += ' WHERE ' + s.sql; binds.push(...s.binds); }
  let rows = await queryAll<Record<string, unknown>>(env, sql, ...binds);
  if (matId) rows = rows.filter((t) => t.material_id === matId);
  if (type) rows = rows.filter((t) => t.type === type);
  if (ffCode) rows = rows.filter((t) => t.ff_code === ffCode);
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return rows.map(blankNulls);
}
export function getTransactionsAction(env: Env, p: Record<string, unknown>): Promise<unknown> {
  return getTransactions(env, p.mat_id, p.type, p.ff_code, pidOf(p));
}

export async function receiveMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const matObj = await matById(env, p.material_id);
  if (!matObj) throw new Error('Material not found: ' + p.material_id);
  const qty = Number(p.quantity || 0);
  const isStatus = matObj.tracking_mode === 'STATUS';
  const unitPrice = Number(p.unit_price || 0);

  let newStock: number;
  if (isStatus) {
    const hasStatus = !(p.new_stock === '' || p.new_stock === undefined || p.new_stock === null);
    newStock = hasStatus ? Math.max(0, Math.min(3, Number(p.new_stock))) : 3;
  } else {
    newStock = Number(matObj.current_stock || 0) + qty;
  }

  const id = await nextId(env, 'MT', 3);
  const txn: Record<string, unknown> = {
    id, date: p.date || todayStr(), type: 'รับ', material_id: p.material_id, quantity: qty,
    unit_price: unitPrice, total_value: qty * unitPrice, supplier_id: p.supplier_id || '', contractor_id: '',
    ff_code: p.ff_code || '', report_id: p.report_id || '', remaining_after: newStock, receipt_no: p.receipt_no || '',
    notes: p.notes || '', created_by: p.created_by || 'ST02', created_at: nowStr(),
  };
  await insertTxn(env, txn, pid);

  const setCols = ['current_stock = ?'];
  const vals: unknown[] = [newStock];
  if (isStatus) { setCols.push('last_status_update = ?'); vals.push(todayStr()); }
  if (unitPrice > 0) { setCols.push('default_price = ?'); vals.push(unitPrice); }
  if (p.supplier_id) { setCols.push('default_supplier_id = ?'); vals.push(p.supplier_id); }
  await exec(env, `UPDATE materials SET ${setCols.join(', ')} WHERE id = ?`, ...vals, p.material_id);

  await hookReceive(env, p.material_id, qty, matObj.unit, matObj.name, p.receipt_no, actorOf(p));
  txn.project_id = pid;
  return { transaction: txn, new_stock: newStock };
}

export async function withdrawMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const matObj = await matById(env, p.material_id);
  if (!matObj) throw new Error('Material not found: ' + p.material_id);
  const qty = Number(p.quantity || 0);
  const isStatus = matObj.tracking_mode === 'STATUS';
  const currentStock = Number(matObj.current_stock || 0);

  let newStock = currentStock;
  if (!isStatus) {
    if (qty > currentStock && !p.force) throw new Error('เบิกเกินสต๊อก! เหลือ ' + currentStock + ' ' + matObj.unit);
    newStock = currentStock - qty;
  }

  let isOverBoq = false;
  let boqInfo: unknown = null;
  if (!isStatus && p.ff_code) {
    boqInfo = await checkBoqForWithdrawal(env, p.material_id, p.ff_code, qty);
    isOverBoq = (boqInfo as { is_over: boolean }).is_over;
  }

  const id = await nextId(env, 'MT', 3);
  const txn: Record<string, unknown> = {
    id, date: p.date || todayStr(), type: 'เบิก', material_id: p.material_id, quantity: qty,
    unit_price: matObj.default_price || 0, total_value: qty * Number(matObj.default_price || 0),
    supplier_id: '', contractor_id: p.contractor_id || '', ff_code: p.ff_code || '', report_id: p.report_id || '',
    remaining_after: newStock, receipt_no: '', notes: (p.notes || '') + (isOverBoq ? ' [⚠️ เกิน BOQ]' : ''),
    created_by: p.created_by || 'ST02', created_at: nowStr(),
  };
  await insertTxn(env, txn, pid);

  if (!isStatus) await exec(env, 'UPDATE materials SET current_stock = ? WHERE id = ?', newStock, p.material_id);

  let ctrName = '';
  if (p.contractor_id) {
    try {
      const c = await queryFirst<{ name: string }>(env, 'SELECT name FROM contractors WHERE id = ?', p.contractor_id);
      if (c) ctrName = c.name;
      if (!ctrName) {
        const t = await queryFirst<{ name: string }>(env, 'SELECT name FROM teams WHERE team_id = ?', p.contractor_id);
        if (t) ctrName = t.name;
      }
    } catch { /* ignore */ }
  }
  await hookWithdraw(env, p.material_id, qty, matObj.unit, matObj.name, p.contractor_id, ctrName, p.ff_code, actorOf(p));
  txn.project_id = pid;
  return { transaction: txn, new_stock: newStock, is_over_boq: isOverBoq, boq_info: boqInfo, requires_status_update: isStatus };
}

export async function countMaterial(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const matObj = await matById(env, p.material_id);
  if (!matObj) throw new Error('Material not found: ' + p.material_id);
  const isStatus = matObj.tracking_mode === 'STATUS';
  const oldStock = Number(matObj.current_stock || 0);
  const newStock = Number(p.new_stock || 0);
  const variance = newStock - oldStock;

  const id = await nextId(env, 'MT', 3);
  const txn: Record<string, unknown> = {
    id, date: p.date || todayStr(), type: 'นับ', material_id: p.material_id, quantity: variance,
    unit_price: matObj.default_price || 0, total_value: 0, supplier_id: '', contractor_id: '', ff_code: '',
    report_id: '', remaining_after: newStock, receipt_no: '',
    notes: (p.notes || '') + ' [trigger: ' + (p.trigger_source || 'manual') + ']',
    created_by: p.created_by || 'ST02', created_at: nowStr(),
  };
  await insertTxn(env, txn, pid);

  const setCols = ['current_stock = ?'];
  const vals: unknown[] = [newStock];
  if (isStatus) { setCols.push('last_status_update = ?'); vals.push(todayStr()); }
  await exec(env, `UPDATE materials SET ${setCols.join(', ')} WHERE id = ?`, ...vals, p.material_id);

  await hookCount(env, p.material_id, newStock, matObj.name, matObj.unit, matObj.tracking_mode, actorOf(p));
  txn.project_id = pid;
  return { transaction: txn, old_stock: oldStock, new_stock: newStock, variance };
}

async function insertTxn(env: Env, txn: Record<string, unknown>, pid: string): Promise<void> {
  await exec(
    env,
    `INSERT INTO material_transactions (id, project_id, date, type, material_id, quantity, unit_price, total_value,
       supplier_id, contractor_id, ff_code, report_id, remaining_after, receipt_no, notes, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    txn.id, pid, txn.date, txn.type, txn.material_id, txn.quantity, txn.unit_price, txn.total_value,
    txn.supplier_id, txn.contractor_id, txn.ff_code, txn.report_id, txn.remaining_after, txn.receipt_no,
    txn.notes, txn.created_by, txn.created_at,
  );
}

// hooks → autoLog (Code.js:3379/3392/3407)
async function hookReceive(env: Env, matId: unknown, qty: unknown, unit: unknown, matName: unknown, invoice: unknown, actor: TokenPayload | null): Promise<void> {
  try {
    let text = '📥 รับ ' + (matName || matId) + ' จำนวน ' + qty + ' ' + (unit || '');
    if (invoice) text += ' (บิล ' + invoice + ')';
    await autoLog(env, text, { meta: { mat_id: matId, qty, event: 'receive' }, actor });
  } catch { /* ignore */ }
}
async function hookWithdraw(env: Env, matId: unknown, qty: unknown, unit: unknown, matName: unknown, ctrId: unknown, ctrName: unknown, ffCode: unknown, actor: TokenPayload | null): Promise<void> {
  try {
    let text = '📤 ' + (ctrName || ctrId || 'ไม่ระบุ') + ' เบิก ' + (matName || matId) + ' จำนวน ' + qty + ' ' + (unit || '');
    if (ffCode) text += ' → ' + ffCode;
    await autoLog(env, text, { tags_ff: ffCode ? [String(ffCode)] : [], tags_ctr: ctrId ? [String(ctrId)] : [], meta: { mat_id: matId, qty, event: 'withdraw' }, actor });
  } catch { /* ignore */ }
}
async function hookCount(env: Env, matId: unknown, newStock: unknown, matName: unknown, unit: unknown, mode: unknown, actor: TokenPayload | null): Promise<void> {
  try {
    let text: string;
    if (mode === 'STATUS') {
      const lbls = ['🔴 หมด', '🟡 ใกล้หมด', '🔵 ใช้ได้', '🟢 เต็ม'];
      text = '📝 นับ ' + (matName || matId) + ' = ' + (lbls[Number(newStock)] || newStock);
    } else {
      text = '📝 นับ ' + (matName || matId) + ' = ' + newStock + ' ' + (unit || '');
    }
    await autoLog(env, text, { meta: { mat_id: matId, new_stock: newStock, event: 'count' }, actor });
  } catch { /* ignore */ }
}

// ── BOQ ──
function mapBoq(r: Record<string, unknown>): Record<string, unknown> {
  // sheet header 'planned_quantity' → D1 'planned_qty' (seed override) → alias กลับให้ key เดิม
  const o = blankNulls(r);
  o.planned_quantity = r.planned_qty == null ? '' : r.planned_qty;
  delete o.planned_qty;
  return o;
}
export async function getBOQ(env: Env, ffCode?: unknown, projectId?: string): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM boq_items';
  const binds: unknown[] = [];
  if (projectId) { const s = projectScope(projectId); sql += ' WHERE ' + s.sql; binds.push(...s.binds); }
  let rows = await queryAll<Record<string, unknown>>(env, sql, ...binds);
  const mapped = rows.map(mapBoq);
  return ffCode ? mapped.filter((b) => b.ff_code === ffCode) : mapped;
}
export function getBoqAction(env: Env, p: Record<string, unknown>): Promise<unknown> {
  return getBOQ(env, p.ff_code, pidOf(p));
}
export async function createBOQ(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const id = await nextId(env, 'BOQ', 3);
  const plannedQty = Number(p.planned_quantity || 0);
  const plannedUnitPrice = Number(p.planned_unit_price || 0);
  const row: Record<string, unknown> = {
    id, ff_code: p.ff_code, material_id: p.material_id, planned_quantity: plannedQty, unit: p.unit || '',
    planned_unit_price: plannedUnitPrice, planned_total: plannedQty * plannedUnitPrice, notes: p.notes || '',
    created_by: p.created_by || 'ST03', created_at: todayStr(),
  };
  // D1 boq_items ไม่มี planned_unit_price/planned_total/created_by (seed drop) → เก็บเฉพาะที่มีคอลัมน์
  await exec(
    env,
    `INSERT INTO boq_items (id, project_id, ff_code, material_id, planned_qty, unit, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pid, row.ff_code, row.material_id, plannedQty, row.unit, row.notes, row.created_at,
  );
  row.project_id = pid;
  return row;
}
async function checkBoqForWithdrawal(env: Env, matId: unknown, ffCode: unknown, withdrawQty: unknown): Promise<Record<string, unknown>> {
  const boq = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM boq_items WHERE material_id = ? AND ff_code = ?', matId, ffCode);
  if (!boq) return { has_boq: false, is_over: false };
  const withdrawnRows = await queryAll<{ quantity: number }>(env, "SELECT quantity FROM material_transactions WHERE type = 'เบิก' AND material_id = ? AND ff_code = ?", matId, ffCode);
  const withdrawn = withdrawnRows.reduce((s, t) => s + Number(t.quantity || 0), 0);
  const totalAfter = withdrawn + Number(withdrawQty);
  const planned = Number(boq.planned_qty || 0);
  return { has_boq: true, is_over: totalAfter > planned, planned, withdrawn, total_after: totalAfter, overage: Math.max(0, totalAfter - planned) };
}
export async function checkBoqStatus(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const boqs = await getBOQ(env, p.ff_code); // ไม่ scope project (ตรงต้นฉบับ checkBoqStatus → getBOQ(ff_code))
  const out: unknown[] = [];
  for (const boq of boqs) {
    const withdrawnRows = await queryAll<{ quantity: number }>(env, "SELECT quantity FROM material_transactions WHERE type = 'เบิก' AND material_id = ? AND ff_code = ?", boq.material_id, p.ff_code);
    const withdrawn = withdrawnRows.reduce((s, t) => s + Number(t.quantity || 0), 0);
    const planned = Number(boq.planned_quantity || 0);
    out.push({
      boq_id: boq.id, material_id: boq.material_id, planned, withdrawn,
      remaining: planned - withdrawn, pct_used: planned > 0 ? Math.round((withdrawn / planned) * 100) : 0,
      is_over: withdrawn > planned,
    });
  }
  return out;
}

// ── check_stock_for_items (Code.js:3796) ──
export async function checkStockForItems(env: Env, p: Record<string, unknown>): Promise<unknown> {
  let items = p.items as unknown;
  if (typeof items === 'string') { try { items = JSON.parse(items); } catch { items = []; } }
  if (!Array.isArray(items)) items = [];
  const warnings: Record<string, unknown>[] = [];
  const list = items as Record<string, unknown>[];
  for (let idx = 0; idx < list.length; idx++) {
    const it = list[idx];
    if (it.type !== 'เบิก' || !it.material_id) continue;
    const matObj = await matById(env, it.material_id);
    if (!matObj) { warnings.push({ index: idx, level: 'error', material_name: it.material_name || it.material_id, message: 'ไม่พบวัสดุนี้ในระบบ' }); continue; }
    if (matObj.tracking_mode === 'STATUS') continue;
    const currentStock = Number(matObj.current_stock || 0);
    const qty = Number(it.quantity || 0);
    if (qty > currentStock) {
      warnings.push({ index: idx, level: 'error', material_name: matObj.name, message: 'เบิก ' + qty + ' ' + matObj.unit + ' แต่เหลือแค่ ' + currentStock + ' ' + matObj.unit, current_stock: currentStock, requested: qty });
    } else if (qty > currentStock * 0.8 && currentStock > 0) {
      warnings.push({ index: idx, level: 'warning', material_name: matObj.name, message: 'เบิกแล้วจะเหลือ ' + (currentStock - qty) + ' ' + matObj.unit + ' (น้อย)', current_stock: currentStock, requested: qty });
    }
    if (it.ff_code) {
      try {
        const boqCheck = await checkBoqForWithdrawal(env, it.material_id, it.ff_code, qty);
        if (boqCheck && boqCheck.is_over) warnings.push({ index: idx, level: 'warning', material_name: matObj.name, message: 'เบิกเกิน BOQ ที่วางแผนไว้สำหรับ ' + it.ff_code });
      } catch { /* ignore */ }
    }
  }
  return { warnings, all_ok: warnings.filter((w) => w.level === 'error').length === 0, has_warnings: warnings.length > 0 };
}

// ── get_inventory_summary (Code.js:983) ──
export async function getInventorySummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const projectId = String(p.project_id || '') || pidOf(p);
  const materials = (await getMaterials(env, undefined, undefined, projectId)); // active + scope
  const txnScope = projectScope(projectId);
  const txns = await queryAll<Record<string, unknown>>(env, `SELECT * FROM material_transactions WHERE ${txnScope.sql}`, ...txnScope.binds);

  const matById2: Record<string, Record<string, unknown>> = {};
  for (const m of materials) matById2[String(m.id)] = m;

  const cats: Record<string, { category: string; received: number; issued: number; balance: number }> = {};
  const ensure = (c: unknown) => {
    const k = c && String(c).trim() ? String(c).trim() : 'ไม่ระบุหมวด';
    if (!cats[k]) cats[k] = { category: k, received: 0, issued: 0, balance: 0 };
    return cats[k];
  };
  for (const m of materials) ensure(m.category).balance += Number(m.current_stock || 0) * Number(m.default_price || 0);
  for (const t of txns) {
    const m = matById2[String(t.material_id)];
    const cat = m ? m.category : 'ไม่ระบุหมวด';
    const val = Number(t.total_value || 0);
    if (t.type === 'รับ') ensure(cat).received += val;
    else if (t.type === 'เบิก') ensure(cat).issued += val;
  }
  const round2 = (n: number) => Math.round(Number(n || 0) * 100) / 100;
  const byCat = Object.keys(cats).map((k) => cats[k]).filter((c) => c.received || c.issued || c.balance).sort((a, b) => b.received - a.received);
  for (const c of byCat) { c.received = round2(c.received); c.issued = round2(c.issued); c.balance = round2(c.balance); }
  const totals = byCat.reduce((acc, c) => ({ received: acc.received + c.received, issued: acc.issued + c.issued, balance: acc.balance + c.balance }), { received: 0, issued: 0, balance: 0 });
  totals.received = round2(totals.received); totals.issued = round2(totals.issued); totals.balance = round2(totals.balance);
  const priced = materials.filter((m) => Number(m.default_price || 0) > 0).length;
  return { totals, by_category: byCat, meta: { materials: materials.length, priced, transactions: txns.length } };
}

// ── AI ALERTS (Code.js:1544) ──
export async function getAiAlerts(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const alerts: unknown[] = [];
  alerts.push(...await frequentWithdrawalAlerts(env, pid));
  alerts.push(...await staleStatusAlerts(env, pid));
  alerts.push(...await lowStockAlerts(env, pid));
  return alerts;
}
async function frequentWithdrawalAlerts(env: Env, pid: string): Promise<unknown[]> {
  const materials = await getMaterials(env, undefined, undefined, pid);
  const s = projectScope(pid);
  const txns = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM material_transactions WHERE ${s.sql}`, ...s.binds)).filter((t) => t.type === 'เบิก');
  const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const out: unknown[] = [];
  for (const m of materials) {
    const recent = txns.filter((t) => t.material_id === m.id && new Date(String(t.date)) >= sevenDaysAgo);
    if (recent.length >= 3 && m.tracking_mode === 'STATUS' && Number(m.current_stock) > 1) {
      out.push({ type: 'frequent_withdrawal', severity: 'medium', mat_id: m.id, mat_name: m.name, current_status: Number(m.current_stock), count: recent.length, message: m.name + ' ถูกเบิก ' + recent.length + ' ครั้งใน 7 วัน — ยังพอใช้ไหม?' });
    }
  }
  return out;
}
async function staleStatusAlerts(env: Env, pid: string): Promise<unknown[]> {
  const materials = await getMaterials(env, 'STATUS', undefined, pid);
  const today = new Date();
  const out: unknown[] = [];
  for (const m of materials) {
    if (!m.last_status_update) continue;
    const days = Math.floor((today.getTime() - new Date(String(m.last_status_update)).getTime()) / 86400000);
    if (days >= 14) out.push({ type: 'stale_status', severity: 'low', mat_id: m.id, mat_name: m.name, days_since_update: days, current_status: Number(m.current_stock), message: m.name + ' ไม่ได้อัปเดตสถานะ ' + days + ' วัน — เช็คหน่อย?' });
  }
  return out;
}
async function lowStockAlerts(env: Env, pid: string): Promise<unknown[]> {
  const materials = await getMaterials(env, 'COUNT', undefined, pid);
  const out: unknown[] = [];
  for (const m of materials) {
    const stock = Number(m.current_stock || 0);
    const minAlert = Number(m.min_stock_alert || 0);
    if (minAlert > 0 && stock <= minAlert) {
      out.push({ type: 'low_stock', severity: stock === 0 ? 'high' : 'medium', mat_id: m.id, mat_name: m.name, current_stock: stock, min_alert: minAlert, message: stock === 0 ? m.name + ' หมดสต๊อก!' : m.name + ' เหลือ ' + stock + ' ' + m.unit + ' (เตือนที่ ' + minAlert + ')' });
    }
  }
  return out;
}

// ── parse_material_log (Gemini) (Code.js:1319) ──
export async function parseMaterialLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const text = String(p.text || '');
  if (!text.trim()) throw new Error('ข้อความว่างเปล่า');

  const materials = await getMaterials(env); // all active
  const contractors = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')).filter((c) => activeTruthy(c.active) && (c.role === 'CONTRACTOR' || c.role === 'FOREMAN'));
  const ffs = await queryAll<Record<string, unknown>>(env, 'SELECT code, name FROM ff_items');

  const matList = materials.map((m) => `- ${m.id}: ${m.name} (หน่วย: ${m.unit}, สต๊อก: ${m.current_stock}, mode: ${m.tracking_mode})`).join('\n');
  const ctList = contractors.map((c) => `- ${c.id}: ${c.name} (${c.role}, ${c.type || '-'})`).join('\n');
  const ffList = ffs.map((f) => `- ${f.code}: ${f.name}`).join('\n');

  const prompt =
    'คุณคือ AI ช่วยจัดการสต๊อกวัสดุก่อสร้าง โฟร์แมนจะส่งข้อความสั้นๆ มา หน้าที่ของคุณคือแปลงเป็นรายการ transactions (รับ/เบิก/นับ)\n\n' +
    '## รายการ Materials ที่มีอยู่:\n' + matList + '\n\n' +
    '## รายชื่อ Contractors:\n' + ctList + '\n\n' +
    '## รายการ FF Items:\n' + ffList + '\n\n' +
    '## ข้อความจากโฟร์แมน:\n"' + text + '"\n\n' +
    '## คำสั่ง:\n1. แยกข้อความเป็น transactions แต่ละรายการ\n2. แต่ละรายการต้องระบุ: type (รับ/เบิก/นับ), material_id, quantity\n3. ถ้าเป็น "เบิก" ต้องระบุ contractor_id และ ff_code ด้วย\n4. ถ้าข้อมูลไม่ครบหรือคลุมเครือ ให้ใส่ใน needs_clarification พร้อม options\n5. fuzzy match ชื่อ material\n6. fuzzy match ชื่อคน\n\n' +
    '## Response format (JSON เท่านั้น ไม่ต้องมี markdown หรือคำอธิบาย):\n' +
    '{\n  "items": [ { "type": "เบิก", "material_id": "M003", "quantity": 5, "contractor_id": "C001", "ff_code": "F-03", "confidence": "high", "raw_text": "", "missing": [] } ],\n  "needs_clarification": []\n}';

  const response = await callGemini(env, prompt);
  try {
    let cleaned = response.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '');
    const parsed = JSON.parse(cleaned) as { items?: unknown[]; needs_clarification?: unknown[] };
    return { raw_input: text, items: parsed.items || [], needs_clarification: parsed.needs_clarification || [], ai_raw: response.substring(0, 500) };
  } catch {
    return { raw_input: text, items: [], needs_clarification: [{ raw_text: text, issue: 'AI ไม่สามารถ parse ข้อความได้', options: [], field: 'unknown' }], error: 'parse_error', ai_raw: response.substring(0, 500) };
  }
}

// ── confirm_material_log (Code.js:1417) ──
export async function confirmMaterialLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  let items = p.items as unknown;
  if (typeof items === 'string') items = JSON.parse(items);
  const list = (items || []) as Record<string, unknown>[];
  const results: unknown[] = [];
  for (const item of list) {
    try {
      let result: unknown;
      if (item.type === 'รับ') {
        result = await receiveMaterial(env, { material_id: item.material_id, quantity: item.quantity, unit_price: item.unit_price || 0, supplier_id: item.supplier_id || '', receipt_no: item.receipt_no || '', notes: '[Quick Log] ' + (item.raw_text || ''), created_by: item.created_by || 'ST02', __actor: p.__actor });
      } else if (item.type === 'เบิก') {
        result = await withdrawMaterial(env, { material_id: item.material_id, quantity: item.quantity, contractor_id: item.contractor_id, ff_code: item.ff_code || '', notes: '[Quick Log] ' + (item.raw_text || ''), force: item.force || false, created_by: item.created_by || 'ST02', __actor: p.__actor });
      } else if (item.type === 'นับ') {
        result = await countMaterial(env, { material_id: item.material_id, new_stock: item.quantity, notes: '[Quick Log] ' + (item.raw_text || ''), trigger_source: 'quick_log', created_by: item.created_by || 'ST02', __actor: p.__actor });
      } else {
        throw new Error('Unknown type: ' + item.type);
      }
      results.push({ ok: true, item, result });
    } catch (err) {
      results.push({ ok: false, item, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, total: list.length, success: results.filter((r) => (r as { ok: boolean }).ok).length };
}

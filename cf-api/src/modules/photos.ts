// ============================================================
// modules/photos.ts — port จาก Code.js (§PHOTOS + uploads + AI bill)
// D1 (testable): get_photos, add_photo, get_material_photos, get_task_photos,
//   get_transaction_photos, delete_photo, delete_task_photo, get_contract_files,
//   delete_contract_file, delete_payment_slip
// R2 gated (ต้องเปิด MEDIA ก่อน — Session 3): upload_photo, upload_log_photo‼,
//   upload_payment_slip‼, upload_contract_file · scan_bill (Gemini Vision)
// confirm_bill_items (เรียก receiveMaterial — ใช้ได้)
//
// ★ raw key เดิม: task_photos sheet header 'id'/'drive_url' → D1 'photo_id'/'url' (seed override) → alias กลับ
//   upload คืน url เป็น R2 /media/<key> แทน Drive url (BLUEPRINT §4 — ไฟล์ใหม่เข้า R2, ลิงก์เก่าคงเดิม)
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, exec, pidOf, fmtDate, fmtDateTime, blankNulls } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { nowStr, todayStr } from '../lib/time.ts';
import { putMedia, decodeDataUrl } from '../lib/r2.ts';
import { callGeminiVision } from '../lib/gemini.ts';
import { receiveMaterial, getMaterials } from './materials.ts';

const THUMB = 'https://lh3.googleusercontent.com/d/'; // Drive thumbnail (ลิงก์เก่า)
function cvTrue(v: unknown): boolean { return v === true || v === 'TRUE' || v === 'true'; }

// ── get_photos (Code.js:373) — task_photos ดิบ (alias photo_id→id, url→drive_url) ──
export async function getPhotos(env: Env): Promise<unknown> {
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM task_photos');
  return rows.map((r) => { const o = blankNulls(r); o.id = r.photo_id == null ? '' : r.photo_id; o.drive_url = r.url == null ? '' : r.url; delete o.photo_id; delete o.url; return o; });
}

// ── add_photo (Code.js:1919) — บันทึกลง task_photos (ไม่ยุ่ง R2 — เก็บ url/drive_id ที่ส่งมา) ──
export async function addPhoto(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const cv = p.client_visible === true || p.client_visible === 'true';
  const id = await nextId(env, 'P', 3);
  const row: Record<string, unknown> = { id, task_id: p.task_id || '', report_id: p.report_id || '', drive_url: p.drive_url || '', drive_id: p.drive_id || '', caption: p.caption || '', uploaded_at: nowStr(), uploaded_by: p.uploaded_by || '', client_visible: cv };
  await exec(env, `INSERT INTO task_photos (photo_id, project_id, task_id, report_id, url, drive_id, caption, client_visible, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, pidOf(p), row.task_id, row.report_id, row.drive_url, row.drive_id, row.caption, cv ? 'TRUE' : 'FALSE', row.uploaded_at, row.uploaded_by);
  return row;
}

// ── get_material_photos (Code.js:2144) ──
export async function getMaterialPhotos(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const matId = p.mat_id;
  if (!matId) return [];
  const rows = await queryAll<Record<string, unknown>>(env, "SELECT * FROM material_photos WHERE linked_to = 'material' AND link_id = ?", matId);
  return rows.map((r) => ({ photo_id: r.photo_id, linked_to: r.linked_to, link_id: r.link_id, drive_url: r.url, drive_id: r.drive_id, thumbnail: THUMB + r.drive_id + '=w400', caption: r.caption, uploaded_at: r.uploaded_at, uploaded_by: r.uploaded_by }));
}
// ── get_task_photos (Code.js:2176) ──
export async function getTaskPhotos(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const taskId = p.task_id;
  if (!taskId) return [];
  let rows: Record<string, unknown>[];
  try { rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM task_photos WHERE task_id = ?', String(taskId)); } catch { return []; }
  const out = rows.map((r) => ({ id: r.photo_id || '', task_id: r.task_id || '', drive_url: r.url || '', drive_id: r.drive_id || '', caption: r.caption || '', uploaded_at: fmtDateTime(r.uploaded_at), uploaded_by: r.uploaded_by || '' }));
  out.sort((a, b) => String(a.uploaded_at).localeCompare(String(b.uploaded_at)));
  return out;
}
// ── get_transaction_photos (Code.js:2207) ──
export async function getTransactionPhotos(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const transId = p.trans_id;
  if (!transId) return [];
  const rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM material_photos WHERE link_id = ?', transId);
  return rows.map((r) => ({ photo_id: r.photo_id, linked_to: r.linked_to, link_id: r.link_id, drive_url: r.url, drive_id: r.drive_id, thumbnail: THUMB + r.drive_id + '=w400', caption: r.caption, uploaded_at: r.uploaded_at }));
}

async function maybeDeleteR2(env: Env, r2Key: unknown): Promise<void> {
  if (r2Key && env.MEDIA) { try { await env.MEDIA.delete(String(r2Key)); } catch { /* ignore */ } }
}
// ── delete_photo (material_photos) / delete_task_photo (task_photos) ──
export async function deletePhoto(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const photoId = p.photo_id;
  if (!photoId) throw new Error('photo_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT r2_key FROM material_photos WHERE photo_id = ?', photoId);
  if (!row) throw new Error('Photo not found: ' + photoId);
  await maybeDeleteR2(env, row.r2_key);
  await exec(env, 'DELETE FROM material_photos WHERE photo_id = ?', photoId);
  return { deleted: photoId };
}
export async function deleteTaskPhoto(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const photoId = p.photo_id;
  if (!photoId) throw new Error('photo_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT r2_key FROM task_photos WHERE photo_id = ?', photoId);
  if (!row) throw new Error('Task photo not found: ' + photoId);
  await maybeDeleteR2(env, row.r2_key);
  await exec(env, 'DELETE FROM task_photos WHERE photo_id = ?', photoId);
  return { deleted: photoId };
}

// ── contract files / payment slips (D1 read/delete) ──
export async function getContractFiles(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.contract_id) throw new Error('contract_id required');
  const files = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contract_files WHERE contract_id = ?', p.contract_id))
    .map((f) => ({ file_id: f.file_id, contract_id: f.contract_id, url: f.url, drive_id: f.drive_id, name: f.name || '', file_type: f.file_type || 'file', uploaded_at: fmtDateTime(f.uploaded_at) }));
  return { files };
}
export async function deleteContractFile(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.file_id) throw new Error('file_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT r2_key FROM contract_files WHERE file_id = ?', p.file_id);
  if (!row) throw new Error('ไม่พบไฟล์: ' + p.file_id);
  await maybeDeleteR2(env, row.r2_key);
  await exec(env, 'DELETE FROM contract_files WHERE file_id = ?', p.file_id);
  return { ok: true, file_id: p.file_id };
}
export async function deletePaymentSlip(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.slip_id) throw new Error('slip_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT r2_key FROM payment_slips WHERE slip_id = ?', p.slip_id);
  if (!row) throw new Error('ไม่พบสลิป: ' + p.slip_id);
  await maybeDeleteR2(env, row.r2_key);
  await exec(env, 'DELETE FROM payment_slips WHERE slip_id = ?', p.slip_id);
  return { ok: true, slip_id: p.slip_id };
}

// ── R2 UPLOADS (gated — ต้องเปิด MEDIA) ──
export async function uploadPhoto(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.image_base64) throw new Error('image_base64 required');
  if (!p.linked_to) throw new Error('linked_to required');
  if (!p.link_id) throw new Error('link_id required');
  const subtype = p.linked_to === 'material' ? 'materials' : p.linked_to === 'bill' ? 'bills' : 'transactions';
  const { key, url } = await putMedia(env, pidOf(p), subtype, String(p.link_id) + '.jpg', String(p.image_base64));
  const photoId = await nextId(env, 'PH', 3);
  await exec(env, `INSERT INTO material_photos (photo_id, project_id, linked_to, link_id, url, drive_id, r2_key, caption, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
    photoId, pidOf(p), p.linked_to, p.link_id, url, key, p.caption || '', new Date().toISOString(), p.uploaded_by || 'admin');
  return { photo_id: photoId, drive_id: '', drive_url: url, thumbnail: url };
}
export async function uploadLogPhoto(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.image_base64) throw new Error('image_base64 required');
  const { key, url } = await putMedia(env, pidOf(p), 'activity', 'log.jpg', String(p.image_base64));
  return { ok: true, photo_url: url, drive_id: '', r2_key: key, thumbnail: url };
}
export async function uploadPaymentSlip(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.milestone_id) throw new Error('milestone_id required');
  if (!p.file_base64) throw new Error('file_base64 required');
  const { mime } = decodeDataUrl(String(p.file_base64));
  let fileType = 'file';
  if (mime.indexOf('pdf') >= 0) fileType = 'pdf';
  else if (mime.indexOf('image') >= 0) fileType = 'image';
  else throw new Error('รองรับเฉพาะรูปภาพ หรือ PDF เท่านั้น');
  const slipId = await nextId(env, 'SL', 3);
  const { key, url } = await putMedia(env, pidOf(p), 'payment_slips', 'slip_' + p.milestone_id + '.' + (fileType === 'pdf' ? 'pdf' : 'jpg'), String(p.file_base64));
  await exec(env, `INSERT INTO payment_slips (slip_id, milestone_id, contract_id, url, drive_id, r2_key, name, file_type, uploaded_at, uploaded_by) VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
    slipId, p.milestone_id, p.contract_id || '', url, key, p.file_name || ('สลิป ' + slipId), fileType, nowStr(), p.uploaded_by || 'admin');
  return { ok: true, slip_id: slipId, url };
}
export async function uploadContractFile(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.contract_id) throw new Error('contract_id required');
  if (!p.file_base64) throw new Error('file_base64 required');
  const { mime } = decodeDataUrl(String(p.file_base64));
  const fileType = mime.indexOf('pdf') >= 0 ? 'pdf' : mime.indexOf('image') >= 0 ? 'image' : 'file';
  const fileId = await nextId(env, 'CF', 3);
  const { key, url } = await putMedia(env, pidOf(p), 'contracts', 'contract_' + p.contract_id + '.' + (fileType === 'pdf' ? 'pdf' : 'jpg'), String(p.file_base64));
  await exec(env, `INSERT INTO contract_files (file_id, contract_id, url, drive_id, r2_key, name, file_type, uploaded_at, uploaded_by) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`,
    fileId, p.contract_id, url, key, p.file_name || ('ไฟล์ ' + fileId), fileType, nowStr(), p.uploaded_by || 'admin');
  try { await exec(env, 'UPDATE contracts SET file_link = ? WHERE contract_id = ?', url, p.contract_id); } catch { /* ignore */ }
  return { ok: true, file_id: fileId, file_url: url };
}

// ── scan_bill (Gemini Vision — gated) ──
export async function scanBill(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.image_base64) throw new Error('image_base64 required');
  const photoResult = await uploadPhoto(env, { image_base64: p.image_base64, linked_to: 'bill', link_id: 'BILL-' + Date.now(), caption: 'Bill scan', uploaded_by: p.uploaded_by || 'admin', project_id: p.project_id }) as { photo_id: string; drive_url: string; thumbnail: string };
  const { mime, bytes } = decodeDataUrl(String(p.image_base64));
  let b64 = String(p.image_base64); const m = b64.match(/^data:[\w/\-.]+;base64,(.+)$/); if (m) b64 = m[1];
  void bytes;
  const materials = await getMaterials(env);
  const matListText = materials.map((mat) => `${mat.id}|${mat.name}|${mat.unit}|${mat.category}`).join('\n');
  const prompt = `คุณคือผู้ช่วยอ่านใบส่งของ/ใบเสร็จของบริษัทรับเหมาก่อสร้าง\nMaster Materials List (id|ชื่อ|หน่วย|หมวด):\n${matListText}\n\nตอบเป็น JSON เท่านั้น: { "invoice_no": "", "date": "YYYY-MM-DD", "supplier": "", "total": 0, "items": [ { "raw_name": "", "quantity": 0, "unit": "", "unit_price": 0, "line_total": 0, "matched_material_id": null, "matched_material_name": "", "match_confidence": 0.0, "needs_review": false } ] }`;
  let parsed: { items?: { matched_material_id?: unknown }[]; invoice_no?: unknown; date?: unknown; supplier?: unknown; total?: unknown };
  try { parsed = (await callGeminiVision(env, prompt, mime, b64)) as typeof parsed; }
  catch (err) { return { bill_photo_id: photoResult.photo_id, bill_thumbnail: photoResult.thumbnail, error: 'AI ไม่สามารถอ่านบิลได้: ' + (err instanceof Error ? err.message : String(err)), items: [] }; }
  const items = parsed.items || [];
  const unmatched = items.filter((i) => !i.matched_material_id).length;
  return { bill_photo_id: photoResult.photo_id, bill_drive_url: photoResult.drive_url, bill_thumbnail: photoResult.thumbnail, invoice_no: parsed.invoice_no || '', date: parsed.date || todayStr(), supplier: parsed.supplier || '', total: Number(parsed.total) || 0, items, unmatched_count: unmatched };
}

// ── confirm_bill_items (Code.js:2451) — เรียก receiveMaterial ต่อ item ──
export async function confirmBillItems(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const items = (typeof p.items === 'string' ? JSON.parse(p.items) : p.items) as Record<string, unknown>[] | undefined;
  if (!items || !items.length) throw new Error('No items to confirm');
  const results: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!item.material_id || !item.quantity) continue;
    try {
      const res = await receiveMaterial(env, { material_id: item.material_id, quantity: item.quantity, unit_price: item.unit_price || 0, receipt_no: p.invoice_no || '', notes: item.notes || ('สแกนบิล ' + (p.invoice_no || '')), project_id: p.project_id, __actor: p.__actor }) as { transaction: { id: unknown } };
      results.push({ material_id: item.material_id, success: true, transaction_id: res.transaction?.id });
    } catch (err) {
      results.push({ material_id: item.material_id, success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { bill_photo_id: p.bill_photo_id, invoice_no: p.invoice_no, count: results.length, success_count: results.filter((r) => r.success).length, results };
}

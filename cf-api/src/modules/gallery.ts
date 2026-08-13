// ============================================================
// modules/gallery.ts — คลังรูปภาพรวมของโครงการ (ฟีเจอร์ใหม่ 2026-08-13)
//
// ปัญหาที่แก้: รูปหน้างานกระจายอยู่ 4 ตาราง คนละหน้าจอ — ทีมอยากได้ที่รวม
//   ไว้เลือก/ดาวน์โหลดไปทำ marketing โดยรู้ว่ารูปไหนมาจากไหน
//
// actions:
//   get_gallery          (READ)  — รวมรูปจาก 4 แหล่ง → รูปแบบเดียวกัน เรียงใหม่→เก่า
//   migrate_drive_photos (ADMIN) — ย้ายรูปเก่าจาก Google Drive → R2 (ทำครั้งเดียว, ทีละชุด)
//
// 4 แหล่ง (แต่ละแหล่งพก "บริบท" ต่างกัน — เก็บมาให้ครบเพื่อใช้ตั้งชื่อไฟล์/ค้นหา):
//   daily   activity_logs.photo_url  → ข้อความที่บันทึก + แท็บ FF
//   checkin checkins.photo_url       → ชื่อคน + เวลา + กิจกรรม
//   task    task_photos.url          → ชิ้นงาน F-XX + ชื่อ task + คนอัป
//   qc      qc_results.photo_url     → ข้อที่ตรวจ + ผ่าน/ไม่ผ่าน (ข้ามการตรวจที่อยู่ถังขยะ)
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, exec, pidOf, projectScope, fmtDate } from '../lib/db.ts';
import { putMediaFromUrl } from '../lib/r2.ts';

export type GallerySource = 'daily' | 'checkin' | 'task' | 'qc';

export interface GalleryItem {
  id: string;          // ไม่ซ้ำข้ามแหล่ง: 'daily:LOG-001'
  source: GallerySource;
  url: string;         // '/media/<key>' (index.ts เติม origin ให้เป็นลิงก์เต็มตอนตอบ) หรือลิงก์ Drive เก่า
  date: string;        // 'YYYY-MM-DD'
  time: string;        // 'HH:mm' ('' ถ้าไม่มี)
  sort_key: string;    // 'YYYY-MM-DD HH:mm:ss' — ใช้เรียงอย่างเดียว
  title: string;       // บรรทัดหลักใต้รูป
  detail: string;      // บรรทัดรอง (ข้อความเต็ม/หมายเหตุ)
  ff_code: string;     // ชิ้นงานที่เกี่ยว ('' ถ้าไม่ผูก)
  by: string;          // ใครเป็นคนทำ/อัป
  ref_id: string;      // id ของ record ต้นทาง (ไว้ลิงก์กลับไปดู)
  legacy: boolean;     // true = ยังอยู่ Google Drive (ดาวน์โหลดตรงไม่ได้ ต้องเปิดแท็บใหม่)
}

const DRIVE_RE = /googleusercontent\.com|drive\.google\.com/i;
function isLegacy(url: string): boolean { return DRIVE_RE.test(String(url)); }

// เวลาบางแถวเก็บมาไม่เท่ากัน ('2026-08-01', '2026-08-01 09:12:33', ISO) → ทำให้เรียงกันได้
function sortKey(date: string, time: string): string {
  const d = String(date || '').slice(0, 10);
  const t = String(time || '').trim();
  if (!t) return d + ' 00:00:00';
  if (t.length === 5) return d + ' ' + t + ':00';
  return d + ' ' + t.slice(0, 8);
}
function timeOf(v: unknown): string {
  const s = String(v ?? '').trim();
  if (!s) return '';
  const m = s.match(/(\d{2}):(\d{2})/);
  return m ? m[1] + ':' + m[2] : '';
}
// ตัดข้อความยาวให้พอดีบรรทัดเดียว (การ์ดรูปพื้นที่จำกัด)
function short(v: unknown, n = 60): string {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ── get_gallery ──────────────────────────────────────────────
// params: project_id (auto), source ('all'|daily|checkin|task|qc), from, to (YYYY-MM-DD),
//         ff_code, q (ค้นหาข้อความ), limit (default 500)
// คืน { items, counts } — counts นับ "ก่อน" กรองแหล่ง เพื่อให้แถบชิปโชว์ตัวเลขครบทุกแหล่ง
export async function getGallery(env: Env, p: Record<string, unknown>): Promise<{
  items: GalleryItem[];
  counts: Record<string, number>;
}> {
  const pid = pidOf(p);
  const scope = projectScope(pid);
  const want = String(p.source || 'all').toLowerCase();
  const from = String(p.from || '').slice(0, 10);
  const to = String(p.to || '').slice(0, 10);
  const ffFilter = String(p.ff_code || '').trim().toUpperCase();
  const q = String(p.q || '').trim().toLowerCase();
  const limit = Math.min(Number(p.limit) || 500, 2000);

  const all: GalleryItem[] = [];

  // 1) รายงานประจำวัน — ข้อความที่ช่าง/PM บันทึก
  const dailyRows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT log_id, date, timestamp, text, tags_ff, source, photo_url FROM activity_logs
      WHERE ${scope.sql} AND photo_url IS NOT NULL AND photo_url <> ''`,
    ...scope.binds,
  );
  for (const r of dailyRows) {
    const date = fmtDate(r.date) || String(r.timestamp || '').slice(0, 10);
    const ff = String(r.tags_ff || '').split(',').filter(Boolean);
    all.push({
      id: 'daily:' + String(r.log_id || ''), source: 'daily', url: String(r.photo_url),
      date, time: timeOf(r.timestamp), sort_key: sortKey(date, timeOf(r.timestamp)),
      title: short(r.text) || 'บันทึกประจำวัน', detail: String(r.text || ''),
      ff_code: ff[0] || '', by: String(r.source || ''), ref_id: String(r.log_id || ''),
      legacy: isLegacy(String(r.photo_url)),
    });
  }

  // 2) เช็คอินหน้างาน — ใครมา เวลาไหน ทำอะไร
  const ciRows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT checkin_id, date, time, staff_name, role, activity, ff_code, period, note, photo_url
       FROM checkins WHERE ${scope.sql} AND photo_url IS NOT NULL AND photo_url <> ''`,
    ...scope.binds,
  );
  for (const r of ciRows) {
    const date = fmtDate(r.date);
    const t = timeOf(r.time);
    const who = String(r.staff_name || '').trim();
    all.push({
      id: 'checkin:' + String(r.checkin_id || ''), source: 'checkin', url: String(r.photo_url),
      date, time: t, sort_key: sortKey(date, t),
      title: who || 'เช็คอิน',
      detail: [r.activity, r.note].map((x) => String(x || '').trim()).filter(Boolean).join(' · '),
      ff_code: String(r.ff_code || ''), by: who, ref_id: String(r.checkin_id || ''),
      legacy: isLegacy(String(r.photo_url)),
    });
  }

  // 3) หลักฐานงาน (ตอนติ๊ก task เสร็จ) — ผูกชิ้นงาน F-XX ผ่านตาราง tasks
  const tpScope = projectScope(pid, 'tp.project_id');
  const tpRows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT tp.photo_id, tp.task_id, tp.url, tp.caption, tp.uploaded_at, tp.uploaded_by,
            t.ff_code AS ff_code, t.name AS task_name
       FROM task_photos tp LEFT JOIN tasks t ON t.id = tp.task_id
      WHERE ${tpScope.sql} AND tp.url IS NOT NULL AND tp.url <> ''`,
    ...tpScope.binds,
  );
  for (const r of tpRows) {
    const stamp = String(r.uploaded_at || '');
    const date = stamp.slice(0, 10);
    const t = timeOf(stamp.slice(10));
    all.push({
      id: 'task:' + String(r.photo_id || ''), source: 'task', url: String(r.url),
      date, time: t, sort_key: sortKey(date, t),
      title: short(r.task_name || r.caption) || 'หลักฐานงาน',
      detail: String(r.caption || r.task_name || ''),
      ff_code: String(r.ff_code || ''), by: String(r.uploaded_by || ''),
      ref_id: String(r.task_id || ''), legacy: isLegacy(String(r.url)),
    });
  }

  // 4) QC — ข้ามการตรวจที่ถูกทิ้งลงถังขยะ (deleted_at ไม่ว่าง)
  const qcScope = projectScope(pid, 'i.project_id');
  const qcRows = await queryAll<Record<string, unknown>>(
    env,
    `SELECT r.result_id, r.photo_url, r.result, r.defect_class, r.note, r.checked_at, r.checked_by,
            c.item AS item, i.inspection_id, i.ff_code, i.item_name, i.inspect_date, i.inspector
       FROM qc_results r
       JOIN qc_inspections i ON i.inspection_id = r.inspection_id
       LEFT JOIN qc_criteria c ON c.criteria_id = r.criteria_id
      WHERE ${qcScope.sql} AND (i.deleted_at IS NULL OR i.deleted_at = '')
        AND r.photo_url IS NOT NULL AND r.photo_url <> ''`,
    ...qcScope.binds,
  );
  for (const r of qcRows) {
    const stamp = String(r.checked_at || '');
    const date = stamp.slice(0, 10) || fmtDate(r.inspect_date);
    const t = timeOf(stamp.slice(10));
    const verdict = r.result === 'fail' ? 'ไม่ผ่าน' : r.result === 'pass' ? 'ผ่าน' : 'N/A';
    all.push({
      id: 'qc:' + String(r.result_id || ''), source: 'qc', url: String(r.photo_url),
      date, time: t, sort_key: sortKey(date, t),
      title: short(r.item_name || r.ff_code) || 'ตรวจคุณภาพ',
      detail: [short(r.item, 80), verdict, String(r.note || '')].filter(Boolean).join(' · '),
      ff_code: String(r.ff_code || ''), by: String(r.checked_by || r.inspector || ''),
      ref_id: String(r.inspection_id || ''), legacy: isLegacy(String(r.photo_url)),
    });
  }

  // นับต่อแหล่ง "หลังกรองวัน/FF/คำค้น แต่ก่อนกรองแหล่ง" — ชิปจึงโชว์เลขที่กดแล้วได้จริง
  const matched = all.filter((it) => {
    if (from && it.date < from) return false;
    if (to && it.date > to) return false;
    if (ffFilter && String(it.ff_code).toUpperCase() !== ffFilter) return false;
    if (q) {
      const hay = (it.title + ' ' + it.detail + ' ' + it.by + ' ' + it.ff_code).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  const counts: Record<string, number> = { all: matched.length, daily: 0, checkin: 0, task: 0, qc: 0 };
  for (const it of matched) counts[it.source] = (counts[it.source] || 0) + 1;

  const items = (want === 'all' ? matched : matched.filter((it) => it.source === want))
    .sort((a, b) => b.sort_key.localeCompare(a.sort_key))
    .slice(0, limit);

  return { items, counts };
}

// ── migrate_drive_photos ─────────────────────────────────────
// ย้ายรูปเก่าที่ยังชี้ Google Drive → R2 ทีละชุด (idempotent: แถวที่ย้ายแล้วจะไม่ถูกหยิบซ้ำ
// เพราะ legacy col ไม่ว่างแล้ว) · เก็บลิงก์เดิมไว้ทุกแถว = ย้อนกลับได้
// params: limit (default 15, max 40), dry_run
interface LegacyTarget {
  table: string; idCol: string; urlCol: string; keyCol: string; legacyCol: string; subtype: string;
}
const LEGACY_TARGETS: LegacyTarget[] = [
  // ⚠️ activity_logs ใช้ row_id (log_id ซ้ำได้ตั้งแต่ migration 0002) — ไม่งั้นอัปเดตโดนหลายแถว
  { table: 'activity_logs', idCol: 'row_id', urlCol: 'photo_url', keyCol: 'photo_r2_key', legacyCol: 'photo_legacy_url', subtype: 'activity' },
  { table: 'checkins', idCol: 'checkin_id', urlCol: 'photo_url', keyCol: 'photo_r2_key', legacyCol: 'photo_legacy_url', subtype: 'checkin' },
  { table: 'task_photos', idCol: 'photo_id', urlCol: 'url', keyCol: 'r2_key', legacyCol: 'legacy_url', subtype: 'tasks' },
  { table: 'material_photos', idCol: 'photo_id', urlCol: 'url', keyCol: 'r2_key', legacyCol: 'legacy_url', subtype: 'materials' },
];

function pendingSql(t: LegacyTarget): string {
  return `FROM ${t.table}
    WHERE ${t.urlCol} IS NOT NULL AND ${t.urlCol} <> ''
      AND (${t.urlCol} LIKE '%googleusercontent.com%' OR ${t.urlCol} LIKE '%drive.google.com%')
      AND (${t.legacyCol} IS NULL OR ${t.legacyCol} = '')`;
}

export async function migrateDrivePhotos(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!env.MEDIA) throw new Error('R2 (MEDIA) ยังไม่เปิด — ย้ายรูปไม่ได้');
  const limit = Math.min(Math.max(Number(p.limit) || 15, 1), 40);
  const dryRun = p.dry_run === true || p.dry_run === 'true';

  const pending: Record<string, number> = {};
  for (const t of LEGACY_TARGETS) {
    const row = await queryAll<{ n: number }>(env, `SELECT COUNT(*) AS n ${pendingSql(t)}`);
    pending[t.table] = Number(row[0]?.n || 0);
  }
  const totalPending = Object.values(pending).reduce((a, b) => a + b, 0);
  if (dryRun) return { dry_run: true, pending, total_pending: totalPending };

  let migrated = 0, bytes = 0;
  const errors: { table: string; id: string; url: string; error: string }[] = [];

  for (const t of LEGACY_TARGETS) {
    if (migrated + errors.length >= limit) break;
    const take = limit - migrated - errors.length;
    const rows = await queryAll<Record<string, unknown>>(
      env,
      `SELECT ${t.idCol} AS _id, project_id AS _pid, ${t.urlCol} AS _url ${pendingSql(t)} LIMIT ?`,
      take,
    );
    for (const r of rows) {
      const id = String(r._id);
      const srcUrl = String(r._url);
      // project_id ว่าง = ข้อมูลยุค Sheets ที่มีโครงการเดียว → bow-house (เหมือน projectScope)
      const proj = String(r._pid || '').trim() || 'bow-house';
      const driveId = (srcUrl.match(/[-\w]{25,}/) || [id])[0];
      try {
        const put = await putMediaFromUrl(env, proj, 'legacy/' + t.subtype, driveId, srcUrl);
        await exec(
          env,
          `UPDATE ${t.table} SET ${t.urlCol} = ?, ${t.keyCol} = ?, ${t.legacyCol} = ? WHERE ${t.idCol} = ?`,
          put.url, put.key, srcUrl, r._id,
        );
        migrated++; bytes += put.size;
      } catch (err) {
        errors.push({ table: t.table, id, url: srcUrl, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  return {
    ok: true, migrated, failed: errors.length, bytes,
    remaining: Math.max(totalPending - migrated, 0), pending_before: pending, errors,
  };
}

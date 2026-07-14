// ============================================================
// modules/checkin.ts — port จาก apps-script/checkin.gs
// actions (9): create_checkin, get_checkins, get_timesheet, get_attendance_all,
//              update_checkin, set_id_card, get_site_location, set_site_location,
//              delete_checkin   (_diag_activity_photos = ทิ้ง)
//
// ★ contract-preserving (BLUEPRINT §1): response shape เดิมเป๊ะ
//   - on_time/is_far เก็บเป็น string 'TRUE'/'FALSE' (คอลัมน์เดิม) แต่ mapCheckin คืน boolean
//   - distance_m/accuracy: ว่าง → คืน null (Sheets ว่าง = '' → null; D1 = NULL → null)
//   - date/time คำนวณจาก ts (epoch ms) — เชื่อถือได้ (บทเรียน checkin ts)
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { nowStr } from '../lib/time.ts';
import { autoLog } from '../lib/activity.ts';

// ── ค่าคงที่ (checkin.gs:31-36) ──
interface Window { key: string; label: string; start: string; end: string; bucketEnd: string; }
const CHECKIN_WINDOWS: Window[] = [
  { key: 'morning', label: 'เช้า', start: '08:00', end: '08:30', bucketEnd: '11:00' },
  { key: 'noon', label: 'กลางวัน', start: '13:00', end: '13:30', bucketEnd: '15:00' },
  { key: 'evening', label: 'เย็น', start: '17:00', end: '17:30', bucketEnd: '23:59' },
];
const DEFAULT_RADIUS_M = 150;
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok

// ── helpers ──
function pidOf(p: Record<string, unknown>): string {
  return String(p.project_id ?? '').trim() || 'bow-house';
}
function thaiDate(ts: number): string {
  return new Date(ts + TZ_OFFSET_MS).toISOString().slice(0, 10);
}
function thaiTime(ts: number): string {
  return new Date(ts + TZ_OFFSET_MS).toISOString().slice(11, 16);
}
function hhmmToMin(hhmm: string): number {
  const p = String(hhmm).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
}
// (checkin.gs:58) ระบุรอบ + ตรงเวลาไหม
function classifyTime(hhmm: string): { period: string; label: string; on_time: boolean } {
  const t = hhmmToMin(hhmm);
  for (const w of CHECKIN_WINDOWS) {
    if (t <= hhmmToMin(w.bucketEnd)) {
      return { period: w.key, label: w.label, on_time: t <= hhmmToMin(w.end) };
    }
  }
  const last = CHECKIN_WINDOWS[CHECKIN_WINDOWS.length - 1];
  return { period: last.key, label: last.label, on_time: false };
}
// (checkin.gs:71) haversine เมตร
function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
// project scope เทียบ _filterByProject_ (projects_filter.gs:30) — 'bow-house' รวมแถวว่าง
function projectScopeSql(pid: string): { sql: string; binds: unknown[] } {
  if (pid === 'bow-house') {
    return { sql: `(project_id = ? OR project_id IS NULL OR TRIM(project_id) = '')`, binds: [pid] };
  }
  return { sql: `project_id = ?`, binds: [pid] };
}

// ── site location (checkin.gs:82) ──
interface SiteConfigRow { project_id: string; site_lat: number | null; site_lng: number | null; radius_m: number | null; updated_at: string; updated_by: string; }
type SiteInfo = {
  configured: boolean; project_id: string; radius_m: number; windows: Window[];
  site_lat?: number; site_lng?: number; updated_at?: string; updated_by?: string;
};
async function getSiteLocation(env: Env, pid: string): Promise<SiteInfo> {
  const row = await queryFirst<SiteConfigRow>(env, 'SELECT * FROM site_config WHERE project_id = ?', pid);
  if (!row || row.site_lat == null) {
    return { configured: false, project_id: pid, radius_m: DEFAULT_RADIUS_M, windows: CHECKIN_WINDOWS };
  }
  return {
    configured: true,
    project_id: pid,
    site_lat: Number(row.site_lat),
    site_lng: Number(row.site_lng),
    radius_m: Number(row.radius_m || DEFAULT_RADIUS_M),
    windows: CHECKIN_WINDOWS,
    updated_at: row.updated_at || '',
    updated_by: row.updated_by || '',
  };
}
export function getSiteLocationAction(env: Env, p: Record<string, unknown>): Promise<SiteInfo> {
  return getSiteLocation(env, pidOf(p));
}

// setSiteLocation (checkin.gs:105)
export async function setSiteLocation(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  if (p.site_lat === undefined || p.site_lng === undefined) {
    throw new Error('ต้องระบุพิกัด (site_lat, site_lng)');
  }
  const rowObj = {
    project_id: pid,
    site_lat: Number(p.site_lat),
    site_lng: Number(p.site_lng),
    radius_m: Number(p.radius_m || DEFAULT_RADIUS_M),
    updated_at: nowStr(),
    updated_by: (p.updated_by as string) || 'admin',
  };
  await exec(
    env,
    `INSERT INTO site_config (project_id, site_lat, site_lng, radius_m, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       site_lat = excluded.site_lat, site_lng = excluded.site_lng,
       radius_m = excluded.radius_m, updated_at = excluded.updated_at,
       updated_by = excluded.updated_by`,
    rowObj.project_id, rowObj.site_lat, rowObj.site_lng, rowObj.radius_m, rowObj.updated_at, rowObj.updated_by,
  );
  return { ok: true, site: rowObj };
}

// ── สร้างเช็คอิน (checkin.gs:137) ──
export async function createCheckin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const name = String(p.staff_name ?? '').trim();
  if (!name) throw new Error('ต้องระบุชื่อผู้เช็คอิน');

  const ts = Date.now();
  const date = thaiDate(ts);
  const time = thaiTime(ts);
  const cls = classifyTime(time);

  const site = await getSiteLocation(env, pid);
  let distance: number | '' = '';
  let isFar = false;
  const hasGps = p.lat !== undefined && p.lat !== '' && p.lng !== undefined && p.lng !== '';
  if (site.configured && hasGps) {
    distance = haversineM(Number(p.lat), Number(p.lng), site.site_lat!, site.site_lng!);
    isFar = distance > site.radius_m;
  }

  const locType = p.location_type === 'offsite' ? 'offsite' : 'onsite';
  const flagged = locType === 'onsite' && isFar;

  const id = await nextId(env, 'CK', 3);
  const hasAcc = hasGps && p.accuracy !== undefined && p.accuracy !== '';
  // row = รูปเดิมเป๊ะสำหรับ response (on_time/is_far เป็น string, ว่าง = '')
  const row = {
    checkin_id: id,
    project_id: pid,
    staff_id: (p.staff_id as string) || '',
    staff_name: name,
    role: (p.role as string) || '',
    date,
    time,
    ts,
    period: cls.period,
    on_time: cls.on_time ? 'TRUE' : 'FALSE',
    location_type: locType,
    off_site_reason: locType === 'offsite' ? ((p.off_site_reason as string) || 'อื่นๆ') : '',
    distance_m: distance,
    is_far: isFar ? 'TRUE' : 'FALSE',
    lat: hasGps ? Number(p.lat) : '',
    lng: hasGps ? Number(p.lng) : '',
    accuracy: hasAcc ? Number(p.accuracy) : '',
    activity: (p.activity as string) || '',
    ff_code: (p.ff_code as string) || '',
    note: (p.note as string) || '',
    photo_url: (p.photo_url as string) || '',
    created_at: nowStr(),
  };

  // INSERT — คอลัมน์ตัวเลขว่างเก็บ NULL (แทน '' ของ Sheets) — ไม่กระทบ response (ใช้ object row)
  await exec(
    env,
    `INSERT INTO checkins
       (checkin_id, project_id, staff_id, staff_name, role, date, time, ts, period,
        on_time, location_type, off_site_reason, distance_m, is_far, lat, lng,
        accuracy, activity, ff_code, note, photo_url, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.checkin_id, row.project_id, row.staff_id, row.staff_name, row.role, row.date, row.time,
    row.ts, row.period, row.on_time, row.location_type, row.off_site_reason,
    distance === '' ? null : distance, row.is_far,
    hasGps ? Number(p.lat) : null, hasGps ? Number(p.lng) : null,
    hasAcc ? Number(p.accuracy) : null,
    row.activity, row.ff_code, row.note, row.photo_url, row.created_at,
  );

  // auto-log (best-effort) — checkin.gs:194
  const locTxt = locType === 'offsite'
    ? 'นอกไซต์ · ' + row.off_site_reason
    : flagged ? 'แจ้งอยู่ไซต์ แต่ GPS ไกล ' + distance + ' ม. 🚩' : 'อยู่ไซต์';
  await autoLog(
    env,
    '⏰ ' + name + ' เช็คอิน ' + cls.label + ' ' + time + (cls.on_time ? '' : ' (นอกช่วง)') + ' · ' + locTxt,
    { meta: { kind: 'checkin', checkin_id: id, period: cls.period, flagged }, actor: p.__actor as TokenPayload | null },
  );

  return {
    ok: true,
    checkin: row,
    classified: cls,
    distance_m: distance,
    is_far: isFar,
    flagged,
    site_configured: site.configured,
  };
}

// ── update/delete/id-card ──
// updateCheckin (checkin.gs:214) — สิทธิ์ ATTEND
export async function updateCheckin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.checkin_id) throw new Error('checkin_id required');
  const fields = ['staff_name', 'staff_id', 'role', 'activity', 'note', 'photo_url'];
  const updates: Record<string, unknown> = {};
  for (const f of fields) if (p[f] !== undefined) updates[f] = p[f];
  const keys = Object.keys(updates);
  if (!keys.length) throw new Error('ไม่มี field ให้แก้');

  const exists = await queryFirst(env, 'SELECT checkin_id FROM checkins WHERE checkin_id = ?', p.checkin_id);
  if (!exists) throw new Error('Row not found: checkin_id=' + p.checkin_id);

  const sets = keys.map((k) => `${k} = ?`).join(', ');
  await exec(env, `UPDATE checkins SET ${sets} WHERE checkin_id = ?`, ...keys.map((k) => updates[k]), p.checkin_id);
  return { ok: true, checkin_id: p.checkin_id, updated: keys };
}

// setIdCard (checkin.gs:228)
export async function setIdCard(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.staff_name) throw new Error('staff_name required');
  await exec(
    env,
    `INSERT INTO staff_id_cards (staff_name, national_id, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(staff_name) DO UPDATE SET
       national_id = excluded.national_id, updated_at = excluded.updated_at`,
    p.staff_name, String(p.national_id || ''), nowStr(),
  );
  return { ok: true, staff_name: p.staff_name };
}
async function idCardMap(env: Env): Promise<Record<string, string>> {
  const m: Record<string, string> = {};
  try {
    const rows = await queryAll<{ staff_name: string; national_id: string }>(env, 'SELECT staff_name, national_id FROM staff_id_cards');
    for (const r of rows) if (r.staff_name) m[String(r.staff_name)] = String(r.national_id || '');
  } catch { /* ว่าง */ }
  return m;
}

// deleteCheckin (checkin.gs:269)
export async function deleteCheckin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.checkin_id) throw new Error('checkin_id required');
  const res = await exec(env, 'DELETE FROM checkins WHERE checkin_id = ?', p.checkin_id);
  if (!res.meta || res.meta.changes < 1) throw new Error('ไม่พบเช็คอิน: ' + p.checkin_id);
  return { ok: true, deleted: p.checkin_id };
}

// ── อ่านเช็คอิน (checkin.gs:290) ──
interface CheckinRow {
  checkin_id: string; ts: number | null; staff_id: string; staff_name: string; role: string;
  project_id: string; date: string; time: string | null; period: string; on_time: unknown;
  location_type: string; off_site_reason: string; distance_m: number | null; is_far: unknown;
  accuracy: number | null; activity: string; ff_code: string; note: string; photo_url: string;
}
interface MappedCheckin {
  checkin_id: string; ts: number | ''; staff_id: string; staff_name: string; role: string;
  project_id: string; date: string; time: string; period: string; on_time: boolean;
  location_type: string; off_site_reason: string; distance_m: number | null; is_far: boolean;
  accuracy: number | null; activity: string; ff_code: string; note: string; photo_url: string;
}
function mapCheckin(r: CheckinRow): MappedCheckin {
  const ts = r.ts !== null && r.ts !== undefined && (r.ts as unknown) !== '' ? Number(r.ts) : null;
  const dateStr = ts ? thaiDate(ts) : (r.date == null || r.date === '' ? '' : String(r.date));
  const timeStr = ts ? thaiTime(ts) : String(r.time || '');
  return {
    checkin_id: r.checkin_id,
    ts: ts || '',
    staff_id: r.staff_id || '',
    staff_name: r.staff_name || '',
    role: r.role || '',
    project_id: r.project_id || '',
    date: dateStr,
    time: timeStr,
    period: r.period || '',
    on_time: String(r.on_time).toUpperCase() === 'TRUE',
    location_type: r.location_type || 'onsite',
    off_site_reason: r.off_site_reason || '',
    distance_m: r.distance_m == null || (r.distance_m as unknown) === '' ? null : Number(r.distance_m),
    is_far: String(r.is_far).toUpperCase() === 'TRUE',
    accuracy: r.accuracy == null || (r.accuracy as unknown) === '' ? null : Number(r.accuracy),
    activity: r.activity || '',
    ff_code: r.ff_code || '',
    note: r.note || '',
    photo_url: r.photo_url || '',
  };
}

interface CheckinFilters { staff_id?: unknown; staff_name?: unknown; date?: unknown; from?: unknown; to?: unknown; }
// รายการเช็คอิน scope project (checkin.gs:319)
async function getCheckinsList(env: Env, pid: string, f: CheckinFilters): Promise<MappedCheckin[]> {
  const scope = projectScopeSql(pid);
  let rows: CheckinRow[];
  try {
    rows = await queryAll<CheckinRow>(env, `SELECT * FROM checkins WHERE ${scope.sql}`, ...scope.binds);
  } catch {
    return [];
  }
  let out = rows.map(mapCheckin);
  if (f.staff_id) out = out.filter((c) => String(c.staff_id) === String(f.staff_id));
  if (f.staff_name) out = out.filter((c) => c.staff_name === f.staff_name);
  if (f.date) out = out.filter((c) => c.date === f.date);
  if (f.from) out = out.filter((c) => c.date >= String(f.from));
  if (f.to) out = out.filter((c) => c.date <= String(f.to));
  out.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // ใหม่ก่อน
    return a.time < b.time ? 1 : -1;
  });
  return out;
}
export function getCheckins(env: Env, p: Record<string, unknown>): Promise<MappedCheckin[]> {
  return getCheckinsList(env, pidOf(p), { staff_id: p.staff_id, staff_name: p.staff_name, date: p.date, from: p.from, to: p.to });
}

// ── ใบลงเวลา (checkin.gs:341) ──
export async function getTimesheet(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const list = await getCheckinsList(env, pidOf(p), { from: p.from, to: p.to, staff_id: p.staff_id, staff_name: p.staff_name });

  const byStaff: Record<string, { staff_id: string; staff_name: string; role: string; days: Record<string, MappedCheckin[]> }> = {};
  for (const c of list) {
    const sk = c.staff_id || c.staff_name || '?';
    if (!byStaff[sk]) byStaff[sk] = { staff_id: c.staff_id, staff_name: c.staff_name, role: c.role, days: {} };
    if (!byStaff[sk].days[c.date]) byStaff[sk].days[c.date] = [];
    byStaff[sk].days[c.date].push(c);
  }

  const staffArr = Object.keys(byStaff).map((sk) => {
    const s = byStaff[sk];
    const days = Object.keys(s.days).sort().map((d) => {
      const entries = s.days[d].slice().sort((a, b) => (a.time < b.time ? -1 : 1));
      const periods: Record<string, { time: string; on_time: boolean; location_type: string } | null> = {};
      for (const w of CHECKIN_WINDOWS) {
        const e = entries.filter((x) => x.period === w.key)[0] || null;
        periods[w.key] = e ? { time: e.time, on_time: e.on_time, location_type: e.location_type } : null;
      }
      return {
        date: d,
        entries,
        periods,
        present: entries.length > 0,
        offsite_count: entries.filter((x) => x.location_type === 'offsite').length,
        flagged_count: entries.filter((x) => x.is_far && x.location_type === 'onsite').length,
      };
    });
    return { staff_id: s.staff_id, staff_name: s.staff_name, role: s.role, days, days_present: days.length };
  });

  staffArr.sort((a, b) => (a.staff_name || '').localeCompare(b.staff_name || '', 'th'));
  return { from: (p.from as string) || '', to: (p.to as string) || '', windows: CHECKIN_WINDOWS, staff: staffArr };
}

// ── HR: ใบลงเวลาทุกคนทุกไซต์ (checkin.gs:385) — สิทธิ์ ATTEND ──
export async function getAttendanceAll(env: Env, p: Record<string, unknown>): Promise<unknown> {
  let rows: CheckinRow[];
  try {
    rows = await queryAll<CheckinRow>(env, 'SELECT * FROM checkins');
  } catch {
    return { from: (p.from as string) || '', to: (p.to as string) || '', windows: CHECKIN_WINDOWS, staff: [], projects: [] };
  }

  let list = rows.map(mapCheckin);
  if (p.project_id) list = list.filter((c) => String(c.project_id) === String(p.project_id));
  if (p.from) list = list.filter((c) => c.date >= String(p.from));
  if (p.to) list = list.filter((c) => c.date <= String(p.to));

  const byStaff: Record<string, { staff_id: string; staff_name: string; role: string; days: Record<string, MappedCheckin[]> }> = {};
  for (const c of list) {
    const sk = c.staff_id || c.staff_name || '?';
    if (!byStaff[sk]) byStaff[sk] = { staff_id: c.staff_id, staff_name: c.staff_name, role: c.role, days: {} };
    if (!byStaff[sk].days[c.date]) byStaff[sk].days[c.date] = [];
    byStaff[sk].days[c.date].push(c);
  }
  const staffArr = Object.keys(byStaff).map((sk) => {
    const s = byStaff[sk];
    const days = Object.keys(s.days).sort().map((d) => {
      const entries = s.days[d].slice().sort((a, b) => (a.time < b.time ? -1 : 1));
      return {
        date: d, entries, present: entries.length > 0,
        offsite_count: entries.filter((x) => x.location_type === 'offsite').length,
        flagged_count: entries.filter((x) => x.is_far && x.location_type === 'onsite').length,
      };
    });
    return { staff_id: s.staff_id, staff_name: s.staff_name, role: s.role, days, days_present: days.length } as Record<string, unknown>;
  });
  staffArr.sort((a, b) => String(a.staff_name || '').localeCompare(String(b.staff_name || ''), 'th'));

  const idmap = await idCardMap(env);
  for (const s of staffArr) s.national_id = idmap[String(s.staff_name)] || '';

  const projects: { project_id: string; name: string }[] = [];
  try {
    const prows = await queryAll<{ project_id: string; name: string }>(env, 'SELECT project_id, name FROM projects');
    for (const r of prows) if (r.project_id) projects.push({ project_id: String(r.project_id), name: r.name || String(r.project_id) });
  } catch { /* ว่าง */ }

  return { from: (p.from as string) || '', to: (p.to as string) || '', windows: CHECKIN_WINDOWS, staff: staffArr, projects };
}

// ============================================================
// modules/tour.ts — เดินดูหน้างาน 360 (Site Tour)
//   สเปก: docs/site-tour-360/TOUR-SPEC.md · เจ้าของงานเคาะ 2026-08-18
//
// แนวคิด 3 ชั้น:
//   จุด (point)     = ตำแหน่งถ่ายคงที่ + ลูกศรเดิน  → สมบัติของโครงการ วางครั้งเดียวใช้ตลอด
//   เวอร์ชัน (version) = การกลับไปถ่ายทุกจุดอีกรอบ    → มีชื่อ + วันที่ + สถานะ
//   ภาพ (shot)      = 1 จุด × 1 เวอร์ชัน           → เกิดใหม่ทุกรอบ ไม่เขียนทับของเก่า
//
// ⚠️ กฎที่พลาดแล้วหลักฐานเพี้ยน (กฎทองข้อ 6):
//   ภาพสำรองต้อง "มองย้อนหลังเท่านั้น" — ห้ามหยิบภาพจากเวอร์ชันที่ใหม่กว่ามาโชว์
//   ไม่งั้นเปิดดู 'ก่อนโพรเทค' แล้วเห็นงานติดตั้งเสร็จ → เอาไปเคลมงานไม่ได้เลย
//
// actions (15): READ 2 · SITECFG 8 · OPS 5
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, blankNulls } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { nowStr, todayStr } from '../lib/time.ts';
import { putMedia } from '../lib/r2.ts';
import { autoLog } from '../lib/activity.ts';
import type { TokenPayload } from '../lib/auth.ts';

// เก็บของในถังขยะกี่วันก่อนลบจริง — กติกาเดียวกับโมดูล QC (เจ้าของงานเคาะ 30 วัน)
const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── ตัวช่วยเล็กๆ ────────────────────────────────────────────
function actorOf(p: Record<string, unknown>): string {
  const a = p.__actor as { name?: string; staff_id?: string } | undefined;
  return String(a?.name || a?.staff_id || p.uploaded_by || p.created_by || 'system');
}
function num(v: unknown, dflt = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v: unknown): string {
  return String(v ?? '').trim();
}
// เรียงเวอร์ชันจากเก่า→ใหม่ (captured_at ก่อน แล้วค่อย created_at กันวันชนกัน)
function verKey(v: Record<string, unknown>): string {
  return str(v.captured_at) + '|' + str(v.created_at);
}

// ตีความชนิดภาพจากสัดส่วน (สเปก §7) — ผู้ใช้แก้ทีหลังได้ผ่าน tour_update_shot
//
// ⚠️ ทำไมช่วง "360 เต็มใบ" ถึงแคบมาก (2.00 ±1%):
//   ภาพ 360 เต็มใบ (equirectangular) กว้าง 360° สูง 180° → สัดส่วน **2:1 เป๊ะเสมอ** ตามนิยาม
//   ส่วนพาโนมือถือกวาดครึ่งทางก็ได้สัดส่วนราว 2 ได้เหมือนกัน แต่ไม่เคยลงตัวเป๊ะ
//   ถ้าตีเป็นช่วงกว้าง (1.8-2.2) พาโน iPhone ที่กวาด ~120° จะถูกเข้าใจผิดว่าเป็น 360 เต็มใบ
//   → ภาพจะถูกยืดคลุมทั้งรอบตัว บิดจนดูไม่รู้เรื่อง (เจอตอนเตรียมให้เจ้าของงานถ่ายด้วย iPhone)
export function guessKind(w: number, h: number): { kind: string; haov: number; vaov: number } {
  if (!w || !h) return { kind: 'flat', haov: 0, vaov: 0 };
  const r = w / h;
  if (Math.abs(r - 2) <= 0.02) return { kind: 'sphere', haov: 360, vaov: 180 };
  if (r >= 1.35) {
    // พาโนมือถือ: ความละเอียดเชิงมุมคงที่ แนวตั้งราว 60° → กว้าง ≈ อัตราส่วน × 60
    // (iPhone กวาดสุดได้ ~240° · เพดาน 300° กันเดาเกินจริง)
    const haov = Math.min(Math.round(r * 60), 300);
    return { kind: 'pano', haov, vaov: 60 };
  }
  return { kind: 'flat', haov: 0, vaov: 0 };
}

// ── กวาดถังขยะ: ลบจริงของที่ทิ้งเกิน 30 วัน ──────────────────
// ทำแบบ lazy (ตอนมีคนเปิดหน้าทัวร์) เพราะ cron ของโปรเจกต์นี้มีตัวเดียวไว้ส่ง LINE
// ผลจากมุมผู้ใช้เหมือนกัน — ต่างแค่ลบตอนมีคนเข้ามาใช้ ไม่ใช่ตอนเที่ยงคืนเป๊ะ
async function purgeExpiredTrash(env: Env): Promise<void> {
  const cutoff = nowStr(Date.now() - TRASH_DAYS * DAY_MS);
  const gone = (col: string) => `${col} IS NOT NULL AND ${col} != '' AND ${col} < ?`;
  try {
    // ไฟล์ใน R2 ต้องลบด้วย ไม่งั้นรูปค้างกินที่ไปเรื่อยๆ ทั้งที่แถวในฐานข้อมูลหายแล้ว
    const shots = await queryAll<{ shot_id: string; media_key: string }>(env,
      `SELECT shot_id, media_key FROM tour_shots WHERE ${gone('trashed_at')}`, cutoff);
    if (env.MEDIA) {
      for (const s of shots) {
        if (s.media_key) { try { await env.MEDIA.delete(String(s.media_key)); } catch { /* ไฟล์หายไปแล้วก็ข้าม */ } }
      }
    }
    await exec(env, `DELETE FROM tour_shots WHERE ${gone('trashed_at')}`, cutoff);
    await exec(env, `DELETE FROM tour_links WHERE ${gone('trashed_at')}`, cutoff);
    await exec(env, `DELETE FROM tour_pins WHERE point_id IN (SELECT point_id FROM tour_points WHERE ${gone('trashed_at')})`, cutoff);
    await exec(env, `DELETE FROM tour_points WHERE ${gone('trashed_at')}`, cutoff);
    await exec(env, `DELETE FROM tour_versions WHERE ${gone('trashed_at')}`, cutoff);
  } catch { /* กวาดไม่สำเร็จไม่ควรทำให้เปิดหน้าไม่ได้ */ }
}

// เหลืออีกกี่วันก่อนลบจริง (เวลาที่เก็บเป็นเวลาไทย 'YYYY-MM-DD HH:mm:ss')
function daysLeft(stamp: unknown): number {
  const ms = Date.parse(String(stamp || '').replace(' ', 'T') + 'Z') - 7 * 60 * 60 * 1000;
  if (!Number.isFinite(ms)) return TRASH_DAYS;
  return Math.max(0, TRASH_DAYS - Math.floor((Date.now() - ms) / DAY_MS));
}

// ── READ: tour_get_trash — ของในถังขยะ + เหลืออีกกี่วัน ──────
export async function getTrash(env: Env, p: Record<string, unknown>): Promise<unknown> {
  await purgeExpiredTrash(env);
  const pid = pidOf(p);
  const sc = projectScope(pid);
  const g = `trashed_at IS NOT NULL AND trashed_at != ''`;

  const points = await queryAll(env,
    `SELECT * FROM tour_points WHERE ${sc.sql} AND ${g} ORDER BY trashed_at DESC`, ...sc.binds);
  const versions = await queryAll(env,
    `SELECT * FROM tour_versions WHERE ${sc.sql} AND ${g} ORDER BY trashed_at DESC`, ...sc.binds);

  // จุดที่ทิ้งไปแล้วเคยมีภาพกี่ใบ — ให้คนตัดสินใจได้ว่าจะกู้คืนไหม
  const counts = await queryAll<{ point_id: string; n: number }>(env,
    `SELECT point_id, COUNT(*) AS n FROM tour_shots WHERE ${sc.sql} GROUP BY point_id`, ...sc.binds);
  const cmap: Record<string, number> = {};
  for (const c of counts) cmap[String(c.point_id)] = Number(c.n) || 0;

  return {
    trash_days: TRASH_DAYS,
    points: points.map((r) => {
      const o = blankNulls(r);
      o.days_left = daysLeft(r.trashed_at);
      o.shot_count = cmap[String(r.point_id)] || 0;
      return o;
    }),
    versions: versions.map((r) => {
      const o = blankNulls(r);
      o.days_left = daysLeft(r.trashed_at);
      return o;
    }),
  };
}

// ── READ: tour_get_config ───────────────────────────────────
// ก้อนเดียวจบ (แผนผัง + จุด + ลูกศร + รายการเวอร์ชัน) — ลดจำนวนคำขอบนเน็ตหน้างาน
// param: include_draft ('true' = เอาเวอร์ชันที่ยังถ่ายไม่เสร็จมาด้วย — ใช้ในโหมดถ่าย)
export async function getConfig(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const sc = projectScope(pid);
  const includeDraft = p.include_draft === true || p.include_draft === 'true';

  const plans = await queryAll(env, `SELECT * FROM tour_plans WHERE ${sc.sql} ORDER BY sort_order, plan_id`, ...sc.binds);
  const points = await queryAll(env, `SELECT * FROM tour_points WHERE ${sc.sql} AND active = 1 AND trashed_at IS NULL ORDER BY sort_order, point_id`, ...sc.binds);
  const links = await queryAll(env, `SELECT * FROM tour_links WHERE ${sc.sql} AND trashed_at IS NULL ORDER BY from_point, yaw`, ...sc.binds);

  const statusSql = includeDraft
    ? `status IN ('draft','published')`
    : `status = 'published'`;
  const versions = await queryAll(env,
    `SELECT * FROM tour_versions WHERE ${sc.sql} AND ${statusSql} AND trashed_at IS NULL
     ORDER BY captured_at DESC, created_at DESC`, ...sc.binds);

  // นับจำนวนภาพต่อเวอร์ชัน — ให้หน้าเว็บโชว์ "ถ่ายแล้ว 4/10 จุด" ได้โดยไม่ต้องยิงซ้ำ
  const counts = await queryAll<{ version_id: string; n: number }>(env,
    `SELECT version_id, COUNT(*) AS n FROM tour_shots
     WHERE ${sc.sql} AND trashed_at IS NULL GROUP BY version_id`, ...sc.binds);
  const cmap: Record<string, number> = {};
  for (const c of counts) cmap[String(c.version_id)] = Number(c.n) || 0;

  return {
    plans: plans.map(blankNulls),
    points: points.map(blankNulls),
    links: links.map(blankNulls),
    versions: versions.map((v) => {
      const o = blankNulls(v);
      o.shot_count = cmap[String(v.version_id)] || 0;
      o.point_count = points.length;
      return o;
    }),
  };
}

// ── READ: tour_get_version ──────────────────────────────────
// คืนภาพครบทุกจุดเสมอ — จุดที่เวอร์ชันนี้ยังไม่ถ่าย เติมภาพสำรอง "ย้อนหลังเท่านั้น"
export async function getVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const sc = projectScope(pid);
  const versionId = str(p.version_id);

  const versions = await queryAll(env,
    `SELECT * FROM tour_versions WHERE ${sc.sql} AND trashed_at IS NULL`, ...sc.binds);
  if (!versions.length) return { version: null, shots: [], pins: [] };

  // ไม่ระบุ version_id = เวอร์ชันล่าสุดที่เผยแพร่แล้ว (กฎทองข้อ 3)
  const published = versions.filter((v) => str(v.status) === 'published')
    .sort((a, b) => verKey(b).localeCompare(verKey(a)));
  const cur = versionId
    ? versions.find((v) => str(v.version_id) === versionId)
    : published[0];
  if (!cur) throw new Error('ไม่พบเวอร์ชันนี้');

  const curKey = verKey(cur);
  const points = await queryAll(env,
    `SELECT * FROM tour_points WHERE ${sc.sql} AND active = 1 AND trashed_at IS NULL ORDER BY sort_order, point_id`, ...sc.binds);

  // ดึงภาพทั้งโครงการมาครั้งเดียว แล้วเลือกในหน่วยความจำ
  // (จำนวนภาพต่อโครงการหลักร้อย — ถูกกว่ายิง query ต่อจุด และทำให้ตรรกะ "ย้อนหลัง" อ่านง่าย)
  const allShots = await queryAll(env,
    `SELECT * FROM tour_shots WHERE ${sc.sql} AND trashed_at IS NULL`, ...sc.binds);
  const verById: Record<string, Record<string, unknown>> = {};
  for (const v of versions) verById[str(v.version_id)] = v;

  const shots = points.map((pt) => {
    const pid2 = str(pt.point_id);
    const mine = allShots.filter((s) => str(s.point_id) === pid2);

    // 1) ภาพของเวอร์ชันนี้ตรงๆ
    const exact = mine.find((s) => str(s.version_id) === str(cur.version_id));
    if (exact) {
      return { point_id: pid2, shot: blankNulls(exact), fallback_from_version: null, no_image: false };
    }

    // 2) ภาพสำรอง — เฉพาะเวอร์ชันที่ "เก่ากว่า" เวอร์ชันที่กำลังดู (ห้ามมองไปข้างหน้า)
    const older = mine
      .map((s) => ({ s, v: verById[str(s.version_id)] }))
      .filter((x) => x.v && verKey(x.v) < curKey)
      .sort((a, b) => verKey(b.v).localeCompare(verKey(a.v)));

    if (older.length) {
      const best = older[0];
      return {
        point_id: pid2,
        shot: blankNulls(best.s),
        fallback_from_version: {
          version_id: str(best.v.version_id),
          name: str(best.v.name),
          captured_at: str(best.v.captured_at),
        },
        no_image: false,
      };
    }

    // 3) ย้อนหลังแล้วไม่มีเลย — จุดเพิ่งถูกสร้างทีหลัง
    return { point_id: pid2, shot: null, fallback_from_version: null, no_image: true };
  });

  const pins = await queryAll(env,
    `SELECT * FROM tour_pins WHERE ${sc.sql} AND (version_id = ? OR version_id IS NULL OR TRIM(version_id) = '')`,
    ...sc.binds, str(cur.version_id));

  return { version: blankNulls(cur), shots, pins: pins.map(blankNulls) };
}

// ── SITECFG: แผนผัง ─────────────────────────────────────────
export async function savePlan(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const planId = str(p.plan_id) || (await nextId(env, 'TP', 3));
  const exists = await queryFirst(env, 'SELECT plan_id FROM tour_plans WHERE plan_id = ?', planId);

  let mediaKey = str(p.media_key);
  let url = str(p.url);
  if (p.image_base64) {
    const put = await putMedia(env, pid, 'tour/plans', planId + '.jpg', String(p.image_base64));
    mediaKey = put.key;
    url = put.url;
  }

  if (exists) {
    await exec(env,
      `UPDATE tour_plans SET floor_label = ?, sort_order = ?, width = ?, height = ?
       ${mediaKey ? ', media_key = ?, url = ?' : ''} WHERE plan_id = ?`,
      ...(mediaKey
        ? [str(p.floor_label), num(p.sort_order), num(p.width), num(p.height), mediaKey, url, planId]
        : [str(p.floor_label), num(p.sort_order), num(p.width), num(p.height), planId]));
  } else {
    await exec(env,
      `INSERT INTO tour_plans (plan_id, project_id, floor_label, media_key, url, width, height, sort_order, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      planId, pid, str(p.floor_label) || 'ชั้น 1', mediaKey, url,
      num(p.width), num(p.height), num(p.sort_order), nowStr(), actorOf(p));
  }
  return { ok: true, plan_id: planId, url };
}

export async function deletePlan(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const planId = str(p.plan_id);
  if (!planId) throw new Error('plan_id required');
  await exec(env, 'DELETE FROM tour_plans WHERE plan_id = ?', planId);
  await exec(env, `UPDATE tour_points SET plan_id = '' WHERE plan_id = ?`, planId);
  return { ok: true };
}

// ── SITECFG: จุด ────────────────────────────────────────────
export async function savePoint(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const pointId = str(p.point_id) || (await nextId(env, 'TPT', 3));
  const exists = await queryFirst(env, 'SELECT point_id FROM tour_points WHERE point_id = ?', pointId);

  if (exists) {
    await exec(env,
      `UPDATE tour_points SET name = ?, plan_id = ?, plan_x = ?, plan_y = ?, sort_order = ? WHERE point_id = ?`,
      str(p.name), str(p.plan_id), num(p.plan_x), num(p.plan_y), num(p.sort_order), pointId);
  } else {
    await exec(env,
      `INSERT INTO tour_points (point_id, project_id, plan_id, name, plan_x, plan_y, sort_order, active, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      pointId, pid, str(p.plan_id), str(p.name) || 'จุดใหม่',
      num(p.plan_x), num(p.plan_y), num(p.sort_order), nowStr(), actorOf(p));
  }
  return { ok: true, point_id: pointId };
}

// ── ทิ้งจุดลงถังขยะ (กู้คืนได้ 30 วัน) ──────────────────────
// ⚠️ ลูกศรที่เกี่ยวข้อง "ประทับเวลาทิ้ง" ไม่ใช่ลบถาวร
//    ไม่งั้นกู้จุดกลับมาแล้วทางเดินหายหมด ต้องมานั่งโยงใหม่ทีละเส้น
export async function deletePoint(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pointId = str(p.point_id);
  if (!pointId) throw new Error('point_id required');
  const ts = nowStr();
  await exec(env, 'UPDATE tour_points SET active = 0, trashed_at = ? WHERE point_id = ?', ts, pointId);
  await exec(env,
    'UPDATE tour_links SET trashed_at = ? WHERE (from_point = ? OR to_point = ?) AND trashed_at IS NULL',
    ts, pointId, pointId);
  return { ok: true, trashed_at: ts, trash_days: TRASH_DAYS };
}

// กู้คืนจุดจากถังขยะ — ลูกศรกลับมาด้วย เฉพาะเส้นที่ปลายทางอีกฝั่งยังอยู่
export async function restorePoint(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pointId = str(p.point_id);
  if (!pointId) throw new Error('point_id required');
  const cur = await queryFirst(env, 'SELECT point_id FROM tour_points WHERE point_id = ?', pointId);
  if (!cur) throw new Error('กู้คืนไม่ได้ — จุดนี้ถูกลบถาวรไปแล้ว (เกิน ' + TRASH_DAYS + ' วัน)');
  await exec(env, 'UPDATE tour_points SET active = 1, trashed_at = NULL WHERE point_id = ?', pointId);
  await exec(env,
    `UPDATE tour_links SET trashed_at = NULL
     WHERE (from_point = ? OR to_point = ?)
       AND from_point IN (SELECT point_id FROM tour_points WHERE active = 1 AND trashed_at IS NULL)
       AND to_point   IN (SELECT point_id FROM tour_points WHERE active = 1 AND trashed_at IS NULL)`,
    pointId, pointId);
  return { ok: true };
}

// ── SITECFG: ลูกศร ──────────────────────────────────────────
export async function saveLink(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const from = str(p.from_point);
  const to = str(p.to_point);
  if (!from || !to) throw new Error('from_point / to_point required');
  if (from === to) throw new Error('ลูกศรชี้กลับมาที่จุดเดิมไม่ได้');

  const linkId = str(p.link_id) || (await nextId(env, 'TL', 3));
  const exists = await queryFirst(env, 'SELECT link_id FROM tour_links WHERE link_id = ?', linkId);
  if (exists) {
    await exec(env, `UPDATE tour_links SET from_point = ?, to_point = ?, yaw = ?, pitch = ?, label = ? WHERE link_id = ?`,
      from, to, num(p.yaw), num(p.pitch, -10), str(p.label), linkId);
  } else {
    await exec(env,
      `INSERT INTO tour_links (link_id, project_id, from_point, to_point, yaw, pitch, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      linkId, pid, from, to, num(p.yaw), num(p.pitch, -10), str(p.label), nowStr());
  }
  return { ok: true, link_id: linkId };
}

export async function deleteLink(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const linkId = str(p.link_id);
  if (!linkId) throw new Error('link_id required');
  await exec(env, 'DELETE FROM tour_links WHERE link_id = ?', linkId);
  return { ok: true };
}

// ── SITECFG: เวอร์ชัน ───────────────────────────────────────
export async function createVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const versionId = await nextId(env, 'TV', 3);
  const captured = str(p.captured_at).slice(0, 10) || todayStr();
  await exec(env,
    `INSERT INTO tour_versions (version_id, project_id, name, note, status, captured_at, visibility, created_at, created_by)
     VALUES (?, ?, ?, ?, 'draft', ?, 'internal', ?, ?)`,
    versionId, pid, str(p.name) || ('เวอร์ชัน ' + captured), str(p.note), captured, nowStr(), actorOf(p));
  return { ok: true, version_id: versionId, status: 'draft' };
}

export async function updateVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const versionId = str(p.version_id);
  if (!versionId) throw new Error('version_id required');
  await exec(env, `UPDATE tour_versions SET name = ?, note = ?, captured_at = ? WHERE version_id = ?`,
    str(p.name), str(p.note), str(p.captured_at).slice(0, 10) || todayStr(), versionId);
  return { ok: true };
}

export async function publishVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const versionId = str(p.version_id);
  if (!versionId) throw new Error('version_id required');
  const v = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM tour_versions WHERE version_id = ?', versionId);
  if (!v) throw new Error('ไม่พบเวอร์ชันนี้');

  await exec(env, `UPDATE tour_versions SET status = 'published', published_at = ? WHERE version_id = ?`, nowStr(), versionId);

  const n = await queryFirst<{ n: number }>(env,
    'SELECT COUNT(*) AS n FROM tour_shots WHERE version_id = ? AND trashed_at IS NULL', versionId);
  await autoLog(env, `เผยแพร่ทัวร์หน้างานเวอร์ชัน "${str(v.name)}" (${Number(n?.n) || 0} จุด)`, {
    project_id: pid, actor: (p.__actor as TokenPayload) ?? null,
  });
  return { ok: true, version_id: versionId, status: 'published' };
}

// ทิ้งเวอร์ชันลงถังขยะ (กู้คืนได้ 30 วัน — กติกาเดียวกับโมดูล QC)
export async function deleteVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const versionId = str(p.version_id);
  if (!versionId) throw new Error('version_id required');
  await exec(env, `UPDATE tour_versions SET status = 'trashed', trashed_at = ? WHERE version_id = ?`, nowStr(), versionId);
  await exec(env, 'UPDATE tour_shots SET trashed_at = ? WHERE version_id = ?', nowStr(), versionId);
  return { ok: true };
}

export async function restoreVersion(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const versionId = str(p.version_id);
  if (!versionId) throw new Error('version_id required');
  await exec(env, `UPDATE tour_versions SET status = 'draft', trashed_at = NULL WHERE version_id = ?`, versionId);
  await exec(env, 'UPDATE tour_shots SET trashed_at = NULL WHERE version_id = ?', versionId);
  return { ok: true };
}

// ── OPS: ภาพ ────────────────────────────────────────────────
// อัปรูปเข้าจุด × เวอร์ชัน · ถ่ายทับของเดิม = ของเก่าลงถังขยะ 30 วัน (ไม่ลบทิ้ง)
export async function uploadShot(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const versionId = str(p.version_id);
  const pointId = str(p.point_id);
  if (!versionId) throw new Error('version_id required');
  if (!pointId) throw new Error('point_id required');
  if (!p.image_base64) throw new Error('image_base64 required');

  const w = num(p.width);
  const h = num(p.height);
  const guess = guessKind(w, h);
  const kind = str(p.kind) || guess.kind;
  const haov = p.haov != null && p.haov !== '' ? num(p.haov) : guess.haov;
  const vaov = p.vaov != null && p.vaov !== '' ? num(p.vaov) : guess.vaov;

  const shotId = await nextId(env, 'TS', 3);
  const put = await putMedia(env, pid, 'tour/' + versionId, pointId + '.jpg', String(p.image_base64));

  // ของเก่าของคู่ (เวอร์ชัน,จุด) นี้ → ถังขยะ ไม่ใช่ลบ (เผื่อถ่ายใหม่แล้วเบลอกว่าเดิม)
  await exec(env, `UPDATE tour_shots SET trashed_at = ? WHERE version_id = ? AND point_id = ? AND trashed_at IS NULL`,
    nowStr(), versionId, pointId);

  await exec(env,
    `INSERT INTO tour_shots (shot_id, project_id, version_id, point_id, media_key, url, kind, width, height, haov, vaov, yaw_offset, taken_at, uploaded_at, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    shotId, pid, versionId, pointId, put.key, put.url, kind, w, h, haov, vaov,
    num(p.yaw_offset), str(p.taken_at), nowStr(), actorOf(p));

  return { ok: true, shot_id: shotId, url: put.url, kind, haov, vaov };
}

// ปรับค่าภาพหลังอัป (ค่าปรับหมุน / แก้ชนิดที่ระบบเดาผิด)
export async function updateShot(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const shotId = str(p.shot_id);
  if (!shotId) throw new Error('shot_id required');
  const cur = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM tour_shots WHERE shot_id = ?', shotId);
  if (!cur) throw new Error('ไม่พบภาพนี้');
  await exec(env, `UPDATE tour_shots SET yaw_offset = ?, kind = ?, haov = ?, vaov = ? WHERE shot_id = ?`,
    p.yaw_offset != null ? num(p.yaw_offset) : num(cur.yaw_offset),
    str(p.kind) || str(cur.kind),
    p.haov != null && p.haov !== '' ? num(p.haov) : num(cur.haov),
    p.vaov != null && p.vaov !== '' ? num(p.vaov) : num(cur.vaov),
    shotId);
  return { ok: true };
}

export async function deleteShot(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const shotId = str(p.shot_id);
  if (!shotId) throw new Error('shot_id required');
  await exec(env, 'UPDATE tour_shots SET trashed_at = ? WHERE shot_id = ?', nowStr(), shotId);
  return { ok: true };
}

// ── OPS: หมุดคอมเมนต์ ───────────────────────────────────────
export async function savePin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const pointId = str(p.point_id);
  if (!pointId) throw new Error('point_id required');

  const pinId = str(p.pin_id) || (await nextId(env, 'TPN', 3));
  const exists = await queryFirst(env, 'SELECT pin_id FROM tour_pins WHERE pin_id = ?', pinId);
  if (exists) {
    await exec(env, `UPDATE tour_pins SET yaw = ?, pitch = ?, kind = ?, ref_id = ?, text = ? WHERE pin_id = ?`,
      num(p.yaw), num(p.pitch), str(p.kind) || 'note', str(p.ref_id), str(p.text), pinId);
  } else {
    await exec(env,
      `INSERT INTO tour_pins (pin_id, project_id, point_id, version_id, yaw, pitch, kind, ref_id, text, resolved, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      pinId, pid, pointId, str(p.version_id), num(p.yaw), num(p.pitch),
      str(p.kind) || 'note', str(p.ref_id), str(p.text), nowStr(), actorOf(p));
  }
  return { ok: true, pin_id: pinId };
}

export async function deletePin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pinId = str(p.pin_id);
  if (!pinId) throw new Error('pin_id required');
  await exec(env, 'DELETE FROM tour_pins WHERE pin_id = ?', pinId);
  return { ok: true };
}

export async function resolvePin(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pinId = str(p.pin_id);
  if (!pinId) throw new Error('pin_id required');
  const on = p.resolved === true || p.resolved === 'true' || p.resolved === 1 || p.resolved === '1';
  await exec(env, 'UPDATE tour_pins SET resolved = ? WHERE pin_id = ?', on ? 1 : 0, pinId);
  return { ok: true, resolved: on };
}

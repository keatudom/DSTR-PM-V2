// ============================================================
// modules/content.ts — ท่อคอนเทนต์ สถานี 2-4 (คัด / เขียน / เคาะ)
// อ้างอิงกลยุทธ์ DSTR-MKT-2569-002 · เจ้าของงานเคาะ 2026-08-13
//
// หลักที่ยึด (มาจากกลยุทธ์ + ที่เจ้าของงานเคาะเพิ่ม):
//   1. ห้ามเพิ่มงานให้โฟร์แมน — วัตถุดิบมาจาก Daily Log ที่เขาทำอยู่แล้ว
//   2. AI ทำงานเมื่อกดปุ่มเท่านั้น ห้ามรันอัตโนมัติทุกวัน (เปลืองเงิน + สร้างกองงานค้าง)
//   3. ⭐ "รูปไม่ต้องสวยเสมอ" — ไม่มีด่าน AI ตัดรูปไม่สวยทิ้ง
//      รูปรายงานโฟร์แมน = วัตถุดิบใช้ได้เลย · รูปที่ตั้งใจถ่าย = ติดป้าย styled ให้คนเลือกเอง
//   4. ทุกครั้งที่คนกด "รี" เก็บคำสั่งเป็นคู่มือเสียงแบรนด์ แล้วส่งให้ AI อ่านทุกครั้ง
//      (สิ่งที่กดรีคือทรัพย์สินของบริษัท ไม่ใช่ความรำคาญที่ทิ้งไป)
//   5. ไม่ยินยอมใช้ภาพ = ดึงวัตถุดิบไม่ได้เลย (ล็อกที่ต้นทาง ไม่ใช่เตือนตอนจะโพสต์)
//
// actions: get_content_candidates · generate_content · list_content · update_content
//          reroll_content · get_brand_voice · set_photo_consent · content_stats
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { nowStr } from '../lib/time.ts';
import { callGeminiJSON } from '../lib/gemini.ts';
import { getGallery, type GalleryItem } from './gallery.ts';

// ── 5 สไตล์ตามกลยุทธ์ §5 (สัดส่วนคือเป้าหมายรายเดือน ไม่ใช่กฎบังคับรายชิ้น) ──
interface StyleDef { key: string; label: string; audience: string; share: number; brief: string; }
export const STYLES: StyleDef[] = [
  { key: 'behind', label: '🔨 เบื้องหลังงานช่าง', audience: 'เจ้าของบ้าน + ลูกค้าเก่า', share: 40,
    brief: 'เล่าว่าวันนี้หน้างานทำอะไร ด้วยน้ำเสียงคนทำงานจริง ไม่ต้องขาย ไม่ต้องสวยหรู เน้นความจริงและความใส่ใจในรายละเอียด' },
  { key: 'educate', label: '💡 รู้ไว้ก่อนทำบิ้วอิน', audience: 'คนที่ยังไม่พร้อมซื้อ', share: 25,
    brief: 'ให้ความรู้ที่คนกำลังจะทำบิ้วอินอยากรู้ ตอบคำถามที่คนสงสัยจริง เขียนให้คนอยากแชร์ต่อ ห้ามขายของในโพสต์นี้' },
  { key: 'showcase', label: '✨ เห็นแล้วอยากได้', audience: 'เจ้าของบ้าน/ห้องชุด', share: 20,
    brief: 'อวดงานที่เสร็จแล้วให้เห็นภาพความสวย บอกราคาชัดเจนถ้ามีข้อมูล ใส่คำชวนให้ทักมาถาม' },
  { key: 'pro', label: '📐 ช่างคุยกับช่าง', audience: 'สถาปนิก/ผู้รับเหมา', share: 10,
    brief: 'คุยรายละเอียดเชิงเทคนิค การเก็บงาน สเปกวัสดุ/ฮาร์ดแวร์ ด้วยภาษามืออาชีพ ไม่ต้องอธิบายพื้นฐาน' },
  { key: 'developer', label: '📊 ส่งงานตรงเวลา', audience: 'Developer + ดีลใหญ่', share: 5,
    brief: 'เน้นความน่าเชื่อถือ การคุมงาน คุมเวลา ระบบตรวจคุณภาพ พูดด้วยภาษาที่ผู้บริหารโครงการเข้าใจ' },
];
function styleOf(key: string): StyleDef { return STYLES.find((s) => s.key === key) || STYLES[0]; }

const PLATFORM_HINT: Record<string, string> = {
  fb: 'Facebook เพจ — ย่อหน้าสั้น 2-4 บรรทัด อ่านบนมือถือง่าย แฮชแท็ก 3-5 ตัวท้ายโพสต์',
  ig: 'Instagram — ประโยคแรกต้องสะดุดตาเพราะโดนตัด แฮชแท็ก 8-12 ตัว',
  tiktok: 'TikTok — สั้นมาก 1-2 บรรทัด ภาษาพูด แฮชแท็ก 3-5 ตัว',
  line: 'LINE OA ส่งหาลูกค้าเก่า — สุภาพ เป็นกันเอง ไม่ต้องมีแฮชแท็ก ลงท้ายด้วยช่องทางติดต่อ',
};

function cv(v: unknown): boolean { return v === true || v === 'TRUE' || v === 'true'; }

// ── สิทธิ์ใช้ภาพ (กลยุทธ์ §10) ──────────────────────────────
async function consentOf(env: Env, pid: string): Promise<{ ok: boolean; at: string; by: string; name: string }> {
  const row = await queryFirst<Record<string, unknown>>(
    env, 'SELECT name, photo_consent, photo_consent_at, photo_consent_by FROM projects WHERE project_id = ?', pid);
  return {
    ok: cv(row?.photo_consent),
    at: String(row?.photo_consent_at || ''),
    by: String(row?.photo_consent_by || ''),
    name: String(row?.name || pid),
  };
}

export async function setPhotoConsent(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const on = cv(p.consent);
  const actor = (p.__actor as { name?: string } | null)?.name || String(p.updated_by || 'admin');
  await exec(env, 'UPDATE projects SET photo_consent = ?, photo_consent_at = ?, photo_consent_by = ? WHERE project_id = ?',
    on ? 'TRUE' : '', on ? nowStr() : '', on ? actor : '', pid);
  return { ok: true, project_id: pid, consent: on, by: actor };
}

// ── สถานี 2 · คัด — ดึงวัตถุดิบที่ "ยังไม่เคยถูกหยิบ" ────────
// ไม่มี AI ในขั้นนี้ (ประหยัด + เจ้าของงานเคาะว่าไม่ตัดรูปไม่สวยทิ้ง)
// แค่เอาของมาเรียงให้คนเลือก พร้อมบริบทที่ AI จะใช้เขียนต่อ
export async function getContentCandidates(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const consent = await consentOf(env, pid);
  if (!consent.ok) {
    return {
      blocked: true, project_id: pid, project_name: consent.name,
      reason: 'โครงการนี้ยังไม่ได้ติ๊กยินยอมให้ใช้ภาพเพื่อประชาสัมพันธ์ — ต้องติ๊กก่อนถึงจะดึงรูปมาทำคอนเทนต์ได้',
      items: [], counts: {},
    };
  }

  // source: เลือกได้ว่าจะเอาวัตถุดิบจากแหล่งไหน (daily/task = เนื้องานจริง · checkin ส่วนใหญ่
  // เป็นรูปยืนยันตัวคน ใช้ทำ marketing ไม่ค่อยได้) — ไม่ใช่การคัด "รูปสวย" แต่คัดตามชนิดของงาน
  const gal = await getGallery(env, {
    project_id: pid, from: p.from, to: p.to, ff_code: p.ff_code, q: p.q,
    source: p.source || 'all', limit: 500,
  }) as { items: GalleryItem[]; counts: Record<string, number> };

  // ตัดของที่เคยหยิบไปทำแล้วออก (กันคิวเต็มไปด้วยของซ้ำ)
  const used = new Set(
    (await queryAll<{ source_kind: string; source_id: string }>(
      env, 'SELECT source_kind, source_id FROM content_items WHERE project_id = ?', pid))
      .map((r) => r.source_kind + ':' + r.source_id));

  // บริบทของชิ้นงาน — AI ใช้เขียน (ชื่อชิ้นงาน/โซน/ราคา) · ดึงทีเดียวไม่ยิงรายตัว
  const scope = projectScope(pid);
  const ffRows = await queryAll<Record<string, unknown>>(
    env, `SELECT code, name, zone, price, scope_type FROM ff_items WHERE ${scope.sql}`, ...scope.binds);
  const ffMap: Record<string, Record<string, unknown>> = {};
  for (const f of ffRows) ffMap[String(f.code)] = f;

  const items = gal.items
    .filter((it) => !used.has(it.source + ':' + it.ref_id))
    .map((it) => {
      const ff = it.ff_code ? ffMap[it.ff_code] : null;
      return {
        source_kind: it.source, source_id: it.ref_id,
        url: it.url, date: it.date, time: it.time,
        ff_code: it.ff_code,
        ff_name: ff ? String(ff.name || '') : '',
        zone: ff ? String(ff.zone || '') : '',
        raw_text: it.detail || it.title,
        by: it.by,
        // ยังไม่มีวิธีรู้ว่ารูปไหน "ตั้งใจถ่าย" จนกว่าจะมีปุ่มอัปโหลดตั้งใจ (สถานี 1 ทาง B)
        // → ตอนนี้ทุกอย่างจาก Daily Log = report ทั้งหมด ตามที่เจ้าของงานบอกว่าใช้ได้เลย
        shot_intent: 'report',
      };
    });

  return {
    blocked: false, project_id: pid, project_name: consent.name,
    consent_at: consent.at, consent_by: consent.by,
    items, total: items.length, counts: gal.counts,
    already_used: used.size,
  };
}

// ── คู่มือเสียงแบรนด์ ────────────────────────────────────────
export async function getBrandVoice(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const rows = await queryAll<Record<string, unknown>>(
    env, `SELECT * FROM brand_voice WHERE (project_id = ? OR project_id = '') AND active = 'TRUE' ORDER BY hits DESC`, pid);
  return { rules: rows.map((r) => ({ rule_id: r.rule_id, rule: r.rule, style: r.style || '', hits: Number(r.hits) || 1 })) };
}

// เก็บคำสั่งที่คนกด "รี" — ถ้าเคยสั่งแล้วให้บวก hits แทนสร้างใหม่
async function learnRule(env: Env, pid: string, style: string, rule: string, actor: string): Promise<void> {
  const clean = String(rule || '').trim();
  if (!clean || clean.length > 200) return;
  const exist = await queryFirst<{ rule_id: string; hits: number }>(
    env, 'SELECT rule_id, hits FROM brand_voice WHERE project_id = ? AND rule = ?', pid, clean);
  if (exist) { await exec(env, 'UPDATE brand_voice SET hits = ? WHERE rule_id = ?', (Number(exist.hits) || 1) + 1, exist.rule_id); return; }
  const id = await nextId(env, 'BV', 3);
  await exec(env, `INSERT INTO brand_voice (rule_id, project_id, style, rule, hits, active, created_at, created_by)
    VALUES (?, ?, ?, ?, 1, 'TRUE', ?, ?)`, id, pid, style || '', clean, nowStr(), actor);
}

// ── สถานี 3 · เขียน (AI) ────────────────────────────────────
interface WriteInput {
  raw_text: string; ff_code: string; ff_name: string; zone: string;
  date: string; style: string; platform: string;
}
async function writeCaption(env: Env, pid: string, inp: WriteInput): Promise<{ caption: string; hashtags: string }> {
  const st = styleOf(inp.style);
  const bv = await getBrandVoice(env, { project_id: pid }) as { rules: { rule: string; hits: number }[] };
  const rulesText = bv.rules.length
    ? bv.rules.map((r) => '- ' + r.rule + (r.hits > 1 ? ' (ถูกสั่งซ้ำ ' + r.hits + ' ครั้ง = สำคัญมาก)' : '')).join('\n')
    : '(ยังไม่มี — นี่เป็นรอบแรกๆ)';

  const prompt = `คุณคือคนเขียนคอนเทนต์ให้บริษัทรับทำเฟอร์นิเจอร์บิ้วอินชื่อ DESIGNTERIOR (DSTR)

# สไตล์ที่ต้องเขียน: ${st.label}
พูดกับ: ${st.audience}
แนวทาง: ${st.brief}

# ปลายทาง
${PLATFORM_HINT[inp.platform] || PLATFORM_HINT.fb}

# วัตถุดิบจากหน้างานจริง (ห้ามแต่งข้อมูลที่ไม่มีในนี้)
ข้อความที่ช่างบันทึกไว้: "${inp.raw_text}"
ชิ้นงาน: ${inp.ff_code || '(ไม่ระบุ)'} ${inp.ff_name}
โซน/ตำแหน่ง: ${inp.zone || '(ไม่ระบุ)'}
วันที่: ${inp.date}

# คู่มือเสียงแบรนด์ (สะสมจากที่คนในบริษัทเคยสั่งแก้ — สำคัญมาก ต้องทำตาม)
${rulesText}

# กฎเหล็ก
- ภาษาไทย น้ำเสียงเป็นกันเองแบบช่างไทยที่ใส่ใจงาน ไม่ใช่ภาษาโฆษณาเวอร์
- ห้ามใส่ชื่อลูกค้า ที่อยู่ บ้านเลขที่ หรืออะไรที่ระบุตัวลูกค้าได้
- ห้ามแต่งตัวเลข ราคา หรือสเปกที่ไม่ได้ให้มา
- ห้ามสัญญาอะไรแทนบริษัท (เช่น รับประกันกี่ปี ส่งงานกี่วัน) ถ้าไม่มีในวัตถุดิบ
- ถ้าวัตถุดิบสั้นหรือกำกวมมาก ให้เขียนสั้นๆ ตามที่มีจริง อย่าเติมเรื่องเอง

ตอบเป็น JSON: { "caption": "ข้อความโพสต์", "hashtags": "#แท็ก1 #แท็ก2" }`;

  const out = await callGeminiJSON(env, prompt) as { caption?: string; hashtags?: string };
  return { caption: String(out.caption || '').trim(), hashtags: String(out.hashtags || '').trim() };
}

// generate_content — รับวัตถุดิบหลายชิ้น เขียนทีละชิ้น บันทึกเป็น draft
// ⚠️ AI ทำงานเมื่อกดปุ่มเท่านั้น (กลยุทธ์ §3) — ไม่มี cron เรียกตัวนี้
export async function generateContent(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const consent = await consentOf(env, pid);
  if (!consent.ok) throw new Error('โครงการนี้ยังไม่ได้ติ๊กยินยอมให้ใช้ภาพ — ทำคอนเทนต์ไม่ได้');

  const raw = (typeof p.items === 'string' ? JSON.parse(p.items) : p.items) as Record<string, unknown>[] | undefined;
  if (!raw || !raw.length) throw new Error('ยังไม่ได้เลือกวัตถุดิบ');
  if (raw.length > 10) throw new Error('เลือกได้ครั้งละไม่เกิน 10 ชิ้น (กันค่า AI บานปลาย)');

  const style = String(p.style || 'behind');
  const platform = String(p.platform || 'fb');
  const actor = (p.__actor as { name?: string } | null)?.name || String(p.created_by || 'admin');

  const created: Record<string, unknown>[] = [];
  const failed: Record<string, unknown>[] = [];
  for (const it of raw) {
    const sourceKind = String(it.source_kind || 'daily');
    const sourceId = String(it.source_id || '');
    try {
      const w = await writeCaption(env, pid, {
        raw_text: String(it.raw_text || ''), ff_code: String(it.ff_code || ''),
        ff_name: String(it.ff_name || ''), zone: String(it.zone || ''),
        date: String(it.date || ''), style, platform,
      });
      const id = await nextId(env, 'CT', 4);
      await exec(env, `INSERT INTO content_items
        (content_id, project_id, status, style, platform, source_kind, source_id, ff_code, raw_text,
         photo_url, shot_intent, caption, hashtags, reroll_count, notes, scheduled_at, posted_at, posted_by,
         created_at, created_by, updated_at)
        VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, '', '', '', '', ?, ?, ?)`,
        id, pid, style, platform, sourceKind, sourceId, it.ff_code || '', it.raw_text || '',
        it.url || '', it.shot_intent || 'report', w.caption, w.hashtags, nowStr(), actor, nowStr());
      created.push({ content_id: id, caption: w.caption, hashtags: w.hashtags, source_id: sourceId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // ชิ้นเดิมเคยทำไปแล้ว (unique index) — ไม่ใช่ error ที่ต้องตกใจ
      failed.push({ source_id: sourceId, error: msg.indexOf('UNIQUE') >= 0 ? 'วัตถุดิบชิ้นนี้เคยทำคอนเทนต์ไปแล้ว' : msg });
    }
  }
  return { ok: true, created_count: created.length, failed_count: failed.length, created, failed };
}

// ── สถานี 4 · เคาะ ──────────────────────────────────────────
export async function listContent(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const status = String(p.status || '').trim();
  const sql = status
    ? 'SELECT * FROM content_items WHERE project_id = ? AND status = ? ORDER BY created_at DESC LIMIT 300'
    : 'SELECT * FROM content_items WHERE project_id = ? ORDER BY created_at DESC LIMIT 300';
  const rows = status ? await queryAll(env, sql, pid, status) : await queryAll(env, sql, pid);
  return { items: rows, styles: STYLES.map((s) => ({ key: s.key, label: s.label, share: s.share })) };
}

const ALLOWED_STATUS = new Set(['draft', 'approved', 'scheduled', 'posted', 'rejected']);

export async function updateContent(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.content_id || '');
  if (!id) throw new Error('content_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM content_items WHERE content_id = ?', id);
  if (!row) throw new Error('ไม่พบคอนเทนต์: ' + id);

  const actor = (p.__actor as { name?: string } | null)?.name || String(p.updated_by || 'admin');
  const sets: string[] = [];
  const binds: unknown[] = [];
  const put = (col: string, val: unknown) => { sets.push(col + ' = ?'); binds.push(val); };

  if (p.status !== undefined) {
    const st = String(p.status);
    if (!ALLOWED_STATUS.has(st)) throw new Error('สถานะไม่ถูกต้อง: ' + st);
    put('status', st);
    if (st === 'posted') { put('posted_at', nowStr()); put('posted_by', actor); }
  }
  if (p.caption !== undefined) put('caption', String(p.caption));
  if (p.hashtags !== undefined) put('hashtags', String(p.hashtags));
  if (p.platform !== undefined) put('platform', String(p.platform));
  if (p.scheduled_at !== undefined) put('scheduled_at', String(p.scheduled_at));
  if (p.notes !== undefined) put('notes', String(p.notes));
  if (!sets.length) throw new Error('ไม่มีอะไรให้แก้');
  put('updated_at', nowStr());

  binds.push(id);
  await exec(env, 'UPDATE content_items SET ' + sets.join(', ') + ' WHERE content_id = ?', ...binds);

  // ตกงานพร้อมเหตุผล = บทเรียนเหมือนกัน เก็บเข้าคู่มือเสียงแบรนด์ด้วย
  if (String(p.status || '') === 'rejected' && p.notes) {
    await learnRule(env, String(row.project_id || ''), String(row.style || ''), String(p.notes), actor);
  }
  return { ok: true, content_id: id };
}

// reroll — เขียนใหม่พร้อมคำสั่ง แล้วจำคำสั่งนั้นไว้ใช้ครั้งต่อไป
export async function rerollContent(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const id = String(p.content_id || '');
  if (!id) throw new Error('content_id required');
  const row = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM content_items WHERE content_id = ?', id);
  if (!row) throw new Error('ไม่พบคอนเทนต์: ' + id);

  const pid = String(row.project_id || '');
  const note = String(p.note || '').trim();
  const actor = (p.__actor as { name?: string } | null)?.name || String(p.updated_by || 'admin');
  // จำก่อนเขียน — คำสั่งรอบนี้จะถูกใช้ตั้งแต่รอบนี้เลย
  if (note) await learnRule(env, pid, String(row.style || ''), note, actor);

  const w = await writeCaption(env, pid, {
    raw_text: String(row.raw_text || ''), ff_code: String(row.ff_code || ''),
    ff_name: '', zone: '', date: '',
    style: String(p.style || row.style || 'behind'),
    platform: String(p.platform || row.platform || 'fb'),
  });
  await exec(env, `UPDATE content_items SET caption = ?, hashtags = ?, style = ?, reroll_count = ?, notes = ?, updated_at = ?
                   WHERE content_id = ?`,
    w.caption, w.hashtags, String(p.style || row.style || 'behind'),
    (Number(row.reroll_count) || 0) + 1, note, nowStr(), id);
  return { ok: true, content_id: id, caption: w.caption, hashtags: w.hashtags, reroll_count: (Number(row.reroll_count) || 0) + 1 };
}

// ── ถังสำรอง (กลยุทธ์ §6: ห้ามเริ่มปล่อยจนกว่าจะมีของค้างคิว 6 ชิ้น) ──
export async function contentStats(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const rows = await queryAll<{ status: string; n: number }>(
    env, 'SELECT status, COUNT(*) n FROM content_items WHERE project_id = ? GROUP BY status', pid);
  const by: Record<string, number> = { draft: 0, approved: 0, scheduled: 0, posted: 0, rejected: 0 };
  for (const r of rows) by[r.status] = Number(r.n) || 0;

  const buffer = by.approved + by.scheduled;          // ของพร้อมปล่อยที่ค้างคิวอยู่
  const TARGET = 6;                                    // 2 สัปดาห์ × 3 ชิ้น
  const styleRows = await queryAll<{ style: string; n: number }>(
    env, `SELECT style, COUNT(*) n FROM content_items WHERE project_id = ? AND status IN ('approved','scheduled','posted') GROUP BY style`, pid);
  const totalMix = styleRows.reduce((a, b) => a + Number(b.n || 0), 0);

  const consent = await consentOf(env, pid);
  return {
    by_status: by,
    buffer, buffer_target: TARGET,
    ready_to_publish: buffer >= TARGET,
    buffer_note: buffer >= TARGET
      ? 'ถังสำรองพอแล้ว — ปล่อยได้'
      : 'ยังปล่อยไม่ได้ตามกติกา ต้องมีของค้างคิว ' + TARGET + ' ชิ้นก่อน (ตอนนี้ ' + buffer + ')',
    // สัดส่วนจริง vs เป้าหมาย — ไว้เตือนตอนกดเคาะ ไม่ใช่ไปนับตอนสิ้นเดือน
    style_mix: STYLES.map((s) => {
      const n = Number(styleRows.find((r) => r.style === s.key)?.n || 0);
      return { key: s.key, label: s.label, count: n, actual_pct: totalMix ? Math.round((n / totalMix) * 100) : 0, target_pct: s.share };
    }),
    consent: { ok: consent.ok, at: consent.at, by: consent.by },
  };
}

// ============================================================
// modules/line_webhook.ts — port จาก apps-script/line.gs
//   - lineWebhook: รับ POST {destination, events[]} → คำสั่ง /รายงาน* + /link + /help
//   - digests: lineDailyDigest, lineWeeklyDigest, lineOpsDigest (cron + สั่งเอง)
//   ⛔ gated: ต้องมี LINE_TOKEN + GEMINI_API_KEY (secrets) + cron ใน wrangler.toml
//
// ★ ต่างจากเดิม: CF secret เป็น immutable → คำสั่ง /link เก็บ group id ถาวรไม่ได้
//   (เดิม setProperty). เจ้าของงานตั้ง LINE_GROUP_ID/OPS_ID/OWNER_UID ผ่าน wrangler secret แทน
//   (ดู S2-HANDOFF). digest ที่ "สั่งเองในกลุ่ม" ยังส่งกลับกลุ่มที่พิมพ์ได้ผ่าน groupId
// ============================================================
import type { Env } from '../lib/env.ts';
import { queryAll } from '../lib/db.ts';
import { todayStr } from '../lib/time.ts';
import { callGemini } from '../lib/gemini.ts';
import { linePush, type CtxLike } from '../lib/line.ts';

const LINE_WEB_BASE = 'https://keatudom.github.io/DSTR-PM-V2';

async function lineReply(env: Env, replyToken: string, text: string): Promise<void> {
  const token = env.LINE_TOKEN || '';
  if (!token || !replyToken) return;
  try {
    await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
    });
  } catch { /* ignore */ }
}
function thaiDate(ymd: string): string {
  try { const m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.']; const p = String(ymd).split('-'); if (p.length === 3) return parseInt(p[2], 10) + ' ' + m[parseInt(p[1], 10) - 1] + ' ' + (parseInt(p[0], 10) + 543); } catch { /* */ }
  return ymd;
}
async function aiNarrative(env: Env, prompt: string): Promise<string> {
  for (let i = 0; i < 5; i++) {
    try { const t = String((await callGemini(env, prompt)) || '').trim(); if (t) return t; }
    catch (e) { const msg = String((e instanceof Error && e.message) || e); if (i < 4 && /(50\d|429|overload|server error|rate|unavailable)/i.test(msg)) { await new Promise((r) => setTimeout(r, Math.min(1500 * (i + 1), 4000))); continue; } return ''; }
  }
  return '';
}
function countByText(rows: Record<string, unknown>[]): { task: number; withdraw: number; receive: number; count: number; daily: number; contract: number; risk: number } {
  const c = { task: 0, withdraw: 0, receive: 0, count: 0, daily: 0, contract: 0, risk: 0 };
  for (const r of rows) {
    const t = String(r.text || '');
    if (t.indexOf('เสร็จ') >= 0 || t.indexOf('✓') >= 0) c.task++;
    else if (t.indexOf('เบิก') >= 0) c.withdraw++;
    else if (t.indexOf('รับ') >= 0 && t.indexOf('รับเงิน') < 0) c.receive++;
    else if (t.indexOf('นับ') >= 0) c.count++;
    else if (t.indexOf('รายงาน') >= 0) c.daily++;
    else if (t.indexOf('สัญญา') >= 0 || t.indexOf('งวด') >= 0) c.contract++;
    else if (t.indexOf('เสี่ยง') >= 0) c.risk++;
  }
  return c;
}

// ── project scope ของรายงาน (2026-08-29) ─────────────────────
// เดิม digest ทั้ง 3 ตัวดึงทั้งตารางโดยไม่กรองโครงการ และไม่ติดป้ายชื่อบ้าน
//   → วันที่มีบ้าน 2 หลังพร้อมกัน รายงานจะเอางานมากองรวมกัน อ่านไม่ออกว่าอันไหนบ้านไหน
// ตอนนี้: จัดกลุ่มตามโครงการแล้วติดหัวข้อชื่อบ้าน
//   ⚠️ ถ้ามีโครงการเดียวที่มีความเคลื่อนไหว → หน้าตาข้อความเหมือนเดิมเป๊ะ (ไม่ให้ทีมงง)
const PROJECT_HEADER = (name: string): string => '━━ 🏠 ' + name + ' ━━';

// แถว legacy ที่ project_id ว่าง ถือเป็น bow-house (ธรรมเนียมเดียวกับ projectScope ใน lib/db)
function rowPid(r: Record<string, unknown>): string {
  return String(r.project_id ?? '').trim() || 'bow-house';
}

export function groupByProject<T extends Record<string, unknown>>(rows: T[]): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[rowPid(r)] ||= []).push(r);
  return out;
}

async function projectNames(env: Env): Promise<Record<string, string>> {
  const map: Record<string, string> = {};
  try {
    const rows = await queryAll<{ project_id: string; name: string }>(env, 'SELECT project_id, name FROM projects');
    for (const r of rows) {
      const id = String(r.project_id || '').trim();
      if (id) map[id] = String(r.name || '').trim() || id;
    }
  } catch { /* ไม่มีชื่อก็ใช้ id แทน */ }
  return map;
}

// รายชื่อโครงการที่มีความเคลื่อนไหว เรียงตามจำนวนกิจกรรม (มากก่อน)
export function activeProjectIds(groups: Record<string, unknown[]>[]): string[] {
  const score: Record<string, number> = {};
  for (const g of groups) {
    for (const pid of Object.keys(g)) score[pid] = (score[pid] || 0) + g[pid].length;
  }
  return Object.keys(score).sort((a, b) => score[b] - score[a]);
}

// ── DAILY DIGEST (line.gs:188) ──
export async function lineDailyDigest(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const gid = (p.to as string) || env.LINE_GROUP_ID || '';
  if (!gid) return { ok: false, reason: 'no group' };
  const day = p.date ? String(p.date) : todayStr();

  let allRows: Record<string, unknown>[] = [];
  try { allRows = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM activity_logs')).filter((r) => String(r.date || '').slice(0, 10) === day); } catch { /* */ }
  let allReports: Record<string, unknown>[] = [];
  try { allReports = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM daily_reports')).filter((r) => String(r.date || '').slice(0, 10) === day); } catch { /* */ }

  const rowsBy = groupByProject(allRows);
  const reportsBy = groupByProject(allReports);
  const names = await projectNames(env);
  let pids = activeProjectIds([rowsBy, reportsBy]);
  if (!pids.length) pids = ['bow-house'];          // ไม่มีอะไรเลย → รายงานว่างแบบเดิม
  const multi = pids.length > 1;

  const lines = ['📊 สรุปประจำวัน ' + thaiDate(day)];
  for (const pid of pids.slice(0, 8)) {
    const rows = rowsBy[pid] || [];
    const reports = reportsBy[pid] || [];
    const c = countByText(rows);

    let narrative = '';
    if (reports.length || rows.length) {
      let material = '';
      for (const r of reports) material += '- ผู้รายงาน ' + (r.reporter_name || '-') + ' | อากาศ ' + (r.weather || '-') + ' | คนงาน ' + (r.workers_count || 0) + '\n  งานที่ทำ: ' + (r.tasks_done || r.summary_text || '-') + (r.issues ? '\n  ปัญหา: ' + r.issues : '') + '\n';
      const actLines = rows.slice(0, 20).map((r) => '- ' + String(r.text || '')).join('\n');
      const prompt = 'คุณคือผู้ช่วยเขียนสรุปงานเฟอร์นิเจอร์บิ้วอินประจำวัน เขียนเป็น "บทความสั้น" 3-5 ประโยค ภาษาไทยกระชับ เป็นกันเอง อ่านลื่น เหมาะส่งในกลุ่ม LINE ทีม สรุปจากข้อมูลจริงด้านล่างเท่านั้น ห้ามแต่งเติม เขียนเฉพาะเนื้อบทความ ห้ามมีหัวข้อ/bullet/อิโมจิเยอะ\n\n[โครงการ]\n' + (names[pid] || pid) + '\n\n[รายงานประจำวันหน้างาน]\n' + (material || '(ไม่มีรายงานวันนี้)') + '\n\n[กิจกรรมในระบบวันนี้]\n' + (actLines || '(ไม่มี)') + '\n\nบทความสรุป:';
      narrative = await aiNarrative(env, prompt);
    }

    if (multi) lines.push('', PROJECT_HEADER(names[pid] || pid));
    if (narrative) { lines.push(''); lines.push(narrative); } else if (rows.length) { lines.push(''); lines.push('⚠️ (AI สรุปไม่พร้อมชั่วคราว — แสดงเฉพาะตัวเลข)'); }

    const ov: string[] = [];
    if (c.task) ov.push('✅ ติ๊กงาน ' + c.task);
    if (c.withdraw || c.receive) ov.push('📦 เบิก ' + c.withdraw + '/รับ ' + c.receive);
    if (c.contract) ov.push('🧾 สัญญา/งวด ' + c.contract);
    if (c.daily) ov.push('📝 รายงาน ' + c.daily);
    if (c.risk) ov.push('⚠️ เสี่ยง ' + c.risk);
    lines.push('', '— ภาพรวม —', ov.length ? ov.join(' · ') : 'วันนี้ยังไม่มีกิจกรรมบันทึก', 'รวม ' + rows.length + ' รายการ');

    const withdrawals = rows.filter((r) => String(r.text || '').indexOf('เบิก') >= 0).map((r) => String(r.text || '').replace(/^[📤🔧\s]+/, '').trim());
    if (withdrawals.length) { lines.push('', '— 📤 เบิกวัสดุวันนี้ (' + withdrawals.length + ') —'); withdrawals.slice(0, 15).forEach((w) => lines.push('• ' + w)); if (withdrawals.length > 15) lines.push('… และอีก ' + (withdrawals.length - 15) + ' รายการ'); }
  }
  if (pids.length > 8) lines.push('', '… และอีก ' + (pids.length - 8) + ' โครงการ');

  lines.push('', '🔗 ดูรายงานเต็ม: ' + LINE_WEB_BASE + '/daily.html');
  linePush(env, gid, lines.join('\n'), p.__ctx as CtxLike | undefined);
  return { ok: true, total: allRows.length, projects: pids.length, reports: allReports.length };
}

// ── WEEKLY DIGEST (line.gs:323) ──
export async function lineWeeklyDigest(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const gid = (p.to as string) || env.LINE_GROUP_ID || '';
  if (!gid) return { ok: false, reason: 'no group' };
  const sinceMs = Date.now() - 7 * 86400000;
  const sinceStr = new Date(sinceMs).toISOString().slice(0, 10);

  let allRows: Record<string, unknown>[] = [];
  try { allRows = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM activity_logs')).filter((r) => { const t = Date.parse(String(r.timestamp || '')); return t && t >= sinceMs; }); } catch { /* */ }
  let allReports: Record<string, unknown>[] = [];
  try { allReports = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM daily_reports')).filter((r) => (String(r.date || '').slice(0, 10)) >= sinceStr); } catch { /* */ }

  const rowsBy = groupByProject(allRows);
  const reportsBy = groupByProject(allReports);
  const names = await projectNames(env);
  let pids = activeProjectIds([rowsBy, reportsBy]);
  if (!pids.length) pids = ['bow-house'];
  const multi = pids.length > 1;

  const lines = ['📅 สรุปรายสัปดาห์ (' + thaiDate(sinceStr) + ' – ' + thaiDate(todayStr()) + ')'];
  for (const pid of pids.slice(0, 8)) {
    const rows = rowsBy[pid] || [];
    const reports = reportsBy[pid] || [];
    const c = countByText(rows);

    let narrative = '';
    if (reports.length || rows.length) {
      let material = '';
      for (const r of reports) material += '- ' + String(r.date || '').slice(0, 10) + ' โดย ' + (r.reporter_name || '-') + ': ' + (r.tasks_done || r.summary_text || '-') + (r.issues ? ' | ปัญหา: ' + r.issues : '') + '\n';
      const prompt = 'คุณคือผู้ช่วยเขียนสรุป "ภาพรวมรายสัปดาห์" ของงานเฟอร์นิเจอร์บิ้วอิน เขียนเป็นบทความ 4-6 ประโยค ภาษาไทยกระชับ เป็นกันเอง สรุปความคืบหน้า งานเด่น และปัญหาของสัปดาห์ จากข้อมูลจริงด้านล่างเท่านั้น ห้ามแต่งเติม ไม่ต้องมีหัวข้อ/bullet\n\n[โครงการ]\n' + (names[pid] || pid) + '\n\n[รายงานประจำวันในสัปดาห์]\n' + (material || '(ไม่มี)') + '\n\n[สรุปกิจกรรม] ติ๊กงานเสร็จ ' + c.task + ' · เบิกของ ' + c.withdraw + ' · รับของ ' + c.receive + ' · สัญญา/งวด ' + c.contract + ' · ความเสี่ยง ' + c.risk + '\n\nบทความสรุปสัปดาห์:';
      narrative = await aiNarrative(env, prompt);
    }

    if (multi) lines.push('', PROJECT_HEADER(names[pid] || pid));
    if (narrative) { lines.push(''); lines.push(narrative); } else if (rows.length) { lines.push(''); lines.push('⚠️ (AI สรุปไม่พร้อมชั่วคราว — แสดงเฉพาะตัวเลข)'); }

    const ov: string[] = [];
    if (c.task) ov.push('✅ ติ๊กงาน ' + c.task);
    if (c.withdraw || c.receive) ov.push('📦 เบิก ' + c.withdraw + '/รับ ' + c.receive);
    if (c.contract) ov.push('🧾 สัญญา/งวด ' + c.contract);
    if (c.daily) ov.push('📝 รายงาน ' + c.daily);
    if (c.risk) ov.push('⚠️ เสี่ยง ' + c.risk);
    lines.push('', '— ภาพรวมสัปดาห์ —', ov.length ? ov.join(' · ') : 'สัปดาห์นี้ยังไม่มีกิจกรรมบันทึก', 'รวม ' + rows.length + ' รายการ');
  }
  if (pids.length > 8) lines.push('', '… และอีก ' + (pids.length - 8) + ' โครงการ');

  lines.push('', '🔗 ดูรายละเอียด: ' + LINE_WEB_BASE + '/dashboard.html');
  linePush(env, gid, lines.join('\n'), p.__ctx as CtxLike | undefined);
  return { ok: true, total: allRows.length, projects: pids.length, reports: allReports.length };
}

// ── OPS DIGEST (line.gs:402) ──
export async function lineOpsDigest(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const gops = (p.to as string) || env.LINE_GROUP_OPS_ID || '';
  if (!gops) return { ok: false, reason: 'no ops group' };
  const hours = Number(p.hours || 3);
  const since = Date.now() - hours * 3600000;
  let allRows: Record<string, unknown>[] = [];
  try { allRows = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM activity_logs')).filter((r) => { const t = Date.parse(String(r.timestamp || '')); return t && t >= since; }); } catch { /* */ }
  if (!allRows.length) {
    if (p.to) { linePush(env, gops, '🕒 ช่วง ' + hours + ' ชม.ล่าสุด ยังไม่มีกิจกรรมบันทึก', p.__ctx as CtxLike | undefined); return { ok: true, empty: true }; }
    return { ok: true, skipped: 'no activity in last ' + hours + 'h' };
  }

  const rowsBy = groupByProject(allRows);
  const names = await projectNames(env);
  const pids = activeProjectIds([rowsBy]);
  const multi = pids.length > 1;

  const lines = ['🕒 อัปเดตหน้างาน (' + hours + ' ชม.ล่าสุด)'];
  // โควตา 25 บรรทัดเท่าเดิม แบ่งให้ทุกโครงการอย่างน้อย 5 บรรทัด
  const perProject = multi ? Math.max(5, Math.floor(25 / pids.length)) : 25;
  for (const pid of pids.slice(0, 8)) {
    const rows = rowsBy[pid] || [];
    if (multi) lines.push('', PROJECT_HEADER(names[pid] || pid));
    rows.slice(-perProject).forEach((r) => lines.push('• ' + String(r.text || '').replace(/^[📤🔧\s]+/, '').trim()));
    if (rows.length > perProject) lines.push('… และอีก ' + (rows.length - perProject) + ' รายการ');
  }
  if (pids.length > 8) lines.push('', '… และอีก ' + (pids.length - 8) + ' โครงการ');

  lines.push('', '🔗 ดูเต็ม: ' + LINE_WEB_BASE + '/dashboard.html');
  linePush(env, gops, lines.join('\n'), p.__ctx as CtxLike | undefined);
  return { ok: true, total: allRows.length, projects: pids.length };
}

// ── WEBHOOK (line.gs:88) — คำสั่งในกลุ่ม ──
export async function lineWebhook(env: Env, body: Record<string, unknown>, ctx?: CtxLike): Promise<void> {
  const events = (body && (body.events as Record<string, unknown>[])) || [];
  for (const ev of events) {
    const src = (ev.source as Record<string, unknown>) || {};
    if (src.type === 'group' && src.groupId) {
      const gid = String(src.groupId);
      const message = ev.message as { type?: string; text?: string } | undefined;
      const msgText = ev.type === 'message' && message && message.type === 'text' ? String(message.text || '').trim() : '';
      const mt = msgText.toLowerCase();
      const cmd = msgText.replace(/\s+/g, '');
      const dc = ev.deliveryContext as { isRedelivery?: boolean } | undefined;
      const isRedeliv = !!(dc && dc.isRedelivery);
      const replyToken = ev.replyToken as string | undefined;
      const forward = { __ctx: ctx } as Record<string, unknown>;
      if (!isRedeliv && (cmd === '/รายงานประจำวัน' || cmd === '/รายงานวันนี้' || mt === '/daily')) {
        if (replyToken) await lineReply(env, replyToken, '⏳ กำลังสร้างรายงานประจำวัน…');
        await lineDailyDigest(env, { ...forward, to: gid });
      } else if (!isRedeliv && (cmd === '/รายงาน3ชม' || cmd === '/รายงาน3ชั่วโมง' || cmd === '/รายงานหน้างาน' || mt === '/ops')) {
        await lineOpsDigest(env, { ...forward, to: gid, hours: 3 });
      } else if (!isRedeliv && (cmd === '/รายงานสัปดาห์นี้' || cmd === '/รายงานสัปดาห์' || cmd === '/รายงานอาทิตย์นี้' || mt === '/weekly')) {
        if (replyToken) await lineReply(env, replyToken, '⏳ กำลังสร้างรายงานสัปดาห์…');
        await lineWeeklyDigest(env, { ...forward, to: gid });
      } else if (cmd === '/help' || cmd === '/คำสั่ง' || cmd === '/ช่วยเหลือ' || mt === '/help') {
        if (replyToken) await lineReply(env, replyToken, '📋 คำสั่ง DSTR\n📊 /รายงานประจำวัน — สรุปวันนี้\n📅 /รายงานสัปดาห์นี้ — ภาพรวม 7 วัน\n🕒 /รายงาน 3 ชั่วโมง — กิจกรรมล่าสุด');
      } else if (mt === '/link' || mt === '/link ops' || msgText === 'เชื่อมกลุ่ม') {
        // ⚠️ CF secret immutable → เก็บ group id ถาวรไม่ได้ (เดิม setProperty) — บอกให้ตั้งผ่าน wrangler secret
        if (replyToken) await lineReply(env, replyToken, 'ℹ️ group id ของกลุ่มนี้: ' + gid + '\nตั้งเป็น LINE_GROUP_ID/LINE_GROUP_OPS_ID ผ่าน wrangler secret (ดู S2-HANDOFF)');
      }
    } else if (src.type === 'user' && src.userId) {
      const replyToken = ev.replyToken as string | undefined;
      if (replyToken) await lineReply(env, replyToken, 'ℹ️ user id ของคุณ: ' + String(src.userId) + '\nตั้งเป็น LINE_OWNER_UID ผ่าน wrangler secret');
    }
  }
}

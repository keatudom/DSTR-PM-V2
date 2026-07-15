// ============================================================
// modules/daily.ts — port จาก Code.js (§DAILY/ACTIVITY/AI)
// 21 actions: get_daily_reports, get_daily_report, create_daily, auto_detect_daily,
//   generate_daily_summary, delete_daily, add_quick_log, ai_summary, add_activity_log,
//   get_activity_feed, get_material_transactions, delete_activity_log, untick_task_from_log,
//   generate_daily_summary_v2, save_ai_summary, get_saved_summary, parse_activity_text,
//   suggest_task_from_log, confirm_task_tick, get_today_stats, get_daily_bundle
//
// ★ Gemini actions (generate_daily_summary*, ai_summary, parse_activity_text,
//   suggest_task_from_log) ต้องมี GEMINI_API_KEY (secret) จึงทดสอบสด
// ============================================================
import type { Env } from '../lib/env.ts';
import type { TokenPayload } from '../lib/auth.ts';
import { queryAll, queryFirst, exec, pidOf, projectScope, fmtDate, blankNulls } from '../lib/db.ts';
import { nextId } from '../lib/ids.ts';
import { todayStr, nowStr } from '../lib/time.ts';
import { autoLog, appendActivityLog } from '../lib/activity.ts';
import { lineNotifyImportant, ctxOf } from '../lib/line.ts';
import { callGemini, callGeminiJSON } from '../lib/gemini.ts';
import { getFFList } from './ff_tasks.ts';
import { getTeams } from './teams_finance.ts';

function actorOf(p: Record<string, unknown>): TokenPayload | null { return (p.__actor as TokenPayload | null) ?? null; }

// ── DAILY REPORTS ──
export async function getDailyReports(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const scope = projectScope(pidOf(p));
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM daily_reports WHERE ${scope.sql}`, ...scope.binds);
  return rows.map(blankNulls);
}

export async function getDailyReport(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const scope = projectScope(pidOf(p));
  const rows = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM daily_reports WHERE ${scope.sql}`, ...scope.binds)).map(blankNulls);
  if (p.id) return rows.find((r) => r.id === p.id) || null;
  if (p.date) {
    if (p.reporter_name) return rows.find((r) => r.date === p.date && r.reporter_name === p.reporter_name) || null;
    return rows.filter((r) => r.date === p.date);
  }
  return rows;
}

export async function createDaily(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const date = (p.date as string) || todayStr();
  const reporter = (p.reporter_name as string) || '';
  const existing = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM daily_reports WHERE date = ? AND reporter_name = ?', date, reporter);
  if (existing) {
    const updates = {
      reporter_role: p.reporter_role || existing.reporter_role,
      weather: p.weather || existing.weather,
      tasks_done: p.tasks_done || existing.tasks_done,
      workers_count: p.workers_count || existing.workers_count,
      workers_list: p.workers_list || existing.workers_list,
      issues: p.issues !== undefined ? p.issues : existing.issues,
      summary_text: p.summary_text !== undefined ? p.summary_text : existing.summary_text,
      updated_at: nowStr(),
    };
    await exec(env, `UPDATE daily_reports SET reporter_role=?, weather=?, tasks_done=?, workers_count=?, workers_list=?, issues=?, summary_text=?, updated_at=? WHERE id=?`,
      updates.reporter_role, updates.weather, updates.tasks_done, updates.workers_count, updates.workers_list, updates.issues, updates.summary_text, updates.updated_at, existing.id);
    return { ...blankNulls(existing), ...updates };
  }
  const id = await nextId(env, 'DR', 3);
  const row: Record<string, unknown> = {
    id, project_id: pid, date, reporter_name: reporter, reporter_role: p.reporter_role || 'FOREMAN',
    weather: p.weather || '', tasks_done: p.tasks_done || '', workers_count: p.workers_count || 0,
    workers_list: p.workers_list || '', issues: p.issues || '', summary_text: p.summary_text || '',
    ai_processed: false, created_at: nowStr(), updated_at: nowStr(),
  };
  await exec(env,
    `INSERT INTO daily_reports (id, project_id, date, reporter_name, reporter_role, weather, tasks_done, workers_count, workers_list, issues, summary_text, ai_processed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'FALSE', ?, ?)`,
    id, pid, date, reporter, row.reporter_role, row.weather, row.tasks_done, row.workers_count, row.workers_list, row.issues, row.summary_text, row.created_at, row.updated_at);
  const dMsg = '📝 รายงานประจำวัน (' + date + ') โดย ' + reporter;
  await autoLog(env, dMsg, { meta: { kind: 'daily', daily_id: id }, date, actor: actorOf(p) });
  try { lineNotifyImportant(env, dMsg, ctxOf(p)); } catch { /* ignore */ }
  return row;
}

export async function deleteDaily(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.id) throw new Error('id required');
  const res = await exec(env, 'DELETE FROM daily_reports WHERE id = ?', p.id);
  if ((res.meta?.changes ?? 0) < 1) throw new Error('Report not found: ' + p.id);
  return { deleted: p.id };
}

// ── QUICK LOG ──
export async function addQuickLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const id = await nextId(env, 'QL', 3);
  const ts = nowStr();
  const row: Record<string, unknown> = {
    id, report_id: p.report_id, timestamp: ts, text: p.text || '',
    photos: p.photos || '', tagged_ff: p.tagged_ff || '', tagged_contractor: p.tagged_contractor || '',
  };
  // D1 quick_logs = id, project_id, date, text, created_at (report_id/photos/tagged_* ไม่มีคอลัมน์)
  await exec(env, 'INSERT INTO quick_logs (id, project_id, date, text, created_at) VALUES (?, ?, ?, ?, ?)', id, pid, todayStr(), row.text, ts);
  return row;
}

// ── auto_detect_daily ──
export async function autoDetectDaily(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const date = (p.date as string) || todayStr();
  const tasks = (await queryAll<Record<string, unknown>>(env, "SELECT * FROM tasks WHERE done_date = ? AND status = 'Done'", date));
  const tasksDone = tasks.map((t) => ({ task_id: t.id, ff_code: t.ff_code, name: t.name, phase: t.phase }));
  let transactions: Record<string, unknown>[] = [];
  try {
    const tRows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM material_transactions WHERE date = ?', date);
    transactions = tRows.map((t) => ({ type: t.type, material_id: t.material_id, quantity: t.quantity, contractor_id: t.contractor_id || '', ff_code: t.ff_code || '', notes: t.notes || '' }));
  } catch { /* ignore */ }
  let quickLogs: { time: unknown; text: unknown }[] = [];
  try {
    const qRows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM quick_logs');
    quickLogs = qRows.filter((q) => String(q.created_at || '').slice(0, 10) === date).map((q) => ({ time: q.created_at, text: q.text }));
  } catch { /* ignore */ }
  const contractorIds = [...new Set(transactions.map((t) => t.contractor_id).filter((c) => c))];
  const allContractors = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors');
  const workers = contractorIds.map((cid) => { const c = allContractors.find((x) => x.id === cid); return c ? { id: c.id, name: c.name, role: c.role } : null; }).filter(Boolean);
  return { date, tasks_done: tasksDone, tasks_count: tasksDone.length, transactions, transactions_count: transactions.length, quick_logs: quickLogs, workers_detected: workers, workers_count: workers.length };
}

export async function generateDailySummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const detected = await autoDetectDaily(env, { date: p.date, project_id: p.project_id }) as { date: string; tasks_done: { ff_code: unknown; name: unknown }[]; transactions: Record<string, unknown>[]; workers_detected: { name: unknown }[]; quick_logs: { text: unknown }[] };
  let context = `วันที่: ${detected.date}\n\n`;
  if (detected.tasks_done.length > 0) { context += 'งานที่เสร็จวันนี้:\n'; for (const t of detected.tasks_done) context += `- ${t.ff_code}: ${t.name}\n`; context += '\n'; }
  if (detected.transactions.length > 0) { context += 'กิจกรรมวัสดุ:\n'; for (const t of detected.transactions) { let line = `- ${t.type}: ${t.material_id} จำนวน ${t.quantity}`; if (t.ff_code) line += ` (${t.ff_code})`; if (t.contractor_id) line += ` โดย ${t.contractor_id}`; context += line + '\n'; } context += '\n'; }
  if (detected.workers_detected.length > 0) context += `ช่างที่ทำงาน: ${detected.workers_detected.map((w) => w.name).join(', ')}\n\n`;
  if (detected.quick_logs.length > 0) { context += 'บันทึกเพิ่มเติม:\n'; for (const q of detected.quick_logs) context += `- ${q.text}\n`; context += '\n'; }
  if (context.length < 100) return { summary: 'ยังไม่มีกิจกรรมในวันนี้', details: detected };
  const prompt = `คุณคือผู้ช่วยสรุปรายงานหน้างานก่อสร้าง สรุปข้อมูลด้านล่างเป็นภาษาไทยกระชับ 2-3 บรรทัด\n\nเน้น:\n- ความคืบหน้าของวัน (FF ไหนทำอะไร)\n- การใช้/รับวัสดุที่สำคัญ\n- ปัญหาที่ต้องระวัง (เช่น วัสดุใกล้หมด, งานล่าช้า)\n\nห้าม: ใส่หัวข้อ, bullet, markdown — เขียนเป็นย่อหน้าธรรมดา\n\nข้อมูล:\n${context}`;
  let summary = '';
  try { summary = await callGemini(env, prompt); } catch (err) { summary = 'ไม่สามารถสร้างสรุป AI ได้ (' + (err instanceof Error ? err.message : String(err)) + ')'; }
  return { summary, details: detected };
}

export async function aiSummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const reportId = p.report_id;
  // ⚠️ deviation: ต้นฉบับ filter quick_logs ด้วย report_id แต่ seed ตัดคอลัมน์ report_id ทิ้ง
  //    (quick_logs เป็น transient ~3 แถว) → ที่นี่ใช้ quick_logs ทั้งหมด (ดู S2-HANDOFF)
  const filtered = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM quick_logs');
  if (filtered.length === 0) throw new Error('No logs for report ' + reportId);
  const text = filtered.map((l) => '- [' + l.created_at + '] ' + l.text).join('\n');
  const prompt = 'สรุปบันทึกหน้างานต่อไปนี้ให้กระชับ เน้นความคืบหน้าและปัญหา:\n\n' + text;
  const summary = await callGemini(env, prompt);
  await exec(env, "UPDATE daily_reports SET summary_text=?, ai_processed='TRUE', updated_at=? WHERE id=?", summary, nowStr(), reportId);
  return { report_id: reportId, summary };
}

// ── ACTIVITY ──
function parseTagsList(v: unknown): string[] {
  if (Array.isArray(v)) return v as string[];
  if (typeof v === 'string' && v) return v.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}
function mergeUnique(a: string[], b: string[]): string[] {
  const set = new Set<string>();
  for (const x of a || []) if (x) set.add(String(x).trim());
  for (const x of b || []) if (x) set.add(String(x).trim());
  return Array.from(set);
}

export async function addActivityLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.text || !String(p.text).trim()) throw new Error('text required');
  let tags_ff = parseTagsList(p.tags_ff);
  let tags_ctr = parseTagsList(p.tags_ctr);
  let tags_issue = parseTagsList(p.tags_issue);
  const tags_team = parseTagsList(p.tags_team);
  let tags_phase = (p.tags_phase as string) || '';
  let aiInfo: Record<string, unknown> | null = null;
  const wantsAutoTag = p.auto_tag !== false && p.auto_tag !== 'false';
  if (wantsAutoTag) {
    try {
      aiInfo = await parseActivityText(env, { text: p.text, project_id: p.project_id }) as Record<string, unknown>;
      if (aiInfo) {
        tags_ff = mergeUnique(tags_ff, (aiInfo.tags_ff as string[]) || []);
        tags_ctr = mergeUnique(tags_ctr, (aiInfo.tags_ctr as string[]) || []);
        tags_issue = mergeUnique(tags_issue, (aiInfo.tags_issue as string[]) || []);
        if (!tags_phase) tags_phase = (aiInfo.tags_phase as string) || '';
      }
    } catch { /* AI fail → save without auto-tags */ }
  }
  const logged = await appendActivityLog(env, {
    type: 'manual', source: (p.source as string) || 'admin', text: p.text as string,
    tags_ff, tags_ctr, tags_issue, tags_phase, photo_url: (p.photo_url as string) || '',
    date: p.date as string, meta: { ai: aiInfo, tags_team }, actor: actorOf(p), project_id: pidOf(p),
  });
  return { log: logged, ai_info: aiInfo, tags_team };
}

interface FeedItem { log_id: unknown; date: string; timestamp: string; type: unknown; source: unknown; text: unknown; tags_ff: string[]; tags_ctr: string[]; tags_issue: string[]; tags_phase: unknown; photo_url: unknown; tags_team: unknown[]; meta: Record<string, unknown>; }
export async function getActivityFeed(env: Env, p: Record<string, unknown>): Promise<FeedItem[]> {
  const date = (p.date as string) || todayStr();
  const includeAuto = p.include_auto !== false && p.include_auto !== 'false';
  const limit = Number(p.limit || 200);
  const scope = projectScope(pidOf(p));
  const rows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM activity_logs WHERE ${scope.sql}`, ...scope.binds);
  const out: FeedItem[] = [];
  // ใหม่→เก่า: iterate ท้าย→หน้า (rowid order) — ต้นฉบับเดินจากล่างขึ้น
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    const rowDate = String(r.date || '').slice(0, 10);
    if (rowDate !== date) continue;
    if (!includeAuto && r.type === 'auto') continue;
    let meta: Record<string, unknown> = {};
    try { meta = JSON.parse(String(r.meta_json || '{}')); } catch { /* ignore */ }
    out.push({
      log_id: r.log_id, date: rowDate, timestamp: String(r.timestamp || ''), type: r.type, source: r.source, text: r.text,
      tags_ff: String(r.tags_ff || '').split(',').filter(Boolean), tags_ctr: String(r.tags_ctr || '').split(',').filter(Boolean),
      tags_issue: String(r.tags_issue || '').split(',').filter(Boolean), tags_phase: r.tags_phase || '', photo_url: r.photo_url || '',
      tags_team: Array.isArray(meta.tags_team) ? meta.tags_team : [], meta,
    });
    if (out.length >= limit) break;
  }
  out.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
  return out;
}

export async function deleteActivityLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const logId = p.log_id;
  if (!logId) throw new Error('log_id required');
  const res = await exec(env, 'DELETE FROM activity_logs WHERE log_id = ?', logId);
  if ((res.meta?.changes ?? 0) < 1) throw new Error('Log not found: ' + logId);
  return { deleted: logId };
}

export async function untickTaskFromLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.task_id) throw new Error('task_id required');
  const task = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM tasks WHERE id = ?', p.task_id);
  if (!task) throw new Error('ไม่พบ task: ' + p.task_id);
  await exec(env, "UPDATE tasks SET status='Not Started', done_date='' WHERE id = ?", p.task_id);
  if (p.log_id) { try { await exec(env, 'DELETE FROM activity_logs WHERE log_id = ?', p.log_id); } catch { /* ignore */ } }
  try {
    await autoLog(env, '🔄 ยกเลิกติ๊ก: ' + task.name + ' (' + task.ff_code + ')', { type: 'auto', tags_ff: [String(task.ff_code)], meta: { task_id: p.task_id, event: 'task_undo' }, actor: actorOf(p), project_id: pidOf(p) });
  } catch { /* ignore */ }
  return { ok: true, task_id: p.task_id, task_name: task.name };
}

export async function confirmTaskTick(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.task_id) throw new Error('task_id required');
  const task = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM tasks WHERE id = ?', p.task_id);
  if (!task) throw new Error('ไม่พบ task: ' + p.task_id);
  const doneDate = (p.done_date as string) || todayStr();
  await exec(env, 'UPDATE tasks SET status=?, done_date=? WHERE id=?', 'Done', doneDate, p.task_id);
  try {
    await autoLog(env, '✓ เสร็จ: ' + task.name + (task.ff_code ? ' (' + task.ff_code + ')' : ''), { tags_ff: task.ff_code ? [String(task.ff_code)] : [], tags_phase: String(task.phase || ''), meta: { task_id: p.task_id, event: 'task_done' }, actor: actorOf(p), project_id: pidOf(p) });
  } catch { /* ignore */ }
  let photoLinked = false;
  if (p.photo_url) {
    try {
      const pid = await nextId(env, 'P', 3);
      await exec(env, `INSERT INTO task_photos (photo_id, project_id, task_id, report_id, url, drive_id, caption, client_visible, uploaded_at, uploaded_by) VALUES (?, ?, ?, '', ?, ?, ?, 'FALSE', ?, ?)`,
        pid, pidOf(p), p.task_id, p.photo_url, p.photo_drive_id || '', 'หลักฐานงาน: ' + (task.name || ''), nowStr(), p.uploaded_by || 'admin');
      photoLinked = true;
    } catch { /* ignore */ }
  }
  return { ok: true, task_id: p.task_id, task_name: task.name, ff_code: task.ff_code, photo_linked: photoLinked };
}

// ── get_today_stats ──
export async function getTodayStats(env: Env, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const date = (p.date as string) || todayStr();
  const pid = pidOf(p);
  const feed = await getActivityFeed(env, { date, limit: 500, project_id: p.project_id });
  const manualCount = feed.filter((l) => l.type === 'manual').length;
  const autoCount = feed.filter((l) => l.type === 'auto').length;
  const scope = projectScope(pid);
  const tasks = (await queryAll<Record<string, unknown>>(env, `SELECT * FROM tasks WHERE ${scope.sql}`, ...scope.binds)).filter((t) => fmtDate(t.done_date) === date && t.status === 'Done');
  let todayTxns: Record<string, unknown>[] = [];
  try {
    const txns = await queryAll<Record<string, unknown>>(env, `SELECT * FROM material_transactions WHERE ${scope.sql}`, ...scope.binds);
    todayTxns = txns.filter((t) => fmtDate(t.date) === date);
  } catch { /* ignore */ }
  const txCount = todayTxns.length;
  const recvCount = todayTxns.filter((t) => t.type === 'รับ').length;
  const wdrCount = todayTxns.filter((t) => t.type === 'เบิก').length;
  const ctrSet = new Set<string>();
  for (const l of feed) for (const c of l.tags_ctr || []) if (c) ctrSet.add(c);
  for (const t of todayTxns) if (t.contractor_id) ctrSet.add(String(t.contractor_id));
  const issuesCount = feed.reduce((sum, l) => sum + (l.tags_issue || []).length, 0);
  // teams on-site: activity source=team_checkin
  const teamsMap: Record<string, { team_id: string; name: unknown; worker_count: number | null }> = {};
  try {
    const arows = await queryAll<Record<string, unknown>>(env, `SELECT * FROM activity_logs WHERE ${scope.sql} AND type='auto' AND source='team_checkin'`, ...scope.binds);
    for (const r of arows) {
      if (fmtDate(r.date) !== date) continue;
      let m: Record<string, unknown> = {};
      try { m = JSON.parse(String(r.meta_json || '{}')); } catch { m = {}; }
      const tid = String(m.team_id || '').trim();
      if (!tid || m.action === 'out') continue;
      const wc = m.worker_count == null ? null : Number(m.worker_count);
      teamsMap[tid] = { team_id: tid, name: m.team_name || tid, worker_count: wc !== null && !isNaN(wc) ? wc : null };
    }
  } catch { /* ignore */ }
  const teamsOnsiteList = Object.keys(teamsMap).map((k) => teamsMap[k]);
  return {
    date, logs_total: feed.length, logs_manual: manualCount, logs_auto: autoCount, tasks_done: tasks.length,
    transactions_total: txCount, received: recvCount, withdrawn: wdrCount, contractors_involved: ctrSet.size,
    issues_count: issuesCount, teams_onsite: teamsOnsiteList.length, teams_onsite_list: teamsOnsiteList,
  };
}

// ── generate_daily_summary_v2 (AI) ──
export async function generateDailySummaryV2(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const date = (p.date as string) || todayStr();
  const feed = await getActivityFeed(env, { date, limit: 500, project_id: p.project_id });
  const stats = await getTodayStats(env, { date, project_id: p.project_id });
  if (feed.length === 0) return { summary: 'ยังไม่มีกิจกรรมในวันที่ ' + date, stats };
  const chrono = feed.slice().reverse();
  let context = `วันที่: ${date}\nรวม ${feed.length} เหตุการณ์\n\n`;
  for (const log of chrono) {
    const time = String(log.timestamp || '').slice(11, 16);
    const tags: string[] = [];
    if (log.tags_ff.length) tags.push('FF: ' + log.tags_ff.join(','));
    if (log.tags_ctr.length) tags.push('ช่าง: ' + log.tags_ctr.join(','));
    if (log.tags_issue.length) tags.push('⚠ ' + log.tags_issue.join(','));
    context += `[${time}] ${log.text}${tags.length ? ' {' + tags.join(' | ') + '}' : ''}\n`;
  }
  const prompt = `คุณคือผู้ช่วยสรุปรายงานหน้างานก่อสร้าง สรุปกิจกรรมต่อไปนี้เป็นรายงานประจำวันสำหรับส่งผู้บริหาร\n\nข้อมูล:\n${context}\n\nสถิติ:\n- งานเสร็จ: ${stats.tasks_done} task\n- รับวัสดุ: ${stats.received} ครั้ง\n- เบิกวัสดุ: ${stats.withdrawn} ครั้ง\n- ช่างทำงาน: ${stats.contractors_involved} คน\n- ปัญหา: ${stats.issues_count} เรื่อง\n\nสรุปแบบนี้ (เป็นภาษาไทยกระชับ ไม่ใส่ markdown):\nภาพรวม: ...\nความคืบหน้า: ...\nวัสดุ: ...\nปัญหา: ...\nข้อเสนอแนะ: ...`;
  let summary = '';
  let aiError: string | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { summary = await callGemini(env, prompt); if (summary && summary.trim()) { aiError = null; break; } }
    catch (err) { aiError = err instanceof Error ? err.message : String(err); }
  }
  if (!summary || !summary.trim()) summary = buildFallbackSummary(feed, stats, aiError);
  return { summary, stats, log_count: feed.length, ai_error: aiError };
}
function buildFallbackSummary(feed: FeedItem[], stats: Record<string, unknown>, aiError: string | null): string {
  const issues = feed.filter((l) => (l.tags_issue || []).length > 0);
  let s = '⚠ AI สรุปไม่สำเร็จ — แสดงสรุปอัตโนมัติแทน\n\n';
  s += 'ภาพรวม: วันนี้มี ' + feed.length + ' เหตุการณ์';
  if (Number(stats.contractors_involved) > 0) s += ' · ช่างทำงาน ' + stats.contractors_involved + ' คน';
  s += '\nความคืบหน้า: ติ๊กงานเสร็จ ' + (stats.tasks_done || 0) + ' รายการ\n';
  s += 'วัสดุ: รับ ' + (stats.received || 0) + ' ครั้ง · เบิก ' + (stats.withdrawn || 0) + ' ครั้ง\n';
  s += 'ปัญหา: ' + issues.length + ' รายการ';
  if (issues.length > 0) { const t = issues.slice(0, 3).map((i) => (i.tags_issue || []).join(', ')).filter(Boolean).join('; '); if (t) s += ' (' + t + ')'; }
  s += '\nข้อเสนอแนะ: -';
  if (aiError) s += '\n\n(เทคนิค: ' + aiError + ')';
  return s;
}

// ── save/get_saved_summary ──
export async function saveAiSummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const pid = pidOf(p);
  const date = (p.date as string) || todayStr();
  const summary = String(p.summary || '').trim();
  const author = (p.author as string) || 'Admin';
  if (!summary) throw new Error('summary required');
  let stats: Record<string, unknown> = {};
  try { stats = await getTodayStats(env, { date, project_id: p.project_id }); } catch { /* ignore */ }
  const existing = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM daily_reports WHERE substr(date,1,10) = ?', date);
  if (existing) {
    await exec(env, "UPDATE daily_reports SET summary_text=?, tasks_done=?, issues=?, ai_processed='TRUE', updated_at=? WHERE id=?",
      summary, stats.tasks_done || existing.tasks_done || 0, (Number(stats.issues_count) || 0) + ' เรื่อง', nowStr(), existing.id);
    return { ok: true, mode: 'updated', report_id: existing.id, date, summary };
  }
  const id = await nextId(env, 'DR', 3);
  await exec(env,
    `INSERT INTO daily_reports (id, project_id, date, reporter_name, reporter_role, weather, tasks_done, workers_count, workers_list, issues, summary_text, ai_processed, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ADMIN', '', ?, ?, '', ?, ?, 'TRUE', ?, ?)`,
    id, pid, date, author, stats.tasks_done || 0, stats.contractors_involved || 0, (Number(stats.issues_count) || 0) + ' เรื่อง', summary, nowStr(), nowStr());
  return { ok: true, mode: 'created', report_id: id, date, summary };
}
export async function getSavedSummary(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const date = (p.date as string) || todayStr();
  const found = await queryFirst<Record<string, unknown>>(env, 'SELECT * FROM daily_reports WHERE substr(date,1,10) = ?', date);
  if (found && found.summary_text) return { exists: true, report_id: found.id, summary: found.summary_text, author: found.reporter_name, saved_at: found.updated_at || found.created_at };
  return { exists: false };
}

// ── parse_activity_text (AI) ──
export async function parseActivityText(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.text) throw new Error('text required');
  const ffs = await getFFList(env, pidOf(p));
  const contractors = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')).filter((c) => c.active !== false && c.active !== 'FALSE');
  const ffList = ffs.map((f) => `${f.code}|${f.name}|${f.area}`).join('\n');
  const ctrList = contractors.map((c) => `${c.id}|${c.name}|${c.role}`).join('\n');
  const prompt = `คุณคือผู้ช่วย tagging บันทึกหน้างานก่อสร้าง วิเคราะห์ข้อความและสกัด tags ออกมา\n\nข้อความ:\n"${p.text}"\n\nอ้างอิง FF Items (code|name|area):\n${ffList}\n\nอ้างอิง Contractors (id|name|role):\n${ctrList}\n\nคืน JSON เท่านั้น (ไม่ต้อง markdown):\n{ "tags_ff": [], "tags_ctr": [], "tags_issue": [], "tags_phase": "", "ambiguous": [], "confidence": 0.9, "summary": "" }`;
  return callGeminiJSON(env, prompt);
}

// ── suggest_task_from_log (AI) ──
export async function suggestTaskFromLog(env: Env, p: Record<string, unknown>): Promise<unknown> {
  if (!p.text) throw new Error('text required');
  const text = String(p.text);
  const normFf = (v: unknown) => String(v).trim().toUpperCase().replace(/^F-?/, 'F-');
  const toFfList = (v: unknown): string[] => (v === undefined || v === null || v === '' ? [] : (Array.isArray(v) ? v : String(v).split(',')).map((s) => String(s).trim()).filter(Boolean).map(normFf));
  const ffCodes: string[] = [];
  for (const c of toFfList(p.tags_ff)) if (!ffCodes.includes(c)) ffCodes.push(c);
  for (const c of toFfList(p.ff_code)) if (!ffCodes.includes(c)) ffCodes.push(c);
  for (const mm of text.match(/F-?\d{1,2}/gi) || []) { const n = mm.toUpperCase().replace(/^F-?/, 'F-'); if (!ffCodes.includes(n)) ffCodes.push(n); }
  const doneKeywords = ['เสร็จ', 'เรียบร้อย', 'done', 'จบ', 'ปิดงาน', 'สำเร็จ', 'ทำเสร็จ', 'ออเค', 'โอเค', 'ผ่าน'];
  if (!doneKeywords.some((k) => text.toLowerCase().indexOf(k.toLowerCase()) >= 0)) return { has_suggestion: false, reason: 'ไม่พบคำที่สื่อถึงงานเสร็จ', candidates: [] };
  let pool = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM tasks')).filter((t) => { const s = String(t.status || ''); return s !== 'Done' && s !== 'เสร็จ'; });
  if (ffCodes.length > 0) pool = pool.filter((t) => ffCodes.includes(String(t.ff_code || '')));
  if (pool.length === 0) return { has_suggestion: false, reason: ffCodes.length > 0 ? 'ไม่พบ task ที่ค้างอยู่ใน ' + ffCodes.join(', ') : 'ไม่พบ task ที่ค้างอยู่', candidates: [] };
  const taskListStr = pool.map((t) => `${t.id}|${t.ff_code}|${t.name}|${t.phase || ''}`).join('\n');
  const prompt = `คุณคือผู้ช่วยจับคู่บันทึกหน้างานก่อสร้างกับ task ที่ควรติ๊กว่าเสร็จ\n\nข้อความบันทึก:\n"${text}"\n\nรายการ task ที่ยังไม่เสร็จ (TaskID|FFCode|TaskName|Phase):\n${taskListStr}\n\nคืน JSON เท่านั้น:\n{ "matches": [ { "task_id": "...", "confidence": 0.0, "why": "" } ], "overall_confidence": 0.0 }\nกฎ: ใส่เฉพาะ task ที่ confidence >= 0.5`;
  let aiResp: { matches?: { task_id: unknown; confidence: unknown; why?: unknown }[]; overall_confidence?: number };
  try { aiResp = (await callGeminiJSON(env, prompt)) as typeof aiResp; }
  catch (e) { return { has_suggestion: false, reason: 'AI วิเคราะห์ไม่สำเร็จ: ' + (e instanceof Error ? e.message : String(e)), candidates: [] }; }
  const matches = (aiResp && aiResp.matches) || [];
  if (matches.length === 0) return { has_suggestion: false, reason: 'AI ไม่พบ task ที่ตรงกับข้อความ', candidates: [] };
  const candidates = matches.filter((m) => Number(m.confidence) >= 0.5).map((m) => {
    const task = pool.find((t) => String(t.id) === String(m.task_id));
    if (!task) return null;
    return { task_id: task.id, task_name: task.name, ff_code: task.ff_code, phase: task.phase || '', status: task.status || '', confidence: Number(m.confidence), why: m.why || '' };
  }).filter(Boolean).sort((a, b) => (b as { confidence: number }).confidence - (a as { confidence: number }).confidence);
  if (candidates.length === 0) return { has_suggestion: false, reason: 'ความมั่นใจต่ำเกินไป', candidates: [] };
  return { has_suggestion: true, confidence: (candidates[0] as { confidence: number }).confidence, overall_confidence: aiResp.overall_confidence || (candidates[0] as { confidence: number }).confidence, candidates, ff_codes: ffCodes };
}

// ── get_material_transactions ──
export async function getMaterialTransactions(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const dateFrom = String(p.date_from || todayStr()).slice(0, 10);
  const dateTo = String(p.date_to || dateFrom).slice(0, 10);
  const typeFilter = String(p.type || '').trim();
  const matFilter = String(p.material_id || '').trim();
  const limit = Math.max(1, Number(p.limit || 500));
  let rows: Record<string, unknown>[];
  try { rows = await queryAll<Record<string, unknown>>(env, 'SELECT * FROM material_transactions'); } catch { return []; }
  if (!rows.length) return [];
  const materialsMap: Record<string, Record<string, unknown>> = {};
  for (const m of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM materials')) if (m.id) materialsMap[String(m.id)] = m;
  const suppliersMap: Record<string, Record<string, unknown>> = {};
  for (const s of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM suppliers')) if (s.id) suppliersMap[String(s.id)] = s;
  const contractorsMap: Record<string, Record<string, unknown>> = {};
  for (const c of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')) if (c.id) contractorsMap[String(c.id)] = c;
  const teamsMap: Record<string, Record<string, unknown>> = {};
  for (const t of await queryAll<Record<string, unknown>>(env, 'SELECT * FROM teams')) if (t.team_id) teamsMap[String(t.team_id)] = t;
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    const dStr = fmtDate(r.date);
    if (!dStr || dStr < dateFrom || dStr > dateTo) continue;
    if (typeFilter && String(r.type || '') !== typeFilter) continue;
    if (matFilter && String(r.material_id || '') !== matFilter) continue;
    const mat = materialsMap[String(r.material_id)] || null;
    let ctrName = '';
    if (r.contractor_id) { const c = contractorsMap[String(r.contractor_id)]; if (c && c.name) ctrName = String(c.name); if (!ctrName) { const t = teamsMap[String(r.contractor_id)]; if (t && t.name) ctrName = String(t.name); } }
    let supName = '';
    if (r.supplier_id) { const s = suppliersMap[String(r.supplier_id)]; if (s && s.name) supName = String(s.name); }
    out.push({
      id: r.id || '', date: dStr, created_at: String(r.created_at || ''), type: r.type || '', material_id: r.material_id || '',
      material_name: mat ? mat.name || '' : '', material_unit: mat ? mat.unit || '' : '', material_tracking_mode: mat ? mat.tracking_mode || '' : '',
      quantity: Number(r.quantity || 0), unit_price: Number(r.unit_price || 0), total_value: Number(r.total_value || 0),
      supplier_id: r.supplier_id || '', supplier_name: supName, contractor_id: r.contractor_id || '', contractor_name: ctrName,
      ff_code: r.ff_code || '', remaining_after: Number(r.remaining_after || 0), receipt_no: r.receipt_no || '', notes: r.notes || '', created_by: r.created_by || '',
    });
  }
  out.sort((a, b) => { const ca = String(a.created_at || ''); const cb = String(b.created_at || ''); if (ca !== cb) return cb.localeCompare(ca); return String(b.id || '').localeCompare(String(a.id || '')); });
  return out.slice(0, limit);
}

// ── get_daily_bundle ──
export async function getDailyBundle(env: Env, p: Record<string, unknown>): Promise<unknown> {
  const date = (p.date as string) || todayStr();
  const skipRefs = p.skip_refs === true || p.skip_refs === 'true';
  const bundle: Record<string, unknown> = { date, stats: null, feed: [], contractors: null, ffs: null, teams: null };
  try { bundle.stats = await getTodayStats(env, { date, project_id: p.project_id }); } catch (e) { bundle.stats = { error: e instanceof Error ? e.message : String(e) }; }
  try { bundle.feed = await getActivityFeed(env, { date, project_id: p.project_id }); } catch { bundle.feed = []; }
  if (!skipRefs) {
    try { bundle.contractors = (await queryAll<Record<string, unknown>>(env, 'SELECT * FROM contractors')).map(blankNulls); } catch { bundle.contractors = []; }
    try { bundle.ffs = await getFFList(env, pidOf(p)); } catch { bundle.ffs = []; }
    try { bundle.teams = await getTeams(env, { project_id: p.project_id }); } catch { bundle.teams = []; }
  }
  return bundle;
}

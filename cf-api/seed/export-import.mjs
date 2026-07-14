#!/usr/bin/env node
// ============================================================
// export-import.mjs — ดูดข้อมูลจาก Google Sheets (ผ่าน action export_all)
// แล้ว INSERT เข้า D1 + ตั้ง id_counters + พิมพ์ตาราง count เก่า-ใหม่เทียบ
//
// ต้อง: wrangler login แล้ว + D1 'dstr-db' สร้างแล้ว + migration apply แล้ว
// ใช้:
//   ADMIN_PASSWORD=xxxxx node seed/export-import.mjs --tabs        # แค่ลิสต์แท็บจริง
//   ADMIN_PASSWORD=xxxxx node seed/export-import.mjs --dump 00_Projects   # ดัมป์ 1 แท็บ (ทดสอบ)
//   ADMIN_PASSWORD=xxxxx node seed/export-import.mjs --local       # seed ลง D1 local (ซ้อม)
//   ADMIN_PASSWORD=xxxxx node seed/export-import.mjs               # seed ลง D1 remote (จริง)
//
// หลักการ: DELETE + re-INSERT ต่อตาราง (full refresh — ดูดทับได้ตาม BLUEPRINT §6.4)
// ============================================================
import { execSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const TMP = join(__dir, '_dump');
mkdirSync(TMP, { recursive: true });

const GAS_URL =
  process.env.GAS_URL ||
  'https://script.google.com/macros/s/AKfycbwTqbjq54JzVD81OklbVJ1oSRaROJqc0oJSjg1ovTp3ZWBAfvtwam7_Ksjqps0HjhG1/exec';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const DB_NAME = 'dstr-db';

const args = process.argv.slice(2);
const LOCAL = args.includes('--local');
const REMOTE_FLAG = LOCAL ? '--local' : '--remote';
const BATCH = 500;

if (!ADMIN_PASSWORD) {
  console.error('❌ ต้องตั้ง env ADMIN_PASSWORD (ค่าจาก Script Properties เดิม)');
  process.exit(1);
}

// ── tab → table + คอลัมน์ D1 (ตาม migrations/0001_init.sql) ──
// idCol = คอลัมน์ที่ใช้ตั้ง id_counters (เว้นว่าง = ไม่ออกเลขอัตโนมัติ)
const TABLES = [
  { tab: '00_Projects', table: 'projects', cols: ['project_id','name','client','quote_no','start_date','end_date','total_days','total_value','contractor','status','sheets_id','created_at'] },
  { tab: '02_FF_Items', table: 'ff_items', cols: ['project_id','code','bf_code','name','area','zone','price','scope_type','status','risk_level','notes'] },
  { tab: '03_Tasks_Checklist', table: 'tasks', idCol: 'id', cols: ['id','project_id','ff_code','zone','phase','name','status','start_date','end_date','done_date','person_in_charge','notes','weight'] },
  { tab: '04_Payments', table: 'payments', idCol: 'payment_id', cols: ['payment_id','project_id','milestone','sub_item','zone','pct_of_total','amount','due_date','status','paid_date','receipt_no','notes'] },
  { tab: '05_Risks', table: 'risks', idCol: 'risk_id', cols: ['risk_id','project_id','category','description','affected_ff','severity','likelihood','impact','likelihood_score','impact_score','risk_score','causes','affected_parties','mitigation','status','owner','date_identified'] },
  { tab: '07_Daily_Reports', table: 'daily_reports', idCol: 'id', cols: ['id','project_id','date','reporter_name','reporter_role','weather','tasks_done','workers_count','workers_list','issues','summary_text','time_start','time_end','quick_log_raw','ai_processed','status','created_at','updated_at'] },
  { tab: '08_Quick_Logs', table: 'quick_logs', idCol: 'id', cols: ['id','project_id','date','text','created_at'] },
  { tab: '09_Contractors', table: 'contractors', idCol: 'id', cols: ['id','name','type','role','phone','payment_type','notes','active','created_at'] },
  { tab: '10_Suppliers', table: 'suppliers', idCol: 'id', cols: ['id','name','category','contact_person','phone','address','payment_terms','notes','active','created_at'] },
  { tab: '11_Materials', table: 'materials', idCol: 'id', cols: ['id','project_id','name','unit','category','spec','size','default_price','default_supplier_id','linked_ffs','min_stock_alert','current_stock','notes','active','created_at','tracking_mode','last_status_update'] },
  { tab: '12_Material_Transactions', table: 'material_transactions', idCol: 'id', cols: ['id','project_id','date','type','material_id','quantity','unit_price','total_value','supplier_id','contractor_id','ff_code','report_id','remaining_after','receipt_no','notes','created_by','created_at'] },
  { tab: '13_Task_Photos', table: 'task_photos', idCol: 'photo_id', cols: ['photo_id','project_id','task_id','report_id','url','drive_id','r2_key','caption','client_visible','uploaded_at','uploaded_by'] },
  { tab: '16_Material_Photos ', table: 'material_photos', idCol: 'photo_id', cols: ['photo_id','project_id','linked_to','link_id','url','drive_id','r2_key','caption','uploaded_at','uploaded_by'] },
  { tab: '14_BOQ_Items', table: 'boq_items', idCol: 'id', cols: ['id','project_id','ff_code','material_id','planned_qty','unit','notes','created_at'] },
  { tab: '17_Activity_Logs ', table: 'activity_logs', idCol: 'log_id', cols: ['log_id','project_id','date','timestamp','type','source','text','tags_ff','tags_ctr','tags_issue','tags_phase','photo_url','meta_json'] },
  { tab: '21_Teams', table: 'teams', idCol: 'team_id', cols: ['team_id','name','type','lead_name','phone','category','members','active','notes','created_at'] },
  { tab: '29_Project_Teams', table: 'project_teams', idCol: 'assignment_id', cols: ['assignment_id','project_id','team_id','active','added_at'] },
  { tab: '22_Contracts', table: 'contracts', idCol: 'contract_id', cols: ['contract_id','project_id','team_id','contract_no','type','title','value','sign_date','paid_total','tax_pct','file_link','parent_id','status','party','notes','created_at'] },
  { tab: '23_Milestones', table: 'milestones', idCol: 'milestone_id', cols: ['milestone_id','project_id','contract_id','seq','name','condition','pct','amount','status','paid_amount','paid_date','evidence_status','notes'] },
  { tab: '25_ContractFiles', table: 'contract_files', idCol: 'file_id', cols: ['file_id','contract_id','url','drive_id','r2_key','name','file_type','uploaded_at','uploaded_by'] },
  { tab: '26_PaymentSlips', table: 'payment_slips', idCol: 'slip_id', cols: ['slip_id','milestone_id','contract_id','url','drive_id','r2_key','name','file_type','uploaded_at','uploaded_by'] },
  { tab: '24_Staff', table: 'staff', idCol: 'staff_id', cols: ['staff_id','name','role','phone','active','notes','email','auth_role','created_at'] },
  { tab: '27_Project_Staff', table: 'project_staff', idCol: 'assignment_id', cols: ['assignment_id','project_id','staff_id','role_in_project','assigned_date','active'] },
  { tab: '28_CheckIns', table: 'checkins', idCol: 'checkin_id', cols: ['checkin_id','project_id','staff_id','staff_name','role','date','time','ts','period','on_time','location_type','off_site_reason','distance_m','is_far','lat','lng','accuracy','activity','ff_code','note','photo_url','created_at'] },
  { tab: '29_SiteConfig', table: 'site_config', cols: ['project_id','site_lat','site_lng','radius_m','updated_at','updated_by'] },
  { tab: '30_StaffIDCard', table: 'staff_id_cards', cols: ['staff_name','national_id','updated_at'] },
  { tab: '28_Contractor_Evaluations', table: 'contractor_evaluations', idCol: 'eval_id', cols: ['eval_id','project_id','team_id','team_name','eval_date','evaluator','manpower','progress','quality','first_pass','delivery','response','discipline','finance','total_score','grade','status','remark','sub_scores','created_at'] },
];

// header override เมื่อ auto-snake ไม่ตรงคอลัมน์ D1 (ยืนยันจากหัวจริงแล้ว 2026-07-14)
// รูปแบบ: { 'ชื่อตาราง': { 'normalized_header': 'd1_col' } }
const OVERRIDES = {
  ff_items: { ff_code: 'code', item_name: 'name', area_room: 'area', price_thb: 'price' },
  tasks: { task_id: 'id', task_name: 'name' },
  payments: { of_total: 'pct_of_total', amount_thb: 'amount' },
  risks: { mitigation_plan: 'mitigation' },
  task_photos: { id: 'photo_id', drive_url: 'url' },
  material_photos: { drive_url: 'url' },
  quick_logs: { timestamp: 'created_at' }, // report_id/photos/tagged_* ไม่มีช่องใน schema (3 แถว transient — ยอมทิ้ง)
  boq_items: { planned_quantity: 'planned_qty' }, // planned_unit_price/planned_total/created_by ไม่มีช่อง (0 แถว)
};

function normalize(h) {
  return String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

async function gas(params) {
  const url = GAS_URL + '?' + new URLSearchParams(params).toString();
  const res = await fetch(url);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { throw new Error('GAS non-JSON: ' + text.slice(0, 200)); }
  if (json.ok === false) throw new Error('GAS error: ' + json.error);
  return json.data !== undefined ? json.data : json;
}

function sqlLit(v) {
  if (v === null || v === undefined || v === '') return 'NULL';
  if (typeof v === 'boolean') return v ? "'TRUE'" : "'FALSE'";
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function d1(sqlText, label) {
  const file = join(TMP, (label || 'stmt') + '.sql');
  writeFileSync(file, sqlText, 'utf8');
  return execSync(`npx wrangler d1 execute ${DB_NAME} ${REMOTE_FLAG} --file "${file}" --yes`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function d1Json(command) {
  const out = execSync(
    `npx wrangler d1 execute ${DB_NAME} ${REMOTE_FLAG} --command "${command}" --json`,
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // wrangler --json อาจมี log ปนหัว → ตัดเอาเฉพาะ JSON array/object
  const s = out.indexOf('[');
  return JSON.parse(s >= 0 ? out.slice(s) : out);
}

// ── mode: --tabs ──
async function listTabs() {
  const { tabs } = await gas({ action: 'export_tabs', password: ADMIN_PASSWORD });
  console.log('แท็บจริงใน Sheet:');
  for (const t of tabs) console.log(`  ${t.name}  (rows=${t.rows}, cols=${t.cols})`);
  const configured = new Set(TABLES.map((t) => t.tab));
  const real = new Set(tabs.map((t) => t.name));
  const missing = [...configured].filter((t) => !real.has(t));
  const extra = [...real].filter((t) => !configured.has(t));
  if (missing.length) console.log('\n⚠️ config อ้างแท็บที่ไม่มีจริง:', missing);
  if (extra.length) console.log('ℹ️ แท็บใน Sheet ที่ config ไม่ได้ดูด:', extra);
}

// ── mode: --dump <tab> ──
async function dumpOne(tab) {
  const d = await gas({ action: 'export_all', tab, password: ADMIN_PASSWORD });
  console.log(`tab=${d.tab} count=${d.count}`);
  console.log('headers:', d.headers);
  console.log('row[0]:', d.rows[0]);
  console.log('row[last]:', d.rows[d.rows.length - 1]);
}

// สร้าง SQL INSERT ของ 1 ตาราง + คืน {sql, count, idInfo}
function buildInserts(def, headers, rows) {
  const norm = headers.map(normalize);
  const ov = OVERRIDES[def.table] || {};
  // d1col → sheet column index
  const colIdx = {};
  const unmapped = [];
  headers.forEach((h, i) => {
    const key = norm[i];
    let d1col = def.cols.includes(key) ? key : ov[key] || ov[h];
    if (d1col && def.cols.includes(d1col)) colIdx[d1col] = i;
    else if (h !== '') unmapped.push(h);
  });

  const useCols = def.cols.filter((c) => c in colIdx);
  const stmts = [`DELETE FROM ${def.table};`];
  const idVals = [];
  // แบ่ง INSERT ตาม "ขนาดไบต์" (กัน SQLITE_TOOBIG: D1 จำกัด ~100KB/statement → เผื่อไว้ 50KB)
  const MAX_STMT_BYTES = 50_000;
  let buf = [];
  let bufBytes = 0;
  const flush = () => {
    if (!buf.length) return;
    stmts.push(`INSERT INTO ${def.table} (${useCols.join(',')}) VALUES\n${buf.join(',\n')};`);
    buf = [];
    bufBytes = 0;
  };
  for (const row of rows) {
    if (def.idCol && colIdx[def.idCol] !== undefined) idVals.push(row[colIdx[def.idCol]]);
    const tuple = '(' + useCols.map((c) => sqlLit(row[colIdx[c]])).join(',') + ')';
    if (buf.length && (bufBytes + tuple.length > MAX_STMT_BYTES || buf.length >= BATCH)) flush();
    buf.push(tuple);
    bufBytes += tuple.length + 2;
  }
  flush();
  return { sql: stmts.join('\n'), count: rows.length, unmapped, useCols, idVals };
}

// prefix + max trailing number ต่อ prefix (ตั้ง id_counters)
function collectCounters(idVals, counters) {
  for (const v of idVals) {
    const m = String(v).match(/^([A-Za-z_-]*?)(\d+)$/);
    if (!m) continue;
    const prefix = m[1];
    const num = parseInt(m[2], 10);
    if (!prefix) continue;
    counters[prefix] = Math.max(counters[prefix] || 0, num);
  }
}

// ── mode: full seed ──
async function seedAll() {
  console.log(`\n🚜 SEED → D1 ${DB_NAME} (${LOCAL ? 'local' : 'remote'})\n`);
  const counters = {};
  const report = [];

  for (const def of TABLES) {
    process.stdout.write(`• ${def.tab} → ${def.table} ... `);
    let d;
    try {
      d = await gas({ action: 'export_all', tab: def.tab, password: ADMIN_PASSWORD });
    } catch (e) {
      console.log('SKIP (' + e.message + ')');
      report.push({ table: def.table, tab: def.tab, sheet: '—', d1: '—', note: 'export fail' });
      continue;
    }
    const built = buildInserts(def, d.headers, d.rows);
    d1(built.sql, def.table);
    collectCounters(built.idVals, counters);
    let d1count = '?';
    try { d1count = d1Json(`SELECT count(*) c FROM ${def.table}`)[0].results[0].c; } catch {}
    const flag = String(d1count) === String(built.count) ? '✅' : '❌';
    console.log(`${built.count} rows ${flag} (D1=${d1count})`);
    if (built.unmapped.length) console.log(`    ⚠️ header ไม่ถูก map: ${built.unmapped.join(', ')}`);
    report.push({ table: def.table, tab: def.tab, sheet: built.count, d1: d1count, note: flag });
  }

  // ตั้ง id_counters = max + 1 ต่อ prefix
  const centries = Object.entries(counters);
  if (centries.length) {
    const sql =
      'DELETE FROM id_counters;\n' +
      centries
        .map(([p, mx]) => `INSERT INTO id_counters (prefix,next_seq) VALUES (${sqlLit(p)},${mx + 1});`)
        .join('\n');
    d1(sql, 'id_counters');
    console.log('\n🔢 id_counters:', centries.map(([p, mx]) => `${p}→${mx + 1}`).join('  '));
  }

  console.log('\n📊 ตาราง count เทียบ (Sheet → D1):');
  console.log('table'.padEnd(26), 'sheet'.padStart(7), 'd1'.padStart(7), '  ok');
  for (const r of report) {
    console.log(String(r.table).padEnd(26), String(r.sheet).padStart(7), String(r.d1).padStart(7), '  ' + r.note);
  }
  const bad = report.filter((r) => r.note === '❌');
  console.log(bad.length ? `\n❌ ไม่ตรง ${bad.length} ตาราง — ตรวจ header override` : '\n✅ count ตรงทุกตาราง');
}

// ── dispatch ──
if (args.includes('--tabs')) {
  await listTabs();
} else if (args.includes('--dump')) {
  await dumpOne(args[args.indexOf('--dump') + 1]);
} else {
  await seedAll();
}

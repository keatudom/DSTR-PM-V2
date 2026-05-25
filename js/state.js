// ============================================================
// state.js — จัดการ state และคำนวณ Weight-based Progress
// ============================================================

const state = {
  data: null,           // ข้อมูลจาก Sheets
  zone: 'all',          // Zone filter
  openFFs: new Set(),   // FF ที่เปิดอยู่ใน Checklist
  weights: {},          // { ffCode: { ffWeight, phaseWeights } }
  recentUncheck: {},    // Cache วันที่ Done ที่ถูก uncheck (5 นาที)
  projectId: 'bow-house' // Phase B-3: project scope (อ่านจาก ?project= URL — default = legacy)
};

// ============================================================
// Phase B-3: Project scoping
// ============================================================
// อ่าน ?project= จาก URL → set state.projectId
// + rewrite ทุก link ที่ hardcode '?project=bow-house' เป็น project ปัจจุบัน
// ทำงานทันทีตอน state.js โหลด (top-level) → api.js เรียกได้ทันที
(function _initProjectScope() {
  let pid = 'bow-house';
  try {
    if (typeof window !== 'undefined' && window.location) {
      const url = new URL(window.location.href);
      pid = url.searchParams.get('project') || 'bow-house';
    }
  } catch (e) { /* fallback bow-house */ }
  state.projectId = pid;

  // ไม่ใช่ bow-house → rewrite ทุก link ที่ hardcode bow-house เป็น project ปัจจุบัน
  if (pid === 'bow-house') return;
  if (typeof document === 'undefined') return;

  function rewrite() {
    const enc = encodeURIComponent(pid);
    // <a href="...?project=bow-house...">
    document.querySelectorAll('a[href]').forEach(a => {
      const href = a.getAttribute('href');
      if (!href) return;
      if (href.indexOf('project=bow-house') === -1) return;
      a.setAttribute('href', href.replace(/project=bow-house\b/g, 'project=' + enc));
    });
    // onclick="window.location.href='...?project=bow-house...'"
    document.querySelectorAll('[onclick]').forEach(el => {
      const oc = el.getAttribute('onclick');
      if (!oc || oc.indexOf('project=bow-house') === -1) return;
      el.setAttribute('onclick', oc.replace(/project=bow-house\b/g, 'project=' + enc));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', rewrite);
  } else {
    rewrite();
  }

  // Phase C-3: แทนที่ชื่อโปรเจกต์ที่ hardcode ('Kun Beau House' / 'Bow House')
  // ในทุก HTML ของหน้าให้ตรงกับโปรเจกต์ปัจจุบัน — fetch จาก 00_Projects
  function applyProjectName() {
    if (typeof API === 'undefined' || !API.getProjects) return;
    API.getProjects().then(res => {
      if (!res || !res.ok || !Array.isArray(res.data)) return;
      const proj = res.data.find(p => p.project_id === pid);
      if (!proj || !proj.name) return;
      const newName = String(proj.name);
      const rxKun = /Kun Beau House/g;
      const rxBow = /Bow House/g;
      // page title
      if (document.title) {
        document.title = document.title.replace(rxKun, newName).replace(rxBow, newName);
      }
      // common header elements (id ที่หน้าต่างๆ ใช้)
      ['projName', 'hdrSub', 'projTitle', 'loadingText'].forEach(elId => {
        const el = document.getElementById(elId);
        if (el && el.textContent) {
          el.textContent = el.textContent.replace(rxKun, newName).replace(rxBow, newName);
        }
      });
    }).catch(() => {});
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyProjectName);
  } else {
    applyProjectName();
  }
})();

// ============================================================
// WEIGHT CALCULATION ENGINE
// ============================================================

function buildWeights() {
  if (!state.data) return;
  const ffs = state.data.ffs;
  const tasks = state.data.tasks;
  const totalValue = ffs.reduce((s, f) => s + (f.price || 0), 0) || 1;

  state.weights = {};

  ffs.forEach(ff => {
    // FF Weight = ราคา / ราคารวม
    const ffWeight = (ff.price || 0) / totalValue;

    // Phase Weight = task ใน phase / task ทั้งหมดของ FF (task_count mode)
    const ffTasks = tasks.filter(t => t.ffCode === ff.code);
    const totalTaskCount = ffTasks.length;

    const phaseWeights = { p1: 0, p2: 0, p3: 0, p4: 0 };
    if (totalTaskCount > 0) {
      ['p1','p2','p3','p4'].forEach(p => {
        const count = ffTasks.filter(t => t.phase === p).length;
        phaseWeights[p] = count / totalTaskCount;
      });
    }

    state.weights[ff.code] = { ffWeight, phaseWeights, totalTasks: totalTaskCount };
  });
}

// คำนวณ % ของ FF (weighted by phase)
function calcFFProgressWeighted(ffCode) {
  const w = state.weights[ffCode];
  if (!w) return { pct: 0, done: 0, total: 0 };

  const ffTasks = state.data.tasks.filter(t => t.ffCode === ffCode);
  if (ffTasks.length === 0) return { pct: 0, done: 0, total: 0 };

  let weightedSum = 0;
  ['p1','p2','p3','p4'].forEach(p => {
    const phaseTasks = ffTasks.filter(t => t.phase === p);
    if (phaseTasks.length === 0) return;
    const done = phaseTasks.filter(t => t.status === 'Done').length;
    const phaseProgress = done / phaseTasks.length;
    weightedSum += w.phaseWeights[p] * phaseProgress;
  });

  const done = ffTasks.filter(t => t.status === 'Done').length;
  return {
    pct: Math.round(weightedSum * 100 * 10) / 10,  // 1 decimal
    done: done,
    total: ffTasks.length
  };
}

// คำนวณ % รวมของโปรเจกต์ (Weight-based)
function calcProjectProgress() {
  if (!state.data) return 0;
  let total = 0;
  state.data.ffs.forEach(ff => {
    const w = state.weights[ff.code];
    if (!w) return;
    const ffProg = calcFFProgressWeighted(ff.code);
    total += w.ffWeight * (ffProg.pct / 100);
  });
  return Math.round(total * 100 * 10) / 10;  // 1 decimal
}

// คำนวณ Plan ณ วันนี้ (% ที่ควรเสร็จ)
function calcPlanProgress(project) {
  const start = new Date(project.startDate);
  const today = new Date();
  const totalDays = project.totalDays;
  const daysPassed = Math.floor((today - start) / (1000 * 60 * 60 * 24));
  const pct = Math.max(0, Math.min(100, (daysPassed / totalDays) * 100));
  return Math.round(pct * 10) / 10;
}

// คำนวณ %แผน ราย F / ราย phase อิง CONFIG.GANTT_PLAN
// (calcPlanProgress เดิม linear ทั้งโปรเจกต์ — ใช้ใน header/KPI/timeline งวด 1
//  เตรียมการช้า งวด 3 ติดตั้งเร็ว ไม่ linear → ต้องอันใหม่สำหรับ FF Detail)
// คืน { hasGantt, currentWeek, overall, phases }
//   hasGantt:    false ถ้า ffCode ไม่อยู่ใน GANTT_PLAN (ไม่ crash)
//   currentWeek: float (1.0 = ต้นสัปดาห์ที่ 1 ของโปรเจกต์ / 8.43 = กลางสัปดาห์ 8)
//   overall:     0-100 %แผน รวมราย F ณ วันนี้ (weighted ด้วย phaseWeights)
//   phases:      4 entries (p1-p4) — { phase, startWeek, endWeek, planPct, weight }
function calcFFPlanByGantt(ffCode, project) {
  const plan = (typeof CONFIG !== 'undefined' && CONFIG.GANTT_PLAN) ? CONFIG.GANTT_PLAN : {};
  const ffPlan = plan[ffCode];

  // currentWeek convention เดียวกับ renderTimeline เดิม แต่ floating (ละเอียด):
  // day 0 (วันเริ่ม) = 1.0, day 7 = 2.0
  const start = new Date(project.startDate);
  const today = new Date();
  const daysSinceStart = (today - start) / (1000 * 60 * 60 * 24);
  const currentWeek = daysSinceStart / 7 + 1;

  if (!ffPlan || !ffPlan.length) {
    return { hasGantt: false, currentWeek, overall: 0, phases: [] };
  }

  // phaseWeights: ถ้า FF ไม่มี task เลย fallback equal 0.25 ต่อ phase
  const w = state.weights && state.weights[ffCode];
  const weights = (w && w.totalTasks > 0)
    ? w.phaseWeights
    : { p1: 0.25, p2: 0.25, p3: 0.25, p4: 0.25 };

  // ห่อ entry ที่ส่งกลับให้ครบ 4 phase เสมอ (UI วาดกราฟง่าย)
  const byPhase = { 1: null, 2: null, 3: null, 4: null };
  ffPlan.forEach(([n, s, e]) => { byPhase[n] = { startWeek: s, endWeek: e }; });

  let weightedSum = 0;
  const phases = [1, 2, 3, 4].map(n => {
    const key = 'p' + n;
    const weight = weights[key] || 0;
    const slot = byPhase[n];
    if (!slot) {
      // phase ไม่อยู่ใน GANTT_PLAN — ปกติไม่เกิดถ้า schema ครบ 4
      return { phase: key, startWeek: null, endWeek: null, planPct: 0, weight };
    }
    const { startWeek, endWeek } = slot;
    const duration = endWeek - startWeek + 1;          // สัปดาห์
    const elapsed = currentWeek - startWeek;           // ต้นสัปดาห์ startWeek = elapsed 0
    let planPct = 0;
    if (elapsed >= duration) planPct = 100;
    else if (elapsed > 0) planPct = (elapsed / duration) * 100;
    weightedSum += weight * (planPct / 100);
    return { phase: key, startWeek, endWeek, planPct: Math.round(planPct * 10) / 10, weight };
  });

  return {
    hasGantt: true,
    currentWeek: Math.round(currentWeek * 100) / 100,
    overall: Math.round(weightedSum * 100 * 10) / 10,  // 1 decimal
    phases
  };
}

// คำนวณ Variance
function calcVariance(actualPct, planPct) {
  return Math.round((actualPct - planPct) * 10) / 10;
}

// Forecast วันเสร็จ
function calcForecast(project, actualPct) {
  const start = new Date(project.startDate);
  const today = new Date();
  const daysPassed = Math.max(1, Math.floor((today - start) / (1000 * 60 * 60 * 24)));
  if (actualPct <= 0) return null;

  const totalDaysNeeded = (daysPassed / actualPct) * 100;
  const forecastEnd = new Date(start.getTime() + totalDaysNeeded * 24 * 60 * 60 * 1000);
  return forecastEnd;
}

// Helper: format date Thai
function formatDateThai(date) {
  if (!date) return '-';
  const d = (date instanceof Date) ? date : new Date(date);
  const months = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return `${d.getDate()} ${months[d.getMonth()]} ${(d.getFullYear()+543).toString().slice(-2)}`;
}

function fmt(n) {
  return (n || 0).toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

function daysBetween(d1, d2) {
  const date1 = (d1 instanceof Date) ? d1 : new Date(d1);
  const date2 = (d2 instanceof Date) ? d2 : new Date(d2);
  return Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));
}

function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

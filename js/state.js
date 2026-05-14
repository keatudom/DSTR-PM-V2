// ============================================================
// state.js — จัดการ state และคำนวณ Weight-based Progress
// ============================================================

const state = {
  data: null,           // ข้อมูลจาก Sheets
  zone: 'all',          // Zone filter
  openFFs: new Set(),   // FF ที่เปิดอยู่ใน Checklist
  weights: {},          // { ffCode: { ffWeight, phaseWeights } }
  recentUncheck: {}     // Cache วันที่ Done ที่ถูก uncheck (5 นาที)
};

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

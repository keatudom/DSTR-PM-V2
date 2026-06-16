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

    // Phase Weight = ผลรวม "weight ความเหนื่อย" รายงาน task ใน phase / weight รวมของ FF
    // (เดิมนับจำนวน task → งานจุกจิกที่มี task เยอะกินน้ำหนักเกินจริง
    //  ตอนนี้ task มีคอลัมน์ Weight 1-5: โครง/ลามิเนต/พ่นสี=หนัก · คิ้ว/ฟิตติ้ง/เก็บงาน=เบา
    //  task เก่าที่ไม่มีค่า = 1 → เท่ากับพฤติกรรมนับจำนวนเดิม)
    const ffTasks = tasks.filter(t => t.ffCode === ff.code);
    const totalTaskCount = ffTasks.length;
    const tw = t => Number(t.weight) || 1;
    const totalWeight = ffTasks.reduce((s, t) => s + tw(t), 0);

    // น้ำหนักงวด (p1-p4) ภายในชิ้นงาน
    const phaseWeights = { p1: 0, p2: 0, p3: 0, p4: 0 };
    const fixed = (typeof CONFIG !== 'undefined') ? CONFIG.PHASE_PROGRESS_WEIGHT : null;

    if (fixed) {
      // โหมดใหม่: ใช้สัดส่วนงวดตายตัวจาก CONFIG (เช่น p2 งานโรงงานหนักสุด)
      // เฉลี่ยน้ำหนักใหม่เฉพาะงวดที่ชิ้นงานนี้มี task จริง → ยังขึ้น 100% ได้
      const present = ['p1','p2','p3','p4'].filter(p =>
        ffTasks.some(t => t.phase === p));
      const denom = present.reduce((s, p) => s + (Number(fixed[p]) || 0), 0);
      if (denom > 0) {
        present.forEach(p => { phaseWeights[p] = (Number(fixed[p]) || 0) / denom; });
      } else if (totalWeight > 0) {
        // ทุกงวดที่มี task น้ำหนัก config = 0 (กันพลาด) → ถอยไปแบบเดิม
        ['p1','p2','p3','p4'].forEach(p => {
          const wsum = ffTasks.filter(t => t.phase === p).reduce((s, t) => s + tw(t), 0);
          phaseWeights[p] = wsum / totalWeight;
        });
      }
    } else if (totalWeight > 0) {
      // โหมดเดิม: น้ำหนักงวด = ผลรวมความเหนื่อย task ในงวด / รวมทั้งชิ้น
      ['p1','p2','p3','p4'].forEach(p => {
        const wsum = ffTasks.filter(t => t.phase === p).reduce((s, t) => s + tw(t), 0);
        phaseWeights[p] = wsum / totalWeight;
      });
    }

    state.weights[ff.code] = { ffWeight, phaseWeights, totalTasks: totalTaskCount, totalWeight };
  });
}

// คำนวณ % ของ FF (weighted by phase)
function calcFFProgressWeighted(ffCode) {
  const w = state.weights[ffCode];
  if (!w) return { pct: 0, done: 0, total: 0 };

  const ffTasks = state.data.tasks.filter(t => t.ffCode === ffCode);
  if (ffTasks.length === 0) return { pct: 0, done: 0, total: 0 };

  let weightedSum = 0;
  const tw = t => Number(t.weight) || 1;
  ['p1','p2','p3','p4'].forEach(p => {
    const phaseTasks = ffTasks.filter(t => t.phase === p);
    if (phaseTasks.length === 0) return;
    const phaseTotal = phaseTasks.reduce((s, t) => s + tw(t), 0);
    if (phaseTotal === 0) return;
    const doneW = phaseTasks.filter(t => t.status === 'Done').reduce((s, t) => s + tw(t), 0);
    weightedSum += w.phaseWeights[p] * (doneW / phaseTotal);
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

// คำนวณ % คืบหน้าของ "กลุ่มชิ้นงานย่อย" (value-weighted ภายในกลุ่ม)
// ffCodes = array รหัส FF ที่อยู่ในกลุ่ม → ใช้แยก progress งานหลัก vs งานเพิ่ม
// คืน { pct, value } — pct = % คืบหน้าถ่วงด้วยราคาภายในกลุ่ม, value = มูลค่ารวมกลุ่ม
function calcProgressForFFs(ffCodes) {
  if (!state.data || !Array.isArray(ffCodes) || !ffCodes.length) {
    return { pct: 0, value: 0 };
  }
  const set = {};
  ffCodes.forEach(c => { set[c] = true; });
  const groupFFs = state.data.ffs.filter(f => set[f.code]);
  const groupValue = groupFFs.reduce((s, f) => s + (f.price || 0), 0);
  if (groupValue <= 0) return { pct: 0, value: 0 };

  let total = 0;
  groupFFs.forEach(ff => {
    const ffProg = calcFFProgressWeighted(ff.code);
    total += ((ff.price || 0) / groupValue) * (ffProg.pct / 100);
  });
  return { pct: Math.round(total * 100 * 10) / 10, value: groupValue };
}

// แยก progress เป็น "งานหลัก" vs "งานเพิ่ม" (addon) ตาม config addonFFs ของโปรเจกต์
// คืน { overall, main:{pct,value,codes}, addon:{pct,value,codes}, hasAddon }
function calcProgressByContract() {
  const overall = calcProjectProgress();
  const out = { overall, main: null, addon: null, hasAddon: false };
  if (!state.data) return out;

  let addonCodes = [];
  try {
    const proj = (typeof CONFIG !== 'undefined' && CONFIG.PROJECTS)
      ? CONFIG.PROJECTS[state.projectId] : null;
    addonCodes = (proj && Array.isArray(proj.addonFFs)) ? proj.addonFFs : [];
  } catch (e) { addonCodes = []; }

  const allCodes = state.data.ffs.map(f => f.code);
  const addonSet = {};
  addonCodes.forEach(c => { addonSet[c] = true; });
  const addonPresent = addonCodes.filter(c => allCodes.indexOf(c) !== -1);
  const mainCodes = allCodes.filter(c => !addonSet[c]);

  out.main = Object.assign({ codes: mainCodes }, calcProgressForFFs(mainCodes));
  if (addonPresent.length) {
    out.hasAddon = true;
    out.addon = Object.assign({ codes: addonPresent }, calcProgressForFFs(addonPresent));
  }
  return out;
}

// รวมยอดการเบิกเงินฝั่งเจ้าบ้าน (เงินเข้า) จาก state.clientFinance ทุกสัญญา
// คืน { hasData, totalValue, totalPaid, pct, contracts:[{...paidPct}] }
// fallback: ถ้ายังไม่มีสัญญาเจ้าบ้าน คืน hasData:false (ให้ผู้เรียกไปใช้ 04_Payments เดิม)
function calcClientPaymentStats() {
  const cf = state.clientFinance || {};
  const contracts = cf.contracts || [];
  const milestones = cf.milestones || [];
  if (!contracts.length) return { hasData: false, totalValue: 0, totalPaid: 0, pct: 0, contracts: [] };

  const rows = contracts.map(c => {
    const ms = milestones.filter(m => String(m.contract_id) === String(c.contract_id));
    const paid = ms.reduce((s, m) => s + Number(m.paid_amount || 0), 0);
    const value = Number(c.value || 0);
    return {
      contract_id: c.contract_id,
      contract_no: c.contract_no || '',
      title: c.title || '',
      value: value,
      paid: paid,
      pct: value > 0 ? Math.round((paid / value) * 1000) / 10 : 0
    };
  });
  const totalValue = rows.reduce((s, r) => s + r.value, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);
  return {
    hasData: true,
    totalValue: totalValue,
    totalPaid: totalPaid,
    pct: totalValue > 0 ? Math.round((totalPaid / totalValue) * 1000) / 10 : 0,
    contracts: rows
  };
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

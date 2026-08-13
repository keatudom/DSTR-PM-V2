// ============================================================
// gallery.js — สมองของหน้า "คลังรูปภาพ" (gallery.html)
//
// ทำไมแยกไฟล์: ตอนทำ เคยมีหน้าเว็บ 2 ชุด (root ของเดิม + v3 ดีไซน์ใหม่) เลยแยกตรรกะ
//   ออกมาไว้ที่เดียวกันไม่ให้ต้องแก้ 2 ที่ · ตัดยอด V3 แล้ว (2026-08-13) เหลือชุดเดียว
//   แต่คงการแยกไฟล์ไว้ — หน้า HTML บางลง อ่านง่าย และเทสต์ตรรกะแยกได้
//
// ทำไมต้องมีหน้านี้: รูปหน้างานกระจายอยู่ 4 ที่ (รายงานประจำวัน / เช็คอิน / หลักฐานงาน / QC)
//   ต้องไล่เปิดทีละหน้าถึงจะเจอ — หน้านี้รวมให้ + บอกที่มา + เลือกโหลดทีละหลายรูปได้
//
// การดาวน์โหลด: fetch → blob → <a download> (จึงตั้งชื่อไฟล์เองได้)
//   พึ่ง CORS header ที่ Worker ใส่ให้ route /media/* — รูปที่ยังอยู่ Google Drive ทำแบบนี้ไม่ได้
//   (คนละ origin ไม่มี header) → เปิดแท็บใหม่ให้กดเซฟเองแทน
//
// element id ที่หน้า HTML ต้องมี:
//   hdrSub, loadingScreen, gasNotice, main, chips, fFrom, fTo, fFF, fQ,
//   countLine, legacyNote, grid, moreWrap, selBar, selCount, btnDl,
//   viewer, vImg, vSrc, vTitle, vDetail, vMeta
// ============================================================

var PAGE = 60;   // รูปที่ render ต่อรอบ (เป็นรูปเต็มความละเอียด — ปล่อยทีเดียวหมดหนักมือถือ)

var G = {
  all: [],      // ทุกรูปที่ backend ส่งมา
  shown: [],    // หลังกรองแล้ว
  counts: {},
  limit: PAGE,
  source: 'all',
  sel: {},      // id → item ที่ติ๊กไว้
  projectName: '',
  viewIdx: -1,
};

var SRC_TH = { daily:'รายงานประจำวัน', checkin:'เช็คอินหน้างาน', task:'หลักฐานงาน', qc:'QC ตรวจคุณภาพ' };
var SRC_SHORT = { daily:'รายวัน', checkin:'เช็คอิน', task:'หลักฐาน', qc:'QC' };

function glEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
    return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
  });
}
function glEl(id) { return document.getElementById(id); }

// ── โหลดข้อมูล ────────────────────────────────────────────
async function reload() {
  glEl('loadingScreen').style.display = 'block';
  glEl('main').style.display = 'none';
  try {
    var res = await API.getGallery({ source: 'all', limit: 2000 });
    if (!res || !res.ok) throw new Error((res && res.error) || 'โหลดรูปไม่สำเร็จ');
    G.all = (res.data && res.data.items) || [];
    G.counts = (res.data && res.data.counts) || {};
  } catch (e) {
    glEl('loadingScreen').innerHTML =
      '❌ โหลดรูปไม่สำเร็จ<br><span style="font-size:11px">' + glEsc(e.message) + '</span>';
    return;
  }
  buildFFOptions();
  glEl('loadingScreen').style.display = 'none';
  glEl('main').style.display = 'block';
  applyFilters();
}

function buildFFOptions() {
  var seen = {};
  G.all.forEach(function(it) { if (it.ff_code) seen[it.ff_code] = 1; });
  var codes = Object.keys(seen).sort();
  var sel = glEl('fFF');
  var cur = sel.value;
  sel.innerHTML = '<option value="">ทุกชิ้นงาน</option>' +
    codes.map(function(c) { return '<option value="' + glEsc(c) + '">' + glEsc(c) + '</option>'; }).join('');
  if (cur) sel.value = cur;
}

// ── กรอง (ทำฝั่งหน้าเว็บ — โหลดมาครบแล้ว กดสลับชิปจึงไม่ต้องรอเน็ต) ──
var _glT = null;
function debouncedFilter() { clearTimeout(_glT); _glT = setTimeout(applyFilters, 250); }

function applyFilters(keepLimit) {
  var from = glEl('fFrom').value;
  var to   = glEl('fTo').value;
  var ff   = glEl('fFF').value;
  var q    = glEl('fQ').value.trim().toLowerCase();

  var matched = G.all.filter(function(it) {
    if (from && it.date < from) return false;
    if (to && it.date > to) return false;
    if (ff && it.ff_code !== ff) return false;
    if (q) {
      var hay = (it.title + ' ' + it.detail + ' ' + it.by + ' ' + it.ff_code).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  });

  // นับต่อแหล่งจากผลกรอง → ตัวเลขบนชิปคือของที่กดแล้วได้จริง
  G.counts = { all: matched.length, daily:0, checkin:0, task:0, qc:0 };
  matched.forEach(function(it) { G.counts[it.source] = (G.counts[it.source] || 0) + 1; });

  G.shown = (G.source === 'all') ? matched : matched.filter(function(it) { return it.source === G.source; });
  if (!keepLimit) G.limit = PAGE;
  renderChips();
  renderGrid();
}

function clearFilters() {
  glEl('fFrom').value = ''; glEl('fTo').value = '';
  glEl('fFF').value = ''; glEl('fQ').value = '';
  G.source = 'all';
  applyFilters();
}

function setSource(s) { G.source = s; applyFilters(); window.scrollTo(0, 0); }
function showMore() { G.limit += PAGE; renderGrid(); }

// ── วาดหน้าจอ ─────────────────────────────────────────────
function renderChips() {
  var list = [{ k:'all', label:'ทั้งหมด' }].concat(
    ['daily','checkin','task','qc'].map(function(k) { return { k:k, label:SRC_TH[k] }; }));
  glEl('chips').innerHTML = list.map(function(c) {
    return '<button class="gl-chip' + (G.source === c.k ? ' on' : '') + '" data-src="' + c.k + '"' +
           ' onclick="setSource(\'' + c.k + '\')">' + glEsc(c.label) +
           '<span class="n">' + (G.counts[c.k] || 0) + '</span></button>';
  }).join('');
}

function renderGrid() {
  var wrap = glEl('grid');
  var total = G.shown.length;
  glEl('countLine').textContent = total ? ('แสดง ' + Math.min(G.limit, total) + ' จาก ' + total + ' รูป') : '';

  if (!total) {
    wrap.innerHTML = '<div class="gl-empty">ไม่พบรูปตามเงื่อนไขที่เลือก</div>';
    glEl('moreWrap').style.display = 'none';
    glEl('legacyNote').style.display = 'none';
    return;
  }

  var page = G.shown.slice(0, G.limit);

  // เตือนเฉพาะเมื่อยังมีรูปค้างอยู่ Google Drive จริงๆ (หลังย้ายครบคำเตือนจะหายไปเอง)
  var legacyN = G.shown.filter(function(it) { return it.legacy; }).length;
  var note = glEl('legacyNote');
  if (legacyN) {
    note.style.display = 'block';
    note.innerHTML = '⚠️ มี ' + legacyN + ' รูปที่ยังเก็บอยู่ Google Drive เดิม — กดดาวน์โหลดจะเปิดแท็บใหม่ให้กดเซฟเอง';
  } else {
    note.style.display = 'none';
  }

  var html = '', lastDay = '';
  page.forEach(function(it, i) {
    if (it.date !== lastDay) {
      if (lastDay) html += '</div>';
      html += '<div class="gl-day">' + glEsc(thaiDay(it.date)) + '</div><div class="gl-grid">';
      lastDay = it.date;
    }
    html +=
      '<div class="gl-tile' + (G.sel[it.id] ? ' sel' : '') + '" data-id="' + glEsc(it.id) + '">' +
        // alt="" ตั้งใจ — คำอธิบายอยู่ในแถบ .cap แล้ว ถ้าใส่ซ้ำเวลารูปโหลดไม่ขึ้นตัวหนังสือจะล้นทับกัน
        '<img loading="lazy" src="' + glEsc(it.url) + '" alt="" title="' + glEsc(it.title) + '"' +
        ' onclick="openViewer(' + i + ')" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="src src-' + it.source + '">' + glEsc(SRC_SHORT[it.source] || it.source) + '</span>' +
        '<span class="pick" onclick="toggleSel(event, \'' + glEsc(it.id) + '\')">' + (G.sel[it.id] ? '✓' : '') + '</span>' +
        '<span class="cap" onclick="openViewer(' + i + ')">' +
          (it.time ? glEsc(it.time) + ' · ' : '') + glEsc(it.ff_code ? it.ff_code + ' ' : '') + glEsc(it.title) +
        '</span>' +
      '</div>';
  });
  if (lastDay) html += '</div>';
  wrap.innerHTML = html;

  glEl('moreWrap').style.display = (G.limit < total) ? 'block' : 'none';
}

function thaiDay(d) {
  if (!d) return 'ไม่ระบุวันที่';
  var p = String(d).split('-');
  if (p.length !== 3) return d;
  var M = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
  return Number(p[2]) + ' ' + M[Number(p[1]) - 1] + ' ' + (Number(p[0]) + 543);
}

// ── เลือกรูป ──────────────────────────────────────────────
function toggleSel(ev, id) {
  ev.stopPropagation();
  if (G.sel[id]) delete G.sel[id];
  else {
    var it = G.all.find(function(x) { return x.id === id; });
    if (it) G.sel[id] = it;
  }
  renderGrid();
  renderSelBar();
}
function selectAllShown() {
  G.shown.slice(0, G.limit).forEach(function(it) { G.sel[it.id] = it; });
  renderGrid(); renderSelBar();
}
function clearSelection() { G.sel = {}; renderGrid(); renderSelBar(); }
function renderSelBar() {
  var ids = Object.keys(G.sel);
  glEl('selBar').classList.toggle('on', ids.length > 0);
  glEl('selCount').textContent = 'เลือกแล้ว ' + ids.length + ' รูป';
}

// ── ดาวน์โหลด ─────────────────────────────────────────────
// ชื่อไฟล์ตั้งให้สื่อความหมาย เอาไปใช้ต่อได้ทันที:
//   <โครงการ>_<แหล่ง>_<วันที่>_<ชิ้นงาน>_<ลำดับ>.jpg
function fileNameOf(it, seq) {
  var parts = [state.projectId || 'project', it.source, it.date || 'nodate'];
  if (it.ff_code) parts.push(String(it.ff_code).replace(/[^\w-]/g, ''));
  parts.push(String(seq == null ? 1 : seq).padStart(2, '0'));
  var ext = (String(it.url).match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i) || [])[1] || 'jpg';
  return parts.join('_').replace(/[^\w.\-]/g, '') + '.' + ext.toLowerCase();
}

async function downloadOne(it, seq) {
  // รูปที่ยังอยู่ Google Drive: ดึงเป็น blob ไม่ได้ (ไม่มี CORS) → เปิดแท็บให้เซฟเอง
  if (it.legacy) { window.open(it.url, '_blank', 'noopener'); return 'opened'; }
  var res = await fetch(it.url, { mode: 'cors' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  var blob = await res.blob();
  var href = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = href; a.download = fileNameOf(it, seq);
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function() { URL.revokeObjectURL(href); }, 8000);
  return 'saved';
}

async function downloadSelected() {
  var items = Object.keys(G.sel).map(function(k) { return G.sel[k]; });
  if (!items.length) return;
  items.sort(function(a, b) { return String(b.sort_key).localeCompare(String(a.sort_key)); });

  var btn = glEl('btnDl');
  var label = btn.textContent;
  btn.disabled = true;
  var saved = 0, opened = 0, failed = 0;
  for (var i = 0; i < items.length; i++) {
    btn.textContent = 'กำลังโหลด ' + (i + 1) + '/' + items.length;
    try {
      var r = await downloadOne(items[i], i + 1);
      if (r === 'opened') opened++; else saved++;
    } catch (e) { failed++; }
    // เว้นจังหวะ — ยิงรัวเกินไปเบราว์เซอร์จะตัดทิ้งเงียบๆ
    await new Promise(function(r) { setTimeout(r, 300); });
  }
  btn.disabled = false;
  btn.textContent = label;

  var msg = 'บันทึกแล้ว ' + saved + ' รูป';
  if (opened) msg += '\nเปิดแท็บใหม่ให้ ' + opened + ' รูป (รูปเก่าบน Google Drive — กดเซฟเองในแท็บนั้น)';
  if (failed) msg += '\nโหลดไม่สำเร็จ ' + failed + ' รูป';
  alert(msg);
  if (!failed) clearSelection();
}

async function downloadCurrent() {
  var it = G.shown[G.viewIdx];
  if (!it) return;
  try { await downloadOne(it, 1); }
  catch (e) { alert('ดาวน์โหลดไม่สำเร็จ: ' + e.message); }
}

// ── ดูรูปใหญ่ ─────────────────────────────────────────────
function openViewer(i) {
  var it = G.shown[i];
  if (!it) return;
  G.viewIdx = i;
  glEl('vImg').src = it.url;
  glEl('vTitle').textContent = it.title || '(ไม่มีคำอธิบาย)';
  glEl('vDetail').textContent = it.detail || '';
  glEl('vMeta').textContent =
    [thaiDay(it.date) + (it.time ? ' ' + it.time + ' น.' : ''), it.ff_code, it.by].filter(Boolean).join(' · ') +
    (it.legacy ? ' · (รูปเก่าบน Google Drive)' : '');
  var s = glEl('vSrc');
  s.textContent = SRC_TH[it.source] || it.source;
  s.className = 'src-' + it.source;
  glEl('viewer').classList.add('open');
}
function closeViewer() { glEl('viewer').classList.remove('open'); }
function stepViewer(d) {
  var n = G.viewIdx + d;
  if (n < 0 || n >= G.shown.length) return;
  if (n >= G.limit) { G.limit += PAGE; renderGrid(); }
  openViewer(n);
}
// ไปดูต้นทางของรูป (หน้าที่มันถูกบันทึกไว้)
function openSource() {
  var it = G.shown[G.viewIdx];
  if (!it) return;
  // ลิงก์สัมพัทธ์ — หน้า root ไป root, หน้า v3 ไป v3 (มีไฟล์ชื่อเดียวกันทั้งสองชุด)
  var page = it.source === 'daily' ? 'daily.html'
           : it.source === 'checkin' ? 'checkin.html'
           : it.source === 'qc' ? 'qc.html' : 'dashboard.html';
  window.location.href = page + '?project=' + encodeURIComponent(state.projectId);
}

document.addEventListener('keydown', function(e) {
  var v = glEl('viewer');
  if (!v || !v.classList.contains('open')) return;
  if (e.key === 'Escape') closeViewer();
  if (e.key === 'ArrowLeft') stepViewer(-1);
  if (e.key === 'ArrowRight') stepViewer(1);
});

// ── init (หน้าเว็บเรียกตัวนี้หลังโหลด script ครบ) ──────────
async function galleryInit(subtitle) {
  try {
    var pj = await API.getProjects();
    if (pj && pj.ok && Array.isArray(pj.data)) {
      var p = pj.data.find(function(x) { return x.project_id === state.projectId; });
      G.projectName = (p && p.name) ? p.name : state.projectId;
    }
  } catch (e) { G.projectName = state.projectId; }
  glEl('hdrSub').textContent = G.projectName + (subtitle || ' · รูปหน้างานทั้งหมดของโครงการ');

  if (CONFIG.BACKEND !== 'cf') {
    glEl('loadingScreen').style.display = 'none';
    glEl('gasNotice').style.display = 'block';
    return;
  }
  await reload();
}

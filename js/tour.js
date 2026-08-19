/**
 * js/tour.js — เดินดูหน้างาน 360 (Site Tour)
 * ============================================================
 * สเปก: docs/site-tour-360/TOUR-SPEC.md · หน้าตาออกแบบโดย Antigravity
 *
 * โครง 3 ชั้น:
 *   จุด + ลูกศร + แผนผัง = ของโครงการ (วางครั้งเดียว ใช้ตลอด)
 *   เวอร์ชัน             = การกลับไปถ่ายทุกจุดอีกรอบ (มีชื่อ + วันที่)
 *   ภาพ                  = 1 จุด × 1 เวอร์ชัน (เกิดใหม่ทุกรอบ ไม่ทับของเก่า)
 *
 * ⚠️ กติกาที่ห้ามพัง:
 *   - เข้าหน้ามา = เวอร์ชันล่าสุดที่เผยแพร่แล้วเสมอ
 *   - เปลี่ยนเวอร์ชันแล้วต้องยืนอยู่ห้องเดิม (ห้ามเด้งกลับจุดแรก)
 *   - ภาพสำรองมองย้อนหลังเท่านั้น (หลังบ้านคัดมาให้แล้ว ฝั่งนี้แค่ติดป้ายบอก)
 *   - ห้ามปักหมุดบนภาพสำรอง
 * ============================================================
 */

const Tour = {
  data: {
    plans: [],
    points: [],
    links: [],
    versions: [],
    version: null,     // เวอร์ชันที่กำลังดู
    shots: [],         // [{point_id, shot, fallback_from_version, no_image}]
    pins: [],
    pointId: null,
    draftVersionId: null,   // เวอร์ชันที่กำลังถ่ายอยู่ในโหมดถ่าย
    tray: [],               // รูปที่เลือกมาจากคลังภาพ รอจับคู่กับจุด
    mapTool: 'point',       // point | link
    linkFrom: null,
    ff: [],                 // รายการชิ้นงานของโครงการ (ไว้เลือกตอนปักป้าย)
    showTags: true,         // แสดงป้ายชิ้นงานในภาพ 360 ไหม
    pinMode: false,         // กำลังอยู่ในโหมดปักป้ายหรือเปล่า
    aimLinkId: null,        // ทางเดินที่กำลังตั้งทิศอยู่
    aimPinId: null,         // แท็กที่กำลังย้ายตำแหน่งอยู่
    planZoom: 1,            // ระดับซูมแปลน
    planPan: { x: 0, y: 0 },// เลื่อนแปลนตอนซูมเข้า
    homeTool: 'view',       // เครื่องมือบนแปลนหน้าแรก: view | add | move | link
    planIdx: 0,             // ชั้นที่กำลังดู
    moveId: null,           // หมุดที่เลือกไว้เพื่อย้าย
  },
  viewer: null,
  busy: false,

  // ── ตัวช่วย ───────────────────────────────────────────────
  _pt(id) { return this.data.points.find((p) => p.point_id === id) || null; },
  _ver(id) { return this.data.versions.find((v) => v.version_id === id) || null; },
  _shot(pointId) { return this.data.shots.find((s) => s.point_id === pointId) || null; },
  _thaiDate(s) {
    const t = String(s || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return t || '-';
    const M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
    const d = t.split('-');
    return Number(d[2]) + ' ' + M[Number(d[1]) - 1] + ' ' + (Number(d[0]) + 543 - 2500);
  },
  _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  _busy(on, msg) {
    this.busy = on;
    let el = document.getElementById('tour-busy');
    if (!el) {
      el = document.createElement('div');
      el.id = 'tour-busy';
      el.style.cssText = 'position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;' +
        'background:rgba(15,23,42,.72);color:#fff;font-weight:600;text-align:center;padding:24px;backdrop-filter:blur(2px)';
      document.body.appendChild(el);
    }
    el.textContent = msg || 'กำลังทำงาน…';
    el.style.display = on ? 'flex' : 'none';
  },
  _err(res, fallback) {
    const m = (res && res.error) || fallback || 'ทำรายการไม่สำเร็จ';
    if (window.Modal) Modal.toast('❌ ' + m); else alert(m);
  },

  // ── เริ่มต้น ──────────────────────────────────────────────
  // ⚠️ เข้ามาต้องเจอ "รายการห้อง" ก่อน ไม่ใช่โยนเข้าจอ 360 เลย (เจ้าของงานทัก 2026-08-19)
  //    ของเดิมเปิดมาเจอจอดำ ไม่รู้ว่ามีห้องอะไรบ้าง ไม่รู้จะกดตรงไหน และหาปุ่มจัดการไม่เจอ
  async init() {
    this._busy(true, 'กำลังโหลด…');
    try {
      await this.loadConfig(true);          // รวมเวอร์ชันที่ยังไม่เผยแพร่ด้วย

      // เลือกเวอร์ชันที่จะแสดง: เผยแพร่แล้วล่าสุด · ถ้ายังไม่มีเลยก็ใช้ฉบับร่างล่าสุด
      // (เจ้าของงานต้องดูงานที่ตัวเองเพิ่งสแกนได้ก่อนตัดสินใจเผยแพร่)
      const pub = this.data.versions.filter((v) => v.status === 'published');
      const target = (pub[0] || this.data.versions[0] || {}).version_id;
      if (target) await this.loadVersion(target);

      this.switchMode('home');
    } catch (e) {
      this._err({ error: e.message }, 'โหลดไม่สำเร็จ');
      this.switchMode('home');
    }
    this._busy(false);
  },

  // ── หน้าแรก: แปลนบ้านเป็นพระเอก ──────────────────────────
  // เจ้าของงานเคาะ 2026-08-19: "เวลาอยากดู F-01 หรือห้องโถง ก็กดในแปลนจะดีกว่า"
  // ทีมคิดงานจากแปลนอยู่แล้ว (แบบ Furniture Plan มีรหัส FF กำกับทุกห้อง) แปลนจึงเป็นแผนที่เดินเรื่อง
  renderHome() {
    const v = this.data.version;
    const verEl = document.getElementById('th-version');
    if (verEl) verEl.textContent = v ? (v.name + ' · ' + this._thaiDate(v.captured_at)) : 'ยังไม่มีเวอร์ชัน';

    // แถบเตือนว่ายังไม่เผยแพร่ — ให้รู้ชัดว่าตอนนี้ทีมยังไม่เห็น
    const dr = document.getElementById('th-draft');
    if (dr) {
      if (v && v.status === 'draft') {
        dr.style.display = 'flex'; dr.className = 'th-draft';
        dr.innerHTML = '<i data-lucide="eye-off"></i>' +
          '<div style="flex:1;line-height:1.6">เวอร์ชันนี้<b>ยังไม่เผยแพร่</b> — ตอนนี้เห็นแค่คุณคนเดียว ทีมยังไม่เห็น</div>' +
          '<button class="btn btn-primary btn-sm" onclick="Tour.publishVersion(\'' + v.version_id + '\')">เผยแพร่</button>';
      } else dr.style.display = 'none';
    }

    this.renderPlan();
    this.renderRoomList();
    this.loadTrash().then(() => this.renderTrash()).catch(() => {});
    if (window.lucide) lucide.createIcons();
  },

  _planIdx() {
    const n = this.data.plans.length;
    if (!n) return -1;
    let i = Number(this.data.planIdx) || 0;
    return Math.max(0, Math.min(n - 1, i));
  },
  _plan() { const i = this._planIdx(); return i < 0 ? null : this.data.plans[i]; },

  // สถานะภาพของจุด → สีหมุด (ดูปราดเดียวรู้ว่าห้องไหนถ่ายแล้ว)
  _pinTone(pointId) {
    const e = this._shot(pointId);
    if (e && e.shot && !e.fallback_from_version) return { bg: 'var(--color-success-500)', label: 'มีภาพของเวอร์ชันนี้', icon: 'check-circle-2' };
    if (e && e.shot) return { bg: 'var(--color-warning-500)', label: 'ภาพจากเวอร์ชันก่อน', icon: 'alert-triangle' };
    return { bg: 'var(--color-slate-400)', label: 'ยังไม่มีภาพ', icon: 'circle-dashed' };
  },

  renderPlan() {
    const box = document.getElementById('th-planwrap');
    if (!box) return;
    const plan = this._plan();
    const tool = this.data.homeTool || 'view';

    if (!plan) {
      box.innerHTML =
        '<div style="background:#fff;border:1px dashed var(--color-slate-300);border-radius:14px;padding:28px 16px;text-align:center;margin-bottom:14px">' +
        '<i data-lucide="map" style="width:34px;height:34px;color:var(--color-slate-400)"></i>' +
        '<div style="margin:10px 0 14px;line-height:1.8;color:var(--color-slate-600)">ยังไม่มีแปลนบ้าน<br>' +
        '<span style="font-size:13px">อัปแปลนแล้วปักหมุดจุดถ่ายบนแปลนได้เลย — รองรับทั้งรูปภาพและไฟล์ PDF</span></div>' +
        '<button class="btn btn-primary" onclick="Tour.addPlan()"><i data-lucide="upload"></i> อัปแปลนบ้าน</button>' +
        '</div>';
      return;
    }

    // แถบเลือกชั้น (โชว์เมื่อมีมากกว่า 1 ชั้น)
    const floors = this.data.plans.length > 1
      ? '<div class="th-tools">' + this.data.plans.map((p, i) =>
        '<button class="th-tool ' + (i === this._planIdx() ? 'on' : '') + '" onclick="Tour.setPlanIdx(' + i + ')">' +
        this._esc(p.floor_label || ('ชั้น ' + (i + 1))) + '</button>').join('') + '</div>'
      : '';

    const tools =
      '<div class="th-tools">' +
      '<button class="th-tool ' + (tool === 'view' ? 'on' : '') + '" onclick="Tour.setHomeTool(\'view\')"><i data-lucide="eye"></i> ดู</button>' +
      '<button class="th-tool ' + (tool === 'add' ? 'on' : '') + '" onclick="Tour.setHomeTool(\'add\')"><i data-lucide="plus"></i> เพิ่มจุด</button>' +
      '<button class="th-tool ' + (tool === 'move' ? 'on' : '') + '" onclick="Tour.setHomeTool(\'move\')"><i data-lucide="move"></i> ย้ายจุด</button>' +
      '<button class="th-tool ' + (tool === 'link' ? 'on' : '') + '" onclick="Tour.setHomeTool(\'link\')"><i data-lucide="git-branch"></i> ทางเดิน</button>' +
      '</div>';

    const sel = this.data.linkFrom || this.data.moveId;
    const hint = tool === 'add' ? 'แตะบนแปลนตรงที่จะยืนถ่าย แล้วตั้งชื่อห้อง'
      : tool === 'move' ? (this.data.moveId ? 'แตะตำแหน่งใหม่บนแปลน' : 'แตะหมุดที่จะย้าย')
        : tool === 'link' ? (this.data.linkFrom ? 'แตะหมุดปลายทาง' : 'แตะหมุดต้นทางก่อน')
          : 'แตะหมุดเพื่อดูภาพ 360 ของห้องนั้น';

    const pins = this.data.points
      .filter((p) => !p.plan_id || p.plan_id === plan.plan_id)
      .map((p, i) => {
        const t = this._pinTone(p.point_id);
        return '<div class="th-pin ' + (sel === p.point_id ? 'sel' : '') + '" ' +
          'style="left:' + ((Number(p.plan_x) || 0.5) * 100) + '%;top:' + ((Number(p.plan_y) || 0.5) * 100) + '%;background:' + t.bg + '" ' +
          'title="' + this._esc(p.name) + '" ' +
          'onclick="event.stopPropagation(); Tour.onPinTap(\'' + p.point_id + '\')">' + (i + 1) + '</div>';
      }).join('');

    box.innerHTML = floors + tools +
      '<div class="th-planvp" id="th-planvp">' +
      '<div class="th-planbox" id="th-planbox" onclick="Tour.onPlanTap(event)">' +
      '<img src="' + plan.url + '" alt="แปลนบ้าน" draggable="false" style="width:100%;display:block">' + pins + '</div>' +
      '</div>' +
      '<div class="th-zoombar">' +
      '<button class="th-zoombtn" onclick="Tour.zoomPlan(-1)">−</button>' +
      '<span id="th-zoomval" style="min-width:56px;text-align:center;font-weight:700;color:var(--color-slate-600)">100%</span>' +
      '<button class="th-zoombtn" onclick="Tour.zoomPlan(1)">+</button>' +
      '<button class="th-zoombtn" style="width:auto;padding:0 12px" onclick="Tour.resetPlanZoom()">พอดีจอ</button>' +
      '</div>' +
      '<div class="th-hint">' + hint + '</div>' +
      '<div class="th-tools" style="justify-content:center">' +
      '<button class="th-tool" onclick="Tour.replacePlan()"><i data-lucide="image-up"></i> เปลี่ยนรูปแปลน</button>' +
      '<button class="th-tool" onclick="Tour.rotatePlan()"><i data-lucide="rotate-cw"></i> หมุน</button>' +
      '<button class="th-tool" onclick="Tour.addPlan()"><i data-lucide="plus"></i> เพิ่มชั้น</button>' +
      '</div>';
    this._bindPlanGestures();
    this._applyPlanTf();
  },

  // ── ซูม/เลื่อนแปลน (เขียนเอง เพราะ PWA ปิดการซูมของเบราว์เซอร์ไว้) ──
  // เจ้าของงานเจอ 2026-08-19: "เข้าจากไอคอนแอปแล้วขยายแปลนไม่ได้ ต่างจากเปิดใน Safari"
  // สาเหตุ: หน้านี้ตั้ง user-scalable=no (กันจอเด้งตอนพิมพ์) → นิ้วถ่างซูมไม่ได้ทั้งหน้า
  // จึงทำระบบซูมเฉพาะกรอบแปลนขึ้นมาเอง ไม่กระทบส่วนอื่นของหน้า
  _applyPlanTf() {
    const box = document.getElementById('th-planbox');
    const vp = document.getElementById('th-planvp');
    if (!box || !vp) return;
    const z = this.data.planZoom || 1;
    const p = this.data.planPan || { x: 0, y: 0 };
    // กันเลื่อนจนภาพหลุดออกนอกกรอบ
    const w = vp.clientWidth, h = vp.clientHeight;
    const maxX = 0, minX = Math.min(0, w - w * z);
    const maxY = 0, minY = Math.min(0, h - h * z);
    p.x = Math.max(minX, Math.min(maxX, p.x));
    p.y = Math.max(minY, Math.min(maxY, p.y));
    box.style.transform = 'translate(' + p.x + 'px,' + p.y + 'px) scale(' + z + ')';
    const lab = document.getElementById('th-zoomval');
    if (lab) lab.textContent = Math.round(z * 100) + '%';
  },

  zoomPlan(dir) {
    const vp = document.getElementById('th-planvp');
    if (!vp) return;
    const z0 = this.data.planZoom || 1;
    const z1 = Math.max(1, Math.min(5, dir > 0 ? z0 * 1.4 : z0 / 1.4));
    // ซูมเข้า/ออกโดยยึดจุดกึ่งกลางกรอบไว้ ไม่ให้ภาพกระโดด
    const cx = vp.clientWidth / 2, cy = vp.clientHeight / 2;
    const p = this.data.planPan;
    p.x = cx - (cx - p.x) * (z1 / z0);
    p.y = cy - (cy - p.y) * (z1 / z0);
    this.data.planZoom = z1;
    this._applyPlanTf();
  },

  resetPlanZoom() {
    this.data.planZoom = 1;
    this.data.planPan = { x: 0, y: 0 };
    this._applyPlanTf();
  },

  _bindPlanGestures() {
    const vp = document.getElementById('th-planvp');
    if (!vp || vp._zoomBound) return;
    vp._zoomBound = true;
    const pts = new Map();
    let startDist = 0, startZoom = 1, startPan = null, startMid = null, moved = false;

    const midOf = () => {
      const a = [...pts.values()];
      const r = vp.getBoundingClientRect();
      return { x: (a[0].x + a[1].x) / 2 - r.left, y: (a[0].y + a[1].y) / 2 - r.top };
    };
    const distOf = () => {
      const a = [...pts.values()];
      return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    };

    vp.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      moved = false;
      if (pts.size === 2) {
        startDist = distOf(); startZoom = this.data.planZoom;
        startPan = { x: this.data.planPan.x, y: this.data.planPan.y };
        startMid = midOf();
      }
    });

    vp.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      const prev = pts.get(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 2 && startDist > 0) {            // ถ่างนิ้ว = ซูม
        moved = true;
        const z1 = Math.max(1, Math.min(5, startZoom * (distOf() / startDist)));
        this.data.planPan.x = startMid.x - (startMid.x - startPan.x) * (z1 / startZoom);
        this.data.planPan.y = startMid.y - (startMid.y - startPan.y) * (z1 / startZoom);
        this.data.planZoom = z1;
        this._applyPlanTf();
      } else if (pts.size === 1 && this.data.planZoom > 1.01) {   // นิ้วเดียวตอนซูมอยู่ = เลื่อนดู
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) moved = true;
        this.data.planPan.x += dx;
        this.data.planPan.y += dy;
        this._applyPlanTf();
      }
    });

    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) startDist = 0;
      // เลื่อน/ซูมอยู่ ไม่ใช่การแตะวางหมุด — บอกให้ onPlanTap ข้ามรอบนี้
      if (moved) { this._planMoved = true; setTimeout(() => { this._planMoved = false; }, 60); }
    };
    vp.addEventListener('pointerup', end);
    vp.addEventListener('pointercancel', end);
  },

  setPlanIdx(i) { this.data.planIdx = i; this.data.linkFrom = null; this.data.moveId = null; this.renderPlan(); if (window.lucide) lucide.createIcons(); },
  setHomeTool(t) { this.data.homeTool = t; this.data.linkFrom = null; this.data.moveId = null; this.renderPlan(); if (window.lucide) lucide.createIcons(); },

  // แตะหมุดบนแปลน — ทำอะไรขึ้นกับเครื่องมือที่เลือกอยู่
  async onPinTap(pointId) {
    const tool = this.data.homeTool || 'view';
    if (tool === 'view') return this.openPoint(pointId);
    if (tool === 'move') { this.data.moveId = pointId; return this.renderPlan(); }
    if (tool === 'link') {
      if (!this.data.linkFrom) { this.data.linkFrom = pointId; return this.renderPlan(); }
      if (this.data.linkFrom === pointId) { this.data.linkFrom = null; return this.renderPlan(); }
      return this.saveLinkBetween(this.data.linkFrom, pointId);
    }
  },

  // แตะบนแปลน (ไม่โดนหมุด)
  async onPlanTap(ev) {
    if (this._planMoved) return;             // เพิ่งเลื่อน/ซูมอยู่ ไม่ใช่การแตะวางหมุด
    const tool = this.data.homeTool || 'view';
    if (tool !== 'add' && !(tool === 'move' && this.data.moveId)) return;
    const box = document.getElementById('th-planbox');
    const r = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    const plan = this._plan();

    if (tool === 'move') {
      const p = this._pt(this.data.moveId);
      this._busy(true, 'กำลังย้ายหมุด…');
      const res = await API.tourSavePoint({
        point_id: p.point_id, name: p.name, plan_id: plan ? plan.plan_id : '',
        plan_x: x, plan_y: y, sort_order: p.sort_order,
      });
      if (!res || res.ok === false) { this._busy(false); return this._err(res); }
      this.data.moveId = null;
      await this.loadConfig(true);
      this.renderHome();
      this._busy(false);
      return;
    }

    const name = prompt('ห้อง/จุดนี้ชื่ออะไร (เช่น ห้องโถง, F-01 ตู้ TV)');
    if (!name) return;
    this._busy(true, 'กำลังบันทึกจุด…');
    const res = await API.tourSavePoint({
      name: name, plan_id: plan ? plan.plan_id : '',
      plan_x: x, plan_y: y, sort_order: this.data.points.length + 1,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this.renderHome();
    this._busy(false);

    const d = res.data || res;
    const go = await Modal.confirm({
      title: 'ปักหมุด "' + this._esc(name) + '" แล้ว',
      desc: 'จะสแกน 360 ของจุดนี้เลยไหม หรือไว้ปักหมุดให้ครบก่อนก็ได้',
      icon: '📍', iconClass: 'info',
      confirmText: 'สแกนเลย', cancelText: 'ปักหมุดต่อ',
    });
    if (go) this.scanFor(d.point_id);
  },

  // ทิศของลูกศรคำนวณจากตำแหน่งบนแปลนให้อัตโนมัติ (ปรับละเอียดทีหลังได้ที่ "ปรับภาพ")
  async saveLinkBetween(fromId, toId) {
    const a = this._pt(fromId), b = this._pt(toId);
    const dx = (Number(b.plan_x) || 0) - (Number(a.plan_x) || 0);
    const dy = (Number(b.plan_y) || 0) - (Number(a.plan_y) || 0);
    let yaw = Math.atan2(dx, -dy) * 180 / Math.PI;
    if (yaw > 180) yaw -= 360;
    this._busy(true, 'กำลังบันทึกทางเดิน…');
    const res = await API.tourSaveLink({ from_point: fromId, to_point: toId, yaw: yaw, pitch: -10, label: '' });
    this.data.linkFrom = null;
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this.renderHome();
    this._busy(false);
    Modal.toast('✓ โยงทางเดินแล้ว');
  },

  // ── แปลน: อัป / เปลี่ยนรูป / เพิ่มชั้น / หมุน ────────────
  addPlan() { this._pickPlanFile(''); },
  replacePlan() { const p = this._plan(); this._pickPlanFile(p ? p.plan_id : ''); },

  _pickPlanFile(planId) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf,.pdf';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '');
      this._busy(true, isPdf ? 'กำลังอ่านไฟล์ PDF…' : 'กำลังอัปแปลน…');
      try {
        const img = isPdf ? await this._pdfToImage(f, 2000) : await this._compress(f, 2000, 0.85);
        if (!img) { this._busy(false); return; }
        let label = '';
        if (!planId) {
          label = prompt('แปลนนี้คือชั้นไหน', 'ชั้น ' + (this.data.plans.length + 1)) || ('ชั้น ' + (this.data.plans.length + 1));
        }
        const res = await API.tourSavePlan({
          plan_id: planId,
          floor_label: label || (this._plan() || {}).floor_label || 'ชั้น 1',
          image_base64: img.dataUrl, width: img.w, height: img.h,
        });
        if (!res || res.ok === false) { this._busy(false); return this._err(res); }
        await this.loadConfig(true);
        if (!planId) this.data.planIdx = this.data.plans.length - 1;
        this.renderHome();
        Modal.toast('✓ อัปแปลนแล้ว');
      } catch (e) { this._err({ error: e.message }); }
      this._busy(false);
    };
    inp.click();
  },

  // แบบที่สถาปนิกส่งมามักเป็นแนวนอนวางบนหน้ากระดาษแนวตั้ง → ต้องหมุนดู
  // หมุนรูปที่เก็บไว้เลย (ไม่เก็บค่าองศาแยก) → ส่วนอื่นของระบบไม่ต้องรู้เรื่ององศา
  async rotatePlan() {
    const plan = this._plan();
    if (!plan) return;
    this._busy(true, 'กำลังหมุนแปลน…');
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('โหลดรูปแปลนไม่สำเร็จ'));
        im.src = plan.url + (plan.url.indexOf('?') >= 0 ? '&' : '?') + 'r=' + Date.now();
      });
      const c = document.createElement('canvas');
      c.width = img.naturalHeight; c.height = img.naturalWidth;
      const ctx = c.getContext('2d');
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(Math.PI / 2);
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
      const res = await API.tourSavePlan({
        plan_id: plan.plan_id, floor_label: plan.floor_label,
        image_base64: c.toDataURL('image/jpeg', 0.88), width: c.width, height: c.height,
      });
      if (!res || res.ok === false) { this._busy(false); return this._err(res); }

      // หมุนรูปแล้วพิกัดหมุดต้องหมุนตาม ไม่งั้นหมุดกระเด็นไปคนละห้อง
      for (const p of this.data.points.filter((p) => p.plan_id === plan.plan_id)) {
        const nx = 1 - (Number(p.plan_y) || 0.5);
        const ny = Number(p.plan_x) || 0.5;
        await API.tourSavePoint({
          point_id: p.point_id, name: p.name, plan_id: p.plan_id,
          plan_x: nx, plan_y: ny, sort_order: p.sort_order,
        });
      }
      await this.loadConfig(true);
      this.renderHome();
    } catch (e) { this._err({ error: e.message }); }
    this._busy(false);
  },

  // ── รายการห้อง (ใต้แปลน) ─────────────────────────────────
  renderRoomList() {
    const list = document.getElementById('th-list');
    if (!list) return;

    if (!this.data.points.length) {
      list.innerHTML = '<div style="text-align:center;padding:24px 16px;line-height:1.9;color:var(--color-slate-600)">' +
        'ยังไม่มีจุดถ่าย<br><span style="font-size:13px">ปักหมุดบนแปลนด้วยเครื่องมือ "เพิ่มจุด" หรือกด "สแกน" แล้วตั้งชื่อห้องได้เลย</span></div>';
      return;
    }

    list.innerHTML = '<div class="form-label">ห้องทั้งหมด (' + this.data.points.length + ')</div>' +
      this.data.points.map((p, i) => {
        const t = this._pinTone(p.point_id);
        const e = this._shot(p.point_id);
        const sub = (e && e.fallback_from_version)
          ? 'ภาพจาก "' + this._esc(e.fallback_from_version.name) + '" ' + this._thaiDate(e.fallback_from_version.captured_at)
          : t.label;
        return '<div class="th-room">' +
          '<div class="th-pin" style="position:static;margin:0;background:' + t.bg + ';flex:none">' + (i + 1) + '</div>' +
          '<div class="th-room-main" onclick="Tour.openPoint(\'' + p.point_id + '\')">' +
          '<div class="th-room-name">' + this._esc(p.name) + '</div>' +
          '<div class="th-room-sub">' + sub + '</div></div>' +
          '<button onclick="Tour.renamePoint(\'' + p.point_id + '\')" title="แก้ชื่อห้อง" ' +
          'style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;' +
          'margin-right:6px;border:1.5px solid var(--color-slate-300);border-radius:10px;background:#fff;' +
          'color:var(--color-slate-600);cursor:pointer">' +
          '<i data-lucide="pencil" style="width:18px;height:18px"></i></button>' +
          '<button onclick="Tour.removePoint(\'' + p.point_id + '\')" title="ทิ้งลงถังขยะ" ' +
          'style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;' +
          'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
          'color:var(--color-error-700);cursor:pointer">' +
          '<i data-lucide="trash-2" style="width:18px;height:18px"></i></button>' +
          '</div>';
      }).join('');
  },

  // วาดใหม่ตามโหมดที่เปิดอยู่ — เดิม hardcode renderMap ทำให้ลบจุดจากหน้าแรกแล้วรายการไม่อัปเดต
  _refresh() {
    if (this.data.mode === 'map') this.renderMap();
    else this.renderHome();
  },


  // แก้ชื่อห้อง — เก็บพิกัดบนแปลนและลำดับไว้เหมือนเดิม แก้แค่ชื่อ
  async renamePoint(pointId) {
    const p = this._pt(pointId);
    if (!p) return;
    const name = prompt('ชื่อห้อง/จุดนี้', p.name || '');
    if (name === null) return;
    const n = String(name).trim();
    if (!n || n === p.name) return;
    this._busy(true, 'กำลังบันทึกชื่อ…');
    const res = await API.tourSavePoint({
      point_id: p.point_id, name: n, plan_id: p.plan_id,
      plan_x: p.plan_x, plan_y: p.plan_y, sort_order: p.sort_order,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this._refresh();
    if (this.data.pointId === pointId) {
      const el = document.getElementById('tv-point-name');
      if (el) el.innerText = n;
    }
    this._busy(false);
    Modal.toast('✓ เปลี่ยนชื่อแล้ว');
  },

  // แตะห้องในรายการ → เข้าจอ 360 ของห้องนั้น
  openPoint(pointId) {
    this.switchMode('view');
    this.goToPoint(pointId, true);
  },

  async publishVersion(versionId) {
    const ok = await Modal.confirm({
      title: 'เผยแพร่ให้ทีมดู?',
      desc: 'หลังเผยแพร่แล้วทุกคนในโครงการจะเห็นเวอร์ชันนี้',
      icon: '🚀', iconClass: 'info', confirmText: 'เผยแพร่เลย',
    });
    if (!ok) return;
    this._busy(true, 'กำลังเผยแพร่…');
    const res = await API.tourPublishVersion(versionId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    await this.loadVersion(versionId);
    this.renderHome();
    this._busy(false);
    Modal.toast('✅ เผยแพร่แล้ว ทีมเห็นได้แล้ว');
  },

  async loadConfig(includeDraft) {
    const res = await API.tourGetConfig(includeDraft);
    if (!res || res.ok === false) throw new Error((res && res.error) || 'โหลดข้อมูลทัวร์ไม่สำเร็จ');
    const d = res.data || res;
    this.data.plans = d.plans || [];
    this.data.points = d.points || [];
    this.data.links = d.links || [];
    this.data.versions = d.versions || [];
  },

  // ยังไม่ได้ตั้งค่า — พาไปหน้าวางจุดแทนที่จะโชว์จอดำเปล่าๆ
  showSetupNeeded(msg) {
    const empty = document.getElementById('tv-empty-msg');
    if (empty) {
      empty.style.display = 'flex';
      empty.innerHTML =
        '<div style="text-align:center;padding:24px">' +
        '<div style="font-size:15px;line-height:1.7;margin-bottom:16px">' +
        this._esc(msg || 'ยังไม่มีภาพในโครงการนี้ — เริ่มถ่ายได้เลย ไม่ต้องตั้งค่าอะไรก่อน') +
        '</div>' +
        '<button class="btn btn-primary" onclick="Tour.enterCaptureMode()"><i data-lucide="camera"></i> เริ่มถ่าย</button> ' +
        '<button class="btn btn-secondary" onclick="Tour.switchMode(\'map\')">จัดการจุด/เส้นทาง</button>' +
        '</div>';
    }
    const warn = document.getElementById('tv-fallback-warn');
    if (warn) warn.style.display = 'none';
  },

  // ── โหลดเวอร์ชัน ─────────────────────────────────────────
  async loadVersion(versionId) {
    const res = await API.tourGetVersion(versionId || '');
    if (!res || res.ok === false) throw new Error((res && res.error) || 'โหลดเวอร์ชันไม่สำเร็จ');
    const d = res.data || res;
    if (!d.version) throw new Error('ยังไม่มีเวอร์ชันในโครงการนี้');

    this.data.version = d.version;
    this.data.shots = d.shots || [];
    this.data.pins = d.pins || [];

    const label = document.getElementById('tv-current-version');
    if (label) label.innerText = d.version.name + ' (' + this._thaiDate(d.version.captured_at) + ')';
    this.renderVersionList();
  },

  // ── เดินไปจุด ────────────────────────────────────────────
  // จังหวะ: เฟดมืด 150ms → เปลี่ยนภาพ → เฟดกลับ (รวมไม่เกิน 300ms ตามที่เคาะไว้)
  goToPoint(pointId, instant) {
    const container = document.getElementById('panorama-container');
    if (!container || instant) return this._doGoToPoint(pointId);
    container.classList.add('fade-out');
    setTimeout(() => {
      this._doGoToPoint(pointId);
      container.classList.remove('fade-out');
    }, 150);
  },

  _doGoToPoint(pointId) {
    const pt = this._pt(pointId);
    if (!pt) return;
    this.data.pointId = pointId;
    this.closeAdjust();   // ย้ายห้องแล้วแผงปรับภาพของห้องเก่าต้องหายไปด้วย
    if (this.data.pinMode || this.data.aimLinkId || this.data.aimPinId) {
      this.data.pinMode = false; this.data.aimLinkId = null; this.data.aimPinId = null;
      const pb = document.getElementById('tv-pinbar'); if (pb) pb.style.display = 'none';
    }

    document.getElementById('tv-point-name').innerText = pt.name;
    const idx = this.data.points.findIndex((p) => p.point_id === pointId) + 1;
    document.getElementById('tv-point-stats').innerText = 'จุดที่ ' + idx + '/' + this.data.points.length;
    this.updateMinimapPoint();

    const entry = this._shot(pointId);
    const warnEl = document.getElementById('tv-fallback-warn');
    const emptyEl = document.getElementById('tv-empty-msg');
    const pinBtn = document.getElementById('btn-pin');
    const container = document.getElementById('panorama-container');

    // จุดที่ย้อนหลังแล้วไม่มีภาพเลย — บอกตามตรง อย่าโชว์จอดำเฉยๆ
    if (!entry || entry.no_image || !entry.shot) {
      warnEl.style.display = 'none';
      emptyEl.style.display = 'flex';
      emptyEl.innerHTML =
        '<div style="text-align:center;padding:24px">' +
        '<i data-lucide="eye-off" style="width:40px;height:40px;opacity:.5"></i>' +
        '<div style="margin:12px 0 16px;line-height:1.7">จุดนี้ยังไม่มีภาพในเวอร์ชัน<br><b>' +
        this._esc(this.data.version.name) + '</b> หรือก่อนหน้า</div>' +
        '<button class="btn btn-secondary btn-sm" onclick="Tour.jumpToStart()">กลับไปจุดเริ่มต้น</button>' +
        '</div>';
      if (pinBtn) pinBtn.disabled = true;
      if (this.viewer) { try { this.viewer.destroy(); } catch (e) { /* */ } this.viewer = null; }
      if (container) container.innerHTML = '';
      if (window.lucide) lucide.createIcons();
      return;
    }
    emptyEl.style.display = 'none';

    const shot = entry.shot;
    const fb = entry.fallback_from_version;
    if (fb) {
      // กฎทองข้อ 7: ห้ามปักหมุดบนภาพสำรอง (หมุดจะไม่รู้ว่าเป็นของเวอร์ชันไหน)
      warnEl.style.display = 'flex';
      warnEl.innerHTML =
        '<i data-lucide="alert-triangle"></i>' +
        '<span style="flex:1">ยังไม่ถ่ายในเวอร์ชันนี้ — กำลังแสดงภาพจาก "' + this._esc(fb.name) + '" ' +
        this._thaiDate(fb.captured_at) + '</span>' +
        '<button class="btn btn-sm btn-ghost" style="color:#fff;border:1px solid rgba(255,255,255,.4)" ' +
        'onclick="Tour.switchVersion(\'' + fb.version_id + '\')">ไปเวอร์ชันนั้น</button>';
      if (pinBtn) pinBtn.disabled = true;
    } else {
      warnEl.style.display = 'none';
      if (pinBtn) pinBtn.disabled = false;
    }

    this._renderShot(shot, pointId);
    if (window.lucide) lucide.createIcons();
  },

  // วาดภาพ + ลูกศรเดิน · รูปธรรมดาไม่เอาเข้า Pannellum (จะบิด) — โชว์เป็นรูปนิ่งแล้ววางลูกศรเป็นปุ่มแทน
  _renderShot(shot, pointId) {
    const container = document.getElementById('panorama-container');
    const linksOut = this.data.links.filter((l) => l.from_point === pointId);
    if (this.viewer) { try { this.viewer.destroy(); } catch (e) { /* */ } this.viewer = null; }
    container.innerHTML = '';

    if (shot.kind === 'flat' || typeof pannellum === 'undefined') {
      container.style.background = '#000';
      const chips = linksOut.map((l) =>
        '<button class="btn btn-secondary btn-sm" onclick="Tour.goToPoint(\'' + l.to_point + '\')">' +
        '→ ' + this._esc(l.label || (this._pt(l.to_point) || {}).name || 'ไปต่อ') + '</button>').join(' ');
      container.innerHTML =
        '<img src="' + shot.url + '" alt="" style="width:100%;height:100%;object-fit:contain">' +
        (chips ? '<div style="position:absolute;left:0;right:0;bottom:16px;display:flex;gap:8px;' +
          'justify-content:center;flex-wrap:wrap;padding:0 12px">' + chips + '</div>' : '');
      return;
    }

    const hotSpots = linksOut.map((l) => ({
      pitch: Number(l.pitch) || -10,
      yaw: Number(l.yaw) || 0,
      cssClass: 'custom-hotspot',
      createTooltipFunc: this._hotspotTooltip,
      createTooltipArgs: this._esc(l.label || (this._pt(l.to_point) || {}).name || 'ไปต่อ'),
      clickHandlerFunc: () => this.goToPoint(l.to_point),
    }));

    // ป้ายชิ้นงานที่ปักไว้ในภาพ (FF tag)
    if (this.data.showTags) {
      for (const pin of (this.data.pins || []).filter((p) => p.point_id === pointId)) {
        const ff = pin.kind === 'ff' ? this._ffOf(pin.ref_id) : null;
        hotSpots.push({
          pitch: Number(pin.pitch) || 0,
          yaw: Number(pin.yaw) || 0,
          cssClass: 'ff-hotspot',
          createTooltipFunc: (div, args) => {
            div.innerHTML = '<span class="ff-chip">' + args.top +
              (args.sub ? '<small>' + args.sub + '</small>' : '') + '</span>';
          },
          createTooltipArgs: {
            top: this._esc(pin.kind === 'ff' ? pin.ref_id : (pin.text || 'หมายเหตุ').slice(0, 28)),
            sub: this._esc(ff ? ff.name : ''),
          },
          clickHandlerFunc: () => this.openPin(pin.pin_id),
        });
      }
    }

    const cfg = {
      type: 'equirectangular',
      panorama: shot.url,
      autoLoad: true,
      showControls: false,
      hotSpots: hotSpots,
      hfov: 100, minHfov: 50, maxHfov: 120,
      pitch: 0,
      yaw: Number(shot.yaw_offset) || 0,   // ค่าปรับหมุน — ทำให้เวอร์ชันต่างรอบหันทางเดียวกัน
    };
    // พาโนมือถือ = ภาพไม่ครบรอบ ต้องบอก Pannellum ว่ากว้าง/สูงกี่องศา ไม่งั้นภาพจะยืด
    if (shot.kind === 'pano') {
      cfg.haov = Number(shot.haov) || 180;
      cfg.vaov = Number(shot.vaov) || 60;
      cfg.maxHfov = Math.min(120, cfg.haov);
    }
    try {
      this.viewer = pannellum.viewer('panorama-container', cfg);
      this._bindPinTap(container);
      this.loadFF();                      // โหลดรายการชิ้นงานไว้ล่วงหน้า (ใช้ตอนแตะป้าย)
    } catch (e) {
      container.innerHTML = '<img src="' + shot.url + '" style="width:100%;height:100%;object-fit:contain">';
    }
  },

  _hotspotTooltip(hotSpotDiv, args) {
    hotSpotDiv.innerHTML = '<i data-lucide="chevron-up"></i>';
    const span = document.createElement('span');
    span.className = 'custom-hotspot-label';
    span.innerHTML = args;
    hotSpotDiv.appendChild(span);
    if (window.lucide) lucide.createIcons();
  },

  jumpToStart() {
    if (this.data.points.length) this.goToPoint(this.data.points[0].point_id);
  },

  // ── ตัวเลือกเวอร์ชัน ─────────────────────────────────────
  openVersionSelector() { document.getElementById('bs-versions').classList.add('show'); },
  closeVersionSelector() { document.getElementById('bs-versions').classList.remove('show'); },

  renderVersionList() {
    const listEl = document.getElementById('tv-version-list');
    if (!listEl) return;
    if (!this.data.versions.length) {
      listEl.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center">ยังไม่มีเวอร์ชัน</div>';
      return;
    }
    const curId = this.data.version ? this.data.version.version_id : '';
    listEl.innerHTML = this.data.versions.map((v) => {
      const active = v.version_id === curId ? 'active' : '';
      const draft = v.status === 'draft'
        ? ' <span class="badge badge-warning">ยังไม่เผยแพร่</span>' : '';
      const cnt = (v.shot_count || 0) + '/' + (v.point_count || 0) + ' จุด';
      const by = v.created_by ? ' · ' + this._esc(v.created_by) : '';
      return '<div class="bs-item ' + active + '" onclick="Tour.switchVersion(\'' + v.version_id + '\')">' +
        '<div class="bs-item-main">' +
        '<div class="bs-item-name">' + this._esc(v.name) + draft + '</div>' +
        '<div class="bs-item-date">' + this._thaiDate(v.captured_at) + ' · ' + cnt + by + '</div>' +
        '</div>' +
        (active ? '<i data-lucide="check" style="color:var(--color-blue-600)"></i>' : '') +
        '</div>';
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  async switchVersion(vid) {
    if (this.data.version && vid === this.data.version.version_id) return this.closeVersionSelector();
    this.closeVersionSelector();
    const keep = this.data.pointId;          // กฎทอง: เปลี่ยนเวอร์ชันแล้วยืนอยู่ห้องเดิม
    this._busy(true, 'กำลังเปลี่ยนเวอร์ชัน…');
    try {
      await this.loadVersion(vid);
      if (this.data.mode === 'home') this.renderHome();
      else this.goToPoint(keep || (this.data.points[0] || {}).point_id, true);
    } catch (e) { this._err({ error: e.message }); }
    this._busy(false);
  },

  // ── แผนผังจิ๋ว ───────────────────────────────────────────
  toggleMinimap() {
    const overlay = document.getElementById('minimap-overlay');
    const open = overlay.style.display === 'flex';
    overlay.style.display = open ? 'none' : 'flex';
    if (open) overlay.classList.remove('expanded'); else this.updateMinimapPoint();
  },
  expandMinimap() { document.getElementById('minimap-overlay').classList.toggle('expanded'); },

  updateMinimapPoint() {
    const pt = this._pt(this.data.pointId);
    const wrap = document.getElementById('tv-minimap-points');
    if (!wrap) return;
    const plan = this.data.plans.find((pl) => pt && pl.plan_id === pt.plan_id) || this.data.plans[0] || null;
    const floorEl = document.getElementById('tv-minimap-floor');
    if (floorEl) floorEl.innerText = plan ? ' - ' + plan.floor_label : '';
    const img = document.getElementById('tv-minimap-img');
    if (img) {
      if (plan && plan.url) { img.src = plan.url; img.style.display = ''; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }
    }
    wrap.innerHTML = this.data.points.map((p) =>
      '<div class="mm-point ' + (pt && p.point_id === pt.point_id ? 'active' : '') + '" ' +
      'title="' + this._esc(p.name) + '" ' +
      'style="left:' + ((Number(p.plan_x) || 0.5) * 100) + '%;top:' + ((Number(p.plan_y) || 0.5) * 100) + '%" ' +
      'onclick="event.stopPropagation(); Tour.goToPoint(\'' + p.point_id + '\'); Tour.toggleMinimap();"></div>').join('');
  },

  // ── หมุดคอมเมนต์ (ของเดิม เก็บไว้เผื่อเรียกจากที่อื่น) ──────
  async togglePins() {
    const pins = this.data.pins.filter((p) => p.point_id === this.data.pointId);
    const list = pins.length
      ? pins.map((p) => '<div style="padding:8px 0;border-bottom:1px solid var(--color-slate-200)">' +
        (p.resolved === 1 ? '✅ ' : '📌 ') + this._esc(p.text || '(ไม่มีข้อความ)') +
        (p.ref_id ? ' <span class="badge">' + this._esc(p.ref_id) + '</span>' : '') + '</div>').join('')
      : '<div class="text-muted" style="padding:8px 0">ยังไม่มีหมุดในจุดนี้</div>';
    const ok = await Modal.confirm({
      title: 'หมุดคอมเมนต์ — ' + ((this._pt(this.data.pointId) || {}).name || ''),
      desc: 'บันทึกสิ่งที่เห็นในภาพนี้ไว้ให้ทีมอ่าน',
      info: list,
      icon: '📌', iconClass: 'info',
      confirmText: 'เพิ่มหมุดใหม่', cancelText: 'ปิด',
    });
    if (!ok) return;
    const text = prompt('พิมพ์สิ่งที่อยากบันทึกไว้ที่จุดนี้');
    if (!text) return;
    const yaw = this.viewer && this.viewer.getYaw ? this.viewer.getYaw() : 0;
    const pitch = this.viewer && this.viewer.getPitch ? this.viewer.getPitch() : 0;
    const res = await API.tourSavePin({
      point_id: this.data.pointId, version_id: this.data.version.version_id,
      yaw: yaw, pitch: pitch, kind: 'note', text: text,
    });
    if (!res || res.ok === false) return this._err(res);
    Modal.toast('✅ บันทึกหมุดแล้ว');
    await this.loadVersion(this.data.version.version_id);
  },

  // ════════════════════════════════════════════════════════
  // 🧭 จัดการทางเดิน (ตั้งทิศลูกศร / ลบทางเดิน)
  // ════════════════════════════════════════════════════════
  // เจ้าของงานเจอ 2026-08-19: "ลูกศรชี้คนละทิศละทาง"
  //
  // ต้นเหตุ: ทิศลูกศรคำนวณจากตำแหน่งบนแปลน (บนแปลน = 0°) แต่ภาพ 360 แต่ละใบ
  //   "0° อยู่คนละที่กัน" เพราะ iOS ให้ค่ามุมหมุนแบบอ้างอิงจุดเริ่มจับสัญญาณ ไม่ใช่ทิศเหนือจริง
  //   → ต่อให้แปลนถูก ลูกศรก็ไปคนละทาง และแต่ละห้องเพี้ยนไม่เท่ากันด้วย
  //
  // ทำไมไม่ใช้เข็มทิศแก้: ไซต์งานเต็มไปด้วยเหล็ก (โครงสร้าง เหล็กเส้น ตู้เหล็ก)
  //   เข็มทิศในอาคารเพี้ยนได้หลายสิบองศาแบบเดาไม่ได้ → พึ่งไม่ได้
  // ทางที่แน่นอนกว่า: ให้คนแตะบอกในภาพว่า "ทางเดินอยู่ตรงนี้" ครั้งเดียวจบ ใช้ได้ตลอด
  //   (ทิศจากแปลนยังใช้เป็นค่าเริ่มต้นให้ ไม่ต้องเริ่มจากศูนย์)

  openLinks() {
    const pid = this.data.pointId;
    const outs = this.data.links.filter((l) => l.from_point === pid);
    const rows = outs.length
      ? outs.map((l) => {
        const to = this._pt(l.to_point) || {};
        return '<div style="display:flex;gap:8px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--color-slate-200)">' +
          '<span style="flex:1;min-width:0;text-align:left">' +
          '<span style="display:block;font-weight:700">ไป ' + this._esc(to.name || '?') + '</span>' +
          '<small style="color:var(--color-slate-500)">ทิศตอนนี้ ' + Math.round(Number(l.yaw) || 0) + '°</small></span>' +
          '<button class="btn btn-secondary btn-sm" onclick="Tour.aimLink(&quot;' + l.link_id + '&quot;)">ตั้งทิศ</button>' +
          '<button onclick="Tour.removeLink(&quot;' + l.link_id + '&quot;)" title="ลบทางเดิน" ' +
          'style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;' +
          'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
          'color:var(--color-error-700);cursor:pointer">✕</button>' +
          '</div>';
      }).join('')
      : '<div style="padding:16px;text-align:center;color:var(--color-slate-500);line-height:1.8">' +
        'ห้องนี้ยังไม่มีทางเดินออก<br><small>ไปโยงเส้นได้ที่หน้าแปลน (เครื่องมือ "ทางเดิน")</small></div>';

    Modal.show(
      '<div class="modal-title">ทางเดินจากห้องนี้</div>' +
      '<div class="modal-desc">กด "ตั้งทิศ" แล้วแตะตรงประตู/ทางเดินในภาพ ลูกศรจะย้ายไปอยู่ตรงนั้น</div>' +
      '<div style="max-height:44vh;overflow:auto;margin:8px 0;border:1px solid var(--color-slate-200);border-radius:12px">' + rows + '</div>' +
      '<div class="modal-btns"><button class="modal-btn modal-btn-cancel" onclick="Modal.close()">ปิด</button></div>');
  },

  aimLink(linkId) {
    Modal.close();
    this.data.aimLinkId = linkId;
    this.data.pinMode = false;
    const bar = document.getElementById('tv-pinbar');
    if (bar) {
      const l = this.data.links.find((x) => x.link_id === linkId) || {};
      const to = this._pt(l.to_point) || {};
      bar.style.display = 'flex';
      bar.firstElementChild.textContent = 'แตะตรงทางเดินไป "' + (to.name || '') + '" ในภาพ';
    }
  },

  async _saveLinkAim(yaw, pitch) {
    const linkId = this.data.aimLinkId;
    const l = this.data.links.find((x) => x.link_id === linkId);
    this.data.aimLinkId = null;
    const bar = document.getElementById('tv-pinbar');
    if (bar) bar.style.display = 'none';
    if (!l) return;

    this._busy(true, 'กำลังตั้งทิศลูกศร…');
    const res = await API.tourSaveLink({
      link_id: l.link_id, from_point: l.from_point, to_point: l.to_point,
      yaw: yaw, pitch: pitch, label: l.label || '',
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    const e = this._shot(this.data.pointId);
    if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
    this._busy(false);
    Modal.toast('✓ ตั้งทิศลูกศรแล้ว');
  },

  async removeLink(linkId) {
    // ⚠️ ห้าม Modal.close() ตรงนี้ — close ตั้งเวลาล้างเนื้อหาไว้ 200ms
    //    เปิด confirm ทันทีจะโดนล้างทิ้ง เหลือกล่องขาวเปล่า (เจ้าของงานเจอ 2026-08-19)
    //    Modal.show ทับของเดิมได้อยู่แล้ว ไม่ต้องปิดก่อน
    const l = this.data.links.find((x) => x.link_id === linkId);
    const to = l ? (this._pt(l.to_point) || {}).name : '';
    const ok = await Modal.confirm({
      title: 'ลบทางเดินนี้?',
      desc: 'ลูกศรไป "' + this._esc(to || '') + '" จะหายไป — โยงใหม่ได้ตลอดที่หน้าแปลน',
      icon: '🗑️', confirmText: 'ลบทางเดิน',
    });
    if (!ok) return;
    this._busy(true, 'กำลังลบ…');
    const res = await API.tourDeleteLink(linkId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    const e = this._shot(this.data.pointId);
    if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
    this._busy(false);
    Modal.toast('✓ ลบทางเดินแล้ว');
  },

  // ════════════════════════════════════════════════════════
  // 🏷️ ป้ายชิ้นงานในภาพ 360 (FF tag)
  // ════════════════════════════════════════════════════════
  // เจ้าของงานเคาะ 2026-08-19: "เข้าไปดูใน 360 แล้วอยากกดปุ่มชี้ว่าตรงนี้คือ FF-02"
  // ป้ายผูกกับ "จุด" ไม่ใช่ "เวอร์ชัน" → ปักครั้งเดียวเห็นทุกเวอร์ชัน
  //   (ตู้ตัวเดิมอยู่ที่เดิมทุกรอบ ไม่ต้องมาปักใหม่ทุกครั้งที่สแกน)

  // ── แผงจัดการแท็กชิ้นงาน (ปุ่มเดียวจบ) ────────────────────
  // เจ้าของงานเคาะ 2026-08-19: "เอาเป็นปุ่มแท็ก กดแล้วเลือกว่าจัดการแท็ก หรือซ่อนแท็ก"
  // รวม 3 อย่างไว้ปุ่มเดียว: ปักใหม่ / จัดการของเดิม / ซ่อน-แสดง → ลดปุ่มบนจอลง 1 ปุ่ม
  async openTags() {
    await this.loadFF();
    const pins = (this.data.pins || []).filter((p) => p.point_id === this.data.pointId);
    const e = this._shot(this.data.pointId);
    const canPin = !!(e && e.shot && !e.fallback_from_version);

    const rows = pins.length
      ? pins.map((p) => {
        const ff = p.kind === 'ff' ? this._ffOf(p.ref_id) : null;
        const top = p.kind === 'ff' ? this._esc(p.ref_id) : this._esc((p.text || 'หมายเหตุ').slice(0, 30));
        const sub = ff ? this._esc(ff.name) : (p.kind === 'ff' ? 'ไม่พบชิ้นงานนี้ในระบบแล้ว' : '');
        return '<div style="display:flex;gap:8px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--color-slate-200)">' +
          '<span style="flex:1;min-width:0;text-align:left">' +
          '<span style="display:block;font-weight:700;color:var(--color-blue-700)">' + top + '</span>' +
          (sub ? '<small style="color:var(--color-slate-500)">' + sub + '</small>' : '') + '</span>' +
          '<button class="btn btn-secondary btn-sm" onclick="Tour.moveTag(&quot;' + p.pin_id + '&quot;)">ย้าย</button>' +
          '<button onclick="Tour.deleteTag(&quot;' + p.pin_id + '&quot;)" title="ลบแท็ก" ' +
          'style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;' +
          'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
          'color:var(--color-error-700);cursor:pointer">✕</button>' +
          '</div>';
      }).join('')
      : '<div style="padding:18px;text-align:center;color:var(--color-slate-500);line-height:1.8">' +
        'ห้องนี้ยังไม่มีแท็ก<br><small>กด "ปักแท็กใหม่" แล้วแตะตรงเฟอร์นิเจอร์ในภาพ</small></div>';

    Modal.show(
      '<div class="modal-title">แท็กชิ้นงานในห้องนี้ (' + pins.length + ')</div>' +
      '<div style="max-height:38vh;overflow:auto;margin:10px 0;border:1px solid var(--color-slate-200);border-radius:12px">' + rows + '</div>' +
      (canPin
        ? '<button class="btn btn-primary btn-block" onclick="Tour.startPinMode()">ปักแท็กใหม่</button>'
        : '<div class="modal-info">ปักแท็กได้เฉพาะภาพของเวอร์ชันนี้เอง (ตอนนี้กำลังดูภาพสำรอง)</div>') +
      '<button class="btn btn-secondary btn-block" style="margin-top:8px" onclick="Tour.toggleTags()">' +
      (this.data.showTags ? 'ซ่อนแท็กทั้งหมด' : 'แสดงแท็ก') + '</button>' +
      '<div class="modal-btns"><button class="modal-btn modal-btn-cancel" onclick="Modal.close()">ปิด</button></div>');
  },

  startPinMode() {
    Modal.close();
    this.data.pinMode = true;
    this.data.aimLinkId = null;
    this.data.aimPinId = null;
    this.data.showTags = true;
    const bar = document.getElementById('tv-pinbar');
    if (bar) { bar.style.display = 'flex'; bar.firstElementChild.textContent = 'แตะตรงชิ้นงานในภาพเพื่อปักแท็ก'; }
  },

  moveTag(pinId) {
    Modal.close();
    this.data.aimPinId = pinId;
    this.data.pinMode = false;
    this.data.aimLinkId = null;
    const bar = document.getElementById('tv-pinbar');
    if (bar) { bar.style.display = 'flex'; bar.firstElementChild.textContent = 'แตะตำแหน่งใหม่ของแท็กในภาพ'; }
  },

  async _saveTagAim(yaw, pitch) {
    const pinId = this.data.aimPinId;
    this.data.aimPinId = null;
    const bar = document.getElementById('tv-pinbar');
    if (bar) bar.style.display = 'none';
    const pin = (this.data.pins || []).find((p) => p.pin_id === pinId);
    if (!pin) return;
    await this._savePin({
      pin_id: pinId, kind: pin.kind, ref_id: pin.ref_id, text: pin.text, yaw: yaw, pitch: pitch,
    });
  },

  // ⚠️ ห้ามเรียก Modal.close() ก่อน Modal.confirm() — close ตั้งเวลาล้างเนื้อหาไว้ 200ms
  //    ถ้าเปิดอันใหม่ทันที เนื้อหาจะถูกล้างทิ้ง เหลือกล่องขาวเปล่าๆ
  //    (บทเรียนเดิมของโปรเจกต์นี้ — เจ้าของงานเจอซ้ำ 2026-08-19 ตอนกดลบทางเดิน)
  async deleteTag(pinId) {
    const pin = (this.data.pins || []).find((p) => p.pin_id === pinId);
    const ff = pin && pin.kind === 'ff' ? this._ffOf(pin.ref_id) : null;
    const ok = await Modal.confirm({
      title: 'ลบแท็กนี้?',
      desc: ff ? (pin.ref_id + ' · ' + ff.name) : ((pin && pin.text) || ''),
      icon: '🗑️', confirmText: 'ลบแท็ก',
    });
    if (!ok) return;
    this._busy(true, 'กำลังลบแท็ก…');
    const res = await API.tourDeletePin(pinId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    try {
      await this.loadVersion(this.data.version.version_id);
      const e = this._shot(this.data.pointId);
      if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
    } catch (err) { /* */ }
    this._busy(false);
    Modal.toast('✓ ลบแท็กแล้ว');
  },

  async loadFF() {
    if (this.data.ff && this.data.ff.length) return this.data.ff;
    try {
      const r = await API.getFFList();
      this.data.ff = (r && (r.data || r)) || [];
    } catch (e) { this.data.ff = []; }
    return this.data.ff;
  },

  _ffOf(code) {
    return (this.data.ff || []).find((f) => String(f.code) === String(code)) || null;
  },

  toggleTags() {
    Modal.close();
    this.data.showTags = !this.data.showTags;
    const b = document.getElementById('btn-tags');
    if (b) b.style.opacity = this.data.showTags ? '1' : '0.45';
    Modal.toast(this.data.showTags ? 'แสดงแท็กชิ้นงาน' : 'ซ่อนแท็กชิ้นงาน');
    const e = this._shot(this.data.pointId);
    if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
  },

  // เปิด/ปิดโหมดปัก — ปักได้เฉพาะภาพของเวอร์ชันนี้เอง (ไม่ใช่ภาพสำรอง)
  async togglePinMode() {
    const e = this._shot(this.data.pointId);
    if (!e || !e.shot) return Modal.toast('⚠️ จุดนี้ยังไม่มีภาพ');
    if (e.fallback_from_version) return Modal.toast('⚠️ ปักได้เฉพาะภาพของเวอร์ชันนี้เอง');

    this.data.pinMode = !this.data.pinMode;
    const bar = document.getElementById('tv-pinbar');
    if (bar) bar.style.display = this.data.pinMode ? 'flex' : 'none';
    const b = document.getElementById('btn-pin');
    if (b) b.style.background = this.data.pinMode ? 'var(--color-blue-500)' : '';
    if (this.data.pinMode) {
      this.data.showTags = true;
      await this.loadFF();
      Modal.toast('แตะตรงชิ้นงานในภาพได้เลย');
    }
  },

  // แตะบนภาพ 360 ตอนอยู่ในโหมดปัก → รู้ว่าแตะตรงมุมไหน
  _bindPinTap(container) {
    if (!container || container._pinBound) return;
    container._pinBound = true;
    let sx = 0, sy = 0, moved = false;
    container.addEventListener('pointerdown', (ev) => { sx = ev.clientX; sy = ev.clientY; moved = false; });
    container.addEventListener('pointermove', (ev) => {
      if (Math.abs(ev.clientX - sx) > 8 || Math.abs(ev.clientY - sy) > 8) moved = true;
    });
    container.addEventListener('pointerup', (ev) => {
      // ลากเพื่อส่ายภาพ ไม่ใช่การแตะ — ไม่งั้นส่ายทีปักหมุดที
      if (moved || !this.viewer) return;
      if (!this.data.pinMode && !this.data.aimLinkId && !this.data.aimPinId) return;
      let c = null;
      try { c = this.viewer.mouseEventToCoords(ev); } catch (err) { c = null; }
      if (!c) return;
      if (this.data.aimLinkId) return this._saveLinkAim(c[1], c[0]);   // pannellum คืน [pitch, yaw]
      if (this.data.aimPinId) return this._saveTagAim(c[1], c[0]);
      this.pickFFAt(c[1], c[0]);
    });
  },

  // เลือกว่าตรงนั้นคือชิ้นงานไหน
  async pickFFAt(yaw, pitch) {
    await this.loadFF();
    const list = this.data.ff;
    const rows = list.length
      ? list.map((f) =>
        '<div onclick="Tour._savePinFF(&quot;' + this._esc(f.code) + '&quot;)" ' +
        'style="display:flex;gap:10px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--color-slate-200);cursor:pointer;text-align:left">' +
        '<span style="flex:none;min-width:52px;font-weight:800;color:var(--color-blue-700)">' + this._esc(f.code) + '</span>' +
        '<span style="flex:1;min-width:0"><span style="display:block;font-weight:600">' + this._esc(f.name) + '</span>' +
        '<small style="color:var(--color-slate-500)">' + this._esc(f.area || '') + '</small></span></div>').join('')
      : '<div style="padding:16px;text-align:center;color:var(--color-slate-500)">โครงการนี้ยังไม่มีรายการชิ้นงาน</div>';

    this._pendingPin = { yaw: yaw, pitch: pitch };
    Modal.show(
      '<div class="modal-title">ตรงนี้คือชิ้นงานอะไร</div>' +
      '<div class="modal-desc">เลือกจากรายการงานของโครงการ</div>' +
      '<div style="max-height:46vh;overflow:auto;margin:8px 0;border:1px solid var(--color-slate-200);border-radius:12px">' + rows + '</div>' +
      '<div class="modal-btns">' +
      '<button class="modal-btn modal-btn-cancel" onclick="Modal.close()">ยกเลิก</button>' +
      '<button class="modal-btn" onclick="Tour._savePinNote()">พิมพ์หมายเหตุแทน</button>' +
      '</div>');
  },

  async _savePinFF(code) {
    Modal.close();
    const p = this._pendingPin;
    if (!p) return;
    this._pendingPin = null;
    await this._savePin({ kind: 'ff', ref_id: code, text: '', yaw: p.yaw, pitch: p.pitch });
  },

  async _savePinNote() {
    Modal.close();
    const p = this._pendingPin;
    if (!p) return;
    this._pendingPin = null;
    const text = prompt('พิมพ์หมายเหตุสำหรับจุดนี้');
    if (!text) return;
    await this._savePin({ kind: 'note', ref_id: '', text: text, yaw: p.yaw, pitch: p.pitch });
  },

  async _savePin(o) {
    this._busy(true, 'กำลังบันทึกป้าย…');
    const res = await API.tourSavePin({
      pin_id: o.pin_id || '',               // มี = แก้ของเดิม (ย้ายตำแหน่ง) · ว่าง = ปักใหม่
      point_id: this.data.pointId,
      version_id: '',                       // ว่าง = ติดทุกเวอร์ชัน (ตู้ตัวเดิมอยู่ที่เดิมทุกรอบ)
      yaw: o.yaw, pitch: o.pitch,
      kind: o.kind, ref_id: o.ref_id, text: o.text,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    try {
      await this.loadVersion(this.data.version.version_id);
      const e = this._shot(this.data.pointId);
      if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
    } catch (e) { /* */ }
    this._busy(false);
    Modal.toast('✓ ปักป้ายแล้ว');
  },

  // แตะป้ายที่ปักไว้ → ดูรายละเอียด / ลบ
  async openPin(pinId) {
    const pin = (this.data.pins || []).find((p) => p.pin_id === pinId);
    if (!pin) return;
    const ff = pin.kind === 'ff' ? this._ffOf(pin.ref_id) : null;
    const ok = await Modal.confirm({
      title: ff ? (pin.ref_id + ' · ' + ff.name) : (pin.ref_id || 'หมายเหตุ'),
      desc: ff ? ('พื้นที่: ' + (ff.area || '-') + '\nสถานะ: ' + (ff.status || '-')) : (pin.text || ''),
      info: 'ปักโดย ' + this._esc(pin.created_by || '-'),
      icon: '🏷️', iconClass: 'info',
      confirmText: 'ลบป้ายนี้', cancelText: 'ปิด',
      confirmClass: 'modal-btn-warn',
    });
    if (!ok) return;
    this._busy(true, 'กำลังลบป้าย…');
    const res = await API.tourDeletePin(pinId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    try {
      await this.loadVersion(this.data.version.version_id);
      const e = this._shot(this.data.pointId);
      if (e && e.shot) this._renderShot(e.shot, this.data.pointId);
    } catch (e) { /* */ }
    this._busy(false);
    Modal.toast('✓ ลบป้ายแล้ว');
  },

  // ── ปรับภาพ (แก้ตอนระบบเดาความกว้างผิด / ภาพหันเบี้ยวจากรอบก่อน) ──
  // ระบบเดาความกว้างของพาโนจากสัดส่วนภาพ ซึ่งถูกเกือบทุกครั้งแต่ไม่เสมอไป
  // ถ้าเดาผิด ภาพจะดูยืดหรือหด — ตรงนี้คือที่ให้คนแก้เองโดยไม่ต้องถ่ายใหม่
  adjustShot() {
    const entry = this._shot(this.data.pointId);
    if (!entry || entry.no_image || !entry.shot) return Modal.toast('⚠️ จุดนี้ยังไม่มีภาพ');
    if (entry.fallback_from_version) return Modal.toast('⚠️ ปรับได้เฉพาะภาพของเวอร์ชันนี้เอง');

    const shot = entry.shot;
    const old = document.getElementById('tour-adjust');
    if (old) old.remove();

    const isSphere = shot.kind === 'sphere';
    const haov = Number(shot.haov) || (isSphere ? 360 : 180);
    const panel = document.createElement('div');
    panel.id = 'tour-adjust';
    panel.style.cssText = 'position:absolute;left:12px;right:12px;bottom:76px;z-index:30;padding:14px 16px;' +
      'border-radius:14px;background:rgba(15,23,42,.92);color:#fff;backdrop-filter:blur(6px);' +
      'box-shadow:0 8px 28px rgba(0,0,0,.4);font-size:14px';
    panel.innerHTML =
      '<div style="font-weight:600;margin-bottom:10px">ปรับภาพ</div>' +
      (isSphere ? '' :
        '<label style="display:block;margin-bottom:4px">ความกว้างของภาพ <b id="adj-haov-v">' + Math.round(haov) + '°</b>' +
        '<div style="opacity:.7;font-size:12px">กวาดครึ่งห้อง ≈ 120° · กวาดสุดของ iPhone ≈ 240°</div></label>' +
        '<input type="range" id="adj-haov" min="60" max="300" step="5" value="' + Math.round(haov) + '" style="width:100%;margin-bottom:12px">') +
      '<label style="display:block;margin-bottom:4px">หันหน้าเริ่มต้น' +
      '<div style="opacity:.7;font-size:12px">ส่ายภาพให้หันทางเดียวกับเวอร์ชันอื่น แล้วกดบันทึก</div></label>' +
      '<div style="display:flex;gap:8px;margin-top:12px">' +
      '<button class="btn btn-secondary btn-sm" style="flex:1" onclick="Tour.closeAdjust()">ปิด</button>' +
      '<button class="btn btn-primary btn-sm" style="flex:1" onclick="Tour.saveAdjust()">บันทึก</button>' +
      '</div>';
    document.getElementById('mode-view').appendChild(panel);

    const sl = document.getElementById('adj-haov');
    if (sl) {
      sl.oninput = () => { document.getElementById('adj-haov-v').innerText = sl.value + '°'; };
      // เปลี่ยนความกว้างต้องสร้างตัวเล่นใหม่ → ทำตอนปล่อยนิ้วเท่านั้น ไม่งั้นกระตุก
      sl.onchange = () => {
        shot.haov = Number(sl.value);
        shot.vaov = Math.max(40, Math.min(90, Number(sl.value) / 4));
        shot.yaw_offset = this.viewer && this.viewer.getYaw ? this.viewer.getYaw() : shot.yaw_offset;
        this._renderShot(shot, this.data.pointId);
      };
    }
  },

  closeAdjust() {
    const el = document.getElementById('tour-adjust');
    if (el) el.remove();
  },

  async saveAdjust() {
    const entry = this._shot(this.data.pointId);
    if (!entry || !entry.shot) return this.closeAdjust();
    const shot = entry.shot;
    const yaw = this.viewer && this.viewer.getYaw ? this.viewer.getYaw() : Number(shot.yaw_offset) || 0;
    this._busy(true, 'กำลังบันทึก…');
    const res = await API.tourUpdateShot({
      shot_id: shot.shot_id, yaw_offset: yaw,
      kind: shot.kind, haov: shot.haov, vaov: shot.vaov,
    });
    this._busy(false);
    if (!res || res.ok === false) return this._err(res);
    shot.yaw_offset = yaw;
    this.closeAdjust();
    Modal.toast('✅ บันทึกการปรับแล้ว');
  },

  toggleCompare() { Modal.toast('ระบบเทียบ 2 เวอร์ชันอยู่ในเฟสถัดไป'); },
  goHome() { this.switchMode('home'); },

  // ── สลับโหมด ─────────────────────────────────────────────
  switchMode(mode) {
    this.data.mode = mode;
    document.getElementById('mode-home').style.display = mode === 'home' ? 'flex' : 'none';
    document.getElementById('mode-view').style.display = mode === 'view' ? 'flex' : 'none';
    document.getElementById('mode-capture').style.display = mode === 'capture' ? 'block' : 'none';
    document.getElementById('mode-map').style.display = mode === 'map' ? 'block' : 'none';
    this.closeVersionSelector();
    if (mode === 'home') this.renderHome();
    if (mode === 'capture') this.renderCaptureList();
    if (mode === 'map') { this.renderMap(); this.loadTrash().then(() => this.renderTrash()); }
  },

  // ════════════════════════════════════════════════════════
  // 📸 โหมดถ่ายเวอร์ชันใหม่
  // ════════════════════════════════════════════════════════
  enterCaptureMode() {
    // เสนอชื่อให้ก่อน — พนักงานแค่แตะ ไม่ต้องคิดเอง
    const nameEl = document.getElementById('tc-name');
    if (nameEl && !nameEl.value) {
      const d = new Date();
      nameEl.value = 'สภาพหน้างาน ' + d.getDate() + '/' + (d.getMonth() + 1);
    }
    this.switchMode('capture');
  },

  renderCaptureList() {
    const list = document.getElementById('tc-point-list');
    if (!list) return;
    // ยังไม่มีจุดเลย = ไม่ต้องไปตั้งค่าอะไรก่อน ถ่ายได้เลย แล้วจุดจะถูกสร้างให้ตอนตั้งชื่อ
    if (!this.data.points.length) {
      list.innerHTML = '<div class="text-muted" style="padding:16px;text-align:center;line-height:1.8">' +
        'ยังไม่มีจุดถ่ายในโครงการนี้<br><span style="font-size:13px">ถ่ายได้เลย — ตั้งชื่อห้องตอนอัปรูป จุดจะถูกสร้างให้อัตโนมัติ</span>' +
        '<div style="margin-top:12px"><button class="btn btn-primary" onclick="Tour.captureNewPoint()"><i data-lucide="camera"></i> สแกนจุดแรก</button></div>' +
        '</div>';
      document.getElementById('tc-progress-text').innerText = '0/0 จุด';
      document.getElementById('tc-progress-bar').style.width = '0%';
      return;
    }

    const done = this.data.captureDone || {};
    list.innerHTML = this.data.points.map((p) => {
      const ok = !!done[p.point_id];
      return '<div class="point-row ' + (ok ? 'done' : '') + '">' +
        '<div class="flex items-center gap-2">' +
        (ok ? '<i data-lucide="check-circle-2" style="color:var(--color-success-500)"></i>'
            : '<i data-lucide="circle" class="text-muted"></i>') +
        '<span class="font-semibold">' + this._esc(p.name) + '</span></div>' +
        '<div style="display:flex;gap:6px">' +
        '<button class="btn ' + (ok ? 'btn-ghost' : 'btn-primary') + ' btn-sm" ' +
        'onclick="Tour.scanFor(\'' + p.point_id + '\')"><i data-lucide="camera" style="width:16px;height:16px"></i> ' + (ok ? 'สแกนใหม่' : 'สแกน') + '</button>' +
        '<button class="btn btn-ghost btn-sm" title="เลือกรูปจากคลังภาพ" ' +
        'onclick="Tour.pickPhotoFor(\'' + p.point_id + '\')"><i data-lucide="image" style="width:16px;height:16px"></i></button>' +
        '</div>' +
        '</div>';
    }).join('');

    list.innerHTML += '<div style="text-align:center;margin-top:12px">' +
      '<button class="btn btn-ghost btn-sm" onclick="Tour.captureNewPoint()"><i data-lucide="plus"></i> เพิ่มจุดใหม่แล้วถ่ายเลย</button></div>';

    const n = Object.keys(done).length;
    document.getElementById('tc-progress-text').innerText = n + '/' + this.data.points.length + ' จุด';
    document.getElementById('tc-progress-bar').style.width =
      Math.round((n / this.data.points.length) * 100) + '%';
    if (window.lucide) lucide.createIcons();
  },

  // ต้องมีเวอร์ชัน draft ก่อนถึงจะอัปรูปได้ — จัดให้เองทั้งหมด ไม่เด้งไปถามชื่อกลางทาง
  // ⚠️ เดิม: ปักหมุดบนแปลนแล้วกด "สแกนเลย" จะโดนเด้งว่า "ใส่ชื่อเวอร์ชันก่อน"
  //    ต้องออกไปกดปุ่มสแกนมุมขวาบน ตั้งชื่อ แล้วค่อยกลับมา = ฟริกชันเปล่าๆ (เจ้าของงานเจอเอง 2026-08-19)
  async _ensureDraft() {
    if (this.data.draftVersionId) return this.data.draftVersionId;

    // มีฉบับร่างค้างอยู่แล้วก็ใช้ต่อ — สแกนทีละห้องจะได้อยู่ในเวอร์ชันเดียวกัน ไม่แตกเป็นหลายเวอร์ชัน
    const draft = (this.data.versions || []).find((v) => v.status === 'draft');
    if (draft) {
      this.data.draftVersionId = draft.version_id;
      this.data.captureDone = this.data.captureDone || {};
      return draft.version_id;
    }

    let name = ((document.getElementById('tc-name') || {}).value || '').trim();
    if (!name) {                                   // ไม่ได้ตั้งชื่อ = ตั้งให้เลย แก้ทีหลังได้
      const d = new Date();
      name = 'สภาพหน้างาน ' + d.getDate() + '/' + (d.getMonth() + 1);
      const el = document.getElementById('tc-name');
      if (el) el.value = name;
    }
    const res = await API.tourCreateVersion({ name: name });
    if (!res || res.ok === false) { this._err(res, 'สร้างเวอร์ชันไม่สำเร็จ'); return null; }
    const d = res.data || res;
    this.data.draftVersionId = d.version_id;
    this.data.captureDone = {};
    return d.version_id;
  },

  /**
   * ⚠️ ตั้งใจเปิด "คลังภาพ" ไม่ใช่กล้องผ่านเว็บ
   * กล้องที่เปิดจากหน้าเว็บ (capture) ไม่มีโหมดพาโนรามาให้เลือก → ถ่ายพาโนไม่ได้เลย
   * ขั้นตอนจริง: ถ่ายพาโนด้วยแอปกล้องปกติให้ครบก่อน แล้วค่อยเข้ามาเลือกรูป
   */
  // ทางลัด "ถ่ายเลยไม่ต้องตั้งค่าก่อน" — ตั้งชื่อห้อง → เลือกรูป → ระบบสร้างจุดให้แล้วอัปให้เสร็จในทีเดียว
  async captureNewPoint() {
    const name = prompt('ห้องนี้ชื่ออะไร (เช่น ห้องนอนใหญ่)');
    if (!name) return;
    const i = this.data.points.length;
    this._busy(true, 'กำลังสร้างจุด…');
    const res = await API.tourSavePoint({
      name: name,
      plan_id: (this.data.plans[0] || {}).plan_id || '',
      plan_x: Math.min(0.9, 0.15 + (i % 4) * 0.23),
      plan_y: Math.min(0.9, 0.2 + Math.floor(i / 4) * 0.22),
      sort_order: i + 1,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this._busy(false);
    this.renderCaptureList();
    const d = res.data || res;
    this.scanFor(d.point_id);
  },

  // สแกน 360 ในแอปเลย (ไม่ต้องพึ่งแอปนอก) — ดู js/pano-capture.js
  async scanFor(pointId) {
    if (!window.PanoCapture) return this.pickPhotoFor(pointId);
    const vid = await this._ensureDraft();
    if (!vid) return;
    PanoCapture.start({
      onDone: (res) => this.uploadDataUrl(pointId, res.dataUrl, res.w, res.h),
      onFallback: () => this.pickPhotoFor(pointId),   // กล้องไม่ได้ → ไปเลือกรูปจากคลังแทน
    });
  },

  // อัปรูปที่ได้จากตัวสแกน (เป็น dataURL อยู่แล้ว ไม่ต้องบีบซ้ำ)
  async uploadDataUrl(pointId, dataUrl, w, h) {
    const vid = await this._ensureDraft();
    if (!vid) return;
    this._busy(true, 'กำลังอัปโหลดภาพ 360…');
    const res = await API.tourUploadShot({
      version_id: vid, point_id: pointId,
      image_base64: dataUrl, width: w, height: h, taken_at: '',
    });
    this._busy(false);
    if (!res || res.ok === false) return this._err(res, 'อัปรูปไม่สำเร็จ');
    this.data.captureDone = this.data.captureDone || {};
    this.data.captureDone[pointId] = true;

    // สแกนจากแปลน → หมุดต้องเปลี่ยนเป็นสีเขียวทันที ไม่ต้องรีเฟรชเอง
    if (this.data.mode === 'home') {
      try {
        await this.loadConfig(true);
        await this.loadVersion(this.data.draftVersionId);
        this.renderHome();
      } catch (e) { /* โหลดไม่ได้ก็ไม่เป็นไร รูปอัปไปแล้ว */ }
    } else {
      this.renderCaptureList();
    }
    Modal.toast('✓ เก็บภาพ 360 แล้ว');
  },

  pickPhotoFor(pointId) {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (f) await this.uploadFor(pointId, f);
    };
    inp.click();
  },

  async uploadFor(pointId, file) {
    const vid = await this._ensureDraft();
    if (!vid) return;
    this._busy(true, 'กำลังย่อรูปและอัปโหลด…');
    try {
      const img = await this._compress(file, 4096, 0.82);
      const res = await API.tourUploadShot({
        version_id: vid, point_id: pointId,
        image_base64: img.dataUrl, width: img.w, height: img.h,
        taken_at: file.lastModified ? new Date(file.lastModified).toISOString() : '',
      });
      if (!res || res.ok === false) { this._busy(false); return this._err(res, 'อัปรูปไม่สำเร็จ'); }
      const d = res.data || res;
      this.data.captureDone = this.data.captureDone || {};
      this.data.captureDone[pointId] = true;
      this.renderCaptureList();
      const kindTxt = d.kind === 'sphere' ? '360 เต็มใบ' : d.kind === 'pano' ? 'พาโนรามา' : 'รูปธรรมดา';
      Modal.toast('✅ อัปแล้ว (' + kindTxt + ')');
    } catch (e) {
      this._err({ error: e.message }, 'อัปรูปไม่สำเร็จ');
    }
    this._busy(false);
  },

  // ย่อด้านยาวเหลือ 4096px คุณภาพ 82% → ~0.8-1.5 MB ยังคมพอส่องดูงานไม้
  _compress(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onerror = () => reject(new Error('อ่านไฟล์ไม่สำเร็จ'));
      rd.onload = (ev) => {
        const img = new Image();
        img.onerror = () => reject(new Error('เปิดรูปไม่สำเร็จ (ไฟล์อาจไม่ใช่รูปภาพ)'));
        img.onload = () => {
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > maxDim || h > maxDim) {
            if (w >= h) { h = Math.round(h * maxDim / w); w = maxDim; }
            else { w = Math.round(w * maxDim / h); h = maxDim; }
          }
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          try { resolve({ dataUrl: c.toDataURL('image/jpeg', quality), w: w, h: h }); }
          catch (err) { reject(err); }
        };
        img.src = ev.target.result;
      };
      rd.readAsDataURL(file);
    });
  },

  // ดูผลที่เพิ่งสแกนโดยยังไม่เผยแพร่ — เจ้าของงานต้องเช็คงานตัวเองก่อนให้ทีมเห็น (2026-08-19)
  async previewDraft() {
    const vid = this.data.draftVersionId;
    if (!vid) return Modal.toast('⚠️ ยังไม่ได้สแกนสักห้อง');
    this._busy(true, 'กำลังเปิดดู…');
    try {
      await this.loadConfig(true);
      await this.loadVersion(vid);
      this.switchMode('home');
      Modal.toast('👀 นี่คือฉบับร่าง — ทีมยังไม่เห็น');
    } catch (e) { this._err({ error: e.message }); }
    this._busy(false);
  },

  async publishNewVersion() {
    const vid = this.data.draftVersionId;
    if (!vid) return Modal.toast('⚠️ ยังไม่ได้ถ่ายรูปสักจุด');
    const n = Object.keys(this.data.captureDone || {}).length;
    const total = this.data.points.length;
    // ไม่ล็อกปุ่ม — บางเวอร์ชันตั้งใจถ่ายแค่ห้องที่มีความคืบหน้า แค่ถามยืนยันให้รู้ตัว
    const ok = await Modal.confirm({
      title: 'เผยแพร่ให้ทีมดู',
      desc: 'ถ่ายไป ' + n + ' จาก ' + total + ' จุด' +
        (n < total ? ' — ห้องที่เหลือจะแสดงภาพจากเวอร์ชันก่อนหน้า พร้อมป้ายบอกว่าเป็นภาพเก่า' : ''),
      icon: '🚀', iconClass: 'info',
      confirmText: 'เผยแพร่เลย', confirmClass: 'modal-btn-primary',
    });
    if (!ok) return;

    this._busy(true, 'กำลังเผยแพร่…');
    const res = await API.tourPublishVersion(vid);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    this.data.draftVersionId = null;
    this.data.captureDone = {};
    document.getElementById('tc-name').value = '';
    try {
      await this.loadConfig(true);
      await this.loadVersion(vid);
      this.switchMode('home');
      Modal.toast('✅ เผยแพร่แล้ว ทีมเห็นได้แล้ว');
    } catch (e) { this._err({ error: e.message }); }
    this._busy(false);
  },

  // ════════════════════════════════════════════════════════
  // 🗺️ โหมดวางจุดและเส้นทาง (ทำครั้งเดียวตอนเปิดโครงการ)
  // ════════════════════════════════════════════════════════
  setMapTool(tool) {
    this.data.mapTool = tool;
    this.data.linkFrom = null;
    this.renderMap();
  },

  renderMap() {
    const wrap = document.getElementById('map-canvas-wrap');
    if (!wrap) return;
    const plan = this.data.plans[0] || null;

    document.querySelectorAll('.map-toolbar .btn').forEach((b) => b.classList.remove('active'));
    const btn = document.getElementById('map-tool-' + this.data.mapTool);
    if (btn) btn.classList.add('active');

    // ไม่มีแปลนก็ใช้งานได้ — แปลนเป็นแค่ "แผนที่ช่วยจำ" ไม่ใช่ของบังคับ
    if (!plan) {
      wrap.innerHTML = '<div class="center-msg text-muted"><i data-lucide="map"></i>' +
        '<div style="margin:12px 0;line-height:1.7">ยังไม่มีแปลนพื้น<br>' +
        '<span style="font-size:13px">เพิ่มจุดเป็นรายชื่อห้องได้เลย · แปลนใส่ทีหลังก็ได้<br>รองรับทั้งรูปภาพและไฟล์ PDF</span></div>' +
        '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
        '<button class="btn btn-primary btn-sm" onclick="Tour.addPointManually()"><i data-lucide="plus"></i> เพิ่มจุด</button>' +
        '<button class="btn btn-secondary btn-sm" onclick="Tour.pickPlan()">อัปแปลนพื้น</button>' +
        '</div></div>';
      if (window.lucide) lucide.createIcons();
      this.renderMapPointList();
      this.renderTrash();
      return;
    }

    const hint = this.data.mapTool === 'point'
      ? 'แตะบนแปลนเพื่อวางจุดใหม่'
      : (this.data.linkFrom
        ? 'แตะจุดปลายทาง (จาก "' + this._esc((this._pt(this.data.linkFrom) || {}).name) + '")'
        : 'แตะจุดต้นทางก่อน');

    wrap.innerHTML =
      '<div id="map-plan-box" style="position:relative;width:100%;user-select:none" onclick="Tour.onPlanClick(event)">' +
      '<img src="' + plan.url + '" style="width:100%;display:block;border-radius:8px" draggable="false">' +
      this.data.points.map((p) =>
        '<div class="mm-point" style="left:' + ((Number(p.plan_x) || 0) * 100) + '%;top:' + ((Number(p.plan_y) || 0) * 100) + '%;' +
        (this.data.linkFrom === p.point_id ? 'outline:3px solid var(--color-warning-500);' : '') +
        'cursor:pointer" title="' + this._esc(p.name) + '" ' +
        'onclick="event.stopPropagation(); Tour.onPointClick(\'' + p.point_id + '\')"></div>').join('') +
      '</div>' +
      '<div class="text-sm text-muted" style="margin-top:8px;text-align:center">' + hint + '</div>';

    this.renderMapPointList();
    this.renderTrash();
    if (window.lucide) lucide.createIcons();
  },

  renderMapPointList() {
    const box = document.getElementById('map-point-list');
    if (!box) return;
    const linking = this.data.mapTool === 'link';
    const addBtn = '<button class="btn btn-secondary btn-sm" onclick="Tour.addPointManually()"><i data-lucide="plus"></i> เพิ่มจุด</button>';

    if (!this.data.points.length) {
      box.innerHTML = '<div style="margin-top:16px;text-align:center">' + addBtn + '</div>';
      return;
    }

    box.innerHTML =
      '<div class="flex justify-between items-center" style="margin-top:16px">' +
      '<div class="form-label mb-0">จุดทั้งหมด (' + this.data.points.length + ')</div>' + addBtn + '</div>' +
      (linking ? '<div class="text-sm text-muted" style="margin:6px 0">' +
        (this.data.linkFrom
          ? 'แตะจุดปลายทาง (จาก "' + this._esc((this._pt(this.data.linkFrom) || {}).name) + '")'
          : 'แตะจุดต้นทางก่อน — ไม่ต้องมีแปลนก็โยงได้') + '</div>' : '') +
      this.data.points.map((p) => {
        const outs = this.data.links.filter((l) => l.from_point === p.point_id)
          .map((l) => (this._pt(l.to_point) || {}).name || '?').join(', ');
        const picked = this.data.linkFrom === p.point_id;
        return '<div class="point-row" ' +
          (linking ? 'onclick="Tour.onPointClick(\'' + p.point_id + '\')" style="cursor:pointer;' +
            (picked ? 'outline:2px solid var(--color-warning-500)' : '') + '"' : '') + '>' +
          '<div><div class="font-semibold">' + this._esc(p.name) + '</div>' +
          '<div class="text-sm text-muted">' + (outs ? '→ ' + this._esc(outs) : 'ยังไม่มีทางเดินออก') + '</div></div>' +
          // ปุ่มลบต้องเห็นชัดว่าเป็นปุ่ม — เดิมใช้ btn-ghost แล้วมันจางจนดูเหมือนตัวหนังสือ
          // เจ้าของงานหาไม่เจอจริงๆ ตอนจะลบจุดที่เพิ่มผิด (2026-08-19)
          (linking ? '<i data-lucide="' + (picked ? 'crosshair' : 'chevron-right') + '"></i>'
            : '<button onclick="Tour.removePoint(\'' + p.point_id + '\')" ' +
              'style="display:flex;align-items:center;gap:6px;min-height:44px;padding:0 14px;' +
              'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
              'color:var(--color-error-700);font-weight:600;font-size:14px;cursor:pointer">' +
              '<i data-lucide="trash-2" style="width:16px;height:16px"></i> ลบ</button>') +
          '</div>';
      }).join('');
    if (window.lucide) lucide.createIcons();
  },

  // เพิ่มจุดโดยไม่ต้องมีแปลน — วางตำแหน่งบนแผนผังให้อัตโนมัติแบบเรียงตาราง
  // (ไว้ให้แผนผังจิ๋วยังพอใช้ได้ · ถ้าอัปแปลนทีหลังก็ลากย้ายให้ตรงจริงได้)
  async addPointManually() {
    const name = prompt('ชื่อจุดนี้ (เช่น ห้องนอนใหญ่ – มุมประตู)');
    if (!name) return;
    const i = this.data.points.length;
    this._busy(true, 'กำลังบันทึกจุด…');
    const res = await API.tourSavePoint({
      name: name,
      plan_id: (this.data.plans[0] || {}).plan_id || '',
      plan_x: Math.min(0.9, 0.15 + (i % 4) * 0.23),
      plan_y: Math.min(0.9, 0.2 + Math.floor(i / 4) * 0.22),
      sort_order: i + 1,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this.renderMap();
    this._busy(false);
  },

  // ── อ่านแปลนจากไฟล์ PDF ──────────────────────────────────
  // แบบแปลนที่สถาปนิกส่งมาเป็น PDF แทบทั้งนั้น (เจ้าของงานแจ้ง 2026-08-19)
  // แปลงหน้าที่เลือกเป็นรูปตั้งแต่ตอนอัป → ที่เก็บและโค้ดส่วนอื่นไม่ต้องรู้จัก PDF เลย
  // ตัวอ่าน PDF โหลดเฉพาะตอนเจอไฟล์ PDF (1.4 MB) — ไม่ถ่วงคนที่อัปแค่รูป
  _loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'vendor/pdfjs/pdf.min.js';
      s.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = () => reject(new Error('โหลดตัวอ่าน PDF ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
  },

  async _pdfToImage(file, maxDim) {
    const lib = await this._loadPdfJs();
    const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;

    let pageNo = 1;
    if (doc.numPages > 1) {
      const v = prompt('ไฟล์นี้มี ' + doc.numPages + ' หน้า — ใช้แปลนหน้าไหน?', '1');
      if (v === null) return null;
      pageNo = Math.min(doc.numPages, Math.max(1, parseInt(v, 10) || 1));
    }

    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(4, maxDim / Math.max(base.width, base.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';                       // PDF พื้นโปร่งใส ถ้าไม่รองพื้นขาวจะได้แปลนพื้นดำ
    ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { dataUrl: c.toDataURL('image/jpeg', 0.88), w: c.width, h: c.height };
  },

  pickPlan() {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*,application/pdf,.pdf';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const isPdf = /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name || '');
      this._busy(true, isPdf ? 'กำลังอ่านไฟล์ PDF…' : 'กำลังอัปแปลน…');
      try {
        const img = isPdf ? await this._pdfToImage(f, 2000) : await this._compress(f, 2000, 0.85);
        if (!img) { this._busy(false); return; }        // ผู้ใช้กดยกเลิกตอนเลือกหน้า
        const res = await API.tourSavePlan({
          plan_id: (this.data.plans[0] || {}).plan_id || '',
          floor_label: (this.data.plans[0] || {}).floor_label || 'ชั้น 1',
          image_base64: img.dataUrl, width: img.w, height: img.h,
        });
        if (!res || res.ok === false) { this._busy(false); return this._err(res); }
        await this.loadConfig(true);
        this.renderMap();
        Modal.toast('✅ อัปแปลนแล้ว');
      } catch (e) { this._err({ error: e.message }); }
      this._busy(false);
    };
    inp.click();
  },

  async onPlanClick(ev) {
    if (this.data.mapTool !== 'point') return;
    const box = document.getElementById('map-plan-box');
    const r = box.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    const name = prompt('ชื่อจุดนี้ (เช่น ห้องนอนใหญ่ – มุมประตู)');
    if (!name) return;
    this._busy(true, 'กำลังบันทึกจุด…');
    const res = await API.tourSavePoint({
      name: name, plan_id: (this.data.plans[0] || {}).plan_id || '',
      plan_x: x, plan_y: y, sort_order: this.data.points.length + 1,
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    this.renderMap();
    this._busy(false);
  },

  // โยงเส้น: แตะจุดต้นทาง → แตะจุดปลายทาง
  // ทิศของลูกศรคำนวณจากตำแหน่งบนแปลนให้อัตโนมัติ (ปรับละเอียดทีหลังได้ด้วยค่าปรับหมุนของภาพ)
  async onPointClick(pointId) {
    if (this.data.mapTool !== 'link') return;
    if (!this.data.linkFrom) { this.data.linkFrom = pointId; return this.renderMap(); }
    if (this.data.linkFrom === pointId) { this.data.linkFrom = null; return this.renderMap(); }

    const a = this._pt(this.data.linkFrom), b = this._pt(pointId);
    const dx = (Number(b.plan_x) || 0) - (Number(a.plan_x) || 0);
    const dy = (Number(b.plan_y) || 0) - (Number(a.plan_y) || 0);
    let yaw = Math.atan2(dx, -dy) * 180 / Math.PI;   // แกน y ของรูปโตลงล่าง → กลับเครื่องหมาย
    if (yaw > 180) yaw -= 360;

    this._busy(true, 'กำลังบันทึกเส้นทาง…');
    const res = await API.tourSaveLink({
      from_point: a.point_id, to_point: b.point_id, yaw: yaw, pitch: -10, label: '',
    });
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    this.data.linkFrom = null;
    await this.loadConfig(true);
    this.renderMap();
    this._busy(false);
    Modal.toast('✅ โยงเส้นทางแล้ว');
  },

  async removePoint(pointId) {
    const pt = this._pt(pointId) || {};
    const ok = await Modal.confirm({
      title: 'ทิ้ง "' + this._esc(pt.name) + '" ลงถังขยะ?',
      desc: 'กู้คืนได้ภายใน 30 วัน — ภาพและทางเดินที่โยงไว้กลับมาครบตอนกู้ ' +
        'พ้น 30 วันแล้วระบบจะลบถาวรพร้อมไฟล์รูป',
      icon: '🗑️',
      confirmText: 'ทิ้งลงถังขยะ',
    });
    if (!ok) return;
    this._busy(true, 'กำลังทิ้ง…');
    const res = await API.tourDeletePoint(pointId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    if (this.data.version) { try { await this.loadVersion(this.data.version.version_id); } catch (e) { /* */ } }
    await this.loadTrash();
    this._refresh();
    this._busy(false);
    Modal.toast('🗑️ ทิ้งลงถังขยะแล้ว — กู้คืนได้ 30 วัน');
  },

  // ── ถังขยะ 30 วัน (กติกาเดียวกับโมดูล QC) ──────────────────
  async loadTrash() {
    const res = await API.tourGetTrash();
    const d = (res && (res.data || res)) || {};
    this.data.trash = { points: d.points || [], versions: d.versions || [], days: d.trash_days || 30 };
  },

  renderTrash() {
    const box = document.getElementById('th-trash') || document.getElementById('map-trash');
    if (!box) return;
    const t = this.data.trash;
    if (!t || (!t.points.length && !t.versions.length)) { box.innerHTML = ''; return; }

    const row = (name, sub, left, kind, id) =>
      '<div class="point-row">' +
      '<div style="flex:1;min-width:0"><div class="font-semibold">' + name + '</div>' +
      '<div class="text-sm text-muted">' + sub + ' · เหลืออีก ' + left + ' วัน</div></div>' +
      '<div style="display:flex;gap:6px;flex:none">' +
      '<button class="btn btn-secondary btn-sm" onclick="Tour.restore' +
      (kind === 'point' ? 'Point' : 'Version') + '(&quot;' + id + '&quot;)">กู้คืน</button>' +
      '<button onclick="Tour.purge(&quot;' + kind + '&quot;,&quot;' + id + '&quot;)" title="ลบถาวร" ' +
      'style="display:flex;align-items:center;justify-content:center;width:40px;height:40px;' +
      'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
      'color:var(--color-error-700);cursor:pointer">' +
      '<i data-lucide="trash-2" style="width:16px;height:16px"></i></button>' +
      '</div></div>';

    box.innerHTML =
      '<div class="form-label" style="margin-top:20px"><i data-lucide="trash-2" style="width:15px;height:15px;vertical-align:-2px"></i> ถังขยะ (' +
      (t.points.length + t.versions.length) + ')</div>' +
      '<div class="text-sm text-muted" style="margin-bottom:6px">ระบบลบถาวรอัตโนมัติเมื่อครบ ' + t.days + ' วัน</div>' +
      t.points.map((p) => row(
        this._esc(p.name), 'จุดถ่าย · มีภาพ ' + (p.shot_count || 0) + ' ใบ',
        p.days_left, 'point', p.point_id)).join('') +
      t.versions.map((v) => row(
        this._esc(v.name), 'เวอร์ชัน ' + this._thaiDate(v.captured_at),
        v.days_left, 'version', v.version_id)).join('');
    if (window.lucide) lucide.createIcons();
  },

  // ลบถาวรทันที ไม่ต้องรอครบ 30 วัน (เจ้าของงานเคาะ 2026-08-19: "ถังขยะต้องมีปุ่มลบด้วย")
  // ⚠️ กู้ไม่ได้ — ถามยืนยันพร้อมบอกจำนวนภาพที่จะหายไป
  async purge(kind, id) {
    const t = this.data.trash || { points: [], versions: [] };
    const item = kind === 'point'
      ? t.points.find((p) => p.point_id === id)
      : t.versions.find((v) => v.version_id === id);
    const name = item ? item.name : id;
    const n = kind === 'point' ? (item && item.shot_count) || 0 : 0;

    const ok = await Modal.confirm({
      title: 'ลบ "' + this._esc(name) + '" ถาวร?',
      desc: kind === 'point'
        ? 'ภาพ 360 ของจุดนี้ทุกเวอร์ชัน' + (n ? ' (' + n + ' ใบ)' : '') +
          ' จะถูกลบทิ้งจากระบบและจากที่เก็บไฟล์ กู้กลับมาไม่ได้อีกเลย'
        : 'ภาพ 360 ทุกจุดในเวอร์ชันนี้จะถูกลบทิ้งจากระบบและจากที่เก็บไฟล์ กู้กลับมาไม่ได้อีกเลย',
      info: 'ถ้าแค่ไม่อยากให้แสดง ปล่อยไว้ในถังขยะก็พอ — ระบบจะลบให้เองเมื่อครบ 30 วัน',
      icon: '⚠️', iconClass: 'warn',
      confirmText: 'ลบถาวร', cancelText: 'ไม่ลบ',
    });
    if (!ok) return;

    this._busy(true, 'กำลังลบถาวร…');
    const res = await API.tourPurge(kind, id);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    await this.loadTrash();
    this._refresh();
    this._busy(false);
    Modal.toast('✓ ลบถาวรแล้ว');
  },

  async restorePoint(pointId) {
    this._busy(true, 'กำลังกู้คืน…');
    const res = await API.tourRestorePoint(pointId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    await this.loadTrash();
    this._refresh();
    this._busy(false);
    Modal.toast('✅ กู้คืนแล้ว');
  },

  async restoreVersion(versionId) {
    this._busy(true, 'กำลังกู้คืน…');
    const res = await API.tourRestoreVersion(versionId);
    if (!res || res.ok === false) { this._busy(false); return this._err(res); }
    await this.loadConfig(true);
    await this.loadTrash();
    this.renderMap();
    this._busy(false);
    Modal.toast('✅ กู้คืนแล้ว (อยู่ในสถานะยังไม่เผยแพร่)');
  },
};

window.Tour = Tour;

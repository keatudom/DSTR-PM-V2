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

  // ── หน้าแรก: รายการห้อง ──────────────────────────────────
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

    const list = document.getElementById('th-list');
    if (!list) return;

    if (!this.data.points.length) {
      list.innerHTML = '<div style="text-align:center;padding:32px 16px;line-height:1.9;color:var(--color-slate-600)">' +
        'ยังไม่มีห้องในโครงการนี้<br><span style="font-size:13px">กด "สแกน" ได้เลย — ตั้งชื่อห้องตอนถ่าย ระบบสร้างให้เอง</span>' +
        '<div style="margin-top:16px"><button class="btn btn-primary" onclick="Tour.enterCaptureMode()">📷 สแกนห้องแรก</button></div></div>';
      return;
    }

    list.innerHTML = '<div class="form-label">ห้องทั้งหมด (' + this.data.points.length + ')</div>' +
      this.data.points.map((p) => {
        const e = this._shot(p.point_id);
        let icon = 'circle-dashed', tone = 'var(--color-slate-400)', sub = 'ยังไม่มีภาพ';
        if (e && e.shot && e.fallback_from_version) {
          icon = 'alert-triangle'; tone = 'var(--color-warning-500)';
          sub = 'ภาพจาก "' + this._esc(e.fallback_from_version.name) + '" ' + this._thaiDate(e.fallback_from_version.captured_at);
        } else if (e && e.shot) {
          icon = 'check-circle-2'; tone = 'var(--color-success-500)';
          sub = 'มีภาพของเวอร์ชันนี้';
        }
        return '<div class="th-room">' +
          '<i data-lucide="' + icon + '" style="color:' + tone + ';width:26px;height:26px;flex:none"></i>' +
          '<div class="th-room-main" onclick="Tour.openPoint(\'' + p.point_id + '\')">' +
          '<div class="th-room-name">' + this._esc(p.name) + '</div>' +
          '<div class="th-room-sub">' + sub + '</div></div>' +
          '<button onclick="Tour.removePoint(\'' + p.point_id + '\')" title="ทิ้งลงถังขยะ" ' +
          'style="display:flex;align-items:center;justify-content:center;width:44px;height:44px;flex:none;' +
          'border:1.5px solid var(--color-error-500);border-radius:10px;background:var(--color-error-50);' +
          'color:var(--color-error-700);cursor:pointer">' +
          '<i data-lucide="trash-2" style="width:18px;height:18px"></i></button>' +
          '</div>';
      }).join('');
    if (window.lucide) lucide.createIcons();
  },

  // วาดใหม่ตามโหมดที่เปิดอยู่ — เดิม hardcode renderMap ทำให้ลบจุดจากหน้าแรกแล้วรายการไม่อัปเดต
  _refresh() {
    if (this.data.mode === 'map') this.renderMap();
    else this.renderHome();
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
        '<button class="btn btn-primary" onclick="Tour.enterCaptureMode()">📷 เริ่มถ่าย</button> ' +
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

  // ── หมุดคอมเมนต์ ─────────────────────────────────────────
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
        '<div style="margin-top:12px"><button class="btn btn-primary" onclick="Tour.captureNewPoint()">📷 สแกนจุดแรก</button></div>' +
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
        'onclick="Tour.scanFor(\'' + p.point_id + '\')">📷 ' + (ok ? 'สแกนใหม่' : 'สแกน') + '</button>' +
        '<button class="btn btn-ghost btn-sm" title="เลือกรูปจากคลังภาพ" ' +
        'onclick="Tour.pickPhotoFor(\'' + p.point_id + '\')">🖼️</button>' +
        '</div>' +
        '</div>';
    }).join('');

    list.innerHTML += '<div style="text-align:center;margin-top:12px">' +
      '<button class="btn btn-ghost btn-sm" onclick="Tour.captureNewPoint()">➕ เพิ่มจุดใหม่แล้วถ่ายเลย</button></div>';

    const n = Object.keys(done).length;
    document.getElementById('tc-progress-text').innerText = n + '/' + this.data.points.length + ' จุด';
    document.getElementById('tc-progress-bar').style.width =
      Math.round((n / this.data.points.length) * 100) + '%';
    if (window.lucide) lucide.createIcons();
  },

  // ต้องมีเวอร์ชัน draft ก่อนถึงจะอัปรูปได้ — สร้างให้อัตโนมัติตอนกดรูปแรก
  async _ensureDraft() {
    if (this.data.draftVersionId) return this.data.draftVersionId;
    const name = (document.getElementById('tc-name').value || '').trim();
    if (!name) { Modal.toast('⚠️ ใส่ชื่อเวอร์ชันก่อน'); return null; }
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
    this.renderCaptureList();
    Modal.toast('✅ อัปภาพ 360 แล้ว');
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
        '<button class="btn btn-primary btn-sm" onclick="Tour.addPointManually()">➕ เพิ่มจุด</button>' +
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
    const addBtn = '<button class="btn btn-secondary btn-sm" onclick="Tour.addPointManually()">➕ เพิ่มจุด</button>';

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
    const box = document.getElementById('map-trash');
    if (!box) return;
    const t = this.data.trash;
    if (!t || (!t.points.length && !t.versions.length)) { box.innerHTML = ''; return; }

    const row = (name, sub, left, onRestore) =>
      '<div class="point-row">' +
      '<div><div class="font-semibold">' + name + '</div>' +
      '<div class="text-sm text-muted">' + sub + ' · เหลืออีก ' + left + ' วัน</div></div>' +
      '<button class="btn btn-secondary btn-sm" onclick="' + onRestore + '">กู้คืน</button></div>';

    box.innerHTML =
      '<div class="form-label" style="margin-top:20px">🗑️ ถังขยะ (' +
      (t.points.length + t.versions.length) + ')</div>' +
      '<div class="text-sm text-muted" style="margin-bottom:6px">ระบบลบถาวรอัตโนมัติเมื่อครบ ' + t.days + ' วัน</div>' +
      t.points.map((p) => row(
        this._esc(p.name), 'จุดถ่าย · มีภาพ ' + (p.shot_count || 0) + ' ใบ',
        p.days_left, "Tour.restorePoint('" + p.point_id + "')")).join('') +
      t.versions.map((v) => row(
        this._esc(v.name), 'เวอร์ชัน ' + this._thaiDate(v.captured_at),
        v.days_left, "Tour.restoreVersion('" + v.version_id + "')")).join('');
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

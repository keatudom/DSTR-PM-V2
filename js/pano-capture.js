/**
 * js/pano-capture.js — ตัวสแกน 360 ในแอป (ไม่ต้องพึ่งแอปนอก)
 * ============================================================
 * เจ้าของงานเคาะ 2026-08-18: อยากได้จุดไล่เล็งแบบ Teleport 360 แต่ไม่อยากเสียค่าแอป
 *
 * หลักการ (ต่างจากแอปเนทีฟยังไง — อ่านก่อนแก้):
 *   แอปเนทีฟใช้ ARKit ซึ่งรู้การหมุนของเครื่องแม่นมาก + ต่อภาพด้วยการจับจุดเด่นในภาพ
 *   เว็บเข้าถึงได้แค่เซ็นเซอร์หมุน (gyroscope/compass) → เราจึงใช้ "องศาที่เครื่องหันอยู่"
 *   มาวางตำแหน่งภาพลงบนผืนผ้า 360 โดยตรง ไม่ได้จับคู่จุดเด่น
 *   ⇒ เร็วและง่ายกว่ามาก แต่รอยต่อจะเห็นได้ โดยเฉพาะของที่อยู่ใกล้ตัว (ขอบตู้ ขอบผนัง)
 *   ⇒ ของไกล (ห้อง ผนัง เพดาน) ต่อได้เนียนพอใช้งาน — ซึ่งคือของที่เราต้องการบันทึก
 *
 * ⚠️ กับดัก iOS ที่ต้องรู้:
 *   - ตั้งแต่ iOS 18 กล้องใช้ไม่ได้ใน PWA ที่ติดตั้งลงหน้าจอ (เปิดใน Safari ปกติได้)
 *     → ตรวจแล้วเตือนพร้อมบอกทางออก ไม่ปล่อยให้จอดำงงๆ
 *   - ขอสิทธิ์เซ็นเซอร์หมุนต้องเรียกจากการ "แตะของผู้ใช้" เท่านั้น (requestPermission)
 *   - <video> ต้องมี playsinline ไม่งั้น iOS เด้งเป็นเครื่องเล่นเต็มจอ
 * ============================================================
 */

const PanoCapture = {
  // ── ค่าตั้งต้น ────────────────────────────────────────────
  OUT_W: 4096,          // ผืนผ้า 360 (2:1 เป๊ะ ตามนิยาม equirectangular)
  OUT_H: 2048,
  FRAME_MAX: 1280,      // ความละเอียดภาพที่เก็บแต่ละใบ (ด้านยาว)
  //   ⚠️ เดิมตั้งไว้ 800 = ทิ้งรายละเอียดกล้องไปกว่าครึ่งตั้งแต่ตอนถ่าย
  //      ภาพ 1 ใบคลุมราว 63° ถ้ากว้าง 800px = 12.7 จุด/องศา ส่วนผลลัพธ์ 4096px/360° = 11.4 จุด/องศา
  //      ต้นทางแทบไม่เหลือรายละเอียดให้เกลี่ย → ภาพออกมานุ่มๆ ไม่คม (เจ้าของงานสังเกตออก 2026-08-19)
  //      1280px = 20.3 จุด/องศา ≈ 1.8 เท่าของผลลัพธ์ กำลังพอดีให้คมจริง
  //      (ไม่ขึ้นไปกว่านี้เพราะ 32 ใบ x 1440px = ~112MB เสี่ยงเบราว์เซอร์มือถือดับกลางคัน)
  //   เก็บเป็น RGB 3 ไบต์ (ไม่เก็บช่องโปร่งใส) → ประหยัดหน่วยความจำ 25% ชดเชยที่ภาพใหญ่ขึ้น
  HIT_DEG: 4.5,         // เล็งใกล้จุดเป้ากี่องศาถึงจะเริ่มนับ (แคบลง = ต้องเล็งเป๊ะขึ้น ภาพต่อเนียนขึ้น)
  HOLD_MS: 1200,        // ต้องเล็งค้างกี่มิลลิวินาทีถึงจะเก็บ
  STEADY_DPS: 13,       // ถ้าหมุนเร็วกว่านี้ (องศา/วินาที) ยังไม่นับ — ต้องถือนิ่งก่อน
  //   ⚠️ เจ้าของงานทัก 2026-08-19: "ของเราเร็วมาก ยังไม่ได้จับรายละเอียดเลยสแกนเสร็จแล้ว
  //      อย่างงี้อาจจะทำให้รูปมันหลุดกันได้" — ถูกต้อง ภาพที่ถ่ายตอนมือยังขยับ = เบลอ + องศาคลาด
  //      จึงต้องทั้ง "ค้างนานขึ้น" และ "นิ่งจริง" ถึงจะเก็บ
  FOV_KEY: 'dstr_pano_fov',   // มุมกล้องด้านยาว — จำไว้ต่อเครื่อง (ปรับได้ในจอสแกน)

  _state: null,

  fovLong() {
    const v = Number(localStorage.getItem(this.FOV_KEY));
    return v >= 40 && v <= 90 ? v : 63;
  },

  // ── จุดเป้าที่ต้องไล่เล็ง (วงแนวนอน 3 วง + ยอดเพดาน) ──────
  // วางเป็นวงตามละติจูด ให้แต่ละใบซ้อนกัน ~20% ทั้งแนวตั้งและแนวนอน
  // ถ้าเว้นห่างกว่านี้จะเกิด "รูโหว่รูปตา" ตรงมุมภาพที่ 4 ใบมาบรรจบกัน (เจอตอนทดสอบไป-กลับ)
  _targets(hFovDeg, vFovDeg) {
    const out = [];
    const vStep = Math.max(20, vFovDeg * 0.8);
    const hStep = Math.max(25, hFovDeg * 0.8);

    const lats = [0];
    for (let k = 1; k <= 4; k++) {
      const l = Math.min(88, k * vStep);
      lats.push(l, -l);
      if (l + vFovDeg / 2 >= 90) break;                 // คลุมถึงขั้วแล้ว พอ
    }

    for (const lat of lats) {
      const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
      const n = Math.max(2, Math.round(360 / (hStep / cos)));
      for (let i = 0; i < n; i++) {
        out.push({ lon: (360 / n) * i - 180, lat: lat, ring: lat === 0 ? 'mid' : 'edge' });
      }
    }
    return out.map((t, i) => Object.assign(t, { id: i, done: false }));
  },

  // ════════════════════════════════════════════════════════
  // คณิตศาสตร์: ทิศทาง / การหมุนของเครื่อง
  // ════════════════════════════════════════════════════════
  _dirOf(lonDeg, latDeg) {
    const lo = lonDeg * Math.PI / 180, la = latDeg * Math.PI / 180;
    const c = Math.cos(la);
    return [c * Math.sin(lo), Math.sin(la), -c * Math.cos(lo)];   // lon 0 = แกน -Z
  },

  // quaternion จากค่าเซ็นเซอร์ (สูตรมาตรฐานเดียวกับ three.js DeviceOrientationControls)
  _quatFromDevice(alpha, beta, gamma, screenDeg) {
    const d2r = Math.PI / 180;
    const a = (alpha || 0) * d2r, b = (beta || 0) * d2r, g = (gamma || 0) * d2r;
    // Euler YXZ (beta, alpha, -gamma)
    const c1 = Math.cos(b / 2), s1 = Math.sin(b / 2);
    const c2 = Math.cos(a / 2), s2 = Math.sin(a / 2);
    const c3 = Math.cos(-g / 2), s3 = Math.sin(-g / 2);
    let q = [
      s1 * c2 * c3 + c1 * s2 * s3,   // x
      c1 * s2 * c3 - s1 * c2 * s3,   // y
      c1 * c2 * s3 - s1 * s2 * c3,   // z
      c1 * c2 * c3 + s1 * s2 * s3,   // w
    ];
    const r = Math.SQRT1_2;
    q = this._qmul(q, [-r, 0, 0, r]);                       // กล้องมองออกทางหลังเครื่อง
    const s = -(screenDeg || 0) * d2r / 2;                  // ชดเชยการหมุนจอ
    return this._qmul(q, [0, 0, Math.sin(s), Math.cos(s)]);
  },

  _qmul(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ];
  },

  // แกนกล้องในพิกัดโลก: right / up / forward
  _axes(q) {
    const rot = (v) => {
      const [x, y, z, w] = q;
      const ix = w * v[0] + y * v[2] - z * v[1];
      const iy = w * v[1] + z * v[0] - x * v[2];
      const iz = w * v[2] + x * v[1] - y * v[0];
      const iw = -x * v[0] - y * v[1] - z * v[2];
      return [
        ix * w + iw * -x + iy * -z - iz * -y,
        iy * w + iw * -y + iz * -x - ix * -z,
        iz * w + iw * -z + ix * -y - iy * -x,
      ];
    };
    return { right: rot([1, 0, 0]), up: rot([0, 1, 0]), fwd: rot([0, 0, -1]) };
  },

  _dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; },

  // ════════════════════════════════════════════════════════
  // เปิดตัวสแกน
  // ════════════════════════════════════════════════════════
  async start(opts) {
    opts = opts || {};
    if (this._state) return;

    // เตือนล่วงหน้าถ้าเปิดจากไอคอนที่ติดตั้งไว้บน iOS (กล้องจะไม่ทำงานตั้งแต่ iOS 18)
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    if (isIOS && standalone) {
      const ok = await Modal.confirm({
        title: 'เปิดใน Safari ก่อนนะครับ',
        desc: 'ตั้งแต่ iOS 18 กล้องใช้ไม่ได้เมื่อเปิดจากไอคอนที่ติดตั้งไว้ ' +
          'ให้เปิดหน้านี้ใน Safari แล้วค่อยสแกน (หรือใช้ปุ่มเลือกรูปจากคลังภาพแทน)',
        icon: '📷', iconClass: 'warn',
        confirmText: 'ลองต่อเลย', cancelText: 'ไว้ก่อน',
      });
      if (!ok) return;
    }

    const ui = this._buildUI();
    this._state = { ui: ui, frames: [], targets: [], q: [0, 0, 0, 1], onDone: opts.onDone, running: true };

    try {
      await this._askMotion();
      await this._openCamera(ui.video);
    } catch (e) {
      this._toast(ui, e.message || 'เปิดกล้องไม่สำเร็จ', true);
      return;
    }

    this._listenOrientation();
    this._loop();
  },

  // ── ขอสิทธิ์เซ็นเซอร์หมุน (iOS 13+ ต้องขอ และต้องมาจากการแตะของผู้ใช้) ──
  async _askMotion() {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === 'function') {
      let res;
      try { res = await D.requestPermission(); } catch (e) { res = 'denied'; }
      if (res !== 'granted') {
        throw new Error('ต้องอนุญาตให้เว็บอ่านเซ็นเซอร์การหมุนก่อน จึงจะไล่จุดได้');
      }
    }
  },

  async _openCamera(video) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('เบราว์เซอร์นี้เปิดกล้องไม่ได้ — ลองเปิดใน Safari');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
      audio: false,
    }).catch(() => { throw new Error('เปิดกล้องไม่สำเร็จ — เช็คว่าอนุญาตกล้องให้เว็บนี้แล้วหรือยัง'); });
    this._state.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => { /* iOS บางรุ่นเล่นเองอยู่แล้ว */ });
    // รอให้รู้ขนาดภาพจริงก่อน ค่อยคำนวณมุมกล้อง/จุดเป้า
    for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    if (!video.videoWidth) throw new Error('กล้องเปิดแล้วแต่ไม่มีภาพ — ลองปิดแอปอื่นที่ใช้กล้องอยู่');
    this._setupGeometry();
  },

  _setupGeometry() {
    const st = this._state;
    const v = st.ui.video;
    const W = v.videoWidth, H = v.videoHeight;
    const long = this.fovLong() * Math.PI / 180;
    // มุมกล้องด้านยาว = ค่าที่ตั้งไว้ · ด้านสั้นคำนวณจากสัดส่วนภาพ
    if (W >= H) {
      st.hFov = long;
      st.vFov = 2 * Math.atan(Math.tan(long / 2) * H / W);
    } else {
      st.vFov = long;
      st.hFov = 2 * Math.atan(Math.tan(long / 2) * W / H);
    }
    st.frameW = W; st.frameH = H;

    // กรอบภาพกลางจอ — เว้นที่รอบๆ ให้จุดเป้าที่ยังไม่ถึงลอยอยู่นอกกรอบได้
    const rw = st.ui.root.clientWidth, rh = st.ui.root.clientHeight;
    const bw = Math.min(rw * 0.6, rh * 0.42 * W / H);
    const bh = bw * H / W;
    v.style.width = Math.round(bw) + 'px';
    v.style.height = Math.round(bh) + 'px';
    st.box = { x: rw / 2, y: rh / 2, w: bw, h: bh };
    st.targets = this._targets(st.hFov * 180 / Math.PI, st.vFov * 180 / Math.PI);
    this._mosInit();
    this._updateHud();
  },

  _listenOrientation() {
    const st = this._state;
    st.onOri = (e) => {
      const so = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
      st.q = this._quatFromDevice(e.alpha, e.beta, e.gamma, so);
      st.hasOri = true;
    };
    window.addEventListener('deviceorientation', st.onOri, true);
  },

  // ── วนวาดจุดเป้า + เก็บภาพเมื่อเล็งค้างครบเวลา ─────────────
  // ผังจอเลียนแบบ Teleport 360 (เจ้าของงานส่งภาพตัวอย่างมา 2026-08-19):
  //   ภาพกล้องเป็น "กรอบเล็กกลางจอ" ไม่เต็มจอ → จุดเป้าที่ยังไม่ถึงจึงลอยอยู่นอกกรอบให้เห็นว่าต้องหันไปไหน
  //   ถ้าให้ภาพเต็มจอ (แบบที่ทำไว้ตอนแรก) จุดที่อยู่นอกมุมกล้องจะมองไม่เห็นเลย ต้องเดาทิศเอง
  _loop() {
    const st = this._state;
    if (!st || !st.running) return;
    const cv = st.ui.overlay, ctx = cv.getContext('2d');
    const w = st.ui.root.clientWidth, h = st.ui.root.clientHeight;
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);

    const box = st.box || { x: w / 2, y: h / 2, w: w * 0.6, h: h * 0.45 };
    const cx = box.x, cy = box.y;

    if (st.hasOri && st.targets.length) {
      const ax = this._axes(st.q);
      const tanH = Math.tan(st.hFov / 2), tanV = Math.tan(st.vFov / 2);
      let nearest = null, nearestAng = 999;

      // ── วัดความนิ่งของมือ (องศา/วินาที) ──
      const now = Date.now();
      if (st.prevFwd && st.prevAt) {
        const d = Math.acos(Math.max(-1, Math.min(1, this._dot(st.prevFwd, ax.fwd)))) * 180 / Math.PI;
        const dt = Math.max(16, now - st.prevAt) / 1000;
        st.dps = st.dps == null ? d / dt : st.dps * 0.6 + (d / dt) * 0.4;
      }
      st.prevFwd = ax.fwd; st.prevAt = now;
      const steady = (st.dps || 0) <= this.STEADY_DPS;

      // ── วาดผืนภาพที่สแกนไปแล้วเต็มจอ ต่อกันเป็นผืนเดียว ──
      this._mosRender(ctx, w, h, ax, box);
      // เจาะช่องให้เห็นภาพกล้องสดตรงกลาง (วิดีโออยู่ใต้ canvas)
      ctx.clearRect(cx - box.w / 2, cy - box.h / 2, box.w, box.h);
      ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2;
      ctx.strokeRect(cx - box.w / 2, cy - box.h / 2, box.w, box.h);

      for (const t of st.targets) {
        const d = this._dirOf(t.lon, t.lat);
        const f = this._dot(d, ax.fwd);
        const ang = Math.acos(Math.max(-1, Math.min(1, f))) * 180 / Math.PI;
        if (!t.done && ang < nearestAng) { nearestAng = ang; nearest = t; }
        if (f <= 0.12) continue;                                  // อยู่หลังกล้อง

        // -1..1 = ขอบกรอบภาพ · เกินกว่านั้นวาดออกไปนอกกรอบได้ (พื้นที่ดำรอบๆ)
        const u = (this._dot(d, ax.right) / f) / tanH;
        const vv = (this._dot(d, ax.up) / f) / tanV;
        if (Math.abs(u) > 3.2 || Math.abs(vv) > 3.2) continue;
        const sx = cx + u * box.w / 2;
        const sy = cy - vv * box.h / 2;

        const r = Math.max(9, 30 / (1 + ang / 26));               // ไกล = เล็กลง ใกล้ = ใหญ่ขึ้น
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = t.done ? 'rgba(34,197,94,.35)' : 'rgba(74,222,128,.72)';
        ctx.fill();
        if (t.done) { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(34,197,94,.9)'; ctx.stroke(); }
      }

      // ── เล็งค้างถึงจะเก็บ (กันภาพเบลอจากการหมุนเร็ว) ──
      const holding = nearest && nearestAng <= this.HIT_DEG && steady;
      if (holding) {
        if (st.aimId !== nearest.id) { st.aimId = nearest.id; st.aimAt = Date.now(); }
      } else { st.aimId = null; st.aimAt = 0; }
      const prog = holding ? Math.min(1, (Date.now() - st.aimAt) / this.HOLD_MS) : 0;

      // เล็งโดนแล้วแต่มือยังสั่น → บอกให้รู้ว่าทำไมยังไม่เก็บ
      if (nearest && nearestAng <= this.HIT_DEG && !steady) {
        ctx.font = '600 14px sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = '#fbbf24';
        ctx.fillText('ถือนิ่งๆ ก่อน', cx, cy + box.h / 2 + 28);
      }

      // วงเล็งกลางจอ + พายบอกความคืบหน้า
      const R = 44;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.lineWidth = 5; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (prog > 0) {
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, R - 4, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
        ctx.closePath(); ctx.fillStyle = 'rgba(74,222,128,.9)'; ctx.fill();
      }

      if (prog >= 1) { this._grab(nearest); st.aimId = null; st.aimAt = 0; }

      // ลูกศรบอกทางไปจุดถัดไป ถ้ามันอยู่นอกกรอบ
      if (nearest && nearestAng > this.HIT_DEG) {
        const d = this._dirOf(nearest.lon, nearest.lat);
        const f = this._dot(d, ax.fwd);
        const u = (this._dot(d, ax.right) / f) / tanH;
        const vv = (this._dot(d, ax.up) / f) / tanV;
        if (f <= 0.12 || Math.abs(u) > 1 || Math.abs(vv) > 1) {
          const a = Math.atan2(-(f > 0.12 ? vv : 0) || -vv, (f > 0.12 ? u : this._dot(d, ax.right)) || 1);
          ctx.save(); ctx.translate(cx + Math.cos(a) * (R + 34), cy + Math.sin(a) * (R + 34)); ctx.rotate(a);
          ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-8, -9); ctx.lineTo(-8, 9); ctx.closePath();
          ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        }
      }
    }

    st.raf = requestAnimationFrame(() => this._loop());
  },

  // เก็บภาพ 1 ใบ พร้อมจดว่าตอนนั้นเครื่องหันไปทางไหน
  _grab(target) {
    const st = this._state;
    if (st.grabbing) return;
    st.grabbing = true;
    try {
      const v = st.ui.video;
      const scale = Math.min(1, this.FRAME_MAX / Math.max(v.videoWidth, v.videoHeight));
      const w = Math.max(1, Math.round(v.videoWidth * scale));
      const h = Math.max(1, Math.round(v.videoHeight * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cc = c.getContext('2d');
      cc.drawImage(v, 0, 0, w, h);
      const id = cc.getImageData(0, 0, w, h).data;
      const rgb = new Uint8Array(w * h * 3);         // ตัดช่องโปร่งใสทิ้ง ประหยัดหน่วยความจำ 25%
      for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) { rgb[j] = id[i]; rgb[j + 1] = id[i + 1]; rgb[j + 2] = id[i + 2]; }
      const fr = { rgb: rgb, w: w, h: h, q: st.q.slice(), targetId: target.id };
      st.frames.push(fr);
      this._mosPaint(fr);            // ต่อลงผืนผ้าทันที → จอโชว์ภาพที่ต่อกันแล้ว
      target.done = true;
      if (navigator.vibrate) navigator.vibrate(30);
      this._updateHud();
    } catch (e) { /* ข้ามใบนี้ไป ไม่ให้ทั้งจอค้าง */ }
    setTimeout(() => { st.grabbing = false; }, 250);
  },

  // ย้อนกลับ 1 ใบ (ถ่ายพลาด/มีคนเดินผ่าน) — ปุ่มมุมซ้ายบน
  undo() {
    const st = this._state;
    if (!st || !st.frames.length) return;
    const fr = st.frames.pop();
    const t = st.targets.find((x) => x.id === fr.targetId);
    if (t) t.done = false;
    this._mosInit();
    for (const f2 of st.frames) this._mosPaint(f2);
    st.aimId = null; st.aimAt = 0;
    this._updateHud();
  },

  _updateHud() {
    const st = this._state;
    if (!st) return;
    const done = st.targets.filter((t) => t.done).length;
    const total = st.targets.length;
    const mid = st.targets.filter((t) => t.ring === 'mid');
    const midDone = mid.filter((t) => t.done).length;

    st.ui.hud.textContent = 'เก็บแล้ว ' + done + '/' + total + ' จุด';
    st.ui.bar.style.width = Math.round(done / total * 100) + '%';
    st.ui.undo.style.visibility = done ? 'visible' : 'hidden';

    // เจ้าของงานเคาะ 2026-08-19: "ถ้าสแกนไม่ครบจุด ไม่ให้กดปุ่มเสร็จเลย"
    // เหตุผลที่ถูก: ปล่อยให้จบทั้งที่ยังโหว่ = ได้ภาพมีรูดำ สุดท้ายต้องกลับไปถ่ายใหม่ทั้งห้องอยู่ดี
    const enough = done >= total;
    st.ui.done.disabled = !enough;
    st.ui.done.textContent = enough
      ? 'ครบทุกจุดแล้ว — ต่อภาพเลย'
      : 'เหลืออีก ' + (total - done) + ' จุด';
    if (st.ui.sub) {
      st.ui.sub.textContent = enough
        ? 'ต่อภาพใช้เวลา 1-3 นาที ระหว่างนี้อย่าปิดหน้าจอ'
        : 'ระดับสายตา ' + midDone + '/' + mid.length + ' · ต้องเก็บให้ครบทั้ง ' + total + ' จุด (รวมเพดานกับพื้น) ถึงจะต่อภาพได้';
    }
  },
  // ════════════════════════════════════════════════════════
  // ภาพตัวอย่างระหว่างสแกน — ต่อกันเป็นผืนเดียวจริงๆ
  // ════════════════════════════════════════════════════════
  // เจ้าของงานทัก 2026-08-19: "ของ Teleport พอสแกนเขียวแล้วรูปมันประติดประต่อกันเลย
  //   ของคุณทำแล้วแต่แค่มันไม่ประติดประต่อ" — ถูกต้อง
  // เดิมวางภาพทีละใบด้วยการบิดแบบง่าย (affine) → ขอบไม่ต่อกัน
  // ใหม่: สะสมทุกใบลง "ผืนผ้า 360 ย่อส่วน" แล้ววาดออกจอตามมุมที่หันอยู่จริง
  //   → เป็นผืนเดียวกันทั้งจอ ต่อเนียน เหมือนยืนอยู่ในภาพจริงๆ
  MOS_W: 1024,
  MOS_H: 512,

  _mosInit() {
    const st = this._state;
    st.mos = new Uint8ClampedArray(this.MOS_W * this.MOS_H * 4);
    st.mosSeen = new Uint8Array(this.MOS_W * this.MOS_H);
    st.mosBuf = null;
  },

  // ลงภาพใบใหม่บนผืนผ้าย่อส่วน (ทำครั้งเดียวตอนเก็บภาพ ไม่ได้ทำทุกเฟรม)
  _mosPaint(fr) {
    const st = this._state;
    if (!st.mos) this._mosInit();
    const W = this.MOS_W, H = this.MOS_H;
    const ax = this._axes(fr.q);
    const tanH = Math.tan(st.hFov / 2), tanV = Math.tan(st.vFov / 2);
    const capR = Math.atan(Math.sqrt(tanH * tanH + tanV * tanV)) + 0.03;
    const cLat = Math.asin(Math.max(-1, Math.min(1, ax.fwd[1])));
    const cLon = Math.atan2(ax.fwd[0], -ax.fwd[2]);
    const sinC = Math.sin(cLat), cosC = Math.cos(cLat), cosCapR = Math.cos(capR);
    const src = fr.rgb;

    const y0 = Math.max(0, Math.floor((0.5 - (cLat + capR) / Math.PI) * H));
    const y1 = Math.min(H - 1, Math.ceil((0.5 - (cLat - capR) / Math.PI) * H));
    for (let y = y0; y <= y1; y++) {
      const la = (0.5 - (y + 0.5) / H) * Math.PI;
      const cosLa = Math.cos(la), sinLa = Math.sin(la);
      const denom = cosC * cosLa;
      let xs = 0, xc = W;
      if (Math.abs(denom) > 1e-6) {
        const cd = (cosCapR - sinC * sinLa) / denom;
        if (cd >= 1) continue;
        if (cd > -1) {
          const half = Math.ceil(Math.acos(cd) / (2 * Math.PI) * W) + 1;
          xs = Math.round((cLon / (2 * Math.PI) + 0.5) * W) - half;
          xc = half * 2 + 1;
          if (xc >= W) { xs = 0; xc = W; }
        }
      }
      for (let k = 0; k < xc; k++) {
        let x = xs + k;
        if (x < 0) x += W; else if (x >= W) x -= W;
        const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
        const dx = cosLa * Math.sin(lo), dy = sinLa, dz = -cosLa * Math.cos(lo);
        const f = dx * ax.fwd[0] + dy * ax.fwd[1] + dz * ax.fwd[2];
        if (f <= 0.1) continue;
        const px = (dx * ax.right[0] + dy * ax.right[1] + dz * ax.right[2]) / f / tanH;
        if (px < -1 || px > 1) continue;
        const py = (dx * ax.up[0] + dy * ax.up[1] + dz * ax.up[2]) / f / tanV;
        if (py < -1 || py > 1) continue;
        const sx = ((px + 1) * 0.5 * fr.w) | 0, sy = ((1 - py) * 0.5 * fr.h) | 0;
        const si = ((sy < fr.h ? sy : fr.h - 1) * fr.w + (sx < fr.w ? sx : fr.w - 1)) * 3;
        const oi = y * W + x, di = oi * 4;
        st.mos[di] = src[si]; st.mos[di + 1] = src[si + 1]; st.mos[di + 2] = src[si + 2]; st.mos[di + 3] = 255;
        st.mosSeen[oi] = 1;
      }
    }
  },

  // วาดผืนผ้าออกจอตามมุมที่หันอยู่ (ความละเอียดต่ำแล้วขยาย — ลื่นพอที่ 30 เฟรม/วินาที)
  _mosRender(ctx, cw, ch, ax, box) {
    const st = this._state;
    if (!st.mos) return;
    const RW = 168, RH = Math.max(1, Math.round(168 * ch / cw));
    if (!st.mosBuf || st.mosBuf.width !== RW || st.mosBuf.height !== RH) {
      st.mosBuf = document.createElement('canvas');
      st.mosBuf.width = RW; st.mosBuf.height = RH;
      st.mosImg = st.mosBuf.getContext('2d').createImageData(RW, RH);
    }
    const out = st.mosImg.data;
    const W = this.MOS_W, H = this.MOS_H;
    // มุมมองของ "ทั้งจอ" กว้างกว่ากรอบกล้องตามสัดส่วน — จุดนอกมุมกล้องจึงมีที่อยู่
    const tH = Math.tan(st.hFov / 2) * (cw / box.w);
    const tV = Math.tan(st.vFov / 2) * (ch / box.h);
    const r = ax.right, u = ax.up, f = ax.fwd;

    for (let y = 0; y < RH; y++) {
      const py = (1 - (y + 0.5) / RH * 2) * tV;
      for (let x = 0; x < RW; x++) {
        const px = ((x + 0.5) / RW * 2 - 1) * tH;
        const vx = f[0] + px * r[0] + py * u[0];
        const vy = f[1] + px * r[1] + py * u[1];
        const vz = f[2] + px * r[2] + py * u[2];
        const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
        const lat = Math.asin(vy / len);
        const lon = Math.atan2(vx / len, -vz / len);
        const mx = ((lon / (2 * Math.PI) + 0.5) * W) | 0;
        const my = ((0.5 - lat / Math.PI) * H) | 0;
        const oi = (y * RW + x) * 4;
        if (mx < 0 || mx >= W || my < 0 || my >= H || !st.mosSeen[my * W + mx]) {
          out[oi] = 0; out[oi + 1] = 0; out[oi + 2] = 0; out[oi + 3] = 255;   // ยังไม่ได้สแกน = ดำ
          continue;
        }
        const si = (my * W + mx) * 4;
        out[oi] = st.mos[si]; out[oi + 1] = st.mos[si + 1]; out[oi + 2] = st.mos[si + 2]; out[oi + 3] = 255;
      }
    }
    st.mosBuf.getContext('2d').putImageData(st.mosImg, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(st.mosBuf, 0, 0, cw, ch);
  },

  // ════════════════════════════════════════════════════════
  // ต่อภาพเป็นผืน 360
  // ════════════════════════════════════════════════════════
  // 3 ขั้น (เพิ่ม 2 ขั้นแรกหลังเจ้าของงานบอกว่า "ของ Teleport เนียนเหมือน VR" 2026-08-19):
  //   1. จูนมุมกล้อง  — เดามุมผิดแค่ 3° ก็ทำให้ภาพเหลื่อมสะสมทั้งใบ หาค่าที่ดีที่สุดให้เอง
  //   2. ขยับให้เข้าที่ — เซ็นเซอร์หมุนของมือถือมี "ดริฟต์" สะสมระหว่างสแกน
  //      จึงเลื่อนภาพแต่ละใบทีละองศาเทียบกับใบที่วางไปแล้ว จนทับกันพอดีที่สุด
  //      (นี่คือสิ่งที่แอปเนทีฟทำด้วย ARKit — เราทำด้วยการเทียบภาพแทน)
  //   3. เกลี่ยรอยต่อ — ไม่ตัดขอบแข็ง แต่ค่อยๆ จางเข้าหากัน + ปรับความสว่างให้เท่ากัน
  //      (กล้องมือถือปรับแสงเองทุกใบ ถ้าไม่ปรับจะเห็นเป็นแถบสว่าง-มืดสลับ)

  // แปลง quaternion เป็นแกน แล้วหมุนเพิ่มอีกนิดตามค่าที่ปรับ (yaw/pitch/roll เป็นองศา)
  _axesAdj(q, dy, dp, dr) {
    const d2r = Math.PI / 180;
    let qq = q;
    if (dr) { const h = dr * d2r / 2; qq = this._qmul(qq, [0, 0, Math.sin(h), Math.cos(h)]); }
    if (dp) { const h = dp * d2r / 2; qq = this._qmul(qq, [Math.sin(h), 0, 0, Math.cos(h)]); }
    if (dy) { const h = dy * d2r / 2; qq = this._qmul(qq, [0, Math.sin(h), 0, Math.cos(h)]); }
    return this._axes(qq);
  },

  // ── ขั้น 1+2: หาค่ามุมกล้อง + ขยับแต่ละใบให้ทับกันพอดี ──
  // ทำบนผืนผ้าย่อส่วนขาวดำ (เร็วกว่าของจริง ~40 เท่า) แล้วค่อยเอาค่าที่ได้ไปวาดจริง
  async _align() {
    const st = this._state;
    const GW = 1024, GH = 512;
    const gray = new Float32Array(GW * GH);
    const seen = new Uint8Array(GW * GH);

    // ย่อภาพแต่ละใบเป็นขาวดำไว้เทียบ (ไม่แตะภาพจริง)
    const small = st.frames.map((fr) => {
      const sw = 96, sh = Math.max(1, Math.round(96 * fr.h / fr.w));
      const g = new Float32Array(sw * sh);
      const d = fr.rgb;
      for (let y = 0; y < sh; y++) {
        const sy = ((y + 0.5) / sh * fr.h) | 0;
        for (let x = 0; x < sw; x++) {
          const sx = ((x + 0.5) / sw * fr.w) | 0;
          const i = (sy * fr.w + sx) * 3;
          g[y * sw + x] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
        }
      }
      return { g: g, w: sw, h: sh };
    });

    // เทียบใบหนึ่งกับสิ่งที่วางไว้แล้ว → คืนค่าความต่างเฉลี่ย (ยิ่งน้อยยิ่งทับกันดี)
    const score = (fi, ax, tanH, tanV) => {
      const s = small[fi];
      let sum = 0, n = 0, sa = 0, sb = 0;
      for (let y = 2; y < s.h - 2; y += 2) {
        const py = 1 - (y + 0.5) / s.h * 2;
        for (let x = 2; x < s.w - 2; x += 2) {
          const px = (x + 0.5) / s.w * 2 - 1;
          const vx = ax.fwd[0] + px * tanH * ax.right[0] + py * tanV * ax.up[0];
          const vy = ax.fwd[1] + px * tanH * ax.right[1] + py * tanV * ax.up[1];
          const vz = ax.fwd[2] + px * tanH * ax.right[2] + py * tanV * ax.up[2];
          const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
          const lat = Math.asin(vy / len), lon = Math.atan2(vx / len, -vz / len);
          const gx = ((lon / (2 * Math.PI) + 0.5) * GW) | 0;
          const gy = ((0.5 - lat / Math.PI) * GH) | 0;
          if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
          const gi = gy * GW + gx;
          if (!seen[gi]) continue;
          const a = s.g[y * s.w + x], b = gray[gi];
          sum += Math.abs(a - b); n++; sa += a; sb += b;
        }
      }
      return { err: n < 40 ? 1e9 : sum / n, n: n, gain: (n && sa) ? sb / sa : 1 };
    };

    const paint = (fi, ax, tanH, tanV, gain) => {
      const s = small[fi];
      for (let y = 0; y < s.h; y++) {
        const py = 1 - (y + 0.5) / s.h * 2;
        for (let x = 0; x < s.w; x++) {
          const px = (x + 0.5) / s.w * 2 - 1;
          const vx = ax.fwd[0] + px * tanH * ax.right[0] + py * tanV * ax.up[0];
          const vy = ax.fwd[1] + px * tanH * ax.right[1] + py * tanV * ax.up[1];
          const vz = ax.fwd[2] + px * tanH * ax.right[2] + py * tanV * ax.up[2];
          const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
          const lat = Math.asin(vy / len), lon = Math.atan2(vx / len, -vz / len);
          const gx = ((lon / (2 * Math.PI) + 0.5) * GW) | 0;
          const gy = ((0.5 - lat / Math.PI) * GH) | 0;
          if (gx < 0 || gx >= GW || gy < 0 || gy >= GH) continue;
          const gi = gy * GW + gx;
          if (seen[gi]) continue;                       // ใบแรกที่ถึงเป็นเจ้าของ (กันเบลอตอนเทียบ)
          gray[gi] = s.g[y * s.w + x] * gain; seen[gi] = 1;
        }
      }
    };

    // ── ขั้น 1: ลองมุมกล้องหลายค่ากับ 6 ใบแรก เลือกค่าที่ต่อกันเนียนสุด ──
    const baseLong = this.fovLong();
    let bestFov = baseLong, bestErr = Infinity;
    const probe = Math.min(6, st.frames.length);
    for (const cand of [baseLong - 8, baseLong - 4, baseLong, baseLong + 4, baseLong + 8]) {
      if (cand < 40 || cand > 90) continue;
      gray.fill(0); seen.fill(0);
      const long = cand * Math.PI / 180;
      const W = st.frameW, H = st.frameH;
      const hF = W >= H ? long : 2 * Math.atan(Math.tan(long / 2) * W / H);
      const vF = W >= H ? 2 * Math.atan(Math.tan(long / 2) * H / W) : long;
      const tH = Math.tan(hF / 2), tV = Math.tan(vF / 2);
      let tot = 0, cnt = 0;
      for (let i = 0; i < probe; i++) {
        const ax = this._axes(st.frames[i].q);
        if (i) { const r = score(i, ax, tH, tV); if (r.err < 1e8 && r.n > 60) { tot += r.err; cnt++; } }
        paint(i, ax, tH, tV, 1);
      }
      const e = cnt ? tot / cnt : Infinity;
      if (e < bestErr) { bestErr = e; bestFov = cand; }
    }
    st.fovLongUsed = bestFov;
    const long = bestFov * Math.PI / 180;
    const W = st.frameW, H = st.frameH;
    st.hFov = W >= H ? long : 2 * Math.atan(Math.tan(long / 2) * W / H);
    st.vFov = W >= H ? 2 * Math.atan(Math.tan(long / 2) * H / W) : long;
    const tanH = Math.tan(st.hFov / 2), tanV = Math.tan(st.vFov / 2);

    // ── ขั้น 2: ไล่ขยับทีละใบให้ทับกับที่วางไว้แล้วพอดีที่สุด ──
    // ทำ 2 รอบ: รอบแรกไล่ไปหน้า รอบสองไล่ย้อนกลับ
    //   เพราะใบแรกๆ ตอนรอบแรกยังไม่มีอะไรให้เทียบเลย (วางตามเซ็นเซอร์ล้วน)
    //   รอบสองมันจะได้เทียบกับใบหลังที่จัดเข้าที่แล้ว → ดริฟต์สะสมหายไปเกือบหมด
    const N = st.frames.length;
    for (let pass = 0; pass < 2; pass++) {
      const order = pass === 0
        ? st.frames.map((_, k) => k)
        : st.frames.map((_, k) => N - 1 - k);
      gray.fill(0); seen.fill(0);
      for (let oi = 0; oi < order.length; oi++) {
        const i = order[oi];
        const fr = st.frames[i];
        const isFirst = oi === 0;
      let best = fr.adj ? { dy: fr.adj.dy, dp: fr.adj.dp, dr: fr.adj.dr, err: Infinity, gain: fr.gain || 1 }
        : { dy: 0, dp: 0, dr: 0, err: Infinity, gain: 1 };
      if (!isFirst) {
        // ⚠️ กับดัก: ถ้าตัดสินด้วย "ค่าต่างเฉลี่ย" ล้วน ระบบจะชอบท่าที่ทับกันน้อยที่สุด
        //    (ทับน้อย = จุดเทียบน้อย = เฉลี่ยแล้วดูดี) → ภาพจะถูกดันออกจากกันจนหลุด
        //    จึงต้องกำหนดว่าต้องทับกันไม่น้อยกว่า 75% ของท่าเริ่มต้นถึงจะนับ
        const b0 = best;
        const base = score(i, this._axesAdj(fr.q, b0.dy, b0.dp, b0.dr), tanH, tanV);
        best = { dy: b0.dy, dp: b0.dp, dr: b0.dr, err: base.err, gain: base.gain };
        const needN = Math.max(40, base.n * 0.75);
        // ค้นหยาบก่อน (ทีละ 2°) แล้วค่อยละเอียด (ทีละ 0.5°) รอบค่าที่ดีที่สุด
        for (const step of [2, 0.5]) {
          const c = { dy: best.dy, dp: best.dp, dr: best.dr };
          for (let dy = -2; dy <= 2; dy++) {
            for (let dp = -2; dp <= 2; dp++) {
              for (let dr = -1; dr <= 1; dr++) {
                const Y = c.dy + dy * step, P = c.dp + dp * step, R = c.dr + dr * step;
                const ax = this._axesAdj(fr.q, Y, P, R);
                const s = score(i, ax, tanH, tanV);
                // ⚠️ ต้องดีขึ้น "อย่างมีนัย" (>8%) ถึงจะยอมขยับ
                //    ผนังขาวเรียบๆ ในไซต์งานแทบไม่มีลวดลายให้เทียบ ถ้ายอมขยับตามความต่างเล็กน้อย
                //    ระบบจะเลื่อนภาพมั่วตามสัญญาณรบกวน (เจอตอนทดสอบกับภาพสีเรียบ)
                if (s.n >= needN && s.err < best.err * 0.92) best = { dy: Y, dp: P, dr: R, err: s.err, gain: s.gain };
              }
            }
          }
        }
      }
      if (Math.abs(best.dy) > 3 || Math.abs(best.dp) > 3 || Math.abs(best.dr) > 3) {
        best = { dy: 0, dp: 0, dr: 0, err: best.err, gain: best.gain };   // ขยับเยอะผิดปกติ = ไม่เชื่อ
      }
      fr.adj = best;
      fr.gain = Math.max(0.75, Math.min(1.33, best.gain || 1));
      paint(i, this._axesAdj(fr.q, best.dy, best.dp, best.dr), tanH, tanV, fr.gain);
        st.ui.hud.textContent = 'จัดภาพให้เข้าที่ (รอบ ' + (pass + 1) + '/2) ' + (oi + 1) + '/' + N + '…';
        if (oi % 3 === 2) await new Promise((r) => setTimeout(r, 0));
      }
    }
  },

  // ── ปิดพื้นใต้เท้าด้วยโลโก้ (nadir patch) ────────────────
  // ตรงพื้นจะเห็นเท้าคนถ่ายเสมอ เพราะยืนอยู่ตรงนั้น — วงการภาพ 360 แก้ด้วยการแปะโลโก้ทับ
  // เจ้าของงานเคาะ 2026-08-19: ใช้โลโก้ DESIGNTERIOR เป็นวงกลม
  //
  // วิธีวาง: ผืนผ้า 360 แถวล่างสุด = จุดใต้เท้าพอดี · ยิ่งขึ้นไปยิ่งเป็นวงกว้างขึ้น
  //   จึงแปลงพิกัดเป็น "รัศมี+มุม" บนแผ่นวงกลม → เวลาก้มมองในทัวร์จะเห็นเป็นวงกลมกลมจริง
  async _nadirPatch(out, W, H) {
    const img = await new Promise((res) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = () => res(null);
      im.src = 'assets/nadir-logo.png';
    });
    if (!img) return;

    const S = 512;
    const c = document.createElement('canvas');
    c.width = S; c.height = S;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, S, S);
    const lg = g.getImageData(0, 0, S, S).data;

    const EDGE = -62 * Math.PI / 180;          // แปะจากใต้เท้าขึ้นมาถึงมุมก้ม 62°
    const span = EDGE + Math.PI / 2;
    const yStart = Math.max(0, Math.floor((0.5 - EDGE / Math.PI) * H));
    for (let y = yStart; y < H; y++) {
      const lat = (0.5 - (y + 0.5) / H) * Math.PI;
      const r = (lat + Math.PI / 2) / span;
      if (r > 1) continue;
      const fade = r > 0.86 ? Math.max(0, (1 - r) / 0.14) : 1;   // ขอบนอกค่อยๆ จางเข้าหาพื้นจริง
      for (let x = 0; x < W; x++) {
        const lon = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
        const u = 0.5 + 0.5 * r * Math.sin(lon);
        const v = 0.5 - 0.5 * r * Math.cos(lon);
        let sx = (u * S) | 0, sy = (v * S) | 0;
        sx = sx < 0 ? 0 : (sx > S - 1 ? S - 1 : sx);
        sy = sy < 0 ? 0 : (sy > S - 1 ? S - 1 : sy);
        const si = (sy * S + sx) * 4;
        const a = (lg[si + 3] / 255) * fade;
        if (a <= 0.01) continue;
        const di = (y * W + x) * 4;
        out[di] = out[di] * (1 - a) + lg[si] * a;
        out[di + 1] = out[di + 1] * (1 - a) + lg[si + 1] * a;
        out[di + 2] = out[di + 2] * (1 - a) + lg[si + 2] * a;
        out[di + 3] = 255;
      }
    }
  },

  async _stitch() {
    const st = this._state;
    await this._align();

    const W = this.OUT_W, H = this.OUT_H;
    const out = new Uint8ClampedArray(W * H * 4);
    const tanH = Math.tan(st.hFov / 2), tanV = Math.tan(st.vFov / 2);

    const sinLon = new Float64Array(W), cosLon = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      sinLon[x] = Math.sin(lo); cosLon[x] = Math.cos(lo);
    }
    const capR = Math.atan(Math.sqrt(tanH * tanH + tanV * tanV)) + 0.02;

    // เตรียมข้อมูลรายใบไว้ล่วงหน้า (แกนหลังปรับ + ขอบเขตบนผืนผ้า)
    const F = st.frames.map((fr) => {
      const a = fr.adj || { dy: 0, dp: 0, dr: 0 };
      const ax = this._axesAdj(fr.q, a.dy, a.dp, a.dr);
      const cLat = Math.asin(Math.max(-1, Math.min(1, ax.fwd[1])));
      return {
        ax: ax, src: fr.rgb, w: fr.w, h: fr.h, gain: fr.gain || 1,
        cLat: cLat, cLon: Math.atan2(ax.fwd[0], -ax.fwd[2]),
        sinC: Math.sin(cLat), cosC: Math.cos(cLat),
        y0: Math.max(0, Math.floor((0.5 - (cLat + capR) / Math.PI) * H)),
        y1: Math.min(H - 1, Math.ceil((0.5 - (cLat - capR) / Math.PI) * H)),
      };
    });

    // ── เกลี่ยรอยต่อ: ทำทีละแถบ (กันหน่วยความจำบวมบนมือถือ) ──
    const BAND = 128;
    const cosCapR = Math.cos(capR);
    const accR = new Float32Array(W * BAND), accG = new Float32Array(W * BAND);
    const accB = new Float32Array(W * BAND), accW = new Float32Array(W * BAND);

    for (let by = 0; by < H; by += BAND) {
      const bh = Math.min(BAND, H - by);
      accR.fill(0); accG.fill(0); accB.fill(0); accW.fill(0);

      for (const f of F) {
        if (f.y1 < by || f.y0 >= by + bh) continue;
        const ax = f.ax, src = f.src, fw = f.w, fh = f.h, gain = f.gain;
        const rX = ax.right[0], rY = ax.right[1], rZ = ax.right[2];
        const uX = ax.up[0], uY = ax.up[1], uZ = ax.up[2];
        const fX = ax.fwd[0], fY = ax.fwd[1], fZ = ax.fwd[2];

        const yA = Math.max(by, f.y0), yB = Math.min(by + bh - 1, f.y1);
        for (let y = yA; y <= yB; y++) {
          const la = (0.5 - (y + 0.5) / H) * Math.PI;
          const cosLa = Math.cos(la), sinLa = Math.sin(la);
          const denom = f.cosC * cosLa;
          let xStart = 0, xCount = W;
          if (Math.abs(denom) > 1e-6) {
            const cosD = (cosCapR - f.sinC * sinLa) / denom;
            if (cosD >= 1) continue;
            if (cosD > -1) {
              const half = Math.ceil(Math.acos(cosD) / (2 * Math.PI) * W) + 1;
              xStart = Math.round((f.cLon / (2 * Math.PI) + 0.5) * W) - half;
              xCount = half * 2 + 1;
              if (xCount >= W) { xStart = 0; xCount = W; }
            }
          }
          const rowOut = (y - by) * W;
          for (let k = 0; k < xCount; k++) {
            let x = xStart + k;
            if (x < 0) x += W; else if (x >= W) x -= W;
            const dx = cosLa * sinLon[x], dy = sinLa, dz = -cosLa * cosLon[x];
            const fd = dx * fX + dy * fY + dz * fZ;
            if (fd <= 0.08) continue;
            const px = (dx * rX + dy * rY + dz * rZ) / fd / tanH;
            if (px < -1 || px > 1) continue;
            const py = (dx * uX + dy * uY + dz * uZ) / fd / tanV;
            if (py < -1 || py > 1) continue;

            // น้ำหนัก = ระยะจากขอบภาพ ยกกำลังสูง → ใบที่ "เห็นจุดนี้ชัดที่สุด" ครองภาพเกือบทั้งหมด
            // ⚠️ เดิมยกกำลังต่ำ = เฉลี่ยหลายใบเท่าๆ กัน ถ้าใบไหนคลาดนิดเดียวภาพจะเบลอทันที
            //    (นี่คือสาเหตุที่บางจุด "เลือนๆ" — เจ้าของงานสังเกตออก 2026-08-19)
            const e1 = 1 - Math.abs(px), e2 = 1 - Math.abs(py);
            const e = e1 * e2;
            const wgt = e * e * e * e * e * e * fd + 1e-6;

            // สุ่มสีแบบเฉลี่ย 4 จุดข้างเคียง (bilinear) — คมกว่าหยิบจุดเดียวแบบเดิมชัดเจน
            const fx = (px + 1) * 0.5 * (fw - 1), fy = (1 - py) * 0.5 * (fh - 1);
            const x0 = fx | 0, y0b = fy | 0;
            const x1 = x0 + 1 < fw ? x0 + 1 : fw - 1, y1b = y0b + 1 < fh ? y0b + 1 : fh - 1;
            const tx = fx - x0, ty = fy - y0b;
            const i00 = (y0b * fw + x0) * 3, i10 = (y0b * fw + x1) * 3;
            const i01 = (y1b * fw + x0) * 3, i11 = (y1b * fw + x1) * 3;
            const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
            const oi = rowOut + x;
            const gw = gain * wgt;
            accR[oi] += (src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11) * gw;
            accG[oi] += (src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11) * gw;
            accB[oi] += (src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11) * gw;
            accW[oi] += wgt;
          }
        }
      }

      for (let i = 0; i < W * bh; i++) {
        const di = ((by * W) + i) * 4;
        const w8 = accW[i];
        if (w8 > 0) {
          out[di] = accR[i] / w8; out[di + 1] = accG[i] / w8; out[di + 2] = accB[i] / w8; out[di + 3] = 255;
        }
      }
      st.ui.hud.textContent = 'กำลังเกลี่ยรอยต่อ ' + Math.min(100, Math.round((by + bh) / H * 100)) + '%';
      await new Promise((r) => setTimeout(r, 0));
    }

    // ── ปิดรูเล็กที่หลงเหลือด้วยการลามสีจากเพื่อนบ้าน ──
    const filled = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (out[i * 4 + 3]) filled[i] = 1;
    for (let pass = 0; pass < 6; pass++) {
      let n = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (filled[i]) continue;
          let r = 0, g = 0, b = 0, c = 0;
          const nb = [y > 0 ? i - W : -1, y < H - 1 ? i + W : -1,
            y * W + (x === 0 ? W - 1 : x - 1), y * W + (x === W - 1 ? 0 : x + 1)];
          for (const j of nb) { if (j < 0 || filled[j] !== 1) continue; const d = j * 4; r += out[d]; g += out[d + 1]; b += out[d + 2]; c++; }
          if (!c) continue;
          const d = i * 4;
          out[d] = r / c; out[d + 1] = g / c; out[d + 2] = b / c; out[d + 3] = 255;
          filled[i] = 2; n++;
        }
      }
      if (!n) break;
      for (let i = 0; i < W * H; i++) if (filled[i] === 2) filled[i] = 1;
    }

    let gap = 0;
    for (let i = 0; i < W * H; i++) {
      if (!filled[i]) { gap++; const d = i * 4; out[d] = 24; out[d + 1] = 30; out[d + 2] = 42; out[d + 3] = 255; }
    }
    PanoCapture._coverGap = Math.round(gap / (W * H) * 1000) / 10;

    st.ui.hud.textContent = 'กำลังปิดพื้นด้วยโลโก้…';
    try { await this._nadirPatch(out, W, H); } catch (e) { /* ไม่มีโลโก้ก็ปล่อยพื้นเดิม */ }

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return { dataUrl: c.toDataURL('image/jpeg', 0.93), w: W, h: H };
  },

  async finish() {
    const st = this._state;
    if (!st || st.busy) return;
    st.busy = true;
    st.running = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    st.ui.done.disabled = true;
    st.ui.hud.textContent = 'กำลังต่อภาพ…';
    let res = null;
    try { res = await this._stitch(); }
    catch (e) { this._toast(st.ui, 'ต่อภาพไม่สำเร็จ: ' + e.message, true); }
    const cb = st.onDone;
    this.close();
    if (res && cb) cb(res);
  },

  close() {
    const st = this._state;
    if (!st) return;
    st.running = false;
    if (st.raf) cancelAnimationFrame(st.raf);
    if (st.onOri) window.removeEventListener('deviceorientation', st.onOri, true);
    if (st.stream) st.stream.getTracks().forEach((t) => t.stop());
    if (st.ui && st.ui.root) st.ui.root.remove();
    this._state = null;
  },

  // ── ปรับมุมกล้อง (จำต่อเครื่อง) — ใช้เมื่อภาพต่อแล้วเหลื่อมหรือมีช่องว่าง ──
  async calibrate() {
    const cur = this.fovLong();
    const v = prompt('มุมมองกล้องด้านยาว (องศา)\n' +
      'ค่ามาตรฐาน 63 · ถ้าภาพต่อแล้วซ้อนกันให้ลดลง · ถ้ามีช่องว่างให้เพิ่มขึ้น', String(cur));
    if (!v) return;
    const n = Number(v);
    if (!(n >= 40 && n <= 90)) return this._toast(this._state.ui, 'ใส่ได้ระหว่าง 40-90', true);
    localStorage.setItem(this.FOV_KEY, String(n));
    if (this._state) { this._setupGeometry(); this._state.frames = []; }
  },

  // ── หน้าตา ────────────────────────────────────────────────
  _buildUI() {
    const root = document.createElement('div');
    root.id = 'pano-capture';
    root.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#000;overflow:hidden;' +
      'font-family:var(--font-family-base,sans-serif)';
    root.innerHTML =
      '<video id="pc-video" playsinline autoplay muted ' +
      'style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:60%;border-radius:4px;background:#111"></video>' +
      '<canvas id="pc-overlay" style="position:absolute;inset:0;width:100%;height:100%"></canvas>' +

      // แถวบน: ย้อนกลับ 1 ใบ · ตัวนับ · ปรับมุมกล้อง · ปิด
      '<div style="position:absolute;top:0;left:0;right:0;padding:14px 16px;display:flex;' +
      'justify-content:space-between;align-items:center;gap:10px;color:#fff">' +
      '<button id="pc-undo" style="all:unset;cursor:pointer;width:42px;height:42px;border-radius:50%;' +
      'background:#fff;color:#000;display:flex;align-items:center;justify-content:center;">' +
      '<i data-lucide="rotate-ccw" style="width:20px;height:20px"></i></button>' +
      '<div style="text-align:center;line-height:1.3">' +
      '<div id="pc-hud" style="font-size:15px;font-weight:700">กำลังเปิดกล้อง…</div>' +
      '<button id="pc-cal" style="all:unset;cursor:pointer;font-size:12px;opacity:.7">ปรับมุมกล้อง</button>' +
      '</div>' +
      '<button id="pc-close" style="all:unset;cursor:pointer;width:42px;height:42px;border-radius:50%;' +
      'background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;">' +
      '<i data-lucide="x" style="width:20px;height:20px"></i></button>' +
      '</div>' +

      // แถวล่าง: คำแนะนำ + แถบความคืบหน้า + ปุ่มจบ
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:16px">' +
      '<div style="color:#fff;font-size:13px;text-align:center;margin-bottom:10px;line-height:1.6;opacity:.9">' +
      'ยืนอยู่กับที่ หมุนตัวช้าๆ เล็งวงกลางจอไปที่จุดเขียว<br><b>หยุดนิ่งจนวงเต็ม</b> ระบบจะเก็บภาพให้เอง — ยิ่งนิ่ง ภาพยิ่งต่อเนียน</div>' +
      '<div style="height:8px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden;margin-bottom:12px">' +
      '<div id="pc-bar" style="height:100%;width:0%;background:#4ade80;transition:width .2s"></div></div>' +
      '<button id="pc-done" disabled style="width:100%;padding:14px;border:none;border-radius:12px;' +
      'font-size:16px;font-weight:700;color:#fff;background:#2563eb">กำลังเตรียม…</button>' +
      '<div id="pc-sub" style="color:#cbd5e1;font-size:12px;text-align:center;margin-top:8px;line-height:1.6"></div>' +
      '</div>';
    document.body.appendChild(root);

    const ui = {
      root: root,
      video: root.querySelector('#pc-video'),
      overlay: root.querySelector('#pc-overlay'),
      hud: root.querySelector('#pc-hud'),
      bar: root.querySelector('#pc-bar'),
      undo: root.querySelector('#pc-undo'),
      done: root.querySelector('#pc-done'),
      sub: root.querySelector('#pc-sub'),
    };
    ui.undo.style.visibility = 'hidden';
    if (window.lucide) lucide.createIcons();   // ไอคอน Lucide เท่านั้น — ห้ามอีโมจิในปุ่ม (กติกาโปรเจกต์)
    root.querySelector('#pc-close').onclick = () => this.close();
    root.querySelector('#pc-cal').onclick = () => this.calibrate();
    ui.undo.onclick = () => this.undo();
    ui.done.onclick = () => this.finish();
    return ui;
  },

  _toast(ui, msg, isErr) {
    if (ui && ui.hud) ui.hud.textContent = msg;
    if (window.Modal) Modal.toast((isErr ? '❌ ' : '') + msg);
    if (isErr) setTimeout(() => this.close(), 2600);
  },
};

window.PanoCapture = PanoCapture;

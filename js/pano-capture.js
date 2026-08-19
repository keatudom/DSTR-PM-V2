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
  OUT_W: 3072,          // ผืนผ้า 360 (2:1 เป๊ะ ตามนิยาม equirectangular)
  OUT_H: 1536,
  FRAME_MAX: 800,       // ย่อภาพที่เก็บแต่ละใบ (กันมือถือหน่วย/หน่วยความจำบวม)
  HIT_DEG: 8,           // เล็งใกล้จุดเป้ากี่องศาถึงจะเริ่มนับ
  HOLD_MS: 700,         // ต้องเล็งค้างกี่มิลลิวินาทีถึงจะเก็บ (กันภาพเบลอจากการหมุนเร็ว)
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
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
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
      const holding = nearest && nearestAng <= this.HIT_DEG;
      if (holding) {
        if (st.aimId !== nearest.id) { st.aimId = nearest.id; st.aimAt = Date.now(); }
      } else { st.aimId = null; st.aimAt = 0; }
      const prog = holding ? Math.min(1, (Date.now() - st.aimAt) / this.HOLD_MS) : 0;

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
      st.frames.push({ data: cc.getImageData(0, 0, w, h), w: w, h: h, q: st.q.slice(), targetId: target.id });
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

    st.ui.hud.textContent = done + ' / ' + total;
    st.ui.bar.style.width = Math.round(done / total * 100) + '%';
    st.ui.undo.style.visibility = done ? 'visible' : 'hidden';

    const enough = midDone >= mid.length;              // ครบวงแนวนอน = พอใช้งานได้แล้ว
    st.ui.done.disabled = !enough;
    st.ui.done.textContent = enough
      ? (done < total ? '✅ พอแล้ว ต่อภาพเลย (' + done + '/' + total + ')' : '✅ ครบทุกจุด ต่อภาพเลย')
      : 'ไล่ให้ครบวงแนวสายตาก่อน (' + midDone + '/' + mid.length + ')';
  },
  // ════════════════════════════════════════════════════════
  // ต่อภาพเป็นผืน 360
  // ════════════════════════════════════════════════════════
  // วิธี: ไล่ทีละใบ ฉายลงผืนผ้าเฉพาะบริเวณที่ใบนั้นครอบคลุม
  //   พิกเซลไหนมีหลายใบทับกัน → เลือกใบที่จุดนั้น "อยู่ใกล้กลางภาพที่สุด" (คมกว่า ขอบเพี้ยนน้อยกว่า)
  //   ไม่เกลี่ยสีเฉลี่ย เพราะกินหน่วยความจำเป็นสองเท่าและทำให้ภาพเบลอเวลาเครื่องหมุนคลาด
  async _stitch() {
    const st = this._state;
    const W = this.OUT_W, H = this.OUT_H;
    const out = new Uint8ClampedArray(W * H * 4);
    const best = new Float32Array(W * H);
    const tanH = Math.tan(st.hFov / 2), tanV = Math.tan(st.vFov / 2);

    // ตารางไซน์/โคไซน์ของลองจิจูด — คิดครั้งเดียวใช้ทุกใบ
    // (เดิมคิดใหม่ทุกพิกเซล = ตรีโกณ 2 ครั้ง × 4.7 ล้านพิกเซล × 19 ใบ → ตรงนี้แหละที่ทำให้ช้า 52 วินาที)
    const sinLon = new Float64Array(W), cosLon = new Float64Array(W);
    for (let x = 0; x < W; x++) {
      const lo = ((x + 0.5) / W - 0.5) * 2 * Math.PI;
      sinLon[x] = Math.sin(lo); cosLon[x] = Math.cos(lo);
    }

    // รัศมีเชิงมุมที่ภาพ 1 ใบครอบคลุม (วัดถึงมุมภาพ ไม่ใช่แค่กลางขอบ)
    const capR = Math.atan(Math.sqrt(tanH * tanH + tanV * tanV)) + 0.02;

    for (let fi = 0; fi < st.frames.length; fi++) {
      const fr = st.frames[fi];
      const ax = this._axes(fr.q);
      const src = fr.data.data;
      const fw = fr.w, fh = fr.h;
      const rX = ax.right[0], rY = ax.right[1], rZ = ax.right[2];
      const uX = ax.up[0], uY = ax.up[1], uZ = ax.up[2];
      const fX = ax.fwd[0], fY = ax.fwd[1], fZ = ax.fwd[2];

      const cLat = Math.asin(Math.max(-1, Math.min(1, fY)));
      const cLon = Math.atan2(fX, -fZ);
      const sinC = Math.sin(cLat), cosC = Math.cos(cLat);
      const cosCapR = Math.cos(capR);

      const y0 = Math.max(0, Math.floor((0.5 - (cLat + capR) / Math.PI) * H));
      const y1 = Math.min(H - 1, Math.ceil((0.5 - (cLat - capR) / Math.PI) * H));

      for (let y = y0; y <= y1; y++) {
        const la = (0.5 - (y + 0.5) / H) * Math.PI;
        const cosLa = Math.cos(la), sinLa = Math.sin(la);

        // ช่วงลองจิจูดที่วงกลมรัศมี capR รอบ (cLat,cLon) ตัดกับเส้นละติจูดนี้
        // (สูตรมาตรฐานของ "หมวกทรงกลม" — ตัดพิกเซลนอกวงทิ้งตั้งแต่ต้น ไม่ต้องคำนวณทีละจุด)
        const denom = cosC * cosLa;
        let xStart = 0, xCount = W;
        if (Math.abs(denom) > 1e-6) {
          const cosD = (cosCapR - sinC * sinLa) / denom;
          if (cosD >= 1) continue;                       // เส้นนี้อยู่นอกวงทั้งเส้น
          if (cosD > -1) {
            const dLon = Math.acos(cosD);
            const half = Math.ceil(dLon / (2 * Math.PI) * W) + 1;
            const cx = Math.round((cLon / (2 * Math.PI) + 0.5) * W);
            xStart = cx - half; xCount = half * 2 + 1;
            if (xCount >= W) { xStart = 0; xCount = W; }
          }
        }

        const rowBase = y * W;
        for (let k = 0; k < xCount; k++) {
          let x = xStart + k;
          if (x < 0) x += W; else if (x >= W) x -= W;

          const dx = cosLa * sinLon[x], dy = sinLa, dz = -cosLa * cosLon[x];
          const f = dx * fX + dy * fY + dz * fZ;
          if (f <= 0.08) continue;
          const px = (dx * rX + dy * rY + dz * rZ) / f / tanH;
          if (px < -1 || px > 1) continue;
          const py = (dx * uX + dy * uY + dz * uZ) / f / tanV;
          if (py < -1 || py > 1) continue;

          // ยิ่งใกล้กลางภาพยิ่งดี (ขอบเลนส์เพี้ยนกว่า) — พิกเซลทับกันเลือกใบที่ดีกว่า
          const w8 = (1 - Math.abs(px)) * (1 - Math.abs(py)) * f;
          const oi = rowBase + x;
          if (w8 <= best[oi]) continue;
          best[oi] = w8;

          const sx = ((px + 1) * 0.5 * fw) | 0;
          const sy = ((1 - py) * 0.5 * fh) | 0;
          const si = ((sy < fh ? sy : fh - 1) * fw + (sx < fw ? sx : fw - 1)) * 4;
          const di = oi * 4;
          out[di] = src[si]; out[di + 1] = src[si + 1]; out[di + 2] = src[si + 2]; out[di + 3] = 255;
        }
      }
      st.ui.hud.textContent = 'กำลังต่อภาพ ' + (fi + 1) + '/' + st.frames.length + '…';
      await new Promise((r) => setTimeout(r, 0));   // คืนจังหวะให้จอไม่ค้าง
    }

    // ── ปิดรูเล็กๆ ที่หลงเหลือ ──
    // รูขนาด 1-2 พิกเซลตามรอยต่อทำให้ภาพดูเหมือนเสีย ทั้งที่รอบข้างมีสีอยู่แล้ว
    // จึงลามสีจากเพื่อนบ้านเข้ามาเติมทีละชั้น (ซ้ายขวาวนรอบขอบภาพได้ เพราะ 360 องศาต่อกัน)
    for (let pass = 0; pass < 6; pass++) {
      let filled = 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (best[i] !== 0) continue;
          let r = 0, g = 0, b = 0, n = 0;
          const nb = [
            y > 0 ? i - W : -1, y < H - 1 ? i + W : -1,
            y * W + (x === 0 ? W - 1 : x - 1), y * W + (x === W - 1 ? 0 : x + 1),
          ];
          for (const j of nb) {
            if (j < 0 || best[j] === 0) continue;
            const d = j * 4; r += out[d]; g += out[d + 1]; b += out[d + 2]; n++;
          }
          if (!n) continue;
          const d = i * 4;
          out[d] = r / n; out[d + 1] = g / n; out[d + 2] = b / n; out[d + 3] = 255;
          best[i] = -1;                                  // -1 = เติมมาแล้ว (กันลามซ้ำในรอบเดียวกัน)
          filled++;
        }
      }
      if (!filled) break;
      for (let i = 0; i < W * H; i++) if (best[i] === -1) best[i] = 1e-6;
    }

    // ที่ยังเหลือคือช่องใหญ่จริงๆ (เช่นพื้นใต้เท้าถ้าไม่ได้ก้มถ่าย) → เทาเข้ม ดีกว่าปล่อยดำสนิท
    let gap = 0;
    for (let i = 0; i < W * H; i++) {
      if (best[i] === 0) { gap++; const d = i * 4; out[d] = 24; out[d + 1] = 30; out[d + 2] = 42; out[d + 3] = 255; }
    }
    PanoCapture._coverGap = Math.round(gap / (W * H) * 1000) / 10;

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    c.getContext('2d').putImageData(new ImageData(out, W, H), 0, 0);
    return { dataUrl: c.toDataURL('image/jpeg', 0.85), w: W, h: H };
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
      'background:#fff;color:#000;display:flex;align-items:center;justify-content:center;font-size:20px">↺</button>' +
      '<div style="text-align:center;line-height:1.3">' +
      '<div id="pc-hud" style="font-size:15px;font-weight:700">กำลังเปิดกล้อง…</div>' +
      '<button id="pc-cal" style="all:unset;cursor:pointer;font-size:12px;opacity:.7">ปรับมุมกล้อง</button>' +
      '</div>' +
      '<button id="pc-close" style="all:unset;cursor:pointer;width:42px;height:42px;border-radius:50%;' +
      'background:#ef4444;color:#fff;display:flex;align-items:center;justify-content:center;font-size:20px">✕</button>' +
      '</div>' +

      // แถวล่าง: คำแนะนำ + แถบความคืบหน้า + ปุ่มจบ
      '<div style="position:absolute;left:0;right:0;bottom:0;padding:16px">' +
      '<div style="color:#fff;font-size:13px;text-align:center;margin-bottom:10px;line-height:1.6;opacity:.9">' +
      'ยืนอยู่กับที่ตลอดการสแกน แล้วหมุนตัวเล็งวงกลางจอไปที่จุดเขียว<br>เล็งค้างไว้จนวงเต็ม = เก็บภาพแล้ว</div>' +
      '<div style="height:8px;border-radius:99px;background:rgba(255,255,255,.25);overflow:hidden;margin-bottom:12px">' +
      '<div id="pc-bar" style="height:100%;width:0%;background:#4ade80;transition:width .2s"></div></div>' +
      '<button id="pc-done" disabled style="width:100%;padding:14px;border:none;border-radius:12px;' +
      'font-size:16px;font-weight:700;color:#fff;background:#2563eb">กำลังเตรียม…</button>' +
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
    };
    ui.undo.style.visibility = 'hidden';
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

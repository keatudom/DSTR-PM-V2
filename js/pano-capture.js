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
  OUT_W: 4096,          // ผืนผ้า 360 ขั้นต่ำ (2:1 เป๊ะ ตามนิยาม equirectangular)
  OUT_H: 2048,
  OUT_MAX_W: 6144,      // เพดานผืนผ้า — ระบบเลือกเองตามหน่วยความจำที่เหลือ (ดู _outSize)
  TOTAL_MB: 155,        // งบหน่วยความจำรวมทั้งงาน (ภาพดิบ + ผืนผลลัพธ์ + ตารางช่วยคำนวณ)
  //   วัดจากของเดิมที่ใช้งานได้จริงมาตลอด: ภาพดิบ 98MB + ผืนผ้า/ตาราง 58MB = 156MB
  //   พอเปลี่ยนไปเลนส์ไวด์ ภาพดิบเหลือ ~64MB → เอาส่วนต่างไปเพิ่มความคมของผลลัพธ์แทน
  // ⭐ 2026-09-03 — เปลี่ยนแกนหลัก: ใช้ "เลนส์อัลตร้าไวด์" แทนเลนส์หลัก
  //   สืบมาจาก Teleport (แอปที่เจ้าของงานชี้ว่าทำได้ดี): เวอร์ชันแรกของเขาใช้ 51 ใบ
  //   (พอๆ กับ 53 ใบของเรา) แล้วเปลี่ยนมาใช้เลนส์ไวด์ → เหลือ 16 ใบ
  //   เลนส์หลักมือถือ ~63° · อัลตร้าไวด์ ~106° = คลุมพื้นที่ต่อใบมากกว่า 3 เท่า
  //   ผลที่คำนวณได้: 53 ใบ → ~15 ใบ · เวลาลดลง 3 เท่า · ตะเข็บน้อยลง 3 เท่า
  //   และเพราะใบน้อยลง จึงเพิ่มความละเอียดต่อใบได้โดยใช้หน่วยความจำ "น้อยกว่าเดิม"
  TARGET_PXPD: 17,      // ความละเอียดที่ต้องการ (จุดต่อองศา) — ใช้คำนวณ FRAME_MAX เอง
  //   ผลลัพธ์ 4096px/360° = 11.4 จุด/องศา → ต้นทาง 17 = 1.5 เท่า เหลือให้เกลี่ยพอดี
  //   เดิมล็อก FRAME_MAX=1000 ตายตัว พอเปลี่ยนไปเลนส์ไวด์จะเหลือ 9.4 จุด/องศา = เบลอกว่าเดิม
  MEM_BUDGET_MB: 110,   // เพดานหน่วยความจำรวมของภาพดิบทั้งชุด (กัน Safari ปิดแท็บ)
  CROP_WIDE: 0.88,      // เลนส์ไวด์ใช้แค่ 88% กลางเฟรม — ขอบสุดเลนส์บิดจนแบบจำลองรูเข็มเอาไม่อยู่
  WIDE_DEG: 80,         // เกิน 80° ถือว่าเป็นเลนส์ไวด์ ต้องตัดขอบ
  LENS_KEY: 'dstr_pano_lens',   // เลนส์ที่เลือกไว้ (จำต่อเครื่อง)
  FRAME_MAX: 1000,      // ความละเอียดภาพต่อใบ — ค่าเริ่มต้น ระบบคำนวณใหม่ตอนรู้มุมกล้องจริง
  //   ⚠️ เดิมตั้งไว้ 800 = ทิ้งรายละเอียดกล้องไปกว่าครึ่งตั้งแต่ตอนถ่าย
  //      ภาพ 1 ใบคลุมราว 63° ถ้ากว้าง 800px = 12.7 จุด/องศา ส่วนผลลัพธ์ 4096px/360° = 11.4 จุด/องศา
  //      ต้นทางแทบไม่เหลือรายละเอียดให้เกลี่ย → ภาพออกมานุ่มๆ ไม่คม (เจ้าของงานสังเกตออก 2026-08-19)
  //      1000px = 14.8 จุด/องศา ≈ 1.3 เท่าของผลลัพธ์ — ยังเหลือรายละเอียดให้เกลี่ย
  //   ⚠️ เพดานคือ "หน่วยความจำรวมตอนต่อภาพ" ไม่ใช่แค่ตัวภาพ — ต้องบวกผืนผลลัพธ์ + ตารางตะเข็บด้วย
  //      53 ใบ x 1000px = 90MB + ผืนผลลัพธ์ 34MB + ตารางอีก ~35MB ≈ 155MB
  //      เกินกว่านี้เสี่ยง Safari ปิดแท็บทิ้งกลางคัน = เสียงานทั้งห้อง ต้องสแกนใหม่หมด
  //   เก็บเป็น RGB 3 ไบต์ (ไม่เก็บช่องโปร่งใส) → ประหยัดหน่วยความจำ 25% ชดเชยที่ภาพใหญ่ขึ้น
  HIT_DEG: 3.5,         // เล็งใกล้จุดเป้ากี่องศาถึงจะเริ่มนับ (แคบลง = ต้องเล็งเป๊ะขึ้น ภาพต่อเนียนขึ้น)
  HOLD_MS: 260,         // กวาดผ่านจุดแล้วเก็บเลย ไม่ต้องหยุดนิ่ง (แค่กันเก็บซ้ำ)
  DENSITY: 1.5,         // ถ่ายถี่กว่าขั้นต่ำกี่เท่า — ยิ่งถี่ ของใกล้ยิ่งเหลื่อมน้อย
  //   วัดจริงด้วยฉากจำลองพารัลแลกซ์: ถี่ 2 เท่า → รอยขาดกลางลาย 0.35% → 0.22%
  //   แต่ 2 เท่า = 72 ใบ = 176MB เสี่ยงแอปดับ · 1.5 เท่าได้ประโยชน์เกือบเต็มที่ ~104MB
  STEADY_DPS: 13,       // ถ้าหมุนเร็วกว่านี้ (องศา/วินาที) ยังไม่นับ — ต้องถือนิ่งก่อน
  //   ⚠️ เจ้าของงานทัก 2026-08-19: "ของเราเร็วมาก ยังไม่ได้จับรายละเอียดเลยสแกนเสร็จแล้ว
  //      อย่างงี้อาจจะทำให้รูปมันหลุดกันได้" — ถูกต้อง ภาพที่ถ่ายตอนมือยังขยับ = เบลอ + องศาคลาด
  //      จึงต้องทั้ง "ค้างนานขึ้น" และ "นิ่งจริง" ถึงจะเก็บ
  FOV_KEY: 'dstr_pano_fov',   // มุมกล้องด้านยาว — จำไว้ต่อเครื่อง (ปรับได้ในจอสแกน)

  _state: null,

  // ⚠️ 2026-09-03: เพดานเดิม 90° ปัดค่าของเลนส์อัลตร้าไวด์ (~106°) ทิ้งแล้วกลับไปใช้ 63
  //    = เปลี่ยนไปใช้เลนส์ไวด์แล้วแต่คำนวณด้วยมุมของเลนส์หลัก → จุดเป้าผิดหมด ภาพพัง
  //    ขยายเป็น 40-140° และ "แยกค่าตามเลนส์" เพราะเลนส์หลักกับไวด์คนละมุมกัน
  FOV_MIN: 40,
  FOV_MAX: 140,
  _fovKey() {
    const lens = localStorage.getItem(this.LENS_KEY) || 'default';
    return this.FOV_KEY + '_' + lens.slice(0, 16);
  },
  fovLong() {
    let v = Number(localStorage.getItem(this._fovKey()));
    if (!(v >= this.FOV_MIN && v <= this.FOV_MAX)) {
      v = Number(localStorage.getItem(this.FOV_KEY));      // ค่าเก่าก่อนแยกตามเลนส์
    }
    return v >= this.FOV_MIN && v <= this.FOV_MAX ? v : 63;
  },

  // ── จุดเป้าที่ต้องไล่เล็ง (วงแนวนอน 3 วง + ยอดเพดาน) ──────
  // วางเป็นวงตามละติจูด ให้แต่ละใบซ้อนกัน ~20% ทั้งแนวตั้งและแนวนอน
  // ถ้าเว้นห่างกว่านี้จะเกิด "รูโหว่รูปตา" ตรงมุมภาพที่ 4 ใบมาบรรจบกัน (เจอตอนทดสอบไป-กลับ)
  _targets(hFovDeg, vFovDeg) {
    const out = [];
    // ⚠️ ต้องเว้นซ้อนกันเผื่อ "ความคลาดตอนเล็ง" ของสองใบที่ติดกัน (คลาดคนละทางได้)
    //    เดิมคิดเป็น % ของมุมกล้อง (80%) → ถือแนวตั้งมุมกว้างแค่ 38° ซ้อนกันเหลือ 7.6°
    //    แต่เล็งคลาดได้ ±4.5° สองใบรวม 9° → ซ้อนกันติดลบ = เป็นรูดำ (เจ้าของงานเจอจริง 2026-08-19)
    //    ใหม่: เว้นเป็น "องศาสัมบูรณ์" = ความคลาด 2 เท่า + กันชน 5° → ไม่มีทางเป็นรู
    const margin = this.HIT_DEG * 2 + 5;
    const vStep = Math.max(18, vFovDeg - margin);
    const hStep = Math.max(18, hFovDeg - margin);

    const lats = [0];
    for (let k = 1; k <= 4; k++) {
      const l = Math.min(88, k * vStep);
      lats.push(l, -l);
      if (l + vFovDeg / 2 >= 90) break;                 // คลุมถึงขั้วแล้ว พอ
    }

    // เรียงวงจากกลางออกไปบน-ล่างสลับกัน แล้วกวาดสลับทิศทุกวง (งูเลื้อย)
    // → กวาดต่อเนื่องได้โดยไม่ต้องย้อนกลับไปต้นแถวทุกรอบ
    lats.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a);
    let flip = false;
    for (const lat of lats) {
      const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
      const n = Math.max(2, Math.round(360 / (hStep / cos) * this.DENSITY));
      const ring = [];
      for (let i = 0; i < n; i++) {
        ring.push({ lon: (360 / n) * i - 180, lat: lat, ring: lat === 0 ? 'mid' : 'edge' });
      }
      if (flip) ring.reverse();
      flip = !flip;
      for (const t of ring) out.push(t);
    }
    return out.map((t, i) => Object.assign(t, { id: i, order: i, done: false }));
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

    const ui = this._buildUI();
    this._onFallback = opts.onFallback || null;
    this._state = { ui: ui, frames: [], targets: [], q: [0, 0, 0, 1], onDone: opts.onDone, running: true };

    try {
      await this._askMotion();
      await this._openCamera(ui.video);
    } catch (e) {
      this.close();
      return this._cameraFailed(e && e.message);
    }

    // ต้องฟังเซ็นเซอร์ก่อน เพราะการวัดมุมกล้องใช้ "หมุนไปเท่าไหร่" เทียบกับ "ภาพเลื่อนไปกี่จุด"
    this._listenOrientation();
    try { await this._measureFov(); } catch (e) { /* วัดไม่ได้ก็ใช้ค่าที่จำไว้ */ }
    if (!this._state) return;               // ผู้ใช้กดปิดระหว่างวัด
    this._setupGeometry();
    this._loop();
  },

  // กล้องเปิดไม่ได้ — บอกสาเหตุที่เป็นไปได้ + ให้ทางออกที่กดได้จริง ไม่ใช่แค่บ่น
  // ⚠️ iOS 18 ขึ้นไป กล้องใช้ไม่ได้ใน PWA ที่ติดตั้งลงหน้าจอ (บั๊กของ WebKit เอง เราแก้ไม่ได้)
  //    แต่กดเปิดหน้าเดิมใน Safari ได้จากในแอป → สแกนที่นั่นแล้วข้อมูลอยู่ที่เดียวกัน
  async _cameraFailed(msg) {
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    const standalone = window.navigator.standalone === true ||
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

    if (isIOS && standalone) {
      const ok = await Modal.confirm({
        title: 'ต้องสแกนใน Safari',
        desc: 'iOS ไม่ยอมให้เปิดกล้องเมื่อเข้าจากไอคอนแอปที่ติดตั้งไว้ (เป็นข้อจำกัดของ iOS เอง) ' +
          'กดปุ่มด้านล่างเพื่อเปิดหน้านี้ใน Safari แล้วสแกนที่นั่น — ข้อมูลเป็นชุดเดียวกัน เห็นในแอปทันที',
        icon: '📷', iconClass: 'warn',
        confirmText: 'เปิดใน Safari', cancelText: 'เลือกรูปจากคลังแทน',
      });
      if (ok) {
        window.open(location.href, '_blank');
      } else if (this._onFallback) {
        this._onFallback();
      }
      return;
    }
    Modal.toast('❌ ' + (msg || 'เปิดกล้องไม่สำเร็จ'));
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
    const VID = { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } };

    // ① เปิดกล้องหลังธรรมดาก่อน — ต้องได้สิทธิ์ก่อน ชื่อเลนส์ถึงจะโผล่ใน enumerateDevices
    //    (iOS: ก่อนได้สิทธิ์ label จะเป็นค่าว่างทั้งหมด)
    let stream = await navigator.mediaDevices.getUserMedia({ video: VID, audio: false })
      .catch(() => { throw new Error('เปิดกล้องไม่สำเร็จ — เช็คว่าอนุญาตกล้องให้เว็บนี้แล้วหรือยัง'); });

    // ② สลับไปเลนส์อัลตร้าไวด์ถ้ามี (iOS 16.3+ และ Android เปิดให้เห็นเลนส์หลังทุกตัวแล้ว)
    try { stream = await this._pickWideLens(stream, VID); } catch (e) { /* ใช้ตัวเดิมต่อ */ }

    this._state.stream = stream;
    video.srcObject = stream;
    await video.play().catch(() => { /* iOS บางรุ่นเล่นเองอยู่แล้ว */ });
    // รอให้รู้ขนาดภาพจริงก่อน ค่อยคำนวณมุมกล้อง/จุดเป้า
    for (let i = 0; i < 40 && !video.videoWidth; i++) await new Promise((r) => setTimeout(r, 50));
    if (!video.videoWidth) throw new Error('กล้องเปิดแล้วแต่ไม่มีภาพ — ลองปิดแอปอื่นที่ใช้กล้องอยู่');
  },

  // ── หาเลนส์ที่ "กว้างที่สุด" ของกล้องหลัง ────────────────────
  // 3 ทาง เรียงตามความน่าเชื่อถือ:
  //   1. เคยเลือกไว้แล้ว → ใช้ตัวเดิม (จำต่อเครื่อง)
  //   2. ชื่อเลนส์มีคำว่า ultra/0.5 → เลนส์อัลตร้าไวด์แยกตัว (iOS 16.3+ / Android)
  //   3. กล้องรวมที่ซูมต่ำกว่า 1 ได้ → สั่งซูมต่ำสุด = สลับไปอัลตร้าไวด์เอง
  async _pickWideLens(stream, VID) {
    const devs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'videoinput');
    const cur = stream.getVideoTracks()[0];

    const saved = localStorage.getItem(this.LENS_KEY);
    const isFront = (l) => /front|หน้า|selfie/i.test(l || '');
    const isUltra = (l) => /ultra|0\.5|超広角|อัลตร้า/i.test(l || '') && !isFront(l);

    let pick = null;
    if (saved) pick = devs.find((d) => d.deviceId === saved) || null;
    if (!pick) pick = devs.find((d) => isUltra(d.label)) || null;

    if (pick && pick.deviceId !== (cur.getSettings ? cur.getSettings().deviceId : '')) {
      const alt = await navigator.mediaDevices.getUserMedia({
        video: Object.assign({}, VID, { deviceId: { exact: pick.deviceId } }), audio: false,
      }).catch(() => null);
      if (alt) {
        stream.getTracks().forEach((t) => t.stop());
        this._state.lensLabel = pick.label || 'เลนส์กว้าง';
        localStorage.setItem(this.LENS_KEY, pick.deviceId);
        return alt;
      }
    }

    // ไม่มีเลนส์แยก → ลองสั่งซูมต่ำสุดกับกล้องรวม
    try {
      const caps = cur.getCapabilities ? cur.getCapabilities() : {};
      if (caps.zoom && caps.zoom.min < 1) {
        await cur.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] });
        this._state.lensLabel = 'ซูม ' + caps.zoom.min + 'x';
      }
    } catch (e) { /* ซูมไม่ได้ก็ใช้ตามเดิม */ }
    return stream;
  },

  // ── วัดมุมกล้องจริงอัตโนมัติ (auto FOV) ────────────────────
  // ทำไมต้องวัด: พอสลับไปเลนส์อัลตร้าไวด์ มุมกล้องเปลี่ยนจาก ~63° เป็น ~106°
  //   และแต่ละรุ่นไม่เท่ากันเลย ถ้าเดาผิดจุดเป้าจะวางผิด → ภาพเป็นรูหรือซ้อนกันมั่ว
  // วัดยังไง: หมุนเครื่องไปนิดนึง เซ็นเซอร์บอก "หมุนไปกี่องศา"
  //   เทียบกับภาพที่เลื่อนไป "กี่จุด" → ได้ระยะโฟกัสเป็นจุดต่อเรเดียน → แปลงเป็นมุมกล้อง
  //   ใช้เฉพาะแถบกลางเฟรม 50% เพราะขอบเลนส์ไวด์บิด ความสัมพันธ์ไม่เป็นเส้นตรง
  async _measureFov() {
    const st = this._state;
    const v = st.ui.video;
    const PW = 256;                                   // ความกว้างของ "ลายเส้น" ที่ใช้เทียบ
    const srcW = v.videoWidth * 0.5;                  // ใช้แค่ครึ่งกลางของภาพ
    const pxPerProf = srcW / PW;
    const D2R = Math.PI / 180;

    const tip = document.createElement('div');
    tip.setAttribute('style',
      'position:absolute;left:0;right:0;bottom:18%;z-index:40;text-align:center;color:#fff;' +
      'font-size:15px;line-height:1.7;text-shadow:0 1px 4px #000;padding:0 24px;pointer-events:none');
    tip.innerHTML = '📐 <b>กำลังวัดมุมกล้อง</b><br>ค่อยๆ หมุนตัวไปทางขวาช้าๆ<br>' +
      '<span style="font-size:12px;opacity:.8">ทำครั้งเดียวต่อเครื่อง แล้วระบบจะจำไว้</span>';
    st.ui.root.appendChild(tip);

    const samples = [];
    const t0 = Date.now();
    let ref = null;
    while (this._state && Date.now() - t0 < 14000 && samples.length < 5) {
      await new Promise((r) => setTimeout(r, 90));
      if (!st.hasOri || !v.videoWidth) continue;
      const prof = this._profile(v, PW);
      const dir = this._axes(st.q).fwd;
      if (!ref) { ref = { prof: prof, dir: dir }; continue; }

      const dot = Math.max(-1, Math.min(1, this._dot(ref.dir, dir)));
      const ang = Math.acos(dot);                     // หมุนไปกี่เรเดียน
      const vert = Math.abs(ref.dir[1] - dir[1]);     // ก้ม-เงยไปเท่าไหร่
      if (ang < 6 * D2R) continue;                    // ยังหมุนไม่พอ รอต่อ
      if (ang > 22 * D2R || vert > 0.12) { ref = { prof: prof, dir: dir }; continue; }  // เร็วไป/ก้มเงย → ตั้งต้นใหม่

      const m = this._bestShift(ref.prof, prof, 110);
      // margin < 0.75 = จุดที่แมตช์ดีที่สุดชนะที่สองชัดเจน (ไม่ใช่ฉากเรียบๆ ที่จับอะไรไม่ได้)
      if (Math.abs(m.shift) >= 6 && m.margin < 0.75) {
        const f = (Math.abs(m.shift) * pxPerProf) / ang;          // จุดต่อเรเดียน
        const hFov = 2 * Math.atan((v.videoWidth / 2) / f) / D2R;
        if (hFov > 40 && hFov < 145) samples.push(hFov);
      }
      ref = { prof: prof, dir: dir };
    }
    tip.remove();
    if (!this._state || samples.length < 2) return;   // วัดไม่ได้ → ใช้ค่าที่จำไว้เดิม

    samples.sort((a, b) => a - b);
    const hFov = samples[Math.floor(samples.length / 2)];          // ค่ากลาง กัน outlier
    const W = v.videoWidth, H = v.videoHeight;
    // แปลงมุมด้านกว้าง → มุม "ด้านยาว" ซึ่งเป็นหน่วยที่ fovLong() เก็บ
    const longDeg = W >= H ? hFov
      : 2 * Math.atan(Math.tan(hFov / 2 * D2R) * H / W) / D2R;
    const clamped = Math.max(this.FOV_MIN, Math.min(this.FOV_MAX, Math.round(longDeg)));
    localStorage.setItem(this._fovKey(), String(clamped));
    st.fovMeasured = clamped;
  },

  // ลายเส้นแนวนอนของภาพ (1 มิติ) — ใช้หาว่าภาพเลื่อนไปกี่จุด
  // ทำเป็น "ความต่างระหว่างจุดข้างกัน" (ขอบ) → ทนต่อแสงเปลี่ยนระหว่างสองเฟรม
  _profile(video, PW) {
    const c = this._mfC || (this._mfC = document.createElement('canvas'));
    const PH = 64;
    c.width = PW; c.height = PH;
    const cc = c.getContext('2d', { willReadFrequently: true });
    const vw = video.videoWidth, vh = video.videoHeight;
    cc.drawImage(video, vw * 0.25, vh * 0.30, vw * 0.5, vh * 0.4, 0, 0, PW, PH);
    const d = cc.getImageData(0, 0, PW, PH).data;
    const col = new Float32Array(PW);
    for (let x = 0; x < PW; x++) {
      let sum = 0;
      for (let y = 0; y < PH; y++) {
        const i = (y * PW + x) * 4;
        sum += d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
      }
      col[x] = sum / PH;
    }
    const g = new Float32Array(PW);
    for (let x = 1; x < PW; x++) g[x] = col[x] - col[x - 1];
    return g;
  },

  // หาว่า b คือ a ที่เลื่อนไปกี่จุด (หาค่าต่างรวมน้อยสุด)
  // margin = คะแนนที่ดีที่สุด ÷ ที่ดีรองลงมา — ใกล้ 1 แปลว่าจับไม่ได้จริง ให้ทิ้งตัวอย่างนั้น
  _bestShift(a, b, maxShift) {
    const N = a.length;
    let best = 0, s1 = Infinity, s2 = Infinity;
    for (let s = -maxShift; s <= maxShift; s++) {
      const from = Math.max(0, -s), to = Math.min(N, N - s);
      if (to - from < N * 0.5) continue;
      let sum = 0;
      for (let x = from; x < to; x++) sum += Math.abs(a[x] - b[x + s]);
      const sc = sum / (to - from);
      if (sc < s1) { s2 = s1; s1 = sc; best = s; }
      else if (sc < s2) s2 = sc;
    }
    return { shift: best, score: s1, margin: s2 > 0 ? s1 / s2 : 1 };
  },

  _setupGeometry() {
    const st = this._state;
    const v = st.ui.video;
    const W = v.videoWidth, H = v.videoHeight;
    const rawDeg = this.fovLong();

    // เลนส์ไวด์: ใช้แค่กลางเฟรม — ขอบสุดของเลนส์อัลตร้าไวด์บิดจนแบบจำลอง "รูเข็ม"
    // ที่ตัวต่อภาพใช้อยู่เอาไม่อยู่ (เส้นตรงกลายเป็นโค้ง ตะเข็บจะเบี้ยว)
    // ตัด 12% รอบนอกทิ้ง = เสียมุมไปนิดเดียว แต่ได้ตะเข็บที่ตรง
    st.crop = rawDeg > this.WIDE_DEG ? this.CROP_WIDE : 1;
    const long = 2 * Math.atan(Math.tan(rawDeg * Math.PI / 360) * st.crop);

    // กรอบที่ตัดจริงบนภาพต้นทาง (ใช้ตอนเก็บภาพแต่ละใบ)
    const cw = W * st.crop, ch = H * st.crop;
    st.cropRect = { sx: (W - cw) / 2, sy: (H - ch) / 2, sw: cw, sh: ch };

    // มุมกล้องด้านยาว = ค่าที่วัดได้ · ด้านสั้นคำนวณจากสัดส่วนภาพ
    if (W >= H) {
      st.hFov = long;
      st.vFov = 2 * Math.atan(Math.tan(long / 2) * H / W);
    } else {
      st.vFov = long;
      st.hFov = 2 * Math.atan(Math.tan(long / 2) * W / H);
    }
    st.frameW = cw; st.frameH = ch;
    // มุมกล้อง "หลังตัดขอบ" หน่วยองศา — ตัวต่อภาพต้องใช้ค่านี้ ไม่ใช่ค่าดิบจาก fovLong()
    // (ภาพที่เก็บไว้ถูกตัดขอบไปแล้ว ถ้าเอาค่าดิบไปคำนวณจะเหลื่อมทั้งชุด)
    st.fovLongEff = long * 180 / Math.PI;

    // กรอบภาพกลางจอ — เว้นที่รอบๆ ให้จุดเป้าที่ยังไม่ถึงลอยอยู่นอกกรอบได้
    const rw = st.ui.root.clientWidth, rh = st.ui.root.clientHeight;
    const bw = Math.min(rw * 0.6, rh * 0.42 * W / H);
    const bh = bw * H / W;
    v.style.width = Math.round(bw) + 'px';
    v.style.height = Math.round(bh) + 'px';
    st.box = { x: rw / 2, y: rh / 2, w: bw, h: bh };
    st.targets = this._targets(st.hFov * 180 / Math.PI, st.vFov * 180 / Math.PI);

    // ── ความละเอียดต่อใบ: คำนวณจากมุมกล้องจริง ไม่ใช่ล็อกตายตัว ──
    // เดิมล็อก 1000px ซึ่งพอดีกับเลนส์หลัก 63° (15.9 จุด/องศา)
    // ถ้าใช้ค่าเดิมกับเลนส์ไวด์ 92° จะเหลือ 10.9 จุด/องศา = เบลอกว่าผลลัพธ์ 4096px เสียอีก
    const longDeg = Math.max(st.hFov, st.vFov) * 180 / Math.PI;
    let fm = Math.round(longDeg * this.TARGET_PXPD);
    const shortRatio = Math.min(cw, ch) / Math.max(cw, ch);
    const cap = this.MEM_BUDGET_MB * 1048576;
    const bytesAt = (n) => n * n * shortRatio * 3 * st.targets.length;
    fm = Math.max(800, Math.min(2000, fm));
    if (bytesAt(fm) > cap) fm = Math.max(700, Math.floor(fm * Math.sqrt(cap / bytesAt(fm))));
    st.frameMax = fm;
    st.memMB = Math.round(bytesAt(fm) / 1048576);

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

      // จุดถัดไปตามเส้นทางกวาด (ไม่ใช่จุดที่ใกล้ที่สุด) — คนจะได้กวาดต่อเนื่องไม่ต้องกระโดดไปมา
      const guide = st.targets.find((t) => !t.done) || null;

      // ── วาดเส้นทางกวาด ──
      const proj2 = (t) => {
        const d = this._dirOf(t.lon, t.lat);
        const f = this._dot(d, ax.fwd);
        if (f <= 0.12) return null;
        const u = (this._dot(d, ax.right) / f) / tanH;
        const v2 = (this._dot(d, ax.up) / f) / tanV;
        if (Math.abs(u) > 3.4 || Math.abs(v2) > 3.4) return null;
        return { x: cx + u * box.w / 2, y: cy - v2 * box.h / 2 };
      };
      ctx.beginPath();
      ctx.setLineDash([7, 9]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      let pen = false;
      for (let i = 0; i < st.targets.length; i++) {
        const q = proj2(st.targets[i]);
        if (!q) { pen = false; continue; }
        if (!pen) { ctx.moveTo(q.x, q.y); pen = true; } else ctx.lineTo(q.x, q.y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

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

        const isGuide = guide && t.id === guide.id;
        const r = Math.max(9, 30 / (1 + ang / 26)) * (isGuide ? 1.35 : 1);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fillStyle = t.done ? 'rgba(34,197,94,.32)' : (isGuide ? 'rgba(250,204,21,.9)' : 'rgba(74,222,128,.6)');
        ctx.fill();
        if (t.done) { ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(34,197,94,.9)'; ctx.stroke(); }
        else if (isGuide) { ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.stroke(); }
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
        ctx.fillText('กวาดช้าลงหน่อย', cx, cy + box.h / 2 + 28);
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
      if (guide) {
        const d = this._dirOf(guide.lon, guide.lat);
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
      const cr = st.cropRect || { sx: 0, sy: 0, sw: v.videoWidth, sh: v.videoHeight };
      const fmax = st.frameMax || this.FRAME_MAX;
      const scale = Math.min(1, fmax / Math.max(cr.sw, cr.sh));
      const w = Math.max(1, Math.round(cr.sw * scale));
      const h = Math.max(1, Math.round(cr.sh * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cc = c.getContext('2d');
      // เก็บเฉพาะกรอบกลาง (ตัดขอบเลนส์ที่บิดทิ้ง) — st.hFov/vFov คิดบนกรอบนี้แล้ว
      cc.drawImage(v, cr.sx, cr.sy, cr.sw, cr.sh, 0, 0, w, h);
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

    // โชว์เลนส์ที่ใช้ + มุมกล้องที่วัดได้ → ถ้าผลออกมาไม่ดีจะไล่หาสาเหตุได้ว่าเป็นเพราะอะไร
    const lens = st.lensLabel ? (' · ' + st.lensLabel) : '';
    const fov = st.fovMeasured ? (' ' + st.fovMeasured + '°') : '';
    st.ui.hud.textContent = 'เก็บแล้ว ' + done + '/' + total + ' จุด' + lens + fov;
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
        : 'กวาดตามเส้นประให้ครบทั้ง ' + total + ' จุด (วงระดับสายตา ' + midDone + '/' + mid.length + ' · แล้วค่อยเงยขึ้น–ก้มลง)';
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
    // ⚠️ จัดภาพโดยยึด "ของไกล" เป็นหลัก — ของใกล้พื้นเลื่อนตำแหน่งเยอะเวลาหมุนตัว
    //    (กล้องไม่ได้อยู่บนแกนหมุนพอดี ของห่าง 1 ม. เลื่อนได้สิบกว่าองศา ของห่าง 10 ม. เลื่อนไม่ถึง 2 องศา)
    //    ถ้าเอาพื้นมาคิดด้วย มันจะดึงทั้งใบให้เบี้ยว ผนังที่ควรตรงเป๊ะกลับเหลื่อมตาม
    const FLOOR_CUT = -0.60;        // sin(-37°) — ต่ำกว่านี้ถือว่าเป็นพื้น
    const score = (fi, ax, tanH, tanV) => {
      const s = small[fi];
      const skipFloor = ax.fwd[1] > FLOOR_CUT;      // ใบที่ไม่ได้เล็งพื้นอยู่แล้ว
      let sum = 0, n = 0, sa = 0, sb = 0;
      for (let y = 2; y < s.h - 2; y += 3) {
        const py = 1 - (y + 0.5) / s.h * 2;
        for (let x = 2; x < s.w - 2; x += 3) {
          const px = (x + 0.5) / s.w * 2 - 1;
          const vx = ax.fwd[0] + px * tanH * ax.right[0] + py * tanV * ax.up[0];
          const vy = ax.fwd[1] + px * tanH * ax.right[1] + py * tanV * ax.up[1];
          const vz = ax.fwd[2] + px * tanH * ax.right[2] + py * tanV * ax.up[2];
          const len = Math.sqrt(vx * vx + vy * vy + vz * vz);
          if (skipFloor && vy / len < FLOOR_CUT) continue;
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
    // ⚠️ ต้องใช้ "มุมหลังตัดขอบ" — ค่าดิบจาก fovLong() คือมุมของเฟรมเต็ม
    //    แต่ภาพที่เก็บไว้ถูกตัดขอบไปแล้ว (เลนส์ไวด์ตัด 12%) ถ้าใช้ค่าดิบจะเหลื่อมทั้งชุด
    const baseLong = st.fovLongEff || this.fovLong();
    let bestFov = baseLong, bestErr = Infinity;
    const probe = Math.min(6, st.frames.length);
    // ช่วงค้นหาเป็นสัดส่วนของมุมกล้อง — เดิมล็อกเพดานไว้ 90° ซึ่งเลนส์ไวด์ทะลุเพดาน
    // ทำให้ข้ามทุกตัวเลือกและไม่ได้จูนมุมเลย
    const span = Math.max(4, Math.round(baseLong * 0.12));
    for (const cand of [baseLong - span, baseLong - span / 2, baseLong, baseLong + span / 2, baseLong + span]) {
      if (cand < 30 || cand > 130) continue;
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
    // เดิมทำ 2 รอบ + ค้นละเอียด = 40 วินาที · ตอนนี้เหลือรอบเดียวแบบหยาบ
    // (ความละเอียดไปทำที่ขั้น "จูนรอยต่อ" แทน ซึ่งตรงประเด็นกว่าเพราะดูเฉพาะเส้นที่จะตัดจริง)
    const N = st.frames.length;
    for (let pass = 0; pass < 1; pass++) {
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
        // รอบแรกกวาดกว้าง (ครอบคลุมความคลาดตอนเล็ง ±3.5°) รอบสองเก็บละเอียด
        for (const [step, span] of [[2, 2], [0.7, 1]]) {
          const c = { dy: best.dy, dp: best.dp, dr: best.dr };
          for (let dy = -span; dy <= span; dy++) {
            for (let dp = -span; dp <= span; dp++) {
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

  // ── ขนาดผืนผลลัพธ์: เลือกเองจากหน่วยความจำที่เหลือ ──────────
  // ผืนผลลัพธ์ + ตารางช่วยคำนวณกินราว 7 ไบต์ต่อพิกเซล (out RGBA 4 + label/edge/filled อีก 3)
  // ภาพดิบใช้ไปเท่าไหร่ ที่เหลือยกให้ผืนผลลัพธ์ → เลนส์ไวด์ที่ใช้ภาพดิบน้อยจะได้ผลลัพธ์คมขึ้นเอง
  _outSize() {
    const st = this._state;
    const usedMB = (st && st.memMB) || 98;
    const freeMB = Math.max(50, this.TOTAL_MB - usedMB);
    let w = Math.floor(Math.sqrt(freeMB * 1048576 * 2 / 7));
    w = Math.round(w / 256) * 256;                        // ให้ลงตัวกับบล็อกที่ใช้คำนวณ
    w = Math.max(this.OUT_W, Math.min(this.OUT_MAX_W, w));
    return { w: w, h: w / 2 };
  },

  async _stitch() {
    const st = this._state;
    await this._align();

    const sz = this._outSize();
    const W = sz.w, H = sz.h;
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

    // ════════════════════════════════════════════════════════
    // ต่อภาพแบบ "เลือกตะเข็บ" แทนการเฉลี่ยสี
    // ════════════════════════════════════════════════════════
    // ค้นงานวิจัยแล้วพบว่าวงการไม่ได้ "แก้" พารัลแลกซ์ แต่ "ซ่อน" มัน 2 ชั้น
    // (OpenCV GraphCutSeamFinder + MultiBandBlender · Zhang & Liu 2014 Parallax-tolerant Stitching)
    //
    //   ชั้นที่ 1 — ทุกจุดบนภาพเอามาจาก "ใบเดียว" ไม่เฉลี่ยกัน → ไม่มีเงาซ้อนเด็ดขาด
    //              แล้วเลือก "แนวตะเข็บ" ให้วิ่งผ่านที่ที่สองใบเห็นตรงกันที่สุด
    //              (เช่น ผนังเรียบ พื้นเรียบ) ไม่ตัดกลางแผ่นไม้หรือกลางของที่มีลาย
    //   ชั้นที่ 2 — แก้สีเฉพาะ "ความถี่ต่ำ" ข้ามตะเข็บ (แสงเข้ม/อ่อนต่างกัน)
    //              โดยไม่แตะรายละเอียด → รอยต่อหายไปแต่ภาพยังคม
    //
    // ของเดิมเฉลี่ยสีทุกใบที่ทับกัน = สาเหตุที่แผ่นไม้ขาดเป็นท่อนและภาพเบลอตรงรอยต่อ

    const LW = 1024, LH = 512, MAXC = 4;      // ตารางย่อสำหรับคิดแนวตะเข็บ
    const NC = LW * LH;
    const candL = new Uint8Array(NC * MAXC);  // ใบไหนคลุมจุดนี้บ้าง (เก็บ index+1, 0 = ไม่มี)
    const candG = new Uint8Array(NC * MAXC);  // ค่าความสว่างที่ใบนั้นเห็น (ใช้เทียบว่าตรงกันไหม)
    const candQ = new Float32Array(NC * MAXC); // เห็นชัดแค่ไหน (ใกล้กลางภาพ = ดี)

    const sinL = new Float64Array(LW), cosL = new Float64Array(LW);
    for (let x = 0; x < LW; x++) {
      const lo = ((x + 0.5) / LW - 0.5) * 2 * Math.PI;
      sinL[x] = Math.sin(lo); cosL[x] = Math.cos(lo);
    }

    // ── เก็บว่าแต่ละจุดมีใบไหนคลุมบ้าง + เห็นชัดแค่ไหน ──
    const buildCands = async () => {
    candL.fill(0); candG.fill(0); candQ.fill(0);
    for (let fi = 0; fi < F.length; fi++) {
      const f = F[fi], ax = f.ax, src = f.src, fw = f.w, fh = f.h;
      const y0 = Math.max(0, Math.floor((0.5 - (f.cLat + capR) / Math.PI) * LH));
      const y1 = Math.min(LH - 1, Math.ceil((0.5 - (f.cLat - capR) / Math.PI) * LH));
      for (let y = y0; y <= y1; y++) {
        const la = (0.5 - (y + 0.5) / LH) * Math.PI;
        const cosLa = Math.cos(la), sinLa = Math.sin(la);
        for (let x = 0; x < LW; x++) {
          const dx = cosLa * sinL[x], dy = sinLa, dz = -cosLa * cosL[x];
          const fd = dx * ax.fwd[0] + dy * ax.fwd[1] + dz * ax.fwd[2];
          if (fd <= 0.08) continue;
          const px = (dx * ax.right[0] + dy * ax.right[1] + dz * ax.right[2]) / fd / tanH;
          if (px < -1 || px > 1) continue;
          const py = (dx * ax.up[0] + dy * ax.up[1] + dz * ax.up[2]) / fd / tanV;
          if (py < -1 || py > 1) continue;
          const q = (1 - Math.abs(px)) * (1 - Math.abs(py)) * fd;
          const sx = ((px + 1) * 0.5 * (fw - 1)) | 0, sy = ((1 - py) * 0.5 * (fh - 1)) | 0;
          const si = (sy * fw + sx) * 3;
          const g = (src[si] * 0.299 + src[si + 1] * 0.587 + src[si + 2] * 0.114) * f.gain;

          const base = (y * LW + x) * MAXC;
          for (let k = 0; k < MAXC; k++) {                 // แทรกแบบเรียงจากเห็นชัดสุด
            if (candL[base + k] === 0 || q > candQ[base + k]) {
              for (let j = MAXC - 1; j > k; j--) {
                candL[base + j] = candL[base + j - 1]; candG[base + j] = candG[base + j - 1]; candQ[base + j] = candQ[base + j - 1];
              }
              candL[base + k] = fi + 1; candG[base + k] = g > 255 ? 255 : g; candQ[base + k] = q;
              break;
            }
          }
        }
      }
      if (fi % 6 === 5) { st.ui.hud.textContent = 'วางแนวตะเข็บ ' + (fi + 1) + '/' + F.length + '…'; await new Promise((r) => setTimeout(r, 0)); }
    }
    };
    await buildCands();

    // ── ปรับความสว่างทุกใบให้เข้าชุดกัน (แก้พร้อมกันทั้งหมด ไม่ใช่ไล่ทีละใบ) ──
    // เจ้าของงานเจอ 2026-08-20: เพดานสีขาวเดียวกันแต่ความสว่างวิ่ง 89-155 กระโดดทีละ 46 ระดับ
    //   สาเหตุ: กล้องมือถือปรับแสงเองทุกใบ (หันไปทางหน้าต่างก็หรี่ลง หันเข้ามุมมืดก็เปิดขึ้น)
    //   ของเดิมแก้แบบ "ไล่ทีละใบเทียบกับใบก่อนหน้า" → ความคลาดสะสมไปเรื่อยๆ ยิ่งหลายใบยิ่งเพี้ยน
    //   ใหม่: ตั้งเป็นระบบสมการแล้วแก้พร้อมกันทุกใบ (วิธีเดียวกับ GainCompensator ของ OpenCV)
    //         หาค่าคูณของแต่ละใบที่ทำให้ "ตรงที่ภาพทับกัน สว่างเท่ากันที่สุด" ทั้งวง
    {
      const NF = F.length;
      const sumIJ = new Float64Array(NF * NF);   // ความสว่างเฉลี่ยของใบ i ตรงที่ทับกับใบ j
      const cntIJ = new Float64Array(NF * NF);
      for (let i = 0; i < NC; i++) {
        const b = i * MAXC;
        if (!candL[b] || !candL[b + 1]) continue;
        for (let k = 0; k < MAXC && candL[b + k]; k++) {
          for (let m = k + 1; m < MAXC && candL[b + m]; m++) {
            const a = candL[b + k] - 1, c = candL[b + m] - 1;
            sumIJ[a * NF + c] += candG[b + k]; cntIJ[a * NF + c]++;
            sumIJ[c * NF + a] += candG[b + m]; cntIJ[c * NF + a]++;
          }
        }
      }

      const g = new Float64Array(NF).fill(1);
      const SN = 10 * 10, SG = 0.35 * 0.35;      // ยอมให้ค่าคูณเบี่ยงจาก 1 ได้แค่ไหน (±35% = ช่วงที่กล้องมือถือแกว่งจริง)
      for (let it = 0; it < 60; it++) {          // แก้สมการแบบวนซ้ำ (Gauss-Seidel)
        for (let i = 0; i < NF; i++) {
          let num = 0, den = 0;
          for (let j = 0; j < NF; j++) {
            if (i === j) continue;
            const n = cntIJ[i * NF + j];
            if (n < 40) continue;                // ทับกันน้อยเกินไป ไม่น่าเชื่อถือ
            const Iij = sumIJ[i * NF + j] / n;
            const Iji = sumIJ[j * NF + i] / n;
            if (Iij < 6 || Iji < 6) continue;    // มืดเกินไป อัตราส่วนจะเพี้ยน
            num += n * (Iij * Iji * g[j] / SN + 1 / SG);
            den += n * (Iij * Iij / SN + 1 / SG);
          }
          if (den > 0) g[i] = Math.max(0.7, Math.min(1.45, num / den));
        }
      }

      // ดึงค่าเฉลี่ยกลับมาที่ 1 ไม่ให้ภาพรวมสว่างขึ้น/มืดลงทั้งใบ
      let mean = 0;
      for (let i = 0; i < NF; i++) mean += g[i];
      mean /= NF || 1;
      for (let i = 0; i < NF; i++) {
        F[i].gain = Math.max(0.6, Math.min(1.6, F[i].gain * (g[i] / (mean || 1))));
        st.frames[i].gain = F[i].gain;
      }
      st.ui.hud.textContent = 'ปรับความสว่างให้เข้าชุด…';
      await new Promise((r) => setTimeout(r, 0));
      await buildCands();                        // ความสว่างเปลี่ยนแล้ว ต้องคิดตะเข็บใหม่
    }

    // ── เลือกตะเข็บ: วนปรับทีละจุดให้พลังงานรวมต่ำสุด ──
    // พลังงาน = (เห็นไม่ชัดเท่าไหร่) + (ถ้าติดกับเพื่อนบ้านคนละใบ ให้บวกค่าความต่างของสีตรงนั้น)
    // ผลคือเส้นตะเข็บจะไหลไปอยู่ตรงที่สองใบเห็นเหมือนกัน = มองไม่ออกว่าต่อตรงไหน
    const label = new Uint8Array(NC);

    const grayOf = (i, lab) => {
      const b = i * MAXC;
      for (let k = 0; k < MAXC; k++) if (candL[b + k] === lab) return candG[b + k];
      return -1;                                                    // ใบนี้ไม่คลุมจุดนั้น
    };
    const W_SMOOTH = 2.2;

    const pickSeams = async (rounds) => {
    for (let i = 0; i < NC; i++) label[i] = candL[i * MAXC];       // เริ่มจากใบที่เห็นชัดสุด
    for (let iter = 0; iter < rounds; iter++) {
      let changed = 0;
      for (let y = 0; y < LH; y++) {
        for (let x = 0; x < LW; x++) {
          const i = y * LW + x;
          const b = i * MAXC;
          if (candL[b] === 0 || candL[b + 1] === 0) continue;        // มีใบเดียว ไม่ต้องเลือก
          const nb = [
            y > 0 ? i - LW : -1, y < LH - 1 ? i + LW : -1,
            y * LW + (x === 0 ? LW - 1 : x - 1), y * LW + (x === LW - 1 ? 0 : x + 1),
          ];
          let bestLab = label[i], bestE = Infinity;
          for (let k = 0; k < MAXC && candL[b + k]; k++) {
            const lab = candL[b + k];
            let E = (1 - candQ[b + k] / (candQ[b] + 1e-6)) * 1.0;
            for (const j of nb) {
              if (j < 0) continue;
              const ln = label[j];
              if (!ln || ln === lab) continue;
              const a1 = grayOf(i, lab), a2 = grayOf(i, ln);
              const c1 = grayOf(j, lab), c2 = grayOf(j, ln);
              if (a1 < 0 || a2 < 0 || c1 < 0 || c2 < 0) { E += W_SMOOTH * 0.9; continue; }
              E += W_SMOOTH * ((Math.abs(a1 - a2) + Math.abs(c1 - c2)) / 510);
            }
            if (E < bestE) { bestE = E; bestLab = lab; }
          }
          if (bestLab !== label[i]) { label[i] = bestLab; changed++; }
        }
      }
      st.ui.hud.textContent = 'ปรับแนวตะเข็บ รอบ ' + (iter + 1) + '/' + rounds + '…';
      await new Promise((r) => setTimeout(r, 0));
      if (!changed) break;
    }
    };
    await pickSeams(6);

    // ════════════════════════════════════════════════════════
    // จัดตำแหน่งซ้ำ โดยดูเฉพาะ "แนวตะเข็บ" (seam-guided alignment)
    // ════════════════════════════════════════════════════════
    // แนวคิดจากงานวิจัย SEAGULL: พอมีพารัลแลกซ์ เราจัดให้ทั้งภาพตรงกันไม่ได้อยู่แล้ว
    //   แต่ "ไม่จำเป็นต้องตรงทั้งภาพ" — ตรงแค่ตรงเส้นที่เราจะตัดก็พอ
    //   เพราะนอกเส้นตัดเราไม่ได้ใช้ภาพนั้นแล้ว
    // จึงขยับแต่ละใบอีกนิด โดยวัดความต่างเฉพาะจุดที่อยู่บนเส้นตะเข็บของมัน
    // แล้ววางตะเข็บใหม่อีกรอบ → รอยต่อกลืนขึ้นชัดเจน โดยไม่ต้องพึ่งเซิร์ฟเวอร์
    {
      const seamPts = [];                       // [{i, me, other}] จุดที่อยู่บนรอยต่อ
      for (let y = 1; y < LH - 1; y++) {
        for (let x = 0; x < LW; x++) {
          const i = y * LW + x;
          const me = label[i];
          if (!me) continue;
          const xr = x === LW - 1 ? 0 : x + 1;
          for (const j of [i + LW, y * LW + xr]) {
            const on = label[j];
            if (on && on !== me) { seamPts.push([i, me, on]); break; }
          }
        }
      }

      if (seamPts.length > 30) {
        // เตรียมทิศทางของจุดตะเข็บไว้ล่วงหน้า (ไม่ต้องคิดตรีโกณซ้ำในลูปค้นหา)
        const n = seamPts.length;
        const dirs = new Float64Array(n * 3), tgt = new Float32Array(n);
        const owner = new Int32Array(n);
        for (let k = 0; k < n; k++) {
          const [i, me, other] = seamPts[k];
          const y = (i / LW) | 0, x = i % LW;
          const la = (0.5 - (y + 0.5) / LH) * Math.PI;
          const cosLa = Math.cos(la);
          dirs[k * 3] = cosLa * sinL[x]; dirs[k * 3 + 1] = Math.sin(la); dirs[k * 3 + 2] = -cosLa * cosL[x];
          tgt[k] = grayOf(i, other);
          owner[k] = me - 1;
        }

        for (let fi = 0; fi < F.length; fi++) {
          const idx = [];
          for (let k = 0; k < n; k++) if (owner[k] === fi && tgt[k] >= 0) idx.push(k);
          if (idx.length < 25) continue;                 // ตะเข็บสั้นเกินไป ไม่ต้องขยับ

          const fr = st.frames[fi], base = fr.adj || { dy: 0, dp: 0, dr: 0 };
          const f = F[fi], src = f.src, fw = f.w, fh = f.h, gain = f.gain;
          let best = { dy: base.dy, dp: base.dp }, bestErr = Infinity;
          for (const [step, span] of [[0.5, 2], [0.15, 2]]) {
          const c0 = { dy: best.dy, dp: best.dp };
          for (let a = -span; a <= span; a++) {
            for (let b = -span; b <= span; b++) {
              const dy = c0.dy + a * step, dp = c0.dp + b * step;
              const ax = this._axesAdj(fr.q, dy, dp, base.dr);
              let sum = 0, cnt = 0;
              for (const k of idx) {
                const vx = dirs[k * 3], vy = dirs[k * 3 + 1], vz = dirs[k * 3 + 2];
                const fd = vx * ax.fwd[0] + vy * ax.fwd[1] + vz * ax.fwd[2];
                if (fd <= 0.1) continue;
                const px = (vx * ax.right[0] + vy * ax.right[1] + vz * ax.right[2]) / fd / tanH;
                if (px < -1 || px > 1) continue;
                const py = (vx * ax.up[0] + vy * ax.up[1] + vz * ax.up[2]) / fd / tanV;
                if (py < -1 || py > 1) continue;
                const sx = ((px + 1) * 0.5 * (fw - 1)) | 0, sy = ((1 - py) * 0.5 * (fh - 1)) | 0;
                const si = (sy * fw + sx) * 3;
                const g = (src[si] * 0.299 + src[si + 1] * 0.587 + src[si + 2] * 0.114) * gain;
                sum += Math.abs(g - tgt[k]); cnt++;
              }
              if (cnt < idx.length * 0.6) continue;       // ขยับจนหลุดตะเข็บ ไม่นับ
              const err = sum / cnt;
              if (err < bestErr) { bestErr = err; best = { dy: dy, dp: dp }; }
            }
          }
          }
          if (best && (best.dy !== base.dy || best.dp !== base.dp)) {
            fr.adj = { dy: best.dy, dp: best.dp, dr: base.dr };
            const ax = this._axesAdj(fr.q, best.dy, best.dp, base.dr);
            f.ax = ax;
            f.cLat = Math.asin(Math.max(-1, Math.min(1, ax.fwd[1])));
            f.cLon = Math.atan2(ax.fwd[0], -ax.fwd[2]);
            f.sinC = Math.sin(f.cLat); f.cosC = Math.cos(f.cLat);
            f.y0 = Math.max(0, Math.floor((0.5 - (f.cLat + capR) / Math.PI) * H));
            f.y1 = Math.min(H - 1, Math.ceil((0.5 - (f.cLat - capR) / Math.PI) * H));
          }
          if (fi % 8 === 7) {
            st.ui.hud.textContent = 'จูนรอยต่อ ' + (fi + 1) + '/' + F.length + '…';
            await new Promise((r) => setTimeout(r, 0));
          }
        }

        await buildCands();          // ตำแหน่งเปลี่ยนแล้ว ต้องคิดใหม่
        await pickSeams(3);
      }
    }

    // ── วาดจริง: ทุกจุดเอาสีจาก "ใบเดียว" ตามที่ตะเข็บเลือกไว้ ──
    const fullLab = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const ly = ((y * LH / H) | 0) * LW;
      const la = (0.5 - (y + 0.5) / H) * Math.PI;
      const cosLa = Math.cos(la), sinLa = Math.sin(la);
      for (let x = 0; x < W; x++) {
        let lab = label[ly + ((x * LW / W) | 0)];
        const dx = cosLa * sinLon[x], dy = sinLa, dz = -cosLa * cosLon[x];

        // ใบที่ตะเข็บเลือกอาจคลุมไม่ถึงจุดนี้พอดี (ขอบภาพ) → หาใบที่เห็นชัดสุดแทน
        let f = lab ? F[lab - 1] : null;
        let ok = false, px = 0, py = 0, fd = 0;
        if (f) {
          fd = dx * f.ax.fwd[0] + dy * f.ax.fwd[1] + dz * f.ax.fwd[2];
          if (fd > 0.08) {
            px = (dx * f.ax.right[0] + dy * f.ax.right[1] + dz * f.ax.right[2]) / fd / tanH;
            py = (dx * f.ax.up[0] + dy * f.ax.up[1] + dz * f.ax.up[2]) / fd / tanV;
            ok = px >= -1 && px <= 1 && py >= -1 && py <= 1;
          }
        }
        if (!ok) {
          let bq = 0;
          for (let k = 0; k < F.length; k++) {
            const g = F[k];
            const d2 = dx * g.ax.fwd[0] + dy * g.ax.fwd[1] + dz * g.ax.fwd[2];
            if (d2 <= 0.08) continue;
            const a = (dx * g.ax.right[0] + dy * g.ax.right[1] + dz * g.ax.right[2]) / d2 / tanH;
            if (a < -1 || a > 1) continue;
            const c = (dx * g.ax.up[0] + dy * g.ax.up[1] + dz * g.ax.up[2]) / d2 / tanV;
            if (c < -1 || c > 1) continue;
            const q = (1 - Math.abs(a)) * (1 - Math.abs(c)) * d2;
            if (q > bq) { bq = q; lab = k + 1; f = g; px = a; py = c; fd = d2; ok = true; }
          }
        }
        const oi = y * W + x, di = oi * 4;
        if (!ok) { fullLab[oi] = 0; continue; }
        fullLab[oi] = lab;

        const fw = f.w, fh = f.h, src = f.src, gain = f.gain;
        const fx = (px + 1) * 0.5 * (fw - 1), fy = (1 - py) * 0.5 * (fh - 1);
        const x0 = fx | 0, y0b = fy | 0;
        const x1 = x0 + 1 < fw ? x0 + 1 : fw - 1, y1b = y0b + 1 < fh ? y0b + 1 : fh - 1;
        const tx = fx - x0, ty = fy - y0b;
        const i00 = (y0b * fw + x0) * 3, i10 = (y0b * fw + x1) * 3;
        const i01 = (y1b * fw + x0) * 3, i11 = (y1b * fw + x1) * 3;
        const w00 = (1 - tx) * (1 - ty), w10 = tx * (1 - ty), w01 = (1 - tx) * ty, w11 = tx * ty;
        out[di] = (src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11) * gain;
        out[di + 1] = (src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11) * gain;
        out[di + 2] = (src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11) * gain;
        out[di + 3] = 255;
      }
      if ((y & 255) === 255) {
        st.ui.hud.textContent = 'วาดภาพ ' + Math.round(y / H * 100) + '%';
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    // ── เกลี่ยขอบตะเข็บให้ไม่เป็นขั้นบันได ──
    // แนวตะเข็บคิดบนตารางย่อ (1024x512) แล้วขยายมาใช้กับภาพจริง (4096x2048)
    // ขอบเลยเป็นขั้นละ 4 จุด → เกลี่ยเฉพาะแถวที่อยู่ติดรอยต่อ ไม่แตะส่วนอื่นของภาพ
    {
      const edge = new Uint8Array(W * H);
      for (let y = 1; y < H - 1; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          const l = fullLab[i];
          if (!l) continue;
          const xl = x === 0 ? W - 1 : x - 1, xr = x === W - 1 ? 0 : x + 1;
          if (fullLab[i - W] !== l || fullLab[i + W] !== l ||
              fullLab[y * W + xl] !== l || fullLab[y * W + xr] !== l) edge[i] = 1;
        }
      }
      // ⚠️ เดิมสำเนาทั้งผืนไว้อ่าน (34 MB) — เปลี่ยนเป็นเก็บแค่ 3 แถวที่กำลังใช้
      //    เพราะหน่วยความจำรวมตอนต่อภาพเป็นตัวจำกัดจริง ไม่ใช่ความเร็ว
      const rowBytes = W * 4;
      const ring = [new Uint8ClampedArray(rowBytes), new Uint8ClampedArray(rowBytes), new Uint8ClampedArray(rowBytes)];
      const loadRow = (y, slot) => { ring[slot].set(out.subarray(y * rowBytes, (y + 1) * rowBytes)); };
      loadRow(0, 0); loadRow(1, 1);
      for (let y = 1; y < H - 1; y++) {
        loadRow(y + 1, (y + 1) % 3);
        for (let x = 0; x < W; x++) {
          const i = y * W + x;
          if (!edge[i]) continue;
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const row = ring[(y + dy) % 3];
            for (let dx = -1; dx <= 1; dx++) {
              let xx = x + dx; if (xx < 0) xx += W; else if (xx >= W) xx -= W;
              const j = xx * 4;
              if (!row[j + 3]) continue;
              r += row[j]; g += row[j + 1]; b += row[j + 2]; n++;
            }
          }
          if (!n) continue;
          const di = i * 4;
          out[di] = r / n; out[di + 1] = g / n; out[di + 2] = b / n;
        }
      }
      st.ui.hud.textContent = 'เกลี่ยขอบตะเข็บ…';
      await new Promise((r) => setTimeout(r, 0));
    }

    // ── ลบรอยขั้นสีข้ามตะเข็บ (แก้เฉพาะความถี่ต่ำ ไม่แตะรายละเอียด) ──
    // เทียบ "สีเฉลี่ยแบบนุ่มๆ ของทุกใบ" กับ "สีที่วาดจริง" แล้วค่อยๆ ปรับให้เท่ากัน
    // ทำบนตารางหยาบมากแล้วขยายกลับ → ได้ผลเหมือน multi-band blending แต่เบากว่ามาก
    //
    // ปรับ 2026-08-20 (เจ้าของงานเจอตะเข็บที่จุดที่ 5): ของเดิมเกลี่ยบนตาราง 1024×512 แค่ 4 รอบ
    //   = แผ่กว้างแค่ ~8 จุดภาพจริง แคบเกินกว่าจะกลบ "ทั้งใบสว่างกว่าเพื่อน"
    //   ใหม่: ย่อเป็น 128×64 แล้วเกลี่ย 10 รอบ = แผ่กว้าง ~80 จุดภาพจริง แล้วขยายกลับแบบไล่สี
    {
      const CW = 128, CH = 64, NCC = CW * CH;      // ตารางหยาบสำหรับ "ส่วนต่างความสว่าง"
      const cs = new Float32Array(NCC), cw = new Float32Array(NCC);
      for (let y = 0; y < LH; y++) {
        const cy = ((y * CH / LH) | 0) * CW;
        for (let x = 0; x < LW; x++) {
          const i = y * LW + x;
          const b = i * MAXC;
          if (!candL[b] || !candL[b + 1]) continue;   // มีใบเดียว ไม่มีอะไรให้เทียบ
          // เป้าหมาย = เฉลี่ยนุ่มๆ ของทุกใบ (ความถี่ต่ำของมันถูกต้อง แม้ความถี่สูงจะซ้อนกัน)
          let tw = 0, tg = 0;
          for (let k = 0; k < MAXC && candL[b + k]; k++) { tw += candQ[b + k]; tg += candG[b + k] * candQ[b + k]; }
          const actual = grayOf(i, label[i]);
          if (actual < 0 || !tw) continue;
          let d = tg / tw - actual;
          if (d > 30) d = 30; else if (d < -30) d = -30;
          const ci = cy + ((x * CW / LW) | 0);
          cs[ci] += d; cw[ci] += 1;
        }
      }
      for (let i = 0; i < NCC; i++) cs[i] = cw[i] ? cs[i] / cw[i] : 0;

      // เกลี่ยให้นุ่มมาก (ไม่งั้นตัวแก้เองจะกลายเป็นขอบใหม่)
      const tmp = new Float32Array(NCC);
      for (let pass = 0; pass < 10; pass++) {
        for (let y = 0; y < CH; y++) {
          for (let x = 0; x < CW; x++) {
            const i = y * CW + x;
            const l = y * CW + (x === 0 ? CW - 1 : x - 1), r = y * CW + (x === CW - 1 ? 0 : x + 1);
            const u = y > 0 ? i - CW : i, dn = y < CH - 1 ? i + CW : i;
            tmp[i] = (cs[i] * 2 + cs[l] + cs[r] + cs[u] + cs[dn]) / 6;
          }
        }
        cs.set(tmp);
      }

      // ขยายกลับแบบไล่สี (bilinear) ไม่งั้นจะเห็นเป็นตาราง
      for (let y = 0; y < H; y++) {
        const fy = Math.min(CH - 1.001, Math.max(0, (y + 0.5) * CH / H - 0.5));
        const y0 = fy | 0, ty = fy - y0, y1 = Math.min(CH - 1, y0 + 1);
        const r0 = y0 * CW, r1 = y1 * CW;
        for (let x = 0; x < W; x++) {
          const oi = y * W + x;
          if (!fullLab[oi]) continue;
          const fx = (x + 0.5) * CW / W - 0.5;
          const x0 = Math.floor(fx), tx = fx - x0;
          const xa = ((x0 % CW) + CW) % CW, xb = (xa + 1) % CW;
          const d = (cs[r0 + xa] * (1 - tx) + cs[r0 + xb] * tx) * (1 - ty) +
                    (cs[r1 + xa] * (1 - tx) + cs[r1 + xb] * tx) * ty;
          if (d > -0.15 && d < 0.15) continue;
          const di = oi * 4;
          out[di] += d; out[di + 1] += d; out[di + 2] += d;
        }
      }
      st.ui.hud.textContent = 'เกลี่ยสีข้ามตะเข็บ…';
      await new Promise((r) => setTimeout(r, 0));
    }

    // ── ปิดรูเล็กที่หลงเหลือด้วยการลามสีจากเพื่อนบ้าน ──
    const filled = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) if (out[i * 4 + 3]) filled[i] = 1;
    for (let pass = 0; pass < 16; pass++) {
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

    // ที่ยังเหลือคือช่องใหญ่จริงๆ (พื้นใต้เท้า) → เติมด้วย "สีเฉลี่ยของทั้งภาพ"
    // กลืนกว่าสีเข้มตายตัว และเดี๋ยวโดนโลโก้ทับอยู่แล้ว
    let ar = 0, ag = 0, ab = 0, an = 0;
    for (let i = 0; i < W * H; i += 37) {
      if (!filled[i]) continue;
      const d = i * 4; ar += out[d]; ag += out[d + 1]; ab += out[d + 2]; an++;
    }
    const mr = an ? ar / an : 40, mg = an ? ag / an : 44, mb = an ? ab / an : 50;
    let gap = 0;
    for (let i = 0; i < W * H; i++) {
      if (!filled[i]) { gap++; const d = i * 4; out[d] = mr; out[d + 1] = mg; out[d + 2] = mb; out[d + 3] = 255; }
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
    const st = this._state;
    const lens = (st && st.lensLabel) ? ('\nเลนส์ที่ใช้: ' + st.lensLabel) : '';
    const auto = (st && st.fovMeasured) ? ('\nระบบวัดได้เอง: ' + st.fovMeasured + '°') : '';
    const v = prompt('มุมมองกล้องด้านยาว (องศา)' + lens + auto +
      '\nเลนส์หลักปกติ ~63 · เลนส์อัลตร้าไวด์ ~100-110' +
      '\nถ้าภาพต่อแล้วซ้อนกันให้ลดลง · ถ้ามีช่องว่างให้เพิ่มขึ้น', String(cur));
    if (!v) return;
    const n = Number(v);
    if (!(n >= this.FOV_MIN && n <= this.FOV_MAX)) {
      return this._toast(this._state.ui, 'ใส่ได้ระหว่าง ' + this.FOV_MIN + '-' + this.FOV_MAX, true);
    }
    localStorage.setItem(this._fovKey(), String(n));
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
      '<b>ถือมือถือชิดกลางลำตัว</b> แล้วหมุนทั้งตัว<b>ช้าๆ ต่อเนื่อง</b> ตามเส้นประ<br>ไม่ต้องหยุด — กวาดผ่านจุดเหลืองไปเรื่อยๆ ระบบเก็บภาพให้เอง</div>' +
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

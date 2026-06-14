// ============================================================
// pwa-install.js — ปุ่มลัด "ติดตั้งลงมือถือ" (เพิ่มไปยังหน้าจอ)
// ============================================================
// แค่ include ไฟล์นี้ในหน้าไหน หน้านั้นจะมีชิปลอย "📲 ติดตั้งลงมือถือ" อัตโนมัติ
//  - Android/Chrome: กดแล้วเด้งกล่องติดตั้งของระบบเลย (beforeinstallprompt)
//  - iPhone/Safari: Apple ไม่เปิดให้กดติดตั้งตรงๆ → กดแล้วโชว์ "วิธีทำ" เป็นภาพ
//  - ถ้าติดตั้ง/เปิดจากไอคอนแล้ว (standalone) → ไม่โชว์
// ============================================================
(function () {
  var deferred = null;
  var ua = navigator.userAgent || '';
  var isIOS = /iphone|ipad|ipod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad iOS13+
  var inApp = /line|fban|fbav|instagram/i.test(ua); // เปิดในแอป LINE/FB = ติดตั้งไม่ได้
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  if (isStandalone) return;                       // ติดตั้งแล้ว — ไม่ต้องโชว์
  if (sessionStorage.getItem('pwa_dismiss') === '1') return;

  // ── CSS ─────────────────────────────────────────────
  var css = document.createElement('style');
  css.textContent =
    '.pwa-chip{position:fixed;left:50%;transform:translateX(-50%);bottom:78px;z-index:60;' +
    'background:#1F3864;color:#fff;border:none;border-radius:99px;padding:11px 16px;font-size:13.5px;' +
    'font-weight:700;font-family:inherit;box-shadow:0 5px 18px rgba(31,56,100,.32);display:flex;align-items:center;gap:9px;cursor:pointer;max-width:92%;}' +
    '.pwa-chip .x{background:rgba(255,255,255,.22);border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;font-size:12px;}' +
    '.pwa-ov{position:fixed;inset:0;background:rgba(17,24,39,.55);z-index:70;display:flex;align-items:flex-end;justify-content:center;}' +
    '.pwa-sheet{background:#fff;border-radius:18px 18px 0 0;max-width:480px;width:100%;padding:20px 18px 26px;font-family:inherit;animation:pwaUp .2s ease;}' +
    '@keyframes pwaUp{from{transform:translateY(40px);opacity:.5}to{transform:none;opacity:1}}' +
    '.pwa-sheet h3{font-size:17px;font-weight:700;color:#1F2937;margin:0 0 3px;}' +
    '.pwa-sheet p{font-size:13px;color:#6B7280;margin:0 0 14px;}' +
    '.pwa-step{display:flex;gap:11px;align-items:flex-start;margin-bottom:13px;}' +
    '.pwa-num{flex:0 0 26px;height:26px;background:#1F3864;color:#fff;border-radius:50%;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;}' +
    '.pwa-step-t{font-size:13.5px;color:#374151;line-height:1.45;padding-top:2px;}' +
    '.pwa-close{width:100%;min-height:48px;background:#1F3864;color:#fff;border:none;border-radius:12px;font-size:15px;font-weight:700;font-family:inherit;margin-top:6px;cursor:pointer;}';
  document.head.appendChild(css);

  // ── ชิปลอย ──────────────────────────────────────────
  function makeChip() {
    if (document.querySelector('.pwa-chip')) return;
    var chip = document.createElement('div');
    chip.className = 'pwa-chip';
    chip.innerHTML = '<span>📲 ติดตั้งลงมือถือ</span><span class="x" title="ปิด">✕</span>';
    chip.onclick = function (e) {
      if (e.target.classList.contains('x')) {
        chip.remove(); sessionStorage.setItem('pwa_dismiss', '1'); return;
      }
      doInstall();
    };
    document.body.appendChild(chip);
  }
  function removeChip() { var c = document.querySelector('.pwa-chip'); if (c) c.remove(); }

  // ── ติดตั้ง ──────────────────────────────────────────
  function doInstall() {
    if (deferred) {                       // Android — เด้งกล่องติดตั้งของระบบ
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; removeChip(); });
      return;
    }
    showGuide();                          // iOS / อื่นๆ — โชว์วิธีทำ
  }

  // ── กล่องวิธีทำ (iOS / fallback) ─────────────────────
  function showGuide() {
    var steps = isIOS ? [
      'เปิดหน้านี้ด้วย <b>Safari</b> (สำคัญ! Chrome/LINE ติดตั้งไม่ได้)',
      'กดปุ่ม <b>แชร์</b> ⬆️ (กล่องมีลูกศรชี้ขึ้น กลางแถบล่าง)',
      'เลื่อนลงหา <b>"เพิ่มไปยังหน้าจอโฮม"</b> แล้วกด',
      'กด <b>"เพิ่ม"</b> มุมขวาบน — เสร็จ! ไอคอน DSTR อยู่บนหน้าจอแล้ว'
    ] : inApp ? [
      'แตะปุ่ม <b>⋮ (จุด 3 จุด)</b> มุมขวาบน',
      'เลือก <b>"เปิดในเบราว์เซอร์"</b> (Chrome/Safari)',
      'แล้วกดปุ่ม <b>📲 ติดตั้งลงมือถือ</b> อีกครั้ง'
    ] : [
      'กดเมนู <b>⋮ (จุด 3 จุด)</b> มุมขวาบนของ Chrome',
      'เลือก <b>"ติดตั้งแอป" / "เพิ่มลงในหน้าจอหลัก"</b>',
      'กดยืนยัน — ไอคอน DSTR จะอยู่บนหน้าจอ'
    ];
    var head = isIOS ? 'ติดตั้งลงไอโฟน (ผ่าน Safari)' : (inApp ? 'เปิดในเบราว์เซอร์ก่อน' : 'ติดตั้งลงมือถือ');
    var ov = document.createElement('div');
    ov.className = 'pwa-ov';
    ov.innerHTML = '<div class="pwa-sheet"><h3>📲 ' + head + '</h3>' +
      '<p>ทำครั้งเดียว แล้วเปิดจากไอคอนได้เลยเหมือนแอป</p>' +
      steps.map(function (s, i) {
        return '<div class="pwa-step"><div class="pwa-num">' + (i + 1) + '</div><div class="pwa-step-t">' + s + '</div></div>';
      }).join('') +
      '<button class="pwa-close">เข้าใจแล้ว</button></div>';
    ov.onclick = function (e) { if (e.target === ov || e.target.classList.contains('pwa-close')) ov.remove(); };
    document.body.appendChild(ov);
  }

  // ── เงื่อนไขโชว์ชิป ──────────────────────────────────
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e; makeChip();   // Android: ติดตั้งได้จริง
  });
  window.addEventListener('appinstalled', function () { deferred = null; removeChip(); });

  function onReady() {
    // iOS ไม่มี beforeinstallprompt → โชว์ชิปไว้ให้กดดูวิธี (ถ้ายังไม่ติดตั้ง)
    if (isIOS || inApp) makeChip();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();

  // เปิดให้หน้าเรียกเองได้ (เช่นปุ่มในเมนู)
  window.pwaInstall = doInstall;
})();

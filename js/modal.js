// ============================================================
// modal.js — ระบบ Popup กลาง
// ใช้ innerHTML กับ modalBox ที่อยู่นิ่ง (ไม่ outerHTML)
// ============================================================

const Modal = {
  // เปิด modal ทั่วไป
  show(html, extraClass = '') {
    let bg = document.getElementById('modalBg');
    if (!bg) {
      // สร้าง modal element ถ้ายังไม่มี
      bg = document.createElement('div');
      bg.id = 'modalBg';
      bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" id="modalBox"></div>';
      document.body.appendChild(bg);
      bg.addEventListener('click', (e) => {
        if (e.target === bg) Modal.close();
      });
    }
    const box = document.getElementById('modalBox');
    box.className = 'modal ' + extraClass;
    box.innerHTML = html;
    bg.classList.add('show');
  },

  // ปิด modal
  close() {
    const bg = document.getElementById('modalBg');
    if (!bg) return;
    bg.classList.remove('show');
    setTimeout(() => {
      const box = document.getElementById('modalBox');
      if (box) {
        box.className = 'modal';
        box.innerHTML = '';
      }
    }, 200);
  },

  // Toast notification
  toast(msg, duration = 2000) {
    let toast = document.getElementById('globalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'globalToast';
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), duration);
  },

  // Confirm dialog
  confirm(opts) {
    return new Promise((resolve) => {
      const html = `
        <div class="modal-icon ${opts.iconClass || 'warn'}">${opts.icon || '⚠️'}</div>
        <div class="modal-title">${opts.title || 'ยืนยัน'}</div>
        ${opts.desc ? `<div class="modal-desc">${opts.desc}</div>` : ''}
        ${opts.info ? `<div class="modal-info">${opts.info}</div>` : ''}
        <div class="modal-btns">
          <button class="modal-btn modal-btn-cancel" onclick="Modal._confirmResolve(false)">${opts.cancelText || 'ยกเลิก'}</button>
          <button class="modal-btn ${opts.confirmClass || 'modal-btn-warn'}" onclick="Modal._confirmResolve(true)">${opts.confirmText || 'ยืนยัน'}</button>
        </div>
      `;
      Modal._confirmResolve = (result) => {
        Modal.close();
        resolve(result);
      };
      this.show(html);
    });
  }
};

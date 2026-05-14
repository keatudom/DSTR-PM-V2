// ============================================================
// api.js — เชื่อมต่อ Google Apps Script
// ใช้ JSONP สำหรับอ่าน, no-cors POST สำหรับเขียน
// ============================================================

const API = {
  // อ่านข้อมูลด้วย JSONP (bypass CORS)
  callRead(action, params = {}) {
    return new Promise((resolve, reject) => {
      const callbackName = 'cb_' + Date.now() + '_' + Math.random().toString(36).substr(2,9);
      const script = document.createElement('script');

      window[callbackName] = (data) => {
        delete window[callbackName];
        document.body.removeChild(script);
        resolve(data);
      };

      script.onerror = () => {
        delete window[callbackName];
        document.body.removeChild(script);
        reject(new Error('Network error'));
      };

      const url = new URL(CONFIG.APPS_SCRIPT_URL);
      url.searchParams.set('action', action);
      url.searchParams.set('callback', callbackName);
      Object.keys(params).forEach(k => url.searchParams.set(k, params[k]));

      script.src = url.toString();
      document.body.appendChild(script);

      // Timeout 15 seconds
      setTimeout(() => {
        if (window[callbackName]) {
          delete window[callbackName];
          if (script.parentNode) document.body.removeChild(script);
          reject(new Error('Timeout'));
        }
      }, 15000);
    });
  },

  // เขียนข้อมูลด้วย POST (no-cors)
  async callWrite(action, data) {
    try {
      await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action, ...data })
      });
      return { ok: true };
    } catch (err) {
      console.error('API write error:', err);
      return { ok: false, error: err.message };
    }
  },

  // ดึงข้อมูลทั้งโปรเจกต์
  async fetchAll() {
    return await this.callRead('getAll');
  },

  // อัปเดต task
  async updateTask(taskId, status, doneDate) {
    return await this.callWrite('updateTask', { taskId, status, doneDate: doneDate || '' });
  },

  // อัปเดต payment
  async updatePayment(paymentId, status, receipt) {
    return await this.callWrite('updatePayment', { paymentId, status, receipt: receipt || '' });
  }
};

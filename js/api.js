// ============================================================
// api.js — JSONP สำหรับ Apps Script (รูปแบบที่พิสูจน์แล้วว่าใช้งานได้)
// ============================================================

const API = {
  callRead(action, params) {
    params = params || {};
    return new Promise(function(resolve, reject) {
      var cbName = 'jsonp_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      var script = document.createElement('script');
      var done = false;

      window[cbName] = function(data) {
        done = true;
        resolve(data);
        try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      script.onerror = function() {
        if (!done) {
          try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('Network error'));
        }
      };

      var url = CONFIG.APPS_SCRIPT_URL + '?callback=' + cbName + '&action=' + encodeURIComponent(action);
      Object.keys(params).forEach(function(k) {
        url += '&' + k + '=' + encodeURIComponent(params[k]);
      });

      script.src = url;
      document.head.appendChild(script);

      setTimeout(function() {
        if (!done) {
          try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('Timeout'));
        }
      }, 20000);
    });
  },

  callWrite: function(action, data) {
    return fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(Object.assign({ action: action }, data))
    }).then(function() {
      return { ok: true };
    }).catch(function(err) {
      console.error('API write error:', err);
      return { ok: false, error: err.message };
    });
  },

  fetchAll: function() { return this.callRead('getAll'); },
  updateTask: function(taskId, status, doneDate) {
    return this.callWrite('updateTask', { taskId: taskId, status: status, doneDate: doneDate || '' });
  },
  updatePayment: function(paymentId, status, receipt) {
    return this.callWrite('updatePayment', { paymentId: paymentId, status: status, receipt: receipt || '' });
  }
};

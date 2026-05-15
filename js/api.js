// ============================================================
// api.js v2 — JSONP สำหรับ Apps Script (รองรับทุก endpoint)
// ============================================================
// - Backward compatible 100% (fetchAll, updateTask, updatePayment ยังใช้ได้)
// - Helper methods ครบทุก endpoint ของ Code_v4.gs
// - Materials / Contractors / BOQ / AI Parser
// ============================================================

const API = {

  // ============================================================
  // 🔌 CORE — Low-level JSONP + POST
  // ============================================================

  /**
   * อ่านข้อมูลด้วย JSONP (bypass CORS)
   * @param {string} action - ชื่อ action ที่ Apps Script รู้จัก
   * @param {object} params - query parameters
   */
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
        if (params[k] !== undefined && params[k] !== null && params[k] !== '') {
          url += '&' + k + '=' + encodeURIComponent(params[k]);
        }
      });

      script.src = url;
      document.head.appendChild(script);

      setTimeout(function() {
        if (!done) {
          try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
          if (script.parentNode) script.parentNode.removeChild(script);
          reject(new Error('Timeout'));
        }
      }, 30000);
    });
  },

  /**
   * เขียนข้อมูลด้วย POST (no-cors)
   * หมายเหตุ: no-cors mode = ไม่สามารถอ่าน response ได้ คืน {ok: true} เสมอ
   */
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

  // ============================================================
  // 🔄 LEGACY — ของเดิม ไม่แตะ
  // ============================================================

  fetchAll: function() {
    return this.callRead('getAll');
  },

  updateTask: function(taskId, status, doneDate) {
    return this.callWrite('updateTask', {
      taskId: taskId,
      status: status,
      doneDate: doneDate || ''
    });
  },

  updatePayment: function(paymentId, status, receipt) {
    return this.callWrite('updatePayment', {
      paymentId: paymentId,
      status: status,
      receipt: receipt || ''
    });
  },

  // ============================================================
  // 🔐 AUTH
  // ============================================================

  loginServer: function(password) {
    return this.callRead('login', { password: password });
  },

  // ============================================================
  // 🏠 FF ITEMS
  // ============================================================

  getFFList: function() {
    return this.callRead('get_ff_list');
  },

  getTasks: function(ffCode) {
    return this.callRead('get_tasks', { ff_code: ffCode || '' });
  },

  // ============================================================
  // 👷 CONTRACTORS
  // ============================================================

  getContractors: function(role) {
    return this.callRead('get_contractors', { role: role || '' });
  },

  createContractor: function(data) {
    return this.callWrite('create_contractor', data);
  },

  // ============================================================
  // 🏪 SUPPLIERS
  // ============================================================

  getSuppliers: function() {
    return this.callRead('get_suppliers');
  },

  createSupplier: function(data) {
    return this.callWrite('create_supplier', data);
  },

  // ============================================================
  // 📦 MATERIALS
  // ============================================================

  getMaterials: function(mode, category) {
    return this.callRead('get_materials', {
      mode: mode || '',
      category: category || ''
    });
  },

  getMaterial: function(matId) {
    return this.callRead('get_material', { mat_id: matId });
  },

  createMaterial: function(data) {
    return this.callWrite('create_material', data);
  },

  updateMaterial: function(matId, updates) {
    return this.callWrite('update_material', Object.assign({ mat_id: matId }, updates));
  },

  // ============================================================
  // 💰 MATERIAL TRANSACTIONS
  // ============================================================

  getTransactions: function(matId, type, ffCode) {
    return this.callRead('get_transactions', {
      mat_id: matId || '',
      type: type || '',
      ff_code: ffCode || ''
    });
  },

  /**
   * รับวัสดุเข้า site
   * @param {object} data - { material_id, quantity, unit_price, supplier_id, receipt_no, notes }
   */
  receiveMaterial: function(data) {
    return this.callWrite('receive_material', data);
  },

  /**
   * เบิกวัสดุ
   * @param {object} data - { material_id, quantity, contractor_id, ff_code, notes, force }
   */
  withdrawMaterial: function(data) {
    return this.callWrite('withdraw_material', data);
  },

  /**
   * นับสต๊อก / อัปเดต status
   * @param {object} data - { material_id, new_stock, notes, trigger_source }
   */
  countMaterial: function(data) {
    return this.callWrite('count_material', data);
  },

  // ============================================================
  // 🤖 AI QUICK LOG (สำคัญ!)
  // ============================================================

  /**
   * ส่งข้อความ Quick Log ให้ AI parse
   * Returns: { items: [...], needs_clarification: [...] }
   * หมายเหตุ: ใช้ callRead เพราะต้องการ response กลับมา
   */
  parseMaterialLog: function(text) {
    return this.callRead('parse_material_log', { text: text });
  },

  /**
   * ยืนยัน items ที่ AI parse → insert ลง transactions
   * @param {array} items - array ของ items ที่ user ยืนยันแล้ว
   */
  confirmMaterialLog: function(items) {
    return this.callWrite('confirm_material_log', {
      items: JSON.stringify(items)
    });
  },

  // ============================================================
  // 📋 BOQ
  // ============================================================

  getBOQ: function(ffCode) {
    return this.callRead('get_boq', { ff_code: ffCode || '' });
  },

  createBOQ: function(data) {
    return this.callWrite('create_boq', data);
  },

  checkBoqStatus: function(ffCode) {
    return this.callRead('check_boq_status', { ff_code: ffCode });
  },

  // ============================================================
  // 🚨 AI ALERTS
  // ============================================================

  getAiAlerts: function() {
    return this.callRead('get_ai_alerts');
  },

  // ============================================================
  // 📝 DAILY REPORTS
  // ============================================================

  getDailyReports: function() {
    return this.callRead('get_daily_reports');
  },

  createDaily: function(data) {
    return this.callWrite('create_daily', data);
  },

  addQuickLog: function(data) {
    return this.callWrite('add_quick_log', data);
  },

  aiSummary: function(reportId) {
    return this.callRead('ai_summary', { report_id: reportId });
  },

  // ============================================================
  // 📷 PHOTOS
  // ============================================================

  getPhotos: function() {
    return this.callRead('get_photos');
  },

  addPhoto: function(data) {
    return this.callWrite('add_photo', data);
  },

  // ============================================================
  // 🧪 UTILS
  // ============================================================

  /**
   * Ping เพื่อเช็คว่า API ทำงาน
   */
  ping: function() {
    return this.callRead('ping');
  }
};

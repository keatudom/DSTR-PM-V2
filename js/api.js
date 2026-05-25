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

  /**
   * POST + อ่าน response ได้ (สำหรับ payload กลางๆ เช่น parse_material_log)
   * Apps Script จะส่ง CORS header เมื่อ Content-Type = text/plain
   * Note: ต้องใช้ async/await หรือ .then() เพราะคืน Promise
   *
   * ⚠️ สำหรับ payload ใหญ่มาก (รูป base64) ใช้ callUpload แทน —
   *    fetch + redirect ของ Apps Script ทำให้ POST กลายเป็น GET → body หาย
   */
  callPost: function(action, data) {
    return fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action: action }, data))
    }).then(function(res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    }).catch(function(err) {
      console.error('API post error:', err);
      return { ok: false, error: err.message };
    });
  },

  /**
   * 📤 callUpload — POST payload ใหญ่ (รูป base64) + อ่าน response ได้
   * ============================================================
   * ทำไมต้องมีเมธอดนี้แยก:
   *   - fetch() เจอ 302 redirect ของ Apps Script → เปลี่ยน POST เป็น GET
   *     → body (รูป base64) หาย → backend เข้า doGet → error
   *     "image_base64 required"
   *   - วิธีนี้ใช้ <form> submit ผ่าน hidden <iframe> แทน:
   *     • form submit ไม่ติด CORS preflight
   *     • เบราว์เซอร์เดิน redirect ของ Apps Script ให้เองภายใน iframe
   *       โดยไม่เปลี่ยน method และไม่ทิ้ง body
   *   - response อ่านผ่าน window.postMessage (เพราะ iframe จบที่
   *     script.googleusercontent.com ซึ่งคนละ origin อ่านตรงๆ ไม่ได้)
   *     → backend ต้องตอบ HTML ที่เรียก postMessage กลับมา
   *       (ดู respondUpload_() ใน Code.gs)
   *
   * @param {string} action  - ชื่อ action (เช่น 'upload_log_photo')
   * @param {object} data    - field ต่างๆ เช่น { image_base64: '...' }
   * @returns {Promise<object>} JSON response จาก backend
   */
  callUpload: function(action, data) {
    return new Promise(function(resolve, reject) {
      data = data || {};

      var uid = 'up_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
      var iframe = document.createElement('iframe');
      iframe.name = uid;
      iframe.style.display = 'none';

      var form = document.createElement('form');
      form.method = 'POST';
      form.action = CONFIG.APPS_SCRIPT_URL;
      form.target = uid;            // ⬅️ ส่งผลลัพธ์ไปโผล่ใน iframe
      form.style.display = 'none';
      form.enctype = 'application/x-www-form-urlencoded';

      // action + upload_token + ทุก field → hidden inputs
      // upload_token ให้ backend ส่งกลับมาด้วย เพื่อจับคู่ response ถูกตัว
      var fields = Object.assign({ action: action, upload_token: uid }, data);
      Object.keys(fields).forEach(function(k) {
        var val = fields[k];
        if (val === undefined || val === null) return;
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = k;
        input.value = (typeof val === 'object') ? JSON.stringify(val) : String(val);
        form.appendChild(input);
      });

      var done = false;
      var timer = null;

      function cleanup() {
        if (timer) clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        if (form.parentNode) form.parentNode.removeChild(form);
      }

      function finish(result) {
        if (done) return;
        done = true;
        cleanup();
        resolve(result);
      }

      var iframeLoaded = false;

      // รับ response จาก backend ผ่าน postMessage (เส้นทางหลัก)
      function onMessage(ev) {
        var msg = ev.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.__dstrUpload !== uid) return;   // ไม่ใช่ของ request นี้
        finish(msg.payload || { ok: false, error: 'empty payload' });
      }
      window.addEventListener('message', onMessage);

      iframe.onload = function() {
        if (done) return;
        iframeLoaded = true;
        // ลองอ่านเนื้อ iframe ตรงๆ — ได้เฉพาะถ้า same-origin
        // (ปกติคนละ origin จะ throw → ข้ามไป รอ postMessage)
        var text = '';
        try {
          var doc = iframe.contentDocument || iframe.contentWindow.document;
          text = doc && doc.body ? doc.body.innerText : '';
        } catch (e) {
          return;  // คนละ origin — รอ postMessage จาก onMessage
        }
        if (!text) return;
        // ถ้าอ่านได้และเป็น JSON → ใช้เลย (กรณี same-origin)
        try {
          var parsed = JSON.parse(text);
          finish(parsed);
        } catch (e) {
          // ไม่ใช่ JSON (อาจเป็นหน้า HTML postMessage) — รอ onMessage
        }
      };

      // ถ้า iframe โหลดเสร็จแล้วแต่ postMessage ไม่มาภายใน 15 วิ → แจ้ง error
      // (เพิ่มจาก 8s → 15s รองรับ Apps Script cold start + slow mobile network)
      function watchdog() {
        if (done) return;
        if (iframeLoaded) {
          finish({
            ok: false,
            error: 'อัพรูปไม่ทันเวลา — server ตอบช้า (ลองใหม่ได้ log จะบันทึกอยู่)'
          });
        } else {
          setTimeout(watchdog, 2000);  // iframe ยังไม่โหลด — รอต่อ
        }
      }
      setTimeout(watchdog, 15000);

      timer = setTimeout(function() {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('Upload timeout'));
      }, 60000);  // รูปใหญ่ → ให้เวลา 60 วิ

      document.body.appendChild(iframe);
      document.body.appendChild(form);
      form.submit();
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
  // 🏗️ PROJECTS (00_Projects — multi-project registry)
  // ============================================================

  /**
   * ดึงรายการโปรเจกต์ทั้งหมด
   * Returns: { ok:true, data:[{project_id, name, client, quote_no,
   *           start_date, end_date, total_days, total_value,
   *           contractor, status, sheets_id, created_at}] }
   */
  getProjects: function() {
    return this.callRead('get_projects');
  },

  /**
   * สร้างโปรเจกต์ใหม่
   * ใช้ callRead (JSONP GET) เพื่ออ่าน response — บทเรียน callwrite-loses-post-body
   * @param {object} data - { name (req), client, quote_no, start_date, end_date, total_value, contractor }
   * Returns: { ok:true, project_id, project }
   */
  createProject: function(data) {
    return this.callRead('create_project', data);
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

  /**
   * ดึงรูปงานของ task จาก 13_Task_Photos (read-only)
   * ใช้ callRead (JSONP GET) — บทเรียน callwrite-loses-post-body
   * @param {string} taskId - Task ID
   * Returns: { ok:true, data:[{id,task_id,drive_url,drive_id,caption,uploaded_at,uploaded_by}] }
   *          เรียงเก่า→ใหม่ · ไม่ส่ง taskId → data:[]
   */
  getTaskPhotos: function(taskId) {
    return this.callRead('get_task_photos', { task_id: taskId });
  },

  // ลบรูป task (13_Task_Photos) — ใช้ callRead เพื่ออ่านผล {ok,error} จริง
  // (callWrite no-cors POST → param หายตาม redirect, ดู callwrite-loses-post-body)
  deleteTaskPhoto: function(photoId) {
    return this.callRead('delete_task_photo', { photo_id: photoId });
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
  // 👥 TEAMS (team check-in — Daily Activity Hub ขั้น 1)
  // ============================================================

  /**
   * ดึงรายชื่อทีมทั้งหมดจาก 21_Teams
   * Returns: { ok:true, data:[{team_id,name,type,lead_name}] }
   */
  getTeams: function() {
    return this.callRead('get_teams');
  },

  /**
   * เช็คอิน/อัปเดตจำนวนคนของทีม (1 record/ทีม/วัน — เช็คอินซ้ำ = อัปเดต)
   * @param {object} data - { team_id (req), worker_count, action ('in'/'out'), date }
   * หมายเหตุ: ใช้ callRead เพราะต้องอ่าน response (updated/log_id) มายืนยัน optimistic UI
   */
  teamCheckin: function(data) {
    return this.callRead('team_checkin', data || {});
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

  // หมายเหตุ: material mutation ใช้ callRead (JSONP GET) ไม่ใช่ callWrite
  // เพราะ callWrite = POST no-cors → Apps Script 302 redirect ทำ body หาย
  // → param ไม่ถึง backend + อ่านผลจริงไม่ได้ (เคยทำลบ/แก้ "เหมือนสำเร็จแต่ไม่เกิดอะไร")
  createMaterial: function(data) {
    return this.callRead('create_material', data);
  },

  updateMaterial: function(matId, updates) {
    return this.callRead('update_material', Object.assign({ mat_id: matId }, updates));
  },

  /**
   * ปิดใช้งานวัสดุ (soft delete — active=false) — ปลอดภัย default
   * @param {string} matId - material_id
   */
  deactivateMaterial: function(matId) {
    return this.callRead('deactivate_material', { material_id: matId });
  },

  /**
   * ลบวัสดุถาวร (hard delete) — backend ปฏิเสธถ้ามี transaction อ้างอยู่
   * ใช้ callRead เพื่ออ่าน response (ok/error) มาแจ้งผู้ใช้ว่าลบได้หรือถูกปฏิเสธ
   * @param {string} matId - material_id
   */
  deleteMaterial: function(matId) {
    return this.callRead('delete_material', { material_id: matId });
  },

  /**
   * เปลี่ยนสถานะวัสดุโหมด STATUS อย่างรวดเร็ว (แตะปุ่มบนการ์ด)
   * ใช้ count_material เพื่อให้ถูกบันทึก transaction + auto-log เหมือนการนับปกติ
   * @param {string} matId - material_id
   * @param {number} status - 0=หมด 1=ใกล้หมด 2=ใช้ได้ 3=เต็ม
   */
  changeMaterialStatus: function(matId, status) {
    return this.callRead('count_material', {
      material_id: matId,
      new_stock: status,
      notes: 'เปลี่ยนสถานะจากการ์ดวัสดุ',
      trigger_source: 'card_quick',
    });
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

  /**
   * อัปโหลดรูปประกอบ activity log
   * ใช้ callUpload (hidden iframe) เพราะ base64 รูปใหญ่เกิน fetch/JSONP
   * @param {string} imageBase64 - data URL หรือ base64 ล้วน
   * @returns {Promise<{ok, photo_url, drive_id, thumbnail}>}
   */
  uploadLogPhoto: function(imageBase64) {
    return this.callUpload('upload_log_photo', { image_base64: imageBase64 });
  },

  // ============================================================
  // 👥 PROJECT STAFF — assign คนในบริษัทเข้าโปรเจค (27_Project_Staff)
  // ============================================================

  getAllStaff: function() {
    return this.callRead('get_all_staff');
  },

  getProjectStaff: function(projectId) {
    return this.callRead('get_project_staff', { project_id: projectId });
  },

  // mutation → callRead (JSONP GET) ตามบทเรียน callwrite-loses-post-body
  assignProjectStaff: function(projectId, staffId, roleInProject) {
    return this.callRead('assign_project_staff', {
      project_id: projectId, staff_id: staffId,
      role_in_project: roleInProject || ''
    });
  },

  unassignProjectStaff: function(assignmentId) {
    return this.callRead('unassign_project_staff', { assignment_id: assignmentId });
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

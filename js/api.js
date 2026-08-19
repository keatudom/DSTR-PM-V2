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
   * Phase B-3: auto-inject project_id จาก state.projectId
   * เรียกใน callRead/callWrite/callPost/callUpload
   * - ถ้า caller ส่ง project_id มาแล้ว → ใช้ของ caller (assign_project_staff ฯลฯ)
   * - ถ้าไม่ส่ง → ใช้ state.projectId (default 'bow-house' ถ้า state ไม่โหลด)
   */
  _injectProjectId: function(params) {
    params = params || {};
    if (params.project_id !== undefined && params.project_id !== null && params.project_id !== '') {
      return params;
    }
    var pid = (typeof state !== 'undefined' && state.projectId) ? state.projectId : 'bow-house';
    params.project_id = pid;
    return params;
  },

  /**
   * Phase G: แนบ auth_token (บัตรผ่าน) ทุก call ถ้า login ด้วย Google ไว้
   * อ่านจาก localStorage ตรงๆ (ไม่ผูกกับลำดับโหลด Auth)
   * - ไม่มี token → ไม่แนบ → backend ใช้พฤติกรรมเดิม (migration-safe)
   * - caller ส่ง auth_token เอง → เคารพของ caller
   */
  _injectAuth: function(params) {
    params = params || {};
    if (params.auth_token) return params;
    try {
      var raw = localStorage.getItem(CONFIG.SESSION_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (s && s.token) params.auth_token = s.token;
      }
    } catch (e) {}
    return params;
  },

  /**
   * ☁️ _cfCall — เส้นทางใหม่: ยิงตรงไป Cloudflare Worker (BACKEND==='cf')
   * ============================================================
   * ต่างจากของเดิม (Apps Script): Worker ตอบ CORS header จริง →
   * ทุก call เป็น fetch POST JSON ธรรมดา อ่าน response ได้ตรงๆ
   * ไม่ต้องใช้ JSONP / no-cors / iframe hack อีกต่อไป
   *
   * - action + ทุก param ส่งใน body JSON (Worker รวม query+body, อ่าน action จาก body)
   * - auth: แนบ auth_token ทั้งใน body (ตัวที่ authz อ่านจริง) และ Bearer header (เผื่ออนาคต)
   * - รูป base64 ก็ส่งใน JSON ได้เลย (ไม่ติด 302 redirect เหมือน Apps Script)
   * - ใช้ path '/api' (Worker ไม่ route ตาม path ยกเว้น /media, /line/webhook)
   *
   * @returns {Promise<object>} JSON ที่ Worker ตอบ (โครงเดิมเป๊ะ: {ok,data} หรือ raw)
   */
  _cfCall: function(action, params) {
    params = this._injectAuth(this._injectProjectId(params || {}));
    var base = String(CONFIG.CF_API_URL || '').replace(/\/+$/, '');
    var headers = { 'Content-Type': 'application/json' };
    if (params.auth_token) headers['Authorization'] = 'Bearer ' + params.auth_token;
    return fetch(base + '/api', {
      method: 'POST',
      headers: headers,
      // action (ชื่อ route) วางท้ายสุด → ชนะเสมอ กันข้อมูลใน params ที่บังเอิญชื่อ 'action' มาเขียนทับ
      body: JSON.stringify(Object.assign({}, params, { action: action }))
    }).then(function(res) {
      return res.json();
    });
  },

  /**
   * 🔁 ข้อผิดพลาดชั่วคราวที่ "ลองใหม่แล้วหาย" — ไม่ใช่ความผิดของคำสั่งที่ส่งไป
   * D1 (ฐานข้อมูล Cloudflare) สะอึกเป็นครั้งคราวกับ query หนักๆ
   * วัดจริง 2026-08-13: getAll ล้ม ~1 ใน 6 ครั้ง ส่วน query เล็กผ่าน 6/6
   * → หน้าโครงการขึ้น "โหลดข้อมูลไม่สำเร็จ" ทั้งที่ข้อมูลอยู่ครบ กดรีเฟรชเองก็หาย
   */
  _isTransient: function(res) {
    var e = res && res.ok === false ? String(res.error || '') : '';
    return e.indexOf('D1_ERROR') >= 0 || e.indexOf('internal error') >= 0 ||
           e.indexOf('Network') >= 0 || e.indexOf('storage caused object to be reset') >= 0;
  },

  /**
   * ⚠️⚠️ กับดักสำคัญ: ระบบนี้ยิง "คำสั่งบันทึก" ผ่าน callRead ด้วยหลายตัว
   *   (create_checkin, update_ff, delete_ff, create_risk, create_eval, assign_project_staff ...
   *    เป็นมรดกจากยุค Apps Script — บทเรียน callwrite-loses-post-body)
   *   ถ้าลองใหม่แบบเหมารวม = บันทึกซ้ำ 2 รอบ (เช็คอิน 2 ครั้ง / เบิกของ 2 ครั้ง)
   *
   * จึงลองใหม่ "เฉพาะคำสั่งที่อ่านอย่างเดียวจริงๆ" ตามชื่อ: get_* / client_get_* / getAll /
   * qc_summary / ping — ทุกตัวนี้ไม่แตะฐานข้อมูล ยิงซ้ำกี่ครั้งก็ปลอดภัย
   */
  _isReadOnly: function(action) {
    // tour_get_* = อ่านอย่างเดียวจริง (ไม่แตะฐานข้อมูลเลย) → ลองใหม่ได้ปลอดภัย
    // สำคัญกับหน้าทัวร์เป็นพิเศษ เพราะคนใช้ยืนอยู่หน้างานที่เน็ตสะดุดบ่อย
    return /^(get_|client_get_|tour_get_)/.test(action) ||
           /^(getAll|qc_summary|ping|check_boq_status)$/.test(action);
  },

  /**
   * เรียกซ้ำอัตโนมัติเมื่อเจอ error ชั่วคราว — เฉพาะคำสั่งอ่านเท่านั้น
   */
  _cfCallRetry: function(action, params, tries) {
    var self = this;
    if (!this._isReadOnly(action)) return this._cfCall(action, params);  // คำสั่งเขียน = ยิงครั้งเดียวจบ
    tries = tries || 3;
    var delays = [0, 400, 1200];   // ครั้งแรกทันที แล้วหน่วงเพิ่มขึ้น
    function attempt(i) {
      return self._cfCall(action, params).then(function(res) {
        if (i + 1 < tries && self._isTransient(res)) {
          console.warn('[API] ' + action + ' สะดุด (' + (res && res.error) + ') — ลองใหม่ครั้งที่ ' + (i + 2));
          return new Promise(function(r) { setTimeout(r, delays[i + 1] || 1200); }).then(function() { return attempt(i + 1); });
        }
        return res;
      }).catch(function(err) {
        if (i + 1 < tries) {
          return new Promise(function(r) { setTimeout(r, delays[i + 1] || 1200); }).then(function() { return attempt(i + 1); });
        }
        throw err;
      });
    }
    return attempt(0);
  },

  /**
   * อ่านข้อมูลด้วย JSONP (bypass CORS)
   * @param {string} action - ชื่อ action ที่ Apps Script รู้จัก
   * @param {object} params - query parameters
   */
  callRead(action, params) {
    // ☁️ โหมด Cloudflare — fetch ตรง (อ่าน response ได้จริง) + ลองใหม่ถ้า D1 สะอึก
    if (CONFIG.BACKEND === 'cf') return this._cfCallRetry(action, params);
    params = this._injectAuth(this._injectProjectId(params));
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
    // ☁️ โหมด Cloudflare — POST จริง อ่าน {ok,...} จริง (ไม่ใช่ {ok:true} หลอกแบบ no-cors)
    if (CONFIG.BACKEND === 'cf') {
      return this._cfCall(action, data).catch(function(err) {
        console.error('API write error (cf):', err);
        return { ok: false, error: err.message };
      });
    }
    data = this._injectAuth(this._injectProjectId(data));
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
    // ☁️ โหมด Cloudflare — POST JSON อ่าน response ได้ (เหมือน callRead แต่ผ่าน body)
    if (CONFIG.BACKEND === 'cf') {
      return this._cfCall(action, data).catch(function(err) {
        console.error('API post error (cf):', err);
        return { ok: false, error: err.message };
      });
    }
    data = this._injectAuth(this._injectProjectId(data));
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
    // ☁️ โหมด Cloudflare — อัปโหลด base64 ผ่าน JSON ตรงๆ (ไม่ต้อง iframe hack)
    //   Worker ไม่ 302 redirect → body ไม่หาย → อ่าน {ok, photo_url, ...} ได้เลย
    if (CONFIG.BACKEND === 'cf') {
      return this._cfCall(action, data).catch(function(err) {
        console.error('API upload error (cf):', err);
        return { ok: false, error: err.message };
      });
    }
    var self = this;
    return new Promise(function(resolve, reject) {
      data = self._injectAuth(self._injectProjectId(data));

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
  // 🔐 PHASE G — AUTH / USER MANAGEMENT (owner only)
  // ============================================================

  /** ใครกำลัง login อยู่ + บทบาท (จาก token) */
  getMe: function() {
    return this.callRead('get_me');
  },

  /** 🔔 event ล่าสุดของโครงการ (สำหรับกระดิ่งแจ้งเตือน) */
  getNotifications: function(limit) {
    return this.callRead('get_notifications', { limit: limit || 40 });
  },

  /** รายชื่อผู้ใช้ทั้งหมด + บทบาท + โครงการ (owner only) */
  getUsers: function() {
    return this.callRead('get_users');
  },

  /**
   * เพิ่ม/แก้ผู้ใช้ (owner only)
   * @param {object} data - { email (req), name, auth_role, phone?, role?, active?, staff_id? }
   */
  upsertUser: function(data) {
    return this.callRead('upsert_user', data);
  },

  /** เปลี่ยนบทบาทสิทธิ์ (owner only) — { staff_id|email, auth_role } */
  setUserRole: function(staffId, authRole) {
    return this.callRead('set_user_role', { staff_id: staffId, auth_role: authRole });
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

  /**
   * เพิ่ม FF หลายรายการในโปรเจกต์ (Phase C-1 wizard)
   * ใช้ callPost — รับ array ผ่าน body (callRead URL อาจยาวเกิน)
   * project_id ส่งอัตโนมัติจาก state.projectId ผ่าน _injectProjectId
   * @param {Array} items - [ { code, name, price, area, zone, ... }, ... ]
   * Returns: { ok:true, data:{ created_count, failed_count, created, failed } }
   */
  createFFBatch: function(items) {
    return this.callPost('create_ff_batch', { items: items });
  },

  /**
   * Phase D-1 — แก้ไข FF (Edit)
   * ใช้ callRead เพื่ออ่าน response ตามบทเรียน callwrite-loses-post-body
   * @param {object} data - { code (req), name?, zone?, price?, ... }
   */
  updateFF: function(data) {
    return this.callRead('update_ff', data);
  },

  /**
   * Phase D-1 — ลบ FF + tasks (cascade)
   * @param {string} code - FF Code
   */
  deleteFF: function(code) {
    return this.callRead('delete_ff', { code: code });
  },

  /**
   * Phase C-4 — Clone โปรเจกต์จาก template (default: bow-house)
   * คัดลอก FF + tasks จาก source ไป target — reset status เป็น 'Not Started'
   * ใช้ callRead (JSONP GET) — payload เล็ก แค่ project IDs
   * @param {string} targetProjectId - โปรเจกต์ปลายทาง (ต้องมีอยู่ใน 00_Projects + ยังไม่มี FF)
   * @param {string} [sourceProjectId='bow-house'] - โปรเจกต์ต้นแบบ
   * @param {boolean} [includeTasks=true] - คัดลอก tasks ของแต่ละ FF ด้วยหรือไม่
   * Returns: { ok:true, data:{ source, target, ff_cloned, tasks_cloned } }
   */
  cloneFromTemplate: function(targetProjectId, sourceProjectId, includeTasks) {
    return this.callRead('clone_project', {
      target_project_id: targetProjectId,
      source_project_id: sourceProjectId || 'bow-house',
      include_tasks: (includeTasks === false) ? 'false' : 'true'
    });
  },

  // ============================================================
  // ⚠️ RISKS (Phase R-1/R-2/R-3) — risk register + matrix
  // ============================================================

  /**
   * เพิ่ม risk 1 รายการ
   * @param {object} data - { description, likelihood_score (1-5), impact_score (1-5),
   *                          category, affected_parties, causes, mitigation, owner, status }
   */
  createRisk: function(data) {
    return this.callRead('create_risk', data);
  },

  /**
   * แก้ไข risk
   * @param {object} data - { id (req), description?, likelihood_score?, impact_score?, ... }
   */
  updateRisk: function(data) {
    return this.callRead('update_risk', data);
  },

  /**
   * ลบ risk
   * @param {string} riskId
   */
  deleteRisk: function(riskId) {
    return this.callRead('delete_risk', { id: riskId });
  },

  /**
   * Clone risks จาก template (default: direk-template) ไป project ปัจจุบัน
   * @param {string} targetProjectId
   * @param {string} [sourceProjectId='direk-template']
   */
  cloneRisksFromTemplate: function(targetProjectId, sourceProjectId) {
    return this.callRead('clone_risks', {
      target_project_id: targetProjectId,
      source_project_id: sourceProjectId || 'direk-template'
    });
  },

  // ============================================================
  // 📋 CONTRACTOR EVALUATION — ประเมินผู้รับเหมา (KPI 100 คะแนน)
  // ============================================================

  /** ดึง config KPI/น้ำหนัก/เกณฑ์ สำหรับสร้างฟอร์ม */
  getEvalConfig: function() {
    return this.callRead('get_eval_config');
  },

  /** ดึงรายการประเมินของโปรเจกต์ปัจจุบัน (auto-inject project_id) */
  getEvals: function(teamId) {
    return this.callRead('get_evals', { team_id: teamId || '' });
  },

  /** สรุปคะแนนเฉลี่ย/เกรด/Ranking ต่อทีม (ข้ามโครงการ — สำหรับ team.html) */
  getEvalSummary: function() {
    return this.callRead('get_eval_summary', { project_id: '' });
  },

  /**
   * บันทึกการประเมิน 1 ครั้ง
   * @param {object} data - { team_id (req), team_name?, eval_date?, evaluator?, remark?,
   *                          sub_scores (JSON string {'1.1':8,...}), kpi_scores? }
   */
  createEval: function(data) {
    return this.callRead('create_eval', data);
  },

  /** แก้ไขการประเมิน */
  updateEval: function(data) {
    return this.callRead('update_eval', data);
  },

  /** ลบการประเมิน */
  deleteEval: function(evalId) {
    return this.callRead('delete_eval', { id: evalId });
  },

  /** สรุปมูลค่าคงคลัง (รับ/ใช้/เหลือ เป็นบาท รวม+แยกหมวด) ของโปรเจกต์ปัจจุบัน */
  getInventorySummary: function() {
    return this.callRead('get_inventory_summary');
  },

  // ============================================================
  // 💰 CLIENT FINANCE (Phase F) — สัญญา + หลักฐานฝั่งเจ้าบ้าน (เงินเข้า)
  // ============================================================
  // reuse โครงสร้างสัญญาผู้รับเหมา แต่ party='client' → แยกเป็นเงินเข้า
  // mutation ใช้ callRead (JSONP GET) ตามบทเรียน callwrite-loses-post-body
  // upload ใช้ callPost (file_base64) — endpoint เดียวกับฝั่งผู้รับเหมา

  /** ดึงสัญญาเจ้าบ้าน + งวด + สลิป + ไฟล์สัญญา ของโปรเจกต์ปัจจุบัน */
  getClientFinance: function() {
    return this.callRead('get_client_finance');
  },

  /**
   * สร้างสัญญาเจ้าบ้าน (party='client' — ไม่ต้องมี team_id)
   * @param {object} data - { title, value, sign_date?, contract_no?, tax_pct?, notes? }
   */
  createClientContract: function(data) {
    return this.callRead('create_contract', Object.assign({ party: 'client' }, data));
  },

  /** แก้ไขสัญญา (เจ้าบ้าน/ผู้รับเหมาใช้ร่วมกัน) */
  updateContract: function(data) {
    return this.callRead('update_contract', data);
  },

  /**
   * เพิ่มงวดการชำระ (ผูก contract_id)
   * @param {object} data - { contract_id (req), seq, name, condition?, pct?, amount?, status? }
   */
  createMilestone: function(data) {
    return this.callRead('create_milestone', data);
  },

  /**
   * อัปเดตงวด (สถานะ/จำนวนที่รับ/วันที่)
   * @param {object} data - { milestone_id (req), contract_id?, status?, paid_amount?, paid_date?, ... }
   */
  updateMilestone: function(data) {
    return this.callRead('update_milestone', data);
  },

  /**
   * แนบสลิป/หลักฐานการรับเงิน (รูป/PDF) — reuse endpoint ฝั่งผู้รับเหมา
   * @param {object} data - { milestone_id (req), contract_id, file_base64, file_name }
   */
  uploadPaymentSlip: function(data) {
    return this.callPost('upload_payment_slip', data);
  },

  /** ลบสลิป/หลักฐาน */
  deletePaymentSlip: function(slipId) {
    return this.callRead('delete_payment_slip', { slip_id: slipId });
  },

  /**
   * อัปโหลดไฟล์สัญญา (PDF/รูป) — reuse endpoint ฝั่งผู้รับเหมา
   * @param {object} data - { contract_id (req), file_base64, file_name }
   */
  uploadContractFile: function(data) {
    return this.callPost('upload_contract_file', data);
  },

  /** ลบไฟล์สัญญา */
  deleteContractFile: function(fileId) {
    return this.callRead('delete_contract_file', { file_id: fileId });
  },

  /** ตั้งราคาวัสดุหลายตัวพร้อมกัน — priceMap = {mat_id: price} */
  updateMaterialPrices: function(priceMap) {
    return this.callRead('update_material_prices', { prices: JSON.stringify(priceMap || {}) });
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
  // 🖼️ GALLERY — คลังรูปภาพรวมของโครงการ (ทำงานบน BACKEND==='cf')
  // ============================================================
  // รวมรูปจาก 4 แหล่ง (รายงานประจำวัน / เช็คอิน / หลักฐานงาน / QC) ให้รูปแบบเดียวกัน
  // project_id แนบอัตโนมัติจาก state.projectId ผ่าน _injectProjectId

  /**
   * ดึงรูปทั้งหมดของโครงการ
   * @param {object} params - { source?:'all'|'daily'|'checkin'|'task'|'qc',
   *                            from?, to? ('YYYY-MM-DD'), ff_code?, q?, limit? }
   * Returns: { ok:true, data:{ items:[{id,source,url,date,time,title,detail,
   *                                    ff_code,by,ref_id,legacy}], counts:{...} } }
   */
  getGallery: function(params) {
    return this.callRead('get_gallery', params || {});
  },

  /**
   * ย้ายรูปเก่าจาก Google Drive → R2 ทีละชุด (owner/admin เท่านั้น · ทำครั้งเดียวตอน migrate)
   * @param {object} params - { limit?:1-40 (default 15), dry_run?:true }
   */
  migrateDrivePhotos: function(params) {
    return this.callPost('migrate_drive_photos', params || {});
  },

  // ============================================================
  // 📣 CONTENT PIPELINE — ท่อคอนเทนต์ สถานี 2-4 (คัด / เขียน / เคาะ)
  // ============================================================
  // กลยุทธ์ DSTR-MKT-2569-002 · วัตถุดิบมาจาก Daily Log ที่โฟร์แมนทำอยู่แล้ว
  // ⚠️ AI ทำงานเมื่อกดปุ่มเท่านั้น — generateContent/rerollContent มีค่าใช้จ่ายทุกครั้งที่เรียก

  /**
   * วัตถุดิบที่ยังไม่เคยถูกหยิบไปทำคอนเทนต์
   * @param {object} params - { source?:'all'|'daily'|'task'|'checkin'|'qc', from?, to?, ff_code?, q? }
   * Returns: { blocked (true=ยังไม่ติ๊กยินยอมใช้ภาพ), items:[...], total, counts }
   */
  getContentCandidates: function(params) {
    return this.callRead('get_content_candidates', params || {});
  },

  /**
   * ให้ AI เขียนแคปชั่นจากวัตถุดิบที่เลือก (ครั้งละไม่เกิน 10 ชิ้น)
   * @param {object} data - { items:[...], style:'behind'|'educate'|'showcase'|'pro'|'developer', platform:'fb'|'ig'|'tiktok'|'line' }
   */
  generateContent: function(data) {
    return this.callPost('generate_content', Object.assign({}, data, { items: JSON.stringify(data.items || []) }));
  },

  /** คิวคอนเทนต์ — { status?:'draft'|'approved'|'scheduled'|'posted'|'rejected' } */
  listContent: function(params) {
    return this.callRead('list_content', params || {});
  },

  /** เคาะ/แก้ — { content_id, status?, caption?, hashtags?, platform?, scheduled_at?, notes? } */
  updateContent: function(data) {
    return this.callPost('update_content', data);
  },

  /** กดรีเขียนใหม่ + สอนระบบ — { content_id, note (คำสั่งที่จะถูกจำไว้ใช้ครั้งต่อไป), style?, platform? } */
  rerollContent: function(data) {
    return this.callPost('reroll_content', data);
  },

  /** คู่มือเสียงแบรนด์ที่สะสมจากการกดรี */
  getBrandVoice: function() {
    return this.callRead('get_brand_voice');
  },

  /** ติ๊กยินยอมใช้ภาพของโครงการ (owner/pm) — { consent:true|false } */
  setPhotoConsent: function(consent) {
    return this.callPost('set_photo_consent', { consent: !!consent });
  },

  /** ถังสำรอง + สัดส่วนสไตล์ + สถานะยินยอมใช้ภาพ */
  contentStats: function() {
    return this.callRead('content_stats');
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
  // ⏰ CHECK-IN / TIMESHEET — ลงเวลาหน้างาน (ดู checkin.gs)
  // ============================================================
  // mutation ใช้ callRead (JSONP GET) ตามบทเรียน callwrite-loses-post-body
  // รูปแนบ: เรียก uploadLogPhoto ก่อน (callUpload) → ได้ url → ส่งใน createCheckin

  /**
   * บันทึกเช็คอิน 1 ครั้ง
   * @param {object} data - { staff_name (req), staff_id?, role?, lat?, lng?,
   *   location_type ('onsite'|'offsite'), off_site_reason?, activity?, ff_code?, note?, photo_url? }
   */
  createCheckin: function(data) {
    return this.callRead('create_checkin', data);
  },

  /** อ่านเช็คอิน (scope project) — { staff_id?, staff_name?, date?, from?, to? } */
  getCheckins: function(params) {
    return this.callRead('get_checkins', params || {});
  },

  /** ลบเช็คอิน (กดผิด/ทดสอบ) — by checkin_id */
  deleteCheckin: function(checkinId) {
    return this.callRead('delete_checkin', { checkin_id: checkinId });
  },

  /** ใบลงเวลา รวมต่อคน→ต่อวัน→3 รอบ — { from, to, staff_id?, staff_name? } */
  getTimesheet: function(params) {
    return this.callRead('get_timesheet', params || {});
  },

  /** HR: ใบลงเวลาทุกคน ทุกไซต์ (สิทธิ์ ATTEND) — { from, to, project_id? } */
  getAttendanceAll: function(params) {
    return this.callRead('get_attendance_all', params || {});
  },

  /** HR: แก้เช็คอินที่ลงผิดคน — { checkin_id, staff_name?, staff_id?, role? } */
  updateCheckin: function(data) {
    return this.callRead('update_checkin', data);
  },

  /** HR: บันทึกเลขบัตรประชาชนพนักงาน — { staff_name, national_id } */
  setIdCard: function(data) {
    return this.callRead('set_id_card', data);
  },

  /** พิกัดไซต์ของโครงการ (configured?, site_lat, site_lng, radius_m, windows) */
  getSiteLocation: function() {
    return this.callRead('get_site_location');
  },

  /** ตั้งพิกัดไซต์ — { site_lat, site_lng, radius_m?, updated_by? } */
  setSiteLocation: function(data) {
    return this.callRead('set_site_location', data);
  },

  // ============================================================
  // ✅ QC — Quality Checklist (ฟีเจอร์ใหม่ Session 3 · ทำงานบน BACKEND==='cf' เท่านั้น)
  // ============================================================
  // ตรวจคุณภาพงานเฟอร์นิเจอร์บิวท์อินก่อนส่งมอบ (26 ข้อ หมวด A–I)
  // project_id แนบอัตโนมัติจาก state.projectId ผ่าน _injectProjectId

  /** เกณฑ์มาตรฐาน 26 ข้อ (ไว้สร้างฟอร์มตรวจ) */
  getQcCriteria: function() {
    return this.callRead('get_qc_criteria');
  },

  /** รายการการตรวจของโครงการปัจจุบัน — { ff_code?, status? } */
  getQcInspections: function(params) {
    return this.callRead('get_qc_inspections', params || {});
  },

  /** หัวการตรวจ + ผลรายข้อ — { inspection_id } */
  getQcInspection: function(inspectionId) {
    return this.callRead('get_qc_inspection', { inspection_id: inspectionId });
  },

  /**
   * สร้างการตรวจใหม่ (สร้างหัว + 26 แถวผลจากเกณฑ์ active)
   * @param {object} data - { ff_code, item_name?, location?, maker?, drawing_ref?,
   *                          inspector?, inspect_date?, round?, notes? }
   */
  createQcInspection: function(data) {
    return this.callPost('create_qc_inspection', data);
  },

  /**
   * ติ๊กผลรายข้อ + defect/หมายเหตุ/รูป/ตรวจซ้ำ
   * @param {object} data - { result_id | (inspection_id + criteria_id), result:'pass'|'fail'|'na',
   *                          defect_class?:'C'|'M'|'Mn', note?, photo_url?, fixed_date?, recheck_result? }
   */
  updateQcResult: function(data) {
    return this.callPost('update_qc_result', data);
  },

  /** สรุป + ตั้งสถานะการตรวจ (ผ่าน/ผ่านมีเงื่อนไข/ไม่ผ่าน) — { inspection_id } */
  closeQcInspection: function(inspectionId) {
    return this.callPost('close_qc_inspection', { inspection_id: inspectionId });
  },

  /** ทิ้งการตรวจลงถังขยะ (soft delete — กู้คืนได้ 30 วัน) — { inspection_id } */
  deleteQcInspection: function(inspectionId) {
    return this.callPost('delete_qc_inspection', { inspection_id: inspectionId });
  },

  /** กู้คืนการตรวจจากถังขยะ — { inspection_id } */
  restoreQcInspection: function(inspectionId) {
    return this.callPost('restore_qc_inspection', { inspection_id: inspectionId });
  },

  /** รายการในถังขยะของโครงการ + เหลืออีกกี่วันก่อนลบจริง */
  getQcTrash: function() {
    return this.callRead('get_qc_trash');
  },

  /** สรุป QC ต่อ FF (รอบล่าสุด + defect ค้าง) — เลี้ยงการ์ด dashboard */
  qcSummary: function() {
    return this.callRead('qc_summary');
  },

  // ============================================================
  // 🧭 SITE TOUR — เดินดูหน้างาน 360
  //   สเปก: docs/site-tour-360/TOUR-SPEC.md
  //   จุด+ลูกศร+แผนผัง = ของโครงการ (วางครั้งเดียว) · ภาพ = ของเวอร์ชัน (เกิดใหม่ทุกรอบ)
  // ============================================================

  /** แผนผัง + จุด + ลูกศร + รายการเวอร์ชัน — ก้อนเดียวจบ (ลดจำนวนคำขอบนเน็ตหน้างาน)
   *  includeDraft = true → เอาเวอร์ชันที่ยังถ่ายไม่เสร็จมาด้วย (ใช้ในโหมดถ่าย) */
  tourGetConfig: function(includeDraft) {
    return this.callRead('tour_get_config', { include_draft: includeDraft ? 'true' : '' });
  },

  /** ภาพครบทุกจุดของเวอร์ชันหนึ่ง (เว้นว่าง = เวอร์ชันล่าสุดที่เผยแพร่แล้ว)
   *  จุดที่ยังไม่ถ่าย → หลังบ้านเติมภาพสำรอง "ย้อนหลังเท่านั้น" + ธง fallback_from_version */
  tourGetVersion: function(versionId) {
    return this.callRead('tour_get_version', { version_id: versionId || '' });
  },

  /** อัปแปลนพื้น — { plan_id?, floor_label, image_base64, width, height, sort_order } */
  tourSavePlan: function(data) {
    return this.callUpload('tour_save_plan', data);
  },

  tourDeletePlan: function(planId) {
    return this.callPost('tour_delete_plan', { plan_id: planId });
  },

  /** วาง/แก้จุดถ่าย — { point_id?, name, plan_id, plan_x, plan_y, sort_order } (พิกัด 0..1) */
  tourSavePoint: function(data) {
    return this.callPost('tour_save_point', data);
  },

  /** ทิ้งจุดลงถังขยะ (กู้คืนได้ 30 วัน · ลูกศรที่โยงไว้กลับมาด้วยตอนกู้) */
  tourDeletePoint: function(pointId) {
    return this.callPost('tour_delete_point', { point_id: pointId });
  },

  /** กู้คืนจุดจากถังขยะ */
  tourRestorePoint: function(pointId) {
    return this.callPost('tour_restore_point', { point_id: pointId });
  },

  /** ของในถังขยะของโครงการ (จุด + เวอร์ชัน) + เหลืออีกกี่วันก่อนลบจริง */
  tourGetTrash: function() {
    return this.callRead('tour_get_trash');
  },

  /** ⚠️ ลบถาวรทันที กู้ไม่ได้ — ลบทั้งแถวในฐานข้อมูลและไฟล์รูปใน R2
   *  kind = 'point' | 'version' · ต้องถามยืนยันให้ชัดก่อนเรียก */
  tourPurge: function(kind, id) {
    return this.callPost('tour_purge', { kind: kind, id: id });
  },

  /** วาง/แก้ลูกศรเดิน — { link_id?, from_point, to_point, yaw, pitch, label } */
  tourSaveLink: function(data) {
    return this.callPost('tour_save_link', data);
  },

  tourDeleteLink: function(linkId) {
    return this.callPost('tour_delete_link', { link_id: linkId });
  },

  /** สร้างเวอร์ชันใหม่ (เริ่มที่สถานะ draft — ยังไม่มีใครเห็น) — { name, note, captured_at } */
  tourCreateVersion: function(data) {
    return this.callPost('tour_create_version', data);
  },

  /** แก้ชื่อ/วันที่เวอร์ชัน — { version_id, name, note, captured_at } */
  tourUpdateVersion: function(data) {
    return this.callPost('tour_update_version', data);
  },

  /** เผยแพร่ให้ทีมเห็น (ประทับวันที่ + ลงบันทึกกิจกรรม) */
  tourPublishVersion: function(versionId) {
    return this.callPost('tour_publish_version', { version_id: versionId });
  },

  /** ทิ้งเวอร์ชันลงถังขยะ (กู้คืนได้ 30 วัน) */
  tourDeleteVersion: function(versionId) {
    return this.callPost('tour_delete_version', { version_id: versionId });
  },

  tourRestoreVersion: function(versionId) {
    return this.callPost('tour_restore_version', { version_id: versionId });
  },

  /** อัปภาพเข้าจุด × เวอร์ชัน — { version_id, point_id, image_base64, width, height, taken_at }
   *  ระบบเดาชนิดภาพ (360 เต็มใบ / พาโน / รูปธรรมดา) จากสัดส่วนให้เอง
   *  ถ่ายทับของเดิม = ของเก่าลงถังขยะ ไม่ได้หายไปไหน */
  tourUploadShot: function(data) {
    return this.callUpload('tour_upload_shot', data);
  },

  /** ปรับค่าภาพหลังอัป — { shot_id, yaw_offset, kind, haov, vaov } (แก้ตอนระบบเดาผิด/ภาพหันเบี้ยว) */
  tourUpdateShot: function(data) {
    return this.callPost('tour_update_shot', data);
  },

  tourDeleteShot: function(shotId) {
    return this.callPost('tour_delete_shot', { shot_id: shotId });
  },

  /** ปักหมุดคอมเมนต์บนภาพ — { pin_id?, point_id, version_id, yaw, pitch, kind, ref_id, text }
   *  ⚠️ ห้ามเรียกตอนกำลังดูภาพสำรอง (หมุดจะไม่รู้ว่าเป็นของเวอร์ชันไหน) */
  tourSavePin: function(data) {
    return this.callPost('tour_save_pin', data);
  },

  tourDeletePin: function(pinId) {
    return this.callPost('tour_delete_pin', { pin_id: pinId });
  },

  tourResolvePin: function(pinId, resolved) {
    return this.callPost('tour_resolve_pin', { pin_id: pinId, resolved: resolved ? 'true' : 'false' });
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

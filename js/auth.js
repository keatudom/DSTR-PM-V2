// ============================================================
// auth.js — ระบบเข้าสู่ระบบ (v2 — ปลอดภัยขึ้น)
// รหัสผ่านตรวจสอบที่ Apps Script (server) ไม่เก็บใน config.js
// ============================================================

const Auth = {
  // ─────────────────────────────────────────────
  // เข้าสู่ระบบ — ส่งรหัสไปตรวจที่ Apps Script
  // ใช้แบบ async: const res = await Auth.login(password)
  // ไม่ต้องระบุ role — server จะบอกเองว่าเป็น admin/client
  // ─────────────────────────────────────────────
  async login(password) {
    if (!password || !password.trim()) {
      return { ok: false, error: 'กรุณาใส่รหัสผ่าน' };
    }
    try {
      const res = await API.callRead('login', { password: password.trim() });

      // Apps Script คืน { role, authenticated } หรือ { ok:false, error }
      const data = res.data || res;
      if (data && data.authenticated && data.role) {
        const session = {
          role: data.role,
          loginAt: Date.now(),
          expiresAt: Date.now() + CONFIG.SESSION_DURATION
        };
        localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
        return { ok: true, role: data.role };
      }
      return { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' };
    } catch (err) {
      return { ok: false, error: 'เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง' };
    }
  },

  // ─────────────────────────────────────────────
  // Phase G: เข้าสู่ระบบด้วย Google — ส่ง id_token ไป verify ที่ server
  // server จับคู่อีเมลกับ 24_Staff → คืน token (บัตรผ่าน) + บทบาท
  // ใช้: const res = await Auth.loginGoogle(idToken)
  // ─────────────────────────────────────────────
  async loginGoogle(idToken) {
    if (!idToken) return { ok: false, error: 'ไม่ได้รับข้อมูลจาก Google' };
    try {
      const res = await API.callPost('login_google', { id_token: idToken });
      const data = res.data || res;
      if (data && data.authorized && data.token) {
        const session = {
          role: data.user.role,
          token: data.token,
          name: data.user.name,
          email: data.user.email,
          staff_id: data.user.staff_id,
          loginAt: Date.now(),
          expiresAt: Date.now() + CONFIG.SESSION_DURATION
        };
        localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
        return { ok: true, role: data.user.role, user: data.user };
      }
      // ไม่ได้รับอนุญาต (อีเมลยังไม่อยู่ในรายชื่อ)
      return {
        ok: false,
        notAuthorized: true,
        email: (data && data.email) || '',
        error: (data && data.message) || 'อีเมลนี้ยังไม่ได้รับอนุญาต'
      };
    } catch (err) {
      return { ok: false, error: 'เชื่อมต่อไม่สำเร็จ — ลองใหม่อีกครั้ง' };
    }
  },

  // ดึง token (บัตรผ่าน) สำหรับแนบไปกับทุก API call
  getToken() {
    const s = this.getSession();
    return s && s.token ? s.token : null;
  },

  // ข้อมูลผู้ใช้ที่ login อยู่ (จาก session)
  getUser() {
    const s = this.getSession();
    if (!s) return null;
    return { name: s.name || '', email: s.email || '', role: s.role || '', staff_id: s.staff_id || '' };
  },

  // ออกจากระบบ
  logout() {
    localStorage.removeItem(CONFIG.SESSION_KEY);
    window.location.href = 'index.html';
  },

  // ดึง session ปัจจุบัน
  getSession() {
    try {
      const raw = localStorage.getItem(CONFIG.SESSION_KEY);
      if (!raw) return null;
      const session = JSON.parse(raw);
      if (Date.now() > session.expiresAt) {
        localStorage.removeItem(CONFIG.SESSION_KEY);
        return null;
      }
      return session;
    } catch (e) {
      return null;
    }
  },

  // ตรวจสอบว่า login อยู่หรือไม่
  isLoggedIn() {
    return this.getSession() !== null;
  },

  // ตรวจสอบบทบาท
  getRole() {
    const session = this.getSession();
    return session ? session.role : null;
  },

  // ป้องกันหน้าที่ไม่ได้ login
  requireAuth(requiredRole) {
    const session = this.getSession();
    if (!session) {
      window.location.href = 'index.html';
      return false;
    }
    if (requiredRole) {
      // Phase G: 'admin' = หน้าฝั่งทีมงาน (internal) → อนุญาตทุกบทบาทยกเว้น client
      //          (owner/pm/foreman/contractor/purchaser/admin เข้าได้)
      //          'client' = หน้าลูกค้า → เฉพาะ client
      const ok = (requiredRole === 'admin')
        ? (session.role !== 'client')
        : (session.role === requiredRole);
      if (!ok) {
        alert('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
        window.location.href = 'index.html';
        return false;
      }
    }
    return true;
  },

  // เป็นทีมงาน (ภายใน) ไหม — ทุกบทบาทยกเว้น client
  isStaff() {
    const s = this.getSession();
    return !!(s && s.role && s.role !== 'client');
  }
};

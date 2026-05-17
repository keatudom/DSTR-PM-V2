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
    if (requiredRole && session.role !== requiredRole) {
      alert('คุณไม่มีสิทธิ์เข้าถึงหน้านี้');
      window.location.href = 'index.html';
      return false;
    }
    return true;
  }
};

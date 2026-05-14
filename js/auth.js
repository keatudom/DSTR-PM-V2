// ============================================================
// auth.js — ระบบเข้าสู่ระบบ
// ใช้ localStorage เก็บ session 7 วัน
// ============================================================

const Auth = {
  // ตรวจสอบรหัสผ่าน
  login(role, password) {
    const correctPwd = CONFIG.PASSWORDS[role];
    if (!correctPwd) return { ok: false, error: 'บทบาทไม่ถูกต้อง' };
    if (password !== correctPwd) return { ok: false, error: 'รหัสผ่านไม่ถูกต้อง' };

    // บันทึก session
    const session = {
      role: role,
      loginAt: Date.now(),
      expiresAt: Date.now() + CONFIG.SESSION_DURATION
    };
    localStorage.setItem(CONFIG.SESSION_KEY, JSON.stringify(session));
    return { ok: true, role: role };
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

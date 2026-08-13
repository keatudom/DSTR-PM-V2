// ============================================================
// shell.js — เปลือกร่วม V3 (sidebar + topbar + bottom nav)
// ------------------------------------------------------------
// สร้างเมนู/หัวบาร์ให้ทุกหน้า V3 จากที่เดียว — แก้เมนูจุดเดียว มีผลทุกหน้า
// ใช้:
//   <div class="app-container">
//     <main class="main-content">
//       <div class="page-content"> ...เนื้อหาเฉพาะหน้า... </div>
//     </main>
//   </div>
//   <script>Shell.render({ page:'daily', title:'รายงานประจำวัน', scope:'project' });</script>
//
// - projectId อ่านจาก ?project= ใน URL เอง (ไม่พึ่ง state.js เพราะบางหน้าไม่โหลด)
// - user อ่านจาก Auth.getUser() (auth.js) — ถ้าไม่มีก็ยังวาดได้ (โชว์ '—')
// - ปิดท้ายเรียก lucide.createIcons() ให้เอง
// ============================================================

const Shell = {
  // ── projectId จาก URL (default 'bow-house' = legacy scope เดิม) ──
  projectId() {
    try {
      const p = new URL(window.location.href).searchParams.get('project');
      return p || 'bow-house';
    } catch (e) { return 'bow-house'; }
  },

  // แนบ ?project= ให้ลิงก์ที่อยู่ใน scope โปรเจกต์
  _withPid(href) {
    const pid = this.projectId();
    return href + (href.indexOf('?') >= 0 ? '&' : '?') + 'project=' + encodeURIComponent(pid);
  },

  // ── นิยามเมนู ──────────────────────────────────────────
  // scope 'global'  = เมนูระดับบน (ข้ามโครงการ / ระบบ)
  // scope 'project' = เมนูภายใน 1 โครงการ (แนบ ?project= อัตโนมัติ)
  //
  // ⚠️ กติกาที่เจ้าของงานเคาะ 2026-08-13 (หลังเจอปัญหา "ปุ่มสลับที่ / หน้าเดียวมี 2 ชื่อ"):
  //   1. **1 หน้า = 1 ชื่อ** — `label` (เมนูข้าง) กับ `short` (แถบล่างมือถือ) มาจาก item เดียวกัน
  //      ห้ามนิยามแถบล่างเป็น list แยก ไม่งั้นชื่อ/ไอคอนจะ drift กัน (เคยเป็น: dashboard =
  //      "งาน" ในโครงการ แต่ = "หน้าหลัก" ในหน้าเช็คอิน)
  //   2. **ห้ามใช้คำว่า "ภาพรวม" เป็นชื่อเมนู** — ชนกับแท็บ "ภาพรวม" ในหน้าโครงการ
  //      (ผู้ใช้กดแล้วเด้งออกไปหน้าเลือกโครงการโดยไม่ตั้งใจ) → ใช้ "โครงการ" แทน
  //   3. **เช็คอินอยู่ในเมนูโครงการเท่านั้น** — เช็คอินต้องรู้ว่าไซต์ไหน ถ้าเข้าจากเมนูระดับบน
  //      จะไม่มี ?project= แล้วตกไป default 'bow-house' = ลงเวลาผิดโครงการทั้งบริษัท
  NAV: {
    global: [
      { section: 'เมนูหลัก' },
      { key: 'projects', label: 'โครงการทั้งหมด', short: 'โครงการ', icon: 'layout-dashboard', href: 'projects.html' },
      { section: 'การจัดการ' },
      { key: 'users',    label: 'ผู้ใช้งาน',      short: 'ผู้ใช้',   icon: 'users',   href: 'users.html' },
      { key: 'hr',       label: 'พนักงาน (HR)',   short: 'พนักงาน',  icon: 'contact', href: 'hr.html' },
      { section: 'ระบบ' },
      { key: 'help',     label: 'ช่วยเหลือและวิธีใช้', short: 'ช่วยเหลือ', icon: 'help-circle', href: 'help.html' },
    ],
    project: [
      { key: 'back',      label: 'กลับรายการโครงการ', icon: 'arrow-left', href: 'projects.html', global: true },
      { section: 'เมนูโครงการ' },
      { key: 'dashboard', label: 'รายการงาน (FF)',    short: 'งาน',    icon: 'list-todo',       href: 'dashboard.html' },
      { key: 'daily',     label: 'รายงานประจำวัน',     short: 'รายวัน', icon: 'activity',        href: 'daily.html' },
      { key: 'checkin',   label: 'เช็คอิน / ลงเวลา',   short: 'ลงเวลา', icon: 'map-pin',         href: 'checkin.html' },
      { key: 'materials', label: 'วัสดุ / เบิกจ่าย',   short: 'วัสดุ',  icon: 'package',         href: 'materials.html' },
      { key: 'team',      label: 'ทีม / ผู้รับเหมา',    short: 'ทีม',    icon: 'users',           href: 'team.html' },
      { key: 'qc',        label: 'ตรวจสอบคุณภาพ (QC)',  short: 'QC',     icon: 'clipboard-check', href: 'qc.html' },
      { key: 'gallery',   label: 'คลังรูปภาพ',         short: 'รูป',    icon: 'images',          href: 'gallery.html' },
      { key: 'client',    label: 'มุมมองลูกค้า',       short: 'ลูกค้า', icon: 'eye',             href: 'client.html' },
    ],
  },

  // ── แถบล่างมือถือ: เลือก "คีย์" จาก NAV ชุดเดียวกัน (≤5 ปุ่ม) ──
  // เก็บแค่ลำดับคีย์ → ชื่อ/ไอคอน/ลิงก์มาจาก NAV เสมอ = ไม่มีทาง drift
  //
  // ⚠️ 'projects' ต้องเป็น **ปุ่มซ้ายสุดของทั้งสอง scope** — เป็นปุ่ม "ขึ้นไปข้างบน/หน้าแรก"
  //    เดิมมันอยู่ซ้ายสุดตอนอยู่นอกโครงการ แต่เด้งไปขวาสุดตอนเข้าโครงการ → นิ้วจำตำแหน่งไม่ได้
  //    (เจ้าของงานแจ้งเอง 2026-08-13 ว่า "ปุ่มมันสลับกัน")
  BOTTOM_KEYS: {
    global:  ['projects', 'users', 'hr', 'help'],
    // ช่างใช้ 4 อย่างนี้ทุกวัน: ดูงาน → ลงเวลา → บันทึกงาน → เบิกของ
    // (ทีม/QC/รูป/ลูกค้า ยังอยู่ในเมนูข้าง — แถบล่างจำกัด 5 ปุ่มไม่งั้นนิ้วชนกัน)
    project: ['projects', 'dashboard', 'checkin', 'daily', 'materials'],
  },

  // หา item จาก key (ข้าม section header) — bottom nav ใช้ดึงชื่อ/ไอคอนจาก NAV
  _item(scope, key) {
    const inScope = (this.NAV[scope] || []).find((i) => i.key === key);
    if (inScope) return inScope;
    // 'projects' อยู่ใน NAV.global — scope project ยืมมาใช้เป็นปุ่มออกจากโครงการ
    const g = this.NAV.global.find((i) => i.key === key);
    return g ? Object.assign({}, g, { global: true }) : null;
  },

  _href(item) {
    // item.global = ลิงก์ระดับบน ไม่ต้องแนบ project; นอกนั้นถ้าอยู่ scope project ให้แนบ
    if (item.global || this._scope === 'global') return item.href;
    return this._withPid(item.href);
  },

  _initials(name) {
    if (!name) return '—';
    const parts = String(name).trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2);
    return (parts[0][0] || '') + (parts[1][0] || '');
  },

  // ── สร้าง sidebar ──────────────────────────────────────
  _buildSidebar() {
    const items = this.NAV[this._scope] || this.NAV.global;
    let html = '<div class="sidebar-header"><div class="brand-logo"><i data-lucide="building-2"></i> DSTR</div></div>';
    html += '<nav class="sidebar-nav">';
    items.forEach((it) => {
      if (it.section) { html += `<div class="nav-section-label">${it.section}</div>`; return; }
      const active = it.key === this._page ? ' active' : '';
      html += `<a href="${this._href(it)}" class="nav-item${active}"><i data-lucide="${it.icon}"></i> ${it.label}</a>`;
    });
    html += '</nav>';
    const aside = document.createElement('aside');
    aside.className = 'sidebar';
    aside.id = 'appSidebar';
    aside.innerHTML = html;
    return aside;
  },

  // ── สร้าง topbar ───────────────────────────────────────
  _buildTopbar() {
    const u = (typeof Auth !== 'undefined' && Auth.getUser) ? (Auth.getUser() || {}) : {};
    const name = u.name || '—';
    const roleTh = { owner: 'เจ้าของ', admin: 'แอดมิน', pm: 'ผู้จัดการโครงการ', foreman: 'โฟร์แมน', client: 'ลูกค้า' }[u.role] || (u.role || '');
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `
      <div class="topbar-left">
        <button class="menu-toggle" id="shellMenuToggle" aria-label="เมนู"><i data-lucide="menu"></i></button>
        <h1 class="page-title">${this._title || ''}</h1>
      </div>
      <div class="topbar-actions">
        <button class="btn btn-ghost btn-icon hide-mobile" id="shellBell" aria-label="แจ้งเตือน"><i data-lucide="bell"></i></button>
        <div class="user-profile" id="shellUser">
          <div class="avatar" style="background:var(--color-blue-100);color:var(--color-blue-700);">${this._initials(name)}</div>
          <div class="hide-mobile" style="display:flex;flex-direction:column;align-items:flex-start;line-height:1.2;">
            <span style="font-size:var(--text-sm);font-weight:600;">${name}</span>
            <span style="font-size:var(--text-xs);color:var(--color-slate-500);">${roleTh}</span>
          </div>
          <i data-lucide="chevron-down" class="hide-mobile" style="width:16px;color:var(--color-slate-400);"></i>
        </div>
      </div>`;
    return header;
  },

  // ── สร้าง bottom nav ───────────────────────────────────
  _buildBottomNav() {
    const keys = this.BOTTOM_KEYS[this._scope] || this.BOTTOM_KEYS.global;
    let html = '';
    keys.forEach((k) => {
      const it = this._item(this._scope, k);
      if (!it) return;
      const active = it.key === this._page ? ' active' : '';
      // ชื่อบนแถบล่างใช้ short (สั้นให้พอดีปุ่ม) แต่ถ้าไม่ได้ตั้งไว้ก็ใช้ label เดียวกับเมนูข้าง
      html += `<a href="${this._href(it)}" class="bottom-nav-item${active}"><i data-lucide="${it.icon}"></i><span>${it.short || it.label}</span></a>`;
    });
    const nav = document.createElement('nav');
    nav.className = 'bottom-nav';
    nav.innerHTML = html;
    return nav;
  },

  // ── โปรไฟล์ dropdown (ออกจากระบบ) ──────────────────────
  _toggleUserMenu() {
    let menu = document.getElementById('shellUserMenu');
    if (menu) { menu.remove(); return; }
    menu = document.createElement('div');
    menu.id = 'shellUserMenu';
    menu.style.cssText = 'position:fixed;top:56px;right:var(--space-6);background:#fff;border:1px solid var(--color-slate-200);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);padding:var(--space-1);z-index:var(--z-modal);min-width:180px;';
    menu.innerHTML = `
      <a href="help.html" class="nav-item"><i data-lucide="help-circle"></i> ช่วยเหลือ</a>
      <button class="nav-item" id="shellLogout" style="width:100%;color:var(--color-error-700);"><i data-lucide="log-out"></i> ออกจากระบบ</button>`;
    document.body.appendChild(menu);
    if (window.lucide) lucide.createIcons();
    document.getElementById('shellLogout').onclick = () => {
      if (typeof Auth !== 'undefined' && Auth.logout) Auth.logout();
      window.location.href = 'index.html';
    };
    // คลิกที่อื่น = ปิด
    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!menu.contains(e.target) && e.target.closest('#shellUser') === null) {
          menu.remove(); document.removeEventListener('click', h);
        }
      });
    }, 0);
  },

  // ── drawer มือถือ ──────────────────────────────────────
  _wireDrawer() {
    const sidebar = document.getElementById('appSidebar');
    const backdrop = document.getElementById('shellDrawerBackdrop');
    const open = () => { sidebar.classList.add('open'); backdrop.classList.add('show'); };
    const close = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };
    const toggle = document.getElementById('shellMenuToggle');
    if (toggle) toggle.onclick = open;
    if (backdrop) backdrop.onclick = close;
    // แตะลิงก์ในเมนูแล้วปิด drawer (มือถือ)
    sidebar.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', close));
  },

  // ── main ───────────────────────────────────────────────
  // ── แถบล่างอย่างเดียว (ไม่มี sidebar/topbar) ──────────────
  // ใช้กับหน้าที่โครงหน้าเป็นของตัวเอง ไม่ได้ใช้ .app-container — ตอนนี้คือ checkin.html
  // (หน้าเช็คอินเป็น PWA เต็มจอสำหรับช่าง เลยไม่ยัด sidebar เข้าไป)
  // สำคัญ: ยังดึงชื่อ/ไอคอน/ลิงก์จาก NAV ชุดเดียวกัน → ปุ่มตรงกับหน้าอื่นเป๊ะ ไม่ drift
  renderBottomNavOnly(opts) {
    opts = opts || {};
    this._page = opts.page || '';
    this._scope = opts.scope === 'project' ? 'project' : 'global';
    document.body.appendChild(this._buildBottomNav());
    // แถบล่างเป็น position:fixed — ถ้าไม่เว้นที่ให้ มันจะทับเนื้อหาบรรทัดสุดท้าย
    // (หน้าพวกนี้ไม่ได้ใช้ .page-content ที่มี padding เผื่อไว้แล้ว)
    document.body.classList.add('has-bottom-nav');
    if (window.lucide) lucide.createIcons();
  },

  render(opts) {
    opts = opts || {};
    this._page = opts.page || '';
    this._title = opts.title || document.title || '';
    this._scope = opts.scope === 'project' ? 'project' : 'global';

    const container = document.querySelector('.app-container');
    const main = document.querySelector('.main-content');
    if (!container || !main) {
      console.error('[Shell] ต้องมี .app-container > .main-content ในหน้า');
      return;
    }

    // sidebar (หัว container)
    container.insertBefore(this._buildSidebar(), container.firstChild);
    // topbar (หัว main-content)
    main.insertBefore(this._buildTopbar(), main.firstChild);
    // bottom nav + drawer backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'drawer-backdrop';
    backdrop.id = 'shellDrawerBackdrop';
    container.appendChild(backdrop);
    container.appendChild(this._buildBottomNav());

    // wire
    this._wireDrawer();
    const userEl = document.getElementById('shellUser');
    if (userEl) userEl.onclick = () => this._toggleUserMenu();

    // ตั้งชื่อแท็บให้ตรง
    if (opts.title) document.title = opts.title + ' — DSTR PM';

    if (window.lucide) lucide.createIcons();
  },
};

if (typeof window !== 'undefined') window.Shell = Shell;

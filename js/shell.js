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
  // scope 'global'  = เมนูระดับบน (ภาพรวมหลายโครงการ / ระบบ)
  // scope 'project' = เมนูภายใน 1 โครงการ (แนบ ?project= อัตโนมัติ)
  NAV: {
    global: [
      { section: 'เมนูหลัก' },
      { key: 'projects', label: 'ภาพรวมโครงการ', icon: 'layout-dashboard', href: 'projects.html' },
      { key: 'checkin',  label: 'เช็คอิน / ลงเวลา', icon: 'map-pin',         href: 'checkin.html' },
      { section: 'การจัดการ' },
      { key: 'users',    label: 'ผู้ใช้งาน',        icon: 'users',           href: 'users.html' },
      { key: 'hr',       label: 'พนักงาน (HR)',     icon: 'contact',         href: 'hr.html' },
      { section: 'ระบบ' },
      { key: 'help',     label: 'ช่วยเหลือและวิธีใช้', icon: 'help-circle',   href: 'help.html' },
    ],
    project: [
      { key: 'back',     label: 'กลับภาพรวมโครงการ', icon: 'arrow-left',      href: 'projects.html', global: true },
      { section: 'เมนูโครงการ' },
      { key: 'dashboard', label: 'รายการงาน (FF)',   icon: 'list-todo',       href: 'dashboard.html' },
      { key: 'daily',     label: 'รายงานประจำวัน',    icon: 'activity',        href: 'daily.html' },
      { key: 'materials', label: 'วัสดุ / เบิกจ่าย',  icon: 'package',         href: 'materials.html' },
      { key: 'team',      label: 'ทีม / ผู้รับเหมา',   icon: 'users',           href: 'team.html' },
      { key: 'qc',        label: 'ตรวจสอบคุณภาพ (QC)', icon: 'clipboard-check', href: 'qc.html' },
      { key: 'client',    label: 'มุมมองลูกค้า',      icon: 'eye',             href: 'client.html' },
    ],
  },

  // bottom nav มือถือ (≤5 ปุ่ม) แยกตาม scope
  BOTTOM: {
    global: [
      { key: 'projects', label: 'ภาพรวม',   icon: 'layout-dashboard', href: 'projects.html' },
      { key: 'checkin',  label: 'เช็คอิน',  icon: 'map-pin',          href: 'checkin.html' },
      { key: 'users',    label: 'ผู้ใช้',   icon: 'users',            href: 'users.html' },
      { key: 'help',     label: 'ช่วยเหลือ', icon: 'help-circle',     href: 'help.html' },
    ],
    project: [
      { key: 'dashboard', label: 'งาน',    icon: 'list-todo', href: 'dashboard.html' },
      { key: 'daily',     label: 'รายวัน', icon: 'activity',  href: 'daily.html' },
      { key: 'materials', label: 'วัสดุ',  icon: 'package',   href: 'materials.html' },
      { key: 'team',      label: 'ทีม',    icon: 'users',     href: 'team.html' },
      { key: 'projects',  label: 'ภาพรวม', icon: 'grid-3x3',  href: 'projects.html', global: true },
    ],
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
    const items = this.BOTTOM[this._scope] || this.BOTTOM.global;
    let html = '';
    items.forEach((it) => {
      const active = it.key === this._page ? ' active' : '';
      html += `<a href="${this._href(it)}" class="bottom-nav-item${active}"><i data-lucide="${it.icon}"></i><span>${it.label}</span></a>`;
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

# DSTR Project Management V2

ระบบติดตามโครงการ บริษัท ดีไซน์ ทีเรีย จำกัด

## คุณสมบัติ
- 🔐 Login system (Admin / Client)
- 📊 Weight-based Progress (% ตามมูลค่า)
- 📋 Multi-project ready
- 🎯 Donut Chart + Forecast
- ✏️ Quick Daily Report (กำลังพัฒนา)
- 🤖 AI Summary (กำลังพัฒนา)

## โครงสร้าง
```
DSTR-PM-V2/
├── index.html          ← Login
├── projects.html       ← เลือกโปรเจกต์
├── dashboard.html      ← Admin Dashboard
├── client.html         ← Client View
├── css/
│   └── main.css
├── js/
│   ├── config.js       ← ตั้งค่า URL, รหัสผ่าน
│   ├── auth.js         ← ระบบ Login
│   ├── api.js          ← เชื่อม Apps Script
│   ├── state.js        ← คำนวณ Weight-based
│   └── modal.js        ← Popup system
└── apps-script/
    └── Code.gs         ← Backend
```

## รหัสผ่าน (เปลี่ยนใน `js/config.js`)
- **Admin:** `DSTR-ADMIN-2026`
- **Client:** `BOW-CLIENT-2026`

## Tech Stack
- Frontend: HTML + CSS + Vanilla JS
- Backend: Google Apps Script
- Database: Google Sheets
- Hosting: GitHub Pages

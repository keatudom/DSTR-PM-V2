# DSTR Project Management V2

ระบบบริหารงานบิ้วอินหน้างาน — บริษัท ดีไซน์ ทีเรีย จำกัด
(PWA ภาษาไทย: รายงานประจำวัน · วัสดุ/สต๊อก · เช็คอิน GPS · QC · ทีม/สัญญา · มุมมองลูกค้า · ผู้ช่วย AI)

> 📖 **ระบบทำอะไรได้บ้าง? อ่านที่เดียวจบ → [docs/DSTR-PM-MODULES.md](docs/DSTR-PM-MODULES.md)**
> บัญชีรายการโมดูลทั้งระบบ: 12 โมดูลฟีเจอร์ · backend 13 โมดูล ~135 actions · ฐานข้อมูล 31 ตาราง

## คุณสมบัติเด่น
- 📋 รายการงานบิ้วอิน F-XX + ติ๊กงานย่อย + % คืบหน้าแบบถ่วงน้ำหนักเนื้องาน
- ✏️ รายงานประจำวัน: พิมพ์/พูด → AI แปลงเป็นบันทึก + สรุปให้อัตโนมัติ
- 📦 วัสดุ: รับ/เบิก/นับสต๊อก + สแกนบิลด้วย AI Vision + เตือนเบิกเกิน BOQ
- 📍 เช็คอินหน้างานด้วย GPS + ใบลงเวลา (PWA ติดตั้งบนมือถือ)
- ✅ QC เช็กลิสต์ 26 ข้อ (defect Critical/Major/Minor)
- 🤝 ทีมช่าง + สัญญา + งวดงาน + ประเมินผู้รับเหมา KPI 8 หมวด
- 🏠 มุมมองลูกค้า (read-only ปลอดภัย)
- 🔔 แจ้งเตือน LINE + สรุปรายวัน/รายสัปดาห์
- 🔐 Login ด้วย Google + สิทธิ์รายบทบาท (RBAC)

## โครงสร้าง
```
DSTR-PM-V2/
├── *.html              ← หน้าเว็บ 13 หน้า (projects, dashboard, daily,
│                          materials, checkin, qc, team, client, hr, users …)
├── v3/                 ← UI เวอร์ชันใหม่ (กำลังทยอยย้าย)
├── js/                 ← api.js (ตัวกลาง backend), auth, state, shell …
├── cf-api/             ← Backend: Cloudflare Workers + D1 + R2
├── apps-script/        ← Backend เดิม (Google Apps Script — เก็บเป็น rollback)
└── docs/               ← เอกสาร (module inventory, migration blueprints)
```

## Tech Stack
- Frontend: HTML + CSS + Vanilla JS (PWA) · Hosting: GitHub Pages
- Backend: Cloudflare Workers (Hono/TypeScript)
- Database: Cloudflare D1 (SQLite) · ไฟล์/รูป: R2
- AI: Gemini (ข้อความ/JSON/Vision) · แจ้งเตือน: LINE Messaging API

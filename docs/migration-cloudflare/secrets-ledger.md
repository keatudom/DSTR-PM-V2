# DSTR-CF — Secrets Ledger (Cloudflare migration)

> ย้ายมาจาก Inarch-Ops/secrets-ledger_HUMAN.md เมื่อ 2026-07-18 (เดิมจดผิดบ้าน — DSTR-CF ไม่ใช่ของ Inarch)
> Worker: `dstr-api` บน Cloudflare (account **keatudom456@gmail.com**) · URL `https://dstr-api.keatudom456.workers.dev`
> **ที่เก็บค่าจริง (2 แหล่ง):** (1) Cloudflare Worker secret (เข้ารหัส write-only) · (2) Script Properties เดิมของ Apps Script (ต้นทาง)
> **ไม่เขียนค่าดิบในไฟล์นี้** (ธรรมเนียม prod = ไม่ใส่ repo) · วันเปิดตัวจริง เจ้าของ+พี่ชายหมุนเอง

| secret | ใส่ใน worker แล้ว | ที่มา / หมายเหตุ |
|---|---|---|
| AUTH_SECRET | ✅ | = ค่าเดิม → บัตรผ่าน (token) เก่า verify ผ่าน ไม่ต้อง login ใหม่ (ยืนยันแล้ว) |
| ADMIN_PASSWORD | ✅ | **หมุนใหม่ 2026-07-18** = ค่าชั่วคราวที่เจ้าของเลือกเอง (อ่อน — ไว้ดู v3 บนมือถือเพราะ Google login ไม่ผ่าน) · ⚠️ **ควรหมุนเป็นรหัสแข็งก่อนใช้จริง/เปิดตัว** · login→admin |
| CLIENT_PASSWORD | ✅ | ระบุแบบพิสูจน์ (login→client) |
| GEMINI_API_KEY | ✅ | Google API key (ขึ้นต้น AIza…) — ค่าจริงอยู่ใน Worker secret |
| GEMINI_MODEL | ✅ | gemini-2.5-flash |
| GEMINI_VISION_MODEL | ✅ | gemini-2.5-flash |
| LINE_TOKEN | ✅ | LINE channel access token — ค่าจริงอยู่ใน Worker secret |
| LINE_GROUP_ID | ✅ | **ค่าจริงอยู่ใน Cloudflare Worker secret** (2026-07-15 เจ้าของเคาะ "เอากลุ่มเดียว") — แจ้งเตือนสำคัญ+สรุปเย็น+สรุปสัปดาห์ เข้ากลุ่มนี้ |
| LINE_GROUP_OPS_ID | ⛔ | ปิดตั้งใจ — เจ้าของเอากลุ่มเดียว → สรุปทุก 3 ชม.ไม่ส่ง (เปิดทีหลังได้ ตั้งเป็นค่าเดียวกับ GROUP_ID) |
| LINE_OWNER_UID | ⛔ | ปิดตั้งใจ — DM แจ้งเงิน/สัญญาถึงเจ้าของไม่ส่ง (ดีต่อ privacy: เงินไม่หลุดเข้ากลุ่ม) เปิดทีหลังได้ |

> SHEETS_ID เดิม = ไม่ต้องใช้บน CF (D1 แทน Sheets แล้ว)
> 3 ตัว LINE ค้าง (OPS_ID / OWNER_UID) = จำเป็นตอน Session 2 (cron digest + webhook) เท่านั้น ไม่บล็อก Session 1

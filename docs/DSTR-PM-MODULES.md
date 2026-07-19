# DSTR-PM V2 — บัญชีรายการโมดูลทั้งระบบ (Module Inventory)

> จัดทำ 2026-07-19 · เอกสารแนะนำแพลตฟอร์ม DSTR-PM — ว่ามีโมดูลอะไร อยู่ตรงไหน ทำอะไรได้บ้าง
> แหล่งอ้างอิงลึก: `docs/migration-cloudflare/INVENTORY.md` (149 actions ราย file:line) · `docs/v3-ui-migration/BLUEPRINT.md`

---

## 1. ภาพรวมระบบ (มองจากบนลงมา)

DSTR-PM = ระบบบริหารงานบิ้วอินหน้างาน (**execution layer** — ชั้น "ลงมือทำจริง" ของวิสัยทัศน์ Inarch)
เปรียบเหมือน **สมุดโฟร์แมน + สมุดบัญชี + กล้องถ่ายรูป + ผู้ช่วย AI** รวมในแอปเดียว ใช้จริงกับโครงการ Kun Beau House (bow-house, งาน F-01…F-22)

```
ผู้ใช้ (มือถือ/PWA)
   │
หน้าเว็บ 13 หน้า (GitHub Pages, ไทยล้วน)  ← กำลังยกเครื่อง UI เป็น v3/
   │  js/api.js (ตัวกลางเดียว, สวิตช์ BACKEND: 'cf' | 'gas')
   ▼
Cloudflare Worker (cf-api) — LIVE ตั้งแต่ 2026-07-15
   ├─ 13 โมดูล backend · ~135 actions
   ├─ D1 (ฐานข้อมูล SQLite) — 31 ตาราง
   ├─ R2 (โกดังเก็บไฟล์/รูป — ยังปิด gate รอเปิด)
   ├─ Gemini AI (สรุป/แปลงข้อความ/อ่านบิลจากรูป)
   └─ LINE (แจ้งเตือน + สรุปรายวัน/สัปดาห์ + คำสั่งในกลุ่ม)
```

**Legacy:** Google Apps Script + Sheets ยังอยู่ครบใน `apps-script/` เป็นร่มชูชีพ (rollback = แก้ config 1 บรรทัด) — ของเดิม 149 actions: **ย้ายแล้ว 131 / ทิ้ง 18** (พวกเครื่องมือ migration ครั้งเดียว)

---

## 2. โมดูลเชิงฟีเจอร์ (มุมมองผู้ใช้ — "โมดูลไหน ทำอะไรได้ อยู่ตรงไหน")

> ตารางนี้คือคำตอบหลักของคำถาม "DSTR-PM มีโมดูลอะไรบ้าง" — 12 โมดูล

| # | โมดูล | ทำอะไรได้ (ภาษาคน) | หน้าเว็บ | backend |
|---|---|---|---|---|
| 1 | **Projects** (หลายโครงการ) | การ์ดโครงการ มูลค่า/ลูกค้า/% คืบหน้า · wizard สร้างโครงการ · clone จาก template | `projects.html` | `projects.ts` |
| 2 | **FF & Tasks** (งานหลัก) | รายการชิ้นงานบิ้วอิน F-XX · subtask ติ๊กเสร็จ 3 สถานะ · % คืบหน้าแบบ effort-based (ถ่วงน้ำหนักตามเนื้องาน) · แนบ/ดูรูปงาน · เพิ่ม FF แบบ batch · งวดเบิกช่าง (payments) | `dashboard.html` (หน้าใหญ่สุด 4,375 บรรทัด — เป็น hub กลางด้วย) | `ff_tasks.ts` |
| 3 | **Daily** (รายงานประจำวัน) | พิมพ์/พูดบันทึกกิจกรรม → **AI แปลงเป็น log** + จับช่าง/วัสดุที่ไม่รู้จัก · feed กิจกรรมรายวัน · **นับทีมเข้า-ออกไซต์** (headcount) · แนบรูป · AI แนะนำ "ติ๊กงานนี้เสร็จไหม" · เบิกวัสดุจากข้อความ · **AI สรุปประจำวัน** (save ได้) · สถิติวันนี้ | `daily.html` (2,929 บรรทัด) | `daily.ts` (21 actions — โมดูล AI หนักสุด) |
| 4 | **Materials** (วัสดุ/คงคลัง) | คลังวัสดุ 2 โหมด (นับจำนวน COUNT / สถานะ 0-3 STATUS) · รับเข้า-เบิก-นับสต๊อก · BOQ วางแผน vs เบิกจริง (เตือนเบิกเกิน) · **AI Quick Log** (พิมพ์ → รายการ) · **สแกนบิล AI Vision** (ถ่ายรูปใบส่งของ → รายการรับเข้า) · มูลค่าคงคลัง · AI alerts | `materials.html` (3,404 บรรทัด) | `materials.ts` (21 actions) + `photos.ts` (scan_bill) |
| 5 | **Check-in** (ลงเวลา GPS) | เช็คอิน GPS geofence (ในไซต์/นอกไซต์+เหตุผล) · 3 รอบ/วัน เช้า-กลางวัน-เย็น · แนบรูป · ใบลงเวลา (timesheet) · ตั้งพิกัด+รัศมีไซต์ · PWA ติดตั้งบนมือถือ | `checkin.html` | `checkin.ts` |
| 6 | **HR** (ใบลงเวลารวม) | HR ดูเวลาทุกคนทุกไซต์ · เลขบัตร ปชช. · พิมพ์ใบลงเวลา/เบิกค่าแรง (หัวกระดาษ+ช่องเซ็น) · gate สิทธิ์ ATTEND | `hr.html` | `checkin.ts` (get_attendance_all) |
| 7 | **Team & Finance** (ทีม/สัญญา/เงิน) | ทีมช่าง 28 ประเภท · ผูกทีม/staff เข้าโครงการ · **สัญญา 2 ฝั่ง**: ผู้รับเหมา (เงินออก) + เจ้าบ้าน (เงินเข้า) · งวดงาน milestone · แนบสลิป/ไฟล์สัญญา · แจ้ง LINE เมื่อเงินขยับ | `team.html` + ส่วน Finance ใน `dashboard.html` | `teams_finance.ts` (23 actions) |
| 8 | **Evaluations** (ประเมินผู้รับเหมา) | ประเมิน KPI 8 หมวดถ่วงน้ำหนัก (กำลังคน/คืบหน้า/คุณภาพ/ผ่านรอบแรก/ส่งมอบ/ตอบสนอง/วินัย/การเงิน) · เกรด+จัดอันดับข้ามโครงการ | `team.html` (tab) + `dashboard.html` | `evals.ts` |
| 9 | **Risks** (ความเสี่ยง) | risk register คะแนน โอกาส×ผลกระทบ (L×I 1-5) · ≥12 แจ้ง LINE · clone จาก template "ดิเรก" | `dashboard.html` (section) | `risks.ts` |
| 10 | **QC** (ตรวจคุณภาพ) ⭐ใหม่ cf-only | เช็กลิสต์ 26 ข้อ หมวด A–I · ตรวจรายข้อ pass/fail/na + ระดับ defect C/M/Mn (วิกฤต/หนัก/เบา) · ตรวจซ้ำ (recheck รอบใหม่) · ปิดงาน: มี C=ไม่ผ่าน, M/Mn=ผ่านมีเงื่อนไข | `qc.html` | `qc.ts` |
| 11 | **Client View** (มุมมองเจ้าบ้าน) | read-only โทนอบอุ่น: % คืบหน้า · อัลบั้มรูป (เฉพาะ client_visible) · timeline งวดงาน · งวดชำระ · ติดต่อทีม — **field whitelist กันข้อมูลภายในหลุด** · v3 มีมติใหม่: เจ้าบ้านไม่เห็นเงินเลย เห็น %-รายห้อง (สเปกเสร็จ ยังไม่สร้าง) | `client.html` | `client_view.ts` |
| 12 | **Users & Auth** (ผู้ใช้/สิทธิ์) | login Google (Production แล้ว) + รหัสสำรอง · token HMAC อายุ 30 วัน · **RBAC 10 บทบาท × 9 ขีดความสามารถ** (creator/owner/director/pm/hr/site_engineer/foreman/purchaser/contractor/client) · จัดการผู้ใช้+ผูกโครงการ | `users.html` + `index.html` | `auth.ts` + `lib/authz.ts` |

**โมดูลรองรับ (ไม่มีหน้าของตัวเอง แต่เสียบอยู่ทุกที่):**

| โมดูล | ทำอะไร | backend |
|---|---|---|
| **Photos/Files** | อัปโหลดรูปงาน/รูปวัสดุ/สลิป/ไฟล์สัญญา → R2 (gate ปิดอยู่ รอเปิด) · ลิงก์ Drive เดิมยังเสิร์ฟผ่าน lh3 | `photos.ts` |
| **Notifications** | กระดิ่งในแอป (อ่านจาก activity_logs) | `notifications.ts` |
| **LINE** | push/แจ้งเหตุสำคัญ/แจ้งเจ้าของ · digest รายวัน 18:30 + ops ทุก 3 ชม. + รายสัปดาห์ (cron) · คำสั่งในกลุ่ม `/รายงานประจำวัน` `/รายงาน3ชม` `/รายงานสัปดาห์` · ⚠️ cron ยังไม่ active (รอ LINE secrets) | `line_webhook.ts` + `lib/line.ts` |
| **Activity Log** | สมุดพงศาวดารกลาง — ทุก write สำคัญ autoLog ลง `activity_logs` → เลี้ยง feed/กระดิ่ง/digest | `lib/activity.ts` |
| **AI (Gemini)** | ใช้ 3 แบบ: ข้อความ (สรุป) · JSON (แปลงข้อความ→รายการ) · Vision (อ่านบิลจากรูป) — โมเดล gemini-2.5-flash | `lib/gemini.ts` |

---

## 3. Backend: cf-api 13 โมดูล (~135 actions)

> เส้นทางเดียว `?action=xxx` → เช็คสิทธิ์ (authz) → route → ตอบ `{ok,data}` · รักษา contract เดิมจาก GAS เป๊ะ (ชื่อ param + รูป response)

| โมดูล (ไฟล์ใน `cf-api/src/modules/`) | actions | หน้าที่ย่อ | AI | LINE | R2 |
|---|---|---|---|---|---|
| `auth.ts` | 6 | login/Google OAuth/จัดการผู้ใช้+role | | | |
| `projects.ts` | 3 | get/create/update โครงการ | | | |
| `ff_tasks.ts` | 12 | FF+tasks+payments+getAll aggregate+clone_project | | | |
| `daily.ts` | 21 | รายงานวัน+quick log+feed+สถิติ+AI สรุป/tag/แนะนำ task | ✅ | ✅ | |
| `materials.ts` | 21 | วัสดุ+ธุรกรรม+BOQ+มูลค่าคงคลัง+AI parse log+alerts | ✅ | | |
| `teams_finance.ts` | 23 | ทีม+สัญญา 2 ฝั่ง+งวด+staff+detect_unknowns | ✅ | ✅ | |
| `checkin.ts` | 9 | เช็คอิน GPS+timesheet+attendance+พิกัดไซต์ | | | |
| `risks.ts` | 4 | ความเสี่ยง L×I + clone template | | ✅ | |
| `evals.ts` | 6 | ประเมิน KPI 8 หมวด+สรุปอันดับ | | | |
| `qc.ts` | 8 | เช็กลิสต์ QC 26 ข้อ+defect C/M/Mn+ปิดงาน | | | |
| `photos.ts` | 15 | รูป/ไฟล์ทุกชนิด+scan_bill (Vision) | ✅ | | ✅ |
| `client_view.ts` | 4 | 4 endpoint read-only ฝั่งเจ้าบ้าน (whitelist) | | | |
| `notifications.ts` | 1 | กระดิ่งแจ้งเตือน | | | |
| `line_webhook.ts` | 3+webhook | digest 3 ตัว (cron) + คำสั่งกลุ่ม | ✅ | ✅ | |

**lib/ กลาง:** `auth` (token HMAC) · `authz` (RBAC matrix) · `db` (query+project scope) · `ids` (ออกเลขรายการ atomic) · `activity` (autoLog) · `gemini` · `line` · `r2` · `resp` (wrap+CORS) · `time` (โซนไทย)

**Worker จริง:** `https://dstr-api.keatudom456.workers.dev`

---

## 4. ฐานข้อมูล D1 — 31 ตาราง (จัดกลุ่ม)

| กลุ่ม | ตาราง |
|---|---|
| โครงการ+งาน | `projects` · `ff_items` · `tasks` · `payments` |
| รายงาน/กิจกรรม | `daily_reports` · `quick_logs` · `activity_logs` |
| วัสดุ | `materials` · `material_transactions` · `boq_items` · `suppliers` |
| คน/ทีม | `teams` · `project_teams` · `staff` · `project_staff` · `contractors` |
| เงิน/สัญญา | `contracts` (party contractor/client) · `milestones` · `contract_files` · `payment_slips` |
| เวลา | `checkins` · `site_config` · `staff_id_cards` |
| คุณภาพ/เสี่ยง | `qc_criteria` · `qc_inspections` · `qc_results` · `risks` · `contractor_evaluations` |
| รูป | `task_photos` · `material_photos` |
| ระบบ | `id_counters` |

---

## 5. สถานะปัจจุบัน + งานค้าง (สำคัญต่อการวางแผน merge)

| เรื่อง | สถานะ |
|---|---|
| Backend บน Cloudflare | ✅ LIVE (ตัดยอด 2026-07-15) ข้อมูลจริง bow-house |
| หน้าเว็บเดิม 13 หน้า | ✅ ใช้งานจริง ชี้ cf แล้ว |
| **v3 UI (12 หน้า)** | โค้ดเสร็จ 6 หน้า (login/projects/dashboard/daily/materials + demo) · **ยังไม่ตัดยอดสักหน้า** (รอ UAT มือถือจริง) · ค้าง: team, qc, checkin, client, users, hr, help/about |
| R2 อัปโหลดรูป | ⚠️ gate ปิดอยู่ (รอเปิด MEDIA + secrets) |
| LINE digest cron | ⚠️ ยังไม่ active (รอ LINE secrets บน CF) |
| Client page ใหม่ (%-รายห้อง) | สเปกเสร็จ (`S3-client-design.md`) · ต้องสร้าง endpoint `client_get_room_progress` · **พี่ชาย audit ก่อน deploy** |
| Apps Script legacy | คงไว้เป็น rollback — อย่าเพิ่งลบ |

---

*เอกสารนี้สรุปจากการสแกนโค้ดจริง 2026-07-19 (cf-api/src ทุกไฟล์ · หน้าเว็บทุกหน้า · apps-script · docs) — รายละเอียดราย action ดู `docs/migration-cloudflare/INVENTORY.md`*

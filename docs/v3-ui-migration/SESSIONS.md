# 🗓️ V3 UI Migration — ใบสั่งงานราย Session

> อ่าน `BLUEPRINT.md` ก่อนทุก session (กติกา §2 + พิธีตัดยอด §4 บังคับใช้ทุกหน้า)
> จบแต่ละ session: อัปเดตตาราง "บันทึกผล" ท้ายไฟล์นี้ + /handoff

---

## S0 — ฐานราก (ไม่มีหน้าใหม่ แต่ทุกหน้ายืนบนนี้)

**Deliverables:**
1. `css/design-system.css` — ยกจาก `v3-mockups/css/design-system.css` แล้ว**เติมของที่ mockup ขาด** (ต้องมีก่อนเริ่มหน้าอื่น):
   - Modal/dialog styles (ระบบเดิมใช้ `js/modal.js` หนักมาก — ดู markup ที่ modal.js สร้างแล้วทำ class รองรับ)
   - Toast notification styles (Modal.toast ใช้ทุกหน้า)
   - Table styles (team/materials/users ใช้ตารางเยอะ)
   - Form controls เพิ่มเติม: select, textarea, checkbox/radio, file upload, date input
   - Skeleton/loading state + empty state
   - Tab component (dashboard ใช้)
2. `js/shell.js` — ตาม contract ใน BLUEPRINT §2.3 (สร้าง + ทดสอบด้วยหน้า demo ชั่วคราวใน v3/)
3. `vendor/lucide/lucide.min.js` — ดาวน์โหลด ล็อกเวอร์ชัน จดเลขเวอร์ชันใน BLUEPRINT §2.4
4. `docs/v3-ui-migration/ICON-MAP.md` — ตารางแปลงอีโมจิ→Lucide ครบทุกตัวที่ใช้ในระบบเดิม (grep อีโมจิจาก *.html เดิมมาไล่ทำ)
5. โฟลเดอร์ `v3/` + ไฟล์ `v3/README.md` สั้นๆ ("โซนทดสอบ V3 — ผู้ใช้จริงยังไม่เห็น")

**DoD (Definition of Done):** เปิดหน้า demo ใน v3/ บน localhost + มือถือ (ผ่าน GitHub Pages) เห็น shell ครบ sidebar/topbar/bottom-nav, ไอคอนขึ้นแบบ offline-capable (ไม่มี request ออกไป unpkg), สลับ desktop↔mobile ถูกต้อง

---

## S1 — นำร่อง: login + projects (มี mockup ให้ทั้งคู่)

1. `v3/index.html` ← ต้นแบบ `v3-mockups/login.html` + logic เดิมจาก `index.html` (GSI + auth.js flow เดิมเป๊ะ — รวม redirect หลัง login และ error state "ยังไม่ได้รับอนุญาต")
2. `v3/projects.html` ← ต้นแบบ `v3-mockups/dashboard.html` + logic เดิมจาก `projects.html`
   - KPI row: bind ข้อมูลจริง (จำนวนโปรเจกต์ active, งานเสร็จ, ความเสี่ยง, ทีมหน้างานวันนี้ — เช็คว่า API มี endpoint ครบไหม ถ้าไม่มีให้ตัด KPI ตัวนั้นออก **ห้ามแต่งเลขปลอม**)
   - การ์ดโปรเจกต์ = ลิงก์ไป `dashboard.html?project=<id>` (ผ่าน state ไม่ hardcode)
   - AI banner จาก mockup: ถ้ายังไม่มี API สรุป AI ระดับ portfolio → ซ่อนไว้ก่อน (อย่าโชว์กล่องเปล่า)
3. ตัดยอดตาม §4 ได้เลยใน session นี้ถ้า UAT ผ่าน (2 หน้านี้เสี่ยงต่ำ)

**DoD:** login จริงผ่าน Google → เด้งเข้า projects → คลิกการ์ด bow-house → เข้า dashboard **เดิม** ได้ปกติ (ยังไม่ย้าย dashboard — ลิงก์ข้าม v3↔เดิมต้องเนียน)

---

## S2 — dashboard.html (4,375 บรรทัด — แตก 3 session ห้ามรวบ)

**S2a: Inventory + โครง + แท็บภาพรวม**
- ขั้นแรกสุด: ไล่อ่าน `dashboard.html` เดิมทั้งไฟล์ ทำ inventory ฟีเจอร์/แท็บ/modal ลงตารางใน session log (นี่คือ checklist กันฟีเจอร์หล่น)
- โครงหน้า `v3/dashboard.html` ตาม `v3-mockups/project-detail.html`: project header + tabs + sidebar scope 'project'
- แท็บภาพรวม: progress รวม (สูตร effort-based เดิม — ห้ามเปลี่ยนวิธีคิด %), Gantt mini, การ์ดสถิติ

**S2b: FF list + tasks + รูป**
- รายการ FF + subtask expand/collapse ตาม mockup + logic ติ๊ก task เดิม (รวม upload/ลบรูป task)
- แยกงานเพิ่ม (addonFFs F-21/F-22) ให้เห็นชัดเหมือนเดิม

**S2c: แท็บที่เหลือ + ตัดยอด**
- ความเสี่ยง (R-1/2/3), มูลค่าวัสดุคงคลัง, ประเมินผู้รับเหมา, Phase E/F (การเงินเจ้าบ้าน ถ้าอยู่ในหน้านี้), ฯลฯ ตาม inventory จาก S2a
- ครบแล้ว → พิธีตัดยอด §4

---

## S3 — client.html (หน้าเจ้าบ้าน — ภาพลักษณ์สำคัญ)

- ไม่มี mockup: ออกแบบเองตาม design system โทนเดียวกับ dashboard แต่**อ่านอย่างเดียว เรียบ หรู เข้าใจง่ายสำหรับลูกค้า** (ลูกค้าไม่ใช่คนใน — ซ่อนศัพท์ภายใน เช่น รหัส FF ให้แสดงชื่อชิ้นงานนำ)
- ระวัง: หน้านี้อาจมี access แบบพิเศษ (ลูกค้าไม่ login Google?) — ตรวจ flow เดิมก่อน คงพฤติกรรมเดิม
- เลขเงิน (งวด/ยอดจ่าย) ต้องตรงกับหน้าเดิม 100% ก่อนตัดยอด

## S4 — daily.html (ช่างใช้ทุกวัน — เริ่มโซนเสี่ยงสูง)

- คง flow 3 ขั้นเดิมเป๊ะ: เช็คอินทีม (chips + ปุ่ม −/+) → เลือก F/ทีม → พิมพ์ log; AI parser + รูปแนบ + ลบรายการ — ทั้งหมดมี logic เดิมใช้ได้ ยกมาทั้งก้อน
- ⚠️ จุดที่เพิ่งแก้บั๊ก (2026-07-16): `teamCheckin` ใช้ param `checkin_action` — **ห้าม** เปลี่ยนกลับเป็น `action` (ชนชื่อ route CF — memory `project-cf-action-param-collision`)
- ตัดยอดแล้ว → คลิปสอนใหม่ทันที (§4 ข้อ 6)

## S5 — materials.html (3,404 บรรทัด — ถ้าหนักให้แตก a/b แบบ S2)

- inventory ฟีเจอร์ก่อน: รับเข้า/เบิก/สแกนบิล AI/รูปบิล/ราคา/มูลค่าคงคลัง
- ระวังฟอร์มเบิกที่ช่างใช้บนมือถือ — ปุ่มใหญ่ ขั้นตอนเท่าเดิม

## S6 — team.html + qc.html

- team: สัญญา/งวด/สลิป = เรื่องเงิน → เทียบเลข side-by-side กับหน้าเดิมทุกสัญญา (CT004/005/006) ก่อนตัดยอด
- qc: ฟอร์ม QC เพิ่งเข้าระบบ ผู้ใช้ยังน้อย → เสี่ยงต่ำ ทำต่อท้าย session เดียวกันได้

## S7 — checkin.html (เสี่ยงสูงสุด — ทำตอน v3 นิ่งแล้วเท่านั้น)

- PWA + GPS + กล้อง + epoch timestamp (ห้ามแตะวิธีเก็บเวลา — memory `project-checkin-timesheet`)
- UAT บนมือถือ Android จริงของช่าง ≥1 เครื่องก่อนตัดยอด + คลิปสอนใหม่ + แจ้งกลุ่ม LINE
- เผื่อแผน B: ถ้าช่างสับสนมาก ให้ rollback ได้ใน 5 นาที (revert 1 commit)

## S8 — เก็บงาน

1. users.html, hr.html, help.html, about.html (เบา — session เดียวจบ)
2. help.html: อัปเดตเนื้อหาวิธีใช้ให้ตรง UI ใหม่ + ฝังคลิปสอนชุดใหม่
3. **Cleanup:** ลบ `css/main.css` (เมื่อไม่มีหน้าไหนอ้างแล้ว — `grep -l main.css *.html` ต้องว่าง), ลบโฟลเดอร์ `v3/` (ว่างแล้ว), ย้าย `v3-mockups/` → `docs/v3-ui-migration/mockups/` (เก็บเป็นประวัติ), grep อีโมจิตกค้างใน UI chrome
4. อัปเดต memory `project-v3-ui-migration` = เสร็จสมบูรณ์ + จดบทเรียน

---

## 📋 บันทึกผล (Opus กรอกทุก session)

| Session | วันที่ | ทำอะไร | ตัดยอด? (commit) | หมายเหตุ |
|---|---|---|---|---|
| S0 | 2026-07-16 | ฐานราก: `css/design-system.css` (เติม modal/toast/table/form/tabs/chips/skeleton/empty ครบ), `js/shell.js` (sidebar+topbar+bottom-nav+drawer, อ่าน projectId จาก URL เอง), Lucide **v1.24.0** self-host `vendor/lucide/`, `docs/.../ICON-MAP.md`, `v3/demo.html` | — (ยังไม่ตัดยอด) | ✅ verified Playwright: desktop+mobile+drawer+modal ผ่าน · 32 ไอคอนเรนเดอร์ offline · 0 error (นอกจาก favicon) |
| S1 | 2026-07-16 | นำร่อง: `v3/index.html` (login split-screen — คง GIS+รหัสผ่านสำรอง+SW/PWA), `v3/projects.html` (ภาพรวม — MERGE CONFIG+API, KPI จริง, การ์ด active/pending, modal สร้างโปรเจกต์) | ⏳ **ยังไม่ตัดยอด — รอ UAT มือถือ (โดยเฉพาะ Google login ที่เทสต์ local ไม่ได้)** | ✅ verified Playwright บน origin allowed (127.0.0.1:5500): projects โหลดข้อมูลจริง (18 FF, 40.7%, 1.97M, การ์ด active+progress), modal ครบ 7 ช่อง, mobile ผ่าน, **0 console error** · login layout+ปุ่ม Google+รหัสผ่านสำรอง+PWA prompt ผ่าน (Google origin 127.0.0.1 ปฏิเสธ = ปกติ, ต้อง UAT บน Pages) |

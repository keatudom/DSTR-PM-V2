# 🗓️ V3 UI Migration — ใบสั่งงานราย Session

> อ่าน `BLUEPRINT.md` ก่อนทุก session (กติกา §2 + พิธีตัดยอด §4 บังคับใช้ทุกหน้า)
> จบแต่ละ session: อัปเดตตาราง "บันทึกผล" ท้ายไฟล์นี้ + /handoff

**สถานะรวม (อัปเดต 2026-07-18):** S0 ✅ · S1 ✅โค้ด/⏳รอ UAT+ตัดยอด · S2a-c ✅โค้ด (dashboard ครบทั้งหน้า) · **S3 client = สเปกเสร็จ ⏸️พักไว้** · **S4 daily ✅โค้ดครบ (ch1+ch2)** · **S5 materials ✅โค้ดครบ (Ch1+2+3)** · S6/S7/S8 ยังไม่เริ่ม · ยังไม่มีหน้าไหนตัดยอดเลย

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

**S2b-1: FF list + tasks + รูป — ✅ ทำแล้ว (commit 259596d)**
- รายการ FF + subtask expand/collapse ตาม mockup + logic ติ๊ก task เดิม (รวม upload/ลบรูป task)
- แยกงานเพิ่ม (addonFFs F-21/F-22) ให้เห็นชัดเหมือนเดิม

**S2b-2: FF Detail overlay + FF Wizard** (ตอนนี้เป็น stub `_soon()` ที่ `v3/dashboard.html` L731-732 — ต้องแทนด้วยของจริง)

พอร์ตจาก `dashboard.html` เดิม 2 ก้อน (กติกา §2.2: ยก logic ทั้งก้อน เขียนใหม่เฉพาะ render):
1. **FF Detail overlay (full-screen)** — ฟังก์ชันต้นทาง: `openFFDetail` L3707, `closeFFDetail` L3727, `renderFFDHeader` L3736, `renderFFDGraph` L3778 (กราฟ progress), `renderFFDDesignSection` L3817 (รูปแบบ/design), `renderFFDTasksSection` L3828, `renderFFDGallerySection` L3838, `loadFFDPhotosBundle` L3848, `renderFFDPhotoGrid` L3874
   - ⚠️ `renderFFSubtasks` ตัวที่พอร์ตแล้วใน S2b-1 ต้องรองรับบริบทที่ 2: เรียกใน overlay ด้วย `_inOverlay=true` → ซ่อน CTA (ดู inventory ข้อควรระวัง #1)
   - ⚠️ z-index: หน้าเดิมใช้ overlay 9000 < Modal 9500 < lightbox 9999 · design-system ใช้ modal=100, S2b-1 ตั้ง lightbox=9999 ไปแล้ว → เคาะสเกลเดียวให้จบ: overlay ต้องต่ำกว่า Modal, lightbox สูงสุด (ทดสอบเปิดซ้อนกันจริง)
   - ⚠️ `window._tpPhotos` เป็น global ใช้ร่วมระหว่าง task modal + FF overlay — ห้ามแยกเป็นตัวแปรคนละชุด
2. **FF Wizard (สร้าง/แก้/ลบ FF หลายตัว)** — `FFW.*` L3903-4211, `openFFWizardModal` L4209, `confirmCloneFromTemplate` L4339 (+ `cloneFromTemplate('bow-house')` L4354 — hardcode ตั้งใจ คงไว้)
   - API ที่ต้องยังเรียกครบ: `createFFBatch` `updateFF` `deleteFF` `cloneFromTemplate`
   - จุดเข้า: ปุ่ม "เพิ่มงานแรก" ใน empty state (v3 L557) + จุดที่ตอนนี้ชี้ `_soon()`

**DoD S2b-2:** เปิด FF F-01 → overlay ขึ้นครบ header/กราฟ/design/tasks/gallery · ติ๊กงานใน overlay แล้ว list ข้างหลัง sync · เปิด wizard สร้าง FF ทดสอบ (บนโปรเจกต์ test — **อย่า** ยิง create จริงใส่ bow-house) · Playwright 0 console error · อัปเดต ☐→☑ ใน `dashboard-inventory.md`

**S2c: แท็บการเงิน + ความเสี่ยง/ประเมิน + Price Editor + ตัดยอด**

แทน "soon-box" 2 แท็บ (v3 L259-265) ด้วยของจริง:
1. **แท็บการเงิน** (เรื่องเงิน — เลขทุกตัวต้องตรงหน้าเดิม 100%):
   - งวดงานผู้รับเหมา: `renderNgwdGrid` L2146, `isPaymentReady` L2228, `getPaymentProgress` L2257, `showPaymentModal` L2283, `markPaymentInvoiced` L2344, `markPaymentPaid` L2358, `resetPayment` L2371 (payment 4 งวด 50/22.5/22.5/5% = hardcode ตั้งใจ คงไว้)
   - Progress vs Payment (ฝั่งเจ้าบ้าน): `renderPaymentProgress` L2952
   - Client Finance (สัญญา CT004/005/006): `renderClientFinance` L3031 + `CF.*` L3125-3411 ทั้งชุด (CRUD สัญญา/งวด milestone/อัปโหลด-ลบสลิป/ไฟล์สัญญา) + helper `cfBaht`/`cfOpenLink` L2940
   - 🔧 แทน native dialog ระหว่างพอร์ต (inventory L43): `prompt()` L2345 เลขใบแจ้งหนี้ · `confirm()` L2361 จ่ายเงิน · `confirm()` L2374 reset → ใช้ `Modal.confirm`/`Modal.show` ให้หมด
2. **แท็บความเสี่ยง/ประเมิน:**
   - Risk: `riskBand`/`riskBandLabel`/`riskEffBand` L2490-2515, `renderRiskHeatmap` L2516, `renderRisks` L2545, `RM.*` L2611-2806 (CRUD + score badge), `confirmCloneRisksFromDirek` L2807 (`direk-template` = hardcode ตั้งใจ คงไว้)
   - ประเมินผู้รับเหมา: `gradeFromTotal`/`gradeBadge`/`_evContractorTeams` L3412-3432, `renderEvals` L3433, `_evGradeColor` L3475, `EV.*` L3479-3706
3. **Price Editor (ตั้งราคาวัสดุ):** `PE.*` L1351-1424 — เสียบเข้า inventory card ที่ S2a ทำไว้แบบ read-only (v3 L442 มีข้อความ "ฟีเจอร์ตั้งราคาจะมาในเฟสถัดไป" → เอาออกเมื่อ PE ใช้ได้)
4. **กวาดท้าย:** ไล่ `dashboard-inventory.md` ทุกแถวต้อง ☑ · เช็ค 36 API methods ยังถูกเรียกครบ · `alert()` L822 (BOQ เร็วๆนี้) → Modal.toast
5. **พิธีตัดยอด §4 ทั้งหน้า dashboard** — ก่อนตัดยอดต้องเทียบเลขเงิน side-by-side (งวดงาน + สัญญาเจ้าบ้านทั้ง 3 ฉบับ) กับหน้าเดิมบนข้อมูลจริง bow-house · **ตัดยอด dashboard ควรทำหลัง/พร้อม S1 ตัดยอด** (dashboard ใหม่ลิงก์กลับ projects ใหม่ — อย่าให้ผู้ใช้เด้งสลับดีไซน์เก่า-ใหม่ไปมา)

**⏳ ค้างข้ามเซสชัน (ไม่ใช่โค้ด):** S1 ยังไม่ตัดยอด — รอ UAT มือถือจริงบน GitHub Pages (โดยเฉพาะ Google login) → เจ้าของงานเคาะแล้วค่อยตัดยอด index+projects (แนะนำ: ตัดยอดรวบพร้อม dashboard หลัง S2c เพื่อให้ 3 หน้าไปด้วยกัน — เคาะโดยเจ้าของงาน)

---

## S3 — client.html (หน้าเจ้าบ้าน — ภาพลักษณ์สำคัญ)

- ไม่มี mockup: ออกแบบเองตาม design system โทนเดียวกับ dashboard แต่**อ่านอย่างเดียว เรียบ หรู เข้าใจง่ายสำหรับลูกค้า** (ลูกค้าไม่ใช่คนใน — ซ่อนศัพท์ภายใน เช่น รหัส FF ให้แสดงชื่อชิ้นงานนำ)
- ระวัง: หน้านี้อาจมี access แบบพิเศษ (ลูกค้าไม่ login Google?) — ตรวจ flow เดิมก่อน คงพฤติกรรมเดิม
- เลขเงิน (งวด/ยอดจ่าย) ต้องตรงกับหน้าเดิม 100% ก่อนตัดยอด

## S4 — daily.html (ช่างใช้ทุกวัน — เริ่มโซนเสี่ยงสูง) 🔴 หน้าใหญ่สุด

> ✅ **Inventory ครบแล้ว → `docs/v3-ui-migration/daily-inventory.md`** (61 ฟังก์ชัน + flow 4 ขั้น + 12 sections + กับดัก) = ใบสั่งงาน/parity checklist ของ S4 · **อ่านไฟล์นั้นก่อนเริ่มเสมอ**
- 2,929 บรรทัด (ใหญ่กว่า S2b-2+S2c รวมกัน) · ไม่มี mockup → ออกแบบผิวเองตาม design system · คง flow 4 ขั้นเป๊ะ (เช็คอินทีม → เลือก F/ทีม → พิมพ์ log → เบิกวัสดุ)
- ⚠️ `teamCheckin` ใช้ param `checkin_action` — **ห้าม**เปลี่ยนกลับเป็น `action` (memory `project-cf-action-param-collision`) — L1038, L1079
- ยก logic ทั้ง 61 ฟังก์ชันมาทั้งก้อน เขียนใหม่เฉพาะ render + CSS design tokens · รักษา optimistic UI + retry + localStorage cache
- ตัดยอดแล้ว → **คลิปสอนใหม่ทันที** (§4 ข้อ 6) + แจ้งกลุ่ม LINE ช่าง
- ⚠️ งานใหญ่ระดับ >150k token → ทำเป็น session/chapter เดี่ยว (memory `feedback_session-discipline`)

## S5 — materials.html (3,404 บรรทัด — แตก 3 chapter) 🔴

> ✅ **Inventory ครบ → `docs/v3-ui-migration/materials-inventory.md`** (≈90 fn + 6 แท็บ + chapter plan) · อ่านก่อนเริ่มเสมอ
- **Ch1 ✅** = Stock + รายละเอียดวัสดุ + alerts · **Ch2 ✅** = ธุรกรรม รับ/เบิก/นับ + CRUD วัสดุ + สแกนบิล AI + picker · **Ch3 ✅** = ประวัติธุรกรรม (filter+group+detail) → **materials ครบทั้งหน้าแล้ว**
- ระวังฟอร์มเบิกที่ช่างใช้บนมือถือ — ปุ่มใหญ่ ขั้นตอนเท่าเดิม · COUNT/STATUS 2 โหมด · Quick Log แท็บซ่อน (flag) v3 ไม่ทำ

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
| S2c | 2026-07-18 | `v3/dashboard.html` แทน soon-box 2 แท็บด้วยของจริง — **dashboard ครบทั้งหน้า**: (1) **แท็บการเงิน** = งวดงานผู้รับเหมา (renderNgwdGrid + main 4 งวด + งวดสัญญาเพิ่ม 7, showPaymentModal, markPaymentInvoiced/Paid/resetPayment) · progress-vs-payment (renderPaymentProgress) · client finance CF.* ครบ (สัญญา/งวด/สลิป/ไฟล์ CRUD+upload) · (2) **แท็บความเสี่ยง/ประเมิน** = risk RM.* (heatmap+CRUD+chip L×I+clone direk) · eval EV.* (8 KPI checklist+คิดเกรดสด) · (3) **Price Editor** PE.* เสียบ inventory card (เปิดปุ่มตั้งราคา 88 วัสดุ+PM_SUGGEST) · loadData เพิ่ม getTeams/getEvals/getEvalConfig · **แทน native dialog:** prompt เลขใบแจ้งหนี้→modal input · confirm จ่าย/reset→Modal.confirm · CSS → design tokens ครบ | ⏳ (พร้อมตัดยอด — รอ UAT) | ✅ verified Playwright: **parity เลขเงิน 100% เทียบหน้าเดิม** (งวดงาน 11 รายการ + progress 41.2/pay 60.3/จ่าย 1,187,800/1,969,000 + สัญญา 3 ฉบับ 1.695M·64%/206k·50%/68k·0% + risk bands + เกรด 76.3C/87.5B **เหมือนกันทุกตัวอักษร**) · modal เปิดครบ (pay/risk/eval/PE) · eval คิดคะแนนสด (100→97.5→96.7) · risk chip L×I อัปเดต badge · 0 console error · desktop+mobile |
| S4-ch2 | 2026-07-18 | `v3/daily.html` **Chapter 2** — แทน stub `_ch2` ด้วยของจริงครบ: **บันทึก log** (structured + AI parse `parse_activity_text`→confirm modal→unknowns/task-tick) · **เบิกวัสดุครบชุด** (picker→qty COUNT/STATUS→`check_stock`→confirm card→optimistic+retry) · material intent จากพิมพ์ (AI+stock warning+force) · รูป (compressImage) · เสียง (Web Speech) · **สรุป AI sticky** (gen/edit/save/copy) · รายงาน modal · ลบ/ยกเลิกติ๊ก (→Modal.confirm) · CSS Chapter2 (~50 classes: aic/uk/tk/mt/sw/dr-mp/dr-wd/dr-summ/dr-rep) | ⏳ (ยังไม่ตัดยอด) | ✅ verified mobile: withdraw picker 89 วัสดุ→qty→การ์ดยืนยัน+echo, AI parse modal 3 section, report+stats, summary AI 806 ตัวอักษร, 0 console error · 🐛 แก้ Modal.close→show race (เอา close ซ้ำออก pickMaterial+drSubmitWithdraw) · ⚠️ path เขียน DB เลี่ยงตอน dev → UAT |
| S4-ch1 | 2026-07-18 | `v3/daily.html` **Chapter 1** — HTML skin + CSS design tokens (~110 dr-* classes) + โหลด/refresh (get_daily_bundle + localStorage cache แยกโปรเจกต์) + stats + **เช็คอินทีม ขั้น1 เต็ม** (renderTeamChips/toggle/adjustQty `checkin_action` ✓/syncStat) + **picker F/ทีม ขั้น3 เต็ม** (FF chips+กาง, sel team, default=ทีมเช็คอิน, echo) + feed แสดงผล read-only (period เช้า/บ่าย/เย็น, role badge, tags, optimistic state) + role picker + date nav · Chapter 2 = stub `_ch2()` | ⏳ (ยังไม่ตัดยอด, ยังไม่ครบหน้า) | ✅ verified Playwright mobile: 18 FF/3 ทีม/11 log โหลด, ทีมช่างไม้เช็คอิน preselect echo อัตโนมัติ, picker เลือก/ยกเลิก/กาง 18 ตัว/toggle ทีม ครบ, timeline+รูป+แท็ก, 0 console error · ⚠️ toggle เช็คอินจริง (เขียน DB) เลี่ยงตอน dev → เทสต์ตอน UAT |
| S2b-2 | 2026-07-18 | `v3/dashboard.html` แทน stub `_soon()` ด้วยของจริง: **FF Detail overlay** (openFFDetail/closeFFDetail + header KPI variance, กราฟแผน-vs-จริง 4 งวด, section แบบ/รูปทรง caption `[แบบ:`, งานรายงวด reuse `renderFFSubtasks(_,true)` ซ่อน CTA, gallery รวม, loadFFDPhotosBundle) + **FF Wizard** (FFW.* สร้างหลาย FF/tasks/template + openEdit/submitEdit + confirmDelete + openFFWizardModal + confirmCloneFromTemplate) · ปุ่ม "เพิ่มงาน"→FFW.open() · Esc ปิดทีละชั้น · ปุ่มปิด 44px · CSS overlay/wizard แปลงเป็น design tokens | ⏳ (ตัดยอดหลัง S2c) | ✅ verified Playwright: **parity 18/18 FF เป๊ะ** (pct/plan/var/ราคา/zone/งานรายงวด เทียบหน้าเดิม — ต่างแค่ currentWeek เดินตามนาฬิกา) · overlay+กราฟ+section ครบ · wizard: กันรหัสซ้ำข้ามการ์ด, validate กัน submit ว่าง, template 4 งาน, edit เติมค่าเดิมครบ, delete dialog (ยกเลิก=ไม่ลบจริง) · **z-index ซ้อนจริงผ่าน 3 ชั้น** (overlay 50 < modal 100 < lightbox 9999, elementFromPoint ยืนยัน) · mobile 390px + desktop · **0 console error** |
| S2b-1 | 2026-07-16 | `v3/dashboard.html` แท็บ "รายการงาน": FF list (zone tabs+sort gen จาก data), expand → subtask จัดกลุ่มงวด (phase dot), ติ๊กงาน (toggleTask/markDone/confirmUncheck + uncheck modal + date-choice), รูปงาน (chip 3-state+retry, gallery, lightbox, compress, ลบ) · แก้ hardcode zone→gen จาก data · z-index lightbox 9999 > modal 100 | ⏳ (รอ S2b-2+S2c) | ✅ verified: 18 FF, expand F-01=19 งาน/4 phase, uncheck modal+gallery เปิดถูก (ไม่กดยืนยัน=ไม่เขียน), 0 error · ⏳ **S2b-2 ค้าง = FF detail overlay + FF wizard (ตอนนี้ stub → toast)** |
| S2a | 2026-07-16 | `v3/dashboard.html` (per-project) โครง tab + shell scope project + พอร์ต overview ทั้งหมด: header/pills, KPI, gauge donut, AI daily card, AI alerts, inventory (read-only), timeline 20wk, notifications (NF.*) · แก้ลิงก์ hardcode `?project=bow-house` → `state.projectId` · inventory `dashboard-inventory.md` = parity checklist | ⏳ (ตัดยอดหลัง S2c — ทั้งหน้าต้องครบก่อน) | ✅ verified Playwright: ข้อมูลจริง Kun Beau House 40.7%/81.7%/-41%/1.19M, gauge, timeline 18 แถว, tab switch, กระดิ่ง 40 รายการ+mark-read, mobile+desktop, **0 console error** · ⚠️ actor บาง noti = "???" (data เก่าใน DB เพี้ยน ไม่ใช่บั๊กหน้าใหม่) · S2b/c = placeholder |

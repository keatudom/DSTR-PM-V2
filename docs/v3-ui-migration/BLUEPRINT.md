# 🎨 V3 UI Migration — BLUEPRINT (พิมพ์เขียวหลัก)

> **สถานะ:** เคาะโดยเจ้าของงาน 2026-07-16 (session Fable วางโครง → Opus เป็นผู้ลงมือ)
> **อ่านคู่กับ:** `SESSIONS.md` (ใบสั่งงานราย session) · mockup ต้นแบบใน `v3-mockups/` · handoff ของ Gemini ที่ `C:\Users\User\.gemini\antigravity\brain\62aa161e-3881-4808-8c23-fac92fd35094\handoff_to_claude.md`

---

## 0. เป้าหมาย + เงื่อนไขตายตัว (เจ้าของงานเคาะแล้ว)

**เป้าหมาย:** ยกระดับ UX/UI ทั้ง 12 หน้า จากดีไซน์เดิม (อีโมจิ + สไตล์กระจัดกระจาย) → ดีไซน์ enterprise ตาม design system ของ Gemini (Lucide icons, CSS variables, ภาษาไทย, sidebar desktop + bottom nav mobile)

**เงื่อนไขตายตัว 3 ข้อ — ละเมิดไม่ได้:**
1. **ห้ามระบบล่ม** — บ้านคุณโบว์ live อยู่ ช่างเช็คอิน + ลง daily report ทุกวัน ห้ามมีช่วงเวลาที่หน้าที่ใช้งานจริงพัง
2. **Practical สำหรับผู้ใช้ใหม่** — ช่าง/พนักงานใหม่ต้องใช้เป็นโดยไม่ต้องถาม: ภาษาไทย, ปุ่มใหญ่ (แตะง่ายบนมือถือ ≥44px), flow การกรอกเดิม (เปลี่ยนผิว ไม่เปลี่ยนขั้นตอน), คลิปสอนใหม่หลังตัดยอดหน้าช่าง
3. **เปลี่ยนเฉพาะผิว (frontend)** — **ห้ามแตะ `cf-api/` เด็ดขาด** และห้ามเปลี่ยน contract ของ `js/api.js` / `js/auth.js` / `js/config.js`

**มติ 4 ข้อที่เคาะแล้ว (2026-07-16):**
| ประเด็น | มติ |
|---|---|
| กลยุทธ์ | สร้างหน้าใหม่คู่ขนานใน `v3/` → UAT ผ่าน URL จริง → ตัดยอดทีละหน้า (strangler pattern — ตึกใหม่ข้างตึกเก่า ย้ายทีละแผนก) |
| 9 หน้าที่ mockup ไม่มี | Claude ออกแบบต่อเองตาม design system (ไม่รอ Gemini) |
| ลำดับ | นำร่อง login+projects → dashboard → client → หน้างานช่าง (daily→materials→team→qc→checkin ท้ายสุด) → เก็บงาน |
| Lucide icons | **Self-host ล็อกเวอร์ชันใน repo** (ห้ามใช้ CDN `@latest` — เว็บเป็น PWA ช่างใช้กลางไซต์ เน็ตช้า/CDN ล่ม = ไอคอนหายทั้งระบบ) |

---

## 1. ⚠️ แก้ความเข้าใจจาก handoff ของ Gemini (Opus ต้องรู้ก่อนเริ่ม)

1. **Backend ไม่ใช่ Apps Script แล้ว** — ตัดยอดไป Cloudflare Workers+D1+R2 เมื่อ 2026-07-15 (`js/config.js` → `BACKEND: 'cf'`). Logic ทั้งหมดผ่าน `js/api.js` ซึ่ง**ใช้ต่อได้เลย ไม่ต้องย้ายอะไร** — งานนี้คือเปลี่ยนผนัง ไม่ใช่ย้ายปลั๊กไฟ
2. **Mapping หน้า mockup ↔ หน้าจริง ไม่ตรงชื่อ:**
   | Mockup | คือโฉมใหม่ของ | หมายเหตุ |
   |---|---|---|
   | `v3-mockups/login.html` | `index.html` | login Google (GSI) — ต้องคง flow `js/auth.js` เดิมเป๊ะ |
   | `v3-mockups/dashboard.html` | **`projects.html`** (ภาพรวมหลายโปรเจกต์ + KPI + การ์ดโปรเจกต์) | ไม่ใช่ dashboard.html เดิม! |
   | `v3-mockups/project-detail.html` | **`dashboard.html`** (รายละเอียด 1 โปรเจกต์: FF list, Gantt, tabs) | ตัวใหญ่สุด 4,375 บรรทัด |
   - โครง IA ใหม่นี้**ตรงกับกฎที่เคาะไว้แล้ว**: การ์ดโปรเจกต์ = navigation ไป dashboard เสมอ, feature รายโปรเจกต์อยู่ใน dashboard เท่านั้น (memory `feedback_project-details-from-card`)
3. **ข้อมูลใน mockup เป็นของปลอม** — "Sukhumvit Penthouse", KPI 12 โครงการ, avatar PM/EN = hardcode ภาพนิ่ง ห้าม copy ไปเป็นข้อมูลจริง ทุกค่าต้อง bind จาก API

---

## 2. สถาปัตยกรรม

### 2.1 โครงไฟล์ (ระหว่าง migration)

```
main (= เว็บจริว GitHub Pages, push แล้วขึ้นทันที)
├── index.html, dashboard.html, daily.html, ...   ← หน้าเดิม ใช้งานจริง "ห้ามแตะ" จนกว่าจะตัดยอด
├── css/main.css                                   ← CSS เดิม (หน้าเก่ายังใช้) ลบตอนเฟสเก็บงาน
├── js/                                            ← สมองร่วม ใช้ทั้งเก่า+ใหม่
│   ├── config.js api.js auth.js state.js modal.js  (ห้ามเปลี่ยน contract)
│   └── shell.js                                   ← ★ใหม่: วาด sidebar/topbar/bottom-nav (ดู §2.3)
├── css/design-system.css                          ← ★ใหม่: ยกจาก v3-mockups + เติมของที่ขาด
├── vendor/lucide/lucide.min.js                    ← ★ใหม่: self-host ล็อกเวอร์ชัน
├── v3/                                            ← หน้าใหม่ระหว่างทำ (ผู้ใช้จริงไม่เห็น ไม่มีลิงก์ชี้เข้า)
│   ├── index.html, projects.html, dashboard.html, ... (ทีละหน้า)
│   └── (อ้าง asset ด้วย path `../css/` `../js/` `../vendor/`)
└── v3-mockups/                                    ← ต้นแบบของ Gemini อ่านอย่างเดียว ห้ามแก้ (ไว้เทียบ)
```

**ทำไม asset ใหม่วางที่ root ไม่ใช่ใน v3/:** ตอนตัดยอด ไฟล์หน้าจะย้ายจาก `v3/x.html` → `x.html` (root) — ถ้า asset อยู่ root อยู่แล้ว สิ่งที่ต้องแก้ตอนตัดยอดมีแค่ path `../` → `./` ในไฟล์เดียว (มี checklist ใน §4)

### 2.2 กติกาเขียนหน้าใหม่ (ทุกหน้า)

1. **โหลด JS ชุดเดิมครบ:** `config.js → auth.js → api.js → (state.js ถ้าหน้าเดิมใช้) → modal.js → shell.js` — ลำดับเดิมของหน้านั้น
2. **ยก logic เดิมมาทั้งก้อน แก้เฉพาะ render** — วิธีทำงานต่อหน้า: copy `<script>` ทั้งหมดของหน้าเดิมมา → คงฟังก์ชัน fetch/state/handler ไว้ → เขียนใหม่เฉพาะฟังก์ชัน `renderXxx()` ให้พ่น markup ตาม design system. **ห้าม rewrite logic จากศูนย์** (นั่นคือจุดที่บั๊กจะเกิด)
3. **ห้าม hardcode project id** — ใช้ `state.projectId` / query param ทุกที่ รวมถึงใน nav (บทเรียนจริง: `daily.html` เดิมมี `?project=bow-house` ฝังใน HTML — memory `feedback_kill-hardcoded-project-leaks`)
4. **อีโมจิ:** UI chrome (ปุ่ม/เมนู/หัวข้อ) → Lucide ทั้งหมด. แต่**ข้อความ data จาก backend** (เช่น activity log "👷 ทีมช่างไม้เข้าหน้างาน") มีอีโมจิฝังใน DB — **แสดงตามจริง ห้ามไป strip/แปลง** (การเปลี่ยนข้อความ log = งาน backend นอกขอบเขต)
5. **ฟอนต์:** IBM Plex Sans Thai (ไทย) + Inter (เลข/อังกฤษ) — ตัวเดิมของระบบอยู่แล้ว โหลดจาก Google Fonts ต่อได้ (ฟอนต์ล่มแล้ว fallback อ่านได้ ต่างจากไอคอนที่หายเลย)
6. **Responsive:** desktop >768px = sidebar · mobile ≤768px = bottom nav — ตาม `design-system.css` ที่ Gemini วางไว้
7. **Tap target มือถือ ≥44px** ทุกปุ่มที่ช่างใช้ (mockup บางปุ่มเล็กกว่านี้ — ปรับขึ้นได้เลย ไม่ต้องถาม)

### 2.3 `js/shell.js` — เปลือกร่วม (สร้างครั้งเดียว ใช้ 12 หน้า)

ปัญหาที่แก้: mockup ฝัง sidebar ซ้ำทุกไฟล์ → แก้เมนู 1 ครั้ง = แก้ 12 ไฟล์ + เสี่ยง hardcode ซ้ำรอย

Contract (ตัวอย่าง — Opus ออกแบบรายละเอียดได้แต่ต้องคงหลัก):
```js
Shell.render({
  page: 'daily',            // ใช้ไฮไลต์เมนู active
  title: 'รายงานประจำวัน',   // topbar
  scope: 'project'          // 'project' = เมนูในโปรเจกต์ (แนบ ?project= จาก state ให้เองทุกลิงก์)
                            // 'global'  = เมนูหลัก (ภาพรวม/โครงการทั้งหมด/ตั้งค่า)
});
```
- วาด: sidebar (desktop) + topbar (ชื่อหน้า, กระดิ่ง, โปรไฟล์จาก `auth`) + bottom nav (mobile ≤5 ปุ่ม)
- เมนู 2 ระดับตาม mockup: **global** (ภาพรวม, โครงการทั้งหมด, ทีม/ผู้รับเหมา, ตั้งค่า, ช่วยเหลือ) กับ **ในโปรเจกต์** (รายการงาน, รายงานประจำวัน, วัสดุ, ทีม, QC, ลูกค้า) — สอดคล้อง memory `feedback_project-details-from-card`
- เรียก `lucide.createIcons()` ปิดท้ายให้เอง

### 2.4 Lucide self-host

- ดาวน์โหลด `lucide.min.js` (UMD) เวอร์ชันล่าสุด ณ วันทำ → เก็บ `vendor/lucide/lucide.min.js` + จดเลขเวอร์ชันใน comment หัวไฟล์และใน BLUEPRINT นี้
- ทุกหน้า `<script src="../vendor/lucide/lucide.min.js"></script>` (ห้าม unpkg/CDN)
- ทำ**ตารางแปลงอีโมจิ→ไอคอน**ไว้ใน `docs/v3-ui-migration/ICON-MAP.md` ตอน S0 (เช่น 🏠→`layout-dashboard`, 📦→`package`, 📝→`activity`, 👷→`users`, ✅→`check-circle-2`, ⚠️→`alert-triangle`) แล้วใช้ให้เหมือนกันทุกหน้า — กันหน้าละไอคอนคนละตัว

---

## 3. สารบัญหน้า (12 หน้า) + ระดับความเสี่ยง

| # | หน้า | บรรทัด | ผู้ใช้หลัก | เสี่ยง | mockup | เฟส |
|---|---|---|---|---|---|---|
| 1 | `index.html` (login) | 146 | ทุกคน | 🟡 (Google GSI ต้องไม่พัง) | ✅ login.html | S1 |
| 2 | `projects.html` | 410 | PM | 🟢 | ✅ dashboard.html | S1 |
| 3 | `dashboard.html` | 4,375 | PM/เจ้าของ | 🟡 read-heavy | ✅ project-detail.html | S2 (แตก 3 ตอน) |
| 4 | `client.html` | 1,927 | **เจ้าบ้าน (ลูกค้า)** | 🟡 ภาพลักษณ์ | ❌ ออกแบบเอง | S3 |
| 5 | `daily.html` | 2,929 | ช่าง/โฟร์แมน ทุกวัน | 🔴 | ❌ | S4 |
| 6 | `materials.html` | 3,404 | ช่าง/สโตร์ | 🔴 | ❌ | S5 |
| 7 | `team.html` | 1,376 | PM/บัญชี (สัญญา+งวดเงิน) | 🔴 เงิน | ❌ | S6 |
| 8 | `qc.html` | 466 | QC | 🟡 | ❌ | S6 |
| 9 | `checkin.html` | 588 | **ช่างทุกเช้า (PWA+GPS)** | 🔴🔴 ท้ายสุด | ❌ | S7 |
| 10 | `users.html` | 336 | แอดมิน | 🟢 | ❌ | S8 |
| 11 | `hr.html` | 262 | แอดมิน | 🟢 | ❌ | S8 |
| 12 | `help.html` + `about.html` | 161+252 | ทุกคน | 🟢 | ❌ | S8 |

> ก่อนเริ่มแต่ละหน้า: Opus ต้องเปิดหน้าเดิม inventory ฟีเจอร์ให้ครบก่อน (นับ modal, ฟอร์ม, ปุ่ม, action ที่ยิง API) — **ห้ามให้ฟีเจอร์หล่นหาย** mockup มีแค่ ~10% ของฟีเจอร์จริง

---

## 4. พิธีตัดยอด (cutover) ต่อหน้า — checklist บังคับ

หน้าจะย้ายจาก `v3/` มาทับหน้าเดิมได้ ต้องผ่านครบ:

1. ☐ **Feature parity check** — เทียบ inventory ฟีเจอร์หน้าเดิม (จาก §3) ทุกข้อมีในหน้าใหม่
2. ☐ **Playwright smoke test** ผ่านบน `v3/` URL จริง: โหลดหน้า + login + action หลัก 3–5 ตัวของหน้านั้น (มี MCP playwright ในเครื่อง)
3. ☐ **UAT มือถือจริง** — เจ้าของงาน (+พี่ชายถ้าเกี่ยว) เปิด `https://keatudom.github.io/DSTR-PM-V2/v3/<หน้า>.html` บนมือถือ ใช้จริง 1 รอบ แล้วเคาะ "ผ่าน"
4. ☐ **ตัดยอด 1 commit ต่อหน้า:** copy `v3/x.html` → `x.html` + แก้ path `../css/ ../js/ ../vendor/` → `css/ js/ vendor/` + `grep -n '\.\./' x.html` ต้องว่าง
5. ☐ Smoke test ซ้ำบน URL จริง (ไม่ใช่ v3/) หลัง Pages rebuild
6. ☐ หน้า `daily`/`checkin`: **อัดคลิปสอนใหม่ทันที** (pipeline Playwright→PIL→GIF มีแล้ว — memory `feedback_tutorial-gif-pipeline`) + ส่งเข้ากลุ่ม LINE ช่าง
7. ☐ บันทึกผลใน `SESSIONS.md` (วันที่ + commit SHA)

**Rollback:** `git revert <commit ตัดยอดหน้านั้น>` + push — หน้าเดียวย้อน หน้าอื่นไม่กระทบ (ระบบเก่า GAS ยังเก็บถึง ~2026-08-14 เป็นร่มชูชีพอีกชั้นแต่ไม่เกี่ยวกับงานนี้)

**ข้อควรระวังพิเศษรายหน้า:**
- `index.html`: Google Sign-In (GSI client + redirect flow ใน `auth.js`) — ทดสอบ login จริงก่อนตัดยอด, `checkin.html`: PWA install + GPS permission + กล้อง — ทดสอบบนมือถือ Android จริงของช่างอย่างน้อย 1 เครื่อง
- `team.html`: มีเรื่องเงิน (สัญญา/งวด/สลิป) — เลขทุกตัวต้องตรงกับหน้าเดิม side-by-side ก่อนตัดยอด

---

## 5. วินัยการทำงาน (จาก memory ที่เคาะไว้แล้ว)

- **1 session = 1 ใบสั่งงานใน SESSIONS.md** (memory `feedback_session-discipline`) — จบ session = commit + จด SESSIONS.md + /handoff
- push `v3/` ขึ้น main ได้ตลอด (ผู้ใช้ไม่เห็น) แต่ **commit ตัดยอด** ต้องบอกเจ้าของงานก่อนทุกครั้ง
- เจอการตัดสินใจเชิงธุรกิจ/ดีไซน์ที่ mockup ไม่ได้ตอบ → ถามเจ้าของงาน อย่าเดา (กฎเหล็ก: AI เขียนได้ห้ามตัดสินใจ — memory `feedback_four-debts-ai-discipline`)
- อธิบายให้เจ้าของงานด้วยภาษาคนธรรมดา + คำแปลไทยกำกับศัพท์เทคนิคเสมอ

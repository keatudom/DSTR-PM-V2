# Multi-Project Readiness — Implementation Plan

> ✅ **ทำครบทุกก้อนแล้ว 2026-08-29** — deploy หลังบ้าน (worker + migration 0009) และ push หน้าเว็บขึ้น GitHub Pages เรียบร้อย ตรวจของจริงบน prod ผ่าน

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:executing-plans` (inline) or `superpowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Goal:** ทำให้ DSTR-PM เปิดโครงการใหม่ได้เองจนใช้งานเต็มรูปแบบ **โดยไม่ต้องให้โปรแกรมเมอร์แก้ไฟล์โค้ด**

**Architecture:** ย้าย "ค่าตั้งต้นรายโครงการ" ที่ตอนนี้ฝังตายใน `js/config.js` (ชื่อเดือนไทม์ไลน์ · แผน Gantt รายชิ้น · จำนวนโซน · สัดส่วนงวดจ่าย) ออกเป็น 2 ที่: ค่าที่ **คำนวณได้จากข้อมูลที่มีอยู่แล้ว** ให้คำนวณสด (ไทม์ไลน์จากวันเริ่ม-จบ · โซนจากรายการ FF จริง) ส่วนค่าที่ **ต้องตั้งเอง** ย้ายลง D1 (คอลัมน์ `projects.settings` JSON + ตารางใหม่ `ff_plans`) แล้วเปิดหน้าจอให้ผู้ใช้ตั้งเอง

**Tech Stack:** Cloudflare Workers + D1 (SQLite) + R2 · frontend = static HTML/JS บน GitHub Pages · `wrangler` CLI

**Spec:** ผลการสำรวจในบทสนทนา session 2026-08-29 (สรุปไว้ใน §"หลักฐานที่สำรวจเจอ" ท้ายไฟล์นี้)

## Global Constraints

- **Additive-only migration** — ห้าม DROP/RENAME คอลัมน์เดิม ห้ามลบข้อมูล (ตาม `project-deploy-rollback-pattern`)
- **bow-house ต้องไม่เปลี่ยนพฤติกรรมเลย** — ทุก migration ต้อง seed ค่าปัจจุบันของ bow-house ลง DB ให้ผลลัพธ์เท่าเดิมเป๊ะ
- **ห้ามตั้งพารามิเตอร์ชื่อ `action`** — ชนกับชื่อ route ใน `_cfCall` (ดู `project-cf-action-param-collision`)
- **`callRead` ใช้ยิงคำสั่งเขียนด้วย — ห้ามใส่ retry เหมารวม** (ดู `project-nav-and-checkin-scope`)
- **1 ฟีเจอร์ = แก้ไฟล์เดียวที่ root** — V3 ตัดยอดแล้ว ไม่ต้องแก้ทั้ง root และ `v3/` (ยกเว้น `client.html`)
- **สี design-system ไม่มีเฉด -600** สำหรับ success/warning/error — ใช้ -500 หรือ -700 (ดู `project-v3-design-system-palette`)
- **คำที่ใช้ใน UI = "งานบิ้วอิน" ห้ามใช้ "ก่อสร้าง"**
- **`Modal.close()` แล้วต่อด้วย `Modal.show()` ทันทีไม่ได้** — modal ใหม่จะหาย (ดู `project-v3-modal-close-race`)
- ทุก migration ต้องรัน `--local` ผ่านก่อน แล้วค่อย `--remote`
- ทุกก้อนจบด้วย `npm run typecheck` ผ่าน + commit

---

## File Structure

| ไฟล์ | หน้าที่ | สถานะ |
|---|---|---|
| `cf-api/migrations/0009_multi_project.sql` | เพิ่มคอลัมน์ `projects.settings` + ตาราง `ff_plans` + seed ค่าของ bow-house | สร้างใหม่ |
| `cf-api/src/modules/projects.ts` | เพิ่ม settings เข้า get/create/update + `deleteProject` + `getProjectsProgress` | แก้ |
| `cf-api/src/modules/ff_plans.ts` | อ่าน/เขียนแผน Gantt รายโครงการ | สร้างใหม่ |
| `cf-api/src/modules/ff_tasks.ts` | `getAll` คืน `ffPlans` เพิ่ม | แก้ |
| `cf-api/src/modules/line_webhook.ts` | digest แยกรายโครงการ + ติดป้ายชื่อบ้าน | แก้ |
| `cf-api/src/router.ts` | ผูก action ใหม่ 6 ตัว | แก้ |
| `js/api.js` | wrapper ของ action ใหม่ | แก้ |
| `js/state.js` | `calcFFPlanByGantt` อ่านแผนจาก `state.data.ffPlans` แทน `CONFIG.GANTT_PLAN` | แก้ |
| `js/config.js` | ลบ `GANTT_PLAN` / `PHASE_NAMES` / `PROJECTS` ที่ผูกกับ bow-house ออก เหลือแต่ค่า default กลาง | แก้ |
| `projects.html` | การ์ดแสดง % จริงทุกโครงการ + เมนูแก้ไข/ปิด/ลบ + ทางเดินหลังสร้างเสร็จ | แก้ |
| `dashboard.html` | ไทม์ไลน์คำนวณสด · โซนจากข้อมูลจริง · งวดจ่ายจาก settings · กัน NaN · หน้าตั้งค่าโครงการ · checklist เริ่มต้น | แก้ |

---

## Task 1 — Migration: ที่เก็บค่าตั้งต้นรายโครงการ

**Files:**
- Create: `cf-api/migrations/0009_multi_project.sql`

**Interfaces — Produces:**
- คอลัมน์ `projects.settings` TEXT (JSON) — คีย์: `phase_names {p1..p4}`, `phase_payment_pct {p1..p4}`, `addon_ffs []`, `timeline_weeks` (number|null)
- ตาราง `ff_plans (project_id TEXT, ff_code TEXT, phase INTEGER, start_week INTEGER, end_week INTEGER, PRIMARY KEY (project_id, ff_code, phase))`

- [x] **Step 1: เขียน migration** — `ALTER TABLE projects ADD COLUMN settings TEXT;` + `CREATE TABLE ff_plans (...)` + `INSERT` seed แผน Gantt ของ bow-house ทั้ง 18 ชิ้น (ยกมาจาก `CONFIG.GANTT_PLAN` ตรงๆ) + `UPDATE projects SET settings = '<json>' WHERE project_id = 'bow-house'` ด้วยค่าปัจจุบัน (`phase_payment_pct` 50/22.5/22.5/5 · `phase_names` จาก `CONFIG.PHASE_NAMES` · `addon_ffs` `["F-21","F-22"]`)
- [x] **Step 2: รัน local** — `npm run migrate:local` → คาดว่า apply ผ่าน
- [x] **Step 3: ตรวจ seed** — `wrangler d1 execute dstr-db --local --command "SELECT COUNT(*) FROM ff_plans"` → คาดว่า 72 แถว (18 ชิ้น × 4 งวด)
- [x] **Step 4: Commit**

---

## Task 2 — Backend: settings + ทะเบียนโครงการ

**Files:**
- Modify: `cf-api/src/modules/projects.ts`
- Modify: `cf-api/src/router.ts`

**Interfaces — Produces:**
- `getProjects` คืน `settings` เป็น object (parse JSON แล้ว; พังก็คืน `{}`)
- `updateProject` รับ `settings` (object หรือ JSON string) เพิ่มในรายการฟิลด์ที่แก้ได้
- `deleteProject(env, {project_id})` → ลบได้เฉพาะโครงการที่ **ไม่มีข้อมูลใดๆ** เลย; ถ้ามีให้ throw พร้อมบอกว่าติดตารางไหนกี่แถว
- `getProjectsProgress(env)` → `[{project_id, ff_count, task_count, done_weight, total_weight, zone_count}]` (query เดียว ไม่วนรายโครงการ)
- router: `delete_project`, `get_projects_progress`

- [x] **Step 1** — `PROJECTS_HEADERS` เพิ่ม `'settings'`; ใน `getProjects` แปลง `settings` string → object
- [x] **Step 2** — `updateProject`: เพิ่ม `'settings'` ใน `editable`; ถ้าค่าเป็น object ให้ `JSON.stringify` ก่อน bind
- [x] **Step 3** — เขียน `deleteProject`: ไล่นับ 25 ตารางที่มี `project_id`; รวมแล้ว > 0 → `throw new Error('ลบไม่ได้ — ยังมีข้อมูล: ...')`; = 0 → `DELETE FROM projects`
- [x] **Step 4** — เขียน `getProjectsProgress` ด้วย `LEFT JOIN` + `GROUP BY project_id` (น้ำหนักงาน = `COALESCE(weight,1)`, เสร็จ = `status='Done'`)
- [x] **Step 5** — ผูก 2 action ใหม่ใน router
- [x] **Step 6** — `npm run typecheck` ผ่าน → Commit

---

## Task 3 — Backend: แผน Gantt รายโครงการ

**Files:**
- Create: `cf-api/src/modules/ff_plans.ts`
- Modify: `cf-api/src/modules/ff_tasks.ts` (`getAll`)
- Modify: `cf-api/src/router.ts`

**Interfaces — Produces:**
- `getFFPlans(env, projectId)` → `{ "F-01": [[1,1,2],[2,3,5],[3,9,11],[4,18,19]], ... }` (รูปเดียวกับ `CONFIG.GANTT_PLAN` เดิม → frontend สลับมาใช้ได้โดยไม่ต้องแก้สูตร)
- `saveFFPlan(env, {project_id, ff_code, phases})` — `phases` = `[[phase,start,end], ...]` upsert ทับทั้งชิ้น
- `deleteFFPlan(env, {project_id, ff_code})`
- `getAll` คืนคีย์ใหม่ `ffPlans`
- router: `get_ff_plans`, `save_ff_plan`, `delete_ff_plan`

- [x] **Step 1** — เขียน `ff_plans.ts` ทั้ง 3 ฟังก์ชัน (ใช้ `projectScope` เพื่อให้ bow-house ครอบ NULL ตามธรรมเนียมเดิม)
- [x] **Step 2** — `getAll` เพิ่ม `ffPlans: await getFFPlans(env, projectId)`
- [x] **Step 3** — ผูก 3 action ใน router
- [x] **Step 4** — `npm run typecheck` ผ่าน → Commit

---

## Task 4 — Backend: LINE digest แยกรายโครงการ

**Files:**
- Modify: `cf-api/src/modules/line_webhook.ts`

**Interfaces — Consumes:** `projectScope` จาก `lib/db.ts`

- [x] **Step 1** — เพิ่ม helper `activeProjects(env)` → `[{project_id, name}]` เฉพาะ `status='active'`
- [x] **Step 2** — `lineDailyDigest`: ดึง `activity_logs`/`daily_reports` ครั้งเดียวเหมือนเดิม แล้ว **จัดกลุ่มในหน่วยความจำ** ตาม `project_id` (null → `bow-house`); โครงการที่ไม่มีกิจกรรมให้ข้าม; ถ้ามีมากกว่า 1 โครงการที่มีกิจกรรม ให้ใส่หัวข้อ `━━ 🏠 <ชื่อโครงการ> ━━` คั่นแต่ละบล็อก; ถ้ามีโครงการเดียวให้หน้าตาเหมือนเดิมเป๊ะ (ไม่ให้ทีมงงตอนยังมีบ้านเดียว)
- [x] **Step 3** — ทำแบบเดียวกันกับ `lineWeeklyDigest` และ `lineOpsDigest`
- [x] **Step 4** — `npm run typecheck` ผ่าน → Commit

---

## Task 5 — Frontend: เลิกอ่านค่าตายจาก config

**Files:**
- Modify: `js/state.js` (`calcFFPlanByGantt`)
- Modify: `js/config.js`
- Modify: `dashboard.html` (`renderTimeline`, `renderHeader`, `renderKPIs`, `renderNgwdGrid`)

- [x] **Step 1** — `calcFFPlanByGantt` อ่านแผนจาก `state.data.ffPlans` ก่อน แล้ว fallback `CONFIG.GANTT_PLAN` (กันหน้าที่ยังไม่โหลด `getAll`)
- [x] **Step 2** — `renderTimeline`: คำนวณ `weeks = Math.max(4, Math.min(52, Math.ceil(totalDays/7)))` และสร้างหัวเดือนจาก `project.startDate` แทนอาร์เรย์ตายตัว 5 เดือน; ทุกที่ที่เขียนเลข `20` ให้ใช้ `weeks`
- [x] **Step 3** — `renderHeader`: `4 Zones` → นับโซนจริงจาก `state.data.ffs`
- [x] **Step 4** — `renderKPIs`: กันหารศูนย์ — `totalValue > 0 ? Math.round(paid/totalValue*100) : null` แล้วแสดง `—` เมื่อไม่มีมูลค่า
- [x] **Step 5** — `renderNgwdGrid`: อ่าน `phase_names` / `phase_payment_pct` จาก `project.settings` แทนอาร์เรย์ตายตัว (มี default กลางเมื่อไม่มี settings)
- [x] **Step 6** — `config.js`: ลบ `GANTT_PLAN` และ `PROJECTS.bow-house` ออก (ข้อมูลอยู่ใน D1 แล้ว); เก็บ `PHASE_COLORS` + default `PHASE_NAMES` ไว้เป็นค่ากลางของทุกโครงการ
- [x] **Step 7** — เปิด dashboard ของ bow-house ด้วย Playwright เทียบว่า % / ไทม์ไลน์ / งวด เหมือนเดิมเป๊ะ → Commit

---

## Task 6 — Frontend: หน้าจัดการโครงการ + การ์ดแสดง % จริง

**Files:**
- Modify: `projects.html`
- Modify: `js/api.js`

- [x] **Step 1** — `api.js` เพิ่ม `getProjectsProgress()`, `deleteProject(id)`, `updateProject(data)`
- [x] **Step 2** — `loadProjects()` เรียก `getProjectsProgress()` ครั้งเดียว แล้ววาดการ์ดจากข้อมูลจริงทุกโครงการ (ลบเงื่อนไข `proj.project_id === 'bow-house'` ทิ้ง)
- [x] **Step 3** — การ์ดเพิ่มปุ่ม `⋯` → แก้ไขข้อมูลโครงการ / ปิดโครงการ (`status='archived'`) / ลบ (เรียก `delete_project`; ถ้าไม่ว่างจะขึ้นข้อความบอกว่าติดอะไร)
- [x] **Step 4** — กรองการ์ด: โครงการ `archived` ยุบไว้ท้ายหน้าใต้หัวข้อ "ปิดงานแล้ว"
- [x] **Step 5** — เทสต์ด้วย Playwright: TEST ต้องขึ้น % จริง ไม่ใช่ "รอเพิ่มงาน (FF)" → Commit

---

## Task 7 — Frontend: ทางเดินหลังเปิดโครงการใหม่

**Files:**
- Modify: `projects.html` (`submitCreateProject`)
- Modify: `dashboard.html` (setup checklist + ติดสวิตช์ clone)

- [x] **Step 1** — สร้างโครงการเสร็จ → เด้ง modal ถามว่าจะเริ่มยังไง 3 ทาง: **คัดลอกงานจากโครงการเดิม** (เลือกต้นแบบได้ ไม่ล็อก bow-house) / **เพิ่มงานเอง** / **ไว้ทีหลัง** — ต้องหน่วง `setTimeout` ก่อน `Modal.show` เพราะ `Modal.close()` เคลียร์ 200ms
- [x] **Step 2** — `dashboard.html`: การ์ด "เริ่มต้นโครงการ" โผล่เมื่อยังไม่ครบ — ☐ เพิ่มงาน (FF) ☐ ตั้งแผนไทม์ไลน์ ☐ สร้างสัญญาเจ้าบ้าน ☐ ผูกทีมช่าง — แต่ละข้อกดแล้วไปที่หน้าที่ถูก; ครบแล้วการ์ดหายไปเอง
- [x] **Step 3** — `confirmCloneFromTemplate` รับ `sourceProjectId` จากตัวเลือกจริง (เลิก hardcode `'bow-house'`)
- [x] **Step 4** — เทสต์: สร้างโครงการใหม่บน local → คัดลอกงาน → เห็นงานครบ → Commit

---

## Task 8 — Frontend: หน้าตั้งค่าโครงการ (ปิดวงจร "ไม่ต้องเรียกช่าง")

**Files:**
- Modify: `dashboard.html`

- [x] **Step 1** — modal "ตั้งค่าโครงการ" เข้าจากหัวโครงการ: แก้ชื่องวด 4 งวด + สัดส่วน % ของแต่ละงวด (บันทึกลง `settings` ผ่าน `update_project`)
- [x] **Step 2** — modal "ตั้งแผนไทม์ไลน์" รายชิ้น: เลือก FF → กรอกสัปดาห์เริ่ม-จบของงวด 1-4 → `save_ff_plan`; มีปุ่ม "ใช้แผนเดียวกับชิ้นอื่น" เพื่อลอกทีละชิ้นเร็วๆ
- [x] **Step 3** — เทสต์บน TEST: ตั้งแผน → ไทม์ไลน์ขึ้นแท่งถูกสัปดาห์ → Commit

---

## Task 9 — Deploy + verify

- [x] **Step 1** — `npm run migrate:remote` (additive — ปลอดภัย)
- [x] **Step 2** — `npm run deploy`
- [x] **Step 3** — push frontend ขึ้น main (GitHub Pages)
- [x] **Step 4** — Playwright ตรวจ prod: bow-house เหมือนเดิมทุกตัวเลข · TEST ใช้งานได้เต็ม
- [x] **Step 5** — สรุปให้เจ้าของงาน + ตัดสินใจเรื่องลบ TEST

---

## หลักฐานที่สำรวจเจอ (2026-08-29)

ตรวจของจริงบน prod (`keatudom.github.io/DSTR-PM-V2` + D1 `dstr-db` remote) — อ่านอย่างเดียว:

| # | จุด | ไฟล์:บรรทัด |
|---|---|---|
| 1 | ป้าย `4 Zones` ตายตัว | `dashboard.html:681` |
| 2 | `paid / project.totalValue` → NaN เมื่อมูลค่า = 0 | `dashboard.html:691` |
| 3 | ชื่อเดือน 5 เดือน + 20 สัปดาห์ ตายตัว | `dashboard.html:771` |
| 4 | `GANTT_PLAN` ผูกกับ "รหัส F-xx" ไม่ผูกโครงการ → รหัสชนกันข้ามบ้าน | `js/config.js` |
| 5 | งวดจ่าย 50/22.5/22.5/5 ตายตัว | `dashboard.html:1041-1045` |
| 6 | การ์ดโครงการที่ไม่ใช่ bow-house วาดแบบ "ยังไม่เริ่ม" เสมอ | `projects.html:129` |
| 7 | ไม่มี UI แก้ไข/ปิด/ลบโครงการ (`update_project` มีแต่ไม่มีปุ่มเรียก) | — |
| 8 | LINE digest ดึงทั้งตาราง ไม่กรองโครงการ ไม่ติดป้ายชื่อ | `line_webhook.ts:61,64,96,99,127` |
| 9 | `confirmCloneFromTemplate` เขียนครบแต่ไม่มีปุ่มเรียก (dead code) | `dashboard.html:2189` |

**สถานะข้อมูล prod:** 2 โครงการ — `bow-house` (ของจริง) · `prj_mpkytgpl` "TEST" (FF 1 ตัวชื่อ `test 1` ราคา 0 · ตารางอื่นว่างหมด)

**สถานะหลังบ้าน:** ทุกตารางมี `project_id` ครบ · 15/17 โมดูลกรองตามโครงการถูกแล้ว · `activity_logs` มี 798 แถวเป็น NULL (legacy) + 294 แถวเป็น `bow-house` → ใช้ธรรมเนียม `projectScope` ที่ให้ bow-house ครอบ NULL

# 📋 dashboard.html — Feature Inventory (Parity Checklist สำหรับ S2)

> ไฟล์ต้นทาง: `dashboard.html` 4,376 บรรทัด · โหลด config/auth/api/state/modal/pwa-install · entry = `loadData()` (L4368)
> ใช้เป็น **checklist ตัดยอด** — ทุกฟีเจอร์ต้องมีในหน้าใหม่ก่อน cutover (BLUEPRINT §4 ข้อ 1)
> อัปเดตสถานะ (☐→☑) เมื่อพอร์ตแต่ละอันเสร็จ

## 15 Sections (บนลงล่าง)

| # | Section | id | render fn | รอบ |
|---|---|---|---|---|
| 1 | Project header + meta + pills | `#projName #projSub #projPills` | `renderHeader` L1475, `_updateProjectHeaderUI` L1117 | S2a |
| 2 | Notification panel (กระดิ่ง) | `#nfBell #nfPanel #nfList` | `NF.*` L2838-2935 | S2a |
| 3 | AI Alerts banner | `#aiBnr` | `renderAiAlertsBanner` L1425 | S2a |
| 4 | Quick Hub cards | `.hub-grid` | `renderHubCards` L1450 + IIFE QC/HR L1054 | S2a |
| 5 | KPIs (actual/plan/variance/เบิก) | `#kpiGrid` | `renderKPIs` L1493 | S2a |
| 6 | AI Daily Report card | `#drReportCard` | `loadLatestReport` L1228 | S2a |
| 7 | Donut gauge + forecast | `#gaugeRow` | `renderGauge` L1536 | S2a |
| 8 | Inventory value (+ Price Editor) | `#invSummary` | `renderInventory` L1294, `PE.*` L1351 | S2a (แสดง) / S2c (PE) |
| 9 | ☑ Weight/Progress list + subtasks | `#weightList #zoneTabs` | `renderWeightList` L1587, `renderFFSubtasks` L1683 | S2b-1 ✅ |
| 10 | Payment grid (งวดงาน) | `#ngwdGrid` | `renderNgwdGrid` L2146 | S2c |
| 11 | Progress vs Payment (เจ้าบ้าน) | `#ppBody` | `renderPaymentProgress` L2952 | S2c |
| 12 | Client Finance (สัญญาเจ้าบ้าน) | `#cfBody` | `renderClientFinance` L3031 + `CF.*` | S2c |
| 13 | Timeline / Gantt (20 สัปดาห์) | `#timeline` | `renderTimeline` L2387 | S2a |
| 14 | Risk management (heatmap+CRUD) | `#riskHeatmap #riskList` | `renderRisks` L2545, `RM.*` | S2c |
| 15 | Contractor Evaluation | `#evList` | `renderEvals` L3433, `EV.*` | S2c |
| — | FAB floating menu | `#fab #fabMenu` | `toggleFab` L1467 | S2a |
| — | Bottom nav | `.bnav` | static | S2a (→ shell) |
| — | ☑ FF Detail overlay (full-screen) | `#ffdOverlay` | `openFFDetail` L3707, `renderFFD*` | S2b-2 ✅ |
| — | ☑ FF Wizard modal (multi-FF create/edit/delete) | Modal | `FFW.*` L3903-4211 | S2b-2 ✅ |

## 36 API methods (parity — ทุกตัวต้องยังเรียกได้)

`fetchAll`·`getProjects`·`getTeams`·`getInventorySummary`·`getClientFinance`·`getEvals`·`getEvalConfig`·`callRead(get_ai_alerts)`·`callRead(get_saved_summary)`·`qcSummary`·`getNotifications`·`updateMaterialPrices`·`getTaskPhotos`·`deleteTaskPhoto`·`uploadLogPhoto`·`addPhoto`·`updateTask`·`updatePayment`·`createRisk`·`updateRisk`·`deleteRisk`·`cloneRisksFromTemplate`·`createClientContract`·`updateContract`·`createMilestone`·`updateMilestone`·`uploadPaymentSlip`·`deletePaymentSlip`·`uploadContractFile`·`deleteContractFile`·`createEval`·`updateEval`·`deleteEval`·`createFFBatch`·`updateFF`·`deleteFF`·`cloneFromTemplate`

## state.js calc fns ที่ใช้ (reusable — ไม่ต้องเขียนใหม่)
`buildWeights` `calcFFProgressWeighted` `calcProjectProgress` `calcProgressByContract` `calcClientPaymentStats` `calcPlanProgress` `calcFFPlanByGantt` `calcVariance` `calcForecast` `formatDateThai` `fmt` `daysBetween` `todayStr`
> `state` object: `.projectId .zone .sortMode .openFFs .recentUncheck .data .weights` + dashboard เพิ่ม `.materials .contractors .teams .alerts .evals .evalConfig .inventory .clientFinance`

## Helpers นิยามใน dashboard เอง (ต้องพกไปด้วยตอนแยก)
`escapeHtml`/`escapeHtmlAttr` L2601 · `tpEsc`/`tpThumbUrl`/`tpFullUrl` L1794 · `compressImage` L1927 · `cfBaht`/`cfOpenLink` L2940 · `thaiDateShort` L1270 · `gradeFromTotal`/`gradeBadge`/`_evGradeColor` L3412 · `riskBand`/`riskBandLabel`/`riskEffBand` L2490

## Modals: 11 × Modal.show · 7 × Modal.confirm · ~50 × Modal.toast
⚠️ **native dialog ที่ควรแทนด้วย Modal ตอนทำใหม่:** `confirm()` L1881(ลบรูป)/L2361(จ่ายเงิน)/L2374(reset) · `prompt()` L2345(เลขใบแจ้งหนี้) · `alert()` L822(BOQ เร็วๆนี้)

## 🔴 Hardcode `?project=bow-house` — บั๊กจริง (โครงการอื่นกดเด้งเข้าบ้านโบว์) ต้องแก้เป็น state.projectId
- Hub cards + daily card: **L790, 796, 803, 809, 828, 846**
- FAB menu: **L1021-1024**
- Bottom nav: **L1032, 1035, 1038**
- title/header hardcode: L6, L740, L741, L1121 (`'bow-house'→'Kun Beau House'` map)
> ✅ reference ที่ทำถูก (copy pattern นี้): QC card L815, AI banner L1444 — ใช้ `encodeURIComponent(state.projectId)`

## Hardcode domain บ้านโบว์ (ตั้งใจ — รู้ไว้ ยังไม่ต้องแก้ในเฟสนี้)
- Zone tabs `Zone 1..5` L879 · payment 4 งวด 50/22.5/22.5/5% L2147 · timeline months เม.ย.–ส.ค. L2389/L984 · `direk-template` risk source L2553 · `cloneFromTemplate('bow-house')` L4354 · `PE.PM_SUGGEST` ราคา M001-M074 L1353

## ⚠️ ข้อควรระวัง
1. `renderFFSubtasks` reuse 2 บริบท (list มี CTA / overlay `_inOverlay=true` ซ่อน CTA L1688)
2. Task photo flow decouple จาก progress 100% (รูปล้ม≠task กระทบ) — รักษาไว้
3. `window._tpPhotos` global ใช้ร่วม lightbox ทั้ง task modal + FF overlay
4. z-index: **reconcile แล้วใน S2b-2** — สเกลใหม่บน design-system: bottomnav 30 < **ffd-overlay 50** < modal 100 < toast 120 < **lightbox 9999**. (ต่างจากหน้าเดิมที่ overlay=9000; หน้าใหม่ overlay ตั้งใจให้ *ต่ำกว่า* modal เพื่อให้ popup ยืนยัน/แก้ไขเด้งทับ overlay ได้ — ทดสอบซ้อนจริงด้วย elementFromPoint ผ่านทั้ง 3 ชั้น)

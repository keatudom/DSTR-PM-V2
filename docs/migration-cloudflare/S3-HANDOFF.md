# S3-HANDOFF — หน้าเว็บ + รูป + ฟีเจอร์ QC

> สถานะ: **โค้ดเสร็จครบ + ทดสอบ QC end-to-end บน D1 local ผ่าน 15/15 · commit แล้ว (ยังไม่ push)**
> อัปเดตล่าสุด: 2026-07-14 · ผู้ปฏิบัติ: Session 3
> อ่านคู่กับ: `BLUEPRINT.md` §5 · `S1-HANDOFF.md` (รากฐาน + gate ที่ยังค้าง)

---

## 0. บริบทสำคัญ (Session 1 รันขนานกันจริง)

ตอน Session 3 เริ่ม พบว่า **Session 1 กำลังตอกเสาเข็มขนานอยู่สดๆ** (ไฟล์ `cf-api/` ทยอยโผล่)
จึง **ไม่แข่ง** งานรากฐาน/cloud ของ S1 (ไม่แตะ `wrangler.toml`, migration, `src/lib/*`, `src/index.ts`,
`modules/auth.ts`, ไม่รัน `wrangler login/d1 create/deploy`) — ทำเฉพาะไฟล์ที่เป็นของ Session 3 แท้ๆ
โดยอ่าน convention จริงจากโค้ด S1 (`resp.ts`/`db.ts`/`ids.ts`/`time.ts`/`router.ts`) แล้วเสียบให้เนียน

---

## 1. ✅ ทำเสร็จแล้ว (โค้ด + ทดสอบ)

### ส่วน A — สลับหน้าเว็บ (2 ไฟล์เดิม)
| ไฟล์ | ทำอะไร |
|---|---|
| `js/config.js` | เพิ่ม `BACKEND: 'gas'` (ค่าเริ่ม · **กฎเหล็ก: commit ต้องเป็น 'gas' เสมอ**) + `CF_API_URL` (ยัง PLACEHOLDER รอ URL จริงจาก deploy) |
| `js/api.js` | เพิ่ม `_cfCall()` + branch `if (CONFIG.BACKEND==='cf')` ใน `callRead/callWrite/callPost/callUpload` — **คง path gas เดิมทุกบรรทัด** · เพิ่ม QC helper 8 ตัว |

**กลไก cf:** ทุก call = `fetch` POST JSON ไป `CF_API_URL + '/api'` · แนบ `auth_token` ทั้งใน body (ตัวที่ authz อ่านจริง) และ `Authorization: Bearer` header · รูป base64 ส่งใน JSON ตรงๆ (ไม่ต้อง iframe hack)

> ⚠️ **ข้อค้นพบสำคัญ:** `src/index.ts` ของ S1 **ไม่ได้ดึง `Authorization` header เข้า params** — `authorize()` อ่าน token จาก `p.auth_token||p.token` เท่านั้น ดังนั้น frontend ต้องส่ง `auth_token` **ใน body** (ทำแล้ว) ลำพัง Bearer header จะ auth ไม่ผ่าน · ถ้าอยากรองรับ Bearer จริง ให้ index.ts เพิ่ม: อ่าน `request.headers.get('Authorization')` → เติม `params.auth_token` (แนะนำทำใน S2 เพื่อความสะอาด แต่ไม่บังคับ — ตอนนี้ทำงานได้ด้วย body)

### ส่วน B — ฟีเจอร์ QC Checklist (ของใหม่ บน cf)
| ชิ้น | ไฟล์ | หมายเหตุ |
|---|---|---|
| Parse ต้นแบบ → seed | `cf-api/seed/parse_qc_template.py` → `qc_criteria.json` + `qc_criteria_seed.sql` | **26 ข้อ หมวด A–I** (ไฟล์จริงมี 26 ไม่ใช่ 24/A–H ที่ SESSION-3.md สรุป — ยึดของจริง) · defect: C=8, M=15, Mn=3 |
| API module | `cf-api/src/modules/qc.ts` (8 actions) | get_qc_criteria, get_qc_inspections, get_qc_inspection, create_qc_inspection, update_qc_result, close_qc_inspection, **delete_qc_inspection**, qc_summary |
| Router wiring | `cf-api/src/router.ts` (+19 บรรทัด, additive) | `import * as qc` + 8 case |
| หน้าเว็บ | `qc.html` | 4 view: รายการ+tally, ฟอร์มสร้าง, ฟอร์มตรวจ 26 ข้อ (✓/✗/N/A + C/M/Mn + note + รูป), หน้าสรุป+ตรวจซ้ำ · ดีไซน์ DSTR (main.css) · **โหลด `state.js` + ใช้ `state.projectId` ทุกจุด ไม่ hardcode bow-house** |
| การ์ด dashboard | `dashboard.html` | hub-card "✅ QC ตรวจคุณภาพ" + badge นับ defect ค้าง (อัปเดตจาก qc_summary เฉพาะโหมด cf) |

**กติกาสถานะ (จากไฟล์ต้นแบบ):** C ค้าง→ไม่ผ่าน(fail) · M/Mn ค้าง→ผ่านมีเงื่อนไข(conditional) · ไม่มี defect ค้าง→ผ่าน(pass) · "ค้าง"=fail ที่ยังไม่ตรวจซ้ำผ่าน (`recheck_result!='pass'`)

### ทดสอบแล้ว (หลักฐาน)
- **typecheck `cf-api` ผ่านสะอาด** (รวม qc.ts + router)
- **unit test กติกา C/M/Mn: 10/10 ผ่าน** (ตรรกะ computeStatus/countPendingDefects)
- **end-to-end บน `wrangler dev --local` + D1 local: 15/15 ผ่าน** — create→tick(pass/fail C/M/Mn/na)→close→recheck→re-inspect(round+1)→qc_summary→delete ครบ ทดสอบบน `project_id='_test-mig'` แล้วลบเกลี้ยง (ไม่แตะ bow-house)
  - พิสูจน์ทุกกติกา: C→fail · Mn→conditional · all-pass→pass · แก้ C แล้วตรวจซ้ำผ่าน→กลับเป็น pass

### สัญญา response (สำคัญต่อคนทำต่อ)
ทุก QC action ถูก router ห่อ `{ok, data}` เสมอ (ไม่ใช่ RAW_ACTION) → **handler คืน data ดิบ, frontend อ่าน `res.data.*`** เช่น create คืน `res.data.inspection_id`

---

## 2. ⛔ ค้าง (gated — ต้องรออย่างอื่นก่อน)

| งานค้าง | ติดที่ | ทำเมื่อ |
|---|---|---|
| เติม `CF_API_URL` จริงใน `js/config.js` | รอ S1 deploy (Worker URL ยัง PENDING) | หลัง `wrangler deploy` (ดู S1-HANDOFF §gate) |
| seed `qc_criteria` ขึ้น **D1 remote** | รอ D1 จริง (หลัง `wrangler d1 create`) | `cd cf-api && wrangler d1 execute dstr-db --remote --file=seed/qc_criteria_seed.sql` |
| แนบรูป defect ใน QC (ปุ่ม 📷) | รอ `modules/photos.ts` (upload_log_photo → R2) ของ **Session 2** | หลัง S2 ทำ photos + `/media` route ใน index.ts |
| Playwright smoke ทุกหน้าโหมด cf (login→dashboard→checkin→materials→daily→team→client→hr) | รอ **S2** (131 actions) + cloud ขึ้น | หลัง S2 + deploy |
| rollback test (สลับ gas↔cf จริง 1 รอบ) | รอ cloud ขึ้น | หลัง deploy — สลับ `BACKEND:'cf'` ทดสอบ แล้วสลับกลับ 'gas' |

> **ยังไม่สลับ `BACKEND` เป็น 'cf' ใน commit** ตามกฎเหล็ก — การตัดยอดจริงเป็นขั้นตอนแยกที่มีมนุษย์เคาะ (BLUEPRINT §6.4)

---

## 3. Cloud gate — ต้องให้เจ้าของงานทำ (เหมือน S1-HANDOFF §gate)

Session 1 + Session 3 ต่างก็ติด gate เดียวกัน = **ต้อง `wrangler login` + secrets ก่อน** จึงจะ deploy ได้
เพื่อไม่ให้ 2 เซสชันแข่งกันสร้าง D1 ซ้ำ → **ให้เดินตาม runbook ของ S1-HANDOFF §"หลัง login แล้ว" ที่เดียว** (S1 เป็นเจ้าของ `wrangler.toml` + database_id)

หลัง cloud ขึ้นแล้ว งาน S3 ที่เหลือ (turnkey):
```
cd cf-api
wrangler d1 execute dstr-db --remote --file=seed/qc_criteria_seed.sql   # seed 26 เกณฑ์ขึ้น D1 จริง
# เอา Worker URL จริงจาก S1-HANDOFF → แก้ js/config.js: CF_API_URL (ยังคง BACKEND:'gas')
# ทดสอบ QC บนของจริง: สร้าง inspection บน _test-mig ผ่านหน้า qc.html (ชั่วคราวตั้ง BACKEND='cf' ใน DevTools)
```

## 4. วิธีรัน/ทดสอบ QC ซ้ำ (local — ไม่ต้อง login)
```
cd cf-api
wrangler d1 migrations apply dstr-db --local                 # (ครั้งแรก) สร้าง schema local
wrangler d1 execute dstr-db --local --file=seed/qc_criteria_seed.sql
wrangler dev --port 8788 --local                             # แยก terminal
node <scratchpad>/qc_e2e_test.mjs                            # หรือ curl POST /api {"action":"get_qc_criteria"}
```

## 5. ไฟล์ที่ Session 3 เพิ่ม/แก้ (commit แล้ว ยังไม่ push)
- ใหม่: `cf-api/src/modules/qc.ts`, `cf-api/seed/parse_qc_template.py`, `cf-api/seed/qc_criteria.json`, `cf-api/seed/qc_criteria_seed.sql`, `qc.html`, `docs/migration-cloudflare/S3-HANDOFF.md`
- แก้ (additive): `cf-api/src/router.ts`, `js/config.js`, `js/api.js`, `dashboard.html`
- **ไม่แตะ:** `cf-api/wrangler.toml` (S1), `S1-HANDOFF.md` (S1), โค้ด path gas เดิมใน `js/api.js`

## 6. หมายเหตุฝากคนทำต่อ
- **QC authz:** action QC ยังไม่อยู่ใน `ACTION_CAP` ของ `authz.ts` → ตอนนี้ผู้ใช้ที่ login แล้ว (ทุก role) ทำได้ (ช่วงเปลี่ยนผ่าน "unmapped→allow") · anonymous ก็ได้ตอน `ALLOW_ANON_READ='true'` · ถ้าจะรัดสิทธิ์ทีหลัง เพิ่ม create/update/close/delete_qc → cap `OPS` หรือ `MANAGE`, get/summary → `READ`
- **id QC:** ใช้ prefix `QCI-` (pad 4) ผ่าน `nextId` ของ S1 · result_id = natural key `<inspection>__<criteria>` (ไม่ใช้ counter)
- **แท็บ Dashboard/เกณฑ์อ้างอิง ในไฟล์ต้นแบบ:** ยังไม่ได้ย้าย (ระบบเราคำนวณ dashboard เองจาก qc_summary) — ถ้าอยากได้ layout เป๊ะไฟล์เดิมค่อยทำเพิ่ม

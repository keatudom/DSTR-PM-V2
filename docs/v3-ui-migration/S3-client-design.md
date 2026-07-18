# 🏠 S3 — Client Page (หน้าเจ้าบ้าน) — Design Spec

> สเปกจาก brainstorm 2026-07-18 (เจ้าของงานเคาะทุกข้อ) · แทน `client.html` เดิม (1,927 บรรทัด ทิ้งร้าง)
> อ่านคู่กับ `BLUEPRINT.md` (กติกา §2 + พิธีตัดยอด §4) · เข้า execution ผ่าน `writing-plans` ต่อ

## 0. บริบท / ทำไมต้องรื้อ

หน้า `client.html` เดิมถูกปล่อยทิ้งร้าง และ**โชว์เงิน** (งวดงาน + จำนวนบาท) ซึ่งเจ้าของงานตัดสินใจใหม่ว่า **เจ้าบ้านไม่ควรเห็นเงินเลย**. S3 จึงไม่ใช่ "พอร์ตของเดิม" แต่เป็น **ออกแบบใหม่จากศูนย์ตามความต้องการที่เพิ่งกลั่น**.

## 1. เงื่อนไขที่เคาะแล้ว (2026-07-18)

| # | ประเด็น | มติ |
|---|---|---|
| 1 | เจ้าบ้านเห็นเงินไหม | **ไม่เห็นเงินอะไรเลย** — เงินคุยกันนอกแอป (งวด/ยอดจ่าย/ต้นทุน/กำไร ซ่อนหมด) |
| 2 | ระดับความคืบหน้า | **แยกตามห้อง** (จาก field `area`) — ไม่ใช่รายชิ้น (ซ่อนรหัส FF) ไม่ใช่ภาพรวมก้อนเดียว |
| 3 | ส่วนอื่น (timeline/ติดต่อ/ประกาศ) | **ไม่เอา** — มินิมอลสุด เอาแค่ความคืบหน้างาน |
| 4 | หัวสรุป (% รวม + วันส่งมอบ) | **ตัดออก** — เหลือรายห้องล้วนๆ |
| 5 | ต้องเปิด backend ใหม่ไหม | **เปิด** — สร้าง endpoint client ใหม่เพื่อได้ %-รายห้องจริง (ชนกฎ "ห้ามแตะ cf-api" แต่เจ้าของงานอนุมัติแล้ว) |

## 2. ขอบเขตข้อมูล — เห็น / ห้ามเห็น

**เห็นได้:** ชื่อห้อง (`area`) · % คืบหน้าของห้อง · รูปหน้างานของห้อง (เฉพาะ `client_visible = true`)

**ห้ามหลุดเด็ดขาด (กรองที่ backend):** เงินทุกชนิด · รหัส FF (F-01) · น้ำหนักงาน (weight) · ราคา/ต้นทุน · ชื่อคนอัปโหลด (uploaded_by) · หมายเหตุภายใน · ความเสี่ยง · สถานะ task รายตัว

## 3. Backend — endpoint ใหม่ (โซนกั้นเงิน — ต้อง audit)

`client_get_room_progress` (role: client, read-only) ใน `cf-api/src/modules/client_view.ts`

**Input:** `{ project_id?, role: 'client' }` (ตามแพตเทิร์น client_get_* เดิม)

**Output:** array ของห้อง เรียงตามลำดับที่เห็นสมเหตุสมผล (เช่นตาม zone/ชั้น):
```
[
  { room: "ห้องนอนใหญ่", pct: 80, photos: [ {drive_id, drive_url, caption, uploaded_at}, ... ] },
  { room: "ครัว",        pct: 45, photos: [ ... ] },
  ...
]
```

**วิธีคิด (ต้องยืนยันตอนวางแผน):**
1. group ชิ้นงาน (ffs) ตาม `area` → ได้ "ห้อง"
2. `pct` ของห้อง = รวมความคืบหน้าของชิ้นงานในห้องนั้น — **ต้องคิดแบบเดียวกับหน้าภายใน (effort-based)** เพื่อให้เลขลูกค้ากับ PM ตรงกัน (ถ้าคิดคนละวิธีจะงง). ⚠️ open item: logic effort-based อยู่ที่ `state.js` (frontend) — ตอนวางแผนต้องเคาะว่าจะ replicate ใน backend หรือคิด task-done-ratio แล้วยอมรับว่าต่างเล็กน้อย
3. `photos` = task_photos ของ task ในห้องนั้นที่ `client_visible = true` เท่านั้น

**Whitelist บังคับ:** return เฉพาะ 3 field ต่อห้อง (room/pct/photos) + 4 field ต่อรูป (drive_id/drive_url/caption/uploaded_at). **ห้าม** spread object ดิบจาก DB (กันหลุด field เงิน/ภายใน). กรองที่ server ไม่ใช่ frontend (กัน IDOR — client แก้ request แล้วดูดข้อมูลไม่ได้).

**ไม่แตะ:** endpoint เดิม (`client_get_overview/photos/milestones/payments`) คงไว้ — หน้าใหม่แค่ไม่เรียก `client_get_payments`/`milestones` (เงินไม่ถึง frontend เลย)

## 4. Frontend — `v3/client.html`

**Auth:** `Auth.requireAuth('client')` เหมือนเดิมเป๊ะ (เจ้าบ้าน login รหัสผ่าน → server ให้ role client). ไม่แตะ auth flow.

**โครง (มินิมอล เรียบ หรู — โทนขาว-เทา-ดำตาม design-system.css):**
```
┌─────────────────────────────┐
│  บ้านคุณโบว์                  │   ← header: ชื่อโครงการอย่างเดียว (ไม่มี % รวม/วันส่งมอบ)
├─────────────────────────────┤
│  ห้องนอนใหญ่        80% ▓▓▓▓░ │   ← การ์ดห้อง: ชื่อ + แถบ % 
│  [รูป] [รูป] [รูป]           │      + แถวรูป (แตะ = lightbox เต็มจอ)
├─────────────────────────────┤
│  ครัว               45% ▓▓░░░ │
│  [รูป] [รูป]                 │
└─────────────────────────────┘
```
- โหลด JS ชุดเดิม: `config → auth → api → modal → (shell?)` · ⚠️ หน้า client อาจไม่ใช้ shell เต็ม (ไม่มี sidebar เมนูภายใน) — เคาะตอนวางแผนว่าใช้ shell แบบ minimal หรือ header เปล่า
- lightbox รูป reuse แพตเทิร์นเดียวกับ dashboard (tp-lightbox z-index สูงสุด)
- empty state: ห้องที่ยังไม่มีรูป/0% → แสดงสุภาพ ("ยังไม่เริ่ม" ไม่ใช่กล่องเปล่า)
- ไม่มีอีโมจิใน UI chrome → Lucide (ตาม ICON-MAP)

## 5. ความปลอดภัย + การส่งมอบ

- ✅ **พี่ชาย (ekaratanav) audit endpoint ใหม่ก่อน deploy** — โซนกั้นเงิน · ตรวจ whitelist ไม่รั่ว + role guard (client ดึงของโปรเจกต์อื่น/ข้อมูลภายในไม่ได้) · ตามวินัย 4-debts (Security)
- ทำใน `v3/client.html` คู่ขนาน (strangler) → UAT มือถือจริง (เปิดเหมือนเจ้าบ้านเห็น) → ตัดยอด 1 commit
- Rollback = revert 1 commit (frontend) · endpoint ใหม่เป็น additive (ไม่กระทบของเดิม)
- ⚠️ endpoint แตะ backend → ต้อง deploy cf-api (ไม่ใช่แค่ push Pages) — ทำตาม deploy+rollback pattern

## 6. Open items (เคาะตอน writing-plans)

1. **วิธีคิด % รายห้อง** — replicate effort-based ใน backend ให้ตรง state.js เป๊ะ หรือ task-done-ratio (ยอมต่างเล็กน้อย)?
2. **จัดกลุ่มด้วย `area`** — ถ้าชิ้นงานบางตัวไม่มี `area` จะ fallback ยังไง (เข้ากลุ่ม "อื่นๆ" / ใช้ zone แทน)?
3. **ลำดับห้อง** — เรียงยังไงให้ลูกค้าเข้าใจ (ตามชั้น/ตาม zone)?
4. **รูปเข้าห้อง** — task_photos ผูก task→ff→area; ยืนยัน chain ครบทุกรูปที่ client_visible
5. **shell หรือ header เปล่า** สำหรับหน้า client

## 7. Non-goals (ไม่ทำใน S3 นี้ — กัน scope creep)

ไม่มีเงิน · ไม่มี timeline ขั้นตอน · ไม่มีปุ่มติดต่อ PM · ไม่มีประกาศ/ข้อความ · ไม่มีเอกสาร/แบบ/ใบรับประกัน · ไม่มี % รวมทั้งบ้าน · ไม่มีวันคาดส่งมอบ — (เก็บเป็น backlog ถ้าเจ้าของงานอยากเพิ่มภายหลัง)

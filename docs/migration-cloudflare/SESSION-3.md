# SESSION 3 — หน้าเว็บ + รูปภาพ + ฟีเจอร์ QC · เริ่มได้เมื่อ S1-HANDOFF.md มีจริง (ไม่ต้องรอ S2 จบ แต่สลับ BACKEND ทดสอบได้เฉพาะโมดูลที่ S2 ติ๊กแล้ว)

> **อ่านก่อนเริ่ม:** `BLUEPRINT.md` §1 §5 · `S1-HANDOFF.md` · memory `feedback_kill-hardcoded-project-leaks` (ห้าม hardcode 'bow-house' — ใช้ state.projectId) · `project-inarch-brand-ui` ไม่เกี่ยว (นี่ฝั่ง DSTR ใช้ดีไซน์ DSTR เดิม)
> **บทบาท:** ช่างหน้าบ้าน + ผู้สร้างฟีเจอร์ QC

## งานส่วน A — สลับหน้าเว็บ (BLUEPRINT §5)

1. `js/config.js`: เพิ่ม `BACKEND: 'gas'` + `CF_API_URL` (จาก S1-HANDOFF)
2. `js/api.js`: เพิ่ม cf path ใน callRead/callWrite/callPost/callUpload — fetch ปกติ + `Authorization: Bearer <token>` header (token เดิมจาก localStorage) · **คง path gas เดิมทุกบรรทัด**
3. ทดสอบทุกหน้าโหมด cf กับโมดูลที่ S2 เสร็จแล้ว (Playwright: login → dashboard → checkin → materials → daily → team → client → hr)
4. PWA `checkin.html` + `sw.js`: ตรวจ cache ไม่ขวาง fetch ข้าม origin ใหม่

## งานส่วน B — ฟีเจอร์ QC Checklist (ของใหม่ สร้างบน cf เท่านั้น)

**ต้นแบบ:** `C:\Users\User\Downloads\DSTR - สำเนาของ QC-Overall-Dashboard-บ้านคุณวริษฐา-แก้ไข-28-6-69.xlsx`
โครงไฟล์: แท็บ "แบบฟอร์มตรวจ QC" = ฟอร์มมาตรฐาน 24 ข้อ หมวด A–H (A ลามิเนต/ผิว · B ขอบบาน/Dap · C สี · D ฮาร์ดแวร์ · E กระจก · F ไฟ · G ตกแต่ง · H มิติ) แต่ละข้อ: เกณฑ์ยอมรับ, วิธีตรวจ, defect ระวัง พร้อมระดับ [C]ritical/[M]ajor/[Mn]inor, ช่องผลตรวจ, หมายเหตุ/แนวทางแก้ · หัวฟอร์ม: โครงการ, ผู้ผลิต/ช่าง, รายการ, รหัสชิ้นงาน, ตำแหน่ง/ห้อง, แบบอ้างอิง, ผู้ตรวจ, วันที่ · มีแท็บ "เกณฑ์อ้างอิง" + "Dashboard ภาพรวม"

1. **Parse xlsx → seed `qc_criteria`:** สคริปต์ Python (openpyxl) อ่านแท็บฟอร์ม → JSON 24 ข้อ (section, seq, item, acceptance, method, defects, defect_class) → INSERT D1 · เก็บสคริปต์ใน `cf-api/seed/parse_qc_template.py`
2. **API `modules/qc.ts`:** `get_qc_criteria` · `get_qc_inspections` (list ต่อ project, filter ff_code/status) · `get_qc_inspection` (หัว+ผลรายข้อ) · `create_qc_inspection` (สร้างหัว + 24 แถวผลจาก criteria active) · `update_qc_result` (ติ๊ก pass/fail/na + defect_class + note + photo_url) · `close_qc_inspection` (สรุป pass/fail → status ผ่าน/ไม่ผ่าน/ผ่านมีเงื่อนไข) · `qc_summary` (ต่อ FF: รอบล่าสุด, จำนวน defect C/M/Mn ค้าง — เลี้ยง dashboard)
   - กติกาสถานะ (จากไฟล์ต้นแบบ): มี C ค้าง = ไม่ผ่าน · มี M ค้าง = ผ่านมีเงื่อนไข ต้องแก้+ตรวจซ้ำ · Mn = ผ่านมีเงื่อนไข บันทึกแก้ไข · ไม่มี defect = ผ่าน
3. **หน้า `qc.html`:** ดีไซน์เดียวกับหน้าอื่นของ DSTR (ดู materials.html เป็นแบบ) — (ก) รายการชิ้นงาน FF + สถานะ QC ล่าสุด/badge defect (ข) ฟอร์มตรวจมือถือ: ไล่ 24 ข้อ ติ๊ก ✓/✗/N/A, ถ้า ✗ เลือก C/M/Mn + ถ่ายรูป + หมายเหตุ (ค) หน้าสรุป inspection พร้อมปุ่มตรวจซ้ำรอบใหม่ (ง) การ์ด QC ภาพรวมใน dashboard.html (นับผ่าน/ไม่ผ่าน/รอตรวจ)
   - ใช้ `state.projectId` ทุกจุด ห้าม hardcode โปรเจกต์
   - รูป defect → `API.uploadLogPhoto` เดิม (path cf → R2)

## นิยามเสร็จ

- [ ] ทุกหน้าเดิมทำงานบนโหมด cf (Playwright ผ่าน + screenshot แนบ)
- [ ] rollback ทดสอบจริง: สลับกลับ gas 1 ครั้ง ทุกอย่างยังใช้ได้
- [ ] QC: สร้าง inspection จริง 1 ชิ้น (F-01) บน `_test-mig` → ติ๊กครบ → สรุปสถานะถูกตามกติกา C/M/Mn → ลบทิ้ง
- [ ] ยังไม่สลับ BACKEND เป็น cf ใน commit ที่ push (การตัดยอดจริงเป็นขั้นตอนแยก มีมนุษย์เคาะ — ดู BLUEPRINT §6.4)
- [ ] เขียน `S3-HANDOFF.md`: สิ่งที่เทสต์แล้ว/ยัง + ขั้นตอนตัดยอดที่เหลือ

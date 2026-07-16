# 🚧 v3/ — โซนทดสอบ V3 UI (ผู้ใช้จริงยังไม่เห็น)

หน้าใน `v3/` คือหน้าโฉมใหม่ที่**กำลังทำ** — ยังไม่ตัดยอด ไม่มีลิงก์จากหน้าจริงชี้เข้ามา
เข้าทดสอบผ่าน URL ตรง เช่น `https://keatudom.github.io/DSTR-PM-V2/v3/dashboard.html`

**asset อ้างด้วย `../`** (ไฟล์กลางอยู่ที่ root): `../css/design-system.css`, `../js/*.js`, `../vendor/lucide/lucide.min.js`
ตอนตัดยอด: ย้ายไฟล์ `v3/x.html` → `x.html` (root) แล้วแก้ `../` → `./` ตาม checklist ใน `docs/v3-ui-migration/BLUEPRINT.md` §4

- `demo.html` = หน้าโชว์ทุก component ของ design system + shell (ไว้เช็คสายตา ไม่ตัดยอด)

ดูพิมพ์เขียว: `docs/v3-ui-migration/BLUEPRINT.md` + `SESSIONS.md`

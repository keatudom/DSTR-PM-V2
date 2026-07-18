# 📋 materials.html — Feature Inventory (Parity Checklist สำหรับ S5)

> ไฟล์ต้นทาง: `materials.html` 3,404 บรรทัด · ~90 ฟังก์ชัน · entry = `loadAll()` L1184 · 🔴 ช่าง/สโตร์ใช้ · ไม่มี mockup
> `FEATURE_MAT_QUICKLOG=false` (L1161) → แท็บ Quick Log ซ่อน (โค้ดคงไว้) — v3 ไม่ต้องทำแท็บ ql
> **แบ่ง 3 chapter** (ใหญ่กว่า daily)

## 📌 Progress
- **Chapter 1 ✅ (commit ถัดไป)** — โครง+แท็บ + **Stock tab เต็ม** (filter/list COUNT+STATUS/quick-set สถานะ optimistic/badge นับ-สถานะ) + **รายละเอียดวัสดุ** (modal + gallery รูป: view/add/delete) + alerts banner+modal · แท็บ รับ/เบิก/นับ/ประวัติ = stub soon-box · verified: 89 วัสดุ(17 STATUS+72 COUNT), filter, detail+รูป, alerts 21, mobile, 0 error · ⚠️ quickSetStatus/upload/delete รูป = เขียน DB เลี่ยงตอน dev
- **Chapter 2 ✅ (commit ถัดไป)** — ธุรกรรม 3 แท็บ (รับ/เบิก/นับ COUNT+STATUS) + material picker + populateSelects + สแกนบิล AI + CRUD วัสดุ (เพิ่ม/แก้/ลบ 2 ระดับ) · verified mobile: picker 89 วัสดุ, ฟอร์มสลับ COUNT/STATUS, dropdown ทีม4/FF19, new-material modal (prefill+2โหมด), 0 error · แทน native confirm (selectNmMode/doDeleteMaterial)→Modal.confirm · pickMaterial เอา Modal.close ออก (กัน race) · ⚠️ submit ทุกตัว = เขียน DB เลี่ยงตอน dev → UAT · รายละเอียดฟังก์ชันเดิม:
  - รับ: `submitReceive` L2280 (COUNT+STATUS `setRcvStatus`/`onReceiveMatChange`) · สแกนบิล AI: `onBillSelected` L1644/`renderBillScanResult`/`updateBillItem`/`confirmBillScan`/`cancelBillScan`
  - เบิก: `submitWithdraw` L2323 (+dropdown ทีม/FF `populateSelects` L1809)
  - นับ: `submitCount` L2362 (COUNT+STATUS `setCntStatus`/`onCountMatChange` + รูป `onCountPhotoSelected`/`renderCountPhotoPreviews`/`removeCountPhoto`)
  - material picker (ใช้ทั้ง 3 แท็บ): `openMatPicker` L1839/`onMatPickerSearch`/`setMatPickerCat`/`renderMatPickerList`/`pickMaterial`/`addMaterialFromPicker`/`setMatPickField`/`syncMatPickLabel`/`onRcvMatPicked`/`onWdrMatPicked`/`onCntMatPicked`
  - CRUD วัสดุ (แทน stub): `openNewMaterialModal` L2432/`openEditMaterialModal`/`renderMaterialModal`/`selectNmMode`/`submitNewMaterial` L2613/`openDeleteMaterialModal`/`doDeactivateMaterial`/`doDeleteMaterial` · `applyMatFeatureFlags` L2748
  - Quick Log AI (ถ้าเปิด flag): `parseQuickLog` L1997/`renderAiConfirmation`/`removeAiItem`/`updateAiItemQty`/`resolveClarif`/`createMaterialFromClarif`/`guessMaterialName`/`cancelAi`/`confirmAi` · `useExample`
- **Chapter 3 ⏳** — ประวัติธุรกรรม (mat history ~400 บรรทัด): `loadMatHistory` L2804/`fetchMatHistory`/`renderMatHistory` L2959/`renderMatHistTx`/`loadMoreMatHist`/`openMatHistDetail` + filter (`setMatHistRange`/`setMatHistType`/date custom `openMatHistDateModal`/`applyMatHistCustomDate`/mat picker `openMatHistMatPicker`) + helper `mh*` (date/format L3292-3392) · `matHistState`

## 6 แท็บ (บนลงล่าง)
Stock (หลัก, default) · รับ · เบิก · นับ · ประวัติ · [Quick Log ซ่อน flag]

## API (parity)
`get_materials`·`get_contractors`·`get_teams`·`get_ff_list`·`get_ai_alerts`·`get_material_photos`·`get_material_transactions`·`changeMaterialStatus`·`receive_material`·`withdraw_material`·`count_material`·`confirm_material_log`·`create_material`·`upload_photo`·`delete_photo`·`scan_bill`·`confirm_bill_items`·`parse_material_log`

## matState
`materials contractors teams ffs alerts stockFilter parsedItems parsedClarif cntSelectedStatus countPhotos` + `matHistState` (Ch3)

## ⚠️ ข้อควรระวัง
1. `changeMaterialStatus` (quick-set บนการ์ด STATUS) = optimistic + revert ถ้าล้ม — รักษา
2. native `confirm()` (`deleteThisPhoto` L1576, doDelete/doDeactivate material) → Modal.confirm (Ch1 แก้ deleteThisPhoto แล้ว · Ch2 แก้ที่เหลือ)
3. COUNT vs STATUS 2 โหมด — ฟอร์มรับ/นับ สลับ field ตาม tracking_mode
4. hardcode `?project=bow-house` ใน nav/กลับ → state.projectId (v3 ใช้ shell แล้ว)
5. อีโมจิ category (🪵⚡🔩🧴📋) + สถานะ (🔴🟡🔵🟢) = data-ish คงไว้ · tab/chrome → Lucide
6. Quick Log แท็บ `FEATURE_MAT_QUICKLOG=false` — v3 ไม่ทำ (แต่ parse_material_log ยังใช้ใน daily)

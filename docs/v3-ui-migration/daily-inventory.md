# 📋 daily.html — Feature Inventory (Parity Checklist สำหรับ S4)

> ไฟล์ต้นทาง: `daily.html` 2,929 บรรทัด · 61 ฟังก์ชัน · entry = `loadAll()` L620
> หน้าเสี่ยงสูงสุด (🔴 ช่างใช้ทุกวัน) · ไม่มี mockup → ออกแบบผิวเองตาม design system · **flow การกรอกต้องเดิมเป๊ะ**
> ⚠️ **ห้ามเปลี่ยน `checkin_action` กลับเป็น `action`** (memory `project-cf-action-param-collision`) — L1038, L1079

## Flow หลัก 4 ขั้น (หัวใจ — ห้ามเปลี่ยนลำดับ)
1. **เช็คอินทีม** — chips ทีม + ปุ่ม −/+ ปรับจำนวนคน (`teamChips` / `renderTeamChips` L977, `toggleTeamCheckin` L1018, `adjustTeamQty` L1061)
2. **(อยู่ใน composer)** เลือก F + ทีมที่ทำ — `ffChips`/`selTeamChips` (`renderFFChips` L1111, `selectFF` L1144, `renderSelTeamChips` L1170, `toggleSelTeam` L1191)
3. **พิมพ์ log → บันทึก** — textarea + ปุ่มบันทึก (`submitLog` L1390); ถ้าเลือก F/ทีม = structured, ถ้าไม่เลือก = AI ช่วยแท็ก
4. **เบิกวัสดุ** (ปุ่มแยก) — bottom-sheet picker → จำนวน → confirm (`openMaterialDraw` L2044 ...)

## Sections (บนลงล่าง) + id
| Section | id | render fn |
|---|---|---|
| Header + วันที่ + บทบาทผู้รายงาน | `#hdrDate #hdrSub #hdrRoleBtn` | `renderRoleHeader` L544, `updateHeaderDate` L738 |
| Date bar (◀ ▶ 📅) | `#reportDate #dateNext` | `dateNav` L744, `dateToday` L755 |
| Stats (tasks/รับ/เบิก/ทีม) | `#statTasks #statRcv #statWdr #statCtr` | `loadStats` L761, `renderStats` L770 |
| Team check-in bar | `#teamBar #teamChips #teamBarCnt` | `renderTeamChips` L977, `syncTeamStat` L1096 |
| Composer strip (คำใบ้ flow) | `.dr-comp-strip` | static |
| Structured picker (F + ทีม) | `#ffChips #selTeamChips` | `renderFFChips` L1111, `renderSelTeamChips` L1170 |
| Textarea + echo | `#logInput #compEcho` | `updateComposerEcho` L1201 |
| Photo preview | `#photoPreview` | `onPhotoSelected` L1308, `removePhoto` L1379 |
| Quick tags (ทางลัด) + mic + เบิกวัสดุ + ส่ง | `.dr-comp-tags #micBtn` | `quickInsert` L1234, `onMicClick` L1248 |
| Timeline filters + list | `#timeline .dr-tl-filters` | `loadFeed` L780, `renderFeed` L792, `renderLog` L861, `setFilter` L1222 |
| Sticky summary pill (AI สรุปวัน) | `#stickyWrap #summPanel #stickyBar` | `toggleSummary` L2669, `genSummary` L2685 |
| Bottom nav | `.bnav` | static (→ shell) |

## 61 ฟังก์ชัน จัดกลุ่ม
**บทบาทผู้รายงาน:** `getReporterSource` `setReporterRole` `renderRoleHeader` `openRolePicker` `pickRole` `roleBadgeHtml` (L535-620) · `REPORTER_ROLES` L528
**โหลด/รีเฟรช:** `loadAll` L620 (cache localStorage ctrs/ffs/teams), `refresh` L706, `updateHeaderDate` `dateNav` `dateToday`
**Stats + Feed:** `loadStats` `renderStats` · `loadFeed` `renderFeed` `renderLog` `fmtLogTime` `escapeHtml`
**เช็คอินทีม (ขั้น1):** `hydrateCheckins` L967, `renderTeamChips`, `toggleTeamCheckin` (⚠️`checkin_action`), `adjustTeamQty` (⚠️`checkin_action`), `syncTeamStat`
**Picker F/ทีม (ขั้น3):** `renderFFChips` `expandFFChips` `selectFF` `applyTeamDefault` `renderSelTeamChips` `toggleSelTeam` `updateComposerEcho` · `FF_VISIBLE_COUNT`
**ทางลัด/เสียง/รูป:** `setFilter` `toggleTagsMore` `quickInsert` · `onMicClick` (Web Speech API) · `onPhotoClick` `onPhotoSelected` `compressImage` `removePhoto`
**บันทึก log + AI parse:** `submitLog` L1390, `submitStructuredLog` L1437 (optimistic + upload photo retry), `retryOptimisticLog` L1539, `showAiConfirmModal` L1561, `resolveAmbiguous` `cancelLog` `confirmLog` L1653
**Unknowns (ctr/mat ที่ AI ไม่รู้จัก):** `showUnknownsModal` L1795, `addContractor` `skipUnknownCtr` `gotoAddMaterial` `finishUnknowns`
**ติ๊ก task อัตโนมัติ:** `checkTaskSuggestion` L1909, `showTaskTickModal` `confirmTaskTick`
**เบิกวัสดุ (ขั้น4):** `drMatIcon` `ensureMaterials` `openMaterialDraw` `openMatPicker` `onMatPickerSearch` `setMatPickerCat` `renderMatPickerList` `pickMaterial` `onDrawMatPicked` `showWithdrawQtyModal` `drBackToMatPicker` `drAdjustWdQty` `drOnWdQtyInput` `drSelectWdStatus` `drSubmitWithdraw` `showWithdrawConfirmCard` `drCancelWithdraw` `drConfirmWithdraw` `drRetryWithdraw` (L2024-2453)
**Material intent (จากพิมพ์):** `checkMaterialSuggestion` L2454, `saveFallbackLog`, `showMaterialModal` `skipMaterialModal` `confirmMaterialItems` `showStockWarningModal` `cancelMaterialConfirm` `proceedMaterial` `forceMaterial` `doConfirmMaterial`
**สรุป AI (sticky):** `toggleSummary` `genSummary` `checkSavedSummary` `toggleEditSummary` `saveSummary` `copySummary`
**รายงาน (modal):** `openReportModal` L2787, `copyReportText` `openSummaryFromReport`
**ลบ/แก้ log:** `deleteLog` L2871, `untickTask` L2886
**helper วันที่:** `formatThaiDate` `thaiDayName`

## API ที่ต้องยังเรียกได้ (parity)
`API.callRead` · `API.callWrite` · `API.callPost` · `API.teamCheckin` (⚠️ param `checkin_action`) · `API.uploadLogPhoto`
> actions ที่ callRead/Write/Post เรียก (ต้องไล่เก็บตอนพอร์ต): daily_bundle, get_stats, get_feed, parse ai, get_materials, withdraw, tick task, gen_summary, save_summary, get_saved_summary, add_contractor ฯลฯ

## drState (18 field — พก state ทั้งก้อน) — L585
`date logs stats filter contractors ffs teams checkins teamBusy selFF selTeams ffExpanded teamDefaultApplied optimistic pendingLog summExpanded summText summEditing taskCandidates selectedTaskId matItems materials matLoaded matPicker wdDraft unknownCtrs unknownMats pendingPhoto pendingPhotoUrl pendingPhotoDriveId recognition recording`

## ⚠️ ข้อควรระวังพิเศษ
1. **`checkin_action` ห้ามเปลี่ยนเป็น `action`** (ชนชื่อ route CF) — L1038, L1079
2. **Optimistic UI** — log/withdraw โผล่ทันทีก่อน API ตอบ + retry ถ้าล้ม (`optimistic` state) — ต้องรักษา
3. **localStorage cache** — ctrs/ffs/teams cache (loadAll) กันโหลดซ้ำ · บทบาทผู้รายงาน (`getReporterSource`) เก็บ local
4. **Web Speech API** (mic) — พูดแล้วเป็นข้อความ · เช็ค SR support ก่อน
5. **compressImage** ก่อน upload (เหมือน dashboard task photo)
6. **อีโมจิใน quick tags** (🌧️⚠️⏸️🌅🌆) = ข้อความ insert เข้า textarea → **คงไว้** (เป็น data ที่ช่างพิมพ์ ไม่ใช่ UI chrome)
7. hardcode `?project=bow-house` ใน nav/ปุ่มกลับ (L387, L510-512) → ใช้ state.projectId
8. หลายอีโมจิใน UI chrome (📜📊👥🏠📷🎤📦) → Lucide (ตาม ICON-MAP) — แต่อีโมจิใน log data จาก backend คงไว้

// ============================================================
// export.gs — 🆕 CF migration (additive-only)
// action `export_all`: ดัมป์ค่าดิบของแท็บใดแท็บหนึ่ง {tab, headers, rows}
// ให้ seed script (cf-api/seed/export-import.mjs) ดูดเข้า D1
//
// กติกา (BLUEPRINT §1 ข้อ 3): additive-only — ไม่แก้/ลบของเดิม
// gate ด้วย ADMIN_PASSWORD (ส่งผ่าน param `password`)
// วันที่ (Date cell) แปลงเป็น string wall-clock โซนไทย กัน JSON.stringify(Date)=UTC เพี้ยน
// ============================================================
function exportAll_(p) {
  var pw = p && (p.password || p.admin_password);
  if (pw !== ADMIN_PASSWORD) throw new Error('unauthorized: admin password required');

  var tab = p && p.tab;
  if (!tab) throw new Error('tab required');

  var ss = SpreadsheetApp.openById(SHEETS_ID);
  var sh = ss.getSheetByName(tab);
  if (!sh) { try { sh = findSheet_(ss, tab); } catch (e) {} }
  if (!sh) throw new Error('Sheet not found: ' + tab);

  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { tab: tab, headers: [], rows: [], count: 0 };

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var tz = ss.getSpreadsheetTimeZone() || 'Asia/Bangkok';

  var headers = values[0].map(function (h) { return String(h); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // ข้ามแถวว่างสนิท (กันแถวท้ายที่ Sheets นับ lastRow เกิน)
    var hasData = row.some(function (v) { return v !== null && v !== '' && v !== undefined; });
    if (!hasData) continue;
    rows.push(row.map(function (v) { return _exportCell_(v, tz); }));
  }
  return { tab: tab, headers: headers, rows: rows, count: rows.length };
}

// แปลงค่า cell ให้ปลอดภัยต่อ JSON: Date → string โซนไทย, อื่นๆ ส่งตรง
function _exportCell_(v, tz) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var hhmmss = Utilities.formatDate(v, tz, 'HH:mm:ss');
    if (hhmmss === '00:00:00') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
    return Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
  }
  return v;
}

// รายชื่อแท็บที่ seed จะไล่ดูด (ให้ seed เรียก export_tabs เพื่อรู้รายชื่อจริง แทน hardcode)
function exportTabs_(p) {
  var pw = p && (p.password || p.admin_password);
  if (pw !== ADMIN_PASSWORD) throw new Error('unauthorized: admin password required');
  var ss = SpreadsheetApp.openById(SHEETS_ID);
  return {
    tabs: ss.getSheets().map(function (s) {
      return { name: s.getName(), rows: Math.max(0, s.getLastRow() - 1), cols: s.getLastColumn() };
    }),
  };
}

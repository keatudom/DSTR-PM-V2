// ============================================================
// ⏰ CHECK-IN / TIMESHEET — ลงเวลาหน้างาน (เฟส 1)
// ============================================================
// แก้ pain point: รายงาน Daily = พิสูจน์ "งาน" แต่ HR ต้องการพิสูจน์ "คน/เวลา"
// → ให้แต่ละคนเช็คอินเอง (เวลา + GPS + งานที่ทำ + โน้ต + รูป) เป็นหลักฐานเบิกเงิน
//
// โมเดล: เช็คอินเป็น "ช่วงเวลา" 3 รอบ (ผ่อนปรน — เผื่อสายนิดหน่อย)
//   เช้า 08:00-08:30 · กลางวัน 13:00-13:30 · เย็น 17:00-17:30
//   กดในช่วง = ตรงเวลา · เลยช่วง = ยังเช็คอินได้ แต่ติดป้าย "นอกช่วง" (เบาๆ ไม่ตราหน้า)
//
// GPS: เทียบระยะกับพิกัดไซต์ (29_SiteConfig) → ถ้าไกลเกินรัศมี + บอกว่า "อยู่ไซต์" = ติดธง
//   แต่ถ้าเลือก "งานนอกไซต์ + เหตุผล" (รับวัสดุ/พบเจ้าบ้าน/WFH ฯลฯ) = ป้ายกำกับ ไม่ติดธง
//
// reuse: getSheet/appendRow/generateId/_getCurrentProjectId_/_filterByProject_ จาก Code.js
// ============================================================

var CHECKIN_SHEET_ = '28_CheckIns';
var SITECONFIG_SHEET_ = '29_SiteConfig';

var CHECKIN_HEADERS_ = [
  'checkin_id', 'project_id', 'staff_id', 'staff_name', 'role',
  'date', 'time', 'ts', 'period', 'on_time',
  'location_type', 'off_site_reason', 'distance_m', 'is_far',
  'lat', 'lng', 'accuracy', 'activity', 'ff_code', 'note', 'photo_url', 'created_at'
];
var SITECONFIG_HEADERS_ = [
  'project_id', 'site_lat', 'site_lng', 'radius_m', 'updated_at', 'updated_by'
];

// ช่วงเวลาเช็คอิน (default — ปรับต่อโครงการได้ภายหลัง)
var CHECKIN_WINDOWS_ = [
  { key: 'morning', label: 'เช้า',     start: '08:00', end: '08:30', bucketEnd: '11:00' },
  { key: 'noon',    label: 'กลางวัน',  start: '13:00', end: '13:30', bucketEnd: '15:00' },
  { key: 'evening', label: 'เย็น',     start: '17:00', end: '17:30', bucketEnd: '23:59' }
];
var DEFAULT_RADIUS_M_ = 150;

// ── helper: เปิด/สร้าง sheet + header ครั้งแรก ──────────────
function _getOrCreateSheet_(name, headers) {
  var ss = SpreadsheetApp.openById(SHEETS_ID);
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#1F3864').setFontColor('#ffffff');
  }
  return sh;
}

function _hhmmToMin_(hhmm) {
  var p = String(hhmm).split(':');
  return parseInt(p[0], 10) * 60 + parseInt(p[1] || '0', 10);
}

// ระบุรอบ (period) + ตรงเวลาไหม จากเวลา HH:mm
function _classifyTime_(hhmm) {
  var t = _hhmmToMin_(hhmm);
  for (var i = 0; i < CHECKIN_WINDOWS_.length; i++) {
    var w = CHECKIN_WINDOWS_[i];
    if (t <= _hhmmToMin_(w.bucketEnd)) {
      return { period: w.key, label: w.label, on_time: t <= _hhmmToMin_(w.end) };
    }
  }
  var last = CHECKIN_WINDOWS_[CHECKIN_WINDOWS_.length - 1];
  return { period: last.key, label: last.label, on_time: false };
}

// ระยะทาง haversine (เมตร)
function _haversineM_(lat1, lon1, lat2, lon2) {
  var R = 6371000;
  var toRad = function (d) { return d * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── พิกัดไซต์ของโครงการ ────────────────────────────────────
function getSiteLocation_(p) {
  var pid = _getCurrentProjectId_() || 'bow-house';
  var sh = _getOrCreateSheet_(SITECONFIG_SHEET_, SITECONFIG_HEADERS_);
  var rows = getAllRows(SITECONFIG_SHEET_);
  var row = null;
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].project_id) === String(pid)) { row = rows[i]; break; }
  }
  if (!row || row.site_lat === '' || row.site_lat === undefined) {
    return { configured: false, project_id: pid, radius_m: DEFAULT_RADIUS_M_, windows: CHECKIN_WINDOWS_ };
  }
  return {
    configured: true,
    project_id: pid,
    site_lat: Number(row.site_lat),
    site_lng: Number(row.site_lng),
    radius_m: Number(row.radius_m || DEFAULT_RADIUS_M_),
    windows: CHECKIN_WINDOWS_,
    updated_at: row.updated_at || '',
    updated_by: row.updated_by || ''
  };
}

function setSiteLocation_(p) {
  var pid = _getCurrentProjectId_() || 'bow-house';
  if (p.site_lat === undefined || p.site_lng === undefined) {
    throw new Error('ต้องระบุพิกัด (site_lat, site_lng)');
  }
  var sh = _getOrCreateSheet_(SITECONFIG_SHEET_, SITECONFIG_HEADERS_);
  var data = sh.getDataRange().getValues();
  var headers = data[0];
  var pidIdx = headers.indexOf('project_id');
  var rowIdx = -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][pidIdx]) === String(pid)) { rowIdx = i + 1; break; }
  }
  var rowObj = {
    project_id: pid,
    site_lat: Number(p.site_lat),
    site_lng: Number(p.site_lng),
    radius_m: Number(p.radius_m || DEFAULT_RADIUS_M_),
    updated_at: nowStr(),
    updated_by: p.updated_by || 'admin'
  };
  if (rowIdx === -1) {
    appendRow(SITECONFIG_SHEET_, rowObj);
  } else {
    SITECONFIG_HEADERS_.forEach(function (h, c) {
      sh.getRange(rowIdx, c + 1).setValue(rowObj[h]);
    });
  }
  return { ok: true, site: rowObj };
}

// ── สร้างเช็คอิน 1 รายการ ───────────────────────────────────
function createCheckin_(p) {
  p = p || {};
  var pid = _getCurrentProjectId_() || 'bow-house';
  var name = String(p.staff_name || '').trim();
  if (!name) throw new Error('ต้องระบุชื่อผู้เช็คอิน');

  _getOrCreateSheet_(CHECKIN_SHEET_, CHECKIN_HEADERS_);
  ensureColumn_(CHECKIN_SHEET_, 'ts');        // epoch ms — แหล่งเวลาที่เชื่อถือได้ (ไม่โดน Sheets coerce)
  ensureColumn_(CHECKIN_SHEET_, 'accuracy');  // ค่าความแม่น GPS (เมตร) ของการเช็คอินนี้

  var now = new Date();
  var ts = now.getTime();
  var date = Utilities.formatDate(now, 'Asia/Bangkok', 'yyyy-MM-dd');
  var time = Utilities.formatDate(now, 'Asia/Bangkok', 'HH:mm');
  var cls = _classifyTime_(time);

  // ระยะจากไซต์ (ถ้าตั้งพิกัดไว้ + มี GPS)
  var site = getSiteLocation_();
  var distance = '';
  var isFar = false;
  var hasGps = (p.lat !== undefined && p.lat !== '' && p.lng !== undefined && p.lng !== '');
  if (site.configured && hasGps) {
    distance = _haversineM_(Number(p.lat), Number(p.lng), site.site_lat, site.site_lng);
    isFar = distance > site.radius_m;
  }

  var locType = (p.location_type === 'offsite') ? 'offsite' : 'onsite';
  // ติดธง = บอกว่าอยู่ไซต์ แต่ GPS ไกลเกินรัศมี (offsite ที่แจ้งเหตุผล = ไม่ติดธง)
  var flagged = (locType === 'onsite' && isFar);

  var id = generateId('CK', CHECKIN_SHEET_, 'checkin_id');
  var row = {
    checkin_id: id,
    project_id: pid,
    staff_id: p.staff_id || '',
    staff_name: name,
    role: p.role || '',
    date: date,
    time: time,
    ts: ts,
    period: cls.period,
    on_time: cls.on_time ? 'TRUE' : 'FALSE',
    location_type: locType,
    off_site_reason: (locType === 'offsite') ? (p.off_site_reason || 'อื่นๆ') : '',
    distance_m: distance,
    is_far: isFar ? 'TRUE' : 'FALSE',
    lat: hasGps ? Number(p.lat) : '',
    lng: hasGps ? Number(p.lng) : '',
    accuracy: (hasGps && p.accuracy !== undefined && p.accuracy !== '') ? Number(p.accuracy) : '',
    activity: p.activity || '',
    ff_code: p.ff_code || '',
    note: p.note || '',
    photo_url: p.photo_url || '',
    created_at: nowStr()
  };
  appendRow(CHECKIN_SHEET_, row);

  // auto-log (ภายใน) — ไม่หลุดข้อมูลส่วนตัวเกินจำเป็น
  var locTxt = (locType === 'offsite')
    ? ('นอกไซต์ · ' + row.off_site_reason)
    : (flagged ? 'แจ้งอยู่ไซต์ แต่ GPS ไกล ' + distance + ' ม. 🚩' : 'อยู่ไซต์');
  autoLog_('⏰ ' + name + ' เช็คอิน ' + cls.label + ' ' + time +
    (cls.on_time ? '' : ' (นอกช่วง)') + ' · ' + locTxt,
    { meta: { kind: 'checkin', checkin_id: id, period: cls.period, flagged: flagged } });

  return {
    ok: true,
    checkin: row,
    classified: cls,
    distance_m: distance,
    is_far: isFar,
    flagged: flagged,
    site_configured: site.configured
  };
}

// ลบเช็คอิน (รายการทดสอบ/กดผิด) — by checkin_id
function deleteCheckin_(p) {
  if (!p || !p.checkin_id) throw new Error('checkin_id required');
  var sh = getSheet(CHECKIN_SHEET_);
  var data = sh.getDataRange().getValues();
  var idIdx = data[0].indexOf('checkin_id');
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idIdx]) === String(p.checkin_id)) {
      sh.deleteRow(i + 1);
      return { ok: true, deleted: p.checkin_id };
    }
  }
  throw new Error('ไม่พบเช็คอิน: ' + p.checkin_id);
}

// แปลงค่าเวลาให้เป็น "HH:mm" (กันกรณีอ่านกลับมาเป็น Date จาก legacy row)
function _fmtTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Bangkok', 'HH:mm');
  return String(v || '');
}

// ── อ่านเช็คอิน (scope project + filter) ────────────────────
function _mapCheckin_(r) {
  // วัน-เวลาคำนวณจาก ts (epoch) — เชื่อถือได้ ไม่โดน Sheets coerce
  // fallback: row เก่าที่ไม่มี ts → ใช้คอลัมน์ date/time เดิม
  var ts = (r.ts !== '' && r.ts !== undefined && r.ts !== null) ? Number(r.ts) : null;
  var dateStr = ts ? Utilities.formatDate(new Date(ts), 'Asia/Bangkok', 'yyyy-MM-dd') : formatDateValue(r.date);
  var timeStr = ts ? Utilities.formatDate(new Date(ts), 'Asia/Bangkok', 'HH:mm') : _fmtTime_(r.time);
  return {
    checkin_id: r.checkin_id,
    staff_id: r.staff_id || '',
    staff_name: r.staff_name || '',
    role: r.role || '',
    date: dateStr,
    time: timeStr,
    period: r.period || '',
    on_time: String(r.on_time).toUpperCase() === 'TRUE',
    location_type: r.location_type || 'onsite',
    off_site_reason: r.off_site_reason || '',
    distance_m: (r.distance_m === '' || r.distance_m === undefined) ? null : Number(r.distance_m),
    is_far: String(r.is_far).toUpperCase() === 'TRUE',
    accuracy: (r.accuracy === '' || r.accuracy === undefined) ? null : Number(r.accuracy),
    activity: r.activity || '',
    ff_code: r.ff_code || '',
    note: r.note || '',
    photo_url: r.photo_url || ''
  };
}

function getCheckins_(p) {
  p = p || {};
  var pid = _getCurrentProjectId_() || 'bow-house';
  var rows;
  try { rows = getAllRows(CHECKIN_SHEET_); }
  catch (e) { return []; }  // sheet ยังไม่มี → ว่าง
  var out = _filterByProject_(rows, pid).map(_mapCheckin_);

  if (p.staff_id) out = out.filter(function (c) { return String(c.staff_id) === String(p.staff_id); });
  if (p.staff_name) out = out.filter(function (c) { return c.staff_name === p.staff_name; });
  if (p.date) out = out.filter(function (c) { return c.date === p.date; });
  if (p.from) out = out.filter(function (c) { return c.date >= p.from; });
  if (p.to) out = out.filter(function (c) { return c.date <= p.to; });

  out.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1; // ใหม่ก่อน
    return a.time < b.time ? 1 : -1;
  });
  return out;
}

// ── ใบลงเวลา: รวมต่อคน → ต่อวัน → 3 รอบ ─────────────────────
function getTimesheet_(p) {
  p = p || {};
  var list = getCheckins_({ from: p.from, to: p.to, staff_id: p.staff_id, staff_name: p.staff_name });

  // group: staff → date → entries
  var byStaff = {};
  list.forEach(function (c) {
    var sk = c.staff_id || c.staff_name || '?';
    if (!byStaff[sk]) byStaff[sk] = { staff_id: c.staff_id, staff_name: c.staff_name, role: c.role, days: {} };
    if (!byStaff[sk].days[c.date]) byStaff[sk].days[c.date] = [];
    byStaff[sk].days[c.date].push(c);
  });

  var staffArr = Object.keys(byStaff).map(function (sk) {
    var s = byStaff[sk];
    var days = Object.keys(s.days).sort().map(function (d) {
      var entries = s.days[d].slice().sort(function (a, b) { return a.time < b.time ? -1 : 1; });
      var periods = {};
      CHECKIN_WINDOWS_.forEach(function (w) {
        var e = entries.filter(function (x) { return x.period === w.key; })[0] || null;
        periods[w.key] = e ? { time: e.time, on_time: e.on_time, location_type: e.location_type } : null;
      });
      return {
        date: d,
        entries: entries,
        periods: periods,
        present: entries.length > 0,
        offsite_count: entries.filter(function (x) { return x.location_type === 'offsite'; }).length,
        flagged_count: entries.filter(function (x) { return x.is_far && x.location_type === 'onsite'; }).length
      };
    });
    return {
      staff_id: s.staff_id, staff_name: s.staff_name, role: s.role,
      days: days,
      days_present: days.length
    };
  });

  staffArr.sort(function (a, b) { return (a.staff_name || '').localeCompare(b.staff_name || ''); });
  return { from: p.from || '', to: p.to || '', windows: CHECKIN_WINDOWS_, staff: staffArr };
}

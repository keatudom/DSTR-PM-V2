// ============================================================
// 💬 PHASE H-3b — LINE NOTIFICATIONS (Official Account + Messaging API)
// ============================================================
// บอทบริษัท (LINE OA) push แจ้งเตือนเข้า:
//   - กลุ่ม LINE ทีม  (LINE_GROUP_ID)  — เรื่องสำคัญเด้งทันที + สรุปเย็น
//   - แชท 1:1 เจ้าของ (LINE_OWNER_UID) — เงิน/สัญญา ส่วนตัว
//
// id ของกลุ่ม/เจ้าของ จับอัตโนมัติผ่าน webhook (ตอนบอทถูกเชิญเข้ากลุ่ม /
// มีคนทักบอท) — ดู lineWebhook_ (เรียกจาก handle() ใน Code.js)
//
// กันรำคาญ: เฉพาะ event "สำคัญ" เท่านั้นที่ push (เงิน/สัญญา/ความเสี่ยงสูง/
// รายงาน) · งานจุกจิก (เบิกของ/ติ๊กงาน) อยู่ในกระดิ่งพอ + รวมในสรุปเย็น
//
// ⚠️ ข้อจำกัด Apps Script: อ่าน header (x-line-signature) ไม่ได้ →
// verify ลายเซ็น LINE ไม่ได้ (ยอมรับได้สำหรับ use case นี้ — แค่จับ id + push)
// ============================================================

// เว็บ (GitHub Pages) — สำหรับแปะลิงก์ใน digest ให้กดดูต่อ
var LINE_WEB_BASE = 'https://keatudom.github.io/DSTR-PM-V2';

function _lineToken_() { return _readSecret_('LINE_TOKEN', ''); }

function _linePush_(to, text) {
  var token = _lineToken_();
  if (!token || !to) return false;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ to: to, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      muteHttpExceptions: true
    });
    return res.getResponseCode() === 200;
  } catch (e) { return false; }
}

function _lineReply_(replyToken, text) {
  var token = _lineToken_();
  if (!token || !replyToken) return;
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ replyToken: replyToken, messages: [{ type: 'text', text: text }] }),
      muteHttpExceptions: true
    });
  } catch (e) {}
}

function _lineBroadcast_(text) {
  var token = _lineToken_();
  if (!token) return false;
  try {
    var res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/broadcast', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': 'Bearer ' + token },
      payload: JSON.stringify({ messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }),
      muteHttpExceptions: true
    });
    return res.getResponseCode() === 200;
  } catch (e) { return false; }
}

// ── ส่งแจ้งเตือน (เรียกจาก event สำคัญ) — fail-safe ไม่ทำให้ parent พัง ──
function _lineNotifyImportant_(text) {
  try {
    var gid = _readSecret_('LINE_GROUP_ID', '');
    if (gid) return _linePush_(gid, '🔔 ' + text);
  } catch (e) {}
  return false;
}

function _lineNotifyOwner_(text) {
  try {
    var uid = _readSecret_('LINE_OWNER_UID', '');
    if (uid) return _linePush_(uid, '💼 ' + text);
  } catch (e) {}
  return false;
}

// ============================================================
// 📥 WEBHOOK — จับ groupId / ownerUid อัตโนมัติ
// (เรียกจาก handle() เมื่อ body เป็น LINE webhook: {destination, events:[...]})
// ============================================================
function lineWebhook_(body) {
  var events = (body && body.events) || [];
  var props = PropertiesService.getScriptProperties();
  for (var i = 0; i < events.length; i++) {
    var ev = events[i] || {};
    var src = ev.source || {};

    if (src.type === 'group' && src.groupId) {
      // ⭐ ตอบ "เชื่อมแล้ว" แค่ครั้งแรก (id ใหม่) — หลังจากนั้นเงียบสนิท ไม่ยุ่งกับแชท
      var curG = props.getProperty('LINE_GROUP_ID') || '';
      if (curG !== src.groupId) {
        props.setProperty('LINE_GROUP_ID', src.groupId);
        if (ev.replyToken) {
          _lineReply_(ev.replyToken, '✅ เชื่อมกลุ่มนี้กับระบบ DSTR แล้ว\nจะแจ้งเฉพาะ "เรื่องสำคัญ" + สรุปเย็นวันละครั้ง — ไม่กวนแชทปกติครับ');
        }
      }
      // id เดิมแล้ว → ไม่ตอบอะไร (คนในกลุ่มพิมพ์ได้ตามสบาย)

    } else if (src.type === 'user' && src.userId) {
      var curU = props.getProperty('LINE_OWNER_UID') || '';
      if (curU !== src.userId) {
        props.setProperty('LINE_OWNER_UID', src.userId);
        if (ev.replyToken) {
          _lineReply_(ev.replyToken, '✅ เชื่อมบัญชีแล้ว\nจะส่งแจ้งเตือนส่วนตัว (เงิน/สัญญา) ให้ที่นี่');
        }
      }
      // id เดิมแล้ว → เงียบ
    }
  }
}

// ============================================================
// 📊 DAILY DIGEST — สรุปกิจกรรมวันนี้เข้ากลุ่ม (เรียกจาก time trigger)
// ============================================================
// 👉 ฟังก์ชัน "สาธารณะ" (ไม่มีขีดล่าง) สำหรับเลือกในหน้า Triggers / ปุ่ม Run
//    (Apps Script ซ่อนฟังก์ชันที่ลงท้าย _ จาก dropdown ของ trigger)
function runDailyDigest() {
  return lineDailyDigest_();
}

function _thaiDate_(ymd) {
  try {
    var m = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
    var p = String(ymd).split('-');
    if (p.length === 3) return parseInt(p[2],10) + ' ' + m[parseInt(p[1],10)-1] + ' ' + (parseInt(p[0],10)+543);
  } catch (e) {}
  return ymd;
}

function lineDailyDigest_() {
  var gid = _readSecret_('LINE_GROUP_ID', '');
  if (!gid) return { ok: false, reason: 'no group' };

  var today = todayStr();

  // 1) activity วันนี้ — นับภาพรวม
  var rows = [];
  try {
    rows = getAllRows(SHEET.ACTIVITY).filter(function (r) {
      return formatDateValue(r.date) === today || String(r.date) === today;
    });
  } catch (e) {}

  var c = { task: 0, withdraw: 0, receive: 0, count: 0, daily: 0, contract: 0, risk: 0 };
  rows.forEach(function (r) {
    var t = String(r.text || '');
    if (t.indexOf('เสร็จ') >= 0 || t.indexOf('✓') >= 0) c.task++;
    else if (t.indexOf('เบิก') >= 0) c.withdraw++;
    else if (t.indexOf('รับ') >= 0 && t.indexOf('รับเงิน') < 0) c.receive++;
    else if (t.indexOf('นับ') >= 0) c.count++;
    else if (t.indexOf('รายงาน') >= 0) c.daily++;
    else if (t.indexOf('สัญญา') >= 0 || t.indexOf('งวด') >= 0) c.contract++;
    else if (t.indexOf('เสี่ยง') >= 0) c.risk++;
  });

  // 2) รายงานประจำวันวันนี้ — เนื้อหาให้ AI เขียนบทความ
  var reports = [];
  try {
    reports = getAllRows(SHEET.DAILY).filter(function (r) {
      return formatDateValue(r.date) === today || String(r.date) === today;
    });
  } catch (e) {}

  // 3) AI เขียน "บทความสรุป" จาก daily report + activity (มี fallback ถ้า AI ล่ม)
  var narrative = '';
  try {
    if (reports.length || rows.length) {
      var material = '';
      reports.forEach(function (r) {
        material += '- ผู้รายงาน ' + (r.reporter_name || '-') +
          ' | อากาศ ' + (r.weather || '-') + ' | คนงาน ' + (r.workers_count || 0) + '\n' +
          '  งานที่ทำ: ' + (r.tasks_done || r.summary_text || '-') +
          (r.issues ? '\n  ปัญหา: ' + r.issues : '') + '\n';
      });
      var actLines = rows.slice(0, 20).map(function (r) { return '- ' + String(r.text || ''); }).join('\n');

      var prompt =
        'คุณคือผู้ช่วยเขียนสรุปงานก่อสร้าง/เฟอร์นิเจอร์บิ้วอินประจำวัน ' +
        'เขียนเป็น "บทความสั้น" 3-5 ประโยค ภาษาไทยกระชับ เป็นกันเอง อ่านลื่น เหมาะส่งในกลุ่ม LINE ทีม ' +
        'สรุปจากข้อมูลจริงด้านล่างเท่านั้น ห้ามแต่งเติมเกินข้อมูล ถ้าข้อมูลน้อยให้เขียนสั้นๆ ' +
        'เขียนเฉพาะเนื้อบทความ ห้ามมีหัวข้อ/bullet/คำทักทาย/อิโมจิเยอะ\n\n' +
        '[รายงานประจำวันหน้างาน]\n' + (material || '(ไม่มีรายงานวันนี้)') + '\n\n' +
        '[กิจกรรมในระบบวันนี้]\n' + (actLines || '(ไม่มี)') + '\n\nบทความสรุป:';

      narrative = String(callGemini(prompt) || '').trim();
    }
  } catch (e) { narrative = ''; }

  // 4) ประกอบข้อความ: หัว + บทความ AI + ภาพรวมตัวเลข + ลิงก์เว็บ
  var lines = ['📊 สรุปประจำวัน ' + _thaiDate_(today)];
  if (narrative) { lines.push(''); lines.push(narrative); }

  var ov = [];
  if (c.task) ov.push('✅ ติ๊กงาน ' + c.task);
  if (c.withdraw || c.receive) ov.push('📦 เบิก ' + c.withdraw + '/รับ ' + c.receive);
  if (c.contract) ov.push('🧾 สัญญา/งวด ' + c.contract);
  if (c.daily) ov.push('📝 รายงาน ' + c.daily);
  if (c.risk) ov.push('⚠️ เสี่ยง ' + c.risk);
  lines.push('');
  lines.push('— ภาพรวม —');
  lines.push(ov.length ? ov.join(' · ') : 'วันนี้ยังไม่มีกิจกรรมบันทึก');
  lines.push('รวม ' + rows.length + ' รายการ');

  lines.push('');
  lines.push('🔗 ดูรายงานเต็ม: ' + LINE_WEB_BASE + '/daily.html');

  _linePush_(gid, lines.join('\n'));
  return { ok: true, total: rows.length, has_narrative: !!narrative, reports: reports.length };
}

// ============================================================
// 🔧 SETUP / TEST ENDPOINTS (owner only — ADMIN cap)
// ============================================================
function setLineConfig_(p) {
  var props = PropertiesService.getScriptProperties();
  // ใช้ line_token (ไม่ใช่ token) — กันชนกับ auth_token/token ของระบบ login
  var tok = p.line_token || p.token;
  if (tok) props.setProperty('LINE_TOKEN', String(tok).trim());
  if (p.secret) props.setProperty('LINE_CHANNEL_SECRET', String(p.secret).trim());
  return { ok: true, has_token: !!_lineToken_() };
}

function lineStatus_() {
  return {
    has_token: !!_lineToken_(),
    group_linked: !!_readSecret_('LINE_GROUP_ID', ''),
    owner_linked: !!_readSecret_('LINE_OWNER_UID', '')
  };
}

// ส่งข้อความทดสอบ — target: 'group' | 'owner' | 'broadcast'
function lineTest_(p) {
  var target = (p && p.target) || 'broadcast';
  var text = (p && p.text) || '✅ ทดสอบ DSTR แจ้งเตือน — ระบบ LINE พร้อมใช้งานแล้ว';
  if (target === 'group') {
    var gid = _readSecret_('LINE_GROUP_ID', '');
    if (!gid) return { ok: false, reason: 'ยังไม่ได้เชื่อมกลุ่ม — เชิญบอทเข้ากลุ่มแล้วพิมพ์อะไรในกลุ่มก่อน' };
    return { ok: _linePush_(gid, '🔔 ' + text) };
  }
  if (target === 'owner') {
    var uid = _readSecret_('LINE_OWNER_UID', '');
    if (!uid) return { ok: false, reason: 'ยังไม่ได้เชื่อมเจ้าของ — ทักบอท 1:1 ก่อน' };
    return { ok: _linePush_(uid, '💼 ' + text) };
  }
  return { ok: _lineBroadcast_(text), mode: 'broadcast' };
}

// ติดตั้ง trigger สรุปเย็น (วันละครั้ง ~18:30) — idempotent
// 👉 รันฟังก์ชันนี้จากหน้า Apps Script editor (ปุ่ม Run) ครั้งเดียว — จะขออนุญาต
//    สิทธิ์ ScriptApp ให้เอง แล้วตั้ง trigger ~18:30 น. (เผื่อหน้างานบันทึกช่วงเย็น)
function installLineDigestTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lineDailyDigest_') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lineDailyDigest_').timeBased().everyDays(1)
    .atHour(18).nearMinute(30).create();
  return { ok: true, scheduled: 'ทุกวัน ~18:30 น.' };
}

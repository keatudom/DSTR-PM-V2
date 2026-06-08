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
function lineDailyDigest_() {
  var gid = _readSecret_('LINE_GROUP_ID', '');
  if (!gid) return { ok: false, reason: 'no group' };

  var today = todayStr();
  var rows = [];
  try {
    rows = getAllRows(SHEET.ACTIVITY).filter(function (r) {
      return formatDateValue(r.date) === today || String(r.date) === today;
    });
  } catch (e) {}
  if (!rows.length) return { ok: true, skipped: 'no activity today' };

  var c = { task: 0, withdraw: 0, receive: 0, count: 0, daily: 0, contract: 0, risk: 0, other: 0 };
  rows.forEach(function (r) {
    var t = String(r.text || '');
    if (t.indexOf('เสร็จ') >= 0 || t.indexOf('✓') >= 0) c.task++;
    else if (t.indexOf('เบิก') >= 0) c.withdraw++;
    else if (t.indexOf('รับ') >= 0 && t.indexOf('รับเงิน') < 0) c.receive++;
    else if (t.indexOf('นับ') >= 0) c.count++;
    else if (t.indexOf('รายงาน') >= 0) c.daily++;
    else if (t.indexOf('สัญญา') >= 0 || t.indexOf('งวด') >= 0) c.contract++;
    else if (t.indexOf('เสี่ยง') >= 0) c.risk++;
    else c.other++;
  });

  var lines = ['📊 สรุปวันนี้ (' + today + ')'];
  if (c.task) lines.push('✅ ติ๊กงานเสร็จ ' + c.task);
  if (c.withdraw || c.receive) lines.push('📦 เบิกของ ' + c.withdraw + ' · รับของ ' + c.receive);
  if (c.contract) lines.push('🧾 สัญญา/งวด ' + c.contract);
  if (c.daily) lines.push('📝 รายงานประจำวัน ' + c.daily);
  if (c.risk) lines.push('⚠️ ความเสี่ยง ' + c.risk);
  lines.push('— รวม ' + rows.length + ' รายการ · ดูละเอียดในแอป 🔔');

  _linePush_(gid, lines.join('\n'));
  return { ok: true, total: rows.length };
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

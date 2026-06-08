// ============================================================
// 🔔 PHASE H — NOTIFICATIONS
// ============================================================
// ต่อยอดจาก 17_Activity_Logs (event stream ที่มี auto-log อยู่แล้ว)
// + actor stamping (Phase H-1 ใน appendActivityLog_)
//
// get_notifications: คืน event ล่าสุดของโครงการปัจจุบัน (ข้ามวัน)
//   พร้อม actor ("ใครทำ") — frontend คำนวณ unread เองจาก localStorage
//   last-seen ต่อโครงการ (read-state per device — พอสำหรับทีมเล็ก)
//
// delivery: กระดิ่งในแอป (H-3a) ก่อน · LINE push (H-3b) ตามมา
// ============================================================

/**
 * get_notifications — event ล่าสุด (scoped by project) สำหรับกระดิ่งแจ้งเตือน
 * params: limit (default 40)
 * returns: { events: [{ log_id, timestamp, type, source, actor, actor_role, kind, text }] }
 */
function getNotifications_(p) {
  ensureActivitySheet_();
  var pid = _getCurrentProjectId_() || 'bow-house';
  var sheet = findSheet_(SpreadsheetApp.openById(SHEETS_ID), SHEET.ACTIVITY);
  if (!sheet) return { events: [] };

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return { events: [] };

  var headers = data[0];
  var col = {};
  headers.forEach(function (h, i) { col[String(h).trim()] = i; });
  var pidCol = headers.indexOf('project_id');

  var limit = Number((p && p.limit) || 40);
  var out = [];

  // เดินจากล่าง (ใหม่สุด) ขึ้นบน
  for (var i = data.length - 1; i >= 1 && out.length < limit; i--) {
    var r = data[i];

    // scope ตามโครงการ — bow-house รวม row ที่ project_id ว่าง (legacy)
    if (pidCol !== -1) {
      var rpid = String(r[pidCol] || '').trim();
      if (!(rpid === pid || (pid === 'bow-house' && rpid === ''))) continue;
    }

    var meta = {};
    try { meta = JSON.parse(r[col['meta_json']] || '{}') || {}; } catch (e) {}

    var ts = r[col['timestamp']];
    var tsStr = (ts instanceof Date) ? ts.toISOString() : String(ts || '');

    out.push({
      log_id: r[col['log_id']],
      timestamp: tsStr,
      type: String(r[col['type']] || ''),     // manual | auto
      source: String(r[col['source']] || ''),
      actor: meta.actor || '',                  // "ใครทำ" (ชื่อจาก token)
      actor_role: meta.actor_role || '',
      kind: meta.kind || '',                    // contract|milestone|risk|eval|daily|...
      text: String(r[col['text']] || '')
    });
  }

  return { events: out };
}

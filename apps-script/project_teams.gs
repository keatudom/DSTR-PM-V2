// ============================================================
// 👷 PROJECT TEAMS — ผูกทีม/ช่างเข้าโครงการ (many-to-many)
// ============================================================
// 21_Teams = master ช่างทั้งหมด (shared) · 29_Project_Teams = ทีมไหนอยู่โครงการไหน
// ใช้กรอง Daily report ให้ติ๊กเฉพาะช่างในโครงการนั้น
// pattern เดียวกับ 27_Project_Staff (staff↔project)
// schema: assignment_id, project_id, team_id, active, added_at
// ============================================================

var PROJECT_TEAMS_SHEET = '29_Project_Teams';

function ensureProjectTeamsSheet_() {
  var ss = SpreadsheetApp.openById(SHEETS_ID);
  var sheet = ss.getSheetByName(PROJECT_TEAMS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PROJECT_TEAMS_SHEET);
    sheet.appendRow(['assignment_id', 'project_id', 'team_id', 'active', 'added_at']);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#1F3864').setFontColor('#fff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// team_id[] ของทีมที่ active ในโครงการ (ใช้กรอง)
function _projectTeamIds_(projectId) {
  if (!projectId) return [];
  var out = [];
  try {
    ensureProjectTeamsSheet_();
    getAllRows(PROJECT_TEAMS_SHEET).forEach(function (a) {
      if (String(a.project_id) === String(projectId) &&
          a.active !== false && a.active !== 'FALSE') {
        out.push(String(a.team_id));
      }
    });
  } catch (e) {}
  return out;
}

// get_project_teams — ทีมในโครงการ (join ชื่อ/ประเภทจาก 21_Teams) — สำหรับหน้า Team
function getProjectTeams_(p) {
  var pid = (p && p.project_id) || _getCurrentProjectId_() || 'bow-house';
  ensureProjectTeamsSheet_();
  var assigns = getAllRows(PROJECT_TEAMS_SHEET).filter(function (a) {
    return String(a.project_id) === String(pid) && a.active !== false && a.active !== 'FALSE';
  });
  if (!assigns.length) return [];

  var teamMap = {};
  getAllRows(SHEET.TEAMS).forEach(function (t) { teamMap[String(t.team_id)] = t; });

  return assigns.map(function (a) {
    var t = teamMap[String(a.team_id)] || {};
    return {
      assignment_id: a.assignment_id,
      team_id: a.team_id,
      name: t.name || '(ไม่พบทีม)',
      type: t.type || '',
      lead_name: t.lead_name || '',
      phone: t.phone || ''
    };
  });
}

// assign_project_team — เพิ่มทีมเข้าโครงการ (กัน duplicate)
function assignProjectTeam_(p) {
  if (!p.team_id) throw new Error('team_id required');
  var pid = p.project_id || _getCurrentProjectId_() || 'bow-house';
  ensureProjectTeamsSheet_();

  var existing = getAllRows(PROJECT_TEAMS_SHEET).find(function (a) {
    return String(a.project_id) === String(pid) && String(a.team_id) === String(p.team_id) &&
           a.active !== false && a.active !== 'FALSE';
  });
  if (existing) return { ok: true, assignment_id: existing.assignment_id, duplicate: true };

  var id = generateId('PT', PROJECT_TEAMS_SHEET, 'assignment_id');
  // append แบบ array (sheet นี้ไม่มี column project_id แบบ stamp อัตโนมัติของ B-4 — ใส่เอง)
  getSheet(PROJECT_TEAMS_SHEET).appendRow([id, pid, p.team_id, true, nowStr()]);
  return { ok: true, assignment_id: id };
}

// unassign_project_team — ถอดทีมออกจากโครงการ (soft delete)
function unassignProjectTeam_(p) {
  if (!p.assignment_id) throw new Error('assignment_id required');
  ensureProjectTeamsSheet_();
  updateRowByCol(PROJECT_TEAMS_SHEET, 'assignment_id', p.assignment_id, { active: false });
  return { ok: true, assignment_id: p.assignment_id };
}

// delete_team — ลบทีม (soft delete active=false กัน reference สัญญา/เช็คอินพัง)
// + ถอดออกจากทุกโครงการ
function deleteTeam_(p) {
  if (!p.team_id) throw new Error('team_id required');
  updateRowByCol(SHEET.TEAMS, 'team_id', p.team_id, { active: false });
  try {
    ensureProjectTeamsSheet_();
    getAllRows(PROJECT_TEAMS_SHEET).forEach(function (a) {
      if (String(a.team_id) === String(p.team_id) && a.active !== false && a.active !== 'FALSE') {
        updateRowByCol(PROJECT_TEAMS_SHEET, 'assignment_id', a.assignment_id, { active: false });
      }
    });
  } catch (e) {}
  return { ok: true, team_id: p.team_id, deactivated: true };
}

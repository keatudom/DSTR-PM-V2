// ============================================================
// router.ts — action → handler map (149 ชื่อเดิม; Session 1 มี ping+auth)
// handler คืน "object ดิบ" (inner data) — index.ts ห่อ {ok,data} ตามกติกา wrapper
// Session 2 เพิ่ม case ที่เหลือจาก INVENTORY.md
// ============================================================
import type { Env } from './lib/env.ts';
import * as auth from './modules/auth.ts';
import * as checkin from './modules/checkin.ts'; // Session 2 — โมดูล 1
import * as ffTasks from './modules/ff_tasks.ts'; // Session 2 — โมดูล 2
import * as projects from './modules/projects.ts'; // Session 2 — โมดูล 3
import * as materials from './modules/materials.ts'; // Session 2 — โมดูล 4
import * as risks from './modules/risks.ts'; // Session 2 — โมดูล 8
import * as evals from './modules/evals.ts'; // Session 2 — โมดูล 9
import * as daily from './modules/daily.ts'; // Session 2 — โมดูล 5
import * as teamsFinance from './modules/teams_finance.ts'; // Session 2 — โมดูล 6
import * as qc from './modules/qc.ts'; // ★ Session 3 — QC Checklist

export async function route(env: Env, action: string, p: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case 'ping':
      return { pong: true, time: new Date().toISOString() };

    // 📊 getAll ‼raw (Code.js:621) — aggregate สำหรับ dashboard เก่า — Session 2
    case 'getAll':
      return ffTasks.getAll(env, p);

    // 👷 TEAMS / CONTRACTS / MILESTONES / STAFF / CLIENT-FINANCE — Session 2 โมดูล 6
    case 'get_teams_bundle':
      return teamsFinance.getTeamsBundle(env, p);
    case 'get_teams':
      return teamsFinance.getTeamsAction(env, p);
    case 'team_checkin':
      return teamsFinance.teamCheckin(env, p);
    case 'create_team':
      return teamsFinance.createTeam(env, p);
    case 'update_team':
      return teamsFinance.updateTeam(env, p);
    case 'delete_team':
      return teamsFinance.deleteTeam(env, p);
    case 'get_project_teams':
      return teamsFinance.getProjectTeams(env, p);
    case 'assign_project_team':
      return teamsFinance.assignProjectTeam(env, p);
    case 'unassign_project_team':
      return teamsFinance.unassignProjectTeam(env, p);
    case 'create_contract':
      return teamsFinance.createContract(env, p);
    case 'update_contract':
      return teamsFinance.updateContract(env, p);
    case 'create_milestone':
      return teamsFinance.createMilestone(env, p);
    case 'update_milestone':
      return teamsFinance.updateMilestone(env, p);
    case 'create_staff':
      return teamsFinance.createStaff(env, p);
    case 'update_staff':
      return teamsFinance.updateStaff(env, p);
    case 'get_all_staff':
      return teamsFinance.getAllStaff(env);
    case 'get_project_staff':
      return teamsFinance.getProjectStaff(env, p);
    case 'assign_project_staff':
      return teamsFinance.assignProjectStaff(env, p);
    case 'unassign_project_staff':
      return teamsFinance.unassignProjectStaff(env, p);
    case 'get_client_finance':
      return teamsFinance.getClientFinance(env, p);
    case 'get_contractors':
      return teamsFinance.getContractorsAction(env, p);
    case 'create_contractor':
      return teamsFinance.createContractor(env, p);
    case 'detect_unknowns':
      return teamsFinance.detectUnknowns(env, p);

    // 🔐 AUTH (auth.gs + login Code.js:894)
    case 'login':
      return auth.login(env, p);
    case 'login_google':
      return auth.loginGoogle(env, p);
    case 'get_me':
      return auth.getMe(env, p);
    case 'get_users':
      return auth.getUsers(env);
    case 'upsert_user':
      return auth.upsertUser(env, p);
    case 'set_user_role':
      return auth.setUserRole(env, p);

    // 📝 DAILY / ACTIVITY / AI (Code.js) — Session 2 โมดูล 5
    case 'get_daily_reports':
      return daily.getDailyReports(env, p);
    case 'get_daily_report':
      return daily.getDailyReport(env, p);
    case 'create_daily':
      return daily.createDaily(env, p);
    case 'auto_detect_daily':
      return daily.autoDetectDaily(env, p);
    case 'generate_daily_summary':
      return daily.generateDailySummary(env, p);
    case 'delete_daily':
      return daily.deleteDaily(env, p);
    case 'add_quick_log':
      return daily.addQuickLog(env, p);
    case 'ai_summary':
      return daily.aiSummary(env, p);
    case 'add_activity_log':
      return daily.addActivityLog(env, p);
    case 'get_activity_feed':
      return daily.getActivityFeed(env, p);
    case 'get_material_transactions':
      return daily.getMaterialTransactions(env, p);
    case 'delete_activity_log':
      return daily.deleteActivityLog(env, p);
    case 'untick_task_from_log':
      return daily.untickTaskFromLog(env, p);
    case 'generate_daily_summary_v2':
      return daily.generateDailySummaryV2(env, p);
    case 'save_ai_summary':
      return daily.saveAiSummary(env, p);
    case 'get_saved_summary':
      return daily.getSavedSummary(env, p);
    case 'parse_activity_text':
      return daily.parseActivityText(env, p);
    case 'suggest_task_from_log':
      return daily.suggestTaskFromLog(env, p);
    case 'confirm_task_tick':
      return daily.confirmTaskTick(env, p);
    case 'get_today_stats':
      return daily.getTodayStats(env, p);
    case 'get_daily_bundle':
      return daily.getDailyBundle(env, p);

    // 📊 EVALUATIONS (evaluations.gs) — Session 2 โมดูล 9
    case 'get_eval_config':
      return evals.getEvalConfig();
    case 'get_evals':
      return evals.getEvals(env, p);
    case 'get_eval_summary':
      return evals.getEvalSummary(env);
    case 'create_eval':
      return evals.createEval(env, p);
    case 'update_eval':
      return evals.updateEval(env, p);
    case 'delete_eval':
      return evals.deleteEval(env, p);

    // ⚠️ RISKS (risks.gs) — Session 2 โมดูล 8
    case 'create_risk':
      return risks.createRisk(env, p);
    case 'update_risk':
      return risks.updateRisk(env, p);
    case 'delete_risk':
      return risks.deleteRisk(env, p);
    case 'clone_risks':
      return risks.cloneRisks(env, p);

    // 📦 MATERIALS / BOQ / INVENTORY / AI (Code.js) — Session 2 โมดูล 4
    case 'get_suppliers':
      return materials.getSuppliers(env);
    case 'create_supplier':
      return materials.createSupplier(env, p);
    case 'get_materials':
      return materials.getMaterialsAction(env, p);
    case 'get_material':
      return materials.getMaterial(env, p);
    case 'create_material':
      return materials.createMaterial(env, p);
    case 'update_material':
      return materials.updateMaterial(env, p);
    case 'deactivate_material':
      return materials.deactivateMaterial(env, p);
    case 'delete_material':
      return materials.deleteMaterial(env, p);
    case 'get_transactions':
      return materials.getTransactionsAction(env, p);
    case 'receive_material':
      return materials.receiveMaterial(env, p);
    case 'withdraw_material':
      return materials.withdrawMaterial(env, p);
    case 'count_material':
      return materials.countMaterial(env, p);
    case 'parse_material_log':
      return materials.parseMaterialLog(env, p);
    case 'confirm_material_log':
      return materials.confirmMaterialLog(env, p);
    case 'check_stock_for_items':
      return materials.checkStockForItems(env, p);
    case 'get_boq':
      return materials.getBoqAction(env, p);
    case 'create_boq':
      return materials.createBOQ(env, p);
    case 'check_boq_status':
      return materials.checkBoqStatus(env, p);
    case 'get_inventory_summary':
      return materials.getInventorySummary(env, p);
    case 'update_material_prices':
      return materials.updateMaterialPrices(env, p);
    case 'get_ai_alerts':
      return materials.getAiAlerts(env, p);

    // 🏗️ PROJECTS registry (projects_patch.gs) — Session 2 โมดูล 3
    case 'get_projects':
      return projects.getProjects(env);
    case 'create_project':
      return projects.createProject(env, p);
    case 'update_project':
      return projects.updateProject(env, p);

    // 📋 FF / TASKS / PAYMENTS (Code.js + projects_wizard.gs) — Session 2 โมดูล 2
    case 'get_ff_list':
      return ffTasks.getFfListAction(env, p);
    case 'get_tasks':
      return ffTasks.getTasksAction(env, p);
    case 'updateTask': // ‼raw
      return ffTasks.updateTask(env, p);
    case 'updatePayment': // ‼raw
      return ffTasks.updatePayment(env, p);
    case 'create_payment':
      return ffTasks.createPayment(env, p);
    case 'update_payment_info':
      return ffTasks.updatePaymentInfo(env, p);
    case 'create_ff':
      return ffTasks.createFF(env, p);
    case 'create_ff_batch':
      return ffTasks.createFFBatch(env, p);
    case 'update_ff':
      return ffTasks.updateFF(env, p);
    case 'delete_ff':
      return ffTasks.deleteFF(env, p);
    case 'clone_project':
      return ffTasks.cloneProject(env, p);

    // ⏰ CHECK-IN / TIMESHEET (checkin.gs) — Session 2 โมดูล 1
    case 'create_checkin':
      return checkin.createCheckin(env, p);
    case 'get_checkins':
      return checkin.getCheckins(env, p);
    case 'get_timesheet':
      return checkin.getTimesheet(env, p);
    case 'get_attendance_all':
      return checkin.getAttendanceAll(env, p);
    case 'update_checkin':
      return checkin.updateCheckin(env, p);
    case 'set_id_card':
      return checkin.setIdCard(env, p);
    case 'get_site_location':
      return checkin.getSiteLocationAction(env, p);
    case 'set_site_location':
      return checkin.setSiteLocation(env, p);
    case 'delete_checkin':
      return checkin.deleteCheckin(env, p);

    // ✅ QC — Quality Checklist (Session 3, ฟีเจอร์ใหม่)
    case 'get_qc_criteria':
      return qc.getQcCriteria(env);
    case 'get_qc_inspections':
      return qc.getQcInspections(env, p);
    case 'get_qc_inspection':
      return qc.getQcInspection(env, p);
    case 'create_qc_inspection':
      return qc.createQcInspection(env, p);
    case 'update_qc_result':
      return qc.updateQcResult(env, p);
    case 'close_qc_inspection':
      return qc.closeQcInspection(env, p);
    case 'delete_qc_inspection':
      return qc.deleteQcInspection(env, p);
    case 'qc_summary':
      return qc.qcSummary(env, p);

    default:
      // Session 2 จะเติม 131 actions ที่เหลือ — ระหว่างนี้ error ชัดเจน
      throw new Error('Unknown action: ' + action);
  }
}

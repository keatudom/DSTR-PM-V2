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
import * as qc from './modules/qc.ts'; // ★ Session 3 — QC Checklist

export async function route(env: Env, action: string, p: Record<string, unknown>): Promise<unknown> {
  switch (action) {
    case 'ping':
      return { pong: true, time: new Date().toISOString() };

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

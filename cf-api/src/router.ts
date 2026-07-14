// ============================================================
// router.ts — action → handler map (149 ชื่อเดิม; Session 1 มี ping+auth)
// handler คืน "object ดิบ" (inner data) — index.ts ห่อ {ok,data} ตามกติกา wrapper
// Session 2 เพิ่ม case ที่เหลือจาก INVENTORY.md
// ============================================================
import type { Env } from './lib/env.ts';
import * as auth from './modules/auth.ts';

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

    default:
      // Session 2 จะเติม 131 actions ที่เหลือ — ระหว่างนี้ error ชัดเจน
      throw new Error('Unknown action: ' + action);
  }
}

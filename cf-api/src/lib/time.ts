// ============================================================
// time.ts — วันที่/เวลาโซนไทย (แทน Utilities.formatDate(..., 'Asia/Bangkok', ...))
// Worker รันบน UTC → เลื่อน +7 ชม. ก่อนตัดเอาส่วนวัน/เวลา
// ============================================================
const TZ_OFFSET_MS = 7 * 60 * 60 * 1000;

// 'YYYY-MM-DD' โซนไทย (แทน todayStr, Code.js:604)
export function todayStr(now: number = Date.now()): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

// 'YYYY-MM-DD HH:mm:ss' โซนไทย (แทน nowStr, Code.js:600)
export function nowStr(now: number = Date.now()): string {
  return new Date(now + TZ_OFFSET_MS).toISOString().slice(0, 19).replace('T', ' ');
}

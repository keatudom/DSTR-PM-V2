// ============================================================
// Env — bindings + vars + secrets ที่ Worker มองเห็น
// (ค่า secret ตั้งด้วย `wrangler secret put`; ค่า var อยู่ใน wrangler.toml [vars])
// ============================================================
export interface Env {
  // bindings
  DB: D1Database;
  MEDIA: R2Bucket;

  // vars (wrangler.toml)
  ALLOW_ANON_READ: string; // 'true' | 'false'
  ALLOWED_ORIGINS: string; // comma-separated
  GOOGLE_CLIENT_ID: string;

  // secrets (wrangler secret put) — optional ใน type เพราะ Session 1 ยังไม่ครบทุกตัว
  AUTH_SECRET: string;
  ADMIN_PASSWORD?: string;
  CLIENT_PASSWORD?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_VISION_MODEL?: string;
  LINE_TOKEN?: string;
  LINE_GROUP_ID?: string;
  LINE_GROUP_OPS_ID?: string;
  LINE_OWNER_UID?: string;
}

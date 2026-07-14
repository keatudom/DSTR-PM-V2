// ============================================================
// r2.ts — เก็บไฟล์ใหม่ลง R2 (แทน DriveApp) ตาม BLUEPRINT §4
//   key = <project>/<subtype>/<ts>_<name> · เสิร์ฟผ่าน route GET /media/<key>
//   ⛔ ต้องเปิด R2 (binding MEDIA) ก่อน — ตอนนี้ปิดใน wrangler.toml (Session 3 gate)
// ============================================================
import type { Env } from './env.ts';

// แยก data URL → { mime, bytes }
export function decodeDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  let b64 = String(dataUrl);
  let mime = 'application/octet-stream';
  const m = b64.match(/^data:([\w/\-.]+);base64,(.+)$/);
  if (m) { mime = m[1]; b64 = m[2]; }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

// อัปโหลดลง R2 → คืน { key, url } (url = /media/<key> ให้ frontend ประกอบกับ CF_API_URL)
export async function putMedia(env: Env, project: string, subtype: string, name: string, dataUrl: string): Promise<{ key: string; url: string; mime: string }> {
  if (!env.MEDIA) throw new Error('R2 (MEDIA) ยังไม่เปิด — ต้อง uncomment r2_buckets ใน wrangler.toml + wrangler r2 bucket create (Session 3 gate)');
  const { mime, bytes } = decodeDataUrl(dataUrl);
  const ts = Date.now();
  const safeName = String(name || 'file').replace(/[^\w.\-ก-๙]+/g, '_');
  const key = `${project}/${subtype}/${ts}_${safeName}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: mime } });
  return { key, url: '/media/' + key, mime };
}

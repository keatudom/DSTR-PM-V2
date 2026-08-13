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

// นามสกุลไฟล์จาก mime (ใช้ตอนย้ายรูปเก่าที่ชื่อไฟล์ต้นทางไม่มีนามสกุล)
function extOfMime(mime: string): string {
  const m = String(mime).toLowerCase();
  if (m.indexOf('png') >= 0) return '.png';
  if (m.indexOf('webp') >= 0) return '.webp';
  if (m.indexOf('gif') >= 0) return '.gif';
  if (m.indexOf('heic') >= 0 || m.indexOf('heif') >= 0) return '.heic';
  if (m.indexOf('pdf') >= 0) return '.pdf';
  return '.jpg';
}

// ── ดึงไฟล์จาก URL ภายนอก (Google Drive เดิม) มาเก็บลง R2 ──
// ใช้ครั้งเดียวตอนย้ายรูปเก่า (migrate_drive_photos) — ดู modules/gallery.ts
// ⚠️ Google ตอบ 200 + หน้า HTML เมื่อไฟล์ถูกลบ/ตั้งเป็นส่วนตัว → ต้องเช็ค content-type
//    ไม่งั้นจะได้ "รูป" ที่เปิดไม่ออกทับของเดิมโดยไม่รู้ตัว
export async function putMediaFromUrl(
  env: Env, project: string, subtype: string, name: string, srcUrl: string,
): Promise<{ key: string; url: string; mime: string; size: number }> {
  if (!env.MEDIA) throw new Error('R2 (MEDIA) ยังไม่เปิด');
  const res = await fetch(srcUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (dstr-media-migrator)' } });
  if (!res.ok) throw new Error('ดึงไฟล์ต้นทางไม่ได้: HTTP ' + res.status);
  const mime = (res.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
  if (!/^image\//i.test(mime) && !/pdf/i.test(mime)) {
    throw new Error('ต้นทางไม่ใช่ไฟล์รูป (อาจถูกลบหรือปิดสิทธิ์): ' + mime);
  }
  const buf = await res.arrayBuffer();
  if (!buf.byteLength) throw new Error('ไฟล์ต้นทางว่างเปล่า');
  const safeName = String(name || 'file').replace(/[^\w.\-ก-๙]+/g, '_') + extOfMime(mime);
  const key = `${project}/${subtype}/${safeName}`;
  await env.MEDIA.put(key, buf, { httpMetadata: { contentType: mime } });
  return { key, url: '/media/' + key, mime, size: buf.byteLength };
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

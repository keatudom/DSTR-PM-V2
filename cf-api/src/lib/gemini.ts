// ============================================================
// gemini.ts — เรียก Gemini API (port callGemini Code.js:1946 + callGeminiJSON_ 2774)
//   ต่างจากเดิม: ใช้ fetch แทน UrlFetchApp · โมเดล/คีย์จาก env (secrets)
//   ★ error message ภาษาไทยเดิมเป๊ะ (frontend อาจโชว์)
// ============================================================
import type { Env } from './env.ts';

export async function callGemini(env: Env, prompt: string): Promise<string> {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    model + ':generateContent?key=' + (env.GEMINI_API_KEY || '');
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    // maxOutputTokens 2048→8192: gemini-2.5-flash ใช้ token "คิดในใจ" (thinking) กินโควตา
    // → คำตอบ JSON ยาวๆ (needs_clarification หลาย option) โดนตัดกลางคัน → parse พัง
    // ขยายเพดานกัน truncation (ตรงเจตนาเดิม: ให้ parse สำเร็จ) · ดู deviation #9
    generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const code = res.status;
  const text = await res.text();

  if (code === 429) throw new Error('Gemini quota เต็ม/rate limit (HTTP 429) — รอสักครู่แล้วลองใหม่');
  if (code === 401 || code === 403) throw new Error('Gemini API key ไม่ถูกต้องหรือถูก revoke (HTTP ' + code + ')');
  if (code >= 500) throw new Error('Gemini server error (HTTP ' + code + ')');

  let data: Record<string, unknown>;
  try { data = JSON.parse(text); }
  catch { throw new Error('Gemini ตอบไม่ใช่ JSON: ' + text.slice(0, 200)); }

  if (data.error) {
    const e = data.error as { message?: string };
    throw new Error('Gemini error: ' + (e.message || JSON.stringify(data.error)));
  }
  const candidates = data.candidates as { content?: { parts?: { text?: string }[] }; finishReason?: string }[] | undefined;
  if (!candidates || candidates.length === 0) {
    const pf = data.promptFeedback as { blockReason?: string } | undefined;
    const reason = (pf && pf.blockReason) || 'ไม่ทราบสาเหตุ';
    throw new Error('Gemini ไม่ตอบ — ' + reason + ' (อาจเป็น content filter หรือ safety)');
  }
  const cand = candidates[0];
  if (!cand.content || !cand.content.parts || cand.content.parts.length === 0) {
    throw new Error('Gemini ตอบไม่มีเนื้อหา (finishReason: ' + (cand.finishReason || 'unknown') + ')');
  }
  return cand.content.parts[0].text || '';
}

// Gemini Vision (scan_bill Code.js:2386) — รูป inline_data + JSON response
export async function callGeminiVision(env: Env, prompt: string, mimeType: string, b64: string): Promise<unknown> {
  const model = env.GEMINI_VISION_MODEL || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + (env.GEMINI_API_KEY || '');
  const payload = {
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mimeType, data: b64 } }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (res.status !== 200) throw new Error('Gemini ' + res.status + ': ' + text.slice(0, 200));
  const result = JSON.parse(text) as { candidates: { content: { parts: { text: string }[] } }[] };
  return JSON.parse(result.candidates[0].content.parts[0].text);
}

// callGeminiJSON_ (Code.js:2774) — responseMimeType JSON แล้ว parse 2 ชั้น
export async function callGeminiJSON(env: Env, prompt: string): Promise<unknown> {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + (env.GEMINI_API_KEY || '');
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 8192, responseMimeType: 'application/json' },
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const text = await res.text();
  if (res.status !== 200) throw new Error('AI: ' + text.slice(0, 200));
  const result = JSON.parse(text) as { candidates: { content: { parts: { text: string }[] } }[] };
  return JSON.parse(result.candidates[0].content.parts[0].text);
}

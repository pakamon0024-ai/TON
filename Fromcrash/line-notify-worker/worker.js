// ===== Cloudflare Worker: ตัวกลางระหว่าง QA APP กับ LINE Messaging API =====
// ทำหน้าที่ 2 อย่างในไฟล์เดียว:
//
// (A) PUSH — แอป QA APP เรียก endpoint นี้ (path ใดก็ได้ที่ไม่ใช่ webhook ของ LINE) เพื่อส่ง
//     ข้อความแจ้งเตือนออกไปยัง LINE (บันทึก/แก้ไขเคสต่างๆ) — ทางเดียว แอป → LINE
// (B) WEBHOOK — LINE ยิง POST เข้ามาที่ endpoint เดียวกันนี้ (แยกจาก (A) ด้วย header
//     x-line-signature ที่มีเฉพาะคำขอจาก LINE) เวลามีคนพิมพ์ข้อความคุยกับบอท เพื่อให้ "ถาม
//     ข้อมูลจากไลน์" ได้ — บอทอ่านข้อมูลจาก Firebase Realtime Database แล้วตอบกลับ
//
// ทำไมต้องมี Worker คั่นทั้งสองทาง: LINE Messaging API (api.line.me) ไม่ส่ง CORS header ให้
// เบราว์เซอร์ ต้องมีตัวกลางฝั่งเซิร์ฟเวอร์เสมอ ต่างจาก Telegram ที่ยิงตรงจากเบราว์เซอร์ได้
//
// ของลับ (secrets) ที่ต้องตั้งใน Worker นี้ (Settings > Variables and Secrets) ไม่เก็บในไฟล์นี้:
//   LINE_CHANNEL_ACCESS_TOKEN   - Channel access token (ใช้ส่งข้อความออก ทั้ง push และ reply)
//   LINE_TARGET_ID              - userId/groupId ปลายทางของ (A) PUSH
//   LINE_CHANNEL_SECRET         - Channel secret (ใช้ตรวจลายเซ็น webhook ของ (B) เท่านั้น —
//                                 ถ้าไม่ตั้งค่านี้ (B) จะปิดใช้งานเอง ใช้ได้แค่ (A) ตามเดิม)
//   FIREBASE_SERVICE_ACCOUNT_JSON - เนื้อไฟล์ JSON ทั้งไฟล์ของ Firebase Service Account (วางทั้ง
//                                 ก้อนเป็น secret เดียว) ใช้ให้ (B) มีสิทธิ์อ่านข้อมูลจาก
//                                 Firebase (Security Rules ปิดการอ่านแบบไม่ล็อกอินไว้อยู่แล้ว)
//   FIREBASE_DB_URL             - (ไม่บังคับ) URL ของ Realtime Database ถ้าไม่ตั้งจะใช้ค่า
//                                 เริ่มต้นของโปรเจกต์ apt-insuarance ที่ฮาร์ดโค้ดไว้ด้านล่าง
//   SHARED_SECRET               - (ไม่บังคับ) รหัสลับที่ (A) ต้องแนบมาด้วย กันคนอื่นเผลอยิง
//                                 endpoint นี้เล่น ไม่เกี่ยวกับ (B) เพราะ (B) ตรวจด้วย LINE
//                                 signature อยู่แล้ว
//
// วิธี deploy ทั้งสองส่วนดูที่ README.md ในโฟลเดอร์นี้

const DEFAULT_FIREBASE_DB_URL = 'https://apt-insuarance-default-rtdb.asia-southeast1.firebasedatabase.app';
const MAX_LINE_TEXT_LENGTH = 4900; // LINE จำกัดข้อความ text ไม่เกิน 5000 ตัวอักษรต่อ 1 ข้อความ

const HELP_TEXT = [
  'พิมพ์คำสั่งเหล่านี้คุยกับบอทได้เลยครับ (อ่านข้อมูลอย่างเดียว ไม่แก้ไขอะไร)',
  '',
  '📊 "เป่าวันนี้" — สรุปผลเป่าแอลกอฮอล์วันนี้',
  '📊 "เป่าเดือนนี้" — สรุปผลเป่าแอลกอฮอล์เดือนนี้',
  '🚨 "อุบัติเหตุวันนี้" — รายการอุบัติเหตุวันนี้',
  '🚨 "อุบัติเหตุเดือนนี้" — จำนวนอุบัติเหตุเดือนนี้',
].join('\n');

// ═══════════════════════════════════════════
// (A) ส่งข้อความออก (push จาก QA APP, และ reply กลับ webhook ของ LINE)
// ═══════════════════════════════════════════

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token, X-Line-Signature',
    ...extra,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: corsHeaders({ 'Content-Type': 'application/json' }) });
}

async function linePush(env, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ to: env.LINE_TARGET_ID, messages: [{ type: 'text', text: text.slice(0, MAX_LINE_TEXT_LENGTH) }] }),
  });
  if (!res.ok) throw new Error('LINE push error: ' + await res.text());
}

async function lineReply(env, replyToken, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, MAX_LINE_TEXT_LENGTH) }] }),
  });
  if (!res.ok) console.error('LINE reply error:', await res.text());
}

// ═══════════════════════════════════════════
// (B) Webhook — ตรวจลายเซ็นคำขอจาก LINE (HMAC-SHA256 ด้วย Channel Secret)
// ═══════════════════════════════════════════

async function verifyLineSignature(rawBody, signatureB64, channelSecret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(channelSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sigBuf = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return expected === signatureB64;
}

// ═══════════════════════════════════════════
// อ่านข้อมูลจาก Firebase Realtime Database ด้วย Service Account (Security Rules ปิดอ่าน
// แบบไม่ล็อกอินไว้ ต้องแลก access token จาก Google ก่อนทุกครั้ง — cache ไว้ในตัวแปรระดับ
// module กันขอ token ใหม่ทุกคำถาม แต่เป็นแค่ best-effort เพราะ Worker อาจถูกรีไอโซเลตได้)
// ═══════════════════════════════════════════

let cachedToken = null, cachedTokenExp = 0;

function base64url(bytesOrObj) {
  const str = bytesOrObj instanceof Uint8Array
    ? String.fromCharCode(...bytesOrObj)
    : JSON.stringify(bytesOrObj);
  return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function importServiceAccountKey(pem) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s+/g, '');
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey('pkcs8', bytes.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

async function getFirebaseAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedTokenExp > now + 60) return cachedToken;

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${base64url(header)}.${base64url(claim)}`;
  const key = await importServiceAccountKey(sa.private_key);
  const sigBuf = await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${base64url(new Uint8Array(sigBuf))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!res.ok) throw new Error('ขอ Firebase access token ไม่สำเร็จ: ' + JSON.stringify(data));

  cachedToken = data.access_token;
  cachedTokenExp = now + data.expires_in;
  return cachedToken;
}

async function fbGet(env, path) {
  const token = await getFirebaseAccessToken(env);
  const dbUrl = env.FIREBASE_DB_URL || DEFAULT_FIREBASE_DB_URL;
  const res = await fetch(`${dbUrl}${path}.json`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('อ่าน Firebase ไม่สำเร็จ: ' + await res.text());
  return res.json();
}

function toRows(obj) {
  if (!obj) return [];
  return Array.isArray(obj) ? obj.filter(Boolean) : Object.values(obj).filter(Boolean);
}

// เวลาใน Worker เป็น UTC เสมอ ต้องบวก 7 ชม. เพื่อให้ตรงกับวันที่แบบเวลาไทยที่แอปบันทึกไว้
function todayBangkokISO() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().substring(0, 10);
}

// ═══════════════════════════════════════════
// คำสั่งที่บอทตอบได้ (อ่านอย่างเดียว)
// ═══════════════════════════════════════════

async function alcoholSummary(env, scope) {
  const today = todayBangkokISO();
  const rows = toRows(await fbGet(env, '/alcoholTests')).filter(r =>
    scope === 'month' ? (r.date || '').startsWith(today.substring(0, 7)) : r.date === today
  );
  const label = scope === 'month' ? `เดือนนี้ (${today.substring(0, 7)})` : `วันนี้ (${today})`;
  if (rows.length === 0) return `ℹ️ ${label} ยังไม่มีการบันทึกผลเป่าแอลกอฮอล์`;
  const c = (field, val) => rows.filter(r => r[field] === val).length;
  return [
    `📊 สรุปผลเป่าแอลกอฮอล์ ${label}`,
    `บันทึกแล้ว: ${rows.length} รายการ`,
    `ขาไป: ผ่าน ${c('resultOut', 'ผ่าน')} / ไม่ผ่าน ${c('resultOut', 'ไม่ผ่าน')}`,
    `ขากลับ: ผ่าน ${c('resultReturn', 'ผ่าน')} / ไม่ผ่าน ${c('resultReturn', 'ไม่ผ่าน')}`,
  ].join('\n');
}

async function incidentSummary(env, scope) {
  const today = todayBangkokISO();
  const rows = toRows(await fbGet(env, '/incidents')).filter(r =>
    scope === 'month' ? (r.incidentDate || '').startsWith(today.substring(0, 7)) : r.incidentDate === today
  );
  const label = scope === 'month' ? `เดือนนี้ (${today.substring(0, 7)})` : `วันนี้ (${today})`;
  if (rows.length === 0) return `✅ ${label} ยังไม่มีอุบัติเหตุบันทึกไว้`;
  if (scope === 'month') return `🚨 อุบัติเหตุ ${label}: ${rows.length} เคส`;
  const list = rows.slice(0, 10).map(r => `- ${r.plate || '-'}${r.location ? ' @ ' + r.location : ''}`).join('\n');
  const more = rows.length > 10 ? `\n…และอีก ${rows.length - 10} เคส` : '';
  return `🚨 อุบัติเหตุ ${label}: ${rows.length} เคส\n${list}${more}`;
}

async function buildReplyText(env, text) {
  const t = (text || '').trim();
  try {
    if (t.includes('แอลกอฮอล์') || t.includes('เป่า')) return await alcoholSummary(env, t.includes('เดือน') ? 'month' : 'day');
    if (t.includes('อุบัติเหตุ')) return await incidentSummary(env, t.includes('เดือน') ? 'month' : 'day');
  } catch (e) {
    return '⚠️ ดึงข้อมูลไม่สำเร็จ: ' + e.message;
  }
  return HELP_TEXT;
}

async function handleLineWebhook(env, body) {
  const events = body?.events || [];
  for (const event of events) {
    if (event.type !== 'message' || event.message?.type !== 'text') continue;
    const replyText = await buildReplyText(env, event.message.text);
    await lineReply(env, event.replyToken, replyText);
  }
}

// ═══════════════════════════════════════════
// ENTRY POINT
// ═══════════════════════════════════════════

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);

    const rawBody = await request.text();
    const lineSignature = request.headers.get('x-line-signature');

    // ----- (B) คำขอนี้มาจาก LINE webhook -----
    if (lineSignature) {
      if (!env.LINE_CHANNEL_SECRET) return json({ error: 'webhook ยังไม่ได้ตั้งค่า LINE_CHANNEL_SECRET' }, 500);
      const validSig = await verifyLineSignature(rawBody, lineSignature, env.LINE_CHANNEL_SECRET);
      if (!validSig) return json({ error: 'invalid signature' }, 401);
      let body;
      try { body = JSON.parse(rawBody || '{}'); } catch { return json({ error: 'invalid JSON body' }, 400); }
      try {
        await handleLineWebhook(env, body);
      } catch (e) {
        console.error('handleLineWebhook error:', e);
      }
      // LINE ต้องการ 200 เร็วๆ ไม่สนเนื้อหา ตอบ OK เฉยๆ พอ
      return new Response('OK', { status: 200, headers: corsHeaders() });
    }

    // ----- (A) คำขอ push จาก QA APP -----
    if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_TARGET_ID) {
      return json({ error: 'worker ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_ID' }, 500);
    }
    if (env.SHARED_SECRET && request.headers.get('X-Auth-Token') !== env.SHARED_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }
    let body;
    try { body = JSON.parse(rawBody || '{}'); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const message = String(body?.message || '').trim();
    if (!message) return json({ error: 'missing "message"' }, 400);
    try {
      await linePush(env, message);
      return json({ ok: true });
    } catch (e) {
      return json({ error: e.message }, 502);
    }
  },
};

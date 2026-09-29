// ===== Cloudflare Worker: ตัวกลางส่งข้อความจาก QA APP ไปยัง LINE Messaging API =====
// ทำไมต้องมีตัวนี้: LINE Messaging API (api.line.me) ไม่ส่ง CORS header ให้เบราว์เซอร์
// ยิง fetch ตรงจากหน้าเว็บไปหา LINE จะโดนบล็อกเสมอ Worker นี้จึงทำหน้าที่รับข้อความจาก
// QA APP (browser) แล้วค่อยยิงต่อไปยัง LINE จากฝั่งเซิร์ฟเวอร์แทน (ไม่มีปัญหา CORS)
//
// ของลับ (secrets) ที่ต้องตั้งใน Worker นี้ ไม่เก็บในโค้ดไฟล์นี้เด็ดขาด:
//   LINE_CHANNEL_ACCESS_TOKEN  - Channel access token ของ LINE Official Account
//   LINE_TARGET_ID             - userId/groupId ปลายทางที่จะ push ข้อความไปหา
//   SHARED_SECRET              - (ไม่บังคับ) รหัสลับที่ QA APP ต้องแนบมาด้วย กันคนอื่นเผลอยิง
//                                 endpoint นี้เล่น ถ้าไม่ตั้งค่านี้ Worker จะไม่เช็คเลย
//
// วิธี deploy ดูที่ README.md ในโฟลเดอร์นี้

const MAX_LINE_TEXT_LENGTH = 4900; // LINE จำกัดข้อความ text ไม่เกิน 5000 ตัวอักษรต่อ 1 ข้อความ

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Auth-Token',
    ...extra,
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json' }),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method not allowed' }, 405);
    }
    if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_TARGET_ID) {
      return json({ error: 'worker ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_TARGET_ID' }, 500);
    }
    // กันคนอื่นเผลอยิง endpoint นี้เล่น ถ้าตั้ง SHARED_SECRET ไว้ ต้องแนบ header ให้ตรงกันเป๊ะ
    if (env.SHARED_SECRET && request.headers.get('X-Auth-Token') !== env.SHARED_SECRET) {
      return json({ error: 'unauthorized' }, 401);
    }

    let body;
    try { body = await request.json(); } catch { return json({ error: 'invalid JSON body' }, 400); }
    const message = String(body?.message || '').trim();
    if (!message) return json({ error: 'missing "message"' }, 400);

    try {
      const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`,
        },
        body: JSON.stringify({
          to: env.LINE_TARGET_ID,
          messages: [{ type: 'text', text: message.slice(0, MAX_LINE_TEXT_LENGTH) }],
        }),
      });
      const lineBodyText = await lineRes.text();
      if (!lineRes.ok) return json({ error: 'LINE API error', detail: lineBodyText }, 502);
      return json({ ok: true });
    } catch (e) {
      return json({ error: e.message }, 500);
    }
  },
};

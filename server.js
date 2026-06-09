require('dotenv').config();
const express  = require('express');
const cron     = require('node-cron');
const fetch    = require('node-fetch');
const FormData = require('form-data');
const fs       = require('fs');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Persistent storage path ──────────────────────────────────────────────────
// Use /data when running on Render (persistent disk), otherwise current dir
const DATA_DIR    = fs.existsSync('/data') ? '/data' : __dirname;
const QUEUE_FILE  = path.join(DATA_DIR, 'queue.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } })
  : null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeQueueRow(row) {
  return {
    id       : Number(row.id),
    topic    : row.topic,
    tone     : row.tone,
    schedTime: row.sched_time,
    status   : row.status,
    createdAt: row.created_at
  };
}

function toQueueRow(item) {
  return {
    id        : item.id,
    topic     : item.topic,
    tone      : item.tone,
    sched_time: item.schedTime,
    status    : item.status,
    created_at: item.createdAt
  };
}

function loadQueueFile() {
  try {
    if (!fs.existsSync(QUEUE_FILE)) return [];
    return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch { return []; }
}

function saveQueueFile(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2), 'utf8');
}

function loadConfigFile() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return {};
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch { return {}; }
}

function saveConfigFile(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

async function loadQueue() {
  if (!supabase) return loadQueueFile();

  const { data, error } = await supabase
    .from('post_queue')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    console.warn('[Supabase] loadQueue failed, using file fallback:', error.message);
    return loadQueueFile();
  }

  return (data || []).map(normalizeQueueRow);
}

async function saveQueue(queue) {
  if (!supabase) return saveQueueFile(queue);
  if (!queue.length) return;

  const { error } = await supabase
    .from('post_queue')
    .upsert(queue.map(toQueueRow), { onConflict: 'id' });

  if (error) {
    console.warn('[Supabase] saveQueue failed, using file fallback:', error.message);
    saveQueueFile(queue);
  }
}

async function deleteQueueItem(id) {
  if (!supabase) {
    const queue = loadQueueFile().filter(item => item.id !== id);
    saveQueueFile(queue);
    return;
  }

  const { error } = await supabase
    .from('post_queue')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

async function loadConfig() {
  if (!supabase) return loadConfigFile();

  const { data, error } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'default')
    .maybeSingle();

  if (error) {
    console.warn('[Supabase] loadConfig failed, using file fallback:', error.message);
    return loadConfigFile();
  }

  return data?.value || {};
}

async function saveConfig(cfg) {
  if (!supabase) return saveConfigFile(cfg);

  const { error } = await supabase
    .from('app_config')
    .upsert({ key: 'default', value: cfg, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) {
    console.warn('[Supabase] saveConfig failed, using file fallback:', error.message);
    saveConfigFile(cfg);
  }
}

// Merge env vars with saved config — env vars take priority
async function getKeys() {
  const cfg = await loadConfig();
  return {
    geminiKey : process.env.GEMINI_API_KEY || cfg.geminiKey || '',
    fbPageId  : process.env.FB_PAGE_ID     || cfg.fbPageId  || '',
    fbToken   : process.env.FB_TOKEN       || cfg.fbToken   || '',
    gemGemId  : cfg.gemGemId || ''
  };
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/config — tell frontend which env vars are set
app.get('/api/config', async (req, res) => {
  const keys = await getKeys();
  res.json({
    hasGeminiKey : !!keys.geminiKey,
    hasFbConfig  : !!(keys.fbPageId && keys.fbToken),
    hasSupabase  : !!supabase
  });
});

// POST /api/config — save keys to config.json (easy token refresh)
app.post('/api/config', async (req, res) => {
  try {
    const { fbToken, fbPageId, gemGemId, geminiKey } = req.body || {};
    const cfg = await loadConfig();
    if (fbToken   !== undefined) cfg.fbToken   = fbToken;
    if (fbPageId  !== undefined) cfg.fbPageId  = fbPageId;
    if (gemGemId  !== undefined) cfg.gemGemId  = gemGemId;
    if (geminiKey !== undefined) cfg.geminiKey = geminiKey;
    await saveConfig(cfg);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate — call Gemini to produce caption + imagePrompt
app.post('/api/generate', async (req, res) => {
  try {
    const { topic, tone, extraHashtags, geminiKey: bodyKey } = req.body || {};
    const cfg = await loadConfig();
    const geminiKey = process.env.GEMINI_API_KEY || bodyKey || cfg.geminiKey || '';

    if (!geminiKey) return res.status(400).json({ error: 'ไม่พบ Gemini API Key — ตั้งค่าใน Render env หรือส่งมาใน body.geminiKey' });
    if (!topic)     return res.status(400).json({ error: 'กรุณาระบุ topic' });

    const hashtagLine = extraHashtags ? `รวมถึง ${extraHashtags} ในแฮชแท็กด้วย` : '';
    const prompt = `ตอบกลับเป็น JSON เท่านั้น ไม่ต้องมีข้อความอื่น ไม่ต้องมี markdown code block โดยมี 2 fields ดังนี้:

1. "caption": แคปชั่น Facebook ภาษาไทยเกี่ยวกับ "${topic}" โทน: ${tone || 'เป็นกันเอง สนุกสนาน อ่านง่าย'}
โครงสร้างบังคับดังนี้ (เว้นบรรทัดระหว่างแต่ละส่วน):

[HEADER] ตั้งหัวข้อน่าดึงดูด (Hook) ขึ้นต้นด้วย Emoji แล้วสรุปใจความสำคัญในประโยคเดียว

[INTRO] คำนำสั้น 2-3 บรรทัด เป็นกันเอง เป็นมืออาชีพ

[BODY] แยกเป็นข้อๆ โดยใช้ 1️⃣ 2️⃣ 3️⃣ นำหน้าหัวข้อแต่ละข้อ มี Emoji ประกอบแต่ละข้อ

[CTA] สรุปข้อคิด 1 ประโยคตบท้าย พร้อม Call to Action

[HASHTAGS] แฮชแท็กที่เกี่ยวข้อง 5-7 อัน ${hashtagLine}

สไตล์: สุภาพ ให้กำลังใจ อ่านง่าย เว้นวรรคโปร่งตา ไม่ใช้ศัพท์ซับซ้อน

2. "imagePrompt": ประโยคภาษาไทยสั้นๆ กระชับ ติดหู สำหรับส่งให้ AI สร้างรูปภาพ เกี่ยวกับ "${topic}" รูปแบบ hook เช่น "ใครเป็นบ้าง? 🙋 รู้สึกเหมือนเวลา 24 ชั่วโมงไม่เคยพอ!" ความยาวไม่เกิน 2 ประโยค ใส่ Emoji`;

    const url      = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
    const response = await fetch(url, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({
        contents        : [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.8, maxOutputTokens: 8192 }
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let rawText = data.candidates[0].content.parts[0].text.trim();
    rawText = rawText.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

    let parsed;
    try { parsed = JSON.parse(rawText); }
    catch { parsed = { caption: rawText, imagePrompt: topic }; }

    res.json({ caption: parsed.caption || rawText, imagePrompt: parsed.imagePrompt || topic });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/generate-image — call Gemini image generation
app.post('/api/generate-image', async (req, res) => {
  try {
    const { imagePrompt, geminiKey: bodyKey } = req.body || {};
    const cfg = await loadConfig();
    const geminiKey = process.env.GEMINI_API_KEY || bodyKey || cfg.geminiKey || '';

    if (!geminiKey)   return res.status(400).json({ error: 'ไม่พบ Gemini API Key' });
    if (!imagePrompt) return res.status(400).json({ error: 'กรุณาระบุ imagePrompt' });

    const promptText = imagePrompt.slice(0, 480);
    const imgModels  = [
      'gemini-2.0-flash-preview-image-generation',
      'gemini-2.0-flash-exp-image-generation'
    ];

    for (const model of imgModels) {
      try {
        const imgRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
          {
            method : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body   : JSON.stringify({
              contents        : [{ parts: [{ text: promptText }] }],
              generationConfig: { responseModalities: ['IMAGE', 'TEXT'] }
            })
          }
        );
        const imgData = await imgRes.json();
        const parts   = imgData.candidates?.[0]?.content?.parts || [];
        const imgPart = parts.find(p => p.inlineData?.data);

        if (imgPart) {
          return res.json({
            imageBase64: imgPart.inlineData.data,
            mimeType   : imgPart.inlineData.mimeType || 'image/jpeg'
          });
        }
        if (imgData.error) console.warn(`[${model}] error:`, imgData.error.message);
      } catch (e) {
        console.warn(`[${model}] exception:`, e.message);
      }
    }

    // All models failed — return error so client can use Pollinations fallback
    res.json({ error: 'Gemini image generation ล้มเหลวทุก model — ใช้ fallback ที่ client ได้เลย' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/post — post to Facebook Graph API
app.post('/api/post', async (req, res) => {
  try {
    const { caption, imageBase64, imageMime } = req.body || {};
    const cfg = await loadConfig();
    const fbPageId = req.body.fbPageId || process.env.FB_PAGE_ID || cfg.fbPageId || '';
    const fbToken  = req.body.fbToken  || process.env.FB_TOKEN   || cfg.fbToken  || '';

    if (!fbPageId || !fbToken) return res.status(400).json({ error: 'ไม่พบ FB_PAGE_ID หรือ FB_TOKEN' });
    if (!caption)              return res.status(400).json({ error: 'กรุณาระบุ caption' });

    let result;

    if (imageBase64) {
      // Post with photo via multipart
      const mimeType = imageMime || 'image/jpeg';
      const ext      = mimeType.split('/')[1] || 'jpg';
      const buffer   = Buffer.from(imageBase64, 'base64');

      const form = new FormData();
      form.append('source', buffer, { filename: `image.${ext}`, contentType: mimeType });
      form.append('caption', caption);
      form.append('access_token', fbToken);

      const fbRes = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}/photos`, {
        method : 'POST',
        body   : form,
        headers: form.getHeaders()
      });
      result = await fbRes.json();
    } else {
      // Text-only post
      const params = new URLSearchParams();
      params.append('message', caption);
      params.append('access_token', fbToken);

      const fbRes = await fetch(`https://graph.facebook.com/v19.0/${fbPageId}/feed`, {
        method: 'POST',
        body  : params
      });
      result = await fbRes.json();
    }

    if (result.id) {
      res.json({ success: true, postId: result.id });
    } else if (result.error) {
      res.status(400).json({ error: `${result.error.message} (Code: ${result.error.code})` });
    } else {
      res.status(500).json({ error: 'Facebook ส่งคืนผลลัพธ์ที่ไม่คาดคิด' });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/queue — return queue array
app.get('/api/queue', async (req, res) => {
  res.json(await loadQueue());
});

// POST /api/queue — add item to queue
app.post('/api/queue', async (req, res) => {
  try {
    const { topic, tone, schedTime } = req.body || {};
    if (!topic || !schedTime) return res.status(400).json({ error: 'กรุณาระบุ topic และ schedTime' });

    const queue = await loadQueue();
    const item  = {
      id       : Date.now(),
      topic,
      tone     : tone || 'เป็นกันเอง สนุกสนาน อ่านง่าย',
      schedTime,
      status   : 'รอโพสต์',
      createdAt: new Date().toISOString()
    };
    queue.push(item);
    await saveQueue(queue);
    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/queue/:id — remove item from queue by id
app.delete('/api/queue/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await deleteQueueItem(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Cron: process scheduled queue every minute ───────────────────────────────
cron.schedule('* * * * *', async () => {
  const queue = await loadQueue();
  const now   = new Date();
  let changed  = false;

  for (const item of queue) {
    if (item.status !== 'รอโพสต์') continue;
    if (new Date(item.schedTime) > now) continue;

    item.status = 'กำลังโพสต์...';
    changed     = true;

    const keys = await getKeys();
    if (!keys.geminiKey || !keys.fbPageId || !keys.fbToken) {
      item.status = 'ผิดพลาด: ขาด API Key';
      continue;
    }

    try {
      // 1) Generate caption with Gemini
      const genPrompt = `เขียนแคปชั่น Facebook ภาษาไทยเกี่ยวกับ: "${item.topic}" โทน: "${item.tone}" ยาว 3-4 ย่อหน้า ใส่ Emoji และแฮชแท็ก 5 อัน`;
      const gemRes    = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.geminiKey}`,
        {
          method : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body   : JSON.stringify({ contents: [{ parts: [{ text: genPrompt }] }] })
        }
      );
      const gemData = await gemRes.json();
      if (gemData.error) throw new Error(gemData.error.message);
      const caption = gemData.candidates[0].content.parts[0].text;

      // 2) Post to Facebook (text only for scheduled posts)
      const params = new URLSearchParams();
      params.append('message', caption);
      params.append('access_token', keys.fbToken);

      const fbRes  = await fetch(`https://graph.facebook.com/v19.0/${keys.fbPageId}/feed`, {
        method: 'POST',
        body  : params
      });
      const fbData = await fbRes.json();

      if (fbData.id) {
        item.status = `โพสต์แล้ว (ID: ${fbData.id})`;
        console.log(`[Cron] Posted queue item ${item.id}: ${fbData.id}`);
      } else {
        throw new Error(fbData.error?.message || 'Unknown FB Error');
      }
    } catch (err) {
      item.status = `ผิดพลาด: ${err.message.slice(0, 60)}`;
      console.error(`[Cron] Queue item ${item.id} failed:`, err.message);
    }
  }

  if (changed) await saveQueue(queue);
});

// ─── Cron: self-ping every 14 min to prevent Render free tier sleep ───────────
cron.schedule('*/14 * * * *', async () => {
  try {
    await fetch(`http://localhost:${PORT}/`);
    console.log('[Keep-alive] self-ping OK');
  } catch (e) {
    console.warn('[Keep-alive] self-ping failed:', e.message);
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Facebook Auto Post server running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Queue file:     ${QUEUE_FILE}`);
  console.log(`Config file:    ${CONFIG_FILE}`);
});

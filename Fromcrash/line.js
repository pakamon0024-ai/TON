// ===== แจ้งเตือน LINE ผ่าน LINE Messaging API =====
// ตั้งค่าได้ที่เมนู "ฐานข้อมูลหลัก" > แจ้งเตือน (การ์ด LINE)
// เก็บค่าไว้ใน localStorage ของเบราว์เซอร์ (ต่อเครื่อง ไม่ sync ข้ามเครื่อง) เหมือน telegram.js
//
// ต่างจาก Telegram: LINE Messaging API (api.line.me) ไม่อนุญาต CORS จากเบราว์เซอร์ ยิง fetch
// ตรงจากหน้าเว็บจะโดนบล็อกทันที ต้องมี "ตัวกลาง" (Cloudflare Worker) รับข้อความจากแอปนี้ แล้ว
// ค่อยยิงต่อไป LINE โดยฝั่ง Worker เก็บ Channel Access Token/ปลายทางเป็นความลับ (secret) ไม่หลุด
// มาถึงฝั่งเบราว์เซอร์เลย — ดูวิธี deploy Worker ได้ที่ line-notify-worker/README.md
//
// สิ่งที่เก็บไว้ฝั่งแอปนี้มีแค่ "Worker URL" กับ "Shared Secret" (ถ้าตั้งไว้ฝั่ง Worker) ไม่ใช่ตัว
// Channel Access Token จริงของ LINE

function getLineConfig() {
  try { return JSON.parse(localStorage.getItem('finflow_line_config') || '{}'); } catch { return {}; }
}

function saveLineConfigRaw(cfg) {
  safeLocalStorageSet('finflow_line_config', JSON.stringify(cfg));
}

// ข้อความที่ส่งมาจากจุดเรียกใช้ทั่วแอปมักมีแท็ก HTML แบบ Telegram (เช่น <b>...</b>) เพราะใช้
// sendTelegramNotification ร่วมกัน — LINE ข้อความธรรมดารองรับแค่ plain text เลยต้องตัดแท็กออกก่อน
function lineStripHtml(message) {
  return String(message).replace(/<[^>]+>/g, '');
}

async function sendLineNotification(message) {
  const cfg = getLineConfig();
  if (!cfg.workerUrl) return;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.sharedSecret) headers['X-Auth-Token'] = cfg.sharedSecret;
    const res = await fetch(cfg.workerUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: lineStripHtml(message) }),
    });
    if (!res.ok) console.warn('LINE notify: proxy error', await res.text());
  } catch (e) {
    console.warn('LINE notify failed:', e);
  }
}

function loadLineSettingsForm() {
  const cfg = getLineConfig();
  const urlEl = document.getElementById('line-worker-url');
  const secretEl = document.getElementById('line-shared-secret');
  if (urlEl) urlEl.value = cfg.workerUrl || '';
  if (secretEl) secretEl.value = cfg.sharedSecret || '';
}

function saveLineSettings() {
  const workerUrl = document.getElementById('line-worker-url').value.trim();
  const sharedSecret = document.getElementById('line-shared-secret').value.trim();
  if (!workerUrl) { showToast('กรอก Worker URL ก่อน', 'error'); return; }
  saveLineConfigRaw({ workerUrl, sharedSecret });
  showToast('บันทึกการตั้งค่า LINE แล้ว', 'success');
}

function clearLineSettings() {
  localStorage.removeItem('finflow_line_config');
  loadLineSettingsForm();
  showToast('ลบการตั้งค่า LINE แล้ว', 'warning');
}

async function testLineNotification() {
  const cfg = getLineConfig();
  if (!cfg.workerUrl) { showToast('กรุณาบันทึกการตั้งค่าก่อน', 'error'); return; }
  await sendLineNotification('✅ ทดสอบการแจ้งเตือนจากระบบ QA APP สำเร็จ!');
  showToast('ส่งข้อความทดสอบแล้ว เช็คที่ LINE', 'success');
}

document.addEventListener('DOMContentLoaded', loadLineSettingsForm);

// ===== แจ้งเตือน Telegram ผ่าน Bot =====
// ตั้งค่า Bot Token / Chat ID ได้ที่เมนู "ฐานข้อมูลหลัก" > แจ้งเตือน Telegram
// เก็บค่าไว้ใน localStorage ของเบราว์เซอร์ (ต่อเครื่อง ไม่ sync ข้ามเครื่อง)
//
// ข้อควรระวัง: นี่คือแอปฝั่ง client ล้วนๆ ไม่มี backend ดังนั้น Bot Token จะถูกเรียกใช้
// ตรงจากเบราว์เซอร์และฝังอยู่ใน network request ที่มองเห็นได้ผ่าน developer tools
// ของผู้ที่เข้าถึงเว็บนี้ หากต้องการความปลอดภัยสูงขึ้นควรย้ายการยิง Telegram API
// ไปไว้หลัง Netlify Function แล้วเก็บ Token เป็น environment variable แทน

function getTelegramConfig() {
  try { return JSON.parse(localStorage.getItem('finflow_telegram_config') || '{}'); } catch { return {}; }
}

function saveTelegramConfigRaw(cfg) {
  localStorage.setItem('finflow_telegram_config', JSON.stringify(cfg));
}

async function sendTelegramNotification(message) {
  const cfg = getTelegramConfig();
  if (!cfg.botToken || !cfg.chatId) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: cfg.chatId, text: message, parse_mode: 'HTML' }),
    });
    if (!res.ok) console.warn('Telegram notify: API error', await res.text());
  } catch (e) {
    console.warn('Telegram notify failed:', e);
  }
}

function loadTelegramSettingsForm() {
  const cfg = getTelegramConfig();
  const tokenEl = document.getElementById('tg-bot-token');
  const chatEl = document.getElementById('tg-chat-id');
  if (tokenEl) tokenEl.value = cfg.botToken || '';
  if (chatEl) chatEl.value = cfg.chatId || '';
}

function saveTelegramSettings() {
  const botToken = document.getElementById('tg-bot-token').value.trim();
  const chatId = document.getElementById('tg-chat-id').value.trim();
  if (!botToken || !chatId) { showToast('กรอก Bot Token และ Chat ID ให้ครบ', 'error'); return; }
  saveTelegramConfigRaw({ botToken, chatId });
  showToast('บันทึกการตั้งค่า Telegram แล้ว', 'success');
}

function clearTelegramSettings() {
  localStorage.removeItem('finflow_telegram_config');
  loadTelegramSettingsForm();
  showToast('ลบการตั้งค่า Telegram แล้ว', 'warning');
}

async function testTelegramNotification() {
  const cfg = getTelegramConfig();
  if (!cfg.botToken || !cfg.chatId) { showToast('กรุณาบันทึกการตั้งค่าก่อน', 'error'); return; }
  await sendTelegramNotification('✅ ทดสอบการแจ้งเตือนจากระบบ QA APP สำเร็จ!');
  showToast('ส่งข้อความทดสอบแล้ว เช็คที่ Telegram', 'success');
}

document.addEventListener('DOMContentLoaded', loadTelegramSettingsForm);

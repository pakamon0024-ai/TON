// ===== Sync ประวัติรายการ (เงินสดย่อย + ขออนุมัติสำรองจ่าย) กับ Firebase =====
// ใช้ Firebase connection เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (ตัวแปร fbDb/fbReady
// เป็น top-level let ใน claims.js ซึ่งมองเห็นได้จากไฟล์ script อื่นในหน้าเดียวกัน)
// เก็บข้อมูลไว้ที่ path แยกต่างหาก "/finflow_records" ไม่ปะปนกับข้อมูลเคลมประกันภัย

let rcsRef = null;
let rcsReady = false;

function rcsRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}

function rcsObjToRecords(obj) {
  if (!obj) return [];
  let arr;
  if (Array.isArray(obj)) arr = obj.filter(Boolean);
  else arr = Object.values(obj).filter(r => r && r.id);
  // Firebase เก็บเป็น object คีย์ตัวเลข ทำให้ Object.values() วนตามลำดับตัวเลขจากน้อยไปมาก
  // เสมอ (ไม่ใช่ลำดับที่บันทึกจริง) ต้องเรียงใหม่ตามเวลาบันทึกล่าสุดก่อน เพื่อให้
  // "รายการล่าสุด" ในแดชบอร์ดชี้ไปยังรายการที่ถูกต้อง
  arr.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
  return arr;
}

// ถ้าเครื่องนี้มีรายการที่ server ยังไม่มี (เช่น บันทึกไปตอนยังเชื่อมต่อ Firebase ไม่ทัน ทำให้ push ไม่สำเร็จ)
// ต้องเก็บไว้ ไม่ใช่ปล่อยให้ apply ทับข้อมูลเครื่องนี้จนหายไปเงียบๆ แล้ว sync กลับขึ้น server ทันที
function rcsApplyServerRecords(serverRecords) {
  const serverIds = new Set(serverRecords.map(r => r.id));
  const localOnly = (records || []).filter(r => r && r.id && !serverIds.has(r.id));
  records = serverRecords.concat(localOnly).sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
  saveRecords();
  renderDashboard();
  renderHistory();
  if (localOnly.length > 0) rcsWriteFB();
}

async function rcsWriteFB() {
  if (!rcsRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(rcsRef, rcsRecordsToObj(records));
  } catch (e) {
    console.error('rcsWriteFB error', e);
  }
}

function rcsPushIfReady() {
  if (rcsReady) rcsWriteFB();
}

// ===== เขียน/ลบเฉพาะรายการเดียว (ไม่ใช่ทั้งอาเรย์) =====
async function rcsWriteOne(record) {
  if (!rcsRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/finflow_records/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.error('rcsWriteOne error', e); notifySyncWriteError(e.message); }
}
function rcsPushOneIfReady(record) { if (rcsReady) rcsWriteOne(record); }

async function rcsRemoveOne(id) {
  if (!rcsRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/finflow_records/${id}`));
  } catch (e) { console.error('rcsRemoveOne error', e); }
}
function rcsRemoveOneIfReady(id) { if (rcsReady) rcsRemoveOne(id); }

function rcsWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function rcsInit() {
  await rcsWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    rcsRef = ref(fbDb, '/finflow_records');
    const snap = await get(rcsRef);
    if (snap.exists()) {
      rcsApplyServerRecords(rcsObjToRecords(snap.val()));
    } else if (records.length > 0) {
      // Firebase ยังไม่มีข้อมูล แต่เครื่องนี้มีประวัติอยู่แล้ว -> อัปโหลดขึ้นไปเป็นชุดแรก
      rcsReady = true;
      await rcsWriteFB();
    }
    rcsReady = true;
    onValue(rcsRef, snap => {
      if (!snap.exists()) return;
      rcsApplyServerRecords(rcsObjToRecords(snap.val()));
    });
  } catch (e) {
    console.error('rcsInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', rcsInit);

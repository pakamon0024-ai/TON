// ===== Sync ประวัติรายการ (เงินสดย่อย + ขออนุมัติสำรองจ่าย) กับ Firebase =====
// ใช้ Firebase connection เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (ตัวแปร fbDb/fbReady
// เป็น top-level let ใน claims.js ซึ่งมองเห็นได้จากไฟล์ script อื่นในหน้าเดียวกัน)
// เก็บข้อมูลไว้ที่ path แยกต่างหาก "/finflow_records" ไม่ปะปนกับข้อมูลเคลมประกันภัย

let rsRef = null;
let rsReady = false;

function rsRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}

function rsObjToRecords(obj) {
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

function rsApplyServerRecords(serverRecords) {
  records = serverRecords;
  saveRecords();
  renderDashboard();
  renderHistory();
}

async function rsWriteFB() {
  if (!rsRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(rsRef, rsRecordsToObj(records));
  } catch (e) {
    console.error('rsWriteFB error', e);
  }
}

function rsPushIfReady() {
  if (rsReady) rsWriteFB();
}

// ===== เขียน/ลบเฉพาะรายการเดียว (ไม่ใช่ทั้งอาเรย์) =====
async function rsWriteOne(record) {
  if (!rsRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/finflow_records/${record.id}`), record);
  } catch (e) { console.error('rsWriteOne error', e); }
}
function rsPushOneIfReady(record) { if (rsReady) rsWriteOne(record); }

async function rsRemoveOne(id) {
  if (!rsRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/finflow_records/${id}`));
  } catch (e) { console.error('rsRemoveOne error', e); }
}
function rsRemoveOneIfReady(id) { if (rsReady) rsRemoveOne(id); }

function rsWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function rsInit() {
  await rsWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    rsRef = ref(fbDb, '/finflow_records');
    const snap = await get(rsRef);
    if (snap.exists()) {
      rsApplyServerRecords(rsObjToRecords(snap.val()));
    } else if (records.length > 0) {
      // Firebase ยังไม่มีข้อมูล แต่เครื่องนี้มีประวัติอยู่แล้ว -> อัปโหลดขึ้นไปเป็นชุดแรก
      rsReady = true;
      await rsWriteFB();
    }
    rsReady = true;
    onValue(rsRef, snap => {
      if (!snap.exists()) return;
      rsApplyServerRecords(rsObjToRecords(snap.val()));
    });
  } catch (e) {
    console.error('rsInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', rsInit);

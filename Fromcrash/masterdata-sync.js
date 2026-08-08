// ===== Sync ฐานข้อมูลพนักงาน (employees) และรถบรรทุก (vehicles) กับ Firebase =====
// ใช้ Firebase connection เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (fbDb/fbReady)
// เก็บที่ path แยกต่างหาก "/employees" และ "/vehicles"

let mdEmpRef = null, mdVehRef = null;
let mdReady = false;

function mdRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}

function mdObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}

function mdApplyServerDrivers(serverDrivers) {
  mdDrivers = serverDrivers;
  saveDriversDB();
  renderDriversTable();
  updateDriverDatalist();
}

function mdApplyServerVehicles(serverVehicles) {
  mdVehicles = serverVehicles;
  saveVehiclesDB();
  renderVehiclesTable();
  updatePlateDatalist();
}

async function mdWriteEmployees() {
  if (!mdEmpRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdEmpRef, mdRecordsToObj(mdDrivers));
  } catch (e) { console.warn('mdWriteEmployees error', e); }
}

async function mdWriteVehicles() {
  if (!mdVehRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdVehRef, mdRecordsToObj(mdVehicles));
  } catch (e) { console.warn('mdWriteVehicles error', e); }
}

function mdPushIfReady() {
  if (!mdReady) return;
  mdWriteEmployees();
  mdWriteVehicles();
}

function mdWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function mdInit() {
  await mdWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    mdEmpRef = ref(fbDb, '/employees');
    mdVehRef = ref(fbDb, '/vehicles');

    const [empSnap, vehSnap] = await Promise.all([get(mdEmpRef), get(mdVehRef)]);

    if (empSnap.exists()) mdApplyServerDrivers(mdObjToRecords(empSnap.val()));
    if (vehSnap.exists()) mdApplyServerVehicles(mdObjToRecords(vehSnap.val()));
    mdReady = true;

    if (!empSnap.exists() && mdDrivers.length > 0) await mdWriteEmployees();
    if (!vehSnap.exists() && mdVehicles.length > 0) await mdWriteVehicles();

    onValue(mdEmpRef, snap => { if (snap.exists()) mdApplyServerDrivers(mdObjToRecords(snap.val())); });
    onValue(mdVehRef, snap => { if (snap.exists()) mdApplyServerVehicles(mdObjToRecords(snap.val())); });
  } catch (e) {
    console.warn('mdInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', mdInit);

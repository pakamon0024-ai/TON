// ===== Sync ฐานข้อมูลพนักงาน/รถบรรทุก/รายการอ้างอิง กับ Firebase =====
// ใช้ Firebase connection เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (fbDb/fbReady)
// employees/vehicles เก็บเป็น object คีย์ id ส่วนหน่วยงาน/ประกัน/ลานจอด/ลักษณะเหตุ
// เป็นแค่ array ของชื่อ (string) เก็บง่ายๆ ตรงๆ ที่ path ของตัวเอง

let mdEmpRef = null, mdVehRef = null, mdBuRef = null, mdInsRef = null, mdYardRef = null, mdPatRef = null, mdTopicRef = null, mdAbcRef = null, mdReqRef = null, mdBzRef = null;
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

function mdApplyServerAbcStaff(serverAbcStaff) {
  // ข้อมูลเก่าบน Firebase อาจยังเป็น array ของชื่อ string เฉยๆ (ก่อนเพิ่มฟิลด์หน่วยงาน) แปลงให้เป็น record
  mdAbcStaff = (serverAbcStaff || []).map((s, i) => typeof s === 'string' ? { id: Date.now() + i, name: s, businessUnit: '' } : s);
  saveAbcStaffDB();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
}

function mdApplyServerBreathalyzers(serverBreathalyzers) {
  mdBreathalyzers = serverBreathalyzers;
  saveBreathalyzersDB();
  renderBreathalyzersTable();
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

async function mdWriteAbcStaff() {
  if (!mdAbcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdAbcRef, mdRecordsToObj(mdAbcStaff));
  } catch (e) { console.warn('mdWriteAbcStaff error', e); }
}

async function mdWriteBreathalyzers() {
  if (!mdBzRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdBzRef, mdRecordsToObj(mdBreathalyzers));
  } catch (e) { console.warn('mdWriteBreathalyzers error', e); }
}

async function mdWriteSimpleList(ref, arr) {
  if (!ref) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref, arr || []);
  } catch (e) { console.warn('mdWriteSimpleList error', e); }
}

function mdPushIfReady() {
  if (!mdReady) return;
  mdWriteEmployees();
  mdWriteVehicles();
  mdWriteAbcStaff();
  mdWriteBreathalyzers();
  mdWriteSimpleList(mdBuRef, mdBusinessUnits);
  mdWriteSimpleList(mdInsRef, mdInsurers);
  mdWriteSimpleList(mdYardRef, mdYards);
  mdWriteSimpleList(mdPatRef, mdIncidentPatterns);
  mdWriteSimpleList(mdTopicRef, mdIssueTopics);
  mdWriteSimpleList(mdReqRef, mdRequesters);
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

function mdApplySimpleList(kind, arr) {
  if (kind === 'bu') { mdBusinessUnits = arr; saveBusinessUnitsDB(); renderBusinessUnitsTable(); }
  if (kind === 'ins') { mdInsurers = arr; saveInsurersDB(); renderInsurersTable(); }
  if (kind === 'yard') { mdYards = arr; saveYardsDB(); renderYardsTable(); }
  if (kind === 'pattern') { mdIncidentPatterns = arr; savePatternsDB(); renderIncidentPatternsTable(); }
  if (kind === 'topic') { mdIssueTopics = arr; saveIssueTopicsDB(); renderIssueTopicsTable(); }
  if (kind === 'requesters') { mdRequesters = arr; saveRequestersDB(); renderRequestersTable(); updateRequesterDatalist(); }
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
}

async function mdInit() {
  await mdWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    mdEmpRef = ref(fbDb, '/employees');
    mdVehRef = ref(fbDb, '/vehicles');
    mdBuRef = ref(fbDb, '/businessUnits');
    mdInsRef = ref(fbDb, '/insurers');
    mdYardRef = ref(fbDb, '/yards');
    mdPatRef = ref(fbDb, '/incidentPatterns');
    mdTopicRef = ref(fbDb, '/issueTopics');
    mdAbcRef = ref(fbDb, '/abcStaff');
    mdReqRef = ref(fbDb, '/requesters');
    mdBzRef = ref(fbDb, '/breathalyzers');

    // ใช้ allSettled ไม่ใช่ all — ถ้า path ใด path หนึ่งยังไม่มี Security Rule (เช่น เพิ่ง
    // เพิ่ม path ใหม่แล้วลืมอัปเดต Rules) จะได้ไม่ทำให้ path อื่นที่ปกติดีพลอย sync ไม่ขึ้นไปด้วย
    // (เดิมใช้ Promise.all แล้วเจอบั๊กจริง: get() หนึ่งตัว reject ทำให้ mdReady ไม่ถูกตั้งเป็น true เลย)
    const results = await Promise.allSettled([
      get(mdEmpRef), get(mdVehRef), get(mdBuRef), get(mdInsRef), get(mdYardRef), get(mdPatRef), get(mdTopicRef), get(mdAbcRef), get(mdReqRef), get(mdBzRef),
    ]);
    const NULL_SNAP = { exists: () => false, val: () => null };
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`mdInit: path #${i} โหลดไม่สำเร็จ (อาจยังไม่มี Security Rule)`, r.reason);
    });
    const [empSnap, vehSnap, buSnap, insSnap, yardSnap, patSnap, topicSnap, abcSnap, reqSnap, bzSnap] =
      results.map(r => r.status === 'fulfilled' ? r.value : NULL_SNAP);

    if (empSnap.exists()) mdApplyServerDrivers(mdObjToRecords(empSnap.val()));
    if (vehSnap.exists()) mdApplyServerVehicles(mdObjToRecords(vehSnap.val()));
    if (buSnap.exists()) mdApplySimpleList('bu', buSnap.val() || []);
    if (insSnap.exists()) mdApplySimpleList('ins', insSnap.val() || []);
    if (yardSnap.exists()) mdApplySimpleList('yard', yardSnap.val() || []);
    if (patSnap.exists()) mdApplySimpleList('pattern', patSnap.val() || []);
    if (topicSnap.exists()) mdApplySimpleList('topic', topicSnap.val() || []);
    if (abcSnap.exists()) mdApplyServerAbcStaff(mdObjToRecords(abcSnap.val()));
    if (reqSnap.exists()) mdApplySimpleList('requesters', reqSnap.val() || []);
    if (bzSnap.exists()) mdApplyServerBreathalyzers(mdObjToRecords(bzSnap.val()));
    mdReady = true;

    if (!empSnap.exists() && mdDrivers.length > 0) await mdWriteEmployees();
    if (!vehSnap.exists() && mdVehicles.length > 0) await mdWriteVehicles();
    if (!buSnap.exists() && mdBusinessUnits.length > 0) await mdWriteSimpleList(mdBuRef, mdBusinessUnits);
    if (!insSnap.exists() && mdInsurers.length > 0) await mdWriteSimpleList(mdInsRef, mdInsurers);
    if (!yardSnap.exists() && mdYards.length > 0) await mdWriteSimpleList(mdYardRef, mdYards);
    if (!patSnap.exists() && mdIncidentPatterns.length > 0) await mdWriteSimpleList(mdPatRef, mdIncidentPatterns);
    if (!topicSnap.exists() && mdIssueTopics.length > 0) await mdWriteSimpleList(mdTopicRef, mdIssueTopics);
    if (!abcSnap.exists() && mdAbcStaff.length > 0) await mdWriteAbcStaff();
    if (!reqSnap.exists() && mdRequesters.length > 0) await mdWriteSimpleList(mdReqRef, mdRequesters);
    if (!bzSnap.exists() && mdBreathalyzers.length > 0) await mdWriteBreathalyzers();

    onValue(mdEmpRef, snap => { if (snap.exists()) mdApplyServerDrivers(mdObjToRecords(snap.val())); });
    onValue(mdVehRef, snap => { if (snap.exists()) mdApplyServerVehicles(mdObjToRecords(snap.val())); });
    onValue(mdBuRef, snap => { if (snap.exists()) mdApplySimpleList('bu', snap.val() || []); });
    onValue(mdInsRef, snap => { if (snap.exists()) mdApplySimpleList('ins', snap.val() || []); });
    onValue(mdYardRef, snap => { if (snap.exists()) mdApplySimpleList('yard', snap.val() || []); });
    onValue(mdPatRef, snap => { if (snap.exists()) mdApplySimpleList('pattern', snap.val() || []); });
    onValue(mdTopicRef, snap => { if (snap.exists()) mdApplySimpleList('topic', snap.val() || []); });
    onValue(mdAbcRef, snap => { if (snap.exists()) mdApplyServerAbcStaff(mdObjToRecords(snap.val())); });
    onValue(mdReqRef, snap => { if (snap.exists()) mdApplySimpleList('requesters', snap.val() || []); });
    onValue(mdBzRef, snap => { if (snap.exists()) mdApplyServerBreathalyzers(mdObjToRecords(snap.val())); });
  } catch (e) {
    console.warn('mdInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', mdInit);

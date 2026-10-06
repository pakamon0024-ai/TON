// ===== Sync ฐานข้อมูลพนักงาน/รถบรรทุก/รายการอ้างอิง กับ Firebase =====
// ใช้ Firebase connection เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (fbDb/fbReady)
// employees/vehicles เก็บเป็น object คีย์ id ส่วนหน่วยงาน/ประกัน/ลานจอด/ลักษณะเหตุ
// เป็นแค่ array ของชื่อ (string) เก็บง่ายๆ ตรงๆ ที่ path ของตัวเอง

let mdEmpRef = null, mdVehRef = null, mdBuRef = null, mdInsRef = null, mdYardRef = null, mdPatRef = null, mdTopicRef = null, mdBdTypeRef = null, mdChargeRef = null, mdAbcRef = null, mdReqRef = null, mdBzRef = null;
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

// ถ้าเครื่องนี้มีบันทึกที่ server ยังไม่มี (เช่น กดบันทึกไปตอนยังเชื่อมต่อ Firebase ไม่ทัน ทำให้ push ไม่สำเร็จ)
// ต้องเก็บไว้ ไม่ใช่ปล่อยให้ apply ทับข้อมูลเครื่องนี้จนหายไปเงียบๆ แล้ว sync กลับขึ้น server ทันที
function mdLocalOnly(localArr, serverArr) {
  const serverIds = new Set((serverArr || []).map(r => r && r.id));
  return (localArr || []).filter(t => t && t.id && !serverIds.has(t.id));
}

function mdApplyServerDrivers(serverDrivers) {
  const localOnly = mdLocalOnly(mdDrivers, serverDrivers);
  mdDrivers = serverDrivers.concat(localOnly);
  saveDriversDB();
  renderDriversTable();
  updateDriverDatalist();
  if (localOnly.length > 0) mdWriteEmployees();
}

function mdApplyServerVehicles(serverVehicles) {
  const localOnly = mdLocalOnly(mdVehicles, serverVehicles);
  mdVehicles = serverVehicles.concat(localOnly);
  saveVehiclesDB();
  renderVehiclesTable();
  updatePlateDatalist();
  if (localOnly.length > 0) mdWriteVehicles();
}

function mdApplyServerAbcStaff(serverAbcStaff) {
  // ข้อมูลเก่าบน Firebase อาจยังเป็น array ของชื่อ string เฉยๆ (ก่อนเพิ่มฟิลด์หน่วยงาน) แปลงให้เป็น record
  const normalized = (serverAbcStaff || []).map((s, i) => typeof s === 'string' ? { id: Date.now() + i, name: s, businessUnit: '' } : s);
  const localOnly = mdLocalOnly(mdAbcStaff, normalized);
  mdAbcStaff = normalized.concat(localOnly);
  const fixed = mdApplyAbcStartFixups();
  saveAbcStaffDB();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  if (fixed || localOnly.length > 0) mdPushIfReady();
}

function mdApplyServerBreathalyzers(serverBreathalyzers) {
  const localOnly = mdLocalOnly(mdBreathalyzers, serverBreathalyzers);
  mdBreathalyzers = serverBreathalyzers.concat(localOnly);
  saveBreathalyzersDB();
  renderBreathalyzersTable();
  if (localOnly.length > 0) mdWriteBreathalyzers();
}

async function mdWriteEmployees() {
  if (!mdEmpRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdEmpRef, mdRecordsToObj(mdDrivers));
  } catch (e) { console.warn('mdWriteEmployees error', e); notifySyncWriteError(e.message); }
}

async function mdWriteVehicles() {
  if (!mdVehRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdVehRef, mdRecordsToObj(mdVehicles));
  } catch (e) { console.warn('mdWriteVehicles error', e); notifySyncWriteError(e.message); }
}

async function mdWriteAbcStaff() {
  if (!mdAbcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdAbcRef, mdRecordsToObj(mdAbcStaff));
  } catch (e) { console.warn('mdWriteAbcStaff error', e); notifySyncWriteError(e.message); }
}

async function mdWriteBreathalyzers() {
  if (!mdBzRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mdBzRef, mdRecordsToObj(mdBreathalyzers));
  } catch (e) { console.warn('mdWriteBreathalyzers error', e); notifySyncWriteError(e.message); }
}

async function mdWriteSimpleList(ref, arr) {
  if (!ref) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref, arr || []);
  } catch (e) { console.warn('mdWriteSimpleList error', e); notifySyncWriteError(e.message); }
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
  mdWriteSimpleList(mdBdTypeRef, mdBreakdownTypes);
  mdWriteSimpleList(mdChargeRef, mdChargeTypes);
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

// ถ้าเครื่องนี้มีชื่อที่ server ยังไม่มี (เช่น เพิ่มไปตอนยังเชื่อมต่อ Firebase ไม่ทัน ทำให้ push ไม่สำเร็จ)
// ต้องเก็บไว้ ไม่ใช่ปล่อยให้ apply ทับข้อมูลเครื่องนี้จนหายไปเงียบๆ แล้ว sync กลับขึ้น server ทันที
function mdApplySimpleList(kind, arr) {
  let localOnly = [];
  if (kind === 'bu') { localOnly = (mdBusinessUnits || []).filter(n => !arr.includes(n)); mdBusinessUnits = arr.concat(localOnly); saveBusinessUnitsDB(); renderBusinessUnitsTable(); if (localOnly.length) mdWriteSimpleList(mdBuRef, mdBusinessUnits); }
  if (kind === 'ins') { localOnly = (mdInsurers || []).filter(n => !arr.includes(n)); mdInsurers = arr.concat(localOnly); saveInsurersDB(); renderInsurersTable(); if (localOnly.length) mdWriteSimpleList(mdInsRef, mdInsurers); }
  if (kind === 'yard') { localOnly = (mdYards || []).filter(n => !arr.includes(n)); mdYards = arr.concat(localOnly); saveYardsDB(); renderYardsTable(); if (localOnly.length) mdWriteSimpleList(mdYardRef, mdYards); }
  if (kind === 'pattern') { localOnly = (mdIncidentPatterns || []).filter(n => !arr.includes(n)); mdIncidentPatterns = arr.concat(localOnly); savePatternsDB(); renderIncidentPatternsTable(); if (localOnly.length) mdWriteSimpleList(mdPatRef, mdIncidentPatterns); }
  if (kind === 'topic') { localOnly = (mdIssueTopics || []).filter(n => !arr.includes(n)); mdIssueTopics = arr.concat(localOnly); saveIssueTopicsDB(); renderIssueTopicsTable(); if (localOnly.length) mdWriteSimpleList(mdTopicRef, mdIssueTopics); }
  if (kind === 'bdtype') { localOnly = (mdBreakdownTypes || []).filter(n => !arr.includes(n)); mdBreakdownTypes = arr.concat(localOnly); saveBreakdownTypesDB(); renderBreakdownTypesTable(); if (localOnly.length) mdWriteSimpleList(mdBdTypeRef, mdBreakdownTypes); }
  if (kind === 'charge') { localOnly = (mdChargeTypes || []).filter(n => !arr.includes(n)); mdChargeTypes = arr.concat(localOnly); saveChargeTypesDB(); renderChargeTypesTable(); if (localOnly.length) mdWriteSimpleList(mdChargeRef, mdChargeTypes); }
  if (kind === 'requesters') { localOnly = (mdRequesters || []).filter(n => !arr.includes(n)); mdRequesters = arr.concat(localOnly); saveRequestersDB(); renderRequestersTable(); updateRequesterDatalist(); if (localOnly.length) mdWriteSimpleList(mdReqRef, mdRequesters); }
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  if (typeof bdRefreshLookupDropdowns === 'function') bdRefreshLookupDropdowns();
  if (typeof tkRefreshLookupDropdowns === 'function') tkRefreshLookupDropdowns();
  if (typeof pbRefreshLookupDropdowns === 'function') pbRefreshLookupDropdowns();
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
    mdBdTypeRef = ref(fbDb, '/breakdownTypes');
    mdChargeRef = ref(fbDb, '/chargeTypes');
    mdAbcRef = ref(fbDb, '/abcStaff');
    mdReqRef = ref(fbDb, '/requesters');
    mdBzRef = ref(fbDb, '/breathalyzers');

    // ใช้ allSettled ไม่ใช่ all — ถ้า path ใด path หนึ่งยังไม่มี Security Rule (เช่น เพิ่ง
    // เพิ่ม path ใหม่แล้วลืมอัปเดต Rules) จะได้ไม่ทำให้ path อื่นที่ปกติดีพลอย sync ไม่ขึ้นไปด้วย
    // (เดิมใช้ Promise.all แล้วเจอบั๊กจริง: get() หนึ่งตัว reject ทำให้ mdReady ไม่ถูกตั้งเป็น true เลย)
    const results = await Promise.allSettled([
      get(mdEmpRef), get(mdVehRef), get(mdBuRef), get(mdInsRef), get(mdYardRef), get(mdPatRef), get(mdTopicRef), get(mdBdTypeRef), get(mdChargeRef), get(mdAbcRef), get(mdReqRef), get(mdBzRef),
    ]);
    const NULL_SNAP = { exists: () => false, val: () => null };
    results.forEach((r, i) => {
      if (r.status === 'rejected') console.warn(`mdInit: path #${i} โหลดไม่สำเร็จ (อาจยังไม่มี Security Rule)`, r.reason);
    });
    const [empSnap, vehSnap, buSnap, insSnap, yardSnap, patSnap, topicSnap, bdTypeSnap, chargeSnap, abcSnap, reqSnap, bzSnap] =
      results.map(r => r.status === 'fulfilled' ? r.value : NULL_SNAP);

    if (empSnap.exists()) mdApplyServerDrivers(mdObjToRecords(empSnap.val()));
    if (vehSnap.exists()) mdApplyServerVehicles(mdObjToRecords(vehSnap.val()));
    if (buSnap.exists()) mdApplySimpleList('bu', buSnap.val() || []);
    if (insSnap.exists()) mdApplySimpleList('ins', insSnap.val() || []);
    if (yardSnap.exists()) mdApplySimpleList('yard', yardSnap.val() || []);
    if (patSnap.exists()) mdApplySimpleList('pattern', patSnap.val() || []);
    if (topicSnap.exists()) mdApplySimpleList('topic', topicSnap.val() || []);
    if (bdTypeSnap.exists()) mdApplySimpleList('bdtype', bdTypeSnap.val() || []);
    if (chargeSnap.exists()) mdApplySimpleList('charge', chargeSnap.val() || []);
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
    if (!bdTypeSnap.exists() && mdBreakdownTypes.length > 0) await mdWriteSimpleList(mdBdTypeRef, mdBreakdownTypes);
    if (!chargeSnap.exists() && mdChargeTypes.length > 0) await mdWriteSimpleList(mdChargeRef, mdChargeTypes);
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
    onValue(mdBdTypeRef, snap => { if (snap.exists()) mdApplySimpleList('bdtype', snap.val() || []); });
    onValue(mdChargeRef, snap => { if (snap.exists()) mdApplySimpleList('charge', snap.val() || []); });
    onValue(mdAbcRef, snap => { if (snap.exists()) mdApplyServerAbcStaff(mdObjToRecords(snap.val())); });
    onValue(mdReqRef, snap => { if (snap.exists()) mdApplySimpleList('requesters', snap.val() || []); });
    onValue(mdBzRef, snap => { if (snap.exists()) mdApplyServerBreathalyzers(mdObjToRecords(snap.val())); });
  } catch (e) {
    console.warn('mdInit error', e);
    notifySyncLoadError(e.message);
  }
}

document.addEventListener('DOMContentLoaded', mdInit);

// ===== ระบบบันทึกรถร่วม (สมัครเข้าร่วม / ลาออก) =====
// เก็บ local ที่ localStorage key 'finflow_joint_vehicles' และ sync กับ Firebase ที่ /jointVehicles
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// ทะเบียนรถดึงจากฐานข้อมูลหลัก (mdVehicles) — พิมพ์ทะเบียนแล้วเจ้าของรถจะเติมให้อัตโนมัติ

let jvRecords = JSON.parse(localStorage.getItem('finflow_joint_vehicles') || '[]');
let jvEditingId = null;
let jvRef = null;
let jvReady = false;

// เช็คลิสต์เอกสารสมัครเข้าร่วม [id ในฟอร์ม, key ในข้อมูล]
const JV_DOC_FIELDS = [
  ['jv-doc-idowner', 'docIdOwner'],
  ['jv-doc-iddriver', 'docIdDriver'],
  ['jv-doc-housereg', 'docHouseReg'],
  ['jv-doc-license', 'docLicense'],
  ['jv-doc-vehins', 'docVehIns'],
  ['jv-doc-compulsory', 'docCompulsory'],
  ['jv-doc-cargoins', 'docCargoIns'],
];
// เช็คลิสต์ตอนลาออก (ถอดอุปกรณ์/คืนของ)
const JV_LEAVE_CHECK_FIELDS = [
  ['jv-leave-gps', 'leaveGps'],
  ['jv-leave-cctv', 'leaveCctv'],
  ['jv-leave-breath', 'leaveBreath'],
  ['jv-leave-fuelcard', 'leaveFuelCard'],
  ['jv-leave-sticker', 'leaveSticker'],
];

function jvSave() { localStorage.setItem('finflow_joint_vehicles', JSON.stringify(jvRecords)); }

function jvParseBool(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'TRUE' || s === '1' || s === 'YES' || s === 'ใช่' || s === 'X' || s === '✓';
}

// ===== Sub-tabs =====
function jvSwitchTab(tab) {
  ['list', 'add', 'db', 'dbadd'].forEach(t => {
    document.getElementById(`jv-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`jv-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') jvRenderList();
  if (tab === 'add' && !jvEditingId) jvClearForm();
  if (tab === 'db') { jvdbRefreshLookupDropdowns(); jvdbRenderList(); }
  if (tab === 'dbadd' && !jvdbEditingId) jvdbClearForm();
}

function jvOnPageShown() {
  jvRenderList();
  jvdbRenderList();
}

// ===== ดึงเจ้าของรถจากฐานข้อมูลหลัก =====
function jvLookupVehicle() {
  const plate = document.getElementById('jv-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('jv-owner').value = veh?.owner || '';
}

// สลับส่วนของฟอร์มตามประเภทบันทึกที่เลือก (สมัครเข้าร่วม / ลาออก) — กรอกแค่ส่วนที่เกี่ยวข้อง
// ข้อมูลจะถูกแยกเก็บเป็นคนละ record กันไปเลยตามประเภท ไม่ปนกัน
function jvToggleTypeFields() {
  const type = document.getElementById('jv-type').value;
  document.getElementById('jv-join-section').style.display = type === 'join' ? '' : 'none';
  document.getElementById('jv-leave-section').style.display = type === 'leave' ? '' : 'none';
}

// ===== Running number =====
function jvNextRunningNo() {
  return jvRecords.length ? Math.max(...jvRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

function jvTypeBadge(rec) {
  return rec.type === 'leave'
    ? `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">ลาออก</span>`
    : `<span class="badge badge-green">สมัครเข้าร่วม</span>`;
}
function jvDocCount(rec) { return JV_DOC_FIELDS.filter(([, key]) => rec[key]).length; }
function jvRemovalCost(rec) { return (parseFloat(rec.costGps) || 0) + (parseFloat(rec.costCctv) || 0) + (parseFloat(rec.costBreath) || 0); }

function jvCalcRemovalCost() {
  const total = (parseFloat(document.getElementById('jv-cost-gps').value) || 0)
    + (parseFloat(document.getElementById('jv-cost-cctv').value) || 0)
    + (parseFloat(document.getElementById('jv-cost-breath').value) || 0);
  document.getElementById('jv-cost-total-display').textContent = formatMoney(total);
  return total;
}

// ===== Save / Edit / Delete =====
function jvSaveCase() {
  const type = document.getElementById('jv-type').value === 'leave' ? 'leave' : 'join';
  const plate = document.getElementById('jv-plate').value.trim();
  const owner = document.getElementById('jv-owner').value.trim();
  const note = document.getElementById('jv-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }

  let record;
  if (type === 'join') {
    const joinDate = document.getElementById('jv-join-date').value;
    if (!joinDate) { showToast('กรุณาระบุวันที่สมัครเข้าร่วม', 'warning'); return; }
    record = { type, plate, owner, joinDate, note };
    JV_DOC_FIELDS.forEach(([id, key]) => { record[key] = document.getElementById(id).checked; });
  } else {
    const leaveDate = document.getElementById('jv-leave-date').value;
    if (!leaveDate) { showToast('กรุณาระบุวันที่ลาออก', 'warning'); return; }
    record = {
      type, plate, owner, note,
      lastWorkDate: document.getElementById('jv-lastwork-date').value,
      leaveDate,
      equipRemoveDate: document.getElementById('jv-equip-remove-date').value,
      costGps: parseFloat(document.getElementById('jv-cost-gps').value) || 0,
      costCctv: parseFloat(document.getElementById('jv-cost-cctv').value) || 0,
      costBreath: parseFloat(document.getElementById('jv-cost-breath').value) || 0,
    };
    JV_LEAVE_CHECK_FIELDS.forEach(([id, key]) => { record[key] = document.getElementById(id).checked; });
  }

  let savedRecord;
  if (jvEditingId) {
    const idx = jvRecords.findIndex(r => r.id === jvEditingId);
    if (idx >= 0) {
      jvRecords[idx] = { ...record, id: jvRecords[idx].id, runningNo: jvRecords[idx].runningNo, createdAt: jvRecords[idx].createdAt, updatedAt: new Date().toISOString() };
      savedRecord = jvRecords[idx];
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    jvCancelEdit();
  } else {
    record.id = 'JV_' + Date.now();
    record.runningNo = jvNextRunningNo();
    record.createdAt = new Date().toISOString();
    jvRecords.unshift(record);
    savedRecord = record;
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      const msg = type === 'join'
        ? `🚛 <b>บันทึกรถร่วมใหม่ (สมัครเข้าร่วม)</b>\nทะเบียน: ${escapeHtml(plate)}\nเจ้าของรถ: ${escapeHtml(owner || '-')}\nวันที่สมัครเข้าร่วม: ${formatDate(record.joinDate)}\nเอกสารครบ: ${jvDocCount(record)}/${JV_DOC_FIELDS.length}`
        : `🚛 <b>บันทึกรถร่วมใหม่ (ลาออก)</b>\nทะเบียน: ${escapeHtml(plate)}\nเจ้าของรถ: ${escapeHtml(owner || '-')}\nวันที่ลาออก: ${formatDate(record.leaveDate)}`;
      sendTelegramNotification(msg);
    }
    jvClearForm();
  }
  jvSave();
  jvPushOneIfReady(savedRecord);
  jvRenderList();
}

function jvClearForm() {
  jvEditingId = null;
  document.getElementById('jv-edit-banner').style.display = 'none';
  document.getElementById('jv-type').value = 'join';
  document.getElementById('jv-plate').value = '';
  document.getElementById('jv-owner').value = '';
  document.getElementById('jv-join-date').value = '';
  document.getElementById('jv-lastwork-date').value = '';
  document.getElementById('jv-leave-date').value = '';
  document.getElementById('jv-equip-remove-date').value = '';
  document.getElementById('jv-note').value = '';
  document.getElementById('jv-cost-gps').value = '';
  document.getElementById('jv-cost-cctv').value = '';
  document.getElementById('jv-cost-breath').value = '';
  JV_DOC_FIELDS.forEach(([id]) => { document.getElementById(id).checked = false; });
  JV_LEAVE_CHECK_FIELDS.forEach(([id]) => { document.getElementById(id).checked = false; });
  jvCalcRemovalCost();
  jvToggleTypeFields();
}

function jvEditCase(id) {
  const rec = jvRecords.find(r => r.id === id);
  if (!rec) return;
  jvEditingId = id;
  document.getElementById('jv-edit-banner').style.display = 'flex';
  document.getElementById('jv-edit-no').textContent = rec.runningNo;
  document.getElementById('jv-type').value = rec.type === 'leave' ? 'leave' : 'join';
  document.getElementById('jv-plate').value = rec.plate || '';
  document.getElementById('jv-owner').value = rec.owner || '';
  document.getElementById('jv-join-date').value = rec.joinDate || '';
  document.getElementById('jv-lastwork-date').value = rec.lastWorkDate || '';
  document.getElementById('jv-leave-date').value = rec.leaveDate || '';
  document.getElementById('jv-equip-remove-date').value = rec.equipRemoveDate || '';
  document.getElementById('jv-note').value = rec.note || '';
  document.getElementById('jv-cost-gps').value = rec.costGps || '';
  document.getElementById('jv-cost-cctv').value = rec.costCctv || '';
  document.getElementById('jv-cost-breath').value = rec.costBreath || '';
  JV_DOC_FIELDS.forEach(([id, key]) => { document.getElementById(id).checked = !!rec[key]; });
  JV_LEAVE_CHECK_FIELDS.forEach(([id, key]) => { document.getElementById(id).checked = !!rec[key]; });
  jvCalcRemovalCost();
  jvToggleTypeFields();
  jvSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jvCancelEdit() { jvClearForm(); }

function jvDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  jvRecords = jvRecords.filter(r => r.id !== id);
  jvSave();
  jvRemoveOneIfReady(id);
  jvRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function jvFilteredList() {
  const plate = (document.getElementById('jv-f-plate')?.value || '').trim().toLowerCase();
  const type = document.getElementById('jv-f-type')?.value || '';
  return jvRecords.filter(r => {
    if (plate && !r.plate.toLowerCase().includes(plate)) return false;
    if (type && (r.type || 'join') !== type) return false;
    return true;
  });
}

function jvClearListFilters() {
  document.getElementById('jv-f-plate').value = '';
  document.getElementById('jv-f-type').value = '';
  jvRenderList();
}

function jvRenderList() {
  const list = jvFilteredList();
  const tbody = document.getElementById('jv-list-body');
  const countEl = document.getElementById('jv-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td>${jvTypeBadge(r)}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
      <td>${r.type === 'leave' ? '-' : `${jvDocCount(r)}/${JV_DOC_FIELDS.length}`}</td>
      <td>${r.joinDate ? formatDate(r.joinDate) : '-'}</td>
      <td>${r.leaveDate ? formatDate(r.leaveDate) : '-'}</td>
      <td>${r.equipRemoveDate ? formatDate(r.equipRemoveDate) : '-'}</td>
      <td>${r.type === 'leave' ? formatMoney(jvRemovalCost(r)) : '-'}</td>
      <td>${escapeHtml(r.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="jvEditCase('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="jvDeleteCase('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Template / Export / Import (นำเข้าซ้ำ = แก้ไข จับคู่ด้วยทะเบียน+วันที่สมัคร) =====
const JV_XLSX_HEADERS = [
  'ประเภท (สมัคร/ลาออก)', 'ทะเบียนรถ', 'เจ้าของรถ', 'วันที่สมัครเข้าร่วม (dd/mm/yyyy)',
  'บัตรประชาชนเจ้าของรถ', 'บัตรประชาชนคนขับ', 'ทะเบียนบ้าน', 'ใบขับขี่คนขับ', 'ประกันรถ', 'พรบ.', 'ประกันสินค้า',
  'วันที่ทำงานวันสุดท้าย (dd/mm/yyyy)', 'วันที่ลาออก (dd/mm/yyyy)', 'วันที่ถอดอุปกรณ์ (dd/mm/yyyy)',
  'ถอด GPS', 'ถอด CCTV', 'ถอดเครื่องเป่าแอลกอฮอล์', 'คืนบัตรน้ำมัน', 'ถอดสติ๊กเกอร์',
  'ค่าใช้จ่ายถอด GPS', 'ค่าใช้จ่ายถอด CCTV', 'ค่าใช้จ่ายถอดเครื่องเป่าแอลกอฮอล์', 'หมายเหตุ',
];

function jvDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    JV_XLSX_HEADERS,
    ['สมัคร', '70-1234', 'นายสมชาย ใจดี', '15/01/2026', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', '', '', '', '', '', '', '', '', 0, 0, 0, ''],
    ['ลาออก', '70-5678', 'นายสมหมาย ตั้งใจ', '', '', '', '', '', '', '', '', '01/06/2026', '10/06/2026', '12/06/2026', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 500, 300, 200, ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รถร่วม');
  XLSX.writeFile(wb, 'template_รถร่วม.xlsx');
}

function jvExportExcel() {
  const list = jvFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    JV_XLSX_HEADERS,
    ...list.map(r => [
      r.type === 'leave' ? 'ลาออก' : 'สมัคร', r.plate, r.owner || '', formatDMY(r.joinDate),
      !!r.docIdOwner, !!r.docIdDriver, !!r.docHouseReg, !!r.docLicense, !!r.docVehIns, !!r.docCompulsory, !!r.docCargoIns,
      formatDMY(r.lastWorkDate), formatDMY(r.leaveDate), formatDMY(r.equipRemoveDate),
      !!r.leaveGps, !!r.leaveCctv, !!r.leaveBreath, !!r.leaveFuelCard, !!r.leaveSticker,
      r.costGps || 0, r.costCctv || 0, r.costBreath || 0, r.note || '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รถร่วม');
  XLSX.writeFile(wb, `บันทึกรถร่วม_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function jvImportExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const plate = String(row[1] || '').trim();
      if (!plate) return;
      const type = String(row[0] || '').trim() === 'ลาออก' ? 'leave' : 'join';
      const veh = mdVehicles.find(v => v.plate === plate);
      const owner = String(row[2] || '').trim() || veh?.owner || '';
      const joinDate = normalizeImportDate(row[3]);
      const leaveDate = normalizeImportDate(row[12]);
      let record, matchIdx;
      if (type === 'join') {
        record = {
          type, plate, owner, joinDate,
          docIdOwner: jvParseBool(row[4]), docIdDriver: jvParseBool(row[5]), docHouseReg: jvParseBool(row[6]),
          docLicense: jvParseBool(row[7]), docVehIns: jvParseBool(row[8]), docCompulsory: jvParseBool(row[9]), docCargoIns: jvParseBool(row[10]),
          note: String(row[21] || '').trim(),
        };
        matchIdx = jvRecords.findIndex(r => (r.type || 'join') === 'join' && r.plate === plate && r.joinDate === joinDate);
      } else {
        record = {
          type, plate, owner,
          lastWorkDate: normalizeImportDate(row[11]), leaveDate, equipRemoveDate: normalizeImportDate(row[13]),
          leaveGps: jvParseBool(row[14]), leaveCctv: jvParseBool(row[15]), leaveBreath: jvParseBool(row[16]),
          leaveFuelCard: jvParseBool(row[17]), leaveSticker: jvParseBool(row[18]),
          costGps: parseFloat(row[19]) || 0, costCctv: parseFloat(row[20]) || 0, costBreath: parseFloat(row[21]) || 0,
          note: String(row[22] || '').trim(),
        };
        matchIdx = jvRecords.findIndex(r => r.type === 'leave' && r.plate === plate && r.leaveDate === leaveDate);
      }
      // จับคู่ด้วยทะเบียน + ประเภท + วันที่ (สมัคร/ลาออก) — ถ้าตรงกับรายการเดิม แก้ไขแทนเพิ่มใหม่ (รองรับแก้ไขผ่าน Excel)
      if (matchIdx >= 0) {
        jvRecords[matchIdx] = { ...jvRecords[matchIdx], ...record, updatedAt: new Date().toISOString() };
        updated++;
      } else {
        jvRecords.unshift({ id: 'JV_' + Date.now() + '_' + i, runningNo: jvNextRunningNo(), ...record, createdAt: new Date().toISOString() });
        added++;
      }
    });
    jvSave();
    jvPushIfReady();
    jvRenderList();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function jvRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function jvObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function jvApplyServer(serverRecords) {
  jvRecords = serverRecords;
  jvSave();
  jvRenderList();
}
async function jvWriteFB() {
  if (!jvRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(jvRef, jvRecordsToObj(jvRecords));
  } catch (e) { console.warn('jvWriteFB error', e); notifySyncWriteError(); }
}
function jvPushIfReady() { if (jvReady) jvWriteFB(); }

async function jvWriteOne(record) {
  if (!jvRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/jointVehicles/${record.id}`), record);
  } catch (e) { console.warn('jvWriteOne error', e); notifySyncWriteError(); }
}
function jvPushOneIfReady(record) { if (jvReady) jvWriteOne(record); }

async function jvRemoveOne(id) {
  if (!jvRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/jointVehicles/${id}`));
  } catch (e) { console.warn('jvRemoveOne error', e); notifySyncWriteError(); }
}
function jvRemoveOneIfReady(id) { if (jvReady) jvRemoveOne(id); }

function jvWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function jvInit() {
  await jvWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    jvRef = ref(fbDb, '/jointVehicles');
    const snap = await get(jvRef);
    if (snap.exists()) jvApplyServer(jvObjToRecords(snap.val()));
    jvReady = true;
    if (!snap.exists() && jvRecords.length > 0) await jvWriteFB();
    onValue(jvRef, s => { if (s.exists()) jvApplyServer(jvObjToRecords(s.val())); });
  } catch (e) {
    console.warn('jvInit error', e);
    notifySyncLoadError();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  jvClearForm();
  jvRenderList();
  jvInit();
  jvdbClearForm();
  jvdbRefreshLookupDropdowns();
  jvdbRenderList();
  jvdbInit();
});

// ===== ฐานข้อมูลรถร่วม (ทะเบียน/เจ้าของ/เอกสารและวันหมดอายุ) =====
// เก็บ local ที่ localStorage key 'finflow_jointvehicle_db' และ sync กับ Firebase ที่ /jointVehicleDB
// แจ้งเตือนก่อนวันหมดอายุ (ภาษี/พรบ./ประกันรถ/ประกันสินค้า) 90 วัน ด้วยตัวสีแดงในตาราง

let jvdbRecords = JSON.parse(localStorage.getItem('finflow_jointvehicle_db') || '[]');
let jvdbEditingId = null;
let jvdbRef = null;
let jvdbReady = false;

const JVDB_EXPIRY_FIELDS = [
  ['taxExpiry', 'ภาษี'],
  ['compulsoryExpiry', 'พรบ.'],
  ['vehInsExpiry', 'ประกันรถ'],
  ['cargoInsExpiry', 'ประกันสินค้า'],
];
const JVDB_EXPIRY_WARN_DAYS = 90;

const JVDB_XLSX_HEADERS = [
  'ลำดับที่', 'ทะเบียนรถ', 'ประเภทรถ', 'เจ้าของรถ', 'หน่วยงาน', 'ลานจอด',
  'วันที่สำเนาเล่ม (dd/mm/yyyy)', 'วันหมดอายุภาษี (dd/mm/yyyy)', 'วันหมดอายุพรบ. (dd/mm/yyyy)',
  'วันหมดอายุประกันรถ (dd/mm/yyyy)', 'วันหมดอายุประกันสินค้า (dd/mm/yyyy)',
];
const JVDB_XLSX_COLWIDTHS = [8, 14, 14, 20, 16, 12, 18, 18, 18, 18, 18];

function jvdbSave() { localStorage.setItem('finflow_jointvehicle_db', JSON.stringify(jvdbRecords)); }

function jvdbNextRunningNo() {
  return jvdbRecords.length ? Math.max(...jvdbRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

// ===== Lookup dropdowns (หน่วยงาน/ลานจอด จากฐานข้อมูลหลัก) =====
function jvdbFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function jvdbRefreshLookupDropdowns() {
  jvdbFillDatalist('jvdb-bu-list', mdBusinessUnits);
  jvdbFillDatalist('jvdb-yard-list', mdYards);
}

// ===== วันหมดอายุ =====
function jvdbDaysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86400000);
}

function jvdbIsNearExpiry(dateStr) {
  const days = jvdbDaysUntil(dateStr);
  return days !== null && days <= JVDB_EXPIRY_WARN_DAYS;
}

function jvdbExpiryCell(dateStr) {
  if (!dateStr) return '-';
  const warn = jvdbIsNearExpiry(dateStr);
  const label = formatDate(dateStr);
  return warn ? `<span style="color:#d90429;font-weight:700;">${label}</span>` : label;
}

// ===== Save / Edit / Delete =====
function jvdbSaveRecord() {
  const plate = document.getElementById('jvdb-plate').value.trim();
  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }

  const record = {
    plate,
    vehicleType: document.getElementById('jvdb-vehicletype').value.trim(),
    owner: document.getElementById('jvdb-owner').value.trim(),
    businessUnit: document.getElementById('jvdb-bu').value.trim(),
    yard: document.getElementById('jvdb-yard').value.trim(),
    bookCopyDate: document.getElementById('jvdb-bookcopy').value,
    taxExpiry: document.getElementById('jvdb-tax').value,
    compulsoryExpiry: document.getElementById('jvdb-compulsory').value,
    vehInsExpiry: document.getElementById('jvdb-vehins').value,
    cargoInsExpiry: document.getElementById('jvdb-cargoins').value,
  };

  let savedRecord;
  if (jvdbEditingId) {
    const idx = jvdbRecords.findIndex(r => r.id === jvdbEditingId);
    if (idx >= 0) {
      jvdbRecords[idx] = { ...jvdbRecords[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = jvdbRecords[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    jvdbCancelEdit();
  } else {
    savedRecord = {
      id: 'JVDB_' + Date.now(),
      runningNo: jvdbNextRunningNo(),
      ...record,
      createdAt: new Date().toISOString(),
    };
    jvdbRecords.unshift(savedRecord);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    jvdbClearForm();
  }
  jvdbSave();
  jvdbPushOneIfReady(savedRecord);
  jvdbRenderList();
}

function jvdbClearForm() {
  jvdbEditingId = null;
  const banner = document.getElementById('jvdb-edit-banner');
  if (banner) banner.style.display = 'none';
  ['jvdb-plate', 'jvdb-vehicletype', 'jvdb-owner', 'jvdb-bu', 'jvdb-yard', 'jvdb-bookcopy', 'jvdb-tax', 'jvdb-compulsory', 'jvdb-vehins', 'jvdb-cargoins']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function jvdbEditRecord(id) {
  const rec = jvdbRecords.find(r => r.id === id);
  if (!rec) return;
  jvdbEditingId = id;
  document.getElementById('jvdb-edit-banner').style.display = 'flex';
  document.getElementById('jvdb-edit-no').textContent = rec.runningNo;
  document.getElementById('jvdb-plate').value = rec.plate || '';
  document.getElementById('jvdb-vehicletype').value = rec.vehicleType || '';
  document.getElementById('jvdb-owner').value = rec.owner || '';
  document.getElementById('jvdb-bu').value = rec.businessUnit || '';
  document.getElementById('jvdb-yard').value = rec.yard || '';
  document.getElementById('jvdb-bookcopy').value = rec.bookCopyDate || '';
  document.getElementById('jvdb-tax').value = rec.taxExpiry || '';
  document.getElementById('jvdb-compulsory').value = rec.compulsoryExpiry || '';
  document.getElementById('jvdb-vehins').value = rec.vehInsExpiry || '';
  document.getElementById('jvdb-cargoins').value = rec.cargoInsExpiry || '';
  jvSwitchTab('dbadd');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jvdbCancelEdit() { jvdbClearForm(); }

function jvdbDeleteRecord(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  jvdbRecords = jvdbRecords.filter(r => r.id !== id);
  jvdbSave();
  jvdbRemoveOneIfReady(id);
  jvdbRenderList();
  showToast('ลบแล้ว', 'warning');
}

function jvdbDeleteAllRecords() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบข้อมูลรถร่วมทั้งหมด ${jvdbRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  jvdbRecords = [];
  jvdbSave();
  jvdbPushIfReady();
  jvdbRenderList();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== List / Filter =====
function jvdbFilteredList() {
  const search = (document.getElementById('jvdb-f-search')?.value || '').toLowerCase().trim();
  if (!search) return jvdbRecords;
  return jvdbRecords.filter(r =>
    `${r.plate} ${r.vehicleType} ${r.owner} ${r.businessUnit} ${r.yard}`.toLowerCase().includes(search)
  );
}

function jvdbClearListFilters() {
  const el = document.getElementById('jvdb-f-search');
  if (el) el.value = '';
  jvdbRenderList();
}

function jvdbRenderList() {
  const list = jvdbFilteredList();
  const tbody = document.getElementById('jvdb-list-body');
  const countEl = document.getElementById('jvdb-list-count');
  if (!tbody) return;
  const warnCount = list.filter(r => JVDB_EXPIRY_FIELDS.some(([key]) => jvdbIsNearExpiry(r[key]))).length;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ` + (warnCount ? ` — ใกล้หมดอายุ ${warnCount} คัน` : '');
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.vehicleType || '-')}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${r.bookCopyDate ? formatDate(r.bookCopyDate) : '-'}</td>
      <td>${jvdbExpiryCell(r.taxExpiry)}</td>
      <td>${jvdbExpiryCell(r.compulsoryExpiry)}</td>
      <td>${jvdbExpiryCell(r.vehInsExpiry)}</td>
      <td>${jvdbExpiryCell(r.cargoInsExpiry)}</td>
      <td>
        <button class="action-btn action-view" onclick="jvdbEditRecord('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="jvdbDeleteRecord('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Template / Export / Import (นำเข้าซ้ำ = แก้ไข จับคู่ด้วยทะเบียนรถ) =====
function jvdbDownloadTemplate() {
  const sample = [
    JVDB_XLSX_HEADERS,
    ['', '70-1234', 'หัวลาก', 'นายสมชาย ใจดี', 'Trailer', 'ABC', '15/01/2026', '31/12/2026', '31/12/2026', '31/12/2026', '31/12/2026'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = JVDB_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_ฐานข้อมูลรถร่วม.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function jvdbExportExcel() {
  if (!jvdbRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [JVDB_XLSX_HEADERS, ...jvdbRecords.map(r => [
    r.runningNo, r.plate || '', r.vehicleType || '', r.owner || '', r.businessUnit || '', r.yard || '',
    formatDMY(r.bookCopyDate), formatDMY(r.taxExpiry), formatDMY(r.compulsoryExpiry), formatDMY(r.vehInsExpiry), formatDMY(r.cargoInsExpiry),
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = JVDB_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ฐานข้อมูลรถร่วม');
  XLSX.writeFile(wb, 'ฐานข้อมูลรถร่วม_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function jvdbImportExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let added = 0, updated = 0;
      const now = new Date().toISOString();
      rows.slice(1).forEach(row => {
        const plate = String(row[1] || '').trim();
        if (!plate) return;
        const data = {
          plate,
          vehicleType: String(row[2] || '').trim(),
          owner: String(row[3] || '').trim(),
          businessUnit: String(row[4] || '').trim(),
          yard: String(row[5] || '').trim(),
          bookCopyDate: normalizeImportDate(row[6]),
          taxExpiry: normalizeImportDate(row[7]),
          compulsoryExpiry: normalizeImportDate(row[8]),
          vehInsExpiry: normalizeImportDate(row[9]),
          cargoInsExpiry: normalizeImportDate(row[10]),
        };
        // จับคู่ด้วย "ทะเบียนรถ" — ฐานข้อมูลนี้ทะเบียนต้องไม่ซ้ำกัน ถ้าเจอทะเบียนเดิมให้แก้ไขแทนเพิ่มซ้ำ
        const existingIdx = jvdbRecords.findIndex(r => r.plate === plate);
        if (existingIdx >= 0) {
          jvdbRecords[existingIdx] = { ...jvdbRecords[existingIdx], ...data, updatedAt: now };
          updated++;
        } else {
          jvdbRecords.push({
            id: 'JVDB_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            runningNo: jvdbNextRunningNo(),
            ...data,
            createdAt: now,
          });
          added++;
        }
      });
      jvdbSave(); jvdbPushIfReady(); jvdbRenderList();
      const msg = [updated ? `แก้ไข ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function jvdbRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function jvdbObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function jvdbApplyServer(serverRecords) {
  jvdbRecords = serverRecords;
  jvdbSave();
  jvdbRenderList();
}
async function jvdbWriteFB() {
  if (!jvdbRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(jvdbRef, jvdbRecordsToObj(jvdbRecords));
  } catch (e) { console.warn('jvdbWriteFB error', e); notifySyncWriteError(); }
}
function jvdbPushIfReady() { if (jvdbReady) jvdbWriteFB(); }

async function jvdbWriteOne(record) {
  if (!jvdbRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/jointVehicleDB/${record.id}`), record);
  } catch (e) { console.warn('jvdbWriteOne error', e); notifySyncWriteError(); }
}
function jvdbPushOneIfReady(record) { if (jvdbReady) jvdbWriteOne(record); }

async function jvdbRemoveOne(id) {
  if (!jvdbRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/jointVehicleDB/${id}`));
  } catch (e) { console.warn('jvdbRemoveOne error', e); notifySyncWriteError(); }
}
function jvdbRemoveOneIfReady(id) { if (jvdbReady) jvdbRemoveOne(id); }

async function jvdbInit() {
  await jvWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    jvdbRef = ref(fbDb, '/jointVehicleDB');
    const snap = await get(jvdbRef);
    if (snap.exists()) jvdbApplyServer(jvdbObjToRecords(snap.val()));
    jvdbReady = true;
    if (!snap.exists() && jvdbRecords.length > 0) await jvdbWriteFB();
    onValue(jvdbRef, s => { if (s.exists()) jvdbApplyServer(jvdbObjToRecords(s.val())); });
  } catch (e) { console.warn('jvdbInit error', e); notifySyncLoadError(); }
}

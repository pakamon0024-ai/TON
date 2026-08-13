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
  ['list', 'add'].forEach(t => {
    document.getElementById(`jv-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`jv-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') jvRenderList();
  if (tab === 'add' && !jvEditingId) jvClearForm();
}

function jvOnPageShown() { jvRenderList(); }

// ===== ดึงเจ้าของรถจากฐานข้อมูลหลัก =====
function jvLookupVehicle() {
  const plate = document.getElementById('jv-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('jv-owner').value = veh?.owner || '';
}

// ===== Running number =====
function jvNextRunningNo() {
  return jvRecords.length ? Math.max(...jvRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

function jvStatusOf(rec) { return rec.leaveDate ? 'left' : 'active'; }
function jvStatusBadge(rec) {
  return jvStatusOf(rec) === 'left'
    ? `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">ลาออกแล้ว</span>`
    : `<span class="badge badge-green">ร่วมอยู่</span>`;
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
  const plate = document.getElementById('jv-plate').value.trim();
  const owner = document.getElementById('jv-owner').value.trim();
  const joinDate = document.getElementById('jv-join-date').value;
  const lastWorkDate = document.getElementById('jv-lastwork-date').value;
  const leaveDate = document.getElementById('jv-leave-date').value;
  const note = document.getElementById('jv-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  if (!joinDate) { showToast('กรุณาระบุวันที่สมัครเข้าร่วม', 'warning'); return; }

  const record = {
    plate, owner, joinDate, lastWorkDate, leaveDate, note,
    costGps: parseFloat(document.getElementById('jv-cost-gps').value) || 0,
    costCctv: parseFloat(document.getElementById('jv-cost-cctv').value) || 0,
    costBreath: parseFloat(document.getElementById('jv-cost-breath').value) || 0,
  };
  JV_DOC_FIELDS.forEach(([id, key]) => { record[key] = document.getElementById(id).checked; });
  JV_LEAVE_CHECK_FIELDS.forEach(([id, key]) => { record[key] = document.getElementById(id).checked; });

  if (jvEditingId) {
    const idx = jvRecords.findIndex(r => r.id === jvEditingId);
    if (idx >= 0) {
      jvRecords[idx] = { ...jvRecords[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    jvCancelEdit();
  } else {
    record.id = 'JV_' + Date.now();
    record.runningNo = jvNextRunningNo();
    record.createdAt = new Date().toISOString();
    jvRecords.unshift(record);
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🚛 <b>บันทึกรถร่วมใหม่</b>\nทะเบียน: ${escapeHtml(plate)}\nเจ้าของรถ: ${escapeHtml(owner || '-')}\nวันที่สมัครเข้าร่วม: ${formatDate(joinDate)}\nเอกสารครบ: ${jvDocCount(record)}/${JV_DOC_FIELDS.length}${leaveDate ? `\nวันที่ลาออก: ${formatDate(leaveDate)}` : ''}`
      );
    }
    jvClearForm();
  }
  jvSave();
  jvPushIfReady();
  jvRenderList();
}

function jvClearForm() {
  jvEditingId = null;
  document.getElementById('jv-edit-banner').style.display = 'none';
  document.getElementById('jv-plate').value = '';
  document.getElementById('jv-owner').value = '';
  document.getElementById('jv-join-date').value = '';
  document.getElementById('jv-lastwork-date').value = '';
  document.getElementById('jv-leave-date').value = '';
  document.getElementById('jv-note').value = '';
  document.getElementById('jv-cost-gps').value = '';
  document.getElementById('jv-cost-cctv').value = '';
  document.getElementById('jv-cost-breath').value = '';
  JV_DOC_FIELDS.forEach(([id]) => { document.getElementById(id).checked = false; });
  JV_LEAVE_CHECK_FIELDS.forEach(([id]) => { document.getElementById(id).checked = false; });
  jvCalcRemovalCost();
}

function jvEditCase(id) {
  const rec = jvRecords.find(r => r.id === id);
  if (!rec) return;
  jvEditingId = id;
  document.getElementById('jv-edit-banner').style.display = 'flex';
  document.getElementById('jv-edit-no').textContent = rec.runningNo;
  document.getElementById('jv-plate').value = rec.plate || '';
  document.getElementById('jv-owner').value = rec.owner || '';
  document.getElementById('jv-join-date').value = rec.joinDate || '';
  document.getElementById('jv-lastwork-date').value = rec.lastWorkDate || '';
  document.getElementById('jv-leave-date').value = rec.leaveDate || '';
  document.getElementById('jv-note').value = rec.note || '';
  document.getElementById('jv-cost-gps').value = rec.costGps || '';
  document.getElementById('jv-cost-cctv').value = rec.costCctv || '';
  document.getElementById('jv-cost-breath').value = rec.costBreath || '';
  JV_DOC_FIELDS.forEach(([id, key]) => { document.getElementById(id).checked = !!rec[key]; });
  JV_LEAVE_CHECK_FIELDS.forEach(([id, key]) => { document.getElementById(id).checked = !!rec[key]; });
  jvCalcRemovalCost();
  jvSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function jvCancelEdit() { jvClearForm(); }

function jvDeleteCase(id) {
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  jvRecords = jvRecords.filter(r => r.id !== id);
  jvSave();
  jvPushIfReady();
  jvRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function jvFilteredList() {
  const plate = (document.getElementById('jv-f-plate')?.value || '').trim().toLowerCase();
  const status = document.getElementById('jv-f-status')?.value || '';
  return jvRecords.filter(r => {
    if (plate && !r.plate.toLowerCase().includes(plate)) return false;
    if (status && jvStatusOf(r) !== status) return false;
    return true;
  });
}

function jvClearListFilters() {
  document.getElementById('jv-f-plate').value = '';
  document.getElementById('jv-f-status').value = '';
  jvRenderList();
}

function jvRenderList() {
  const list = jvFilteredList();
  const tbody = document.getElementById('jv-list-body');
  const countEl = document.getElementById('jv-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
      <td>${jvDocCount(r)}/${JV_DOC_FIELDS.length}</td>
      <td>${formatDate(r.joinDate)}</td>
      <td>${r.leaveDate ? formatDate(r.leaveDate) : '-'}</td>
      <td>${jvStatusBadge(r)}</td>
      <td>${r.leaveDate ? formatMoney(jvRemovalCost(r)) : '-'}</td>
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
  'ทะเบียนรถ', 'เจ้าของรถ', 'วันที่สมัครเข้าร่วม (YYYY-MM-DD)',
  'บัตรประชาชนเจ้าของรถ', 'บัตรประชาชนคนขับ', 'ทะเบียนบ้าน', 'ใบขับขี่คนขับ', 'ประกันรถ', 'พรบ.', 'ประกันสินค้า',
  'วันที่ทำงานวันสุดท้าย (YYYY-MM-DD)', 'วันที่ลาออก (YYYY-MM-DD)',
  'ถอด GPS', 'ถอด CCTV', 'ถอดเครื่องเป่าแอลกอฮอล์', 'คืนบัตรน้ำมัน', 'ถอดสติ๊กเกอร์',
  'ค่าใช้จ่ายถอด GPS', 'ค่าใช้จ่ายถอด CCTV', 'ค่าใช้จ่ายถอดเครื่องเป่าแอลกอฮอล์', 'หมายเหตุ',
];

function jvDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    JV_XLSX_HEADERS,
    ['70-1234', 'นายสมชาย ใจดี', '2026-01-15', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', '', '', '', '', '', '', '', 0, 0, 0, ''],
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
      r.plate, r.owner || '', r.joinDate || '',
      !!r.docIdOwner, !!r.docIdDriver, !!r.docHouseReg, !!r.docLicense, !!r.docVehIns, !!r.docCompulsory, !!r.docCargoIns,
      r.lastWorkDate || '', r.leaveDate || '',
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
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      const joinDate = normalizeImportDate(row[2]);
      const veh = mdVehicles.find(v => v.plate === plate);
      const record = {
        plate,
        owner: String(row[1] || '').trim() || veh?.owner || '',
        joinDate,
        docIdOwner: jvParseBool(row[3]), docIdDriver: jvParseBool(row[4]), docHouseReg: jvParseBool(row[5]),
        docLicense: jvParseBool(row[6]), docVehIns: jvParseBool(row[7]), docCompulsory: jvParseBool(row[8]), docCargoIns: jvParseBool(row[9]),
        lastWorkDate: normalizeImportDate(row[10]), leaveDate: normalizeImportDate(row[11]),
        leaveGps: jvParseBool(row[12]), leaveCctv: jvParseBool(row[13]), leaveBreath: jvParseBool(row[14]),
        leaveFuelCard: jvParseBool(row[15]), leaveSticker: jvParseBool(row[16]),
        costGps: parseFloat(row[17]) || 0, costCctv: parseFloat(row[18]) || 0, costBreath: parseFloat(row[19]) || 0,
        note: String(row[20] || '').trim(),
      };
      // จับคู่ด้วยทะเบียน + วันที่สมัคร — ถ้าตรงกับรายการเดิม แก้ไขแทนเพิ่มใหม่ (รองรับแก้ไขผ่าน Excel)
      const idx = jvRecords.findIndex(r => r.plate === plate && r.joinDate === joinDate);
      if (idx >= 0) {
        jvRecords[idx] = { ...jvRecords[idx], ...record, updatedAt: new Date().toISOString() };
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
  } catch (e) { console.warn('jvWriteFB error', e); }
}
function jvPushIfReady() { if (jvReady) jvWriteFB(); }

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
  }
}

document.addEventListener('DOMContentLoaded', () => {
  jvClearForm();
  jvRenderList();
  jvInit();
});

// ===== ระบบบันทึกข้อร้องเรียน =====
// เก็บ local ที่ localStorage key 'finflow_complaints' และ sync กับ Firebase ที่ /complaints

let complaints = JSON.parse(localStorage.getItem('finflow_complaints') || '[]');
let cpEditingId = null;
let cpRef = null;
let cpReady = false;

const CP_XLSX_HEADERS = ['เลขที่','ลงวันที่','เรื่อง','รายละเอียด','ทะเบียน','พนักงานขับรถ','หน่วยงาน','ลานจอด','การแก้ไข','หัวหน้างาน'];

function cpSave() { safeLocalStorageSet('finflow_complaints', JSON.stringify(complaints)); }

// ===== Sub-tabs =====
function cpSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`cp-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`cp-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') cpRenderList();
  if (tab === 'add' && !cpEditingId) cpClearForm();
}

function cpOnPageShown() {
  cpRefreshLookupDropdowns();
  cpRenderList();
}

// ===== Lookup dropdowns =====
function cpFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function cpFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function cpRefreshLookupDropdowns() {
  cpFillDatalist('cp-driver-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  cpFillDatalist('cp-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  cpFillDatalist('cp-bu-list', mdBusinessUnits);
  cpFillDatalist('cp-yard-list', mdYards);
  cpFillSelect('cp-f-yard', mdYards);
}

function cpLookupVehicle() {
  const plate = document.getElementById('cp-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('cp-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('cp-yard').value = veh.yard;
  }
}

// ===== Running number =====
function cpNextRunningNo() {
  return complaints.length ? Math.max(...complaints.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function cpSaveCase() {
  const date = document.getElementById('cp-date').value;
  const subject = document.getElementById('cp-subject').value.trim();
  const detail = document.getElementById('cp-detail').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!subject) { showToast('กรุณาระบุเรื่อง', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียด', 'warning'); return; }

  const record = {
    date, subject, detail,
    plate: document.getElementById('cp-plate').value.trim(),
    driverName: document.getElementById('cp-driver').value.trim(),
    businessUnit: document.getElementById('cp-bu').value.trim(),
    yard: document.getElementById('cp-yard').value.trim(),
    resolution: document.getElementById('cp-resolution').value.trim(),
    supervisor: document.getElementById('cp-supervisor').value.trim(),
  };

  let savedRecord;
  if (cpEditingId) {
    const idx = complaints.findIndex(i => i.id === cpEditingId);
    if (idx >= 0) {
      complaints[idx] = { ...complaints[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = complaints[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    cpCancelEdit();
  } else {
    record.id = 'CP_' + Date.now();
    record.runningNo = cpNextRunningNo();
    record.createdAt = new Date().toISOString();
    complaints.unshift(record);
    savedRecord = record;
    showToast('บันทึกข้อมูลแล้ว', 'success');
    cpClearForm();
  }
  cpSave();
  cpPushOneIfReady(savedRecord);
  cpRenderList();
}

function cpClearForm() {
  cpEditingId = null;
  document.getElementById('cp-edit-banner').style.display = 'none';
  ['cp-date', 'cp-subject', 'cp-detail', 'cp-plate', 'cp-driver', 'cp-bu', 'cp-yard', 'cp-resolution', 'cp-supervisor']
    .forEach(id => { document.getElementById(id).value = ''; });
}

function cpEditCase(id) {
  const rec = complaints.find(i => i.id === id);
  if (!rec) return;
  cpEditingId = id;
  document.getElementById('cp-edit-banner').style.display = 'flex';
  document.getElementById('cp-edit-no').textContent = rec.runningNo;
  document.getElementById('cp-date').value = rec.date || '';
  document.getElementById('cp-subject').value = rec.subject || '';
  document.getElementById('cp-detail').value = rec.detail || '';
  document.getElementById('cp-plate').value = rec.plate || '';
  document.getElementById('cp-driver').value = rec.driverName || '';
  document.getElementById('cp-bu').value = rec.businessUnit || '';
  document.getElementById('cp-yard').value = rec.yard || '';
  document.getElementById('cp-resolution').value = rec.resolution || '';
  document.getElementById('cp-supervisor').value = rec.supervisor || '';
  cpSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function cpCancelEdit() { cpClearForm(); }

function cpDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบข้อร้องเรียนนี้?')) return;
  complaints = complaints.filter(i => i.id !== id);
  cpSave();
  cpRemoveOneIfReady(id);
  cpRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function cpFilteredList() {
  const yard = document.getElementById('cp-f-yard')?.value || '';
  const search = (document.getElementById('cp-f-search')?.value || '').toLowerCase().trim();
  return complaints.filter(i => {
    if (yard && i.yard !== yard) return false;
    if (search && !(`${i.subject} ${i.detail} ${i.plate} ${i.driverName} ${i.businessUnit} ${i.resolution} ${i.supervisor}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function cpClearListFilters() {
  ['cp-f-yard', 'cp-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  cpRenderList();
}

function cpRenderList() {
  const list = cpFilteredList();
  const tbody = document.getElementById('cp-list-body');
  const countEl = document.getElementById('cp-list-count');
  const pagerEl = document.getElementById('cp-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('cp-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('cp-list', page, totalPages, total, 'cpRenderList');
  tbody.innerHTML = pageItems.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.subject)}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.driverName || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.supervisor || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="cpEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="cpDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Export =====
function cpExportExcel() {
  if (!complaints.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [CP_XLSX_HEADERS, ...complaints.map(i => [
    i.runningNo, formatDMY(i.date), i.subject||'', i.detail||'', i.plate||'', i.driverName||'',
    i.businessUnit||'', i.yard||'', i.resolution||'', i.supervisor||''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [8, 14, 24, 36, 14, 18, 18, 14, 30, 18].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ข้อร้องเรียน');
  XLSX.writeFile(wb, 'ข้อร้องเรียน_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// ===== Firebase Sync =====
function cpRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function cpObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
// เก็บบันทึกที่ server ยังไม่มีไว้ ไม่ให้ถูก apply ทับจนหาย แล้ว sync กลับขึ้น server
function cpApplyServer(serverList) {
  const serverIds = new Set(serverList.map(r => r.id));
  const localOnly = (complaints || []).filter(t => t && t.id && !serverIds.has(t.id));
  complaints = serverList.concat(localOnly);
  cpSave();
  cpRenderList();
  if (localOnly.length > 0) cpWriteFB();
}
async function cpWriteFB() {
  if (!cpRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(cpRef, cpRecordsToObj(complaints));
  } catch (e) { console.warn('cpWriteFB error', e); notifySyncWriteError(e.message); }
}

async function cpWriteOne(record) {
  if (!cpRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/complaints/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('cpWriteOne error', e); notifySyncWriteError(e.message); }
}
function cpPushOneIfReady(record) { if (cpReady) cpWriteOne(record); }

async function cpRemoveOne(id) {
  if (!cpRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/complaints/${id}`));
  } catch (e) { console.warn('cpRemoveOne error', e); notifySyncWriteError(e.message); }
}
function cpRemoveOneIfReady(id) { if (cpReady) cpRemoveOne(id); }

function cpWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function cpInit() {
  await cpWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    cpRef = ref(fbDb, '/complaints');
    const snap = await get(cpRef);
    if (snap.exists()) cpApplyServer(cpObjToRecords(snap.val()));
    cpReady = true;
    if (!snap.exists() && complaints.length > 0) await cpWriteFB();
    onValue(cpRef, s => { if (s.exists()) cpApplyServer(cpObjToRecords(s.val())); });
  } catch (e) { console.warn('cpInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  cpRefreshLookupDropdowns();
  cpClearForm();
  cpRenderList();
  cpInit();
});

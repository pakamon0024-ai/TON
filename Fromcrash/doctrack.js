// ===== ระบบติดตามเอกสารต่างๆ =====
// เก็บ local ที่ localStorage key 'finflow_doc_track' และ sync กับ Firebase ที่ /docTracking

let docTracks = JSON.parse(localStorage.getItem('finflow_doc_track') || '[]');
let dtkEditingId = null;
let dtkRef = null;
let dtkReady = false;

const DTK_XLSX_HEADERS = ['Date','Detail','ID.','Name','Yard','Project','Duedate','Send date','เอกสารเกินกำหนด (วัน)','ผู้รับผิดชอบ','หมายเหตุ'];

function dtkSave() { safeLocalStorageSet('finflow_doc_track', JSON.stringify(docTracks)); }

function dtkTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// จำนวนวันที่เกินกำหนด: นับจาก Duedate ถึงวันที่ส่ง (ถ้ายังไม่ส่งนับถึงวันนี้) — ไม่เกินกำหนดให้เป็น 0
function dtkOverdueDays(rec) {
  if (!rec.dueDate) return 0;
  const end = rec.sendDate || dtkTodayStr();
  const diff = Math.round((new Date(end) - new Date(rec.dueDate)) / 86400000);
  return diff > 0 ? diff : 0;
}

// ===== Sub-tabs =====
function dtkSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`dtk-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`dtk-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') dtkRenderList();
  if (tab === 'add' && !dtkEditingId) dtkClearForm();
}

function dtkOnPageShown() {
  dtkRefreshLookupDropdowns();
  dtkRenderList();
}

// ===== Lookup dropdowns =====
function dtkFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function dtkFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function dtkRefreshLookupDropdowns() {
  const uniq = field => [...new Set(docTracks.map(r => (r[field] || '').trim()).filter(Boolean))];
  dtkFillDatalist('dtk-detail-list', uniq('detail'));
  dtkFillDatalist('dtk-name-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  dtkFillDatalist('dtk-yard-list', mdYards);
  dtkFillDatalist('dtk-project-list', mdBusinessUnits);
  dtkFillDatalist('dtk-owner-list', uniq('owner'));
  dtkFillDatalist('dtk-note-list', uniq('note'));
  dtkFillSelect('dtk-f-yard', mdYards);
}

// ===== Save / Edit / Delete =====
function dtkSaveCase() {
  const date = document.getElementById('dtk-date').value;
  const detail = document.getElementById('dtk-detail').value.trim();
  const name = document.getElementById('dtk-name').value.trim();
  const dueDate = document.getElementById('dtk-due').value;

  if (!date) { showToast('กรุณาระบุวันที่ (Date)', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียด (Detail)', 'warning'); return; }
  if (!name) { showToast('กรุณาระบุชื่อ (Name)', 'warning'); return; }
  if (!dueDate) { showToast('กรุณาระบุวันครบกำหนด (Duedate)', 'warning'); return; }

  const record = {
    date, detail, name, dueDate,
    empId: document.getElementById('dtk-empid').value.trim(),
    yard: document.getElementById('dtk-yard').value.trim(),
    project: document.getElementById('dtk-project').value.trim(),
    sendDate: document.getElementById('dtk-send').value,
    owner: document.getElementById('dtk-owner').value.trim(),
    note: document.getElementById('dtk-note').value.trim(),
  };

  let savedRecord;
  if (dtkEditingId) {
    const idx = docTracks.findIndex(i => i.id === dtkEditingId);
    if (idx >= 0) {
      docTracks[idx] = { ...docTracks[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = docTracks[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    dtkCancelEdit();
  } else {
    record.id = 'DTK_' + Date.now();
    record.createdAt = new Date().toISOString();
    docTracks.unshift(record);
    savedRecord = record;
    showToast('บันทึกข้อมูลแล้ว', 'success');
    dtkClearForm();
  }
  dtkSave();
  dtkPushOneIfReady(savedRecord);
  dtkRefreshLookupDropdowns();
  dtkRenderList();
}

const DTK_FORM_FIELDS = {
  'dtk-date': 'date', 'dtk-detail': 'detail', 'dtk-empid': 'empId', 'dtk-name': 'name', 'dtk-yard': 'yard',
  'dtk-project': 'project', 'dtk-due': 'dueDate', 'dtk-send': 'sendDate', 'dtk-owner': 'owner', 'dtk-note': 'note',
};

function dtkClearForm() {
  dtkEditingId = null;
  document.getElementById('dtk-edit-banner').style.display = 'none';
  Object.keys(DTK_FORM_FIELDS).forEach(id => { document.getElementById(id).value = ''; });
}

function dtkEditCase(id) {
  const rec = docTracks.find(i => i.id === id);
  if (!rec) return;
  dtkEditingId = id;
  document.getElementById('dtk-edit-banner').style.display = 'flex';
  Object.entries(DTK_FORM_FIELDS).forEach(([elId, field]) => { document.getElementById(elId).value = rec[field] || ''; });
  dtkSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function dtkCancelEdit() { dtkClearForm(); }

// บันทึกวันที่ส่งเอกสารได้ตรงจากช่องวันที่ในหน้ารายการ (ไม่ต้องเข้าไปแก้ไข)
function dtkSetSendDate(id, value) {
  const idx = docTracks.findIndex(i => i.id === id);
  if (idx < 0) return;
  docTracks[idx] = { ...docTracks[idx], sendDate: value || '', updatedAt: new Date().toISOString() };
  dtkSave();
  dtkPushOneIfReady(docTracks[idx]);
  dtkRenderList();
}

function dtkDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการติดตามเอกสารนี้?')) return;
  docTracks = docTracks.filter(i => i.id !== id);
  dtkSave();
  dtkRemoveOneIfReady(id);
  dtkRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function dtkFilteredList() {
  const yard = document.getElementById('dtk-f-yard')?.value || '';
  const status = document.getElementById('dtk-f-status')?.value || '';
  const search = (document.getElementById('dtk-f-search')?.value || '').toLowerCase().trim();
  return docTracks.filter(i => {
    if (yard && i.yard !== yard) return false;
    if (status === 'pending' && i.sendDate) return false;
    if (status === 'sent' && !i.sendDate) return false;
    if (status === 'overdue' && !(dtkOverdueDays(i) > 0 && !i.sendDate)) return false;
    if (search && !(`${i.detail} ${i.empId} ${i.name} ${i.project} ${i.owner} ${i.note}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function dtkClearListFilters() {
  ['dtk-f-yard', 'dtk-f-status', 'dtk-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  dtkRenderList();
}

function dtkRenderList() {
  const list = dtkFilteredList();
  const tbody = document.getElementById('dtk-list-body');
  const countEl = document.getElementById('dtk-list-count');
  const pagerEl = document.getElementById('dtk-list-pager');
  if (!tbody) return;
  if (countEl) {
    const overdueCnt = list.filter(i => !i.sendDate && dtkOverdueDays(i) > 0).length;
    countEl.textContent = `ทั้งหมด ${list.length} รายการ · ยังไม่ส่งและเกินกำหนด ${overdueCnt} รายการ`;
  }
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('dtk-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('dtk-list', page, totalPages, total, 'dtkRenderList');
  tbody.innerHTML = pageItems.map(i => {
    const days = dtkOverdueDays(i);
    const late = days > 0 && !i.sendDate;
    return `
    <tr class="${late ? 'dtk-row-late' : ''}">
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>${escapeHtml(i.empId || '-')}</td>
      <td>${escapeHtml(i.name)}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.project || '-')}</td>
      <td class="dtk-due">${formatDate(i.dueDate)}</td>
      <td class="dtk-send"><input type="date" value="${i.sendDate || ''}" onchange="dtkSetSendDate('${i.id}', this.value)" /></td>
      <td class="dtk-days">${days > 0 ? days : '-'}</td>
      <td>${escapeHtml(i.owner || '-')}</td>
      <td>${escapeHtml(i.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="dtkEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="dtkDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>`;
  }).join('');
}

// ===== Excel Export =====
function dtkExportExcel() {
  if (!docTracks.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [DTK_XLSX_HEADERS, ...docTracks.map(i => [
    formatDMY(i.date), i.detail||'', i.empId||'', i.name||'', i.yard||'', i.project||'',
    formatDMY(i.dueDate), formatDMY(i.sendDate), dtkOverdueDays(i), i.owner||'', i.note||''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12, 22, 10, 24, 10, 12, 12, 12, 14, 16, 24].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ติดตามเอกสาร');
  XLSX.writeFile(wb, 'ติดตามเอกสาร_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// ===== Firebase Sync =====
function dtkRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function dtkObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
// เก็บบันทึกที่ server ยังไม่มีไว้ ไม่ให้ถูก apply ทับจนหาย แล้ว sync กลับขึ้น server
function dtkApplyServer(serverList) {
  const serverIds = new Set(serverList.map(r => r.id));
  const localOnly = (docTracks || []).filter(t => t && t.id && !serverIds.has(t.id));
  docTracks = serverList.concat(localOnly);
  dtkSave();
  dtkRefreshLookupDropdowns();
  dtkRenderList();
  if (localOnly.length > 0) dtkWriteFB();
}
async function dtkWriteFB() {
  if (!dtkRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(dtkRef, dtkRecordsToObj(docTracks));
  } catch (e) { console.warn('dtkWriteFB error', e); notifySyncWriteError(e.message); }
}

async function dtkWriteOne(record) {
  if (!dtkRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/docTracking/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('dtkWriteOne error', e); notifySyncWriteError(e.message); }
}
function dtkPushOneIfReady(record) { if (dtkReady) dtkWriteOne(record); }

async function dtkRemoveOne(id) {
  if (!dtkRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/docTracking/${id}`));
  } catch (e) { console.warn('dtkRemoveOne error', e); notifySyncWriteError(e.message); }
}
function dtkRemoveOneIfReady(id) { if (dtkReady) dtkRemoveOne(id); }

function dtkWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function dtkInit() {
  await dtkWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    dtkRef = ref(fbDb, '/docTracking');
    const snap = await get(dtkRef);
    if (snap.exists()) dtkApplyServer(dtkObjToRecords(snap.val()));
    dtkReady = true;
    if (!snap.exists() && docTracks.length > 0) await dtkWriteFB();
    onValue(dtkRef, s => { if (s.exists()) dtkApplyServer(dtkObjToRecords(s.val())); });
  } catch (e) { console.warn('dtkInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  dtkRefreshLookupDropdowns();
  dtkClearForm();
  dtkRenderList();
  dtkInit();
});

// ===== ระบบบันทึกปัญหาการทำงาน =====
// เก็บ local ที่ localStorage key 'finflow_work_issues' และ sync กับ Firebase ที่ /workIssues

let workIssues = JSON.parse(localStorage.getItem('finflow_work_issues') || '[]');
let wiEditingId = null;
let wiRef = null;
let wiReady = false;

const WI_XLSX_HEADERS = ['เลขที่','วันที่','หัวข้อปัญหา','ชื่อพนักงาน','ทะเบียน','หน่วยงาน','ลานจอด','รายละเอียด'];

function wiSave() { localStorage.setItem('finflow_work_issues', JSON.stringify(workIssues)); }

// ===== Sub-tabs =====
function wiSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`wi-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`wi-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') wiRenderList();
  if (tab === 'add' && !wiEditingId) wiClearForm();
}

function wiOnPageShown() {
  wiRefreshLookupDropdowns();
  wiRenderList();
}

// ===== Lookup dropdowns =====
function wiFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function wiFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function wiRefreshLookupDropdowns() {
  wiFillDatalist('wi-topic-list', mdIssueTopics);
  wiFillDatalist('wi-driver-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  wiFillDatalist('wi-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  wiFillDatalist('wi-bu-list', mdBusinessUnits);
  wiFillDatalist('wi-yard-list', mdYards);
  wiFillSelect('wi-f-topic', mdIssueTopics);
  wiFillSelect('wi-f-yard', mdYards);
}

function wiLookupVehicle() {
  const plate = document.getElementById('wi-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('wi-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('wi-yard').value = veh.yard;
  }
}

function wiQuickAddTopic() {
  const name = (prompt('เพิ่มหัวข้อปัญหาใหม่:') || '').trim();
  if (!name) return;
  if (!mdIssueTopics.includes(name)) {
    mdIssueTopics.push(name);
    if (typeof saveIssueTopicsDB === 'function') saveIssueTopicsDB();
    wiRefreshLookupDropdowns();
    if (typeof mdPushIfReady === 'function') mdPushIfReady();
  }
  const sel = document.getElementById('wi-topic');
  if (sel) sel.value = name;
}

// ===== Running number =====
function wiNextRunningNo() {
  return workIssues.length ? Math.max(...workIssues.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function wiSaveCase() {
  const date = document.getElementById('wi-date').value;
  const topic = document.getElementById('wi-topic').value.trim();
  const detail = document.getElementById('wi-detail').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!topic) { showToast('กรุณาเลือกหัวข้อปัญหา', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียดปัญหา', 'warning'); return; }

  const record = {
    date, topic,
    driverName: document.getElementById('wi-driver').value,
    plate: document.getElementById('wi-plate').value,
    businessUnit: document.getElementById('wi-bu').value,
    yard: document.getElementById('wi-yard').value,
    detail,
  };

  if (wiEditingId) {
    const idx = workIssues.findIndex(i => i.id === wiEditingId);
    if (idx >= 0) {
      workIssues[idx] = { ...workIssues[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('บันทึกการแก้ไขแล้ว', 'success');
      if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(`✏️ <b>แก้ไขบันทึกปัญหาการทำงาน</b>\nเลขที่: ${workIssues[idx].runningNo}\nหัวข้อ: ${escapeHtml(topic)}`);
      }
    }
    wiCancelEdit();
  } else {
    record.id = 'WI_' + Date.now();
    record.runningNo = wiNextRunningNo();
    record.createdAt = new Date().toISOString();
    workIssues.unshift(record);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `⚠️ <b>บันทึกปัญหาการทำงานใหม่</b>\nเลขที่: ${record.runningNo}\nหัวข้อ: ${escapeHtml(topic)}\nพนักงาน: ${escapeHtml(record.driverName)}\nทะเบียน: ${escapeHtml(record.plate)}\nรายละเอียด: ${escapeHtml(detail)}`
      );
    }
    wiClearForm();
  }
  wiSave();
  wiPushIfReady();
  wiRenderList();
}

function wiClearForm() {
  wiEditingId = null;
  document.getElementById('wi-edit-banner').style.display = 'none';
  document.getElementById('wi-date').value = '';
  document.getElementById('wi-topic').value = '';
  document.getElementById('wi-driver').value = '';
  document.getElementById('wi-plate').value = '';
  document.getElementById('wi-bu').value = '';
  document.getElementById('wi-yard').value = '';
  document.getElementById('wi-detail').value = '';
}

function wiEditCase(id) {
  const rec = workIssues.find(i => i.id === id);
  if (!rec) return;
  wiEditingId = id;
  document.getElementById('wi-edit-banner').style.display = 'flex';
  document.getElementById('wi-edit-no').textContent = rec.runningNo;
  document.getElementById('wi-date').value = rec.date || '';
  document.getElementById('wi-topic').value = rec.topic || '';
  document.getElementById('wi-driver').value = rec.driverName || '';
  document.getElementById('wi-plate').value = rec.plate || '';
  document.getElementById('wi-bu').value = rec.businessUnit || '';
  document.getElementById('wi-yard').value = rec.yard || '';
  document.getElementById('wi-detail').value = rec.detail || '';
  wiSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wiCancelEdit() { wiClearForm(); }

function wiDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  workIssues = workIssues.filter(i => i.id !== id);
  wiSave();
  wiPushIfReady();
  wiRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function wiFilteredList() {
  const topic = document.getElementById('wi-f-topic')?.value || '';
  const yard = document.getElementById('wi-f-yard')?.value || '';
  const search = (document.getElementById('wi-f-search')?.value || '').toLowerCase().trim();
  return workIssues.filter(i => {
    if (topic && i.topic !== topic) return false;
    if (yard && i.yard !== yard) return false;
    if (search && !(`${i.topic} ${i.driverName} ${i.plate} ${i.businessUnit} ${i.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function wiClearListFilters() {
  ['wi-f-topic', 'wi-f-yard', 'wi-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  wiRenderList();
}

function wiRenderList() {
  const list = wiFilteredList();
  const tbody = document.getElementById('wi-list-body');
  const countEl = document.getElementById('wi-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.topic)}</td>
      <td>${escapeHtml(i.driverName || '-')}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>
        <button class="action-btn action-view" onclick="wiEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="wiDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Export / Import / Template =====
function wiExportExcel() {
  if (!workIssues.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [WI_XLSX_HEADERS, ...workIssues.map(i => [
    i.runningNo, i.date, i.topic||'', i.driverName||'', i.plate||'', i.businessUnit||'', i.yard||'', i.detail||''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [8, 14, 20, 18, 14, 18, 14, 36].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ปัญหาการทำงาน');
  XLSX.writeFile(wb, 'บันทึกปัญหาการทำงาน_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function wiDownloadTemplate() {
  const sample = [
    WI_XLSX_HEADERS,
    ['', '2025-01-15', 'GPS', 'สมชาย ใจดี', '1กข 1234', 'Trailer', 'ABC', 'ตัวอย่างรายละเอียดปัญหาที่พบ']
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = [8, 14, 20, 18, 14, 18, 14, 36].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_บันทึกปัญหา.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function wiImportExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let added = 0;
      rows.slice(1).forEach(row => {
        if (!row[1] && !row[2]) return;
        const rec = {
          id: 'WI_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          runningNo: wiNextRunningNo(),
          date: String(row[1] || '').trim(),
          topic: String(row[2] || '').trim(),
          driverName: String(row[3] || '').trim(),
          plate: String(row[4] || '').trim(),
          businessUnit: String(row[5] || '').trim(),
          yard: String(row[6] || '').trim(),
          detail: String(row[7] || '').trim(),
          createdAt: new Date().toISOString(),
        };
        workIssues.push(rec);
        added++;
      });
      wiSave(); wiPushIfReady(); wiRenderList();
      showToast(`นำเข้า ${added} รายการ`, 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsBinaryString(file);
}

// ===== Firebase Sync =====
function wiRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function wiObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function wiApplyServer(serverIssues) {
  workIssues = serverIssues;
  wiSave();
  wiRenderList();
}
async function wiWriteFB() {
  if (!wiRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(wiRef, wiRecordsToObj(workIssues));
  } catch (e) { console.warn('wiWriteFB error', e); }
}
function wiPushIfReady() { if (wiReady) wiWriteFB(); }

function wiWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function wiInit() {
  await wiWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    wiRef = ref(fbDb, '/workIssues');
    const snap = await get(wiRef);
    if (snap.exists()) wiApplyServer(wiObjToRecords(snap.val()));
    wiReady = true;
    if (!snap.exists() && workIssues.length > 0) await wiWriteFB();
    onValue(wiRef, s => { if (s.exists()) wiApplyServer(wiObjToRecords(s.val())); });
  } catch (e) { console.warn('wiInit error', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  wiRefreshLookupDropdowns();
  wiClearForm();
  wiRenderList();
  wiInit();
});

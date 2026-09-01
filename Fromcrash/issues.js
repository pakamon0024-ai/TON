// ===== ระบบบันทึกปัญหาการทำงาน =====
// เก็บ local ที่ localStorage key 'finflow_work_issues' และ sync กับ Firebase ที่ /workIssues

let workIssues = JSON.parse(localStorage.getItem('finflow_work_issues') || '[]');
let wiEditingId = null;
let wiRef = null;
let wiReady = false;
let wiCharts = {};

const WI_XLSX_HEADERS = ['เลขที่','วันที่','หัวข้อปัญหา','ชื่อพนักงาน','ทะเบียน','หน่วยงาน','ลานจอด','รายละเอียด'];

function wiSave() { localStorage.setItem('finflow_work_issues', JSON.stringify(workIssues)); }

// ===== Sub-tabs =====
function wiSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`wi-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`wi-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { wiRefreshDashFilters(); wiRenderDashboard(); }
  if (tab === 'list') wiRenderList();
  if (tab === 'add' && !wiEditingId) wiClearForm();
}

function wiOnPageShown() {
  wiRefreshLookupDropdowns();
  wiRenderList();
  if (document.getElementById('wi-subpage-dashboard')?.classList.contains('active')) {
    wiRefreshDashFilters();
    wiRenderDashboard();
  }
}

// ===== Dashboard =====
const WI_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const WI_CHART_TICK = { color: '#3d4f6d', font: WI_CHART_FONT };
const WI_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const WI_CHART_COLORS = {
  month: { bg: 'rgba(67,97,238,0.85)', border: '#4361ee' },
  topic: { bg: 'rgba(255,107,0,0.88)', border: '#ff6b00' },
  yard:  { bg: 'rgba(6,214,160,0.88)', border: '#06d6a0' },
  bu:    { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
};
const WI_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function wiDestroyChart(id) {
  if (wiCharts[id]) { wiCharts[id].destroy(); delete wiCharts[id]; }
}

function wiBarChart(canvasId, key, labels, data, maxRotation) {
  wiDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    formatter: v => v > 0 ? v : '',
  };
  wiCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนรายการ', data, backgroundColor: WI_CHART_COLORS[key].bg, borderColor: WI_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: WI_CHART_GRID, ticks: { ...WI_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...WI_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
  setChartTotal(canvasId, data);
}

function wiRefreshDashFilters() {
  wiFillSelect('wi-dash-yard', mdYards);
  wiFillSelect('wi-dash-bu', mdBusinessUnits);
}

function wiRenderDashboard() {
  const yardFilter = document.getElementById('wi-dash-yard')?.value || '';
  const buFilter = document.getElementById('wi-dash-bu')?.value || '';
  const filtered = workIssues.filter(i =>
    (!yardFilter || i.yard === yardFilter) && (!buFilter || i.businessUnit === buFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  filtered.forEach(i => {
    if (!i.date) return;
    const d = new Date(i.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  wiBarChart('wi-chart-month', 'month', WI_MONTH_LABELS_TH, monthCount);

  const countBy = field => {
    const map = {};
    filtered.forEach(i => { const v = i[field]; if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const topicSorted = countBy('topic');
  wiBarChart('wi-chart-topic', 'topic', topicSorted.map(e => e[0]), topicSorted.map(e => e[1]), 30);

  const yardSorted = countBy('yard');
  wiBarChart('wi-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), 30);

  const buSorted = countBy('businessUnit');
  wiBarChart('wi-chart-bu', 'bu', buSorted.map(e => e[0]), buSorted.map(e => e[1]), 30);
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

  let savedRecord;
  if (wiEditingId) {
    const idx = workIssues.findIndex(i => i.id === wiEditingId);
    if (idx >= 0) {
      workIssues[idx] = { ...workIssues[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = workIssues[idx];
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
    savedRecord = record;
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `⚠️ <b>บันทึกปัญหาการทำงานใหม่</b>\nเลขที่: ${record.runningNo}\nหัวข้อ: ${escapeHtml(topic)}\nพนักงาน: ${escapeHtml(record.driverName)}\nทะเบียน: ${escapeHtml(record.plate)}\nรายละเอียด: ${escapeHtml(detail)}`
      );
    }
    wiClearForm();
  }
  wiSave();
  wiPushOneIfReady(savedRecord);
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
  wiRemoveOneIfReady(id);
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
    i.runningNo, formatDMY(i.date), i.topic||'', i.driverName||'', i.plate||'', i.businessUnit||'', i.yard||'', i.detail||''
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
    ['', '15/01/2025', 'GPS', 'สมชาย ใจดี', '1กข 1234', 'Trailer', 'ABC', 'ตัวอย่างรายละเอียดปัญหาที่พบ']
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
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let added = 0;
      rows.slice(1).forEach(row => {
        if (!row[1] && !row[2]) return;
        const rec = {
          id: 'WI_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          runningNo: wiNextRunningNo(),
          date: normalizeImportDate(row[1]),
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
  reader.readAsArrayBuffer(file);
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
  if (document.getElementById('wi-subpage-dashboard')?.classList.contains('active')) wiRenderDashboard();
}
async function wiWriteFB() {
  if (!wiRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(wiRef, wiRecordsToObj(workIssues));
  } catch (e) { console.warn('wiWriteFB error', e); }
}
function wiPushIfReady() { if (wiReady) wiWriteFB(); }

async function wiWriteOne(record) {
  if (!wiRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/workIssues/${record.id}`), record);
  } catch (e) { console.warn('wiWriteOne error', e); }
}
function wiPushOneIfReady(record) { if (wiReady) wiWriteOne(record); }

async function wiRemoveOne(id) {
  if (!wiRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/workIssues/${id}`));
  } catch (e) { console.warn('wiRemoveOne error', e); }
}
function wiRemoveOneIfReady(id) { if (wiReady) wiRemoveOne(id); }

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

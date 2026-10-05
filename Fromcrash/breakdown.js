// ===== ระบบบันทึก Truck Breakdown (รถเสีย/ขัดข้องระหว่างทาง) =====
// ทำโครงสร้างเหมือน "บันทึกปัญหาการทำงาน" (issues.js) ทุกอย่าง เก็บ local ที่ localStorage
// key 'finflow_truck_breakdowns' และ sync กับ Firebase ที่ /truckBreakdowns

let truckBreakdowns = JSON.parse(localStorage.getItem('finflow_truck_breakdowns') || '[]');
let bdEditingId = null;
let bdRef = null;
let bdReady = false;
let bdCharts = {};

const BD_XLSX_HEADERS = ['เลขที่','วันที่','อาการเสีย','ชื่อพนักงาน','ทะเบียน','หน่วยงาน','ลานจอด','รายละเอียด'];

function bdSave() { safeLocalStorageSet('finflow_truck_breakdowns', JSON.stringify(truckBreakdowns)); }

// ===== Sub-tabs =====
function bdSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`bd-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`bd-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { bdRefreshDashFilters(); bdRenderDashboard(); }
  if (tab === 'list') bdRenderList();
  if (tab === 'add' && !bdEditingId) bdClearForm();
}

function bdOnPageShown() {
  bdRefreshLookupDropdowns();
  bdRenderList();
  if (document.getElementById('bd-subpage-dashboard')?.classList.contains('active')) {
    bdRefreshDashFilters();
    bdRenderDashboard();
  }
}

// ===== Dashboard =====
const BD_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const BD_CHART_TICK = { color: '#3d4f6d', font: BD_CHART_FONT };
const BD_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const BD_CHART_COLORS = {
  month: { bg: 'rgba(239,68,68,0.85)', border: '#ef4444' },
  type:  { bg: 'rgba(255,107,0,0.88)', border: '#ff6b00' },
  yard:  { bg: 'rgba(6,214,160,0.88)', border: '#06d6a0' },
  bu:    { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
};
const BD_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function bdDestroyChart(id) {
  if (bdCharts[id]) { bdCharts[id].destroy(); delete bdCharts[id]; }
}

function bdBarChart(canvasId, key, labels, data, maxRotation) {
  bdDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    formatter: v => v > 0 ? v : '',
  };
  bdCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนรายการ', data, backgroundColor: BD_CHART_COLORS[key].bg, borderColor: BD_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: BD_CHART_GRID, ticks: { ...BD_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...BD_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
  setChartTotal(canvasId, data);
}

function bdRefreshDashFilters() {
  bdFillSelect('bd-dash-yard', mdYards);
  bdFillSelect('bd-dash-bu', mdBusinessUnits);
}

function bdRenderDashboard() {
  const month = document.getElementById('bd-dash-month')?.value || '';
  const yardFilter = document.getElementById('bd-dash-yard')?.value || '';
  const buFilter = document.getElementById('bd-dash-bu')?.value || '';
  const filtered = truckBreakdowns.filter(i =>
    (!month || (i.date || '').startsWith(month)) &&
    (!yardFilter || i.yard === yardFilter) && (!buFilter || i.businessUnit === buFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  filtered.forEach(i => {
    if (!i.date) return;
    const d = new Date(i.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  bdBarChart('bd-chart-month', 'month', BD_MONTH_LABELS_TH, monthCount);

  const countBy = field => {
    const map = {};
    filtered.forEach(i => { const v = i[field]; if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const typeSorted = countBy('type');
  bdBarChart('bd-chart-type', 'type', typeSorted.map(e => e[0]), typeSorted.map(e => e[1]), 30);

  const yardSorted = countBy('yard');
  bdBarChart('bd-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), 30);

  const buSorted = countBy('businessUnit');
  bdBarChart('bd-chart-bu', 'bu', buSorted.map(e => e[0]), buSorted.map(e => e[1]), 30);
}

// ===== Lookup dropdowns =====
function bdFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function bdFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function bdRefreshLookupDropdowns() {
  bdFillDatalist('bd-type-list', mdBreakdownTypes);
  bdFillDatalist('bd-driver-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  bdFillDatalist('bd-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  bdFillDatalist('bd-bu-list', mdBusinessUnits);
  bdFillDatalist('bd-yard-list', mdYards);
  bdFillSelect('bd-f-type', mdBreakdownTypes);
  bdFillSelect('bd-f-yard', mdYards);
}

function bdLookupVehicle() {
  const plate = document.getElementById('bd-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('bd-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('bd-yard').value = veh.yard;
  }
}

function bdQuickAddType() {
  const name = (prompt('เพิ่มอาการเสียใหม่:') || '').trim();
  if (!name) return;
  if (!mdBreakdownTypes.includes(name)) {
    mdBreakdownTypes.push(name);
    if (typeof saveBreakdownTypesDB === 'function') saveBreakdownTypesDB();
    bdRefreshLookupDropdowns();
    if (typeof mdPushIfReady === 'function') mdPushIfReady();
  }
  const sel = document.getElementById('bd-type');
  if (sel) sel.value = name;
}

// ===== Running number =====
function bdNextRunningNo() {
  return truckBreakdowns.length ? Math.max(...truckBreakdowns.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function bdSaveCase() {
  const date = document.getElementById('bd-date').value;
  const type = document.getElementById('bd-type').value.trim();
  const detail = document.getElementById('bd-detail').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!type) { showToast('กรุณาเลือกอาการเสีย', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียดอาการเสีย', 'warning'); return; }

  const record = {
    date, type,
    driverName: document.getElementById('bd-driver').value,
    plate: document.getElementById('bd-plate').value,
    businessUnit: document.getElementById('bd-bu').value,
    yard: document.getElementById('bd-yard').value,
    detail,
  };

  let savedRecord;
  if (bdEditingId) {
    const idx = truckBreakdowns.findIndex(i => i.id === bdEditingId);
    if (idx >= 0) {
      truckBreakdowns[idx] = { ...truckBreakdowns[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = truckBreakdowns[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
      if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(`✏️ <b>แก้ไขบันทึก Truck Breakdown</b>\nเลขที่: ${truckBreakdowns[idx].runningNo}\nอาการเสีย: ${escapeHtml(type)}`);
      }
    }
    bdCancelEdit();
  } else {
    record.id = 'BD_' + Date.now();
    record.runningNo = bdNextRunningNo();
    record.createdAt = new Date().toISOString();
    truckBreakdowns.unshift(record);
    savedRecord = record;
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🚛 <b>บันทึก Truck Breakdown ใหม่</b>\nเลขที่: ${record.runningNo}\nอาการเสีย: ${escapeHtml(type)}\nพนักงาน: ${escapeHtml(record.driverName)}\nทะเบียน: ${escapeHtml(record.plate)}\nรายละเอียด: ${escapeHtml(detail)}`
      );
    }
    bdClearForm();
  }
  bdSave();
  bdPushOneIfReady(savedRecord);
  bdRenderList();
}

function bdClearForm() {
  bdEditingId = null;
  document.getElementById('bd-edit-banner').style.display = 'none';
  document.getElementById('bd-date').value = '';
  document.getElementById('bd-type').value = '';
  document.getElementById('bd-driver').value = '';
  document.getElementById('bd-plate').value = '';
  document.getElementById('bd-bu').value = '';
  document.getElementById('bd-yard').value = '';
  document.getElementById('bd-detail').value = '';
}

function bdEditCase(id) {
  const rec = truckBreakdowns.find(i => i.id === id);
  if (!rec) return;
  bdEditingId = id;
  document.getElementById('bd-edit-banner').style.display = 'flex';
  document.getElementById('bd-edit-no').textContent = rec.runningNo;
  document.getElementById('bd-date').value = rec.date || '';
  document.getElementById('bd-type').value = rec.type || '';
  document.getElementById('bd-driver').value = rec.driverName || '';
  document.getElementById('bd-plate').value = rec.plate || '';
  document.getElementById('bd-bu').value = rec.businessUnit || '';
  document.getElementById('bd-yard').value = rec.yard || '';
  document.getElementById('bd-detail').value = rec.detail || '';
  bdSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function bdCancelEdit() { bdClearForm(); }

function bdDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  truckBreakdowns = truckBreakdowns.filter(i => i.id !== id);
  bdSave();
  bdRemoveOneIfReady(id);
  bdRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function bdFilteredList() {
  const type = document.getElementById('bd-f-type')?.value || '';
  const yard = document.getElementById('bd-f-yard')?.value || '';
  const search = (document.getElementById('bd-f-search')?.value || '').toLowerCase().trim();
  return truckBreakdowns.filter(i => {
    if (type && i.type !== type) return false;
    if (yard && i.yard !== yard) return false;
    if (search && !(`${i.type} ${i.driverName} ${i.plate} ${i.businessUnit} ${i.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function bdClearListFilters() {
  ['bd-f-type', 'bd-f-yard', 'bd-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  bdRenderList();
}

function bdRenderList() {
  const list = bdFilteredList();
  const tbody = document.getElementById('bd-list-body');
  const countEl = document.getElementById('bd-list-count');
  const pagerEl = document.getElementById('bd-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('bd-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('bd-list', page, totalPages, total, 'bdRenderList');
  tbody.innerHTML = pageItems.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.type)}</td>
      <td>${escapeHtml(i.driverName || '-')}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>
        <button class="action-btn action-view" onclick="bdEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="bdDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Export / Import / Template =====
function bdExportExcel() {
  if (!truckBreakdowns.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [BD_XLSX_HEADERS, ...truckBreakdowns.map(i => [
    i.runningNo, formatDMY(i.date), i.type||'', i.driverName||'', i.plate||'', i.businessUnit||'', i.yard||'', i.detail||''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [8, 14, 20, 18, 14, 18, 14, 36].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Truck Breakdown');
  XLSX.writeFile(wb, 'TruckBreakdown_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function bdDownloadTemplate() {
  const sample = [
    BD_XLSX_HEADERS,
    ['', '15/01/2025', 'ยางแตก', 'สมชาย ใจดี', '1กข 1234', 'Trailer', 'ABC', 'ตัวอย่างรายละเอียดอาการเสียที่พบ']
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = [8, 14, 20, 18, 14, 18, 14, 36].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_TruckBreakdown.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function bdImportExcel(evt) {
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
          id: 'BD_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          runningNo: bdNextRunningNo(),
          date: normalizeImportDate(row[1]),
          type: String(row[2] || '').trim(),
          driverName: String(row[3] || '').trim(),
          plate: String(row[4] || '').trim(),
          businessUnit: String(row[5] || '').trim(),
          yard: String(row[6] || '').trim(),
          detail: String(row[7] || '').trim(),
          createdAt: new Date().toISOString(),
        };
        truckBreakdowns.push(rec);
        added++;
      });
      bdSave(); bdPushIfReady(); bdRenderList();
      showToast(`นำเข้า ${added} รายการ`, 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function bdRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function bdObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function bdApplyServer(serverBreakdowns) {
  truckBreakdowns = serverBreakdowns;
  bdSave();
  bdRenderList();
  if (document.getElementById('bd-subpage-dashboard')?.classList.contains('active')) bdRenderDashboard();
}
async function bdWriteFB() {
  if (!bdRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(bdRef, bdRecordsToObj(truckBreakdowns));
  } catch (e) { console.warn('bdWriteFB error', e); notifySyncWriteError(e.message); }
}
function bdPushIfReady() { if (bdReady) bdWriteFB(); }

async function bdWriteOne(record) {
  if (!bdRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/truckBreakdowns/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('bdWriteOne error', e); notifySyncWriteError(e.message); }
}
function bdPushOneIfReady(record) { if (bdReady) bdWriteOne(record); }

async function bdRemoveOne(id) {
  if (!bdRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/truckBreakdowns/${id}`));
  } catch (e) { console.warn('bdRemoveOne error', e); notifySyncWriteError(e.message); }
}
function bdRemoveOneIfReady(id) { if (bdReady) bdRemoveOne(id); }

function bdWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function bdInit() {
  await bdWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    bdRef = ref(fbDb, '/truckBreakdowns');
    const snap = await get(bdRef);
    if (snap.exists()) bdApplyServer(bdObjToRecords(snap.val()));
    bdReady = true;
    if (!snap.exists() && truckBreakdowns.length > 0) await bdWriteFB();
    onValue(bdRef, s => { if (s.exists()) bdApplyServer(bdObjToRecords(s.val())); });
  } catch (e) { console.warn('bdInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  bdRefreshLookupDropdowns();
  bdClearForm();
  bdRenderList();
  bdInit();
});

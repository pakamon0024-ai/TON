// ===== ระบบรายงานเรทเชื้อเพลิง (จำนวนเงินเรทเชื้อเพลิงต่อพนักงาน/รถ) =====
// เก็บ local ที่ localStorage key 'finflow_fuel_rate' และ sync กับ Firebase ที่ /fuelRate
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)

let frRecords = JSON.parse(localStorage.getItem('finflow_fuel_rate') || '[]');
let frEditingId = null;
let frRef = null;
let frReady = false;
let frCharts = {};

const FR_XLSX_HEADERS = ['ลำดับที่', 'วันที่', 'ชื่อพนักงาน', 'ทะเบียนรถ', 'หน่วยงาน', 'ลานจอด', 'เรทเชื้อเพลิง (บาท)'];

function frSave() { localStorage.setItem('finflow_fuel_rate', JSON.stringify(frRecords)); }

function frNextRunningNo() {
  return frRecords.length ? Math.max(...frRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

// ===== Sub-tabs =====
function frSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`fr-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`fr-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { frRefreshDashFilters(); frRenderDashboard(); }
  if (tab === 'list') frRenderList();
  if (tab === 'add' && !frEditingId) frClearForm();
}

function frOnPageShown() {
  frRefreshLookupDropdowns();
  frRenderList();
  if (document.getElementById('fr-subpage-dashboard')?.classList.contains('active')) {
    frRefreshDashFilters();
    frRenderDashboard();
  }
}

// ===== Dashboard =====
const FR_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const FR_CHART_TICK = { color: '#3d4f6d', font: FR_CHART_FONT };
const FR_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const FR_CHART_COLORS = {
  month:  { bg: 'rgba(67,97,238,0.85)',  border: '#4361ee' },
  driver: { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
  yard:   { bg: 'rgba(255,209,102,0.9)', border: '#e0a800' },
  bu:     { bg: 'rgba(6,214,160,0.88)',  border: '#06d6a0' },
};
const FR_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function frDestroyChart(id) {
  if (frCharts[id]) { frCharts[id].destroy(); delete frCharts[id]; }
}

function frBarChart(canvasId, key, labels, data, maxRotation) {
  frDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    formatter: v => v > 0 ? formatMoney(v) : '',
  };
  frCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'เรทเชื้อเพลิง (บาท)', data, backgroundColor: FR_CHART_COLORS[key].bg, borderColor: FR_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: FR_CHART_GRID, ticks: { ...FR_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...FR_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
}

function frDashFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">ทั้งหมด</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function frRefreshDashFilters() {
  frDashFillSelect('fr-dash-yard', mdYards);
}

function frRenderDashboard() {
  const yardFilter = document.getElementById('fr-dash-yard')?.value || '';
  const filtered = yardFilter ? frRecords.filter(r => r.yard === yardFilter) : frRecords;

  const curYear = new Date().getFullYear();
  const monthSum = new Array(12).fill(0);
  filtered.forEach(r => {
    if (!r.date) return;
    const d = new Date(r.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthSum[d.getMonth()] += r.amount || 0;
  });
  frBarChart('fr-chart-month', 'month', FR_MONTH_LABELS_TH, monthSum);

  const sumBy = field => {
    const map = {};
    filtered.forEach(r => { const v = r[field]; if (v) map[v] = (map[v] || 0) + (r.amount || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  // เรทเชื้อเพลิงตามพนักงาน — จัด Top 10 เท่านั้น (กันกราฟรก ถ้ามีพนักงานเยอะ)
  const driverSorted = sumBy('driverName').slice(0, 10);
  frBarChart('fr-chart-driver', 'driver', driverSorted.map(e => e[0]), driverSorted.map(e => e[1]), 30);

  const yardSorted = sumBy('yard');
  frBarChart('fr-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), 30);

  const buSorted = sumBy('businessUnit');
  frBarChart('fr-chart-bu', 'bu', buSorted.map(e => e[0]), buSorted.map(e => e[1]), 30);
}

// ===== Lookup dropdowns =====
function frFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function frRefreshLookupDropdowns() {
  frFillDatalist('fr-driver-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  frFillDatalist('fr-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  frFillDatalist('fr-bu-list', mdBusinessUnits);
  frFillDatalist('fr-yard-list', mdYards);
}

function frLookupVehicle() {
  const plate = document.getElementById('fr-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('fr-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('fr-yard').value = veh.yard;
  }
}

// ===== Save / Edit / Delete =====
function frSaveRecord() {
  const date = document.getElementById('fr-date').value;
  const driverName = document.getElementById('fr-driver').value.trim();
  const plate = document.getElementById('fr-plate').value.trim();
  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!driverName) { showToast('กรุณาระบุชื่อพนักงาน', 'warning'); return; }
  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }

  const record = {
    date, driverName, plate,
    businessUnit: document.getElementById('fr-bu').value.trim(),
    yard: document.getElementById('fr-yard').value.trim(),
    amount: parseFloat(document.getElementById('fr-amount').value) || 0,
  };

  if (frEditingId) {
    const idx = frRecords.findIndex(r => r.id === frEditingId);
    if (idx >= 0) {
      frRecords[idx] = { ...frRecords[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    frCancelEdit();
  } else {
    frRecords.unshift({
      id: 'FR_' + Date.now(),
      runningNo: frNextRunningNo(),
      ...record,
      createdAt: new Date().toISOString(),
    });
    showToast('บันทึกข้อมูลแล้ว', 'success');
    frClearForm();
  }
  frSave();
  frPushIfReady();
  frRenderList();
}

function frClearForm() {
  frEditingId = null;
  const banner = document.getElementById('fr-edit-banner');
  if (banner) banner.style.display = 'none';
  ['fr-date', 'fr-driver', 'fr-plate', 'fr-bu', 'fr-yard', 'fr-amount']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function frEditRecord(id) {
  const rec = frRecords.find(r => r.id === id);
  if (!rec) return;
  frEditingId = id;
  document.getElementById('fr-edit-banner').style.display = 'flex';
  document.getElementById('fr-edit-no').textContent = rec.runningNo;
  document.getElementById('fr-date').value = rec.date || '';
  document.getElementById('fr-driver').value = rec.driverName || '';
  document.getElementById('fr-plate').value = rec.plate || '';
  document.getElementById('fr-bu').value = rec.businessUnit || '';
  document.getElementById('fr-yard').value = rec.yard || '';
  document.getElementById('fr-amount').value = rec.amount || '';
  frSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function frCancelEdit() { frClearForm(); }

function frDeleteRecord(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  frRecords = frRecords.filter(r => r.id !== id);
  frSave();
  frPushIfReady();
  frRenderList();
  showToast('ลบแล้ว', 'warning');
}

function frDeleteAllRecords() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบรายงานเรทเชื้อเพลิงทั้งหมด ${frRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  frRecords = [];
  frSave();
  frPushIfReady();
  frRenderList();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== List / Filter =====
function frFilteredList() {
  const search = (document.getElementById('fr-f-search')?.value || '').toLowerCase().trim();
  const list = search
    ? frRecords.filter(r => `${r.driverName} ${r.plate} ${r.businessUnit} ${r.yard}`.toLowerCase().includes(search))
    : frRecords;
  return [...list].sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function frClearListFilters() {
  const el = document.getElementById('fr-f-search');
  if (el) el.value = '';
  frRenderList();
}

function frRenderList() {
  const list = frFilteredList();
  const tbody = document.getElementById('fr-list-body');
  const countEl = document.getElementById('fr-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td>${formatDate(r.date)}</td>
      <td>${escapeHtml(r.driverName || '-')}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${formatMoney(r.amount || 0)}</td>
      <td>
        <button class="action-btn action-view" onclick="frEditRecord('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="frDeleteRecord('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Template / Export / Import (นำเข้าซ้ำ = แก้ไข จับคู่ด้วย "ลำดับที่") =====
function frDownloadTemplate() {
  const sample = [
    FR_XLSX_HEADERS,
    ['', '15/01/2026', 'นายสมชาย ใจดี', '70-1234', 'Trailer', 'ABC', '2500'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_รายงานเรทเชื้อเพลิง.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function frExportExcel() {
  if (!frRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [FR_XLSX_HEADERS, ...frRecords.map(r => [
    r.runningNo, formatDMY(r.date), r.driverName || '', r.plate || '', r.businessUnit || '', r.yard || '', r.amount || 0,
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'เรทเชื้อเพลิง');
  XLSX.writeFile(wb, 'รายงานเรทเชื้อเพลิง_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function frImportExcel(evt) {
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
        const driverName = String(row[2] || '').trim();
        const plate = String(row[3] || '').trim();
        if (!driverName && !plate) return;
        const data = {
          date: normalizeImportDate(row[1]),
          driverName,
          plate,
          businessUnit: String(row[4] || '').trim(),
          yard: String(row[5] || '').trim(),
          amount: parseFloat(row[6]) || 0,
        };
        // จับคู่ด้วย "ลำดับที่" (คอลัมน์แรก) — ถ้ามีเลขนี้อยู่แล้วให้แก้ไขรายการเดิมแทนการเพิ่มซ้ำ
        const rowNo = parseInt(row[0]);
        const existingIdx = rowNo ? frRecords.findIndex(r => r.runningNo === rowNo) : -1;
        if (existingIdx >= 0) {
          frRecords[existingIdx] = { ...frRecords[existingIdx], ...data, updatedAt: now };
          updated++;
        } else {
          frRecords.push({
            id: 'FR_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            runningNo: frNextRunningNo(),
            ...data,
            createdAt: now,
          });
          added++;
        }
      });
      frSave(); frPushIfReady(); frRenderList();
      const msg = [updated ? `แก้ไข ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function frRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function frObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function frApplyServer(serverRecords) {
  frRecords = serverRecords;
  frSave();
  frRenderList();
}
async function frWriteFB() {
  if (!frRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(frRef, frRecordsToObj(frRecords));
  } catch (e) { console.warn('frWriteFB error', e); }
}
function frPushIfReady() { if (frReady) frWriteFB(); }

function frWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function frInit() {
  await frWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    frRef = ref(fbDb, '/fuelRate');
    const snap = await get(frRef);
    if (snap.exists()) frApplyServer(frObjToRecords(snap.val()));
    frReady = true;
    if (!snap.exists() && frRecords.length > 0) await frWriteFB();
    onValue(frRef, s => { if (s.exists()) frApplyServer(frObjToRecords(s.val())); });
  } catch (e) { console.warn('frInit error', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  frRefreshLookupDropdowns();
  frClearForm();
  frRenderList();
  frInit();
});

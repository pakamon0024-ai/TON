// ===== ระบบรายงานความผิด GPS (ความเร็วเกิน / จอดรถติดเครื่องนาน / อื่นๆ) =====
// เก็บ local ที่ localStorage key 'finflow_gps_violations' และ sync กับ Firebase ที่ /gpsViolations
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)

let gvRecords = JSON.parse(localStorage.getItem('finflow_gps_violations') || '[]');
let gvEditingId = null;
let gvRef = null;
let gvReady = false;
let gvCharts = {};

const GV_TYPE_PRESETS = ['ความเร็วเกิน', 'จอดรถติดเครื่องนาน'];
const GV_XLSX_HEADERS = ['ลำดับที่', 'วันที่', 'เวลา', 'ประเภทความผิด', 'ทะเบียนรถ', 'ชื่อพนักงานขับรถ', 'หน่วยงาน', 'ลานจอด', 'รายละเอียด', 'หมายเหตุ'];

function gvSave() { localStorage.setItem('finflow_gps_violations', JSON.stringify(gvRecords)); }

function gvNextRunningNo() {
  return gvRecords.length ? Math.max(...gvRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

// ===== Sub-tabs =====
function gvSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`gv-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`gv-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { gvRefreshDashFilters(); gvRenderDashboard(); }
  if (tab === 'list') gvRenderList();
  if (tab === 'add' && !gvEditingId) gvClearForm();
}

// ===== Dashboard (เลือกดูแยกตามประเภทความผิดผ่าน dropdown) =====
const GV_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const GV_CHART_TICK = { color: '#3d4f6d', font: GV_CHART_FONT };
const GV_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const GV_CHART_COLORS = {
  month: { bg: 'rgba(244,63,94,0.85)', border: '#f43f5e' },
  plate: { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
  yard:  { bg: 'rgba(255,209,102,0.9)', border: '#e0a800' },
  bu:    { bg: 'rgba(6,214,160,0.88)', border: '#06d6a0' },
};
const GV_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function gvDestroyChart(id) {
  if (gvCharts[id]) { gvCharts[id].destroy(); delete gvCharts[id]; }
}

function gvBarChart(canvasId, key, labels, data, maxRotation) {
  gvDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    formatter: v => v > 0 ? v : '',
  };
  gvCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนครั้ง', data, backgroundColor: GV_CHART_COLORS[key].bg, borderColor: GV_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: GV_CHART_GRID, ticks: { ...GV_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...GV_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
  setChartTotal(canvasId, data);
}

function gvDashFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">ทั้งหมด</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

// ช่องประเภทความผิดในฟอร์มเพิ่มบันทึกเป็นข้อความอิสระ (พิมพ์เองได้ ไม่ได้บังคับแค่ 2 ตัวเลือกที่ตั้งไว้)
// เดิม dropdown แดชบอร์ดมีแค่ 2 ตัวเลือกตายตัว — ถ้าใครพิมพ์ประเภทอื่นที่ไม่ตรงเป๊ะ รายการนั้นจะไม่โผล่ในแดชบอร์ดเลย
// แก้โดยเพิ่ม "ทั้งหมด" เป็นตัวเลือกแรก และเติมประเภทอื่นๆ ที่มีอยู่จริงในข้อมูล (นอกเหนือจาก 2 ตัวหลัก) ต่อท้ายให้เลือกได้ด้วย
function gvRefreshDashFilters() {
  const typeSelect = document.getElementById('gv-dash-type');
  if (typeSelect) {
    const current = typeSelect.value;
    const extraTypes = [...new Set(gvRecords.map(r => r.type).filter(Boolean))]
      .filter(t => !GV_TYPE_PRESETS.includes(t));
    const extraHtml = extraTypes.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    const baseHtml = '<option value="">ทั้งหมด</option>' +
      GV_TYPE_PRESETS.map(t => `<option value="${escapeHtml(t)}">${t === 'จอดรถติดเครื่องนาน' ? 'จอดรถไม่ดับเครื่องนานเกิน' : escapeHtml(t)}</option>`).join('');
    typeSelect.innerHTML = baseHtml + extraHtml;
    if ([...typeSelect.options].some(o => o.value === current)) typeSelect.value = current;
  }
  gvDashFillSelect('gv-dash-yard', mdYards);
  gvDashFillSelect('gv-dash-bu', mdBusinessUnits);
}

function gvRenderDashboard() {
  const type = document.getElementById('gv-dash-type').value;
  const yardFilter = document.getElementById('gv-dash-yard')?.value || '';
  const buFilter = document.getElementById('gv-dash-bu')?.value || '';
  const list = gvRecords.filter(r =>
    (!type || r.type === type) && (!yardFilter || r.yard === yardFilter) && (!buFilter || r.businessUnit === buFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  list.forEach(r => {
    if (!r.date) return;
    const d = new Date(r.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  gvBarChart('gv-chart-month', 'month', GV_MONTH_LABELS_TH, monthCount);

  const countBy = field => {
    const map = {};
    list.forEach(r => { const v = r[field]; if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  // จำนวนครั้งตามทะเบียนรถ — จัด Top 10 เท่านั้น (กันกราฟรกเวลามีทะเบียนรถเยอะ)
  const plateSorted = countBy('plate').slice(0, 10);
  gvBarChart('gv-chart-plate', 'plate', plateSorted.map(e => e[0]), plateSorted.map(e => e[1]), 30);

  const yardSorted = countBy('yard');
  gvBarChart('gv-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), 30);

  const buSorted = countBy('businessUnit');
  gvBarChart('gv-chart-bu', 'bu', buSorted.map(e => e[0]), buSorted.map(e => e[1]), 30);

  const countEl = document.getElementById('gv-dash-count');
  if (countEl) countEl.textContent = `พบทั้งหมด ${list.length} ครั้ง`;
}

function gvOnPageShown() {
  gvRefreshLookupDropdowns();
  if (document.getElementById('gv-subpage-dashboard')?.classList.contains('active')) {
    gvRefreshDashFilters();
    gvRenderDashboard();
  }
  gvRenderList();
}

// ===== Lookup dropdowns =====
function gvFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function gvRefreshLookupDropdowns() {
  gvFillDatalist('gv-type-list', GV_TYPE_PRESETS);
  gvFillDatalist('gv-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  gvFillDatalist('gv-driver-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  gvFillDatalist('gv-bu-list', mdBusinessUnits);
  gvFillDatalist('gv-yard-list', mdYards);
}

function gvLookupVehicle() {
  const plate = document.getElementById('gv-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('gv-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('gv-yard').value = veh.yard;
  }
}

// ===== Save / Edit / Delete =====
function gvSaveRecord() {
  const date = document.getElementById('gv-date').value;
  const type = document.getElementById('gv-type').value.trim();
  const plate = document.getElementById('gv-plate').value.trim();
  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!type) { showToast('กรุณาระบุประเภทความผิด', 'warning'); return; }
  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }

  const record = {
    date,
    time: document.getElementById('gv-time').value,
    type,
    plate,
    driverName: document.getElementById('gv-driver').value.trim(),
    businessUnit: document.getElementById('gv-bu').value.trim(),
    yard: document.getElementById('gv-yard').value.trim(),
    detail: document.getElementById('gv-detail').value.trim(),
    note: document.getElementById('gv-note').value.trim(),
  };

  let savedRecord;
  if (gvEditingId) {
    const idx = gvRecords.findIndex(r => r.id === gvEditingId);
    if (idx >= 0) {
      gvRecords[idx] = { ...gvRecords[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = gvRecords[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    gvCancelEdit();
  } else {
    savedRecord = {
      id: 'GV_' + Date.now(),
      runningNo: gvNextRunningNo(),
      ...record,
      createdAt: new Date().toISOString(),
    };
    gvRecords.unshift(savedRecord);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🚨 <b>รายงานความผิด GPS</b>\nประเภท: ${escapeHtml(type)}\nทะเบียน: ${escapeHtml(plate)}\nพนักงาน: ${escapeHtml(record.driverName)}`
      );
    }
    gvClearForm();
  }
  gvSave();
  gvPushOneIfReady(savedRecord);
  gvRenderList();
}

function gvClearForm() {
  gvEditingId = null;
  const banner = document.getElementById('gv-edit-banner');
  if (banner) banner.style.display = 'none';
  document.getElementById('gv-date').value = '';
  tmSetTimeValue('gv-time', '');
  ['gv-type', 'gv-plate', 'gv-driver', 'gv-bu', 'gv-yard', 'gv-detail', 'gv-note']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function gvEditRecord(id) {
  const rec = gvRecords.find(r => r.id === id);
  if (!rec) return;
  gvEditingId = id;
  document.getElementById('gv-edit-banner').style.display = 'flex';
  document.getElementById('gv-edit-no').textContent = rec.runningNo;
  document.getElementById('gv-date').value = rec.date || '';
  tmSetTimeValue('gv-time', rec.time || '');
  document.getElementById('gv-type').value = rec.type || '';
  document.getElementById('gv-plate').value = rec.plate || '';
  document.getElementById('gv-driver').value = rec.driverName || '';
  document.getElementById('gv-bu').value = rec.businessUnit || '';
  document.getElementById('gv-yard').value = rec.yard || '';
  document.getElementById('gv-detail').value = rec.detail || '';
  document.getElementById('gv-note').value = rec.note || '';
  gvSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function gvCancelEdit() { gvClearForm(); }

function gvDeleteRecord(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  gvRecords = gvRecords.filter(r => r.id !== id);
  gvSave();
  gvRemoveOneIfReady(id);
  gvRenderList();
  showToast('ลบแล้ว', 'warning');
}

function gvDeleteAllRecords() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบรายงานความผิด GPS ทั้งหมด ${gvRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  gvRecords = [];
  gvSave();
  gvPushIfReady();
  gvRenderList();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== List / Filter =====
function gvFilteredList() {
  const type = document.getElementById('gv-f-type')?.value || '';
  const search = (document.getElementById('gv-f-search')?.value || '').toLowerCase().trim();
  const filtered = gvRecords.filter(r => {
    if (type && r.type !== type) return false;
    if (search && !(`${r.plate} ${r.driverName} ${r.businessUnit} ${r.yard} ${r.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
  return filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function gvClearListFilters() {
  ['gv-f-type', 'gv-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  gvRenderList();
}

function gvRenderList() {
  const list = gvFilteredList();
  const tbody = document.getElementById('gv-list-body');
  const countEl = document.getElementById('gv-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td>${formatDate(r.date)}</td>
      <td>${r.time || '-'}</td>
      <td>${escapeHtml(r.type || '-')}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate || '-')}</td>
      <td>${escapeHtml(r.driverName || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.detail || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="gvEditRecord('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="gvDeleteRecord('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Template / Export / Import (นำเข้าซ้ำ = แก้ไข จับคู่ด้วย "ลำดับที่") =====
function gvDownloadTemplate() {
  const sample = [
    GV_XLSX_HEADERS,
    ['', '15/01/2026', '09:30', 'ความเร็วเกิน', '70-1234', 'นายสมชาย ใจดี', 'Trailer', 'ABC', 'ขับ 95 กม./ชม. ในเขตจำกัด 80', ''],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_รายงานความผิดGPS.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function gvExportExcel() {
  if (!gvRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [GV_XLSX_HEADERS, ...gvRecords.map(r => [
    r.runningNo, formatDMY(r.date), r.time || '', r.type || '', r.plate || '', r.driverName || '', r.businessUnit || '', r.yard || '', r.detail || '', r.note || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ความผิด GPS');
  XLSX.writeFile(wb, 'รายงานความผิดGPS_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function gvImportExcel(evt) {
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
        const plate = String(row[4] || '').trim();
        if (!plate) return;
        const data = {
          date: normalizeImportDate(row[1]),
          time: String(row[2] || '').trim(),
          type: String(row[3] || '').trim(),
          plate,
          driverName: String(row[5] || '').trim(),
          businessUnit: String(row[6] || '').trim(),
          yard: String(row[7] || '').trim(),
          detail: String(row[8] || '').trim(),
          note: String(row[9] || '').trim(),
        };
        // จับคู่ด้วย "ลำดับที่" (คอลัมน์แรก) — ถ้ามีเลขนี้อยู่แล้วให้แก้ไขรายการเดิมแทนการเพิ่มซ้ำ
        const rowNo = parseInt(row[0]);
        const existingIdx = rowNo ? gvRecords.findIndex(r => r.runningNo === rowNo) : -1;
        if (existingIdx >= 0) {
          gvRecords[existingIdx] = { ...gvRecords[existingIdx], ...data, updatedAt: now };
          updated++;
        } else {
          gvRecords.push({
            id: 'GV_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            runningNo: gvNextRunningNo(),
            ...data,
            createdAt: now,
          });
          added++;
        }
      });
      gvSave(); gvPushIfReady(); gvRenderList();
      const msg = [updated ? `แก้ไข ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function gvRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function gvObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function gvApplyServer(serverRecords) {
  gvRecords = serverRecords;
  gvSave();
  gvRenderList();
  if (document.getElementById('gv-subpage-dashboard')?.classList.contains('active')) gvRenderDashboard();
}
async function gvWriteFB() {
  if (!gvRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(gvRef, gvRecordsToObj(gvRecords));
  } catch (e) { console.warn('gvWriteFB error', e); }
}
function gvPushIfReady() { if (gvReady) gvWriteFB(); }

async function gvWriteOne(record) {
  if (!gvRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/gpsViolations/${record.id}`), record);
  } catch (e) { console.warn('gvWriteOne error', e); }
}
function gvPushOneIfReady(record) { if (gvReady) gvWriteOne(record); }

async function gvRemoveOne(id) {
  if (!gvRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/gpsViolations/${id}`));
  } catch (e) { console.warn('gvRemoveOne error', e); }
}
function gvRemoveOneIfReady(id) { if (gvReady) gvRemoveOne(id); }

function gvWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function gvInit() {
  await gvWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    gvRef = ref(fbDb, '/gpsViolations');
    const snap = await get(gvRef);
    if (snap.exists()) gvApplyServer(gvObjToRecords(snap.val()));
    gvReady = true;
    if (!snap.exists() && gvRecords.length > 0) await gvWriteFB();
    onValue(gvRef, s => { if (s.exists()) gvApplyServer(gvObjToRecords(s.val())); });
  } catch (e) { console.warn('gvInit error', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  gvRefreshLookupDropdowns();
  gvClearForm();
  gvRenderList();
  gvInit();
});

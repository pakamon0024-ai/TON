// ===== ระบบบันทึกอุบัติเหตุ/ความเสียหายประจำปี =====
// เก็บ local ที่ localStorage key 'finflow_incidents' และ sync กับ Firebase ที่ /incidents
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)

let incidents = JSON.parse(localStorage.getItem('finflow_incidents') || '[]');
let incEditingId = null;
let incCharts = {};
let incReportCharts = {};
let incRef = null;
let incReady = false;

const INC_CHART_COLORS = {
  month:   { bg: 'rgba(67,97,238,0.85)',   border: '#4361ee' },
  yard:    { bg: 'rgba(6,214,160,0.88)',   border: '#06d6a0' },
  pattern: { bg: 'rgba(255,107,0,0.88)',   border: '#ff6b00' },
  bu:      { bg: 'rgba(155,93,229,0.85)',  border: '#9b5de5' },
  area:    { bg: 'rgba(239,35,60,0.85)',   border: '#ef233c' },
};
const INC_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const INC_CHART_TICK = { color: '#3d4f6d', font: INC_CHART_FONT };
const INC_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const INC_DL_OPTS = { display: true, anchor: 'end', align: 'end', color: '#1a2540', font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' }, formatter: v => v > 0 ? v : '' };

const MONTH_LABELS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const DOW_LABELS_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

function incSave() { localStorage.setItem('finflow_incidents', JSON.stringify(incidents)); }

// ===== Sub-tabs =====
function incSwitchTab(tab) {
  ['dashboard','list','add'].forEach(t => {
    document.getElementById(`inc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`inc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') incRenderDashboard();
  if (tab === 'list') incRenderList();
  if (tab === 'add' && !incEditingId) incClearForm();
}

// เรียกจาก showPage('incidents') ของ app.js — บังคับ redraw กราฟให้ถูกขนาด
// (Chart.js วาดผิดถ้า container ยังซ่อนอยู่ตอนสร้าง canvas)
function incOnPageShown() {
  incRenderDashboard();
}

// ===== Auto-calc helpers =====
function incAgeYears(dateStr) {
  if (!dateStr) return '-';
  const from = new Date(dateStr);
  if (isNaN(from)) return '-';
  const now = new Date();
  let y = now.getFullYear() - from.getFullYear();
  const m = now.getMonth() - from.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < from.getDate())) y--;
  return y + ' ปี';
}

function incUpdateAutoDate() {
  const val = document.getElementById('inc-date').value;
  const dowEl = document.getElementById('inc-day-of-week');
  const monEl = document.getElementById('inc-month-label');
  if (!val) { dowEl.value = ''; monEl.value = ''; return; }
  const d = new Date(val);
  dowEl.value = DOW_LABELS_TH[d.getDay()];
  monEl.value = MONTH_LABELS_TH[d.getMonth()] + ' ' + (d.getFullYear());
}

function incCalcRepairDays() {
  const inDate = document.getElementById('inc-repair-in').value;
  const outDate = document.getElementById('inc-repair-out').value;
  const el = document.getElementById('inc-repair-days');
  if (!inDate || !outDate) { el.value = ''; return; }
  const diff = Math.round((new Date(outDate) - new Date(inDate)) / 86400000);
  el.value = diff >= 0 ? diff + ' วัน' : '-';
}

function incCalcTotal() {
  let total = 0;
  document.querySelectorAll('.inc-cost').forEach(el => { total += parseFloat(el.value) || 0; });
  document.getElementById('inc-total-display').textContent = formatMoney(total);
  return total;
}

// ===== Lookup: พนักงาน =====
function incLookupEmployee() {
  const name = document.getElementById('inc-employee-name').value.trim();
  const emp = mdDrivers.find(d => d.name === name);
  if (!emp) {
    document.getElementById('inc-employee-age').value = '';
    document.getElementById('inc-employee-tenure').value = '';
    return;
  }
  document.getElementById('inc-employee-age').value = incAgeYears(emp.birthDate);
  document.getElementById('inc-employee-tenure').value = typeof formatDuration === 'function' ? formatDuration(emp.startDate) : '-';
}

// ===== Lookup: รถ (ดึงมาแค่ "เจ้าของรถ" — หน่วยงาน/ลานจอด/ประกัน เลือกเองต่อเคส) =====
function incLookupVehicle() {
  const plate = document.getElementById('inc-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('inc-owner').value = veh?.owner || '';
}

// ===== เติมตัวเลือกใน dropdown หน่วยงาน/ประกัน/ลานจอด/ลักษณะการเกิดเหตุ จากฐานข้อมูลหลัก =====
function incFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function incRefreshLookupDropdowns() {
  incFillSelect('inc-bu', mdBusinessUnits);
  incFillSelect('inc-yard-auto', mdYards);
  incFillSelect('inc-insurance-auto', mdInsurers);
  incFillSelect('inc-pattern', mdIncidentPatterns);
  incFillSelect('inc-f-bu', mdBusinessUnits);
  incFillSelect('inc-f-yard', mdYards);
  incFillSelect('inc-lf-yard', mdYards);
}

// ===== Save / Clear / Edit =====
function incNextRunningNo() {
  return incidents.length ? Math.max(...incidents.map(i => i.runningNo || 0)) + 1 : 1;
}

function incSaveCase() {
  const incidentDate = document.getElementById('inc-date').value;
  const employeeName = document.getElementById('inc-employee-name').value.trim();
  const plate = document.getElementById('inc-plate').value.trim();
  if (!incidentDate) { showToast('กรุณาระบุวันที่เกิดเหตุ', 'error'); return; }
  if (!employeeName) { showToast('กรุณาระบุชื่อพนักงาน', 'error'); return; }
  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'error'); return; }

  const emp = mdDrivers.find(d => d.name === employeeName);
  const veh = mdVehicles.find(v => v.plate === plate);
  const d = new Date(incidentDate);

  const record = {
    tmsStatus: document.getElementById('inc-tms-status').value,
    damageType: document.getElementById('inc-damage-type').value,
    incidentDate,
    incidentTime: document.getElementById('inc-time').value,
    dayOfWeek: DOW_LABELS_TH[d.getDay()],
    monthLabel: MONTH_LABELS_TH[d.getMonth()] + ' ' + (d.getFullYear()),
    employeeName,
    employeeBirthDate: emp?.birthDate || '',
    employeeStartDate: emp?.startDate || '',
    plate,
    owner: veh?.owner || '',
    businessUnit: document.getElementById('inc-bu').value || veh?.businessUnit || '',
    yard: document.getElementById('inc-yard-auto').value || veh?.yard || '',
    insuranceCompany: document.getElementById('inc-insurance-auto').value || veh?.insuranceCompany || '',
    location: document.getElementById('inc-location').value.trim(),
    description: document.getElementById('inc-description').value.trim(),
    faultStatus: document.getElementById('inc-fault').value,
    area: document.getElementById('inc-area').value,
    incidentPattern: document.getElementById('inc-pattern').value,
    severity: document.getElementById('inc-severity').value,
    repairShop: document.getElementById('inc-repair-shop').value.trim(),
    repairInDate: document.getElementById('inc-repair-in').value,
    repairOutDate: document.getElementById('inc-repair-out').value,
    score: document.getElementById('inc-score').value,
    claimNo: document.getElementById('inc-claim-no').value.trim(),
    zone: document.getElementById('inc-zone').value.trim(),
    companyDamageCost: parseFloat(document.getElementById('inc-company-damage-cost').value) || 0,
    companyPaid: parseFloat(document.getElementById('inc-company-paid').value) || 0,
    towingCost: parseFloat(document.getElementById('inc-towing-cost').value) || 0,
    chargedToCustomer: parseFloat(document.getElementById('inc-charged-customer').value) || 0,
    chargedToEmployee: parseFloat(document.getElementById('inc-charged-employee').value) || 0,
    remarkCost: document.getElementById('inc-remark-cost').value.trim(),
    advanceAmount: parseFloat(document.getElementById('inc-advance-amount').value) || 0,
    insurancePaid: parseFloat(document.getElementById('inc-insurance-paid').value) || 0,
    insuranceReportedAmount: parseFloat(document.getElementById('inc-insurance-reported').value) || 0,
    insuranceClaimStatus: document.getElementById('inc-insurance-claim-status').value.trim(),
    injuryStatus: document.getElementById('inc-injury-status').value.trim(),
    otherPartyName: document.getElementById('inc-other-name').value.trim(),
    otherPartyPhone: document.getElementById('inc-other-phone').value.trim(),
    otherPartyPlate: document.getElementById('inc-other-plate').value.trim(),
    caseStatus: document.getElementById('inc-case-status').value,
    suspensionDays: parseFloat(document.getElementById('inc-suspension-days').value) || 0,
  };
  record.total = incCalcTotal();

  if (incEditingId) {
    const idx = incidents.findIndex(i => i.id === incEditingId);
    if (idx >= 0) incidents[idx] = { ...incidents[idx], ...record };
    showToast('✅ แก้ไขบันทึกแล้ว', 'success');
    incCancelEdit();
  } else {
    record.id = 'INC_' + Date.now();
    record.runningNo = incNextRunningNo();
    record.createdAt = new Date().toISOString();
    incidents.unshift(record);
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🚧 <b>บันทึกอุบัติเหตุใหม่</b>\nเลขที่: ${record.runningNo}\nพนักงาน: ${escapeHtml(record.employeeName)}\nทะเบียน: ${escapeHtml(record.plate)}\nประเภท: ${escapeHtml(record.damageType)}\nมูลค่ารวม: ${formatMoney(record.total)}`
      );
    }
    incClearForm();
  }
  incSave();
  incPushIfReady();
  incRenderList();
}

function incClearForm() {
  incEditingId = null;
  document.getElementById('inc-edit-banner').style.display = 'none';
  ['inc-employee-name','inc-employee-age','inc-employee-tenure','inc-plate','inc-owner','inc-bu','inc-yard-auto','inc-insurance-auto',
   'inc-location','inc-description','inc-repair-shop','inc-repair-in','inc-repair-out','inc-repair-days','inc-score','inc-claim-no','inc-zone',
   'inc-remark-cost','inc-insurance-reported','inc-insurance-claim-status','inc-injury-status','inc-other-name','inc-other-phone','inc-other-plate',
   'inc-suspension-days','inc-time','inc-day-of-week','inc-month-label'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.querySelectorAll('.inc-cost').forEach(el => { el.value = ''; });
  document.getElementById('inc-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('inc-tms-status').value = 'OK';
  document.getElementById('inc-damage-type').value = 'Accident';
  document.getElementById('inc-fault').value = '';
  document.getElementById('inc-area').value = '';
  document.getElementById('inc-pattern').value = '';
  document.getElementById('inc-severity').value = '';
  document.getElementById('inc-case-status').value = 'Open';
  incCalcTotal();
  incUpdateAutoDate();
}

function incEditCase(id) {
  const rec = incidents.find(i => i.id === id);
  if (!rec) return;
  incEditingId = id;
  document.getElementById('inc-tms-status').value = rec.tmsStatus || 'OK';
  document.getElementById('inc-damage-type').value = rec.damageType || 'Accident';
  document.getElementById('inc-date').value = rec.incidentDate || '';
  document.getElementById('inc-time').value = rec.incidentTime || '';
  document.getElementById('inc-employee-name').value = rec.employeeName || '';
  document.getElementById('inc-plate').value = rec.plate || '';
  document.getElementById('inc-owner').value = rec.owner || '';
  incRefreshLookupDropdowns();
  if (typeof setSelectValueSafe === 'function') {
    setSelectValueSafe('inc-bu', rec.businessUnit || '');
    setSelectValueSafe('inc-yard-auto', rec.yard || '');
    setSelectValueSafe('inc-insurance-auto', rec.insuranceCompany || '');
    setSelectValueSafe('inc-pattern', rec.incidentPattern || '');
  }
  document.getElementById('inc-location').value = rec.location || '';
  document.getElementById('inc-description').value = rec.description || '';
  document.getElementById('inc-fault').value = rec.faultStatus || '';
  document.getElementById('inc-area').value = rec.area || '';
  document.getElementById('inc-severity').value = rec.severity || '';
  document.getElementById('inc-repair-shop').value = rec.repairShop || '';
  document.getElementById('inc-repair-in').value = rec.repairInDate || '';
  document.getElementById('inc-repair-out').value = rec.repairOutDate || '';
  document.getElementById('inc-score').value = rec.score || '';
  document.getElementById('inc-claim-no').value = rec.claimNo || '';
  document.getElementById('inc-zone').value = rec.zone || '';
  document.getElementById('inc-company-damage-cost').value = rec.companyDamageCost || '';
  document.getElementById('inc-company-paid').value = rec.companyPaid || '';
  document.getElementById('inc-towing-cost').value = rec.towingCost || '';
  document.getElementById('inc-charged-customer').value = rec.chargedToCustomer || '';
  document.getElementById('inc-charged-employee').value = rec.chargedToEmployee || '';
  document.getElementById('inc-remark-cost').value = rec.remarkCost || '';
  document.getElementById('inc-advance-amount').value = rec.advanceAmount || '';
  document.getElementById('inc-insurance-paid').value = rec.insurancePaid || '';
  document.getElementById('inc-insurance-reported').value = rec.insuranceReportedAmount || '';
  document.getElementById('inc-insurance-claim-status').value = rec.insuranceClaimStatus || '';
  document.getElementById('inc-injury-status').value = rec.injuryStatus || '';
  document.getElementById('inc-other-name').value = rec.otherPartyName || '';
  document.getElementById('inc-other-phone').value = rec.otherPartyPhone || '';
  document.getElementById('inc-other-plate').value = rec.otherPartyPlate || '';
  document.getElementById('inc-case-status').value = rec.caseStatus || 'Open';
  document.getElementById('inc-suspension-days').value = rec.suspensionDays || '';
  incLookupEmployee();
  incLookupVehicle();
  incUpdateAutoDate();
  incCalcRepairDays();
  incCalcTotal();
  document.getElementById('inc-edit-no').textContent = '#' + rec.runningNo;
  document.getElementById('inc-edit-banner').style.display = 'flex';
  incSwitchTab('add');
}

function incCancelEdit() {
  incEditingId = null;
  document.getElementById('inc-edit-banner').style.display = 'none';
  incClearForm();
}

function incDeleteCase(id) {
  if (!confirm('ยืนยันการลบบันทึกนี้?')) return;
  incidents = incidents.filter(i => i.id !== id);
  incSave();
  incPushIfReady();
  incRenderList();
  incRenderDashboard();
  showToast('ลบแล้ว', 'warning');
}

// ===== List =====
function incFilteredList() {
  const dateFrom = document.getElementById('inc-lf-datefrom')?.value;
  const dateTo = document.getElementById('inc-lf-dateto')?.value;
  const yard = document.getElementById('inc-lf-yard')?.value;
  const status = document.getElementById('inc-lf-status')?.value;
  const q = (document.getElementById('inc-lf-search')?.value || '').toLowerCase();
  return incidents.filter(i => {
    if (dateFrom && i.incidentDate < dateFrom) return false;
    if (dateTo && i.incidentDate > dateTo) return false;
    if (yard && i.yard !== yard) return false;
    if (status && i.caseStatus !== status) return false;
    if (q && !((i.plate||'').toLowerCase().includes(q) || (i.employeeName||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => new Date(b.incidentDate || 0) - new Date(a.incidentDate || 0));
}

function incClearListFilters() {
  ['inc-lf-datefrom','inc-lf-dateto','inc-lf-yard','inc-lf-status','inc-lf-search'].forEach(id => { document.getElementById(id).value = ''; });
  incRenderList();
}

function incRenderList() {
  const tbody = document.getElementById('inc-list-body');
  if (!tbody) return;
  const filtered = incFilteredList();
  document.getElementById('inc-list-count').textContent = `แสดง ${filtered.length} จาก ${incidents.length} รายการ`;
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = filtered.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.incidentDate)}</td>
      <td>${escapeHtml(i.damageType || '-')}</td>
      <td>${escapeHtml(i.employeeName || '-')}</td>
      <td style="font-family:monospace">${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.faultStatus || '-')}</td>
      <td>${formatMoney(i.total)}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="action-btn action-view" onclick="incEditCase('${i.id}')">แก้ไข</button>
          <button class="action-btn action-delete" onclick="incDeleteCase('${i.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ===== Dashboard =====
function incFilteredForDashboard() {
  const damageType = document.getElementById('inc-f-damagetype')?.value;
  const fault = document.getElementById('inc-f-fault')?.value;
  const yard = document.getElementById('inc-f-yard')?.value;
  const bu = document.getElementById('inc-f-bu')?.value;
  return incidents.filter(i => {
    if (damageType && i.damageType !== damageType) return false;
    if (fault && i.faultStatus !== fault) return false;
    if (yard && i.yard !== yard) return false;
    if (bu && i.businessUnit !== bu) return false;
    return true;
  });
}

function incClearDashFilters() {
  ['inc-f-damagetype','inc-f-fault','inc-f-yard','inc-f-bu'].forEach(id => { document.getElementById(id).value = ''; });
  incRenderDashboard();
}

function incDestroyChart(id) {
  if (incCharts[id]) { incCharts[id].destroy(); delete incCharts[id]; }
}

function incRenderDashboard() {
  const data = incFilteredForDashboard();
  const totalCost = data.reduce((s, i) => s + (i.total || 0), 0);
  document.getElementById('inc-kpi-total').textContent = formatMoney(totalCost);
  document.getElementById('inc-kpi-count').textContent = data.length;

  const empCount = {}; data.forEach(i => { if (i.employeeName) empCount[i.employeeName] = (empCount[i.employeeName]||0)+1; });
  const topEmp = Object.entries(empCount).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('inc-kpi-top-emp').textContent = topEmp ? `${topEmp[0]} (${topEmp[1]} ครั้ง)` : '-';

  const vehCount = {}; data.forEach(i => { if (i.plate) vehCount[i.plate] = (vehCount[i.plate]||0)+1; });
  const topVeh = Object.entries(vehCount).sort((a,b)=>b[1]-a[1])[0];
  document.getElementById('inc-kpi-top-veh').textContent = topVeh ? `${topVeh[0]} (${topVeh[1]} ครั้ง)` : '-';

  const monthCount = new Array(12).fill(0);
  data.forEach(i => { if (i.incidentDate) { const m = new Date(i.incidentDate).getMonth(); if (!isNaN(m)) monthCount[m]++; } });
  incDestroyChart('month');
  incCharts.month = new Chart(document.getElementById('inc-chart-month'), {
    type: 'bar',
    data: { labels: MONTH_LABELS_TH, datasets: [{ label: 'จำนวนเหตุ', data: monthCount, backgroundColor: INC_CHART_COLORS.month.bg, borderColor: INC_CHART_COLORS.month.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });

  const yardCount = {}; data.forEach(i => { if (i.yard) yardCount[i.yard] = (yardCount[i.yard]||0)+1; });
  const yardSorted = Object.entries(yardCount).sort((a,b)=>b[1]-a[1]);
  incDestroyChart('yard');
  incCharts.yard = new Chart(document.getElementById('inc-chart-yard'), {
    type: 'bar',
    data: { labels: yardSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: yardSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.yard.bg, borderColor: INC_CHART_COLORS.yard.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });

  const patternCount = {}; data.forEach(i => { if (i.incidentPattern) patternCount[i.incidentPattern] = (patternCount[i.incidentPattern]||0)+1; });
  const patternSorted = Object.entries(patternCount).sort((a,b) => b[1]-a[1]);
  incDestroyChart('pattern');
  incCharts.pattern = new Chart(document.getElementById('inc-chart-pattern'), {
    type: 'bar',
    data: { labels: patternSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: patternSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.pattern.bg, borderColor: INC_CHART_COLORS.pattern.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: { ...INC_CHART_TICK, maxRotation: 30 } } } }
  });

  const buCount = {}; data.forEach(i => { if (i.businessUnit) buCount[i.businessUnit] = (buCount[i.businessUnit]||0)+1; });
  const buSorted = Object.entries(buCount).sort((a,b) => b[1]-a[1]);
  incDestroyChart('bu');
  incCharts.bu = new Chart(document.getElementById('inc-chart-bu'), {
    type: 'bar',
    data: { labels: buSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: buSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.bu.bg, borderColor: INC_CHART_COLORS.bu.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });

  const areaCount = {}; data.forEach(i => { if (i.area) areaCount[i.area] = (areaCount[i.area]||0)+1; });
  const areaSorted = Object.entries(areaCount).sort((a,b)=>b[1]-a[1]);
  incDestroyChart('area');
  incCharts.area = new Chart(document.getElementById('inc-chart-area'), {
    type: 'bar',
    data: { labels: areaSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: areaSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.area.bg, borderColor: INC_CHART_COLORS.area.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });
}

// ===== Excel Import / Export / Template =====
const INC_XLSX_HEADERS = ['เลขที่','สถานะTMS','ประเภท','วันที่','เวลา','ชื่อพนักงาน','ทะเบียนรถ','สถานที่','รายละเอียด','ถูกผิด','พื้นที่','ลักษณะ','ความรุนแรง','อู่ซ่อม','วันเข้าซ่อม','วันซ่อมเสร็จ','คะแนน','เลขที่เคลม','โซน','ค่าเสียหายบริษัท','บริษัทจ่ายจริง','ค่าลาก','เรียกเก็บลูกค้า','เรียกเก็บพนักงาน','เงินทดรอง','ประกันจ่าย','ยอดแจ้งประกัน','สถานะเคลม','หมายเหตุ','สถานะบาดเจ็บ','ชื่อคู่กรณี','เบอร์คู่กรณี','ทะเบียนคู่กรณี','สถานะเคส','วันหยุดงาน','ประกันภัย','ลานจอด','หน่วยงาน'];

function incDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    INC_XLSX_HEADERS,
    ['1','OK','Accident','2026-01-15','09:30','นายสมชาย ใจดี','70-1234','หน้าโรงงาน','รถชนท้าย','ผิด','On the way','เฉี่ยวชน','ทั่วไป','อู่ ก','2026-01-16','2026-01-20','5','CL-001','โซน1','15000','15000','0','0','0','0','15000','15000','อนุมัติ','','ไม่มี','','','','Closed','0','วิริยะ','ลานจอด A','หน่วยงาน 1'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'บันทึกอุบัติเหตุ');
  XLSX.writeFile(wb, 'template_บันทึกอุบัติเหตุ.xlsx');
}

function incExportExcel() {
  if (!incidents.length) { showToast('ไม่มีข้อมูล', 'error'); return; }
  const rows = incidents.map(i => [
    i.runningNo, i.tmsStatus, i.damageType, i.incidentDate, i.incidentTime, i.employeeName, i.plate, i.location, i.description,
    i.faultStatus, i.area, i.incidentPattern, i.severity, i.repairShop, i.repairInDate, i.repairOutDate, i.score, i.claimNo, i.zone,
    i.companyDamageCost, i.companyPaid, i.towingCost, i.chargedToCustomer, i.chargedToEmployee, i.advanceAmount, i.insurancePaid,
    i.insuranceReportedAmount, i.insuranceClaimStatus, i.remarkCost, i.injuryStatus, i.otherPartyName, i.otherPartyPhone, i.otherPartyPlate,
    i.caseStatus, i.suspensionDays, i.insuranceCompany, i.yard, i.businessUnit,
  ]);
  const ws = XLSX.utils.aoa_to_sheet([INC_XLSX_HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'บันทึกอุบัติเหตุ');
  XLSX.writeFile(wb, 'บันทึกอุบัติเหตุ_' + new Date().toISOString().slice(0,10) + '.xlsx');
}

function incParseImportRow(row) {
  const employeeName = String(row[5] || '').trim();
  const plate = String(row[6] || '').trim();
  if (!employeeName && !plate) return null;
  const emp = mdDrivers.find(d => d.name === employeeName);
  const veh = mdVehicles.find(v => v.plate === plate);
  const incidentDate = normalizeImportDate(row[3]);
  const d = incidentDate ? new Date(incidentDate) : null;
  return {
    tmsStatus: String(row[1]||'').trim(), damageType: String(row[2]||'').trim() || 'Accident',
    incidentDate, incidentTime: String(row[4]||'').trim(),
    dayOfWeek: d ? DOW_LABELS_TH[d.getDay()] : '', monthLabel: d ? MONTH_LABELS_TH[d.getMonth()]+' '+(d.getFullYear()) : '',
    employeeName, employeeBirthDate: emp?.birthDate||'', employeeStartDate: emp?.startDate||'',
    plate, owner: veh?.owner||'',
    yard: String(row[36]||'').trim() || veh?.yard||'',
    businessUnit: String(row[37]||'').trim() || veh?.businessUnit||'',
    insuranceCompany: String(row[35]||'').trim() || veh?.insuranceCompany||'',
    location: String(row[7]||'').trim(), description: String(row[8]||'').trim(),
    faultStatus: String(row[9]||'').trim(), area: String(row[10]||'').trim(), incidentPattern: String(row[11]||'').trim(), severity: String(row[12]||'').trim(),
    repairShop: String(row[13]||'').trim(), repairInDate: normalizeImportDate(row[14]), repairOutDate: normalizeImportDate(row[15]),
    score: row[16]||'', claimNo: String(row[17]||'').trim(), zone: String(row[18]||'').trim(),
    companyDamageCost: parseFloat(row[19])||0, companyPaid: parseFloat(row[20])||0, towingCost: parseFloat(row[21])||0,
    chargedToCustomer: parseFloat(row[22])||0, chargedToEmployee: parseFloat(row[23])||0, advanceAmount: parseFloat(row[24])||0,
    insurancePaid: parseFloat(row[25])||0, insuranceReportedAmount: parseFloat(row[26])||0, insuranceClaimStatus: String(row[27]||'').trim(),
    remarkCost: String(row[28]||'').trim(), injuryStatus: String(row[29]||'').trim(),
    otherPartyName: String(row[30]||'').trim(), otherPartyPhone: String(row[31]||'').trim(), otherPartyPlate: String(row[32]||'').trim(),
    caseStatus: String(row[33]||'').trim() || 'Open', suspensionDays: parseFloat(row[34])||0,
    total: (parseFloat(row[19])||0)+(parseFloat(row[20])||0)+(parseFloat(row[21])||0)+(parseFloat(row[22])||0)+(parseFloat(row[23])||0)+(parseFloat(row[24])||0)+(parseFloat(row[25])||0),
  };
}

function incImportExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }).slice(1);
      let updated = 0, added = 0;
      rows.forEach((row, idx) => {
        const parsed = incParseImportRow(row);
        if (!parsed) return;
        const rowNo = parseInt(row[0]);
        const existingIdx = rowNo ? incidents.findIndex(i => i.runningNo === rowNo) : -1;
        if (existingIdx >= 0) {
          incidents[existingIdx] = { ...incidents[existingIdx], ...parsed };
          updated++;
        } else {
          incidents.unshift({ id: 'INC_' + Date.now() + '_' + idx, runningNo: incNextRunningNo(), createdAt: new Date().toISOString(), ...parsed });
          added++;
        }
      });
      incSave();
      incPushIfReady();
      incRenderList();
      incRenderDashboard();
      const msg = [updated ? `อัปเดต ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) {
      showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Report Mode (1080×1350 PNG for LINE) =====
function incDestroyReportChart(id) {
  if (incReportCharts[id]) { incReportCharts[id].destroy(); delete incReportCharts[id]; }
}

function incBuildChartData(data) {
  const monthCount = new Array(12).fill(0);
  data.forEach(i => { if (i.incidentDate) { const m = new Date(i.incidentDate).getMonth(); if (!isNaN(m)) monthCount[m]++; } });
  const patternCount = {}; data.forEach(i => { if (i.incidentPattern) patternCount[i.incidentPattern] = (patternCount[i.incidentPattern]||0)+1; });
  const patternSorted = Object.entries(patternCount).sort((a,b)=>b[1]-a[1]);
  const buCount = {}; data.forEach(i => { if (i.businessUnit) buCount[i.businessUnit] = (buCount[i.businessUnit]||0)+1; });
  const buSorted = Object.entries(buCount).sort((a,b)=>b[1]-a[1]);
  const yardCount = {}; data.forEach(i => { if (i.yard) yardCount[i.yard] = (yardCount[i.yard]||0)+1; });
  const yardSorted = Object.entries(yardCount).sort((a,b)=>b[1]-a[1]);
  const areaCount = {}; data.forEach(i => { if (i.area) areaCount[i.area] = (areaCount[i.area]||0)+1; });
  const areaSorted = Object.entries(areaCount).sort((a,b)=>b[1]-a[1]);
  return { monthCount, patternSorted, buSorted, yardSorted, areaSorted };
}

function incRenderReportCharts(chartData) {
  const rptFont = { family: "'Kanit','Sarabun',sans-serif", size: 15 };
  const rptTick = { color: '#3d4f6d', font: rptFont };
  const rptGrid = { color: 'rgba(10,31,56,0.07)' };
  const rptDL = { display: true, anchor: 'end', align: 'end', color: '#1a2540', font: { family: "'Kanit','Sarabun',sans-serif", size: 15, weight: '700' }, formatter: v => v > 0 ? v : '' };
  const rptOpts = (extra = {}) => ({
    responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { display: false }, datalabels: rptDL }, ...extra
  });

  incDestroyReportChart('month');
  incReportCharts.month = new Chart(document.getElementById('rpt-chart-month'), {
    type: 'bar',
    data: { labels: MONTH_LABELS_TH, datasets: [{ label: 'จำนวนเหตุ', data: chartData.monthCount, backgroundColor: INC_CHART_COLORS.month.bg, borderColor: INC_CHART_COLORS.month.border, borderWidth: 0, borderRadius: 5 }] },
    options: rptOpts({ scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: rptTick } } })
  });

  incDestroyReportChart('pattern');
  incReportCharts.pattern = new Chart(document.getElementById('rpt-chart-pattern'), {
    type: 'bar',
    data: { labels: chartData.patternSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: chartData.patternSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.pattern.bg, borderColor: INC_CHART_COLORS.pattern.border, borderWidth: 0, borderRadius: 5 }] },
    options: rptOpts({ scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: { ...rptTick, maxRotation: 30 } } } })
  });

  incDestroyReportChart('bu');
  incReportCharts.bu = new Chart(document.getElementById('rpt-chart-bu'), {
    type: 'bar',
    data: { labels: chartData.buSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: chartData.buSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.bu.bg, borderColor: INC_CHART_COLORS.bu.border, borderWidth: 0, borderRadius: 5 }] },
    options: rptOpts({ scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: rptTick } } })
  });

  incDestroyReportChart('yard');
  incReportCharts.yard = new Chart(document.getElementById('rpt-chart-yard'), {
    type: 'bar',
    data: { labels: chartData.yardSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: chartData.yardSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.yard.bg, borderColor: INC_CHART_COLORS.yard.border, borderWidth: 0, borderRadius: 5 }] },
    options: rptOpts({ scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: rptTick } } })
  });

  incDestroyReportChart('area');
  incReportCharts.area = new Chart(document.getElementById('rpt-chart-area'), {
    type: 'bar',
    data: { labels: chartData.areaSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: chartData.areaSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.area.bg, borderColor: INC_CHART_COLORS.area.border, borderWidth: 0, borderRadius: 5 }] },
    options: rptOpts({ scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: rptTick } } })
  });
}

async function incSaveReport() {
  const loading = document.getElementById('inc-report-loading');
  const rpt = document.getElementById('inc-report-container');
  loading.style.display = 'flex';

  const data = incFilteredForDashboard();
  const totalCost = data.reduce((s, i) => s + (i.total || 0), 0);
  const empCount = {}; data.forEach(i => { if (i.employeeName) empCount[i.employeeName] = (empCount[i.employeeName]||0)+1; });
  const topEmp = Object.entries(empCount).sort((a,b)=>b[1]-a[1])[0];
  const vehCount = {}; data.forEach(i => { if (i.plate) vehCount[i.plate] = (vehCount[i.plate]||0)+1; });
  const topVeh = Object.entries(vehCount).sort((a,b)=>b[1]-a[1])[0];

  const now = new Date();
  document.getElementById('rpt-date-text').textContent = 'จัดทำ: ' + now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('rpt-total-count').textContent = data.length;
  document.getElementById('rpt-kpi-total').textContent = formatMoney(totalCost);
  document.getElementById('rpt-kpi-count').textContent = data.length;
  document.getElementById('rpt-kpi-emp').textContent = topEmp ? `${topEmp[0]} (${topEmp[1]} ครั้ง)` : '-';
  document.getElementById('rpt-kpi-veh').textContent = topVeh ? `${topVeh[0]} (${topVeh[1]} ครั้ง)` : '-';

  const chartData = incBuildChartData(data);

  rpt.style.height = 'auto';
  rpt.style.top = '0';
  rpt.style.left = '0';
  rpt.style.zIndex = '9998';

  incRenderReportCharts(chartData);

  await new Promise(r => setTimeout(r, 1000));

  const captureH = rpt.offsetHeight;
  rpt.style.height = captureH + 'px';
  await new Promise(r => setTimeout(r, 60));

  const savedScroll = window.scrollY;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 80));

  try {
    const canvas = await html2canvas(rpt, { width: 1080, height: captureH, scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const link = document.createElement('a');
    link.download = 'รายงานอุบัติเหตุ_' + now.toISOString().slice(0, 10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('ดาวน์โหลดรายงานเรียบร้อย', 'success');
  } catch (e) {
    showToast('สร้างรายงานไม่ได้: ' + e.message, 'error');
  }

  window.scrollTo(0, savedScroll);
  rpt.style.top = '';
  rpt.style.left = '-1100px';
  rpt.style.zIndex = '';
  loading.style.display = 'none';
  Object.keys(incReportCharts).forEach(id => incDestroyReportChart(id));
}

function incDeleteAllIncidents() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirm(`ลบบันทึกอุบัติเหตุทั้งหมด ${incidents.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  incidents = [];
  incSave();
  incPushIfReady();
  incRenderList();
  incRenderDashboard();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function incRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function incObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function incApplyServer(serverIncidents) {
  incidents = serverIncidents;
  incSave();
  incRenderList();
  incRenderDashboard();
}
async function incWriteFB() {
  if (!incRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(incRef, incRecordsToObj(incidents));
  } catch (e) { console.warn('incWriteFB error', e); }
}
function incPushIfReady() { if (incReady) incWriteFB(); }

function incWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function incInit() {
  await incWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    incRef = ref(fbDb, '/incidents');
    const snap = await get(incRef);
    if (snap.exists()) incApplyServer(incObjToRecords(snap.val()));
    incReady = true;
    if (!snap.exists() && incidents.length > 0) await incWriteFB();
    onValue(incRef, s => { if (s.exists()) incApplyServer(incObjToRecords(s.val())); });
  } catch (e) {
    console.warn('incInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  incRefreshLookupDropdowns();
  incClearForm();
  incRenderList();
  incInit();
});

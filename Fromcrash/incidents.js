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
// จำนวนอุบัติเหตุรายเดือนของปี 2025 (ปีที่แล้ว) — ใช้เทียบกับปีปัจจุบันในกราฟแดชบอร์ด ไม่มีข้อมูลดิบในระบบ
// (ระบบเริ่มบันทึกปี 2026) จึงใส่ตัวเลขอ้างอิงตรงๆ ตามที่ผู้ใช้ให้มา
const INC_LAST_YEAR_MONTHLY = [15, 10, 17, 5, 12, 21, 23, 10, 13, 20, 10, 10];
const DOW_LABELS_TH = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];

function incSave() { localStorage.setItem('finflow_incidents', JSON.stringify(incidents)); }

// ทำให้ "พื้นที่เกิดเหตุ" เป็นรูปแบบเดียวกันเสมอ — ข้อมูลเก่าบางรายการเคยถูกบันทึกด้วยตัวพิมพ์เล็ก/ใหญ่
// ไม่ตรงกัน (เช่น "In plant" vs "In Plant") ทำให้กราฟนับแยกเป็นคนละแท่งทั้งที่ควรเป็นอันเดียวกัน
function incNormalizeArea(val) {
  const v = String(val || '').trim();
  const lower = v.toLowerCase();
  if (lower === 'on the way') return 'On the way';
  if (lower === 'in plant') return 'In Plant';
  if (lower === 'in yard') return 'In yard';
  return v;
}

// ===== Sub-tabs =====
function incSwitchTab(tab) {
  ['dashboard','list','add','trouble'].forEach(t => {
    document.getElementById(`inc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`inc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  // แท็บ "ประวัติการนำรถเข้าอู่" (gh-*) อยู่ในแถบ subtabs เดียวกันของหน้านี้ — ต้องปิดไว้เสมอเวลาสลับมาแท็บฝั่ง inc
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`gh-tab-${t}`)?.classList.remove('active');
    document.getElementById(`gh-subpage-${t}`)?.classList.remove('active');
  });
  if (tab === 'dashboard') incRenderDashboard();
  if (tab === 'list') incRenderList();
  if (tab === 'add' && !incEditingId) incClearForm();
  if (tab === 'trouble') incRenderTroubleReport();
}

// เรียกจาก showPage('incidents') ของ app.js — บังคับ redraw กราฟให้ถูกขนาด
// (Chart.js วาดผิดถ้า container ยังซ่อนอยู่ตอนสร้าง canvas)
function incOnPageShown() {
  incRenderDashboard();
  ghRefreshLookupDropdowns();
  ghRenderList();
  if (document.getElementById('gh-subpage-dashboard')?.classList.contains('active')) {
    ghRefreshDashFilters();
    ghRenderDashboard();
  }
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
  incFillSelect('inc-f-pattern', mdIncidentPatterns);
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
    area: incNormalizeArea(document.getElementById('inc-area').value),
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

  let savedRecord;
  if (incEditingId) {
    const idx = incidents.findIndex(i => i.id === incEditingId);
    if (idx >= 0) incidents[idx] = { ...incidents[idx], ...record };
    savedRecord = incidents[idx];
    showToast('✅ แก้ไขบันทึกแล้ว', 'success');
    incCancelEdit();
  } else {
    record.id = 'INC_' + Date.now();
    record.runningNo = incNextRunningNo();
    record.createdAt = new Date().toISOString();
    incidents.unshift(record);
    savedRecord = record;
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🚧 <b>บันทึกอุบัติเหตุใหม่</b>\nเลขที่: ${record.runningNo}\nพนักงาน: ${escapeHtml(record.employeeName)}\nทะเบียน: ${escapeHtml(record.plate)}\nประเภท: ${escapeHtml(record.damageType)}\nมูลค่ารวม: ${formatMoney(record.total)}`
      );
    }
    incClearForm();
  }
  incSave();
  incPushOneIfReady(savedRecord);
  incRenderList();
}

function incClearForm() {
  incEditingId = null;
  document.getElementById('inc-edit-banner').style.display = 'none';
  ['inc-employee-name','inc-employee-age','inc-employee-tenure','inc-plate','inc-owner','inc-bu','inc-yard-auto','inc-insurance-auto',
   'inc-location','inc-description','inc-repair-shop','inc-repair-in','inc-repair-out','inc-repair-days','inc-score','inc-claim-no','inc-zone',
   'inc-remark-cost','inc-insurance-reported','inc-insurance-claim-status','inc-injury-status','inc-other-name','inc-other-phone','inc-other-plate',
   'inc-suspension-days','inc-day-of-week','inc-month-label'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.querySelectorAll('.inc-cost').forEach(el => { el.value = ''; });
  tmSetTimeValue('inc-time', '');
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
  tmSetTimeValue('inc-time', rec.incidentTime || '');
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
  document.getElementById('inc-area').value = incNormalizeArea(rec.area) || '';
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
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  incidents = incidents.filter(i => i.id !== id);
  incSave();
  incRemoveOneIfReady(id);
  incRenderList();
  incRenderDashboard();
  showToast('ลบแล้ว', 'warning');
}

// ===== List =====
function incFilteredList() {
  const dateFrom = document.getElementById('inc-lf-datefrom')?.value;
  const dateTo = document.getElementById('inc-lf-dateto')?.value;
  const yard = document.getElementById('inc-lf-yard')?.value;
  const area = document.getElementById('inc-lf-area')?.value;
  const status = document.getElementById('inc-lf-status')?.value;
  const q = (document.getElementById('inc-lf-search')?.value || '').toLowerCase();
  return incidents.filter(i => {
    if (dateFrom && i.incidentDate < dateFrom) return false;
    if (dateTo && i.incidentDate > dateTo) return false;
    if (area && incNormalizeArea(i.area) !== area) return false;
    if (yard && i.yard !== yard) return false;
    if (status && i.caseStatus !== status) return false;
    if (q && !((i.plate||'').toLowerCase().includes(q) || (i.employeeName||'').toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => new Date(b.createdAt || b.incidentDate || 0) - new Date(a.createdAt || a.incidentDate || 0));
}

function incClearListFilters() {
  ['inc-lf-datefrom','inc-lf-dateto','inc-lf-yard','inc-lf-area','inc-lf-status','inc-lf-search'].forEach(id => { document.getElementById(id).value = ''; });
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
  const month = document.getElementById('inc-f-month')?.value;
  const damageType = document.getElementById('inc-f-damagetype')?.value;
  const fault = document.getElementById('inc-f-fault')?.value;
  const yard = document.getElementById('inc-f-yard')?.value;
  const bu = document.getElementById('inc-f-bu')?.value;
  const area = document.getElementById('inc-f-area')?.value;
  const pattern = document.getElementById('inc-f-pattern')?.value;
  return incidents.filter(i => {
    if (month && !(i.incidentDate || '').startsWith(month)) return false;
    if (damageType && i.damageType !== damageType) return false;
    if (fault && i.faultStatus !== fault) return false;
    if (yard && i.yard !== yard) return false;
    if (bu && i.businessUnit !== bu) return false;
    if (area && incNormalizeArea(i.area) !== area) return false;
    if (pattern && i.incidentPattern !== pattern) return false;
    return true;
  });
}

function incClearDashFilters() {
  ['inc-f-month','inc-f-damagetype','inc-f-fault','inc-f-yard','inc-f-bu','inc-f-area','inc-f-pattern'].forEach(id => { document.getElementById(id).value = ''; });
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

  // นับเฉพาะปีปัจจุบัน (แท่ง) ไม่ปนกับข้อมูลปีอื่นที่อาจมีอยู่ในระบบ — ปีที่แล้วใช้ตัวเลขอ้างอิงคงที่ (เส้น)
  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  data.forEach(i => {
    if (!i.incidentDate) return;
    const d = new Date(i.incidentDate);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  incDestroyChart('month');
  incCharts.month = new Chart(document.getElementById('inc-chart-month'), {
    data: {
      labels: MONTH_LABELS_TH,
      datasets: [
        { type: 'bar', label: `จำนวนเหตุ ${curYear}`, data: monthCount, backgroundColor: INC_CHART_COLORS.month.bg, borderColor: INC_CHART_COLORS.month.border, borderWidth: 0, borderRadius: 5, order: 2 },
        { type: 'line', label: `จำนวนเหตุ ${curYear - 1}`, data: INC_LAST_YEAR_MONTHLY, borderColor: '#ff9f1c', backgroundColor: '#ff9f1c', borderWidth: 2, borderDash: [6, 4], pointBackgroundColor: '#ff9f1c', pointRadius: 3, tension: 0.3, fill: false, order: 1, datalabels: { display: false } },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: true, position: 'top', labels: { color: '#3d4f6d', font: INC_CHART_FONT, boxWidth: 14 } }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });
  setChartTotal('inc-chart-month', monthCount); // นับเฉพาะแท่งปีปัจจุบัน ไม่รวมเส้นปีที่แล้ว

  const yardCount = {}; data.forEach(i => { if (i.yard) yardCount[i.yard] = (yardCount[i.yard]||0)+1; });
  const yardSorted = Object.entries(yardCount).sort((a,b)=>b[1]-a[1]);
  incDestroyChart('yard');
  incCharts.yard = new Chart(document.getElementById('inc-chart-yard'), {
    type: 'bar',
    data: { labels: yardSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: yardSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.yard.bg, borderColor: INC_CHART_COLORS.yard.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });
  setChartTotal('inc-chart-yard', yardSorted.map(e => e[1]));

  const patternCount = {}; data.forEach(i => { if (i.incidentPattern) patternCount[i.incidentPattern] = (patternCount[i.incidentPattern]||0)+1; });
  const patternSorted = Object.entries(patternCount).sort((a,b) => b[1]-a[1]);
  incDestroyChart('pattern');
  incCharts.pattern = new Chart(document.getElementById('inc-chart-pattern'), {
    type: 'bar',
    data: { labels: patternSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: patternSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.pattern.bg, borderColor: INC_CHART_COLORS.pattern.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: { ...INC_CHART_TICK, maxRotation: 30 } } } }
  });
  setChartTotal('inc-chart-pattern', patternSorted.map(e => e[1]));

  const buCount = {}; data.forEach(i => { if (i.businessUnit) buCount[i.businessUnit] = (buCount[i.businessUnit]||0)+1; });
  const buSorted = Object.entries(buCount).sort((a,b) => b[1]-a[1]);
  incDestroyChart('bu');
  incCharts.bu = new Chart(document.getElementById('inc-chart-bu'), {
    type: 'bar',
    data: { labels: buSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: buSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.bu.bg, borderColor: INC_CHART_COLORS.bu.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });
  setChartTotal('inc-chart-bu', buSorted.map(e => e[1]));

  const areaCount = {}; data.forEach(i => { const a = incNormalizeArea(i.area); if (a) areaCount[a] = (areaCount[a]||0)+1; });
  const areaSorted = Object.entries(areaCount).sort((a,b)=>b[1]-a[1]);
  incDestroyChart('area');
  incCharts.area = new Chart(document.getElementById('inc-chart-area'), {
    type: 'bar',
    data: { labels: areaSorted.map(e=>e[0]), datasets: [{ label: 'จำนวนเหตุ', data: areaSorted.map(e=>e[1]), backgroundColor: INC_CHART_COLORS.area.bg, borderColor: INC_CHART_COLORS.area.border, borderWidth: 0, borderRadius: 5 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: INC_DL_OPTS }, scales: { y: { beginAtZero: true, grace: '15%', grid: INC_CHART_GRID, ticks: { ...INC_CHART_TICK, precision: 0 } }, x: { grid: { display: false }, ticks: INC_CHART_TICK } } }
  });
  setChartTotal('inc-chart-area', areaSorted.map(e => e[1]));
}

// ===== การจัดส่งรายงาน Trouble Report (ติดตามเคสที่สถานะ TMS = NG ยังไม่ได้ส่ง) =====
// กำหนดส่ง = วันที่เกิดเหตุ + 5 วัน, เกินกำหนด = วันนี้ - กำหนดส่ง (ไม่ต่ำกว่า 0)
const INC_TROUBLE_DUE_DAYS = 5;

function incTroubleDamageLabel(damageType) {
  if (damageType === 'Accident') return 'อุบัติเหตุ';
  if (damageType === 'Part damage') return 'สินค้าเสียหาย';
  return damageType || '-';
}

function incTroubleReportRows() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return incidents
    .filter(i => (i.tmsStatus || 'OK') === 'NG' && i.incidentDate)
    .map(i => {
      const incidentDate = new Date(i.incidentDate);
      const dueDate = new Date(incidentDate); dueDate.setDate(dueDate.getDate() + INC_TROUBLE_DUE_DAYS);
      const overdueDays = Math.max(0, Math.round((today - dueDate) / 86400000));
      return { ...i, dueDate, overdueDays };
    })
    .sort((a, b) => new Date(a.incidentDate) - new Date(b.incidentDate));
}

function incRenderTroubleReport() {
  const tbody = document.getElementById('inc-trouble-body');
  if (!tbody) return;
  const rows = incTroubleReportRows();
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">ไม่มีเคสค้างส่ง (TMS ครบ OK ทั้งหมด)</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(r => `
    <tr data-id="${r.id}">
      <td>${formatDate(r.incidentDate)}</td>
      <td>Trouble Report</td>
      <td>${escapeHtml(r.employeeName || '-')}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td class="inc-trouble-due">${formatDate(r.dueDate.toISOString().slice(0, 10))}</td>
      <td class="inc-trouble-overdue">${r.overdueDays}</td>
      <td class="inc-trouble-note">${escapeHtml(incTroubleDamageLabel(r.damageType))}</td>
    </tr>
  `).join('');
}

async function incSaveTroubleReportImage() {
  const el = document.getElementById('inc-trouble-capture');
  if (!el) return;
  try {
    const canvas = await html2canvas(el, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
    const link = document.createElement('a');
    link.download = 'Trouble_Report_' + new Date().toISOString().slice(0, 10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('บันทึกภาพเรียบร้อย', 'success');
  } catch (e) {
    showToast('สร้างภาพไม่ได้: ' + e.message, 'error');
  }
}

// ===== Excel Import / Export / Template =====
const INC_XLSX_HEADERS = ['เลขที่','สถานะTMS','ประเภท','วันที่','เวลา','ชื่อพนักงาน','ทะเบียนรถ','สถานที่','รายละเอียด','ถูกผิด','พื้นที่','ลักษณะ','ความรุนแรง','อู่ซ่อม','วันเข้าซ่อม','วันซ่อมเสร็จ','คะแนน','เลขที่เคลม','โซน','ค่าเสียหายบริษัท','บริษัทจ่ายจริง','ค่าลาก','เรียกเก็บลูกค้า','เรียกเก็บพนักงาน','เงินทดรอง','ประกันจ่าย','ยอดแจ้งประกัน','สถานะเคลม','หมายเหตุ','สถานะบาดเจ็บ','ชื่อคู่กรณี','เบอร์คู่กรณี','ทะเบียนคู่กรณี','สถานะเคส','วันหยุดงาน','ประกันภัย','ลานจอด','หน่วยงาน'];

function incDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    INC_XLSX_HEADERS,
    ['1','OK','Accident','15/01/2026','09:30','นายสมชาย ใจดี','70-1234','หน้าโรงงาน','รถชนท้าย','ผิด','On the way','เฉี่ยวชน','ทั่วไป','อู่ ก','16/01/2026','20/01/2026','5','CL-001','โซน1','15000','15000','0','0','0','0','15000','15000','อนุมัติ','','ไม่มี','','','','Closed','0','วิริยะ','ลานจอด A','หน่วยงาน 1'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'บันทึกอุบัติเหตุ');
  XLSX.writeFile(wb, 'template_บันทึกอุบัติเหตุ.xlsx');
}

function incExportExcel() {
  if (!incidents.length) { showToast('ไม่มีข้อมูล', 'error'); return; }
  const rows = incidents.map(i => [
    i.runningNo, i.tmsStatus, i.damageType, formatDMY(i.incidentDate), i.incidentTime, i.employeeName, i.plate, i.location, i.description,
    i.faultStatus, incNormalizeArea(i.area), i.incidentPattern, i.severity, i.repairShop, formatDMY(i.repairInDate), formatDMY(i.repairOutDate), i.score, i.claimNo, i.zone,
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
    faultStatus: String(row[9]||'').trim(), area: incNormalizeArea(row[10]), incidentPattern: String(row[11]||'').trim(), severity: String(row[12]||'').trim(),
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
  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  data.forEach(i => {
    if (!i.incidentDate) return;
    const d = new Date(i.incidentDate);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  const patternCount = {}; data.forEach(i => { if (i.incidentPattern) patternCount[i.incidentPattern] = (patternCount[i.incidentPattern]||0)+1; });
  const patternSorted = Object.entries(patternCount).sort((a,b)=>b[1]-a[1]);
  const buCount = {}; data.forEach(i => { if (i.businessUnit) buCount[i.businessUnit] = (buCount[i.businessUnit]||0)+1; });
  const buSorted = Object.entries(buCount).sort((a,b)=>b[1]-a[1]);
  const yardCount = {}; data.forEach(i => { if (i.yard) yardCount[i.yard] = (yardCount[i.yard]||0)+1; });
  const yardSorted = Object.entries(yardCount).sort((a,b)=>b[1]-a[1]);
  const areaCount = {}; data.forEach(i => { const a = incNormalizeArea(i.area); if (a) areaCount[a] = (areaCount[a]||0)+1; });
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
  const curYear = new Date().getFullYear();

  incDestroyReportChart('month');
  incReportCharts.month = new Chart(document.getElementById('rpt-chart-month'), {
    data: {
      labels: MONTH_LABELS_TH,
      datasets: [
        { type: 'bar', label: `จำนวนเหตุ ${curYear}`, data: chartData.monthCount, backgroundColor: INC_CHART_COLORS.month.bg, borderColor: INC_CHART_COLORS.month.border, borderWidth: 0, borderRadius: 5, order: 2 },
        { type: 'line', label: `จำนวนเหตุ ${curYear - 1}`, data: INC_LAST_YEAR_MONTHLY, borderColor: '#ff9f1c', backgroundColor: '#ff9f1c', borderWidth: 2, borderDash: [6, 4], pointBackgroundColor: '#ff9f1c', pointRadius: 3, tension: 0.3, fill: false, order: 1, datalabels: { display: false } },
      ],
    },
    options: rptOpts({
      plugins: { legend: { display: true, position: 'top', labels: { color: '#3d4f6d', font: rptFont, boxWidth: 14 } }, datalabels: rptDL },
      scales: { y: { beginAtZero: true, grace: '15%', grid: rptGrid, ticks: { ...rptTick, precision: 0 } }, x: { grid: { display: false }, ticks: rptTick } }
    })
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

  const now = new Date();
  document.getElementById('rpt-date-text').textContent = 'จัดทำ: ' + now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('rpt-total-count').textContent = data.length;

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
  if (!confirmDeleteWithPin(`ลบบันทึกอุบัติเหตุทั้งหมด ${incidents.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
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
  } catch (e) { console.warn('incWriteFB error', e); notifySyncWriteError(); }
}
function incPushIfReady() { if (incReady) incWriteFB(); }

// ===== เขียน/ลบเฉพาะรายการเดียว (ไม่ใช่ทั้งอาเรย์) — ใช้ตอนเพิ่ม/แก้ไข/ลบทีละรายการ =====
// เดิม incPushIfReady() จะ set() ทับข้อมูลทั้งหมดทุกครั้งที่บันทึก 1 รายการ พอข้อมูลสะสมเยอะขึ้นการบันทึกจะยิ่งช้าลง
async function incWriteOne(record) {
  if (!incRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/incidents/${record.id}`), record);
  } catch (e) { console.warn('incWriteOne error', e); notifySyncWriteError(); }
}
function incPushOneIfReady(record) { if (incReady) incWriteOne(record); }

async function incRemoveOne(id) {
  if (!incRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/incidents/${id}`));
  } catch (e) { console.warn('incRemoveOne error', e); notifySyncWriteError(); }
}
function incRemoveOneIfReady(id) { if (incReady) incRemoveOne(id); }

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
    notifySyncLoadError();
  }
}

document.addEventListener('DOMContentLoaded', () => {
  incRefreshLookupDropdowns();
  incClearForm();
  incRenderList();
  incInit();
  ghRefreshLookupDropdowns();
  ghClearForm();
  ghRenderList();
  ghInit();
});

// ===== ประวัติการนำรถเข้าอู่ (แยกต่างหากจากบันทึกอุบัติเหตุ — รถคันเดียวเข้าอู่ได้หลายครั้ง) =====
// เก็บ local ที่ localStorage key 'finflow_garage_history' และ sync กับ Firebase ที่ /garageHistory

let ghRecords = JSON.parse(localStorage.getItem('finflow_garage_history') || '[]');
let ghEditingId = null;
let ghRef = null;
let ghReady = false;
let ghCharts = {};
let ghSortField = null; // null = ใช้ลำดับ default (วันที่เข้าอู่ใหม่สุดก่อน)
let ghSortDir = 1;

const GH_XLSX_HEADERS = ['ลำดับที่', 'ทะเบียนรถ', 'ลานจอด', 'หน่วยงาน', 'อู่/ศูนย์ซ่อม', 'วันที่เข้าอู่ (dd/mm/yyyy)', 'วันที่ซ่อมเสร็จ (dd/mm/yyyy)', 'รายละเอียด/สาเหตุที่เข้าอู่', 'ค่าใช้จ่ายรอบนี้'];
const GH_XLSX_COLWIDTHS = [8, 14, 12, 16, 20, 18, 18, 30, 14];
const GH_NUMERIC_FIELDS = ['runningNo', 'cost'];
const GH_DATE_FIELDS = ['inDate', 'outDate'];

function ghSave() { localStorage.setItem('finflow_garage_history', JSON.stringify(ghRecords)); }

function ghNextRunningNo() {
  return ghRecords.length ? Math.max(...ghRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

// ===== Sub-tabs =====
function ghSwitchTab(tab) {
  // gh-* อยู่ในแถบ subtabs เดียวกับ inc-* (dashboard/list/add/trouble) — ต้องปิดฝั่ง inc ไว้เสมอเวลาสลับมาแท็บนี้
  ['dashboard', 'list', 'add', 'trouble'].forEach(t => {
    document.getElementById(`inc-tab-${t}`)?.classList.remove('active');
    document.getElementById(`inc-subpage-${t}`)?.classList.remove('active');
  });
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`gh-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`gh-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { ghRefreshDashFilters(); ghRenderDashboard(); }
  if (tab === 'list') ghRenderList();
  if (tab === 'add' && !ghEditingId) ghClearForm();
}

// ===== Dashboard =====
const GH_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const GH_CHART_TICK = { color: '#3d4f6d', font: GH_CHART_FONT };
const GH_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const GH_CHART_COLORS = {
  month: { bg: 'rgba(67,97,238,0.85)', border: '#4361ee' },
  cost:  { bg: 'rgba(255,107,0,0.88)', border: '#ff6b00' },
  yard:  { bg: 'rgba(255,209,102,0.9)', border: '#e0a800' },
  shop:  { bg: 'rgba(6,214,160,0.88)', border: '#06d6a0' },
};
const GH_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function ghDestroyChart(id) {
  if (ghCharts[id]) { ghCharts[id].destroy(); delete ghCharts[id]; }
}

function ghBarChart(canvasId, key, labels, data, opts) {
  const { maxRotation = 0, isMoney = false, datasetLabel = 'จำนวนครั้ง' } = opts || {};
  ghDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    // ค่าใช้จ่ายบนกราฟไม่ต้องละเอียดถึงสตางค์ — ปัดเป็นจำนวนเต็มให้อ่านง่ายขึ้น
    formatter: v => v > 0 ? (isMoney ? formatMoneyRound(v) : v) : '',
  };
  ghCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: datasetLabel, data, backgroundColor: GH_CHART_COLORS[key].bg, borderColor: GH_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: GH_CHART_GRID, ticks: { ...GH_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...GH_CHART_TICK, autoSkip: false, minRotation: maxRotation, maxRotation } },
      },
    },
  });
  setChartTotal(canvasId, data, isMoney, true);
}

function ghDashFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">ทั้งหมด</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function ghRefreshDashFilters() {
  ghDashFillSelect('gh-dash-yard', mdYards);
  ghDashFillSelect('gh-dash-bu', mdBusinessUnits);
}

function ghRenderDashboard() {
  const month = document.getElementById('gh-dash-month')?.value || '';
  const yardFilter = document.getElementById('gh-dash-yard')?.value || '';
  const buFilter = document.getElementById('gh-dash-bu')?.value || '';
  const filtered = ghRecords.filter(r =>
    (!month || (r.inDate || '').startsWith(month)) &&
    (!yardFilter || r.yard === yardFilter) && (!buFilter || r.businessUnit === buFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  const monthCost = new Array(12).fill(0);
  filtered.forEach(r => {
    if (!r.inDate) return;
    const d = new Date(r.inDate);
    if (!isNaN(d) && d.getFullYear() === curYear) {
      monthCount[d.getMonth()]++;
      monthCost[d.getMonth()] += r.cost || 0;
    }
  });
  ghBarChart('gh-chart-month', 'month', GH_MONTH_LABELS_TH, monthCount);
  ghBarChart('gh-chart-cost', 'cost', GH_MONTH_LABELS_TH, monthCost, { isMoney: true, datasetLabel: 'ค่าใช้จ่าย (บาท)' });

  const countBy = field => {
    const map = {};
    filtered.forEach(r => { const v = r[field]; if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const yardSorted = countBy('yard');
  ghBarChart('gh-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), { maxRotation: 30 });

  const shopSorted = countBy('shop');
  ghBarChart('gh-chart-shop', 'shop', shopSorted.map(e => e[0]), shopSorted.map(e => e[1]), { maxRotation: 30 });
}

// ===== Lookup dropdowns =====
function ghFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function ghRefreshLookupDropdowns() {
  ghFillDatalist('gh-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  ghFillDatalist('gh-yard-list', mdYards);
  ghFillDatalist('gh-bu-list', mdBusinessUnits);
  ghDashFillSelect('gh-f-bu', mdBusinessUnits);
}

function ghCalcRepairDays() {
  const inDate = document.getElementById('gh-in').value;
  const outDate = document.getElementById('gh-out').value;
  const el = document.getElementById('gh-days');
  if (!inDate || !outDate) { el.value = ''; return; }
  const diff = Math.round((new Date(outDate) - new Date(inDate)) / 86400000);
  el.value = diff >= 0 ? diff + ' วัน' : '-';
}

// ===== Save / Edit / Delete =====
function ghSaveRecord() {
  const plate = document.getElementById('gh-plate').value.trim();
  const inDate = document.getElementById('gh-in').value;
  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  if (!inDate) { showToast('กรุณาระบุวันที่เข้าอู่', 'warning'); return; }

  const record = {
    plate,
    yard: document.getElementById('gh-yard').value.trim(),
    businessUnit: document.getElementById('gh-bu').value.trim(),
    inDate,
    outDate: document.getElementById('gh-out').value,
    shop: document.getElementById('gh-shop').value.trim(),
    reason: document.getElementById('gh-reason').value.trim(),
    cost: parseFloat(document.getElementById('gh-cost').value) || 0,
  };

  let savedRecord;
  if (ghEditingId) {
    const idx = ghRecords.findIndex(r => r.id === ghEditingId);
    if (idx >= 0) {
      ghRecords[idx] = { ...ghRecords[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = ghRecords[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    ghCancelEdit();
  } else {
    savedRecord = {
      id: 'GH_' + Date.now(),
      runningNo: ghNextRunningNo(),
      ...record,
      createdAt: new Date().toISOString(),
    };
    ghRecords.unshift(savedRecord);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    ghClearForm();
  }
  ghSave();
  ghPushOneIfReady(savedRecord);
  ghRenderList();
}

function ghClearForm() {
  ghEditingId = null;
  const banner = document.getElementById('gh-edit-banner');
  if (banner) banner.style.display = 'none';
  ['gh-plate', 'gh-yard', 'gh-bu', 'gh-shop', 'gh-in', 'gh-out', 'gh-days', 'gh-reason', 'gh-cost']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function ghEditRecord(id) {
  const rec = ghRecords.find(r => r.id === id);
  if (!rec) return;
  ghEditingId = id;
  document.getElementById('gh-edit-banner').style.display = 'flex';
  document.getElementById('gh-edit-no').textContent = rec.runningNo;
  document.getElementById('gh-plate').value = rec.plate || '';
  document.getElementById('gh-yard').value = rec.yard || '';
  document.getElementById('gh-bu').value = rec.businessUnit || '';
  document.getElementById('gh-shop').value = rec.shop || '';
  document.getElementById('gh-in').value = rec.inDate || '';
  document.getElementById('gh-out').value = rec.outDate || '';
  document.getElementById('gh-reason').value = rec.reason || '';
  document.getElementById('gh-cost').value = rec.cost || '';
  ghCalcRepairDays();
  ghSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ghCancelEdit() { ghClearForm(); }

function ghDeleteRecord(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  ghRecords = ghRecords.filter(r => r.id !== id);
  ghSave();
  ghRemoveOneIfReady(id);
  ghRenderList();
  showToast('ลบแล้ว', 'warning');
}

function ghDeleteAllRecords() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบประวัติการนำรถเข้าอู่ทั้งหมด ${ghRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  ghRecords = [];
  ghSave();
  ghPushIfReady();
  ghRenderList();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== List / Filter =====
function ghFilteredList() {
  const bu = document.getElementById('gh-f-bu')?.value || '';
  const search = (document.getElementById('gh-f-search')?.value || '').toLowerCase().trim();
  const list = ghRecords.filter(r => {
    if (bu && r.businessUnit !== bu) return false;
    if (search && !(`${r.plate} ${r.yard} ${r.shop} ${r.reason}`.toLowerCase().includes(search))) return false;
    return true;
  });
  if (!ghSortField) return list.sort((a, b) => new Date(b.inDate || 0) - new Date(a.inDate || 0));
  return list.sort((a, b) => ghCompareValues(a, b, ghSortField) * ghSortDir);
}

function ghRepairDaysValue(r) {
  if (!r.inDate || !r.outDate) return -1;
  const diff = Math.round((new Date(r.outDate) - new Date(r.inDate)) / 86400000);
  return diff >= 0 ? diff : -1;
}

function ghCompareValues(a, b, field) {
  if (field === 'repairDays') return ghRepairDaysValue(a) - ghRepairDaysValue(b);
  const av = a[field], bv = b[field];
  if (GH_NUMERIC_FIELDS.includes(field)) return (av || 0) - (bv || 0);
  if (GH_DATE_FIELDS.includes(field)) return new Date(av || 0) - new Date(bv || 0);
  return String(av || '').localeCompare(String(bv || ''), 'th');
}

function ghSortBy(field) {
  if (ghSortField === field) ghSortDir *= -1;
  else { ghSortField = field; ghSortDir = 1; }
  ghRenderList();
}

function ghUpdateSortIndicators() {
  document.querySelectorAll('.gh-sort-ind').forEach(el => { el.textContent = ''; });
  if (!ghSortField) return;
  const ind = document.getElementById(`gh-sort-ind-${ghSortField}`);
  if (ind) ind.textContent = ghSortDir === 1 ? '▲' : '▼';
}

function ghClearListFilters() {
  ['gh-f-bu', 'gh-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ghRenderList();
}

function ghRepairDaysLabel(r) {
  if (!r.inDate || !r.outDate) return '-';
  const diff = Math.round((new Date(r.outDate) - new Date(r.inDate)) / 86400000);
  return diff >= 0 ? diff + ' วัน' : '-';
}

function ghRenderList() {
  const list = ghFilteredList();
  const tbody = document.getElementById('gh-list-body');
  const countEl = document.getElementById('gh-list-count');
  if (!tbody) return;
  ghUpdateSortIndicators();
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td>${escapeHtml(r.shop || '-')}</td>
      <td>${r.inDate ? formatDate(r.inDate) : '-'}</td>
      <td>${r.outDate ? formatDate(r.outDate) : '-'}</td>
      <td>${ghRepairDaysLabel(r)}</td>
      <td>${escapeHtml(r.reason || '-')}</td>
      <td>${formatMoney(r.cost || 0)}</td>
      <td>
        <button class="action-btn action-view" onclick="ghEditRecord('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="ghDeleteRecord('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Template / Export / Import (นำเข้าซ้ำ = แก้ไข จับคู่ด้วย "ลำดับที่") =====
function ghDownloadTemplate() {
  const sample = [
    GH_XLSX_HEADERS,
    ['', '70-1234', 'ABC', 'Trailer', 'อู่ช่างสมชาย', '15/01/2026', '20/01/2026', 'เปลี่ยนกันชนหน้า', '3500'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = GH_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_ประวัติการนำรถเข้าอู่.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function ghExportExcel() {
  if (!ghRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [GH_XLSX_HEADERS, ...ghRecords.map(r => [
    r.runningNo, r.plate || '', r.yard || '', r.businessUnit || '', r.shop || '', formatDMY(r.inDate), formatDMY(r.outDate), r.reason || '', r.cost || 0,
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = GH_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ประวัติเข้าอู่');
  XLSX.writeFile(wb, 'ประวัติการนำรถเข้าอู่_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function ghImportExcel(evt) {
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
          yard: String(row[2] || '').trim(),
          businessUnit: String(row[3] || '').trim(),
          shop: String(row[4] || '').trim(),
          inDate: normalizeImportDate(row[5]),
          outDate: normalizeImportDate(row[6]),
          reason: String(row[7] || '').trim(),
          cost: parseFloat(row[8]) || 0,
        };
        // จับคู่ด้วย "ลำดับที่" (คอลัมน์แรก) — ถ้ามีเลขนี้อยู่แล้วให้แก้ไขรายการเดิมแทนการเพิ่มซ้ำ
        const rowNo = parseInt(row[0]);
        const existingIdx = rowNo ? ghRecords.findIndex(r => r.runningNo === rowNo) : -1;
        if (existingIdx >= 0) {
          ghRecords[existingIdx] = { ...ghRecords[existingIdx], ...data, updatedAt: now };
          updated++;
        } else {
          ghRecords.push({
            id: 'GH_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            runningNo: ghNextRunningNo(),
            ...data,
            createdAt: now,
          });
          added++;
        }
      });
      ghSave(); ghPushIfReady(); ghRenderList();
      const msg = [updated ? `แก้ไข ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function ghRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function ghObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function ghApplyServer(serverRecords) {
  ghRecords = serverRecords;
  ghSave();
  ghRenderList();
  if (document.getElementById('gh-subpage-dashboard')?.classList.contains('active')) ghRenderDashboard();
}
async function ghWriteFB() {
  if (!ghRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ghRef, ghRecordsToObj(ghRecords));
  } catch (e) { console.warn('ghWriteFB error', e); notifySyncWriteError(); }
}
function ghPushIfReady() { if (ghReady) ghWriteFB(); }

async function ghWriteOne(record) {
  if (!ghRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/garageHistory/${record.id}`), record);
  } catch (e) { console.warn('ghWriteOne error', e); notifySyncWriteError(); }
}
function ghPushOneIfReady(record) { if (ghReady) ghWriteOne(record); }

async function ghRemoveOne(id) {
  if (!ghRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/garageHistory/${id}`));
  } catch (e) { console.warn('ghRemoveOne error', e); notifySyncWriteError(); }
}
function ghRemoveOneIfReady(id) { if (ghReady) ghRemoveOne(id); }

async function ghInit() {
  await incWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    ghRef = ref(fbDb, '/garageHistory');
    const snap = await get(ghRef);
    if (snap.exists()) ghApplyServer(ghObjToRecords(snap.val()));
    ghReady = true;
    if (!snap.exists() && ghRecords.length > 0) await ghWriteFB();
    onValue(ghRef, s => { if (s.exists()) ghApplyServer(ghObjToRecords(s.val())); });
  } catch (e) { console.warn('ghInit error', e); notifySyncLoadError(); }
}

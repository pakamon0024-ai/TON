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

// Duedate = Date + 5 วัน (คำนวณเสมอจาก Date ไม่ใช้ค่าที่กรอก/เก็บไว้)
const DTK_DUE_DAYS = 5;
function dtkDueOf(rec) {
  if (!rec || !rec.date) return '';
  const d = new Date(rec.date + 'T00:00:00Z');
  if (isNaN(d)) return '';
  d.setUTCDate(d.getUTCDate() + DTK_DUE_DAYS);
  return d.toISOString().slice(0, 10);
}

// จำนวนวันที่เกินกำหนด: นับจาก Duedate (Date+5) ถึงวันที่ส่ง (ถ้ายังไม่ส่งนับถึงวันนี้) — ไม่เกินกำหนดให้เป็น 0
function dtkOverdueDays(rec) {
  const due = dtkDueOf(rec);
  if (!due) return 0;
  const end = rec.sendDate || dtkTodayStr();
  const diff = Math.round((new Date(end + 'T00:00:00Z') - new Date(due + 'T00:00:00Z')) / 86400000);
  return diff > 0 ? diff : 0;
}

function dtkUpdateDueField() {
  document.getElementById('dtk-due').value = dtkDueOf({ date: document.getElementById('dtk-date').value });
}

// ===== Sub-tabs =====
function dtkSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`dtk-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`dtk-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { dtkRefreshDashFilters(); dtkRenderDashboard(); }
  if (tab === 'list') dtkRenderList();
  if (tab === 'add' && !dtkEditingId) dtkClearForm();
}

function dtkOnPageShown() {
  dtkRefreshLookupDropdowns();
  dtkRenderList();
  if (document.getElementById('dtk-subpage-dashboard')?.classList.contains('active')) {
    dtkRefreshDashFilters();
    dtkRenderDashboard();
  }
}

// ===== Dashboard =====
const DTK_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const DTK_CHART_TICK = { color: '#3d4f6d', font: DTK_CHART_FONT };
const DTK_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const DTK_CHART_COLORS = {
  month:   { bg: 'rgba(67,97,238,0.85)', border: '#4361ee' },
  status:  { bg: ['rgba(6,214,160,0.88)', 'rgba(255,170,0,0.88)', 'rgba(239,71,111,0.88)'], border: '#fff' },
  yard:    { bg: 'rgba(6,214,160,0.88)', border: '#06d6a0' },
  project: { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
  detail:  { bg: 'rgba(255,107,0,0.88)', border: '#ff6b00' },
  owner:   { bg: 'rgba(239,71,111,0.85)', border: '#ef476f' },
};
const DTK_MONTH_LABELS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
let dtkCharts = {};

function dtkDestroyChart(id) {
  if (dtkCharts[id]) { dtkCharts[id].destroy(); delete dtkCharts[id]; }
}

function dtkBarChart(canvasId, key, labels, data, maxRotation) {
  dtkDestroyChart(key);
  const dl = {
    display: true, anchor: 'end', align: 'end', color: '#1a2540',
    font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' },
    formatter: v => v > 0 ? v : '',
  };
  dtkCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนรายการ', data, backgroundColor: DTK_CHART_COLORS[key].bg, borderColor: DTK_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: dl },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: DTK_CHART_GRID, ticks: { ...DTK_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...DTK_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
  setChartTotal(canvasId, data);
}

function dtkRefreshDashFilters() {
  dtkFillSelect('dtk-dash-yard', mdYards);
  dtkFillSelect('dtk-dash-project', mdBusinessUnits);
}

function dtkRenderDashboard() {
  const month = document.getElementById('dtk-dash-month')?.value || '';
  const yardFilter = document.getElementById('dtk-dash-yard')?.value || '';
  const projectFilter = document.getElementById('dtk-dash-project')?.value || '';
  const filtered = docTracks.filter(i =>
    (!month || (i.date || '').startsWith(month)) &&
    (!yardFilter || i.yard === yardFilter) && (!projectFilter || i.project === projectFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  filtered.forEach(i => {
    if (!i.date) return;
    const d = new Date(i.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  dtkBarChart('dtk-chart-month', 'month', DTK_MONTH_LABELS_TH, monthCount);

  const sent = filtered.filter(i => i.sendDate).length;
  const late = filtered.filter(i => !i.sendDate && dtkOverdueDays(i) > 0).length;
  const pending = filtered.length - sent - late;
  dtkBarChart('dtk-chart-status', 'status', ['ส่งแล้ว', 'ยังไม่ส่ง (ไม่เกินกำหนด)', 'ยังไม่ส่งและเกินกำหนด'], [sent, pending, late]);

  const countBy = field => {
    const map = {};
    filtered.forEach(i => { const v = (i[field] || '').trim(); if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };
  ['yard', 'project', 'detail', 'owner'].forEach(key => {
    const sorted = countBy(key);
    dtkBarChart(`dtk-chart-${key}`, key, sorted.map(e => e[0]), sorted.map(e => e[1]), 30);
  });
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
  dtkFillSelect('dtk-f-detail', uniq('detail').sort((a, b) => a.localeCompare(b, 'th')));
}

// ===== Save / Edit / Delete =====
function dtkSaveCase() {
  const date = document.getElementById('dtk-date').value;
  const detail = document.getElementById('dtk-detail').value.trim();
  const name = document.getElementById('dtk-name').value.trim();
  const dueDate = dtkDueOf({ date });

  if (!date) { showToast('กรุณาระบุวันที่ (Date)', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียด (Detail)', 'warning'); return; }
  if (!name) { showToast('กรุณาระบุชื่อ (Name)', 'warning'); return; }

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
  dtkUpdateDueField();
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
  const detailF = (document.getElementById('dtk-f-detail')?.value || '').trim();
  const search = (document.getElementById('dtk-f-search')?.value || '').toLowerCase().trim();
  const sortDir = document.getElementById('dtk-f-sort')?.value || 'asc';
  const filtered = docTracks.filter(i => {
    if (yard && i.yard !== yard) return false;
    if (detailF && (i.detail || '').trim() !== detailF) return false;
    // "ยังไม่ส่ง" = ยังไม่มีวันที่ส่งทั้งหมด (รวมที่เกินกำหนด) · "เกินกำหนด" = ยังไม่ส่งและเกินกำหนดแล้ว
    if (status === 'pending' && i.sendDate) return false;
    if (status === 'sent' && !i.sendDate) return false;
    if (status === 'overdue' && !(dtkOverdueDays(i) > 0 && !i.sendDate)) return false;
    if (search && !(`${i.detail} ${i.empId} ${i.name} ${i.project} ${i.owner} ${i.note}`.toLowerCase().includes(search))) return false;
    return true;
  });
  // เรียงตามวันที่ (Date) — น้อยไปมาก / มากไปน้อย (ใช้ทั้งรายการและภาพรายงาน)
  const dir = sortDir === 'desc' ? -1 : 1;
  return filtered.slice().sort((a, b) => dir * String(a.date || '').localeCompare(String(b.date || '')));
}

function dtkClearListFilters() {
  ['dtk-f-yard', 'dtk-f-detail', 'dtk-f-status', 'dtk-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  const s = document.getElementById('dtk-f-sort'); if (s) s.value = 'asc';
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
      <td class="dtk-due">${formatDate(dtkDueOf(i))}</td>
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

// ===== บันทึกภาพรายงาน (ส่งกลุ่มไลน์) — ใช้ #dtk-report-container นอกจอ ตามตัวกรองที่เลือกในหน้ารายการ =====
function dtkReportTitle() {
  const status = document.getElementById('dtk-f-status')?.value || '';
  const yard = document.getElementById('dtk-f-yard')?.value || '';
  let title = 'รายงานติดตามเอกสาร';
  if (status === 'pending') title += ' (ยังไม่ส่ง)';
  else if (status === 'overdue') title += ' (เกินกำหนด)';
  else if (status === 'sent') title += ' (ส่งแล้ว)';
  if (yard) title += ' ลาน ' + yard;
  const detailF = document.getElementById('dtk-f-detail')?.value || '';
  if (detailF) title += ' · ' + detailF;
  return title;
}

async function dtkSaveReportImage() {
  const rpt = document.getElementById('dtk-report-container');
  const tbody = document.getElementById('dtk-report-body');
  if (!rpt || !tbody) return;

  const list = dtkFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้บันทึกภาพ', 'warning'); return; }
  // จำกัดจำนวนแถวกันเบราว์เซอร์ค้าง/ภาพใหญ่เกินไป
  if (list.length > 300) { showToast(`มีข้อมูลตรงตัวกรอง ${list.length} รายการ เยอะเกินจะทำภาพเดียว — กรุณากรองให้แคบลงก่อน`, 'warning'); return; }

  const now = new Date();
  const PAGE = 25; // ตัดภาพทุก 25 รายการ
  const pages = Math.ceil(list.length / PAGE);
  const baseTitle = dtkReportTitle();
  const savedScroll = window.scrollY;
  let ok = true;

  for (let p = 0; p < pages; p++) {
    const start = p * PAGE;
    const part = list.slice(start, start + PAGE);
    document.getElementById('dtk-rpt-title').textContent = pages > 1 ? `${baseTitle} (ภาพที่ ${p + 1}/${pages})` : baseTitle;
    document.getElementById('dtk-rpt-date-text').textContent = 'จัดทำ: ' + now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    document.getElementById('dtk-rpt-total-count').textContent = list.length;
    tbody.innerHTML = part.map((i, k) => {
      const idx = start + k;
      const days = dtkOverdueDays(i);
      const late = days > 0 && !i.sendDate;
      return `
    <tr class="${late ? 'dtk-row-late' : ''}">
      <td>${idx + 1}</td>
      <td>${formatDate(i.date)}</td>
      <td class="dtk-left">${escapeHtml(i.detail)}</td>
      <td class="dtk-left">${escapeHtml(i.name)}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.project || '-')}</td>
      <td class="dtk-due">${formatDate(dtkDueOf(i))}</td>
      <td class="dtk-send">${i.sendDate ? formatDate(i.sendDate) : ''}</td>
      <td class="dtk-days">${days > 0 ? days : '-'}</td>
      <td>${escapeHtml(i.owner || '-')}</td>
      <td class="dtk-note">${escapeHtml(i.note || '-')}</td>
    </tr>`;
    }).join('');

    rpt.style.height = 'auto';
    rpt.style.left = '0';
    await new Promise(r => setTimeout(r, 60));
    const captureH = rpt.offsetHeight;
    rpt.style.height = captureH + 'px';
    await new Promise(r => setTimeout(r, 60));
    window.scrollTo(0, 0);
    await new Promise(r => setTimeout(r, 60));

    try {
      const canvas = await html2canvas(rpt, { width: rpt.offsetWidth, height: captureH, scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
      const link = document.createElement('a');
      link.download = 'รายงานติดตามเอกสาร_' + now.toISOString().slice(0, 10) + (pages > 1 ? `_${p + 1}-${pages}` : '') + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      ok = false;
      showToast('สร้างภาพรายงานไม่ได้: ' + e.message, 'error');
      break;
    }
    if (p < pages - 1) await new Promise(r => setTimeout(r, 400)); // เว้นช่วงให้เบราว์เซอร์รับหลายไฟล์ดาวน์โหลด
  }
  if (ok) showToast(pages > 1 ? `บันทึกภาพรายงานเรียบร้อย ${pages} ภาพ` : 'บันทึกภาพรายงานเรียบร้อย', 'success');

  window.scrollTo(0, savedScroll);
  rpt.style.left = '-3000px';
}

// ===== Excel Export =====
function dtkExportExcel() {
  if (!docTracks.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [DTK_XLSX_HEADERS, ...docTracks.map(i => [
    formatDMY(i.date), i.detail||'', i.empId||'', i.name||'', i.yard||'', i.project||'',
    formatDMY(dtkDueOf(i)), formatDMY(i.sendDate), dtkOverdueDays(i), i.owner||'', i.note||''
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [12, 22, 10, 24, 10, 12, 12, 12, 14, 16, 24].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ติดตามเอกสาร');
  XLSX.writeFile(wb, 'ติดตามเอกสาร_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// Template ใช้หัวคอลัมน์เดียวกับ Export (ไฟล์ที่ Export ออกไปแก้แล้ว Import กลับได้) — คอลัมน์ Duedate (Date+5 วัน) และ "เอกสารเกินกำหนด (วัน)" ระบบคำนวณเอง ไม่อ่านค่าตอน Import
function dtkDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    DTK_XLSX_HEADERS,
    ['20/04/2026', 'Trouble Report', '-', 'สมชาย ใจดี', 'APC', 'Trailer', '25/04/2026 (คำนวณอัตโนมัติ)', '', '(คำนวณอัตโนมัติ)', 'ชื่อผู้รับผิดชอบ', 'อุบัติเหตุ'],
  ]);
  ws['!cols'] = [12, 22, 10, 24, 10, 12, 12, 12, 14, 16, 24].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_ติดตามเอกสาร.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function dtkImportExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      let added = 0, skipped = 0;
      rows.slice(1).forEach(row => {
        const date = normalizeImportDate(row[0]);
        const detail = String(row[1] || '').trim();
        const name = String(row[3] || '').trim();
        if (!date && !detail && !name) return;
        if (!date || !detail || !name) { skipped++; return; }
        docTracks.push({
          id: 'DTK_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          date, detail, name, dueDate: dtkDueOf({ date }),
          empId: String(row[2] || '').trim(),
          yard: String(row[4] || '').trim(),
          project: String(row[5] || '').trim(),
          sendDate: normalizeImportDate(row[7]),
          owner: String(row[9] || '').trim(),
          note: String(row[10] || '').trim(),
          createdAt: new Date().toISOString(),
        });
        added++;
      });
      dtkSave(); dtkPushIfReady(); dtkRefreshLookupDropdowns(); dtkRenderList();
      showToast(`นำเข้า ${added} รายการ` + (skipped ? ` (ข้าม ${skipped} แถวที่ข้อมูลไม่ครบ)` : ''), skipped ? 'warning' : 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function dtkRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
// ลบแล้วกลับมาอีก: เครื่องอื่นที่ยังมีรายการเก่าอยู่ในเครื่องจะ sync ขึ้นไปใหม่ -> ใช้ "ป้ายลบ" ที่ /docTracking/_deleted/<id>
// (ฟังก์ชัน gsSplit / gsMerge / gsWriteMany / gsDeleteMany อยู่ใน gpscctv.js ใช้ร่วมกัน)
// เก็บบันทึกที่ server ยังไม่มีไว้ ไม่ให้ถูก apply ทับจนหาย แต่รายการที่ถูกลบแล้ว (มีป้ายลบ) จะไม่ถูกส่งกลับขึ้นไปอีก
// เวลาสร้าง/แก้ไขล่าสุดของรายการ (ms) — ใช้ตัดสินว่ารายการที่ server ไม่มี "เพิ่งสร้างในเครื่องนี้ยังไม่ได้ส่งขึ้น" หรือ "ถูกลบจากเครื่องอื่นไปแล้ว"
function dtkRecTs(r) {
  const t = Date.parse(r.updatedAt || r.createdAt || '');
  if (!isNaN(t)) return t;
  const m = String(r.id || '').match(/(d{12,})/);
  return m ? Number(m[1]) : 0;
}
const DTK_LASTSYNC_KEY = 'finflow_dtk_lastsync';
function dtkApplyServer(serverList, deleted) {
  deleted = deleted || new Set();
  // รายการในเครื่องที่ server ไม่มี: ถ้าสร้าง/แก้หลังซิงค์ครั้งล่าสุด = ยังไม่ได้ส่งขึ้น ให้เก็บ+ส่ง ; ถ้าเก่ากว่า = เครื่องอื่นลบไปแล้ว ให้ทิ้ง
  // (ไม่พึ่งป้ายลบอย่างเดียว เพราะถ้าป้ายลบเขียนไม่ได้ รายการที่ค้างในเครื่องอื่นจะถูกส่งกลับขึ้นไปจนลบไม่ออก)
  let last = 0;
  try { last = Number(localStorage.getItem(DTK_LASTSYNC_KEY) || 0); } catch (e) {}
  const cutoff = last || (Date.now() - 10 * 60 * 1000);
  const serverIds = new Set(serverList.map(r => r.id));
  const localOnly = (docTracks || []).filter(t => t && t.id && !serverIds.has(t.id) && !deleted.has(t.id) && dtkRecTs(t) > cutoff);
  docTracks = serverList.concat(localOnly);
  console.log('[dtk] apply server', { server: serverList.length, tombstones: deleted.size, lastSync: last, localOnlyKept: localOnly.map(r => r.id) });
  if (localOnly.length > 0) showToast(`⚠️ เครื่องนี้ส่งรายการที่ server ไม่มี กลับขึ้นไป ${localOnly.length} รายการ (${localOnly.map(r => r.detail).join(', ')})`, 'warning');
  if (localOnly.length === 0) { try { localStorage.setItem(DTK_LASTSYNC_KEY, String(Date.now())); } catch (e) {} }
  dtkSave();
  dtkRefreshLookupDropdowns();
  dtkRenderList();
  if (document.getElementById('dtk-subpage-dashboard')?.classList.contains('active')) dtkRenderDashboard();
  if (localOnly.length > 0) gsWriteMany('/docTracking', localOnly);
}
async function dtkWriteFB() {
  if (!dtkRef) return;
  await gsWriteMany('/docTracking', docTracks);
}

async function dtkWriteOne(record) {
  if (!dtkRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/docTracking/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('dtkWriteOne error', e); notifySyncWriteError(e.message); }
}
function dtkPushIfReady() { if (dtkReady) dtkWriteFB(); }
function dtkPushOneIfReady(record) { if (dtkReady) dtkWriteOne(record); }

// ลบบน Firebase ทีละขั้น: ลบรายการ (รวมคีย์ที่ไม่ตรงกับ id ถ้ามี) -> วางป้ายลบ (ถ้าวางไม่ได้ก็ไม่ทำให้การลบล้มเหลว) -> อ่านกลับมาตรวจ
// แล้วแจ้งผลจริงให้ผู้ใช้เห็น ไม่ใช่แค่ "ซิงค์สำเร็จ"
async function dtkRemoveOne(id) {
  if (!dtkRef) { showToast('ลบในเครื่องนี้แล้ว แต่ยังไม่ได้เชื่อมต่อ Firebase (ยังไม่ลบบนเซิร์ฟเวอร์)', 'warning'); return false; }
  try {
    const { ref, get, remove, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const keys = new Set([id]);
    const before = await get(dtkRef);
    if (before.exists()) {
      const v = before.val() || {};
      Object.keys(v).forEach(k => { if (k !== '_deleted' && v[k] && typeof v[k] === 'object' && v[k].id === id) keys.add(k); });
    }
    console.log('[dtk] delete', id, 'keys on server:', [...keys]);
    await Promise.all([...keys].map(k => remove(ref(fbDb, `/docTracking/${k}`))));
    try { await set(ref(fbDb, `/docTracking/_deleted/${id}`), new Date().toISOString()); }
    catch (e) { console.warn('dtk tombstone error', e); }
    const after = await get(dtkRef);
    const left = after.exists() ? Object.entries(after.val() || {}).filter(([k, r]) => k !== '_deleted' && r && (k === id || r.id === id)).length : 0;
    if (left > 0) { showToast('ลบบนเซิร์ฟเวอร์ไม่สำเร็จ — รายการยังอยู่ (ตรวจสอบสิทธิ์ลบของ Firebase rules)', 'error'); return false; }
    console.log('[dtk] delete verified gone from server', id);
    notifySyncWriteSuccess();
    return true;
  } catch (e) {
    console.warn('dtkRemoveOne error', e);
    showToast('ลบบนเซิร์ฟเวอร์ไม่สำเร็จ: ' + (e && e.message ? e.message : e), 'error');
    notifySyncWriteError(e.message);
    return false;
  }
}
function dtkRemoveOneIfReady(id) { return dtkRemoveOne(id); }

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
    if (snap.exists()) { const p = gsSplit(snap.val()); dtkApplyServer(p.records, p.deleted); }
    dtkReady = true;
    if (!snap.exists() && docTracks.length > 0) await dtkWriteFB();
    onValue(dtkRef, s => { if (s.exists()) { const p = gsSplit(s.val()); dtkApplyServer(p.records, p.deleted); } else dtkApplyServer([], new Set()); });
  } catch (e) { console.warn('dtkInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  dtkRefreshLookupDropdowns();
  dtkClearForm();
  dtkRenderList();
  dtkInit();
});

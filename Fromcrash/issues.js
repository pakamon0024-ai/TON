// ===== ระบบบันทึกปัญหาการทำงาน =====
// เก็บ local ที่ localStorage key 'finflow_work_issues' และ sync กับ Firebase ที่ /workIssues

let workIssues = JSON.parse(localStorage.getItem('finflow_work_issues') || '[]');
let wiEditingId = null;
let wiRef = null;
let wiReady = false;
let wiCharts = {};

const WI_XLSX_HEADERS = ['เลขที่','วันที่','หัวข้อปัญหา','ชื่อพนักงาน','ทะเบียน','หน่วยงาน','ลานจอด','รายละเอียด'];

function wiSave() { safeLocalStorageSet('finflow_work_issues', JSON.stringify(workIssues)); }

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
  const month = document.getElementById('wi-dash-month')?.value || '';
  const yardFilter = document.getElementById('wi-dash-yard')?.value || '';
  const buFilter = document.getElementById('wi-dash-bu')?.value || '';
  const filtered = workIssues.filter(i =>
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

// ===== รูปแนบ (1 รูปต่อรายการ) =====
// รูปเก็บแยกที่ /recordPhotos/issues/<id> (ดู photos.js) ตัวบันทึกมีแค่ hasPhoto
let wiPhotoData = '';
let wiPhotoDirty = false; // true = ผู้ใช้เลือกรูปใหม่/ลบรูปในฟอร์มนี้ ต้องเขียนลง Firebase ตอนบันทึก

function wiRenderPhotoPreview() {
  const box = document.getElementById('wi-photo-preview');
  if (!box) return;
  box.innerHTML = wiPhotoData
    ? `<img src="${wiPhotoData}" alt="รูปแนบ" style="max-height:140px;max-width:100%;border-radius:8px;border:1px solid var(--border);cursor:zoom-in;" onclick="photoShow(this.src)" />
       <button type="button" class="btn-secondary" onclick="wiRemovePhoto()">✕ ลบรูป</button>`
    : '';
}

async function wiPhotoSelected(evt) {
  const file = evt.target.files[0];
  evt.target.value = '';
  if (!file) return;
  if (!file.type.startsWith('image/')) { showToast('กรุณาเลือกไฟล์รูปภาพ', 'warning'); return; }
  try {
    wiPhotoData = await photoCompress(file);
    wiPhotoDirty = true;
    wiRenderPhotoPreview();
  } catch (e) { showToast(e.message, 'error'); }
}

function wiRemovePhoto() { wiPhotoData = ''; wiPhotoDirty = true; wiRenderPhotoPreview(); }

function wiViewPhoto(id) { photoViewOf('issues', workIssues.find(i => i.id === id)); }

// ===== Running number =====
function wiNextRunningNo() {
  return workIssues.length ? Math.max(...workIssues.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
async function wiSaveCase() {
  const date = document.getElementById('wi-date').value;
  const topic = document.getElementById('wi-topic').value.trim();
  const detail = document.getElementById('wi-detail').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!topic) { showToast('กรุณาเลือกหัวข้อปัญหา', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียดปัญหา', 'warning'); return; }

  // เขียนรูปลง Firebase ก่อนบันทึกรายการ ถ้าเขียนไม่สำเร็จให้หยุด (ไม่ทิ้งรายการที่อ้างรูปที่ไม่มีอยู่จริง)
  const photoData = wiPhotoData, photoDirty = wiPhotoDirty;
  const recId = wiEditingId || ('WI_' + Date.now());
  if (photoDirty && photoData) {
    if (!(await photoPut('issues', recId, photoData))) {
      showToast(photoFailMessage(), 'error');
      return;
    }
  } else if (photoDirty) {
    photoDelete('issues', recId);
  }

  const record = {
    date, topic,
    driverName: document.getElementById('wi-driver').value,
    plate: document.getElementById('wi-plate').value,
    businessUnit: document.getElementById('wi-bu').value,
    yard: document.getElementById('wi-yard').value,
    detail,
  };
  if (photoDirty) { record.photo = ''; record.hasPhoto = !!photoData; }

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
    record.id = recId;
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
  wiPhotoData = ''; wiPhotoDirty = false;
  wiRenderPhotoPreview();
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
  wiPhotoData = rec.photo || '';
  wiPhotoDirty = false;
  wiRenderPhotoPreview();
  if (!wiPhotoData && rec.hasPhoto) {
    photoFetch('issues', rec.id).then(d => { if (wiEditingId === rec.id && !wiPhotoDirty) { wiPhotoData = d; wiRenderPhotoPreview(); } });
  }
  wiSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wiCancelEdit() { wiClearForm(); }

function wiDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  const delRec = workIssues.find(i => i.id === id);
  if (delRec && delRec.hasPhoto) photoDelete('issues', id);
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
  const dateFrom = document.getElementById('wi-f-from')?.value || '';
  const dateTo = document.getElementById('wi-f-to')?.value || '';
  const search = (document.getElementById('wi-f-search')?.value || '').toLowerCase().trim();
  return workIssues.filter(i => {
    if (topic && i.topic !== topic) return false;
    if (yard && i.yard !== yard) return false;
    if (dateFrom && (i.date || '') < dateFrom) return false;
    if (dateTo && (i.date || '') > dateTo) return false;
    if (search && !(`${i.topic} ${i.driverName} ${i.plate} ${i.businessUnit} ${i.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function wiClearListFilters() {
  ['wi-f-topic', 'wi-f-yard', 'wi-f-from', 'wi-f-to', 'wi-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  wiRenderList();
}

function wiRenderList() {
  const list = wiFilteredList();
  const tbody = document.getElementById('wi-list-body');
  const countEl = document.getElementById('wi-list-count');
  const pagerEl = document.getElementById('wi-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('wi-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('wi-list', page, totalPages, total, 'wiRenderList');
  tbody.innerHTML = pageItems.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.topic)}</td>
      <td>${escapeHtml(i.driverName || '-')}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>${(i.photo || i.hasPhoto) ? `<button class="action-btn action-view" onclick="wiViewPhoto('${i.id}')">📷 ดู</button>` : '-'}</td>
      <td>
        <button class="action-btn action-view" onclick="wiEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="wiDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== บันทึกภาพรายงาน (ส่งกลุ่มไลน์) — ใช้ #wi-report-container นอกจอ ตามตัวกรองที่เลือกในหน้ารายการ =====
function wiReportTitle() {
  const topic = document.getElementById('wi-f-topic')?.value || '';
  const yard = document.getElementById('wi-f-yard')?.value || '';
  let title = 'รายงานปัญหาการทำงาน';
  if (topic) title += ' หัวข้อ ' + topic;
  if (yard) title += ' ลาน ' + yard;
  const from = document.getElementById('wi-f-from')?.value || '';
  const to = document.getElementById('wi-f-to')?.value || '';
  if (from && to) title += ` ${formatDate(from)} - ${formatDate(to)}`;
  else if (from) title += ` ตั้งแต่ ${formatDate(from)}`;
  else if (to) title += ` ถึง ${formatDate(to)}`;
  return title;
}

async function wiSaveReportImage() {
  const rpt = document.getElementById('wi-report-container');
  const tbody = document.getElementById('wi-report-body');
  if (!rpt || !tbody) return;

  const list = wiFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้บันทึกภาพ', 'warning'); return; }
  // รูปแนบทำให้ภาพสูงขึ้นมาก จำกัดจำนวนแถวกันเบราว์เซอร์ค้าง/ภาพใหญ่เกินไป
  if (list.length > 40) { showToast(`มีข้อมูลตรงตัวกรอง ${list.length} รายการ เยอะเกินจะทำภาพเดียว — กรุณากรองให้แคบลงก่อน (ไม่เกิน 40 รายการ)`, 'warning'); return; }

  const photos = {};
  await Promise.all(list.map(async i => { photos[i.id] = await photoOf('issues', i); }));

  const now = new Date();
  document.getElementById('wi-rpt-title').textContent = wiReportTitle();
  document.getElementById('wi-rpt-date-text').textContent = 'จัดทำ: ' + now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('wi-rpt-total-count').textContent = list.length;
  tbody.innerHTML = list.map((i, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${formatDate(i.date)}</td>
      <td class="wi-left">${escapeHtml(i.topic || '-')}</td>
      <td class="wi-left">${escapeHtml(i.driverName || '-')}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.businessUnit || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td class="wi-detail">${escapeHtml(i.detail || '-')}</td>
      <td class="wi-photo">${photos[i.id] ? `<img src="${photos[i.id]}" alt="" />` : '-'}</td>
    </tr>
  `).join('');

  rpt.style.height = 'auto';
  rpt.style.left = '0';
  await new Promise(r => setTimeout(r, 120));
  const captureH = rpt.offsetHeight;
  rpt.style.height = captureH + 'px';
  await new Promise(r => setTimeout(r, 60));

  const savedScroll = window.scrollY;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 60));

  try {
    const canvas = await html2canvas(rpt, { width: rpt.offsetWidth, height: captureH, scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const link = document.createElement('a');
    link.download = 'รายงานปัญหาการทำงาน_' + now.toISOString().slice(0, 10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('บันทึกภาพรายงานเรียบร้อย', 'success');
  } catch (e) {
    showToast('สร้างภาพรายงานไม่ได้: ' + e.message, 'error');
  }

  window.scrollTo(0, savedScroll);
  rpt.style.left = '-3000px';
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
// ถ้าเครื่องนี้มีบันทึกที่ server ยังไม่มี (เช่น กดบันทึกไปตอนยังเชื่อมต่อ Firebase ไม่ทัน ทำให้ push ไม่สำเร็จ)
// ต้องเก็บไว้ ไม่ใช่ปล่อยให้ apply ทับข้อมูลเครื่องนี้จนหายไปเงียบๆ แล้ว sync กลับขึ้น server ทันที
function wiApplyServer(serverIssues) {
  const serverIds = new Set(serverIssues.map(r => r.id));
  const localOnly = (workIssues || []).filter(t => t && t.id && !serverIds.has(t.id));
  workIssues = serverIssues.concat(localOnly);
  wiSave();
  wiRenderList();
  if (document.getElementById('wi-subpage-dashboard')?.classList.contains('active')) wiRenderDashboard();
  if (localOnly.length > 0) wiWriteFB();
}
async function wiWriteFB() {
  if (!wiRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(wiRef, wiRecordsToObj(workIssues));
  } catch (e) { console.warn('wiWriteFB error', e); notifySyncWriteError(e.message); }
}
function wiPushIfReady() { if (wiReady) wiWriteFB(); }

async function wiWriteOne(record) {
  if (!wiRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/workIssues/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('wiWriteOne error', e); notifySyncWriteError(e.message); }
}
function wiPushOneIfReady(record) { if (wiReady) wiWriteOne(record); }

async function wiRemoveOne(id) {
  if (!wiRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/workIssues/${id}`));
  } catch (e) { console.warn('wiRemoveOne error', e); notifySyncWriteError(e.message); }
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
  } catch (e) { console.warn('wiInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  wiRefreshLookupDropdowns();
  wiClearForm();
  wiRenderList();
  wiInit();
});

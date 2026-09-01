// ===== ระบบบันทึกใบคุมประพฤติ =====
// เก็บ local ที่ localStorage key 'finflow_probation' และ sync กับ Firebase ที่ /probationRecords

let probationRecords = JSON.parse(localStorage.getItem('finflow_probation') || '[]');
let pbEditingId = null;
let pbRef = null;
let pbReady = false;
let pbSortField = null; // null = ใช้ลำดับ default (วันที่ใหม่สุดก่อน)
let pbSortDir = 1;
let pbCharts = {};

const PB_NUMERIC_FIELDS = ['runningNo'];
const PB_DATE_FIELDS = ['date'];

const PB_XLSX_HEADERS = ['ลำดับที่','วันที่','ชื่อ','ตำแหน่ง','ลานจอด','หน่วยงาน','ข้อหา','รายละเอียด'];
const PB_XLSX_COLWIDTHS = [8, 14, 20, 16, 12, 16, 20, 40];

function pbSave() { localStorage.setItem('finflow_probation', JSON.stringify(probationRecords)); }

// ===== Sub-tabs =====
function pbSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`pb-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`pb-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { pbRefreshDashFilters(); pbRenderDashboard(); }
  if (tab === 'list') pbRenderList();
  if (tab === 'add' && !pbEditingId) pbClearForm();
}

function pbOnPageShown() {
  pbRefreshLookupDropdowns();
  pbRenderList();
}

// ===== Lookup dropdowns =====
function pbFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function pbFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function pbRefreshLookupDropdowns() {
  pbFillDatalist('pb-name-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  pbFillDatalist('pb-yard-list', mdYards);
  pbFillDatalist('pb-bu-list', mdBusinessUnits);
  pbFillDatalist('pb-charge-list', mdChargeTypes);
  pbFillSelect('pb-f-yard', mdYards);
  pbFillSelect('pb-f-bu', mdBusinessUnits);
}

function pbQuickAddCharge() {
  const name = (prompt('เพิ่มข้อหาใหม่:') || '').trim();
  if (!name) return;
  if (typeof addChargeTypeDB !== 'function') return;
  const nameInput = document.getElementById('md-charge-name');
  if (nameInput) {
    nameInput.value = name;
    addChargeTypeDB();
  } else if (!mdChargeTypes.includes(name)) {
    mdChargeTypes.push(name);
    saveChargeTypesDB();
    pbRefreshLookupDropdowns();
    if (typeof mdPushIfReady === 'function') mdPushIfReady();
  }
  const chargeInput = document.getElementById('pb-charge');
  if (chargeInput) chargeInput.value = name;
}

// ===== Running number =====
function pbNextRunningNo() {
  return probationRecords.length ? Math.max(...probationRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function pbSaveCase() {
  const date = document.getElementById('pb-date').value;
  const name = document.getElementById('pb-name').value.trim();
  const charge = document.getElementById('pb-charge').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!name) { showToast('กรุณาระบุชื่อ', 'warning'); return; }
  if (!charge) { showToast('กรุณาระบุข้อหา', 'warning'); return; }

  const record = {
    date, name, charge,
    position: document.getElementById('pb-position').value.trim(),
    yard: document.getElementById('pb-yard').value.trim(),
    businessUnit: document.getElementById('pb-bu').value.trim(),
    detail: document.getElementById('pb-detail').value.trim(),
  };

  if (pbEditingId) {
    const idx = probationRecords.findIndex(r => r.id === pbEditingId);
    if (idx >= 0) {
      probationRecords[idx] = { ...probationRecords[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('บันทึกการแก้ไขแล้ว', 'success');
      if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(`✏️ <b>แก้ไขบันทึกใบคุมประพฤติ</b>\nเลขที่: ${probationRecords[idx].runningNo}\nชื่อ: ${escapeHtml(name)}\nข้อหา: ${escapeHtml(charge)}`);
      }
    }
    pbCancelEdit();
  } else {
    record.id = 'PB_' + Date.now();
    record.runningNo = pbNextRunningNo();
    record.createdAt = new Date().toISOString();
    probationRecords.unshift(record);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `⚖️ <b>บันทึกใบคุมประพฤติใหม่</b>\nเลขที่: ${record.runningNo}\nชื่อ: ${escapeHtml(name)}\nตำแหน่ง: ${escapeHtml(record.position)}\nข้อหา: ${escapeHtml(charge)}`
      );
    }
    pbClearForm();
  }
  pbSave();
  pbPushIfReady();
  pbRenderList();
}

function pbClearForm() {
  pbEditingId = null;
  document.getElementById('pb-edit-banner').style.display = 'none';
  document.getElementById('pb-date').value = '';
  document.getElementById('pb-name').value = '';
  document.getElementById('pb-position').value = '';
  document.getElementById('pb-yard').value = '';
  document.getElementById('pb-bu').value = '';
  document.getElementById('pb-charge').value = '';
  document.getElementById('pb-detail').value = '';
}

function pbEditCase(id) {
  const rec = probationRecords.find(r => r.id === id);
  if (!rec) return;
  pbEditingId = id;
  document.getElementById('pb-edit-banner').style.display = 'flex';
  document.getElementById('pb-edit-no').textContent = rec.runningNo;
  document.getElementById('pb-date').value = rec.date || '';
  document.getElementById('pb-name').value = rec.name || '';
  document.getElementById('pb-position').value = rec.position || '';
  document.getElementById('pb-yard').value = rec.yard || '';
  document.getElementById('pb-bu').value = rec.businessUnit || '';
  document.getElementById('pb-charge').value = rec.charge || '';
  document.getElementById('pb-detail').value = rec.detail || '';
  pbSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function pbCancelEdit() { pbClearForm(); }

function pbDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  probationRecords = probationRecords.filter(r => r.id !== id);
  pbSave();
  pbPushIfReady();
  pbRenderList();
  showToast('ลบแล้ว', 'warning');
}

function pbDeleteAll() {
  if (currentUserProfile?.role !== 'admin') { showToast('เฉพาะแอดมินเท่านั้น', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบบันทึกใบคุมประพฤติทั้งหมด ${probationRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  probationRecords = [];
  pbSave();
  pbPushIfReady();
  pbRenderList();
  showToast('ลบทั้งหมดเรียบร้อย', 'success');
}

// ===== Dashboard =====
const PB_CHART_FONT = { family: "'Kanit','Sarabun','Noto Sans Thai',sans-serif", size: 13 };
const PB_CHART_TICK = { color: '#3d4f6d', font: PB_CHART_FONT };
const PB_CHART_GRID = { color: 'rgba(10,31,56,0.07)' };
const PB_DL_OPTS = { display: true, anchor: 'end', align: 'end', color: '#1a2540', font: { family: "'Kanit','Sarabun',sans-serif", size: 13, weight: '700' }, formatter: v => v > 0 ? v : '' };
const PB_CHART_COLORS = {
  month:  { bg: 'rgba(67,97,238,0.85)',  border: '#4361ee' },
  yard:   { bg: 'rgba(6,214,160,0.88)',  border: '#06d6a0' },
  charge: { bg: 'rgba(255,107,0,0.88)',  border: '#ff6b00' },
};
const PB_MONTH_LABELS_TH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

function pbDestroyChart(id) {
  if (pbCharts[id]) { pbCharts[id].destroy(); delete pbCharts[id]; }
}

function pbBarChart(canvasId, key, labels, data, maxRotation) {
  pbDestroyChart(key);
  pbCharts[key] = new Chart(document.getElementById(canvasId), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'จำนวนรายการ', data, backgroundColor: PB_CHART_COLORS[key].bg, borderColor: PB_CHART_COLORS[key].border, borderWidth: 0, borderRadius: 5 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, datalabels: PB_DL_OPTS },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: PB_CHART_GRID, ticks: { ...PB_CHART_TICK, precision: 0 } },
        x: { grid: { display: false }, ticks: { ...PB_CHART_TICK, autoSkip: false, minRotation: maxRotation || 0, maxRotation: maxRotation || 0 } },
      },
    },
  });
  setChartTotal(canvasId, data);
}

function pbRefreshDashFilters() {
  pbFillSelect('pb-dash-yard', mdYards);
  pbFillSelect('pb-dash-bu', mdBusinessUnits);
}

function pbRenderDashboard() {
  const yardFilter = document.getElementById('pb-dash-yard')?.value || '';
  const buFilter = document.getElementById('pb-dash-bu')?.value || '';
  const filtered = probationRecords.filter(r =>
    (!yardFilter || r.yard === yardFilter) && (!buFilter || r.businessUnit === buFilter)
  );

  const curYear = new Date().getFullYear();
  const monthCount = new Array(12).fill(0);
  filtered.forEach(r => {
    if (!r.date) return;
    const d = new Date(r.date);
    if (!isNaN(d) && d.getFullYear() === curYear) monthCount[d.getMonth()]++;
  });
  pbBarChart('pb-chart-month', 'month', PB_MONTH_LABELS_TH, monthCount);

  const countBy = field => {
    const map = {};
    filtered.forEach(r => { const v = r[field]; if (v) map[v] = (map[v] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };

  const yardSorted = countBy('yard');
  pbBarChart('pb-chart-yard', 'yard', yardSorted.map(e => e[0]), yardSorted.map(e => e[1]), 30);

  const chargeSorted = countBy('charge');
  pbBarChart('pb-chart-charge', 'charge', chargeSorted.map(e => e[0]), chargeSorted.map(e => e[1]), 30);
}

// ===== List / Filter =====
function pbFilteredList() {
  const yard = document.getElementById('pb-f-yard')?.value || '';
  const bu = document.getElementById('pb-f-bu')?.value || '';
  const search = (document.getElementById('pb-f-search')?.value || '').toLowerCase().trim();
  const filtered = probationRecords.filter(r => {
    if (yard && r.yard !== yard) return false;
    if (bu && r.businessUnit !== bu) return false;
    if (search && !(`${r.name} ${r.position} ${r.charge} ${r.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
  if (!pbSortField) return filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return filtered.sort((a, b) => pbCompareValues(a, b, pbSortField) * pbSortDir);
}

function pbCompareValues(a, b, field) {
  const av = a[field], bv = b[field];
  if (PB_NUMERIC_FIELDS.includes(field)) return (av || 0) - (bv || 0);
  if (PB_DATE_FIELDS.includes(field)) return new Date(av || 0) - new Date(bv || 0);
  return String(av || '').localeCompare(String(bv || ''), 'th');
}

function pbSortBy(field) {
  if (pbSortField === field) pbSortDir *= -1;
  else { pbSortField = field; pbSortDir = 1; }
  pbRenderList();
}

function pbUpdateSortIndicators() {
  document.querySelectorAll('.pb-sort-ind').forEach(el => { el.textContent = ''; });
  if (!pbSortField) return;
  const ind = document.getElementById(`pb-sort-ind-${pbSortField}`);
  if (ind) ind.textContent = pbSortDir === 1 ? '▲' : '▼';
}

function pbClearListFilters() {
  ['pb-f-yard', 'pb-f-bu', 'pb-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  pbRenderList();
}

function pbRenderList() {
  const list = pbFilteredList();
  const tbody = document.getElementById('pb-list-body');
  const countEl = document.getElementById('pb-list-count');
  if (!tbody) return;
  pbUpdateSortIndicators();
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td>${formatDate(r.date)}</td>
      <td>${escapeHtml(r.name || '-')}</td>
      <td>${escapeHtml(r.position || '-')}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.businessUnit || '-')}</td>
      <td>${escapeHtml(r.charge || '-')}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="action-btn action-view" onclick="pbEditCase('${r.id}')">แก้ไข</button>
          <button class="action-btn" onclick="pbShowMemoPrint('${r.id}')">🖨️ พิมพ์</button>
          <button class="action-btn action-delete" onclick="pbDeleteCase('${r.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ===== พิมพ์บันทึกการคุมประพฤติ (ต่อรายชื่อ) =====
function pbThaiLongDate(val) {
  const monthsTh = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
  const d = val ? new Date(val) : new Date();
  if (isNaN(d)) return '';
  return `${d.getDate()} ${monthsTh[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

function pbBuildMemoDoc(r) {
  return `
    <div class="print-doc pb-memo-doc">
      ${companyLetterhead()}
      <h1>บันทึกการคุมประพฤติ</h1>
      <div class="print-info" style="grid-template-columns:1fr 1fr;margin-top:6px;">
        <div class="print-info-row"></div>
        <div class="print-info-row" style="justify-content:flex-end;"><span class="print-label" style="min-width:auto;">วันที่ ${pbThaiLongDate(r.date)}</span></div>
      </div>
      <p class="print-body-text" style="text-indent:0;font-weight:700;">เรื่อง&nbsp;&nbsp;รายงานการคุมประพฤติ "ผลการตรวจประวัติอาชญากรรม"</p>
      <hr class="print-divider" />
      <p class="print-body-text" style="text-indent:0;">เรียน&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;คุณ${escapeHtml(r.name || '')} ตำแหน่ง ${escapeHtml(r.position || '-')}</p>
      <p class="print-body-text">โดยพบข้อหา ${escapeHtml(r.detail || '')}</p>
      <p class="print-body-text" style="text-indent:0;margin-left:2em;font-weight:700;border-bottom:1px solid #222;display:inline-block;">การดำเนินการติดตามการทำงานพนักงาน : ขอให้ทางต้นสังกัดติดตามควบคุมพฤติกรรมของพนักงาน</p>
      <p class="print-body-text">( ตามข้อบังคับเกี่ยวกับการทำงานของบริษัท 2.1. วินัยทั่วไป 2.1.1 ประพฤติตนเป็นพลเมืองดีอยู่ในระเบียบและกฎของสังคม
        ไม่ประพฤติชั่วกระทำหรือร่วมกันกระทำการใดๆ อันเป็นการผิดกฎหมายของบ้านเมืองทั้งในและนอกบริเวณบริษัทฯ )</p>
      <p class="print-body-text">ผลการตรวจประวัติอาชญากรรมของท่านข้างต้นตามที่กล่าวมา หากท่านมีความประสงค์ที่จะปฏิบัติงานร่วมกับทางบริษัทฯ
        ขอให้ท่านปรับปรุงทัศนคติและการทำงานให้ดีขึ้น โดยห้ามมิให้ท่านกระทำการดังกล่าวนี้อีก</p>
      <p class="print-body-text" style="text-indent:0;margin-left:2em;font-weight:700;border-bottom:1px solid #222;display:inline-block;">หากปรากฎ ว่าท่านยังละเลยเพิกเฉย กระทำผิดซ้ำหรือกระทำความผิดอื่นที่ทำให้บริษัทฯได้รับความเสียหาย</p>
      <p class="print-body-text" style="text-indent:0;text-align:center;font-weight:700;">" ทางบริษัทฯ ขอแจ้งสิ้นสุดสภาพการเป็นพนักงานของทางบริษัทฯ ทันที "</p>
      <p class="print-body-text">ข้าพเจ้า ได้อ่านข้อความข้างต้นโดยละเอียดแล้ว ขอรับรองว่าเป็นความจริงทุกประการ โดยการให้ข้อความข้างต้นนี้
        เกิดจากความสมัครใจของข้าพเจ้า โดยมิได้ถูกบังคับหรือฝืนใจแต่อย่างใดใดทั้งสิ้น</p>
      <div class="pb-sig-row">
        ${pbSigCell('พนักงานรับทราบ', r.name)}
        ${pbSigCell('หัวหน้างานรับทราบ', '')}
      </div>
      <div class="pb-sig-box">
        <div class="pb-sig-box-title">ฝ่ายบริหารรับทราบ</div>
        <div class="pb-sig-row">
          ${pbSigCell('ผู้จัดการขึ้นไป', '')}
          ${pbSigCell('ผอ.ฝ่ายบุคคลและฝ่ายปฏิบัติการ', 'นายโอพัฒน์ วัชโรดมประเสริฐ')}
        </div>
        <div class="pb-sig-row">
          ${pbSigCell('ผู้จัดการทั่วไป', 'นางนภาวรรณ คำภานุช')}
          ${pbSigCell('ลงนาม/รับทราบ<br>กรรมการผู้จัดการ', null)}
        </div>
      </div>
    </div>
  `;
}

// name === null ตัดแถวชื่อในวงเล็บออกไปเลย (ใช้กับช่องที่ไม่ต้องระบุชื่อ เช่น กรรมการผู้จัดการ)
// ชื่อในวงเล็บต้องอยู่ตรงกลาง "จุดประ" ของบรรทัดลงชื่อ ไม่ใช่กลางทั้งเซลล์ (เพราะป้ายชื่อ label ที่ต่อท้ายจุดประ
// ทำให้กึ่งกลางของทั้งบรรทัดเยื้องไปจากกึ่งกลางจุดประจริง) — วิธีแก้: บรรทัดชื่อ replicate โครงสร้าง prefix/label
// เดียวกับบรรทัดลงชื่อทุกตัวอักษร แต่ซ่อนไว้ (visibility:hidden) เพื่อให้ความกว้างเท่ากันเป๊ะ แล้ว text-align:center
// เฉพาะช่องจุดประ/ชื่อ ซึ่งจะตกตำแหน่งเดียวกับจุดประของบรรทัดบนเสมอเมื่อทั้งสอง div ถูก text-align:center เท่ากัน
// บรรทัด "ลงวันที่" ต้องเริ่มต้นตำแหน่งเดียวกับ "ลงชื่อ" (ชิดซ้ายกล่องเดียวกัน ไม่ใช่กึ่งกลางเซลล์) — ใช้กล่องคลุม
// (mirror-wrap) ที่มีความกว้างเท่ากล่องบรรทัดลงชื่อเป๊ะ (จาก mirror ที่ซ่อนไว้) แล้ว absolute ข้อความลงวันที่
// ให้ชิดซ้าย (left:0) ของกล่องนั้น ซึ่งจะตรงกับตำแหน่งเริ่มของ "ลงชื่อ" เสมอเพราะกล่องถูก center เท่ากัน
function pbSigCell(label, name) {
  const dots = '.'.repeat(56);
  const nameContent = name ? escapeHtml(name) : '&nbsp;'.repeat(34);
  const nameRow = name === null ? '' : `
    <div class="pb-sig-line pb-sig-line-name">
      <span class="pb-sig-prefix">ลงชื่อ&nbsp;</span><span class="pb-sig-blank">(${nameContent})</span><span class="pb-sig-suffix">&nbsp;${label}</span>
    </div>`;
  return `
    <div class="pb-sig-cell">
      <div class="pb-sig-line">
        <span class="pb-sig-prefix">ลงชื่อ&nbsp;</span><span class="pb-sig-blank">${dots}</span><span class="pb-sig-suffix">&nbsp;${label}</span>
      </div>
      ${nameRow}
      <div class="pb-sig-line pb-sig-line-date">
        <span class="pb-sig-mirror-wrap">
          <span class="pb-sig-mirror"><span class="pb-sig-prefix">ลงชื่อ&nbsp;</span><span class="pb-sig-blank">${dots}</span><span class="pb-sig-suffix">&nbsp;${label}</span></span>
          <span class="pb-sig-date-text">ลงวันที่ ............/..................../...............</span>
        </span>
      </div>
    </div>
  `;
}

function pbShowMemoPrint(id) {
  const r = probationRecords.find(x => x.id === id);
  if (!r) return;
  const html = pbBuildMemoDoc(r);
  document.getElementById('modalTitle').textContent = `บันทึกการคุมประพฤติ - ${escapeHtml(r.name || '')}`;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    // html2canvas คำนวณตำแหน่งบรรทัดของย่อหน้าที่ตัดขึ้นบรรทัดใหม่ผิดพลาด (ข้อความทับกัน) ถ้า element
    // ที่ capture ยังอยู่ใน DOM ของ modal เดิม (ซึ่งมี flex/overflow ในโครงสร้างบรรพบุรุษ) — ย้าย clone
    // ออกมานอก modal ก่อน capture แก้ปัญหานี้ได้ (ทดสอบยืนยันแล้วว่า clone แบบนี้ไม่มีปัญหาทับกัน)
    const orig = document.getElementById('modalBody');
    const clone = orig.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.cssText = `position:fixed;top:0;left:-9999px;overflow:visible;height:auto;max-height:none;width:${orig.clientWidth}px;`;
    document.body.appendChild(clone);
    const cleanup = () => { if (clone.parentNode) clone.parentNode.removeChild(clone); };
    html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: `บันทึกคุมประพฤติ_${r.name || r.runningNo}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] },
    }).from(clone).save().then(cleanup).catch(cleanup);
  };
}

// ===== Excel Export / Import / Template =====
function pbExportExcel() {
  if (!probationRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [PB_XLSX_HEADERS, ...probationRecords.map(r => [
    r.runningNo, formatDMY(r.date), r.name || '', r.position || '', r.yard || '', r.businessUnit || '', r.charge || '', r.detail || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = PB_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'บันทึกคุมประพฤติ');
  XLSX.writeFile(wb, 'บันทึกใบคุมประพฤติ_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function pbDownloadTemplate() {
  const sample = [
    PB_XLSX_HEADERS,
    ['', '15/01/2026', 'นายสมชาย ใจดี', 'พนักงานขับรถ', 'ABC', 'Trailer', 'ฝ่าฝืนกฎระเบียบวินัยจราจร', 'ตัวอย่างรายละเอียด'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = PB_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_บันทึกใบคุมประพฤติ.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function pbImportExcel(evt) {
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
        if (!row[2]) return;
        const data = {
          date: normalizeImportDate(row[1]),
          name: String(row[2] || '').trim(),
          position: String(row[3] || '').trim(),
          yard: String(row[4] || '').trim(),
          businessUnit: String(row[5] || '').trim(),
          charge: String(row[6] || '').trim(),
          detail: String(row[7] || '').trim(),
        };
        const rowNo = parseInt(row[0]);
        const existingIdx = rowNo ? probationRecords.findIndex(r => r.runningNo === rowNo) : -1;
        if (existingIdx >= 0) {
          probationRecords[existingIdx] = { ...probationRecords[existingIdx], ...data, updatedAt: now };
          updated++;
        } else {
          probationRecords.push({
            id: 'PB_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
            runningNo: pbNextRunningNo(),
            ...data,
            createdAt: now,
          });
          added++;
        }
      });
      pbSave(); pbPushIfReady(); pbRenderList();
      const msg = [updated ? `แก้ไข ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || 'ไม่มีข้อมูลใหม่', 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function pbRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function pbObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function pbApplyServer(serverRecords) {
  probationRecords = serverRecords;
  pbSave();
  pbRenderList();
}
async function pbWriteFB() {
  if (!pbRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(pbRef, pbRecordsToObj(probationRecords));
  } catch (e) { console.warn('pbWriteFB error', e); }
}
function pbPushIfReady() { if (pbReady) pbWriteFB(); }

function pbWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function pbInit() {
  await pbWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    pbRef = ref(fbDb, '/probationRecords');
    const snap = await get(pbRef);
    if (snap.exists()) pbApplyServer(pbObjToRecords(snap.val()));
    pbReady = true;
    if (!snap.exists() && probationRecords.length > 0) await pbWriteFB();
    onValue(pbRef, s => { if (s.exists()) pbApplyServer(pbObjToRecords(s.val())); });
  } catch (e) { console.warn('pbInit error', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  pbRefreshLookupDropdowns();
  pbClearForm();
  pbRenderList();
  pbInit();
});

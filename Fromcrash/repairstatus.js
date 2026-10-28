// ===== สถานะการซ่อมทรัพย์สิน (ไทม์ไลน์การจัดซ่อม) =====
// 2 แบบ:  ประกันซ่อม  : ช่างประกันเข้าดูความเสียหาย -> ช่างเตรียมอุปกรณ์จัดซ่อม -> นัดหมายเข้าซ่อม -> ซ่อมเสร็จแล้ว
//         ลูกค้าซ่อมเอง: เสนอราคา -> กำลังซ่อม -> ซ่อมเสร็จแล้ว
// ขั้นแรกของทั้งสองแบบ = "วันที่เกิดเหตุ" (ดึงจากช่องวันที่เกิดเหตุของรายการ r.reportDate ไม่เก็บซ้ำใน steps)
// แต่ละขั้นเก็บ "วันที่ทำขั้นนั้น" ถ้ามีวันที่ = ขั้นนั้นเกิดขึ้นแล้ว; สถานะปัจจุบัน = ขั้นล่าสุดที่มีวันที่
// เก็บ local ที่ 'finflow_repair_status' และ sync ที่ Firebase /repairStatus (รูปแบบเดียวกับ Stock Safety:
// เขียนทีละรายการ + ป้าย _deleted กันเครื่องที่ค้างข้อมูลเก่าดันรายการที่ลบแล้วกลับขึ้นมา)

const RS_TYPE_INS = 'ประกันซ่อม';
const RS_TYPE_OWN = 'ลูกค้าซ่อมเอง';
const RS_STEPS = {
  [RS_TYPE_INS]: [
    { key: 'incident', label: 'วันที่เกิดเหตุ' },
    { key: 'survey', label: 'ช่างประกันเข้าดูความเสียหาย' },
    { key: 'prep', label: 'ช่างเตรียมอุปกรณ์จัดซ่อม' },
    { key: 'appoint', label: 'นัดหมายเข้าซ่อม' },
    { key: 'done', label: 'ซ่อมเสร็จแล้ว' },
  ],
  [RS_TYPE_OWN]: [
    { key: 'incident', label: 'วันที่เกิดเหตุ' },
    { key: 'quote', label: 'เสนอราคา' },
    { key: 'repairing', label: 'กำลังซ่อม' },
    { key: 'done', label: 'ซ่อมเสร็จแล้ว' },
  ],
};
const RS_PENDING_LABEL = 'รอดำเนินการ';
const RS_MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const RS_FB_PATH = '/repairStatus';
const RS_CACHE_KEY = 'finflow_repair_status';

let repairRecords = [];
let rsFbLoaded = false; // ถ้า Firebase ส่งข้อมูลมาแล้ว แคชในเครื่องจะไม่ทับข้อมูลจริง
cacheLoad(RS_CACHE_KEY).then(v => {
  if (rsFbLoaded || !Array.isArray(v)) return;
  repairRecords = v;
  if (document.readyState !== 'loading') rsRenderAll();
});
let rsEditingId = null;
let rsRef = null;
let rsReady = false;
let rsDeleted = new Set();
let rsCharts = {};

function rsSave() { cacheSet(RS_CACHE_KEY, repairRecords); }
function rsTodayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ===== สถานะ / ไทม์ไลน์ =====
// วันที่ของขั้นหนึ่ง: ขั้น "เกิดเหตุ" = วันที่เกิดเหตุของรายการ, ขั้นอื่น = วันที่ที่กรอกไว้ใน steps
function rsStepDate(r, key) {
  return key === 'incident' ? (r.reportDate || '') : ((r.steps && r.steps[key]) || '');
}
// index ของขั้นล่าสุดที่มีวันที่ (ขั้นเกิดเหตุมีวันที่เสมอ = 0 ขึ้นไป; -1 เฉพาะรายการที่ไม่มีวันที่เกิดเหตุ)
function rsProgressIdx(r) {
  const steps = RS_STEPS[r.type] || [];
  let idx = -1;
  steps.forEach((s, i) => { if (rsStepDate(r, s.key)) idx = i; });
  return idx;
}
function rsIsDone(r) {
  const steps = RS_STEPS[r.type] || [];
  return steps.length > 0 && rsProgressIdx(r) === steps.length - 1;
}
function rsStatusLabel(r) {
  const idx = rsProgressIdx(r);
  if (idx <= 0) return RS_PENDING_LABEL; // มีแค่วันที่เกิดเหตุ ยังไม่เริ่มขั้นถัดไป = รอดำเนินการ
  return RS_STEPS[r.type][idx].label;
}
function rsStatusClass(r) {
  if (rsIsDone(r)) return 'rs-st-done';
  return rsProgressIdx(r) <= 0 ? 'rs-st-pending' : 'rs-st-going';
}
function rsDaysToFinish(r) {
  if (!rsIsDone(r) || !r.reportDate || !r.steps?.done) return null; // นับจากวันที่เกิดเหตุถึงวันที่ซ่อมเสร็จ
  const a = new Date(r.reportDate), b = new Date(r.steps.done);
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86400000));
}

function rsStepperHtml(r) {
  const steps = RS_STEPS[r.type] || [];
  const cur = rsProgressIdx(r);
  return `<div class="rs-steps rs-steps-${steps.length}">` + steps.map((s, i) => {
    const date = rsStepDate(r, s.key);
    const state = i <= cur && date ? 'done' : (i === cur + 1 ? 'next' : 'todo');
    return `<div class="rs-step rs-step-${state}">
      <div class="rs-dot">${state === 'done' ? '✓' : i + 1}</div>
      <div class="rs-step-label">${escapeHtml(s.label)}</div>
      <div class="rs-step-date">${date ? formatDate(date) : '-'}</div>
    </div>`;
  }).join('') + '</div>';
}

// ===== Tabs =====
function rsSwitchTab(tab) {
  ['dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`rs-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`rs-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'dashboard') { rsDashRefreshFilters(); rsRenderDashboard(); }
  if (tab === 'list') rsRenderList();
  if (tab === 'add' && !rsEditingId) rsClearForm();
}

function rsOnPageShown() {
  rsRefreshLookups();
  rsRenderAll();
}

function rsRenderAll() {
  rsRenderList();
  if (document.getElementById('rs-subpage-dashboard')?.classList.contains('active')) { rsDashRefreshFilters(); rsRenderDashboard(); }
}

// ===== Lookups =====
function rsFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(n => `<option value="${escapeHtml(n)}">`).join('');
}
function rsFillSelect(id, list, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` + (list || []).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  if ((list || []).includes(cur)) el.value = cur;
}
function rsRefreshLookups() {
  rsFillDatalist('rs-plate-list', (typeof mdVehicles !== 'undefined' ? mdVehicles : []).map(v => v.plate).filter(Boolean));
  rsFillDatalist('rs-employee-list', (typeof mdDrivers !== 'undefined' ? mdDrivers : []).map(d => d.name).filter(Boolean));
  rsFillDatalist('rs-customer-list', (typeof mdCustomers !== 'undefined' ? mdCustomers : []).map(c => c.name).filter(Boolean));
  rsFillDatalist('rs-yard-list', typeof mdYards !== 'undefined' ? mdYards : []);
  rsFillDatalist('rs-bu-list', typeof mdBusinessUnits !== 'undefined' ? mdBusinessUnits : []);
  rsFillDatalist('rs-insurer-list', typeof mdInsurers !== 'undefined' ? mdInsurers : []);
  rsFillSelect('rs-f-yard', typeof mdYards !== 'undefined' ? mdYards : [], 'ทั้งหมด');
}

function rsLookupVehicle() {
  const plate = document.getElementById('rs-plate').value.trim();
  const veh = (typeof mdVehicles !== 'undefined' ? mdVehicles : []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('rs-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('rs-yard').value = veh.yard;
  }
}

// ===== Form =====
// ช่องวันที่ของแต่ละขั้นสร้างตามประเภทที่เลือก (ประกัน 4 ขั้น / ลูกค้า 3 ขั้น) แล้วใส่ค่าเดิมกลับถ้าเป็นการแก้ไข
function rsOnTypeChange(existingSteps) {
  const type = document.getElementById('rs-type').value;
  const wrap = document.getElementById('rs-step-inputs');
  const steps = (RS_STEPS[type] || []).filter(s => s.key !== 'incident'); // วันที่เกิดเหตุอยู่ที่ช่องหลักด้านบน
  const prev = existingSteps || rsReadStepInputs();
  wrap.innerHTML = steps.map((s, i) => `
    <div class="form-group"><label>${i + 2}. ${escapeHtml(s.label)} <span style="font-weight:400;opacity:.6;">(วันที่)</span></label>
      <input type="date" id="rs-step-${s.key}" value="${prev[s.key] || ''}" /></div>
  `).join('');
  const isIns = type === RS_TYPE_INS;
  document.querySelectorAll('.rs-ins-only').forEach(el => { el.style.display = isIns ? '' : 'none'; });
  document.querySelectorAll('.rs-own-only').forEach(el => { el.style.display = type === RS_TYPE_OWN ? '' : 'none'; });
  wrap.style.display = steps.length ? '' : 'none';
}

function rsReadStepInputs() {
  const out = {};
  Object.values(RS_STEPS).flat().filter(s => s.key !== 'incident').forEach(s => {
    const el = document.getElementById(`rs-step-${s.key}`);
    if (el && el.value) out[s.key] = el.value;
  });
  return out;
}

function rsReadForm() {
  const v = id => document.getElementById(id).value.trim();
  const type = document.getElementById('rs-type').value;
  const stepsAll = rsReadStepInputs();
  const steps = {};
  (RS_STEPS[type] || []).filter(s => s.key !== 'incident').forEach(s => { if (stepsAll[s.key]) steps[s.key] = stepsAll[s.key]; });
  return {
    reportDate: document.getElementById('rs-date').value, type,
    asset: v('rs-asset'), plate: v('rs-plate'), employee: v('rs-employee'), customer: v('rs-customer'),
    yard: v('rs-yard'), businessUnit: v('rs-bu'),
    insurer: type === RS_TYPE_INS ? v('rs-insurer') : '',
    claimNo: type === RS_TYPE_INS ? v('rs-claimno') : '',
    quoteAmount: type === RS_TYPE_OWN ? Number(document.getElementById('rs-quote').value) || 0 : 0,
    repairCost: Number(document.getElementById('rs-cost').value) || 0,
    detail: v('rs-detail'), note: v('rs-note'), steps,
  };
}

function rsSaveCase() {
  const r = rsReadForm();
  if (!r.reportDate) { showToast('กรุณาระบุวันที่เกิดเหตุ', 'warning'); return; }
  if (!r.type) { showToast('กรุณาเลือกรูปแบบการซ่อม', 'warning'); return; }
  if (!r.asset) { showToast('กรุณาระบุทรัพย์สินที่ซ่อม', 'warning'); return; }
  // ขั้นที่ทำแล้วต้องไม่ย้อนลำดับ: ถ้ามีวันที่ขั้นหลัง ขั้นก่อนหน้าต้องมีวันที่ด้วย (ไทม์ไลน์จะไม่มีช่องว่างกลางทาง)
  const steps = RS_STEPS[r.type];
  const dateOf = s => rsStepDate(r, s.key); // ขั้นเกิดเหตุ = r.reportDate
  let lastIdx = -1;
  steps.forEach((s, i) => { if (dateOf(s)) lastIdx = i; });
  const missing = steps.slice(0, lastIdx).filter(s => !dateOf(s));
  if (missing.length) { showToast(`ใส่วันที่ขั้น "${missing[0].label}" ก่อน (มีวันที่ขั้นหลังแล้ว)`, 'warning'); return; }
  // วันที่ของแต่ละขั้นต้องไม่ก่อนขั้นก่อนหน้า (รวมวันที่เกิดเหตุ)
  for (let i = 1; i <= lastIdx; i++) {
    if (dateOf(steps[i]) < dateOf(steps[i - 1])) { showToast(`วันที่ "${steps[i].label}" ต้องไม่ก่อน "${steps[i - 1].label}"`, 'warning'); return; }
  }

  let saved;
  if (rsEditingId) {
    const idx = repairRecords.findIndex(x => x.id === rsEditingId);
    if (idx >= 0) { repairRecords[idx] = { ...repairRecords[idx], ...r, updatedAt: new Date().toISOString() }; saved = repairRecords[idx]; }
    showToast('บันทึกการแก้ไขแล้ว', 'success');
  } else {
    saved = { ...r, id: 'RS_' + Date.now(), runningNo: rsNextRunningNo(), createdAt: new Date().toISOString() };
    repairRecords.unshift(saved);
    showToast('บันทึกแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(`🛠️ <b>แจ้งซ่อมทรัพย์สิน (${escapeHtml(r.type)})</b>\nเลขที่: ${saved.runningNo}\nทรัพย์สิน: ${escapeHtml(r.asset)}\nทะเบียน: ${escapeHtml(r.plate)}\nพนักงาน: ${escapeHtml(r.employee)}\nลูกค้า: ${escapeHtml(r.customer)}\nรายละเอียด: ${escapeHtml(r.detail)}`);
    }
  }
  rsSave();
  if (saved) rsWriteFB([saved]);
  rsClearForm();
  rsSwitchTab('list');
}

function rsNextRunningNo() {
  return repairRecords.length ? Math.max(...repairRecords.map(r => r.runningNo || 0)) + 1 : 1;
}

function rsClearForm() {
  rsEditingId = null;
  document.getElementById('rs-edit-banner').style.display = 'none';
  document.getElementById('rs-date').value = rsTodayISO();
  document.getElementById('rs-type').value = '';
  ['rs-asset', 'rs-plate', 'rs-employee', 'rs-customer', 'rs-yard', 'rs-bu', 'rs-insurer', 'rs-claimno', 'rs-quote', 'rs-cost', 'rs-detail', 'rs-note'].forEach(id => { document.getElementById(id).value = ''; });
  rsOnTypeChange({});
}

function rsEditCase(id) {
  const r = repairRecords.find(x => x.id === id);
  if (!r) return;
  rsSwitchTab('add');
  rsEditingId = id;
  document.getElementById('rs-edit-banner').style.display = 'flex';
  document.getElementById('rs-edit-no').textContent = r.runningNo;
  document.getElementById('rs-date').value = r.reportDate || '';
  document.getElementById('rs-type').value = r.type || '';
  const set = (el, v) => { document.getElementById(el).value = v || ''; };
  set('rs-asset', r.asset); set('rs-plate', r.plate); set('rs-employee', r.employee); set('rs-customer', r.customer);
  set('rs-yard', r.yard); set('rs-bu', r.businessUnit); set('rs-insurer', r.insurer); set('rs-claimno', r.claimNo);
  set('rs-quote', r.quoteAmount || ''); set('rs-cost', r.repairCost || ''); set('rs-detail', r.detail); set('rs-note', r.note);
  rsOnTypeChange(r.steps || {});
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function rsCancelEdit() { rsClearForm(); }

function rsDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  repairRecords = repairRecords.filter(r => r.id !== id);
  rsSave();
  rsTombstone([id]);
  rsRenderAll();
  showToast('ลบแล้ว', 'warning');
}

// กดทีเดียวเลื่อนไปขั้นถัดไป (ใส่วันที่วันนี้) — แก้วันที่จริงภายหลังได้ที่ปุ่ม "แก้ไข"
function rsAdvance(id) {
  const idx = repairRecords.findIndex(r => r.id === id);
  if (idx < 0) return;
  const r = repairRecords[idx];
  const steps = RS_STEPS[r.type] || [];
  const next = steps[rsProgressIdx(r) + 1];
  if (!next) { showToast('รายการนี้ซ่อมเสร็จแล้ว', 'success'); return; }
  const today = rsTodayISO();
  repairRecords[idx] = { ...r, steps: { ...(r.steps || {}), [next.key]: today }, updatedAt: new Date().toISOString() };
  rsSave();
  rsWriteFB([repairRecords[idx]]);
  rsRenderAll();
  showToast(`อัปเดต: ${next.label}`, 'success');
  if (next.key === 'done' && typeof sendTelegramNotification === 'function') {
    sendTelegramNotification(`✅ <b>ซ่อมทรัพย์สินเสร็จแล้ว</b>\nเลขที่: ${r.runningNo} (${escapeHtml(r.type)})\nทรัพย์สิน: ${escapeHtml(r.asset)}\nทะเบียน: ${escapeHtml(r.plate)}`);
  }
}

// ===== List =====
function rsFiltered() {
  const type = document.getElementById('rs-f-type')?.value || '';
  const status = document.getElementById('rs-f-status')?.value || '';
  const yard = document.getElementById('rs-f-yard')?.value || '';
  const search = (document.getElementById('rs-f-search')?.value || '').toLowerCase().trim();
  return repairRecords.filter(r => {
    if (type && r.type !== type) return false;
    if (status === 'open' && rsIsDone(r)) return false;
    if (status === 'done' && !rsIsDone(r)) return false;
    if (yard && r.yard !== yard) return false;
    if (search && !`${r.asset} ${r.plate} ${r.employee || ''} ${r.customer} ${r.detail} ${r.insurer} ${r.claimNo} ${r.businessUnit}`.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || '') || (b.runningNo || 0) - (a.runningNo || 0));
}

function rsClearFilters() {
  ['rs-f-type', 'rs-f-status', 'rs-f-yard', 'rs-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  rsRenderList();
}

function rsRenderList() {
  const list = rsFiltered();
  const box = document.getElementById('rs-list-body');
  const countEl = document.getElementById('rs-list-count');
  const pagerEl = document.getElementById('rs-list-pager');
  if (!box) return;
  const open = list.filter(r => !rsIsDone(r)).length;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ · กำลังดำเนินการ ${open} · ซ่อมเสร็จแล้ว ${list.length - open}`;
  if (!list.length) {
    box.innerHTML = '<div class="empty-state">ยังไม่มีข้อมูล</div>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('rs-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('rs-list', page, totalPages, total, 'rsRenderList');
  box.innerHTML = pageItems.map(r => {
    const steps = RS_STEPS[r.type] || [];
    const next = steps[rsProgressIdx(r) + 1];
    const days = rsDaysToFinish(r);
    const meta = [
      `เกิดเหตุ ${formatDate(r.reportDate)}`,
      r.employee && `พนักงาน <b>${escapeHtml(r.employee)}</b>`,
      r.plate && `ทะเบียน ${escapeHtml(r.plate)}`,
      r.customer && `ลูกค้า ${escapeHtml(r.customer)}`,
      r.yard && `ลาน ${escapeHtml(r.yard)}`,
      r.businessUnit && `หน่วยงาน ${escapeHtml(r.businessUnit)}`,
      r.insurer && `ประกัน ${escapeHtml(r.insurer)}`,
      r.claimNo && `เลขเคลม ${escapeHtml(r.claimNo)}`,
      r.quoteAmount ? `เสนอราคา ${formatMoney(r.quoteAmount)}` : '',
      r.repairCost ? `ค่าซ่อม ${formatMoney(r.repairCost)}` : '',
      days !== null ? `ใช้เวลา ${days} วัน` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="rs-card">
      <div class="rs-card-head">
        <div class="rs-card-title">
          <span class="rs-no">#${r.runningNo}</span>
          <span class="rs-type ${r.type === RS_TYPE_INS ? 'rs-type-ins' : 'rs-type-own'}">${escapeHtml(r.type)}</span>
          <b>${escapeHtml(r.asset)}</b>
          <span class="rs-status ${rsStatusClass(r)}">${escapeHtml(rsStatusLabel(r))}</span>
        </div>
        <div class="rs-card-actions">
          ${next ? `<button class="action-btn rs-next-btn" onclick="rsAdvance('${r.id}')" title="ใส่วันที่วันนี้ให้ขั้นถัดไป">➡️ ${escapeHtml(next.label)}</button>` : ''}
          <button class="action-btn action-view" onclick="rsEditCase('${r.id}')">แก้ไข</button>
          <button class="action-btn action-delete" onclick="rsDeleteCase('${r.id}')">ลบ</button>
        </div>
      </div>
      <div class="rs-card-meta">${meta}</div>
      ${rsStepperHtml(r)}
      ${r.detail ? `<div class="rs-card-detail">${escapeHtml(r.detail)}</div>` : ''}
      ${r.note ? `<div class="rs-card-detail" style="opacity:.75;">หมายเหตุ: ${escapeHtml(r.note)}</div>` : ''}
    </div>`;
  }).join('');
}

// ===== Excel Export =====
function rsExportExcel() {
  if (!repairRecords.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const header = ['เลขที่', 'วันที่เกิดเหตุ', 'รูปแบบ', 'ทรัพย์สิน', 'ทะเบียน', 'ชื่อพนักงาน', 'ลูกค้า', 'ลานจอด', 'หน่วยงาน', 'บริษัทประกัน', 'เลขเคลม', 'เสนอราคา', 'ค่าซ่อม',
    'ช่างประกันเข้าดู', 'ช่างเตรียมอุปกรณ์', 'นัดหมายเข้าซ่อม', 'เสนอราคา(วันที่)', 'กำลังซ่อม', 'ซ่อมเสร็จ', 'สถานะปัจจุบัน', 'รายละเอียด', 'หมายเหตุ'];
  const d = (r, k) => (r.steps && r.steps[k]) ? formatDMY(r.steps[k]) : '';
  const rows = [header, ...[...repairRecords].sort((a, b) => (a.runningNo || 0) - (b.runningNo || 0)).map(r => [
    r.runningNo, formatDMY(r.reportDate), r.type, r.asset || '', r.plate || '', r.employee || '', r.customer || '', r.yard || '', r.businessUnit || '', r.insurer || '', r.claimNo || '',
    r.quoteAmount || '', r.repairCost || '', d(r, 'survey'), d(r, 'prep'), d(r, 'appoint'), d(r, 'quote'), d(r, 'repairing'), d(r, 'done'),
    rsStatusLabel(r), r.detail || '', r.note || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = header.map((h, i) => ({ wch: i === 20 ? 36 : 14 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สถานะการซ่อม');
  XLSX.writeFile(wb, 'สถานะการซ่อมทรัพย์สิน_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// ===== Dashboard =====
const RS_COLORS = {
  ins: { bg: 'rgba(59,130,246,0.85)' }, own: { bg: 'rgba(245,158,11,0.88)' },
  yard: { bg: 'rgba(6,214,160,0.88)' }, bu: { bg: 'rgba(155,93,229,0.85)' },
};
function rsDestroyChart(k) { if (rsCharts[k]) { rsCharts[k].destroy(); delete rsCharts[k]; } }
function rsBar(canvasId, key, labels, datasets, rotation) {
  rsDestroyChart(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  rsCharts[key] = new Chart(canvas, {
    type: 'bar', data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: datasets.length > 1, labels: { font: { family: "'Kanit','Sarabun',sans-serif", size: 13 } } },
        datalabels: { display: true, anchor: 'end', align: 'end', color: '#1a2540', font: { family: "'Kanit','Sarabun',sans-serif", size: 12, weight: '700' }, formatter: v => v > 0 ? v : '' },
      },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: { color: 'rgba(10,31,56,0.07)' }, ticks: { color: '#3d4f6d', precision: 0 } },
        x: { grid: { display: false }, ticks: { color: '#3d4f6d', autoSkip: false, minRotation: rotation || 0, maxRotation: rotation || 0 } },
      },
    },
  });
}

function rsDashRefreshFilters() {
  const yearEl = document.getElementById('rs-dash-year');
  if (!yearEl) return;
  const years = new Set([new Date().getFullYear()]);
  repairRecords.forEach(r => { const y = Number((r.reportDate || '').slice(0, 4)); if (y > 2000 && y < 2100) years.add(y); });
  const prev = yearEl.value;
  yearEl.innerHTML = '<option value="">ทุกปี</option>' + [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y + 543}</option>`).join('');
  yearEl.value = prev && (prev === '' || years.has(Number(prev))) ? prev : String(new Date().getFullYear());
  rsFillSelect('rs-dash-yard', typeof mdYards !== 'undefined' ? mdYards : [], 'ทุกลานจอด');
}

function rsRenderDashboard() {
  const year = document.getElementById('rs-dash-year')?.value || '';
  const type = document.getElementById('rs-dash-type')?.value || '';
  const yard = document.getElementById('rs-dash-yard')?.value || '';
  const data = repairRecords.filter(r =>
    (!year || (r.reportDate || '').startsWith(year + '-')) && (!type || r.type === type) && (!yard || r.yard === yard));

  const done = data.filter(rsIsDone);
  const days = done.map(rsDaysToFinish).filter(d => d !== null);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText('rs-kpi-total', data.length);
  setText('rs-kpi-ins', data.filter(r => r.type === RS_TYPE_INS).length);
  setText('rs-kpi-own', data.filter(r => r.type === RS_TYPE_OWN).length);
  setText('rs-kpi-open', data.length - done.length);
  setText('rs-kpi-done', done.length);
  setText('rs-kpi-avg', days.length ? `${(days.reduce((s, d) => s + d, 0) / days.length).toFixed(1)} วัน` : '-');

  // รายเดือน แยกประเภท (ตามปีที่เลือก; ไม่เลือกปี = ปีปัจจุบัน)
  const mYear = year || String(new Date().getFullYear());
  const mIns = new Array(12).fill(0), mOwn = new Array(12).fill(0);
  data.forEach(r => {
    if (!(r.reportDate || '').startsWith(mYear + '-')) return;
    const m = Number(r.reportDate.slice(5, 7)) - 1;
    if (m < 0 || m > 11) return;
    (r.type === RS_TYPE_INS ? mIns : mOwn)[m]++;
  });
  rsBar('rs-chart-month', 'month', RS_MONTHS_TH, [
    { label: RS_TYPE_INS, data: mIns, backgroundColor: RS_COLORS.ins.bg, borderRadius: 5 },
    { label: RS_TYPE_OWN, data: mOwn, backgroundColor: RS_COLORS.own.bg, borderRadius: 5 },
  ]);

  // สถานะปัจจุบัน: แยกตามขั้น แต่ละประเภทมีขั้นของตัวเอง ใช้ชื่อขั้นเป็นแกน
  const labels = [RS_PENDING_LABEL, ...new Set(Object.values(RS_STEPS).flat().filter(s => s.key !== 'incident').map(s => s.label))];
  const countStatus = t => labels.map(l => data.filter(r => r.type === t && rsStatusLabel(r) === l).length);
  rsBar('rs-chart-status', 'status', labels, [
    { label: RS_TYPE_INS, data: countStatus(RS_TYPE_INS), backgroundColor: RS_COLORS.ins.bg, borderRadius: 5 },
    { label: RS_TYPE_OWN, data: countStatus(RS_TYPE_OWN), backgroundColor: RS_COLORS.own.bg, borderRadius: 5 },
  ], 25);

  const countBy = field => {
    const map = {};
    data.forEach(r => { const k = (r[field] || '').trim() || 'ไม่ระบุ'; map[k] = (map[k] || 0) + 1; });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };
  const y = countBy('yard');
  rsBar('rs-chart-yard', 'yard', y.map(e => e[0]), [{ label: 'จำนวนรายการ', data: y.map(e => e[1]), backgroundColor: RS_COLORS.yard.bg, borderRadius: 5 }], 30);
  const emp = countBy('employee').slice(0, 15);
  rsBar('rs-chart-emp', 'emp', emp.map(e => e[0]), [{ label: 'จำนวนรายการ', data: emp.map(e => e[1]), backgroundColor: RS_COLORS.own.bg, borderRadius: 5 }], 30);
  const b = countBy('businessUnit');
  rsBar('rs-chart-bu', 'bu', b.map(e => e[0]), [{ label: 'จำนวนรายการ', data: b.map(e => e[1]), backgroundColor: RS_COLORS.bu.bg, borderRadius: 5 }], 30);
}

// ===== Firebase Sync =====
function rsObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
// raw = snapshot.val() ของ /repairStatus ; คีย์ _deleted = ป้ายรายการที่ถูกลบ
function rsParseServer(raw) {
  rsDeleted = new Set(Object.keys((raw && raw._deleted) || {}));
  const all = rsObjToRecords(raw);
  const resurrected = all.filter(r => rsDeleted.has(r.id));
  if (resurrected.length) rsTombstone(resurrected.map(r => r.id));
  return all.filter(r => !rsDeleted.has(r.id));
}
function rsApplyServer(serverRecords) {
  rsFbLoaded = true;
  const serverIds = new Set(serverRecords.map(r => r.id));
  const localOnly = (repairRecords || []).filter(t => t && t.id && !serverIds.has(t.id) && !rsDeleted.has(t.id));
  repairRecords = serverRecords.concat(localOnly);
  rsSave();
  rsRenderAll();
  if (localOnly.length) rsWriteFB(localOnly);
}
async function rsWriteFB(records) {
  if (!rsRef) return;
  const list = (records || repairRecords).filter(r => r && r.id);
  if (!list.length) return;
  try {
    const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const updates = {};
    list.forEach(r => { updates[RS_FB_PATH + '/' + r.id] = r; updates[RS_FB_PATH + '/_deleted/' + r.id] = null; rsDeleted.delete(r.id); });
    await update(ref(fbDb), updates);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('rsWriteFB error', e); notifySyncWriteError(e.message); }
}
async function rsTombstone(ids) {
  ids.forEach(id => rsDeleted.add(id));
  if (!rsRef || !ids.length) return;
  try {
    const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const updates = {};
    ids.forEach(id => { updates[RS_FB_PATH + '/' + id] = null; updates[RS_FB_PATH + '/_deleted/' + id] = true; });
    await update(ref(fbDb), updates);
  } catch (e) { console.warn('rsTombstone error', e); notifySyncWriteError(e.message); }
}
function rsWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}
async function rsInit() {
  await rsWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    rsRef = ref(fbDb, RS_FB_PATH);
    const snap = await get(rsRef);
    if (snap.exists()) rsApplyServer(rsParseServer(snap.val()));
    rsReady = true;
    if (!snap.exists() && repairRecords.length) await rsWriteFB();
    onValue(rsRef, s => { if (s.exists()) rsApplyServer(rsParseServer(s.val())); });
  } catch (e) { console.warn('rsInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  rsRefreshLookups();
  rsClearForm();
  rsRenderAll();
  rsInit();
});

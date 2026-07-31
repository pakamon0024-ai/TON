// ===== Global State =====
let records = JSON.parse(localStorage.getItem('finflow_records') || '[]');
let pettyRows = [];
let approvalRows = [];
let currentPrintFn = null;
let requesters = JSON.parse(localStorage.getItem('finflow_requesters') || '[]');
let editingPettyId = null;
let editingApprovalId = null;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setToday();
  renderDashboard();
  renderHistory();
  addPettyRow();
  addApprovalRow();
  updateCurrentDate();
  autoDocNo();
  loadRequesters();
});

function updateCurrentDate() {
  const el = document.getElementById('currentDate');
  const now = new Date();
  el.textContent = now.toLocaleDateString('th-TH', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
}

function setToday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('pc-date').value = today;
  document.getElementById('ap-date').value = today;
}

function autoDocNo() {
  const now = new Date();
  const yr = now.getFullYear() + 543;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const pettyCnt = records.filter(r => r.type === 'petty').length + 1;
  const apCnt = records.filter(r => r.type === 'approval').length + 1;
  document.getElementById('pc-docno').value = `PC-${yr}${m}-${String(pettyCnt).padStart(3, '0')}`;
  document.getElementById('ap-docno').value = `AP-${yr}${m}-${String(apCnt).padStart(3, '0')}`;
}

// ===== Navigation =====
function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  const titles = {
    dashboard: 'ภาพรวมระบบ',
    'petty-cash': 'ฟอร์มเงินสดย่อย',
    approval: 'หนังสือขออนุมัติสำรองจ่าย',
    history: 'ประวัติรายการ',
    claims: 'เคลมประกันภัย',
    masterdata: 'ฐานข้อมูลหลัก'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '';

  if (page === 'dashboard') renderDashboard();
  if (page === 'history') renderHistory();
  if (page === 'claims' && typeof icOnPageShown === 'function') icOnPageShown();
  if (page === 'masterdata' && typeof renderMasterData === 'function') renderMasterData();

  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ===== Requester Manager =====
function loadRequesters() {
  renderRequesterList();
  syncRequesterDropdowns();
}

function toggleRequesterPanel() {
  const body = document.getElementById('requesterPanelBody');
  const arrow = document.getElementById('requesterArrow');
  body.classList.toggle('open');
  arrow.classList.toggle('open');
}

function addRequester() {
  const input = document.getElementById('newRequesterInput');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (requesters.includes(name)) {
    showToast('มีชื่อนี้อยู่แล้ว', 'warning'); return;
  }
  requesters.push(name);
  saveRequesters();
  renderRequesterList();
  syncRequesterDropdowns();
  input.value = '';
  input.focus();
  showToast(`เพิ่มผู้เบิก: ${name}`, 'success');
}

function removeRequester(name) {
  requesters = requesters.filter(r => r !== name);
  saveRequesters();
  renderRequesterList();
  syncRequesterDropdowns();
  showToast(`ลบแล้ว: ${name}`, 'warning');
}

function saveRequesters() {
  localStorage.setItem('finflow_requesters', JSON.stringify(requesters));
}

function renderRequesterList() {
  const ul = document.getElementById('requesterList');
  if (!ul) return;
  if (requesters.length === 0) {
    ul.innerHTML = '<li class="requester-list-empty">ยังไม่มีรายชื่อ — พิมพ์ชื่อเพื่อเพิ่ม</li>';
    return;
  }
  ul.innerHTML = requesters.map(name => `
    <li>
      <span title="${escapeHtml(name)}">${escapeHtml(name)}</span>
      <button class="btn-req-delete" onclick="removeRequester('${escapeHtml(name).replace(/'/g, "&apos;")}')"
        title="ลบรายชื่อนี้">✕</button>
    </li>
  `).join('');
}

function syncRequesterDropdowns() {
  ['pc-requester', 'ap-requester'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const placeholder = id === 'pc-requester' ? '-- เลือกผู้เบิก --' : '-- เลือกผู้ขออนุมัติ --';
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      requesters.map(r => `<option value="${escapeHtml(r)}" ${r === current ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
  });
  attachRequesterListeners();
}

function attachRequesterListeners() {
  const pcSel = document.getElementById('pc-requester');
  const apSel = document.getElementById('ap-requester');
  if (pcSel) {
    pcSel.onchange = () => updateSignature('pc');
    // trigger if already has value
    updateSignature('pc');
  }
  if (apSel) {
    apSel.onchange = () => updateSignature('ap');
    updateSignature('ap');
  }
}

function updateSignature(prefix) {
  const sel = document.getElementById(`${prefix}-requester`);
  const sigName = document.getElementById(`${prefix}-sig-name`);
  const sigDate = document.getElementById(`${prefix}-sig-date`);
  if (!sel || !sigName || !sigDate) return;

  const name = sel.value;
  if (name) {
    sigName.textContent = name;
    const now = new Date();
    const day   = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year  = now.getFullYear() + 543;
    sigDate.textContent = `วันที่ ${day}/${month}/${year}`;
    sigName.style.opacity = '1';
  } else {
    sigName.textContent = '';
    sigDate.textContent = 'วันที่ ........./........./........';
    sigName.style.opacity = '0.4';
  }
}


// ===== Categories =====
const categories = [
  'ค่าเดินทาง', 'ค่าอาหาร/เครื่องดื่ม', 'ค่าวัสดุสำนักงาน',
  'ค่าสื่อสาร/โทรศัพท์', 'ค่าจ้างแรงงาน', 'ค่าน้ำ/ไฟฟ้า',
  'ค่าซ่อมแซม', 'ค่าประชาสัมพันธ์', 'อื่นๆ'
];

function categoryOptions(selected = '') {
  return categories.map(c =>
    `<option value="${c}" ${c === selected ? 'selected' : ''}>${c}</option>`
  ).join('');
}

// ===== Petty Cash =====
function addPettyRow(item = '') {
  const idx = pettyRows.length;
  pettyRows.push({ id: Date.now() + idx });
  renderPettyRows();
}

function removePettyRow(id) {
  pettyRows = pettyRows.filter(r => r.id !== id);
  renderPettyRows();
  calcPettyTotal();
}

function renderPettyRows() {
  const tbody = document.getElementById('pettyItemsBody');
  tbody.innerHTML = pettyRows.map((row, i) => `
    <tr id="petty-row-${row.id}">
      <td style="text-align:center;color:var(--text-muted);font-size:0.82rem">${i + 1}</td>
      <td><input type="text" placeholder="รายการค่าใช้จ่าย" id="pc-item-${row.id}" oninput="calcPettyTotal()" /></td>
      <td>
        <select id="pc-cat-${row.id}">
          ${categoryOptions()}
        </select>
      </td>
      <td>
        <input type="number" min="0" step="0.01" placeholder="0.00"
          id="pc-amount-${row.id}" oninput="calcPettyTotal()" style="text-align:right" />
      </td>
      <td>
        <button class="btn-delete-row" onclick="removePettyRow(${row.id})" title="ลบรายการ">✕</button>
      </td>
    </tr>
  `).join('');
  calcPettyTotal();
}

function calcPettyTotal() {
  let total = 0;
  pettyRows.forEach(row => {
    const v = parseFloat(document.getElementById(`pc-amount-${row.id}`)?.value || 0);
    total += isNaN(v) ? 0 : v;
  });
  document.getElementById('pc-total').textContent = formatMoney(total);
}

function getPettyData() {
  const items = pettyRows.map((row, i) => ({
    no: i + 1,
    item: document.getElementById(`pc-item-${row.id}`)?.value || '',
    cat: document.getElementById(`pc-cat-${row.id}`)?.value || '',
    amount: parseFloat(document.getElementById(`pc-amount-${row.id}`)?.value || 0) || 0,
  }));
  const total = items.reduce((s, r) => s + r.amount, 0);
  return {
    dept: document.getElementById('pc-dept').value,
    docno: document.getElementById('pc-docno').value,
    date: document.getElementById('pc-date').value,
    requester: document.getElementById('pc-requester').value,
    purpose: document.getElementById('pc-purpose').value,
    items, total
  };
}

function savePettyCash() {
  const data = getPettyData();
  if (!data.docno || !data.requester || data.items.length === 0) {
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error'); return;
  }
  if (data.items.some(i => !i.item)) {
    showToast('กรุณากรอกรายการค่าใช้จ่ายให้ครบ', 'warning'); return;
  }
  if (editingPettyId) {
    const idx = records.findIndex(r => r.id === editingPettyId);
    if (idx >= 0) {
      records[idx] = {
        ...records[idx],
        docno: data.docno, dept: data.dept, requester: data.requester,
        purpose: data.purpose, date: data.date, items: data.items, total: data.total,
      };
    }
    showToast('✅ แก้ไขรายการเงินสดย่อยแล้ว!', 'success');
    cancelEditPetty();
  } else {
    const record = {
      id: Date.now(),
      type: 'petty',
      docno: data.docno,
      dept: data.dept,
      requester: data.requester,
      purpose: data.purpose,
      date: data.date,
      items: data.items,
      total: data.total,
      status: 'pending',
      savedAt: new Date().toISOString()
    };
    records.unshift(record);
    showToast('✅ บันทึกรายการเงินสดย่อยแล้ว!', 'success');
    autoDocNo();
  }
  saveRecords();
  rsPushIfReady();
  renderDashboard();
  renderHistory();
}

function clearPettyCash() {
  pettyRows = [];
  renderPettyRows();
  addPettyRow();
  setToday();
  autoDocNo();
  showToast('ล้างข้อมูลแล้ว', 'warning');
}

function editRecord(id) {
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  if (rec.type === 'petty') loadPettyCashForEdit(rec);
  else loadApprovalForEdit(rec.data || rec, rec.id);
  showPage(rec.type === 'petty' ? 'petty-cash' : 'approval');
}

function loadPettyCashForEdit(rec) {
  editingPettyId = rec.id;
  setSelectValueSafe('pc-dept', rec.dept || '');
  document.getElementById('pc-docno').value = rec.docno || '';
  document.getElementById('pc-date').value = rec.date || '';
  document.getElementById('pc-purpose').value = rec.purpose || '';

  pettyRows = (rec.items || []).map((item, i) => ({ id: Date.now() + i }));
  if (pettyRows.length === 0) pettyRows = [{ id: Date.now() }];
  renderPettyRows();
  (rec.items || []).forEach((item, i) => {
    const row = pettyRows[i];
    if (!row) return;
    document.getElementById(`pc-item-${row.id}`).value = item.item || '';
    document.getElementById(`pc-cat-${row.id}`).value = item.cat || '';
    document.getElementById(`pc-amount-${row.id}`).value = item.amount || '';
  });
  calcPettyTotal();

  setSelectValueSafe('pc-requester', rec.requester || '');
  updateSignature('pc');

  document.getElementById('pc-edit-docno').textContent = rec.docno || '';
  document.getElementById('pc-edit-banner').style.display = 'flex';
  showToast('โหลดข้อมูลเพื่อแก้ไขแล้ว', 'success');
}

function cancelEditPetty() {
  editingPettyId = null;
  document.getElementById('pc-edit-banner').style.display = 'none';
  clearPettyCash();
}

// ===== Approval =====
function addApprovalRow() {
  const idx = approvalRows.length;
  approvalRows.push({ id: Date.now() + idx + 1000 });
  renderApprovalRows();
}

function removeApprovalRow(id) {
  approvalRows = approvalRows.filter(r => r.id !== id);
  renderApprovalRows();
  calcApprovalTotal();
}

function renderApprovalRows() {
  const tbody = document.getElementById('approvalItemsBody');
  tbody.innerHTML = approvalRows.map((row, i) => `
    <tr id="ap-row-${row.id}">
      <td style="text-align:center;color:var(--text-muted);font-size:0.82rem">${i + 1}</td>
      <td><input type="text" placeholder="รายการที่ขออนุมัติ" id="ap-item-${row.id}" oninput="calcApprovalTotal()" /></td>
      <td>
        <select id="ap-cat-${row.id}">
          ${categoryOptions()}
        </select>
      </td>
      <td>
        <input type="number" min="0" step="0.01" placeholder="0.00"
          id="ap-amount-${row.id}" oninput="calcApprovalTotal()" style="text-align:right" />
      </td>
      <td>
        <button class="btn-delete-row" onclick="removeApprovalRow(${row.id})" title="ลบรายการ">✕</button>
      </td>
    </tr>
  `).join('');
  calcApprovalTotal();
}

function calcApprovalTotal() {
  let total = 0;
  approvalRows.forEach(row => {
    const v = parseFloat(document.getElementById(`ap-amount-${row.id}`)?.value || 0);
    total += isNaN(v) ? 0 : v;
  });
  document.getElementById('ap-total').textContent = formatMoney(total);
  updateApprovalNotes();
}

function updateApprovalNotes() {
  const note1El = document.getElementById('ap-note1');
  const note2El = document.getElementById('ap-note2');
  if (!note1El || !note2El) return;
  const customer = document.getElementById('ap-dept').value.trim() || '-';
  let total = 0;
  approvalRows.forEach(row => {
    const v = parseFloat(document.getElementById(`ap-amount-${row.id}`)?.value || 0);
    total += isNaN(v) ? 0 : v;
  });
  const amountText = formatMoney(total);
  const bahtText = thaiBahtText(total);
  note1El.value = `ลูกค้า ${customer} จำนวนเงิน ${amountText} (${bahtText}) ตามเอกสารแนบ`;
  note2El.value = `ทางหน่วยงาน Safety ขออนุมัติสำรองจ่ายให้ลูกค้า ${customer} เป็นจำนวนเงิน ${amountText} (${bahtText}) และทำการตั้งเบิกประกันสินค้า`;
}

function getApprovalData() {
  const items = approvalRows.map((row, i) => ({
    no: i + 1,
    item: document.getElementById(`ap-item-${row.id}`)?.value || '',
    cat: document.getElementById(`ap-cat-${row.id}`)?.value || '',
    amount: parseFloat(document.getElementById(`ap-amount-${row.id}`)?.value || 0) || 0,
  }));
  const total = items.reduce((s, r) => s + r.amount, 0);
  return {
    dept: document.getElementById('ap-dept').value,
    docno: document.getElementById('ap-docno').value,
    date: document.getElementById('ap-date').value,
    to: document.getElementById('ap-to').value,
    subject: document.getElementById('ap-subject').value,
    requester: document.getElementById('ap-requester').value,
    reason: document.getElementById('ap-reason').value,
    note1: document.getElementById('ap-note1').value,
    note2: document.getElementById('ap-note2').value,
    closing: document.getElementById('ap-closing').value,
    items, total
  };
}

function saveApproval() {
  const data = getApprovalData();
  if (!data.docno || !data.requester || data.items.length === 0) {
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error'); return;
  }
  if (editingApprovalId) {
    const idx = records.findIndex(r => r.id === editingApprovalId);
    if (idx >= 0) {
      records[idx] = {
        ...records[idx],
        docno: data.docno, dept: data.dept, requester: data.requester,
        subject: data.subject, date: data.date, items: data.items, total: data.total,
        data: data,
      };
    }
    showToast('✅ แก้ไขหนังสือขออนุมัติแล้ว!', 'success');
    cancelEditApproval();
  } else {
    const record = {
      id: Date.now(),
      type: 'approval',
      docno: data.docno,
      dept: data.dept,
      requester: data.requester,
      subject: data.subject,
      date: data.date,
      items: data.items,
      total: data.total,
      status: 'pending',
      data: data,
      savedAt: new Date().toISOString()
    };
    records.unshift(record);
    showToast('✅ บันทึกหนังสือขออนุมัติแล้ว!', 'success');
    autoDocNo();
  }
  saveRecords();
  rsPushIfReady();
  renderDashboard();
  renderHistory();
}

function clearApproval() {
  approvalRows = [];
  renderApprovalRows();
  addApprovalRow();
  setToday();
  autoDocNo();
  showToast('ล้างข้อมูลแล้ว', 'warning');
}

function loadApprovalForEdit(data, recordId) {
  editingApprovalId = recordId;
  document.getElementById('ap-dept').value = data.dept || '';
  document.getElementById('ap-docno').value = data.docno || '';
  document.getElementById('ap-date').value = data.date || '';
  document.getElementById('ap-to').value = data.to || '';
  document.getElementById('ap-subject').value = data.subject || '';
  document.getElementById('ap-reason').value = data.reason || '';
  document.getElementById('ap-closing').value = data.closing || '';

  approvalRows = (data.items || []).map((item, i) => ({ id: Date.now() + i + 1000 }));
  if (approvalRows.length === 0) approvalRows = [{ id: Date.now() + 1000 }];
  renderApprovalRows();
  (data.items || []).forEach((item, i) => {
    const row = approvalRows[i];
    if (!row) return;
    document.getElementById(`ap-item-${row.id}`).value = item.item || '';
    document.getElementById(`ap-cat-${row.id}`).value = item.cat || '';
    document.getElementById(`ap-amount-${row.id}`).value = item.amount || '';
  });
  calcApprovalTotal();

  setSelectValueSafe('ap-requester', data.requester || '');
  updateSignature('ap');
  if (data.note1) document.getElementById('ap-note1').value = data.note1;
  if (data.note2) document.getElementById('ap-note2').value = data.note2;

  document.getElementById('ap-edit-docno').textContent = data.docno || '';
  document.getElementById('ap-edit-banner').style.display = 'flex';
  showToast('โหลดข้อมูลเพื่อแก้ไขแล้ว', 'success');
}

function cancelEditApproval() {
  editingApprovalId = null;
  document.getElementById('ap-edit-banner').style.display = 'none';
  clearApproval();
}

// ===== Dashboard =====
function renderDashboard() {
  const total = records.reduce((s, r) => s + (r.total || 0), 0);
  const approved = records.filter(r => r.status === 'approved').length;
  const pending = records.filter(r => r.status === 'pending').length;
  document.getElementById('dash-total-petty').textContent = formatMoney(total);
  document.getElementById('dash-approved').textContent = `${approved} รายการ`;
  document.getElementById('dash-pending').textContent = `${pending} รายการ`;
  document.getElementById('dash-total-records').textContent = `${records.length} รายการ`;

  const tbody = document.getElementById('dashRecentBody');
  const recent = records.slice(0, 8);
  if (recent.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">ยังไม่มีรายการ</td></tr>';
  } else {
    tbody.innerHTML = recent.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:0.82rem">${escapeHtml(r.docno)}</td>
        <td>${r.type === 'petty' ? '<span class="badge badge-blue">💵 เงินสดย่อย</span>' : '<span class="badge badge-purple">📝 สำรองจ่าย</span>'}</td>
        <td>${escapeHtml(r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-'))}</td>
        <td style="font-weight:600;color:var(--accent-green)">${formatMoney(r.total)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${formatDate(r.date)}</td>
        <td><button class="action-btn action-view" onclick="editRecord(${r.id})">✏️ แก้ไข</button></td>
      </tr>
    `).join('');
  }
}

// ===== History =====
function renderHistory() {
  const typeFilter = document.getElementById('filterType')?.value || 'all';
  const search = (document.getElementById('filterSearch')?.value || '').toLowerCase();
  let filtered = records.filter(r => {
    const matchType = typeFilter === 'all' || r.type === typeFilter;
    const matchSearch = !search ||
      r.docno?.toLowerCase().includes(search) ||
      r.requester?.toLowerCase().includes(search) ||
      (r.purpose || r.subject || '').toLowerCase().includes(search);
    return matchType && matchSearch;
  });

  const tbody = document.getElementById('historyBody');
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">ไม่พบรายการ</td></tr>';
  } else {
    tbody.innerHTML = filtered.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:0.82rem">${escapeHtml(r.docno)}</td>
        <td>${r.type === 'petty' ? '<span class="badge badge-blue">💵 เงินสดย่อย</span>' : '<span class="badge badge-purple">📝 สำรองจ่าย</span>'}</td>
        <td>${escapeHtml(r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-'))}</td>
        <td style="font-weight:600;color:var(--accent-green)">${formatMoney(r.total)}</td>
        <td>
          <select class="status-select" onchange="changeStatus(${r.id}, this.value)" style="background:transparent;border:none;color:inherit;font-family:inherit;font-size:0.82rem;cursor:pointer">
            <option value="pending" ${r.status === 'pending' ? 'selected' : ''}>⏳ รอ</option>
            <option value="approved" ${r.status === 'approved' ? 'selected' : ''}>✅ อนุมัติ</option>
            <option value="rejected" ${r.status === 'rejected' ? 'selected' : ''}>❌ ไม่อนุมัติ</option>
          </select>
        </td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${formatDate(r.savedAt)}</td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="action-btn action-view" onclick="viewRecord(${r.id})">ดู</button>
            <button class="action-btn action-view" onclick="editRecord(${r.id})">แก้ไข</button>
            <button class="action-btn action-delete" onclick="deleteRecord(${r.id})">ลบ</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

function changeStatus(id, status) {
  const rec = records.find(r => r.id === id);
  if (rec) { rec.status = status; saveRecords(); rsPushIfReady(); renderDashboard(); }
}

function deleteRecord(id) {
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  records = records.filter(r => r.id !== id);
  saveRecords(); rsPushIfReady(); renderHistory(); renderDashboard();
  showToast('ลบรายการแล้ว', 'warning');
}

function clearAllHistory() {
  if (!confirm('ยืนยันการล้างประวัติทั้งหมด?')) return;
  records = []; saveRecords(); rsPushIfReady(); renderHistory(); renderDashboard();
  showToast('ล้างประวัติทั้งหมดแล้ว', 'warning');
}

function viewRecord(id) {
  const rec = records.find(r => r.id === id);
  if (!rec) return;
  if (rec.type === 'petty') showPettyCashPrint(rec);
  else showApprovalPrint(rec.data || rec);
}

// ===== Print / Export PDF =====
function printPettyCash() {
  const data = getPettyData();
  showPettyCashPrint(data);
}

function showPettyCashPrint(data) {
  const html = buildPettyCashDoc(data);
  document.getElementById('modalTitle').textContent = `ใบสำคัญจ่ายเงินสดย่อย - ${data.docno}`;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    const el = document.getElementById('modalBody');
    html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: `เงินสดย่อย_${data.docno}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(el).save();
  };
}

function printApproval() {
  const data = getApprovalData();
  showApprovalPrint(data);
}

function showApprovalPrint(data) {
  const html = buildApprovalDoc(data);
  document.getElementById('modalTitle').textContent = `หนังสือขออนุมัติสำรองจ่าย - ${data.docno}`;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    const el = document.getElementById('modalBody');
    html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: `อนุมัติสำรองจ่าย_${data.docno}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(el).save();
  };
}

function companyLetterhead() {
  return `
    <div class="letterhead">
      <div class="letterhead-name-th">บริษัท เอ.พี.ทรานสปอร์ต เซ็นเตอร์ จำกัด</div>
      <div class="letterhead-name-en">A.P. TRANSPORT CENTER CO., LTD.</div>
      <div class="letterhead-detail">1/4 หมู่ 4 ต.พิมพา อ.บางปะกง จ.ฉะเชิงเทรา 24180</div>
      <div class="letterhead-detail">Tel. 033-050710 &nbsp;&nbsp; Fax. -</div>
      <div class="letterhead-detail">เลขประจำตัวผู้เสียภาษี: 0-2455-50000-03-1</div>
      <div class="letterhead-detail">www.amphol2000.com &nbsp;|&nbsp; E-mail: apt@amphol2000.com</div>
    </div>
    <hr class="print-divider" />
  `;
}

function buildPettyCashDoc(data) {
  const rows = (data.items || []).map((item, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(item.item)}</td>
      <td>${escapeHtml(item.cat)}</td>
      <td style="text-align:right">${formatMoney(item.amount)}</td>
    </tr>
  `).join('');
  return `
    <div class="print-doc">
      ${companyLetterhead()}
      <h1>ใบสำคัญจ่ายเงินสดย่อย</h1>
      <p class="print-subtitle">Petty Cash Voucher</p>
      <hr class="print-divider" />
      <div class="print-info">
        <div class="print-info-row"><span class="print-label">หน่วยงาน:</span><span>${escapeHtml(data.dept)}</span></div>
        <div class="print-info-row"><span class="print-label">เลขที่เอกสาร:</span><span>${escapeHtml(data.docno)}</span></div>
        <div class="print-info-row"><span class="print-label">ผู้เบิก:</span><span>${escapeHtml(data.requester)}</span></div>
        <div class="print-info-row"><span class="print-label">วันที่:</span><span>${formatDate(data.date)}</span></div>
        <div class="print-info-row" style="grid-column:1/-1"><span class="print-label">วัตถุประสงค์:</span><span>${escapeHtml(data.purpose)}</span></div>
      </div>
      <table>
        <thead><tr><th style="width:40px">ลำดับ</th><th>รายการ</th><th>หมวดหมู่</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">รวมทั้งสิ้น: ${formatMoney(data.total)}</div>
      <div class="print-sigs print-sigs-2">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้จัดทำ</div><div class="print-sig-name">${escapeHtml(data.requester || '')}</div><div class="print-sig-date">วันที่ ${data.requester ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-name">คุณนิธิโรจน์ คำภานุช</div><div class="print-sig-position">ประธานบริษัท</div><div class="print-sig-date">วันที่ .............</div></div>
      </div>
    </div>
  `;
}

function buildApprovalDoc(data) {
  const rows = (data.items || []).map((item, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${escapeHtml(item.item)}</td>
      <td>${escapeHtml(item.cat)}</td>
      <td style="text-align:right">${formatMoney(item.amount)}</td>
    </tr>
  `).join('');
  return `
    <div class="print-doc">
      ${companyLetterhead()}
      <h1>บันทึกข้อความ</h1>
      <p class="print-subtitle" style="font-weight:700;font-size:15px">เรื่อง: ${escapeHtml(data.subject || 'ขออนุมัติสำรองจ่ายเงิน')}</p>
      <hr class="print-divider" />
      <div class="print-info">
        <div class="print-info-row"><span class="print-label">ลูกค้า:</span><span>${escapeHtml(data.dept)}</span></div>
        <div class="print-info-row"><span class="print-label">ที่:</span><span>${escapeHtml(data.docno)}</span></div>
        <div class="print-info-row"><span class="print-label">เรียน:</span><span>${escapeHtml(data.to || '-')}</span></div>
        <div class="print-info-row"><span class="print-label">วันที่:</span><span>${formatDate(data.date)}</span></div>
      </div>
      <p class="print-body-text">${escapeHtml(data.reason || '')}</p>
      <table>
        <thead><tr><th style="width:40px">ลำดับ</th><th>รายการ</th><th>หมวดหมู่</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">รวมทั้งสิ้น: ${formatMoney(data.total)}</div>
      <p class="print-body-text">${escapeHtml(data.note1 || '')}</p>
      <p class="print-body-text">${escapeHtml(data.note2 || '')}</p>
      <p class="print-body-text">${escapeHtml(data.closing || '')}</p>
      <div class="print-sigs print-sigs-2">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ขออนุมัติ</div><div class="print-sig-name">${escapeHtml(data.requester || '')}</div><div class="print-sig-date">วันที่ ${data.requester ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-name">คุณนิธิโรจน์ คำภานุช</div><div class="print-sig-position">ประธานบริษัท</div><div class="print-sig-date">วันที่ .............</div></div>
      </div>
    </div>
  `;
}

function doPrint() {
  if (currentPrintFn) currentPrintFn();
}

function printDocument() {
  window.print();
}

function closePrintModal() {
  document.getElementById('printModal').classList.remove('show');
}

function exportHistoryPDF() {
  if (records.length === 0) { showToast('ไม่มีรายการในประวัติ', 'warning'); return; }
  const rows = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(r.docno)}</td>
      <td>${r.type === 'petty' ? 'เงินสดย่อย' : 'สำรองจ่าย'}</td>
      <td>${escapeHtml(r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-'))}</td>
      <td>${escapeHtml(r.requester)}</td>
      <td style="text-align:right">${formatMoney(r.total)}</td>
      <td>${r.status === 'approved' ? 'อนุมัติ' : r.status === 'rejected' ? 'ไม่อนุมัติ' : 'รออนุมัติ'}</td>
      <td>${formatDate(r.date)}</td>
    </tr>
  `).join('');
  const totalAll = records.reduce((s, r) => s + (r.total || 0), 0);
  const html = `
    <div class="print-doc">
      ${companyLetterhead()}
      <h1>รายงานประวัติรายการทั้งหมด</h1>
      <p class="print-subtitle">สร้างเมื่อ: ${new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      <hr class="print-divider" />
      <table>
        <thead>
          <tr>
            <th>#</th><th>เลขที่</th><th>ประเภท</th><th>รายการ</th>
            <th>ผู้เบิก</th><th style="text-align:right">จำนวนเงิน</th><th>สถานะ</th><th>วันที่</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">ยอดรวมทั้งหมด: ${formatMoney(totalAll)}</div>
    </div>
  `;
  document.getElementById('modalTitle').textContent = 'รายงานประวัติรายการ';
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: `รายงานประวัติ.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' }
    }).from(document.getElementById('modalBody')).save();
  };
}

// ===== Utilities =====
// เติม <option> ให้อัตโนมัติถ้าค่าที่จะตั้งไม่อยู่ในตัวเลือกปัจจุบันของ select
// (เช่น แก้ไขรายการที่ผู้เบิกไม่ได้อยู่ในลิสต์ผู้เบิกของเครื่องนี้)
function setSelectValueSafe(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  if (value && ![...el.options].some(o => o.value === value)) {
    el.appendChild(new Option(value, value));
  }
  el.value = value || '';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function formatMoney(val) {
  const num = parseFloat(val) || 0;
  return '฿' + num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(val) {
  if (!val) return '-';
  const d = new Date(val);
  if (isNaN(d)) return val;
  return d.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

// แปลงตัวเลขเป็นข้อความจำนวนเงินภาษาไทย เช่น 23000 -> "สองหมื่นสามพันบาทถ้วน"
function thaiBahtText(amount) {
  const digitTh = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const placeTh = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];

  function groupToText(n) {
    const s = String(n);
    let result = '';
    const len = s.length;
    for (let i = 0; i < len; i++) {
      const d = parseInt(s[i], 10);
      const place = len - i - 1;
      if (d === 0) continue;
      if (place === 0 && d === 1 && len > 1) result += 'เอ็ด';
      else if (place === 1 && d === 2) result += 'ยี่สิบ';
      else if (place === 1 && d === 1) result += 'สิบ';
      else result += digitTh[d] + placeTh[place];
    }
    return result;
  }

  function intToText(intPart) {
    if (intPart === 0) return 'ศูนย์';
    const groups = [];
    let n = intPart;
    while (n > 0) {
      groups.unshift(n % 1000000);
      n = Math.floor(n / 1000000);
    }
    return groups.map((g, idx) => {
      if (g === 0) return '';
      return groupToText(g) + 'ล้าน'.repeat(groups.length - 1 - idx);
    }).join('');
  }

  const num = Math.abs(parseFloat(amount) || 0);
  const intPart = Math.floor(num);
  const decPart = Math.round((num - intPart) * 100);

  let result = intToText(intPart) + 'บาท';
  result += decPart > 0 ? (intToText(decPart) + 'สตางค์') : 'ถ้วน';
  return result;
}

function todayThaiDate() {
  return new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function statusBadge(status) {
  const map = {
    approved: '<span class="badge badge-green">✅ อนุมัติ</span>',
    pending: '<span class="badge badge-orange">⏳ รออนุมัติ</span>',
    rejected: '<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">❌ ไม่อนุมัติ</span>'
  };
  return map[status] || status;
}

function saveRecords() {
  localStorage.setItem('finflow_records', JSON.stringify(records));
}

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); }, 3000);
}


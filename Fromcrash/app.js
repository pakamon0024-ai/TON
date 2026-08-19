// ===== Global State =====
let records = JSON.parse(localStorage.getItem('finflow_records') || '[]');
let pettyRows = [];
let approvalRows = [];
let currentPrintFn = null;
// requesters ถูกย้ายไปจัดการใน masterdata.js แล้ว (mdRequesters)
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
  syncRequesterDropdowns();
  updateThemeToggleIcon();
});

// ===== Theme (Dark / White) =====
// data-theme ถูกตั้งค่าไว้ล่วงหน้าแล้วด้วย inline script ใน <head> ก่อนวาดหน้าจอ
// (กันการกระพริบธีม) ฟังก์ชันนี้แค่สลับค่าและอัปเดตปุ่ม
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('finflow_theme', next);
  updateThemeToggleIcon();
  // สีกราฟ Chart.js ฝังไว้ตรงๆ ไม่ได้อ่านจาก CSS variable ต้องสั่ง redraw เอง
  if (typeof icRenderDash === 'function' && document.getElementById('page-claims')?.classList.contains('active')) icRenderDash();
  if (typeof incRenderDashboard === 'function' && document.getElementById('page-incidents')?.classList.contains('active')) incRenderDashboard();
}

function updateThemeToggleIcon() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  btn.textContent = current === 'dark' ? '🌙' : '☀️';
  btn.title = current === 'dark' ? 'สลับเป็นธีมสว่าง' : 'สลับเป็นธีมมืด';
}

// ===== Force sync ข้อมูลในเครื่องนี้ขึ้น Firebase =====
// กู้คืนข้อมูลที่เคยบันทึกได้แค่ในเครื่อง (ตอนที่ Security Rules ยังบล็อกอยู่) ให้ push
// ขึ้น Firebase จริงๆ โดยไม่ต้องพิมพ์ใหม่ — แต่ละโมดูลมีฟังก์ชัน push ของตัวเองอยู่แล้ว
// (เรียกทุกครั้งหลัง add/edit/delete ตามปกติ) ปุ่มนี้แค่เรียกทั้งหมดพร้อมกันแบบ manual
async function forceSyncAllToFirebase() {
  if (typeof fbReady === 'undefined' || !fbReady) {
    showToast('ยังไม่ได้เชื่อมต่อ Firebase หรือยังไม่ได้ login ลองรีเฟรชหน้าแล้วลองใหม่', 'error');
    return;
  }
  showToast('🔄 กำลังซิงค์ข้อมูลในเครื่องนี้ขึ้น Firebase...', 'success');
  try {
    if (typeof rsPushIfReady === 'function') rsPushIfReady();
    if (typeof icWriteFB === 'function') await icWriteFB();
    if (typeof mdPushIfReady === 'function') mdPushIfReady();
    if (typeof incPushIfReady === 'function') incPushIfReady();
    if (typeof wiPushIfReady === 'function') wiPushIfReady();
    if (typeof alcPushIfReady === 'function') alcPushIfReady();
    setTimeout(() => showToast('✅ ซิงค์เสร็จแล้ว ให้คนอื่นลองรีเฟรชหน้าเว็บดู', 'success'), 700);
  } catch (e) {
    showToast('เกิดข้อผิดพลาดระหว่างซิงค์: ' + e.message, 'error');
  }
}

// ลงทะเบียน Service Worker เพื่อให้ Chrome เสนอปุ่ม "ติดตั้งแอป" (ต้อง serve ผ่าน HTTPS)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW register failed:', err));
  });
}

function updateCurrentDate() {
  const el = document.getElementById('currentDate');
  const now = new Date();
  const weekday = now.toLocaleDateString('th-TH', { weekday: 'long' });
  el.textContent = `${weekday}ที่ ${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;
}

function setToday() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('pc-date').value = today;
  document.getElementById('ap-date').value = today;
}

function autoDocNo() {
  const now = new Date();
  const yr = now.getFullYear();
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
    masterdata: 'ฐานข้อมูลหลัก',
    users: 'จัดการผู้ใช้',
    incidents: 'บันทึกอุบัติเหตุ',
    issues: 'บันทึกปัญหาการทำงาน',
    alcohol: 'บันทึกการเป่าวัดแอลกอฮอล์',
    jointvehicle: 'บันทึกรถร่วม',
    gpscctv: 'จัดการ GPS/CCTV',
    backup: 'สำรองข้อมูล'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '';

  if (page === 'dashboard') renderDashboard();
  if (page === 'history') renderHistory();
  if (page === 'claims' && typeof icOnPageShown === 'function') icOnPageShown();
  if (page === 'masterdata' && typeof renderMasterData === 'function') renderMasterData();
  if (page === 'users' && typeof renderUsersPage === 'function') renderUsersPage();
  if (page === 'incidents' && typeof incOnPageShown === 'function') incOnPageShown();
  if (page === 'issues' && typeof wiOnPageShown === 'function') wiOnPageShown();
  if (page === 'tickets' && typeof tkOnPageShown === 'function') tkOnPageShown();
  if (page === 'alcohol' && typeof alcOnPageShown === 'function') alcOnPageShown();
  if (page === 'jointvehicle' && typeof jvOnPageShown === 'function') jvOnPageShown();
  if (page === 'gpscctv' && typeof gcOnPageShown === 'function') gcOnPageShown();
  if (page === 'backup' && typeof bkOnPageShown === 'function') bkOnPageShown();
  if (page === 'petty-cash') refreshCategoryDropdowns('pc');
  if (page === 'approval') refreshCategoryDropdowns('ap');

  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ===== Requester Dropdowns (ข้อมูลจาก mdRequesters ใน masterdata.js) =====
function syncRequesterDropdowns() {
  const placeholders = {
    'pc-requester': '-- เลือกผู้เบิก --',
    'ap-requester': '-- เลือกผู้ขออนุมัติ --',
    'pc-reviewer': '-- เลือกผู้ตรวจสอบ --',
    'ap-reviewer': '-- เลือกผู้ตรวจสอบ --',
    'pc-approver': '-- เลือกผู้อนุมัติ --',
    'ap-approver': '-- เลือกผู้อนุมัติ --',
  };
  const list = (typeof mdRequesters !== 'undefined') ? mdRequesters : [];
  Object.keys(placeholders).forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${placeholders[id]}</option>` +
      list.map(r => `<option value="${escapeHtml(r)}" ${r === current ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
  });
  attachRequesterListeners();
}

function attachRequesterListeners() {
  const pcSel = document.getElementById('pc-requester');
  const apSel = document.getElementById('ap-requester');
  const pcReviewerSel = document.getElementById('pc-reviewer');
  const apReviewerSel = document.getElementById('ap-reviewer');
  const pcApproverSel = document.getElementById('pc-approver');
  const apApproverSel = document.getElementById('ap-approver');
  if (pcSel) {
    pcSel.onchange = () => updateSignature('pc');
    // trigger if already has value
    updateSignature('pc');
  }
  if (apSel) {
    apSel.onchange = () => updateSignature('ap');
    updateSignature('ap');
  }
  if (pcReviewerSel) {
    pcReviewerSel.onchange = () => updateSignature('pc', 'reviewer');
    updateSignature('pc', 'reviewer');
  }
  if (apReviewerSel) {
    apReviewerSel.onchange = () => updateSignature('ap', 'reviewer');
    updateSignature('ap', 'reviewer');
  }
  if (pcApproverSel) {
    pcApproverSel.onchange = () => updateSignature('pc', 'approver');
    updateSignature('pc', 'approver');
  }
  if (apApproverSel) {
    apApproverSel.onchange = () => updateSignature('ap', 'approver');
    updateSignature('ap', 'approver');
  }
}

function updateSignature(prefix, field = 'requester') {
  const sel = document.getElementById(field === 'requester' ? `${prefix}-requester` : `${prefix}-${field}`);
  const idBase = field === 'requester' ? prefix : `${prefix}-${field}`;
  const sigName = document.getElementById(`${idBase}-sig-name`);
  const sigDate = document.getElementById(`${idBase}-sig-date`);
  if (!sel || !sigName || !sigDate) return;

  const name = sel.value;
  if (name) {
    sigName.textContent = name;
    const now = new Date();
    const day   = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year  = now.getFullYear();
    sigDate.textContent = `วันที่ ${day}/${month}/${year}`;
    sigName.style.opacity = '1';
  } else {
    sigName.textContent = '';
    sigDate.textContent = 'วันที่ ........./........./........';
    sigName.style.opacity = '0.4';
  }
}


// ===== Categories =====
// หมวดหมู่ค่าใช้จ่ายจัดการได้เองที่เมนู "ฐานข้อมูลหลัก" (localStorage: finflow_categories_db)
// อ่านสดทุกครั้งที่ render dropdown เพื่อให้เห็นหมวดหมู่ที่เพิ่ง เพิ่ม/ลบ ไว้ทันที
function refreshCategoryDropdowns(prefix) {
  document.querySelectorAll(`select[id^="${prefix}-cat-"]`).forEach(sel => {
    sel.innerHTML = categoryOptions(sel.value);
  });
}

function categoryOptions(selected = '') {
  const categories = JSON.parse(localStorage.getItem('finflow_categories_db') || '[]');
  if (categories.length === 0) {
    return `<option value="">-- ยังไม่มีหมวดหมู่ (เพิ่มได้ที่ฐานข้อมูลหลัก) --</option>`;
  }
  return categories.map(c =>
    `<option value="${escapeHtml(c)}" ${c === selected ? 'selected' : ''}>${escapeHtml(c)}</option>`
  ).join('');
}

// ===== Petty Cash =====
function pettyRowHtml(row, index) {
  return `
    <tr id="petty-row-${row.id}">
      <td style="text-align:center;color:var(--text-muted);font-size:0.82rem" class="row-index">${index}</td>
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
  `;
}

function addPettyRow(item = '') {
  const idx = pettyRows.length;
  const row = { id: Date.now() + idx };
  pettyRows.push(row);
  // เติมแถวใหม่ต่อท้ายเฉยๆ ไม่แตะแถวเดิม ป้องกันข้อมูลที่พิมพ์ไปแล้วหาย
  document.getElementById('pettyItemsBody').insertAdjacentHTML('beforeend', pettyRowHtml(row, pettyRows.length));
  calcPettyTotal();
}

function removePettyRow(id) {
  pettyRows = pettyRows.filter(r => r.id !== id);
  document.getElementById(`petty-row-${id}`)?.remove();
  document.querySelectorAll('#pettyItemsBody .row-index').forEach((el, i) => { el.textContent = i + 1; });
  calcPettyTotal();
}

function renderPettyRows() {
  const tbody = document.getElementById('pettyItemsBody');
  tbody.innerHTML = pettyRows.map((row, i) => pettyRowHtml(row, i + 1)).join('');
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
    reviewer: document.getElementById('pc-reviewer').value,
    approver: document.getElementById('pc-approver').value,
    purpose: document.getElementById('pc-purpose').value,
    detail: document.getElementById('pc-detail').value,
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
        docno: data.docno, dept: data.dept, requester: data.requester, reviewer: data.reviewer, approver: data.approver,
        purpose: data.purpose, detail: data.detail, date: data.date, items: data.items, total: data.total,
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
      reviewer: data.reviewer,
      approver: data.approver,
      purpose: data.purpose,
      detail: data.detail,
      date: data.date,
      items: data.items,
      total: data.total,
      status: 'pending',
      savedAt: new Date().toISOString()
    };
    records.unshift(record);
    showToast('✅ บันทึกรายการเงินสดย่อยแล้ว!', 'success');
    autoDocNo();
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `💵 <b>บันทึกเงินสดย่อยใหม่</b>\nเลขที่: ${escapeHtml(record.docno)}\nผู้เบิก: ${escapeHtml(record.requester)}\nวัตถุประสงค์: ${escapeHtml(record.purpose || '-')}\nยอดรวม: ${formatMoney(record.total)}`
      );
    }
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
  document.getElementById('pc-detail').value = '';
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
  document.getElementById('pc-detail').value = rec.detail || '';
  setSelectValueSafe('pc-reviewer', rec.reviewer || '');
  updateSignature('pc', 'reviewer');
  setSelectValueSafe('pc-approver', rec.approver || '');
  updateSignature('pc', 'approver');

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
function approvalRowHtml(row, index) {
  return `
    <tr id="ap-row-${row.id}">
      <td style="text-align:center;color:var(--text-muted);font-size:0.82rem" class="row-index">${index}</td>
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
  `;
}

function addApprovalRow() {
  const idx = approvalRows.length;
  const row = { id: Date.now() + idx + 1000 };
  approvalRows.push(row);
  document.getElementById('approvalItemsBody').insertAdjacentHTML('beforeend', approvalRowHtml(row, approvalRows.length));
  calcApprovalTotal();
}

function removeApprovalRow(id) {
  approvalRows = approvalRows.filter(r => r.id !== id);
  document.getElementById(`ap-row-${id}`)?.remove();
  document.querySelectorAll('#approvalItemsBody .row-index').forEach((el, i) => { el.textContent = i + 1; });
  calcApprovalTotal();
}

function renderApprovalRows() {
  const tbody = document.getElementById('approvalItemsBody');
  tbody.innerHTML = approvalRows.map((row, i) => approvalRowHtml(row, i + 1)).join('');
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
    reviewer: document.getElementById('ap-reviewer').value,
    approver: document.getElementById('ap-approver').value,
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
        docno: data.docno, dept: data.dept, requester: data.requester, reviewer: data.reviewer, approver: data.approver,
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
      reviewer: data.reviewer,
      approver: data.approver,
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
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `📝 <b>บันทึกขออนุมัติสำรองจ่ายใหม่</b>\nเลขที่: ${escapeHtml(record.docno)}\nลูกค้า: ${escapeHtml(record.dept || '-')}\nเรื่อง: ${escapeHtml(record.subject || '-')}\nยอดรวม: ${formatMoney(record.total)}`
      );
    }
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
  setSelectValueSafe('ap-reviewer', data.reviewer || '');
  updateSignature('ap', 'reviewer');
  setSelectValueSafe('ap-approver', data.approver || '');
  updateSignature('ap', 'approver');
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

// ===== ยืนยันการลบด้วยรหัส (ใช้แทน confirm() ธรรมดาทุกจุดที่มีการลบข้อมูลในระบบ) =====
const DELETE_CONFIRM_PIN = '1234';
function confirmDeleteWithPin(message) {
  if (!confirm(message)) return false;
  const pin = prompt('กรุณาใส่รหัสยืนยันการลบ (4 หลัก):');
  if (pin === null) return false;
  if (pin.trim() !== DELETE_CONFIRM_PIN) {
    showToast('รหัสไม่ถูกต้อง ยกเลิกการลบ', 'error');
    return false;
  }
  return true;
}

function deleteRecord(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  records = records.filter(r => r.id !== id);
  saveRecords(); rsPushIfReady(); renderHistory(); renderDashboard();
  showToast('ลบรายการแล้ว', 'warning');
}

function clearAllHistory() {
  if (!confirmDeleteWithPin('ยืนยันการล้างประวัติทั้งหมด?')) return;
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
      margin: [8, 8, 8, 8],
      filename: `เงินสดย่อย_${data.docno}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] }
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
      margin: [8, 8, 8, 8],
      filename: `อนุมัติสำรองจ่าย_${data.docno}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] }
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
        ${data.detail ? `<div class="print-info-row" style="grid-column:1/-1"><span class="print-label">รายละเอียด:</span><span>${escapeHtml(data.detail)}</span></div>` : ''}
      </div>
      <table>
        <thead><tr><th style="width:40px">ลำดับ</th><th>รายการ</th><th>หมวดหมู่</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">รวมทั้งสิ้น: ${formatMoney(data.total)}</div>
      <div class="print-sigs">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้จัดทำ</div><div class="print-sig-name">${escapeHtml(data.requester || '')}</div><div class="print-sig-date">วันที่ ${data.requester ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ตรวจสอบ</div><div class="print-sig-name">${escapeHtml(data.reviewer || '')}</div><div class="print-sig-date">วันที่ ${data.reviewer ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-name">${escapeHtml(data.approver || '')}</div><div class="print-sig-date">วันที่ ${data.approver ? todayThaiDate() : '.............'}</div></div>
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
      <div class="print-sigs">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ขออนุมัติ</div><div class="print-sig-name">${escapeHtml(data.requester || '')}</div><div class="print-sig-date">วันที่ ${data.requester ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ตรวจสอบ</div><div class="print-sig-name">${escapeHtml(data.reviewer || '')}</div><div class="print-sig-date">วันที่ ${data.reviewer ? todayThaiDate() : '.............'}</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-name">${escapeHtml(data.approver || '')}</div><div class="print-sig-date">วันที่ ${data.approver ? todayThaiDate() : '.............'}</div></div>
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
      <p class="print-subtitle">สร้างเมื่อ: ${todayThaiDate()}</p>
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
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
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
  const d = new Date();
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
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


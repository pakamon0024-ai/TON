// ===== Global State =====
let records = JSON.parse(localStorage.getItem('finflow_records') || '[]');
let pettyRows = [];
let approvalRows = [];
let currentPrintFn = null;

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setToday();
  renderDashboard();
  renderHistory();
  addPettyRow();
  addApprovalRow();
  updateCurrentDate();
  autoDocNo();
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
    history: 'ประวัติรายการ'
  };
  document.getElementById('pageTitle').textContent = titles[page] || '';

  if (page === 'dashboard') renderDashboard();
  if (page === 'history') renderHistory();

  // close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
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
  saveRecords();
  showToast('✅ บันทึกรายการเงินสดย่อยแล้ว!', 'success');
  renderDashboard();
  autoDocNo();
}

function clearPettyCash() {
  pettyRows = [];
  renderPettyRows();
  addPettyRow();
  setToday();
  autoDocNo();
  showToast('ล้างข้อมูลแล้ว', 'warning');
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
    closing: document.getElementById('ap-closing').value,
    items, total
  };
}

function saveApproval() {
  const data = getApprovalData();
  if (!data.docno || !data.requester || data.items.length === 0) {
    showToast('กรุณากรอกข้อมูลให้ครบถ้วน', 'error'); return;
  }
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
  saveRecords();
  showToast('✅ บันทึกหนังสือขออนุมัติแล้ว!', 'success');
  renderDashboard();
  autoDocNo();
}

function clearApproval() {
  approvalRows = [];
  renderApprovalRows();
  addApprovalRow();
  setToday();
  autoDocNo();
  showToast('ล้างข้อมูลแล้ว', 'warning');
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
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีรายการ</td></tr>';
  } else {
    tbody.innerHTML = recent.map(r => `
      <tr>
        <td style="font-family:monospace;font-size:0.82rem">${r.docno}</td>
        <td>${r.type === 'petty' ? '<span class="badge badge-blue">💵 เงินสดย่อย</span>' : '<span class="badge badge-purple">📝 สำรองจ่าย</span>'}</td>
        <td>${r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-')}</td>
        <td style="font-weight:600;color:var(--accent-green)">${formatMoney(r.total)}</td>
        <td>${statusBadge(r.status)}</td>
        <td style="font-size:0.8rem;color:var(--text-muted)">${formatDate(r.date)}</td>
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
        <td style="font-family:monospace;font-size:0.82rem">${r.docno}</td>
        <td>${r.type === 'petty' ? '<span class="badge badge-blue">💵 เงินสดย่อย</span>' : '<span class="badge badge-purple">📝 สำรองจ่าย</span>'}</td>
        <td>${r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-')}</td>
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
            <button class="action-btn action-delete" onclick="deleteRecord(${r.id})">ลบ</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

function changeStatus(id, status) {
  const rec = records.find(r => r.id === id);
  if (rec) { rec.status = status; saveRecords(); renderDashboard(); }
}

function deleteRecord(id) {
  if (!confirm('ยืนยันการลบรายการนี้?')) return;
  records = records.filter(r => r.id !== id);
  saveRecords(); renderHistory(); renderDashboard();
  showToast('ลบรายการแล้ว', 'warning');
}

function clearAllHistory() {
  if (!confirm('ยืนยันการล้างประวัติทั้งหมด?')) return;
  records = []; saveRecords(); renderHistory(); renderDashboard();
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

function buildPettyCashDoc(data) {
  const rows = (data.items || []).map((item, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${item.item}</td>
      <td>${item.cat}</td>
      <td style="text-align:right">${formatMoney(item.amount)}</td>
    </tr>
  `).join('');
  return `
    <div class="print-doc">
      <h1>ใบสำคัญจ่ายเงินสดย่อย</h1>
      <p class="print-subtitle">Petty Cash Voucher</p>
      <hr class="print-divider" />
      <div class="print-info">
        <div class="print-info-row"><span class="print-label">หน่วยงาน:</span><span>${data.dept}</span></div>
        <div class="print-info-row"><span class="print-label">เลขที่เอกสาร:</span><span>${data.docno}</span></div>
        <div class="print-info-row"><span class="print-label">ผู้เบิก:</span><span>${data.requester}</span></div>
        <div class="print-info-row"><span class="print-label">วันที่:</span><span>${formatDate(data.date)}</span></div>
        <div class="print-info-row" style="grid-column:1/-1"><span class="print-label">วัตถุประสงค์:</span><span>${data.purpose}</span></div>
      </div>
      <table>
        <thead><tr><th style="width:40px">ลำดับ</th><th>รายการ</th><th>หมวดหมู่</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">รวมทั้งสิ้น: ${formatMoney(data.total)}</div>
      <div class="print-sigs">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้เบิก</div><div class="print-sig-date">วันที่ .............</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ตรวจสอบ</div><div class="print-sig-date">วันที่ .............</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-date">วันที่ .............</div></div>
      </div>
    </div>
  `;
}

function buildApprovalDoc(data) {
  const rows = (data.items || []).map((item, i) => `
    <tr>
      <td style="text-align:center">${i + 1}</td>
      <td>${item.item}</td>
      <td>${item.cat}</td>
      <td style="text-align:right">${formatMoney(item.amount)}</td>
    </tr>
  `).join('');
  return `
    <div class="print-doc">
      <h1>บันทึกข้อความ</h1>
      <p class="print-subtitle" style="font-weight:700;font-size:15px">เรื่อง: ${data.subject || 'ขออนุมัติสำรองจ่ายเงิน'}</p>
      <hr class="print-divider" />
      <div class="print-info">
        <div class="print-info-row"><span class="print-label">ส่วนราชการ:</span><span>${data.dept}</span></div>
        <div class="print-info-row"><span class="print-label">ที่:</span><span>${data.docno}</span></div>
        <div class="print-info-row"><span class="print-label">เรียน:</span><span>${data.to}</span></div>
        <div class="print-info-row"><span class="print-label">วันที่:</span><span>${formatDate(data.date)}</span></div>
      </div>
      <p class="print-body-text">${data.reason || ''}</p>
      <table>
        <thead><tr><th style="width:40px">ลำดับ</th><th>รายการ</th><th>หมวดหมู่</th><th style="text-align:right">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="print-total">รวมทั้งสิ้น: ${formatMoney(data.total)}</div>
      <p class="print-body-text">${data.closing || ''}</p>
      <div class="print-sigs">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ขออนุมัติ</div><div class="print-sig-date">${data.requester || ''}</div><div class="print-sig-date">วันที่ .............</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้บังคับบัญชา</div><div class="print-sig-date">วันที่ .............</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้อนุมัติ</div><div class="print-sig-date">วันที่ .............</div></div>
      </div>
    </div>
  `;
}

function doPrint() {
  if (currentPrintFn) currentPrintFn();
}

function closePrintModal() {
  document.getElementById('printModal').classList.remove('show');
}

function exportHistoryPDF() {
  if (records.length === 0) { showToast('ไม่มีรายการในประวัติ', 'warning'); return; }
  const rows = records.map((r, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${r.docno}</td>
      <td>${r.type === 'petty' ? 'เงินสดย่อย' : 'สำรองจ่าย'}</td>
      <td>${r.type === 'petty' ? (r.purpose || '-') : (r.subject || '-')}</td>
      <td>${r.requester}</td>
      <td style="text-align:right">${formatMoney(r.total)}</td>
      <td>${r.status === 'approved' ? 'อนุมัติ' : r.status === 'rejected' ? 'ไม่อนุมัติ' : 'รออนุมัติ'}</td>
      <td>${formatDate(r.date)}</td>
    </tr>
  `).join('');
  const totalAll = records.reduce((s, r) => s + (r.total || 0), 0);
  const html = `
    <div class="print-doc">
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

// ===== Sample Data (first run) =====
if (records.length === 0) {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yr = now.getFullYear() + 543;
  const m = String(now.getMonth() + 1).padStart(2, '0');
  records = [
    {
      id: 1, type: 'petty', docno: `PC-${yr}${m}-001`,
      dept: 'ฝ่ายการเงิน', requester: 'นายสมชาย ใจดี',
      purpose: 'ค่าวัสดุสำนักงาน', date: today,
      items: [
        { no: 1, item: 'กระดาษ A4', cat: 'ค่าวัสดุสำนักงาน', amount: 350 },
        { no: 2, item: 'ปากกา/ดินสอ', cat: 'ค่าวัสดุสำนักงาน', amount: 180 },
      ],
      total: 530, status: 'approved', savedAt: new Date().toISOString()
    },
    {
      id: 2, type: 'approval', docno: `AP-${yr}${m}-001`,
      dept: 'ฝ่ายการตลาด', requester: 'นางสาวสุดา มีสุข',
      subject: 'ขออนุมัติสำรองจ่ายค่าจัดงาน', date: today,
      items: [
        { no: 1, item: 'ค่าสถานที่จัดงาน', cat: 'ค่าเดินทาง', amount: 15000 },
        { no: 2, item: 'ค่าอาหารและเครื่องดื่ม', cat: 'ค่าอาหาร/เครื่องดื่ม', amount: 8000 },
      ],
      total: 23000, status: 'pending', savedAt: new Date().toISOString()
    },
    {
      id: 3, type: 'petty', docno: `PC-${yr}${m}-002`,
      dept: 'ฝ่าย IT', requester: 'นายวิชัย เก่งดี',
      purpose: 'ค่าซื้ออุปกรณ์ IT', date: today,
      items: [
        { no: 1, item: 'สาย LAN', cat: 'ค่าวัสดุสำนักงาน', amount: 500 },
      ],
      total: 500, status: 'pending', savedAt: new Date().toISOString()
    }
  ];
  saveRecords();
}

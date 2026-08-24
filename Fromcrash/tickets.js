// ===== ระบบบันทึกใบสั่ง =====
// เก็บ local ที่ localStorage key 'finflow_tickets' และ sync กับ Firebase ที่ /tickets

let tickets = JSON.parse(localStorage.getItem('finflow_tickets') || '[]');
let tkEditingId = null;
let tkRef = null;
let tkReady = false;
let tkSortField = null; // null = ใช้ลำดับ default (วันที่กระทำผิดใหม่สุดก่อน)
let tkSortDir = 1;

const TK_NUMERIC_FIELDS = ['runningNo', 'fineAmount'];
const TK_DATE_FIELDS = ['date', 'receivedDate', 'dueDate'];

const TK_XLSX_HEADERS = ['ลำดับที่','วันที่กระทำผิด','เวลา','ทะเบียน','พนักงานขับรถ','หน่วยงาน','ลานจอด','เลขที่ใบสั่ง','ข้อหา','สถานที่เกิดเหตุ','วันที่รับใบสั่ง','วันครบกำหนดชำระ','จำนวนค่าปรับ','หมายเหตุ'];
const TK_XLSX_COLWIDTHS = [8, 14, 10, 14, 18, 16, 12, 14, 20, 20, 14, 16, 12, 30];

function tkSave() { localStorage.setItem('finflow_tickets', JSON.stringify(tickets)); }

// ===== Sub-tabs =====
function tkSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`tk-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`tk-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') tkRenderList();
  if (tab === 'add' && !tkEditingId) tkClearForm();
}

function tkOnPageShown() {
  tkRefreshLookupDropdowns();
  tkRenderList();
}

// ===== Lookup dropdowns =====
function tkFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function tkFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}

function tkRefreshLookupDropdowns() {
  tkFillDatalist('tk-employee-list', (mdDrivers || []).map(d => d.name).filter(Boolean));
  tkFillDatalist('tk-plate-list', (mdVehicles || []).map(v => v.plate).filter(Boolean));
  tkFillDatalist('tk-bu-list', mdBusinessUnits);
  tkFillDatalist('tk-yard-list', mdYards);
  tkFillSelect('tk-f-yard', mdYards);
}

function tkLookupVehicle() {
  const plate = document.getElementById('tk-plate').value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('tk-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('tk-yard').value = veh.yard;
  }
}

// ===== Running number =====
function tkNextRunningNo() {
  return tickets.length ? Math.max(...tickets.map(t => t.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function tkSaveCase() {
  const date = document.getElementById('tk-date').value;
  const plate = document.getElementById('tk-plate').value.trim();
  const charge = document.getElementById('tk-charge').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่กระทำผิด', 'warning'); return; }
  if (!plate) { showToast('กรุณาระบุทะเบียน', 'warning'); return; }
  if (!charge) { showToast('กรุณาระบุข้อหา', 'warning'); return; }

  const record = {
    date, plate, charge,
    time: document.getElementById('tk-time').value,
    employeeName: document.getElementById('tk-employee').value.trim(),
    businessUnit: document.getElementById('tk-bu').value.trim(),
    yard: document.getElementById('tk-yard').value.trim(),
    ticketNo: document.getElementById('tk-ticketno').value.trim(),
    location: document.getElementById('tk-location').value.trim(),
    receivedDate: document.getElementById('tk-received').value,
    dueDate: document.getElementById('tk-due').value,
    fineAmount: parseFloat(document.getElementById('tk-fine').value) || 0,
    note: document.getElementById('tk-note').value.trim(),
  };

  if (tkEditingId) {
    const idx = tickets.findIndex(t => t.id === tkEditingId);
    if (idx >= 0) {
      tickets[idx] = { ...tickets[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('บันทึกการแก้ไขแล้ว', 'success');
      if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(`✏️ <b>แก้ไขบันทึกใบสั่ง</b>\nเลขที่: ${tickets[idx].runningNo}\nทะเบียน: ${escapeHtml(plate)}\nข้อหา: ${escapeHtml(charge)}`);
      }
    }
    tkCancelEdit();
  } else {
    record.id = 'TK_' + Date.now();
    record.runningNo = tkNextRunningNo();
    record.createdAt = new Date().toISOString();
    tickets.unshift(record);
    showToast('บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🎫 <b>บันทึกใบสั่งใหม่</b>\nเลขที่: ${record.runningNo}\nทะเบียน: ${escapeHtml(plate)}\nพนักงาน: ${escapeHtml(record.employeeName)}\nข้อหา: ${escapeHtml(charge)}\nเงินที่ปรับ: ${formatMoney(record.fineAmount)}`
      );
    }
    tkClearForm();
  }
  tkSave();
  tkPushIfReady();
  tkRenderList();
}

function tkClearForm() {
  tkEditingId = null;
  document.getElementById('tk-edit-banner').style.display = 'none';
  document.getElementById('tk-date').value = '';
  tmSetTimeValue('tk-time', '');
  document.getElementById('tk-plate').value = '';
  document.getElementById('tk-employee').value = '';
  document.getElementById('tk-bu').value = '';
  document.getElementById('tk-yard').value = '';
  document.getElementById('tk-ticketno').value = '';
  document.getElementById('tk-charge').value = '';
  document.getElementById('tk-location').value = '';
  document.getElementById('tk-received').value = '';
  document.getElementById('tk-due').value = '';
  document.getElementById('tk-fine').value = '';
  document.getElementById('tk-note').value = '';
}

function tkEditCase(id) {
  const rec = tickets.find(t => t.id === id);
  if (!rec) return;
  tkEditingId = id;
  document.getElementById('tk-edit-banner').style.display = 'flex';
  document.getElementById('tk-edit-no').textContent = rec.runningNo;
  document.getElementById('tk-date').value = rec.date || '';
  tmSetTimeValue('tk-time', rec.time || '');
  document.getElementById('tk-plate').value = rec.plate || '';
  document.getElementById('tk-employee').value = rec.employeeName || '';
  document.getElementById('tk-bu').value = rec.businessUnit || '';
  document.getElementById('tk-yard').value = rec.yard || '';
  document.getElementById('tk-ticketno').value = rec.ticketNo || '';
  document.getElementById('tk-charge').value = rec.charge || '';
  document.getElementById('tk-location').value = rec.location || '';
  document.getElementById('tk-received').value = rec.receivedDate || '';
  document.getElementById('tk-due').value = rec.dueDate || '';
  document.getElementById('tk-fine').value = rec.fineAmount || '';
  document.getElementById('tk-note').value = rec.note || '';
  tkSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function tkCancelEdit() { tkClearForm(); }

function tkDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  tickets = tickets.filter(t => t.id !== id);
  tkSave();
  tkPushIfReady();
  tkRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function tkFilteredList() {
  const yard = document.getElementById('tk-f-yard')?.value || '';
  const search = (document.getElementById('tk-f-search')?.value || '').toLowerCase().trim();
  const filtered = tickets.filter(t => {
    if (yard && t.yard !== yard) return false;
    if (search && !(`${t.plate} ${t.employeeName} ${t.businessUnit} ${t.charge} ${t.ticketNo} ${t.location} ${t.note}`.toLowerCase().includes(search))) return false;
    return true;
  });
  if (!tkSortField) return filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  return filtered.sort((a, b) => tkCompareValues(a, b, tkSortField) * tkSortDir);
}

function tkCompareValues(a, b, field) {
  const av = a[field], bv = b[field];
  if (TK_NUMERIC_FIELDS.includes(field)) return (av || 0) - (bv || 0);
  if (TK_DATE_FIELDS.includes(field)) return new Date(av || 0) - new Date(bv || 0);
  return String(av || '').localeCompare(String(bv || ''), 'th');
}

function tkSortBy(field) {
  if (tkSortField === field) tkSortDir *= -1;
  else { tkSortField = field; tkSortDir = 1; }
  tkRenderList();
}

function tkUpdateSortIndicators() {
  document.querySelectorAll('.tk-sort-ind').forEach(el => { el.textContent = ''; });
  if (!tkSortField) return;
  const ind = document.getElementById(`tk-sort-ind-${tkSortField}`);
  if (ind) ind.textContent = tkSortDir === 1 ? '▲' : '▼';
}

function tkClearListFilters() {
  ['tk-f-yard', 'tk-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  tkRenderList();
}

function tkRenderList() {
  const list = tkFilteredList();
  const tbody = document.getElementById('tk-list-body');
  const countEl = document.getElementById('tk-list-count');
  if (!tbody) return;
  tkUpdateSortIndicators();
  const total = list.reduce((s, t) => s + (t.fineAmount || 0), 0);
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ · รวมค่าปรับ ${formatMoney(total)}`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="15" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => `
    <tr>
      <td>${t.runningNo}</td>
      <td>${formatDate(t.date)}</td>
      <td>${escapeHtml(t.time || '-')}</td>
      <td style="font-family:monospace">${escapeHtml(t.plate || '-')}</td>
      <td>${escapeHtml(t.employeeName || '-')}</td>
      <td>${escapeHtml(t.businessUnit || '-')}</td>
      <td>${escapeHtml(t.yard || '-')}</td>
      <td>${escapeHtml(t.ticketNo || '-')}</td>
      <td>${escapeHtml(t.charge || '-')}</td>
      <td>${escapeHtml(t.location || '-')}</td>
      <td>${formatDate(t.receivedDate)}</td>
      <td>${formatDate(t.dueDate)}</td>
      <td>${formatMoney(t.fineAmount)}</td>
      <td>${escapeHtml(t.note || '-')}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="action-btn action-view" onclick="tkEditCase('${t.id}')">แก้ไข</button>
          <button class="action-btn" onclick="tkShowMemoPrint('${t.id}')">🖨️ พิมพ์</button>
          <button class="action-btn action-delete" onclick="tkDeleteCase('${t.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ===== พิมพ์บันทึกข้อความขออนุมัติหักเงิน (ต่อรายการใบสั่ง) =====
function tkBuddhistDate(val) {
  if (!val) return '............';
  const d = new Date(val);
  if (isNaN(d)) return '............';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
}

function tkBuildMemoDoc(t) {
  const timeDisplay = (t.time || '').replace(':', '.') || '............';
  return `
    <div class="print-doc tk-memo-doc">
      ${companyLetterhead()}
      <h1>บันทึกข้อความ</h1>
      <div class="print-info" style="grid-template-columns:1fr 1fr;margin-top:6px;">
        <div class="print-info-row"><span class="print-label">หน่วยงานความปลอดภัย</span></div>
        <div class="print-info-row" style="justify-content:flex-end;"><span class="print-label" style="min-width:auto;">วันที่ ${tkBuddhistDate(new Date().toISOString().slice(0, 10))}</span></div>
      </div>
      <p class="print-body-text" style="text-indent:0;font-weight:700;">เรื่อง&nbsp;&nbsp;ขออนุมัติหักเงิน พนักงานขับรถฝ่าฝืนกฎหมายกำหนด</p>
      <hr class="print-divider" />
      <p class="print-body-text" style="text-indent:0;">เรียน&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;ฝ่ายทรัพยากรบุคคล</p>
      <p class="print-body-text" style="text-indent:0;font-weight:700;">สำเนาเรียน&nbsp;&nbsp;ผู้จัดการทั่วไป</p>
      <p class="print-body-text" style="text-indent:0;">สิ่งที่ส่งมาด้วย&nbsp;&nbsp;1. สำเนาใบสั่งเจ้าพนักงานจราจร</p>
      <p class="print-body-text">
        เนื่องด้วย ${escapeHtml(t.employeeName || '............')} หน่วยงาน ${escapeHtml(t.businessUnit || '............')}
        ลานจอด ${escapeHtml(t.yard || '............')}
        ทะเบียน ${escapeHtml(t.plate || '............')} ปฏิบัติงาน เมื่อ วันที่ ${tkBuddhistDate(t.date)}
        เวลา ${escapeHtml(timeDisplay)} น. <u>${escapeHtml(t.charge || '............')}</u>
        หลักฐานตามเอกสารแนบ (ใบสั่งจราจร)
      </p>
      <p class="print-body-text">
        เพื่อเป็นหลักฐานตกลงยินยอม ชดใช้ค่าใบสั่งเจ้าพนักงานจราจร ซึ่งเกิดจากการกระทำ ของพนักงาน
        โดยมีค่าปรับจำนวน ${formatMoney(t.fineAmount).replace('฿', '')} บาท
      </p>
      <div class="print-sigs print-sigs-2">
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้บันทึก</div><div class="print-sig-name">(นางสาว บัณฑิตา ชูบุญ)</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">พนักงาน</div><div class="print-sig-name">(${escapeHtml(t.employeeName || '')})</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">หัวหน้าลานจอด</div><div class="print-sig-name">(......................)</div></div>
        <div class="print-sig"><div class="print-sig-line"></div><div class="print-sig-label">ผู้ตรวจสอบ</div><div class="print-sig-name">(......................)</div></div>
      </div>
    </div>
  `;
}

function tkShowMemoPrint(id) {
  const t = tickets.find(x => x.id === id);
  if (!t) return;
  const html = tkBuildMemoDoc(t);
  document.getElementById('modalTitle').textContent = `บันทึกข้อความขออนุมัติหักเงิน - ${escapeHtml(t.plate || '')}`;
  document.getElementById('modalBody').innerHTML = html;
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    const el = document.getElementById('modalBody');
    html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: `บันทึกใบสั่ง_${t.plate || t.runningNo}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] },
    }).from(el).save();
  };
}

// ===== Excel Export / Import / Template =====
function tkExportExcel() {
  if (!tickets.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [TK_XLSX_HEADERS, ...tickets.map(t => [
    t.runningNo, t.date, t.time || '', t.plate || '', t.employeeName || '', t.businessUnit || '', t.yard || '',
    t.ticketNo || '', t.charge || '', t.location || '', t.receivedDate || '', t.dueDate || '', t.fineAmount || 0, t.note || '',
  ])];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = TK_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'บันทึกใบสั่ง');
  XLSX.writeFile(wb, 'บันทึกใบสั่ง_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

function tkDownloadTemplate() {
  const sample = [
    TK_XLSX_HEADERS,
    ['', '2026-01-15', '09:30', '1กข 1234', 'สมชาย ใจดี', 'Trailer', 'ABC', 'T-0001', 'จอดรถผิดที่', 'หน้าโรงงาน', '2026-01-16', '2026-01-31', '500', 'ตัวอย่างหมายเหตุ'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = TK_XLSX_COLWIDTHS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.writeFile(wb, 'Template_บันทึกใบสั่ง.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

function tkImportExcel(evt) {
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
        if (!row[3] && !row[4]) return;
        const rec = {
          id: 'TK_IMP_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
          runningNo: tkNextRunningNo(),
          date: normalizeImportDate(row[1]),
          time: String(row[2] || '').trim(),
          plate: String(row[3] || '').trim(),
          employeeName: String(row[4] || '').trim(),
          businessUnit: String(row[5] || '').trim(),
          yard: String(row[6] || '').trim(),
          ticketNo: String(row[7] || '').trim(),
          charge: String(row[8] || '').trim(),
          location: String(row[9] || '').trim(),
          receivedDate: normalizeImportDate(row[10]),
          dueDate: normalizeImportDate(row[11]),
          fineAmount: parseFloat(row[12]) || 0,
          note: String(row[13] || '').trim(),
          createdAt: new Date().toISOString(),
        };
        tickets.push(rec);
        added++;
      });
      tkSave(); tkPushIfReady(); tkRenderList();
      showToast(`นำเข้า ${added} รายการ`, 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== Firebase Sync =====
function tkRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function tkObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function tkApplyServer(serverTickets) {
  tickets = serverTickets;
  tkSave();
  tkRenderList();
}
async function tkWriteFB() {
  if (!tkRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(tkRef, tkRecordsToObj(tickets));
  } catch (e) { console.warn('tkWriteFB error', e); }
}
function tkPushIfReady() { if (tkReady) tkWriteFB(); }

function tkWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function tkInit() {
  await tkWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    tkRef = ref(fbDb, '/tickets');
    const snap = await get(tkRef);
    if (snap.exists()) tkApplyServer(tkObjToRecords(snap.val()));
    tkReady = true;
    if (!snap.exists() && tickets.length > 0) await tkWriteFB();
    onValue(tkRef, s => { if (s.exists()) tkApplyServer(tkObjToRecords(s.val())); });
  } catch (e) { console.warn('tkInit error', e); }
}

document.addEventListener('DOMContentLoaded', () => {
  tkRefreshLookupDropdowns();
  tkClearForm();
  tkRenderList();
  tkInit();
});

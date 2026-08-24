// ===== ฐานข้อมูลหลัก: พนักงานขับรถ / ทะเบียนรถ / ลูกค้า / ผู้เบิก =====
let mdDrivers = JSON.parse(localStorage.getItem('finflow_drivers_db') || '[]');
let mdVehicles = JSON.parse(localStorage.getItem('finflow_vehicles_db') || '[]');
let mdCustomers = JSON.parse(localStorage.getItem('finflow_customers_db') || '[]');
let mdRequesters = JSON.parse(localStorage.getItem('finflow_requesters') || '[]');

function saveDriversDB() { localStorage.setItem('finflow_drivers_db', JSON.stringify(mdDrivers)); }
function saveVehiclesDB() { localStorage.setItem('finflow_vehicles_db', JSON.stringify(mdVehicles)); }
function saveCustomersDB() { localStorage.setItem('finflow_customers_db', JSON.stringify(mdCustomers)); }
function saveRequestersDB() { localStorage.setItem('finflow_requesters', JSON.stringify(mdRequesters)); }

// คำนวณอายุ/อายุงานแบบปี-เดือน-วัน จากวันที่ระบุถึงวันนี้
function formatDuration(fromDateStr) {
  if (!fromDateStr) return '-';
  const from = new Date(fromDateStr);
  if (isNaN(from)) return '-';
  const now = new Date();
  if (from > now) return '-';
  let years = now.getFullYear() - from.getFullYear();
  let months = now.getMonth() - from.getMonth();
  let days = now.getDate() - from.getDate();
  if (days < 0) {
    months--;
    days += new Date(now.getFullYear(), now.getMonth(), 0).getDate();
  }
  if (months < 0) {
    years--;
    months += 12;
  }
  return `${years} ปี ${months} เดือน ${days} วัน`;
}

// แปลงค่าวันที่จากไฟล์ Excel (Date object, serial, หรือข้อความ) ให้เป็น YYYY-MM-DD
function normalizeImportDate(val) {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date && !isNaN(val)) {
    // SheetJS แปลง Excel date serial เป็น Date object ด้วยค่าที่คลาดเคลื่อนไม่กี่วินาที (floating-point epsilon)
    // ในโซนเวลาที่เที่ยงคืน local ตรงกับขอบชั่วโมง UTC พอดี (เช่น Bangkok +7) ความคลาดเคลื่อนนี้ทำให้
    // getDate()/getFullYear() แบบ local อ่านได้ "ก่อนหน้า 1 วัน" ผิดพลาด — ปัดเวลาให้ตรงเที่ยงคืน UTC
    // ที่ใกล้ที่สุดก่อน แล้วค่อยอ่านด้วย UTC getters ถึงจะได้วันที่ตรงกับที่พิมพ์ไว้ใน Excel จริง
    const rounded = new Date(Math.round(val.getTime() / 86400000) * 86400000);
    const y = rounded.getUTCFullYear(), m = String(rounded.getUTCMonth() + 1).padStart(2, '0'), d = String(rounded.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // รูปแบบ dd/mm/yyyy (มาตรฐาน export ของระบบ) — ต้องจับก่อน new Date(s) เสมอ เพราะ
  // JS แปลง "05/01/2026" แบบ slash เป็น MM/DD/YYYY (เดือน/วัน) ไม่ใช่ DD/MM/YYYY จะได้วันที่ผิดแบบเงียบๆ
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10), month = parseInt(dmy[2], 10), year = parseInt(dmy[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }
  const d = new Date(s);
  if (!isNaN(d)) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return '';
}

// แปลงวันที่ (ISO 'YYYY-MM-DD' หรือค่าอื่นที่ new Date() อ่านได้) เป็นข้อความ dd/mm/yyyy
// ใช้ตอนเขียนไฟล์ Excel (Export/Template) ให้ทุกเมนูแสดงวันที่รูปแบบเดียวกัน
function formatDMY(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d)) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

function readExcelRows(file, callback) {
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      callback(null, rows.slice(1)); // ตัดแถวหัวตารางออก
    } catch (err) {
      callback(err);
    }
  };
  reader.onerror = () => callback(new Error('อ่านไฟล์ไม่สำเร็จ'));
  reader.readAsArrayBuffer(file);
}

// ===== ปุ่ม "ลบทั้งหมด" เฉพาะแอดมิน (currentUserProfile มาจาก auth.js) =====
function mdIsAdmin() {
  return typeof currentUserProfile !== 'undefined' && currentUserProfile?.role === 'admin';
}

// ปุ่ม .admin-only-btn ทุกปุ่มในหน้าฐานข้อมูลหลักถูกซ่อนไว้ก่อน (style="display:none" ใน HTML)
// เรียกฟังก์ชันนี้ทั้งตอน render หน้า และตอน login เสร็จ (จาก auth.js) เพื่ออัปเดตให้ตรงสิทธิ์จริง
function mdApplyAdminOnlyVisibility() {
  const show = mdIsAdmin();
  document.querySelectorAll('.admin-only-btn').forEach(el => { el.style.display = show ? '' : 'none'; });
}

function mdConfirmDeleteAll(label) {
  if (!mdIsAdmin()) { showToast('เฉพาะแอดมินเท่านั้นที่ลบทั้งหมดได้', 'error'); return false; }
  return confirmDeleteWithPin(`ยืนยันลบข้อมูล "${label}" ทั้งหมด?\nการกระทำนี้ไม่สามารถย้อนกลับได้`);
}

// ===== พนักงานขับรถ =====
function addDriverDB() {
  const name = document.getElementById('md-driver-name').value.trim();
  const birth = document.getElementById('md-driver-birth').value;
  const start = document.getElementById('md-driver-start').value;
  if (!name) { showToast('กรุณากรอกชื่อพนักงาน', 'error'); return; }
  mdDrivers.push({ id: Date.now(), name, birthDate: birth, startDate: start });
  saveDriversDB();
  document.getElementById('md-driver-name').value = '';
  document.getElementById('md-driver-birth').value = '';
  document.getElementById('md-driver-start').value = '';
  renderDriversTable();
  updateDriverDatalist();
  mdPushIfReady();
  showToast('เพิ่มพนักงานแล้ว', 'success');
}

function deleteDriverDB(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบพนักงานคนนี้?')) return;
  mdDrivers = mdDrivers.filter(d => d.id !== id);
  saveDriversDB();
  renderDriversTable();
  updateDriverDatalist();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllDriversDB() {
  if (!mdConfirmDeleteAll('พนักงานขับรถ')) return;
  mdDrivers = [];
  saveDriversDB();
  renderDriversTable();
  updateDriverDatalist();
  mdPushIfReady();
  showToast('ลบพนักงานขับรถทั้งหมดแล้ว', 'warning');
}

function renderDriversTable() {
  const tbody = document.getElementById('md-driver-body');
  if (!tbody) return;
  const search = (document.getElementById('md-driver-search')?.value || '').trim().toLowerCase();
  const list = search ? mdDrivers.filter(d => (d.name || '').toLowerCase().includes(search)) : mdDrivers;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">${mdDrivers.length === 0 ? 'ยังไม่มีข้อมูล' : 'ไม่พบรายการที่ค้นหา'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(d => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${formatDate(d.birthDate)}</td>
      <td>${formatDuration(d.birthDate)}</td>
      <td>${formatDate(d.startDate)}</td>
      <td>${formatDuration(d.startDate)}</td>
      <td><button class="action-btn action-delete" onclick="deleteDriverDB(${d.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadDriverTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ชื่อพนักงาน', 'วันเกิด (dd/mm/yyyy)', 'วันเริ่มงาน (dd/mm/yyyy)'],
    ['นายสมชาย ใจดี', '12/05/1990', '15/01/2020'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'พนักงานขับรถ');
  XLSX.writeFile(wb, 'template_พนักงานขับรถ.xlsx');
}

function exportDriverExcel() {
  if (mdDrivers.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['ชื่อพนักงาน', 'วันเกิด (dd/mm/yyyy)', 'วันเริ่มงาน (dd/mm/yyyy)'],
    ...mdDrivers.map(d => [d.name, formatDMY(d.birthDate), formatDMY(d.startDate)]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'พนักงานขับรถ');
  XLSX.writeFile(wb, `พนักงานขับรถ_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function importDriverExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const name = String(row[0] || '').trim();
      if (!name) return;
      const data = { name, birthDate: normalizeImportDate(row[1]), startDate: normalizeImportDate(row[2]) };
      // จับคู่ด้วยชื่อ — ถ้ามีอยู่แล้วจะแก้ไขข้อมูลแทนการเพิ่มซ้ำ (รองรับแก้ไขผ่าน Excel)
      const idx = mdDrivers.findIndex(d => d.name === name);
      if (idx >= 0) { mdDrivers[idx] = { ...mdDrivers[idx], ...data }; updated++; }
      else { mdDrivers.push({ id: Date.now() + i, ...data }); added++; }
    });
    saveDriversDB();
    renderDriversTable();
    updateDriverDatalist();
    mdPushIfReady();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

function updateDriverDatalist() {
  const dl = document.getElementById('driverNameList');
  if (!dl) return;
  dl.innerHTML = mdDrivers.map(d => `<option value="${escapeHtml(d.name)}"></option>`).join('');
}

// ===== ทะเบียนรถ =====
function addVehicleDB() {
  const plate = document.getElementById('md-vehicle-plate').value.trim();
  if (!plate) { showToast('กรุณากรอกทะเบียนรถ', 'error'); return; }
  mdVehicles.push({
    id: Date.now(),
    plate,
    owner: document.getElementById('md-vehicle-owner').value,
    registerDate: document.getElementById('md-vehicle-date').value,
    gpsInstallDate: document.getElementById('md-vehicle-gps-date').value,
    cctvInstallDate: document.getElementById('md-vehicle-cctv-date').value,
  });
  saveVehiclesDB();
  document.getElementById('md-vehicle-plate').value = '';
  document.getElementById('md-vehicle-owner').value = '';
  document.getElementById('md-vehicle-date').value = '';
  document.getElementById('md-vehicle-gps-date').value = '';
  document.getElementById('md-vehicle-cctv-date').value = '';
  renderVehiclesTable();
  updatePlateDatalist();
  mdPushIfReady();
  showToast('เพิ่มรถแล้ว', 'success');
}

function deleteVehicleDB(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรถคันนี้?')) return;
  mdVehicles = mdVehicles.filter(v => v.id !== id);
  saveVehiclesDB();
  renderVehiclesTable();
  updatePlateDatalist();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllVehiclesDB() {
  if (!mdConfirmDeleteAll('ทะเบียนรถ')) return;
  mdVehicles = [];
  saveVehiclesDB();
  renderVehiclesTable();
  updatePlateDatalist();
  mdPushIfReady();
  showToast('ลบทะเบียนรถทั้งหมดแล้ว', 'warning');
}

function renderVehiclesTable() {
  const tbody = document.getElementById('md-vehicle-body');
  if (!tbody) return;
  const search = (document.getElementById('md-vehicle-search')?.value || '').trim().toLowerCase();
  const list = search ? mdVehicles.filter(v => (v.plate || '').toLowerCase().includes(search) || (v.owner || '').toLowerCase().includes(search)) : mdVehicles;
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">${mdVehicles.length === 0 ? 'ยังไม่มีข้อมูล' : 'ไม่พบรายการที่ค้นหา'}</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(v => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(v.plate)}</td>
      <td>${escapeHtml(v.owner || '-')}</td>
      <td>${formatDate(v.registerDate)}</td>
      <td>${formatDuration(v.registerDate)}</td>
      <td>${v.gpsInstallDate ? formatDate(v.gpsInstallDate) : '-'}</td>
      <td>${v.cctvInstallDate ? formatDate(v.cctvInstallDate) : '-'}</td>
      <td><button class="action-btn action-delete" onclick="deleteVehicleDB(${v.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadVehicleTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'เจ้าของรถ (AP/Subcontractor)', 'วันที่จดทะเบียน (dd/mm/yyyy)', 'GPS วันที่ติดตั้ง (dd/mm/yyyy)', 'CCTV วันที่ติดตั้ง (dd/mm/yyyy)'],
    ['70-1234', 'AP', '01/03/2018', '15/01/2026', '15/01/2026'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ทะเบียนรถ');
  XLSX.writeFile(wb, 'template_ทะเบียนรถ.xlsx');
}

function exportVehicleExcel() {
  if (mdVehicles.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['ทะเบียนรถ', 'เจ้าของรถ (AP/Subcontractor)', 'วันที่จดทะเบียน (dd/mm/yyyy)', 'GPS วันที่ติดตั้ง (dd/mm/yyyy)', 'CCTV วันที่ติดตั้ง (dd/mm/yyyy)'],
    ...mdVehicles.map(v => [v.plate, v.owner || '', formatDMY(v.registerDate), formatDMY(v.gpsInstallDate), formatDMY(v.cctvInstallDate)]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ทะเบียนรถ');
  XLSX.writeFile(wb, `ทะเบียนรถ_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function importVehicleExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      const data = {
        plate, owner: String(row[1] || '').trim(), registerDate: normalizeImportDate(row[2]),
        gpsInstallDate: normalizeImportDate(row[3]), cctvInstallDate: normalizeImportDate(row[4]),
      };
      // จับคู่ด้วยทะเบียน — ถ้ามีอยู่แล้วจะแก้ไขข้อมูลแทนการเพิ่มซ้ำ (รองรับแก้ไขผ่าน Excel)
      const idx = mdVehicles.findIndex(v => v.plate === plate);
      if (idx >= 0) { mdVehicles[idx] = { ...mdVehicles[idx], ...data }; updated++; }
      else { mdVehicles.push({ id: Date.now() + i, ...data }); added++; }
    });
    saveVehiclesDB();
    renderVehiclesTable();
    updatePlateDatalist();
    mdPushIfReady();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

function updatePlateDatalist() {
  const dl = document.getElementById('plateNoList');
  if (dl) dl.innerHTML = mdVehicles.map(v => `<option value="${escapeHtml(v.plate)}"></option>`).join('');
}

// ===== ลูกค้า =====
function addCustomerDB() {
  const name = document.getElementById('md-customer-name').value.trim();
  if (!name) { document.getElementById('md-customer-name').focus(); return; }
  if (mdCustomers.some(c => c.name === name)) { showToast('มีชื่อนี้อยู่แล้ว', 'warning'); return; }
  mdCustomers.push({ id: Date.now(), name });
  saveCustomersDB();
  document.getElementById('md-customer-name').value = '';
  document.getElementById('md-customer-name').focus();
  renderCustomersTable();
  updateCustomerDatalist();
  showToast('เพิ่มลูกค้าแล้ว', 'success');
}

function deleteCustomerDB(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdCustomers = mdCustomers.filter(c => c.id !== id);
  saveCustomersDB();
  renderCustomersTable();
  updateCustomerDatalist();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllCustomersDB() {
  if (!mdConfirmDeleteAll('ชื่อลูกค้า')) return;
  mdCustomers = [];
  saveCustomersDB();
  renderCustomersTable();
  updateCustomerDatalist();
  showToast('ลบชื่อลูกค้าทั้งหมดแล้ว', 'warning');
}

function renderCustomersTable() {
  const tbody = document.getElementById('md-customer-body');
  if (!tbody) return;
  if (mdCustomers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdCustomers.map(c => `
    <tr>
      <td>${escapeHtml(c.name)}</td>
      <td><button class="action-btn action-delete" onclick="deleteCustomerDB(${c.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadCustomerTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ชื่อลูกค้า'],
    ['บริษัท ตัวอย่าง จำกัด'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ลูกค้า');
  XLSX.writeFile(wb, 'template_ลูกค้า.xlsx');
}

function importCustomerExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    const existing = new Set(mdCustomers.map(c => c.name));
    let added = 0;
    rows.forEach((row, i) => {
      const name = String(row[0] || '').trim();
      if (!name || existing.has(name)) return;
      mdCustomers.push({ id: Date.now() + i, name });
      existing.add(name);
      added++;
    });
    saveCustomersDB();
    renderCustomersTable();
    updateCustomerDatalist();
    showToast(`นำเข้าลูกค้า ${added} รายการ`, 'success');
    event.target.value = '';
  });
}

function updateCustomerDatalist() {
  const dl = document.getElementById('customerNameList');
  if (!dl) return;
  dl.innerHTML = mdCustomers.map(c => `<option value="${escapeHtml(c.name)}"></option>`).join('');
}

// ===== ผู้เบิก =====
function addRequesterDB() {
  const input = document.getElementById('md-requester-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdRequesters.includes(name)) { showToast('มีชื่อผู้เบิกนี้อยู่แล้ว', 'warning'); return; }
  mdRequesters.push(name);
  saveRequestersDB();
  input.value = '';
  input.focus();
  renderRequestersTable();
  updateRequesterDatalist();
  mdPushIfReady();
  showToast(`เพิ่มผู้เบิก: ${name}`, 'success');
}

function deleteRequesterDB(name) {
  if (!confirmDeleteWithPin(`ยืนยันการลบ "${name}"?`)) return;
  mdRequesters = mdRequesters.filter(r => r !== name);
  saveRequestersDB();
  renderRequestersTable();
  updateRequesterDatalist();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllRequestersDB() {
  if (!mdConfirmDeleteAll('ผู้เบิก')) return;
  mdRequesters = [];
  saveRequestersDB();
  renderRequestersTable();
  updateRequesterDatalist();
  mdPushIfReady();
  showToast('ลบผู้เบิกทั้งหมดแล้ว', 'warning');
}

function renderRequestersTable() {
  const tbody = document.getElementById('md-requester-body');
  if (!tbody) return;
  if (mdRequesters.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdRequesters.map(name => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td><button class="action-btn action-delete" onclick="deleteRequesterDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td>
    </tr>
  `).join('');
}

function updateRequesterDatalist() {
  if (typeof syncRequesterDropdowns === 'function') {
    syncRequesterDropdowns();
    return;
  }
  // fallback ถ้า app.js ยังไม่โหลด
  ['pc-requester', 'ap-requester', 'pc-reviewer', 'ap-reviewer'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const placeholder = id.includes('reviewer') ? '-- เลือกผู้ตรวจสอบ --' : '-- เลือกผู้เบิก --';
    sel.innerHTML = `<option value="">${placeholder}</option>` +
      mdRequesters.map(r => `<option value="${escapeHtml(r)}" ${r === current ? 'selected' : ''}>${escapeHtml(r)}</option>`).join('');
  });
  if (typeof attachRequesterListeners === 'function') attachRequesterListeners();
}

// ===== หน่วยงาน / บริษัทประกัน / ลานจอด / ลักษณะการเกิดเหตุ =====
// รายการอ้างอิงสำหรับฟอร์ม "บันทึกอุบัติเหตุ" (incidents.js) เพิ่ม/ลบเองได้ที่นี่
// เก็บเป็น array ของชื่อ (string) และ sync กับ Firebase ผ่าน masterdata-sync.js
let mdBusinessUnits = JSON.parse(localStorage.getItem('finflow_business_units_db') || '[]');
let mdInsurers = JSON.parse(localStorage.getItem('finflow_insurers_db') || '[]');
let mdYards = JSON.parse(localStorage.getItem('finflow_yards_db') || '[]');
let mdIncidentPatterns = JSON.parse(localStorage.getItem('finflow_patterns_db') || '[]');

function saveBusinessUnitsDB() { localStorage.setItem('finflow_business_units_db', JSON.stringify(mdBusinessUnits)); }
function saveInsurersDB() { localStorage.setItem('finflow_insurers_db', JSON.stringify(mdInsurers)); }
function saveYardsDB() { localStorage.setItem('finflow_yards_db', JSON.stringify(mdYards)); }
function savePatternsDB() { localStorage.setItem('finflow_patterns_db', JSON.stringify(mdIncidentPatterns)); }

function addBusinessUnitDB() {
  const input = document.getElementById('md-bu-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdBusinessUnits.includes(name)) { showToast('มีหน่วยงานนี้อยู่แล้ว', 'warning'); return; }
  mdBusinessUnits.push(name);
  saveBusinessUnitsDB();
  input.value = ''; input.focus();
  renderBusinessUnitsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มหน่วยงานแล้ว', 'success');
}
function deleteBusinessUnitDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdBusinessUnits = mdBusinessUnits.filter(n => n !== name);
  saveBusinessUnitsDB();
  renderBusinessUnitsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllBusinessUnitsDB() {
  if (!mdConfirmDeleteAll('หน่วยงาน')) return;
  mdBusinessUnits = [];
  saveBusinessUnitsDB();
  renderBusinessUnitsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบหน่วยงานทั้งหมดแล้ว', 'warning');
}

function renderBusinessUnitsTable() {
  const tbody = document.getElementById('md-bu-body');
  if (!tbody) return;
  if (mdBusinessUnits.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdBusinessUnits.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteBusinessUnitDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

function addInsurerDB() {
  const input = document.getElementById('md-insurer-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdInsurers.includes(name)) { showToast('มีบริษัทประกันนี้อยู่แล้ว', 'warning'); return; }
  mdInsurers.push(name);
  saveInsurersDB();
  input.value = ''; input.focus();
  renderInsurersTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มบริษัทประกันแล้ว', 'success');
}
function deleteInsurerDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdInsurers = mdInsurers.filter(n => n !== name);
  saveInsurersDB();
  renderInsurersTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllInsurersDB() {
  if (!mdConfirmDeleteAll('บริษัทประกัน')) return;
  mdInsurers = [];
  saveInsurersDB();
  renderInsurersTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบบริษัทประกันทั้งหมดแล้ว', 'warning');
}

function renderInsurersTable() {
  const tbody = document.getElementById('md-insurer-body');
  if (!tbody) return;
  if (mdInsurers.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdInsurers.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteInsurerDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

function addYardDB() {
  const input = document.getElementById('md-yard-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdYards.includes(name)) { showToast('มีลานจอดนี้อยู่แล้ว', 'warning'); return; }
  mdYards.push(name);
  saveYardsDB();
  input.value = ''; input.focus();
  renderYardsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มลานจอดแล้ว', 'success');
}
function deleteYardDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdYards = mdYards.filter(n => n !== name);
  saveYardsDB();
  renderYardsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllYardsDB() {
  if (!mdConfirmDeleteAll('ลานจอด')) return;
  mdYards = [];
  saveYardsDB();
  renderYardsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบลานจอดทั้งหมดแล้ว', 'warning');
}

function renderYardsTable() {
  const tbody = document.getElementById('md-yard-body');
  if (!tbody) return;
  if (mdYards.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdYards.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteYardDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

function addIncidentPatternDB() {
  const input = document.getElementById('md-pattern-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdIncidentPatterns.includes(name)) { showToast('มีลักษณะนี้อยู่แล้ว', 'warning'); return; }
  mdIncidentPatterns.push(name);
  savePatternsDB();
  input.value = ''; input.focus();
  renderIncidentPatternsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มลักษณะการเกิดเหตุแล้ว', 'success');
}
function deleteIncidentPatternDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdIncidentPatterns = mdIncidentPatterns.filter(n => n !== name);
  savePatternsDB();
  renderIncidentPatternsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllIncidentPatternsDB() {
  if (!mdConfirmDeleteAll('ลักษณะการเกิดเหตุ')) return;
  mdIncidentPatterns = [];
  savePatternsDB();
  renderIncidentPatternsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบลักษณะการเกิดเหตุทั้งหมดแล้ว', 'warning');
}

function renderIncidentPatternsTable() {
  const tbody = document.getElementById('md-pattern-body');
  if (!tbody) return;
  if (mdIncidentPatterns.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdIncidentPatterns.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteIncidentPatternDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

// ===== หัวข้อปัญหา (สำหรับ "บันทึกปัญหาการทำงาน" - issues.js) =====
let mdIssueTopics = JSON.parse(localStorage.getItem('finflow_issue_topics_db') || '[]');
function saveIssueTopicsDB() { localStorage.setItem('finflow_issue_topics_db', JSON.stringify(mdIssueTopics)); }

function addIssueTopicDB() {
  const input = document.getElementById('md-topic-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdIssueTopics.includes(name)) { showToast('มีหัวข้อนี้อยู่แล้ว', 'warning'); return; }
  mdIssueTopics.push(name);
  saveIssueTopicsDB();
  input.value = ''; input.focus();
  renderIssueTopicsTable();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มหัวข้อปัญหาแล้ว', 'success');
}
function deleteIssueTopicDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdIssueTopics = mdIssueTopics.filter(n => n !== name);
  saveIssueTopicsDB();
  renderIssueTopicsTable();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllIssueTopicsDB() {
  if (!mdConfirmDeleteAll('หัวข้อปัญหาการทำงาน')) return;
  mdIssueTopics = [];
  saveIssueTopicsDB();
  renderIssueTopicsTable();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบหัวข้อปัญหาทั้งหมดแล้ว', 'warning');
}

function renderIssueTopicsTable() {
  const tbody = document.getElementById('md-topic-body');
  if (!tbody) return;
  if (mdIssueTopics.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdIssueTopics.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteIssueTopicDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

// ===== ข้อหา (สำหรับ "บันทึกใบสั่ง" - tickets.js) =====
let mdChargeTypes = JSON.parse(localStorage.getItem('finflow_charge_types_db') || '[]');
function saveChargeTypesDB() { localStorage.setItem('finflow_charge_types_db', JSON.stringify(mdChargeTypes)); }

function addChargeTypeDB() {
  const input = document.getElementById('md-charge-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  if (mdChargeTypes.includes(name)) { showToast('มีข้อหานี้อยู่แล้ว', 'warning'); return; }
  mdChargeTypes.push(name);
  saveChargeTypesDB();
  input.value = ''; input.focus();
  renderChargeTypesTable();
  if (typeof tkRefreshLookupDropdowns === 'function') tkRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มข้อหาแล้ว', 'success');
}
function deleteChargeTypeDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdChargeTypes = mdChargeTypes.filter(n => n !== name);
  saveChargeTypesDB();
  renderChargeTypesTable();
  if (typeof tkRefreshLookupDropdowns === 'function') tkRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllChargeTypesDB() {
  if (!mdConfirmDeleteAll('ข้อหา')) return;
  mdChargeTypes = [];
  saveChargeTypesDB();
  renderChargeTypesTable();
  if (typeof tkRefreshLookupDropdowns === 'function') tkRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบข้อหาทั้งหมดแล้ว', 'warning');
}

function renderChargeTypesTable() {
  const tbody = document.getElementById('md-charge-body');
  if (!tbody) return;
  if (mdChargeTypes.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdChargeTypes.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteChargeTypeDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
  `).join('');
}

// ===== พนักงานลาน ABC (สำหรับ "บันทึกการเป่าวัดแอลกอฮอล์" - alcohol.js) =====
// แยกรายชื่อออกจากพนักงานขับรถหลัก เพราะบันทึกเฉพาะพนักงานลาน ABC ลานเดียว
// (เมนูบันทึกอื่นๆ เช่น อุบัติเหตุ ใช้รายชื่อพนักงานขับรถทุกลาน)
// เก็บเป็น record { id, name, businessUnit } เพื่อรองรับ Template/Import Excel (ชื่อ + หน่วยงาน)
// (แปลงข้อมูลเก่าที่เคยเก็บเป็น array ของชื่อ string เฉยๆ ให้เป็น record อัตโนมัติ)
let mdAbcStaff = JSON.parse(localStorage.getItem('finflow_abc_staff_db') || '[]')
  .map((s, i) => typeof s === 'string' ? { id: Date.now() + i, name: s, businessUnit: '' } : s);
function saveAbcStaffDB() { localStorage.setItem('finflow_abc_staff_db', JSON.stringify(mdAbcStaff)); }

function addAbcStaffDB() {
  const nameInput = document.getElementById('md-abcstaff-name');
  const buInput = document.getElementById('md-abcstaff-bu');
  const name = nameInput.value.trim();
  const businessUnit = buInput.value.trim();
  if (!name) { nameInput.focus(); return; }
  if (mdAbcStaff.some(s => s.name === name)) { showToast('มีพนักงานคนนี้อยู่แล้ว', 'warning'); return; }
  mdAbcStaff.push({ id: Date.now(), name, businessUnit });
  saveAbcStaffDB();
  nameInput.value = ''; buInput.value = ''; nameInput.focus();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('เพิ่มพนักงานแล้ว', 'success');
}
function deleteAbcStaffDB(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบพนักงานคนนี้?')) return;
  mdAbcStaff = mdAbcStaff.filter(s => s.id !== id);
  saveAbcStaffDB();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function deleteAllAbcStaffDB() {
  if (!mdConfirmDeleteAll('พนักงานลาน ABC')) return;
  mdAbcStaff = [];
  saveAbcStaffDB();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบพนักงานลาน ABC ทั้งหมดแล้ว', 'warning');
}

function renderAbcStaffTable() {
  const tbody = document.getElementById('md-abcstaff-body');
  if (!tbody) return;
  if (mdAbcStaff.length === 0) { tbody.innerHTML = '<tr><td colspan="3" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdAbcStaff.map(s => `
    <tr>
      <td>${escapeHtml(s.name)}</td>
      <td>${escapeHtml(s.businessUnit || '-')}</td>
      <td><button class="action-btn action-delete" onclick="deleteAbcStaffDB(${s.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadAbcStaffTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ชื่อพนักงาน', 'หน่วยงาน'],
    ['นายสมชาย ใจดี', 'ABC'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'พนักงานลาน ABC');
  XLSX.writeFile(wb, 'template_พนักงานลาน_ABC.xlsx');
}

function importAbcStaffExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const name = String(row[0] || '').trim();
      if (!name) return;
      const businessUnit = String(row[1] || '').trim();
      // จับคู่ด้วยชื่อ — ถ้ามีอยู่แล้วจะแก้ไขหน่วยงานแทนการเพิ่มซ้ำ (รองรับแก้ไขผ่าน Excel)
      const idx = mdAbcStaff.findIndex(s => s.name === name);
      if (idx >= 0) { mdAbcStaff[idx] = { ...mdAbcStaff[idx], businessUnit }; updated++; }
      else { mdAbcStaff.push({ id: Date.now() + i, name, businessUnit }); added++; }
    });
    saveAbcStaffDB();
    renderAbcStaffTable();
    if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
    mdPushIfReady();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== เครื่องเป่าแอลกอฮอล์ (inventory ตัวเครื่อง — คนละส่วนกับผลตรวจ "เป่าวัดแอลกอฮอล์" ใน alcohol.js) =====
let mdBreathalyzers = JSON.parse(localStorage.getItem('finflow_breathalyzers_db') || '[]');
function saveBreathalyzersDB() { localStorage.setItem('finflow_breathalyzers_db', JSON.stringify(mdBreathalyzers)); }

function bzLookupVehicle() {
  const plate = document.getElementById('md-bz-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('md-bz-owner').value = veh?.owner || '';
}

function addBreathalyzerDB() {
  const deviceNo = document.getElementById('md-bz-deviceno').value.trim();
  if (!deviceNo) { showToast('กรุณากรอกเลขเครื่อง', 'error'); return; }
  mdBreathalyzers.push({
    id: Date.now(),
    deviceNo,
    plate: document.getElementById('md-bz-plate').value.trim(),
    owner: document.getElementById('md-bz-owner').value.trim(),
    receiveDate: document.getElementById('md-bz-receive-date').value,
    returnDate: document.getElementById('md-bz-return-date').value,
    note: document.getElementById('md-bz-note').value.trim(),
  });
  saveBreathalyzersDB();
  document.getElementById('md-bz-deviceno').value = '';
  document.getElementById('md-bz-plate').value = '';
  document.getElementById('md-bz-owner').value = '';
  document.getElementById('md-bz-receive-date').value = '';
  document.getElementById('md-bz-return-date').value = '';
  document.getElementById('md-bz-note').value = '';
  renderBreathalyzersTable();
  mdPushIfReady();
  showToast('เพิ่มเครื่องเป่าแอลกอฮอล์แล้ว', 'success');
}

function deleteBreathalyzerDB(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  mdBreathalyzers = mdBreathalyzers.filter(b => b.id !== id);
  saveBreathalyzersDB();
  renderBreathalyzersTable();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllBreathalyzersDB() {
  if (!mdConfirmDeleteAll('เครื่องเป่าแอลกอฮอล์')) return;
  mdBreathalyzers = [];
  saveBreathalyzersDB();
  renderBreathalyzersTable();
  mdPushIfReady();
  showToast('ลบเครื่องเป่าแอลกอฮอล์ทั้งหมดแล้ว', 'warning');
}

function renderBreathalyzersTable() {
  const tbody = document.getElementById('md-bz-body');
  if (!tbody) return;
  if (mdBreathalyzers.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdBreathalyzers.map(b => `
    <tr>
      <td>${escapeHtml(b.deviceNo)}</td>
      <td style="font-family:monospace">${escapeHtml(b.plate || '-')}</td>
      <td>${escapeHtml(b.owner || '-')}</td>
      <td>${b.receiveDate ? formatDate(b.receiveDate) : '-'}</td>
      <td>${b.returnDate ? formatDate(b.returnDate) : '-'}</td>
      <td>${escapeHtml(b.note || '-')}</td>
      <td><button class="action-btn action-delete" onclick="deleteBreathalyzerDB(${b.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadBreathalyzerTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['เลขเครื่อง', 'ทะเบียนรถ', 'เจ้าของรถ', 'รับวันไหน (dd/mm/yyyy)', 'คืนวันไหน (dd/mm/yyyy)', 'หมายเหตุ'],
    ['BZ-001', '70-1234', 'นายสมชาย ใจดี', '10/01/2026', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'เครื่องเป่าแอลกอฮอล์');
  XLSX.writeFile(wb, 'template_เครื่องเป่าแอลกอฮอล์.xlsx');
}

function exportBreathalyzerExcel() {
  if (mdBreathalyzers.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขเครื่อง', 'ทะเบียนรถ', 'เจ้าของรถ', 'รับวันไหน (dd/mm/yyyy)', 'คืนวันไหน (dd/mm/yyyy)', 'หมายเหตุ'],
    ...mdBreathalyzers.map(b => [b.deviceNo, b.plate || '', b.owner || '', formatDMY(b.receiveDate), formatDMY(b.returnDate), b.note || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'เครื่องเป่าแอลกอฮอล์');
  XLSX.writeFile(wb, `เครื่องเป่าแอลกอฮอล์_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function importBreathalyzerExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const deviceNo = String(row[0] || '').trim();
      if (!deviceNo) return;
      const plate = String(row[1] || '').trim();
      const veh = mdVehicles.find(v => v.plate === plate);
      const data = {
        deviceNo, plate,
        owner: String(row[2] || '').trim() || veh?.owner || '',
        receiveDate: normalizeImportDate(row[3]), returnDate: normalizeImportDate(row[4]),
        note: String(row[5] || '').trim(),
      };
      // จับคู่ด้วยเลขเครื่อง — ถ้ามีอยู่แล้วจะแก้ไขข้อมูลแทนการเพิ่มซ้ำ (รองรับแก้ไขผ่าน Excel)
      const idx = mdBreathalyzers.findIndex(b => b.deviceNo === deviceNo);
      if (idx >= 0) { mdBreathalyzers[idx] = { ...mdBreathalyzers[idx], ...data }; updated++; }
      else { mdBreathalyzers.push({ id: Date.now() + i, ...data }); added++; }
    });
    saveBreathalyzersDB();
    renderBreathalyzersTable();
    mdPushIfReady();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== หมวดหมู่ค่าใช้จ่าย =====
// เก็บเป็น array ของชื่อ (string) ที่คีย์ 'finflow_categories_db' ใน localStorage
// ฟอร์มเงินสดย่อย/ขออนุมัติ (app.js: categoryOptions()) จะอ่านจากคีย์นี้โดยตรงทุกครั้ง
// ที่ render dropdown จึงไม่ต้อง sync ตัวแปรข้ามไฟล์
function loadCategoriesDB() {
  return JSON.parse(localStorage.getItem('finflow_categories_db') || '[]');
}
function saveCategoriesDB(cats) {
  localStorage.setItem('finflow_categories_db', JSON.stringify(cats));
}

function addCategoryDB() {
  const input = document.getElementById('md-category-name');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  const cats = loadCategoriesDB();
  if (cats.includes(name)) { showToast('มีหมวดหมู่นี้อยู่แล้ว', 'warning'); return; }
  cats.push(name);
  saveCategoriesDB(cats);
  input.value = '';
  input.focus();
  renderCategoriesTable();
  showToast('เพิ่มหมวดหมู่แล้ว', 'success');
}

function deleteCategoryDB(name) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  saveCategoriesDB(loadCategoriesDB().filter(c => c !== name));
  renderCategoriesTable();
  showToast('ลบแล้ว', 'warning');
}

function deleteAllCategoriesDB() {
  if (!mdConfirmDeleteAll('หมวดหมู่ค่าใช้จ่าย')) return;
  saveCategoriesDB([]);
  renderCategoriesTable();
  showToast('ลบหมวดหมู่ทั้งหมดแล้ว', 'warning');
}

function renderCategoriesTable() {
  const tbody = document.getElementById('md-category-body');
  if (!tbody) return;
  const cats = loadCategoriesDB();
  if (cats.length === 0) {
    tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีหมวดหมู่ — เพิ่มที่นี่เพื่อใช้ในฟอร์มเงินสดย่อย/ขออนุมัติ</td></tr>';
    return;
  }
  tbody.innerHTML = cats.map(name => `
    <tr>
      <td>${escapeHtml(name)}</td>
      <td><button class="action-btn action-delete" onclick="deleteCategoryDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td>
    </tr>
  `).join('');
}

// ===== เลือกหัวข้อที่จะบันทึก (แสดงเฉพาะส่วนที่เลือก) =====
const MD_TOPICS = ['driver', 'vehicle', 'bu', 'insurer', 'yard', 'pattern', 'topic', 'charge', 'abcstaff', 'bz', 'customer', 'requester', 'category', 'telegram'];
function mdSwitchTopic(topic) {
  MD_TOPICS.forEach(t => {
    document.getElementById(`md-tab-${t}`).classList.toggle('active', t === topic);
    document.getElementById(`md-subpage-${t}`).classList.toggle('active', t === topic);
  });
}

function renderMasterData() {
  renderDriversTable();
  renderVehiclesTable();
  renderCustomersTable();
  updateCustomerDatalist();
  updateDriverDatalist();
  updatePlateDatalist();
  renderBusinessUnitsTable();
  renderInsurersTable();
  renderYardsTable();
  renderIncidentPatternsTable();
  renderIssueTopicsTable();
  renderChargeTypesTable();
  renderAbcStaffTable();
  renderBreathalyzersTable();
  renderRequestersTable();
  updateRequesterDatalist();
  renderCategoriesTable();
  if (typeof loadTelegramSettingsForm === 'function') loadTelegramSettingsForm();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  mdApplyAdminOnlyVisibility();
}

document.addEventListener('DOMContentLoaded', renderMasterData);

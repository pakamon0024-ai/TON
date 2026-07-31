// ===== ฐานข้อมูลหลัก: พนักงานขับรถ / ทะเบียนรถ / ลูกค้า =====
let mdDrivers = JSON.parse(localStorage.getItem('finflow_drivers_db') || '[]');
let mdVehicles = JSON.parse(localStorage.getItem('finflow_vehicles_db') || '[]');
let mdCustomers = JSON.parse(localStorage.getItem('finflow_customers_db') || '[]');

function saveDriversDB() { localStorage.setItem('finflow_drivers_db', JSON.stringify(mdDrivers)); }
function saveVehiclesDB() { localStorage.setItem('finflow_vehicles_db', JSON.stringify(mdVehicles)); }
function saveCustomersDB() { localStorage.setItem('finflow_customers_db', JSON.stringify(mdCustomers)); }

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
    const y = val.getFullYear(), m = String(val.getMonth() + 1).padStart(2, '0'), d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!isNaN(d)) {
    const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }
  return '';
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
  showToast('เพิ่มพนักงานแล้ว', 'success');
}

function deleteDriverDB(id) {
  if (!confirm('ยืนยันการลบพนักงานคนนี้?')) return;
  mdDrivers = mdDrivers.filter(d => d.id !== id);
  saveDriversDB();
  renderDriversTable();
  showToast('ลบแล้ว', 'warning');
}

function renderDriversTable() {
  const tbody = document.getElementById('md-driver-body');
  if (!tbody) return;
  if (mdDrivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdDrivers.map(d => `
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
    ['ชื่อพนักงาน', 'วันเกิด (YYYY-MM-DD)', 'วันเริ่มงาน (YYYY-MM-DD)'],
    ['นายสมชาย ใจดี', '1990-05-12', '2020-01-15'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'พนักงานขับรถ');
  XLSX.writeFile(wb, 'template_พนักงานขับรถ.xlsx');
}

function importDriverExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0;
    rows.forEach((row, i) => {
      const name = String(row[0] || '').trim();
      if (!name) return;
      mdDrivers.push({
        id: Date.now() + i,
        name,
        birthDate: normalizeImportDate(row[1]),
        startDate: normalizeImportDate(row[2]),
      });
      added++;
    });
    saveDriversDB();
    renderDriversTable();
    showToast(`นำเข้าพนักงาน ${added} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== ทะเบียนรถ =====
function addVehicleDB() {
  const plate = document.getElementById('md-vehicle-plate').value.trim();
  const type = document.getElementById('md-vehicle-type').value;
  const date = document.getElementById('md-vehicle-date').value;
  if (!plate) { showToast('กรุณากรอกทะเบียนรถ', 'error'); return; }
  if (!type) { showToast('กรุณาเลือกประเภทรถ', 'error'); return; }
  mdVehicles.push({ id: Date.now(), plate, vehicleType: type, registerDate: date });
  saveVehiclesDB();
  document.getElementById('md-vehicle-plate').value = '';
  document.getElementById('md-vehicle-type').value = '';
  document.getElementById('md-vehicle-date').value = '';
  renderVehiclesTable();
  showToast('เพิ่มรถแล้ว', 'success');
}

function deleteVehicleDB(id) {
  if (!confirm('ยืนยันการลบรถคันนี้?')) return;
  mdVehicles = mdVehicles.filter(v => v.id !== id);
  saveVehiclesDB();
  renderVehiclesTable();
  showToast('ลบแล้ว', 'warning');
}

function renderVehiclesTable() {
  const tbody = document.getElementById('md-vehicle-body');
  if (!tbody) return;
  if (mdVehicles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdVehicles.map(v => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(v.plate)}</td>
      <td><span class="badge badge-blue">${escapeHtml(v.vehicleType)}</span></td>
      <td>${formatDate(v.registerDate)}</td>
      <td>${formatDuration(v.registerDate)}</td>
      <td><button class="action-btn action-delete" onclick="deleteVehicleDB(${v.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadVehicleTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'ประเภทรถ (4W/6W/7W/หัวลาก)', 'วันที่จดทะเบียน (YYYY-MM-DD)'],
    ['70-1234', '6W', '2018-03-01'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ทะเบียนรถ');
  XLSX.writeFile(wb, 'template_ทะเบียนรถ.xlsx');
}

function importVehicleExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0;
    rows.forEach((row, i) => {
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      mdVehicles.push({
        id: Date.now() + i,
        plate,
        vehicleType: String(row[1] || '').trim(),
        registerDate: normalizeImportDate(row[2]),
      });
      added++;
    });
    saveVehiclesDB();
    renderVehiclesTable();
    showToast(`นำเข้ารถ ${added} รายการ`, 'success');
    event.target.value = '';
  });
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
  mdCustomers = mdCustomers.filter(c => c.id !== id);
  saveCustomersDB();
  renderCustomersTable();
  updateCustomerDatalist();
  showToast('ลบแล้ว', 'warning');
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

function renderMasterData() {
  renderDriversTable();
  renderVehiclesTable();
  renderCustomersTable();
  updateCustomerDatalist();
}

document.addEventListener('DOMContentLoaded', renderMasterData);

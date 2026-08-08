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
  mdDrivers.push({
    id: Date.now(),
    name,
    position: document.getElementById('md-driver-position').value,
    department: document.getElementById('md-driver-department').value.trim(),
    birthDate: birth,
    startDate: start,
    phone: document.getElementById('md-driver-phone').value.trim(),
    licenseType: document.getElementById('md-driver-license-type').value,
    licenseExpiry: document.getElementById('md-driver-license-expiry').value,
    status: document.getElementById('md-driver-status').value || 'ทำงานอยู่',
  });
  saveDriversDB();
  ['md-driver-name','md-driver-department','md-driver-birth','md-driver-start','md-driver-phone','md-driver-license-expiry'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('md-driver-position').value = '';
  document.getElementById('md-driver-license-type').value = '';
  document.getElementById('md-driver-status').value = 'ทำงานอยู่';
  renderDriversTable();
  updateDriverDatalist();
  mdPushIfReady();
  showToast('เพิ่มพนักงานแล้ว', 'success');
}

function deleteDriverDB(id) {
  if (!confirm('ยืนยันการลบพนักงานคนนี้?')) return;
  mdDrivers = mdDrivers.filter(d => d.id !== id);
  saveDriversDB();
  renderDriversTable();
  updateDriverDatalist();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function renderDriversTable() {
  const tbody = document.getElementById('md-driver-body');
  if (!tbody) return;
  if (mdDrivers.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdDrivers.map(d => `
    <tr>
      <td>${escapeHtml(d.name)}</td>
      <td>${escapeHtml(d.position || '-')}</td>
      <td>${escapeHtml(d.department || '-')}</td>
      <td>${formatDuration(d.birthDate)}</td>
      <td>${formatDuration(d.startDate)}</td>
      <td>${escapeHtml(d.phone || '-')}</td>
      <td>${escapeHtml(d.licenseType || '-')}</td>
      <td>${formatDate(d.licenseExpiry)}</td>
      <td>${d.status === 'ลาออก' ? '<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">ลาออก</span>' : d.status === 'พักงาน' ? '<span class="badge badge-orange">พักงาน</span>' : '<span class="badge badge-green">ทำงานอยู่</span>'}</td>
      <td><button class="action-btn action-delete" onclick="deleteDriverDB(${d.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadDriverTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ชื่อพนักงาน', 'ตำแหน่ง', 'แผนก', 'วันเกิด (YYYY-MM-DD)', 'วันเริ่มงาน (YYYY-MM-DD)', 'เบอร์โทร', 'ประเภทใบขับขี่', 'วันหมดอายุใบขับขี่ (YYYY-MM-DD)', 'สถานะ'],
    ['นายสมชาย ใจดี', 'Driver', 'Transport', '1990-05-12', '2020-01-15', '0812345678', 'ท.2', '2027-05-12', 'ทำงานอยู่'],
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
        position: String(row[1] || '').trim(),
        department: String(row[2] || '').trim(),
        birthDate: normalizeImportDate(row[3]),
        startDate: normalizeImportDate(row[4]),
        phone: String(row[5] || '').trim(),
        licenseType: String(row[6] || '').trim(),
        licenseExpiry: normalizeImportDate(row[7]),
        status: String(row[8] || '').trim() || 'ทำงานอยู่',
      });
      added++;
    });
    saveDriversDB();
    renderDriversTable();
    updateDriverDatalist();
    mdPushIfReady();
    showToast(`นำเข้าพนักงาน ${added} รายการ`, 'success');
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
  const type = document.getElementById('md-vehicle-type').value;
  if (!plate) { showToast('กรุณากรอกทะเบียนรถ', 'error'); return; }
  if (!type) { showToast('กรุณาเลือกประเภทรถ', 'error'); return; }
  mdVehicles.push({
    id: Date.now(),
    plate,
    vehicleType: type,
    owner: document.getElementById('md-vehicle-owner').value,
    businessUnit: document.getElementById('md-vehicle-business-unit').value.trim(),
    yard: document.getElementById('md-vehicle-yard').value,
    insuranceCompany: document.getElementById('md-vehicle-insurance').value.trim(),
    insuranceExpiry: document.getElementById('md-vehicle-insurance-expiry').value,
    registerDate: document.getElementById('md-vehicle-date').value,
    registrationExpiry: document.getElementById('md-vehicle-registration-expiry').value,
    assignedDriver: document.getElementById('md-vehicle-driver').value.trim(),
    status: document.getElementById('md-vehicle-status').value || 'พร้อมใช้',
  });
  saveVehiclesDB();
  ['md-vehicle-plate','md-vehicle-business-unit','md-vehicle-insurance','md-vehicle-insurance-expiry','md-vehicle-date','md-vehicle-registration-expiry','md-vehicle-driver'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('md-vehicle-type').value = '';
  document.getElementById('md-vehicle-owner').value = '';
  document.getElementById('md-vehicle-yard').value = '';
  document.getElementById('md-vehicle-status').value = 'พร้อมใช้';
  renderVehiclesTable();
  updatePlateDatalist();
  mdPushIfReady();
  showToast('เพิ่มรถแล้ว', 'success');
}

function deleteVehicleDB(id) {
  if (!confirm('ยืนยันการลบรถคันนี้?')) return;
  mdVehicles = mdVehicles.filter(v => v.id !== id);
  saveVehiclesDB();
  renderVehiclesTable();
  updatePlateDatalist();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}

function renderVehiclesTable() {
  const tbody = document.getElementById('md-vehicle-body');
  if (!tbody) return;
  if (mdVehicles.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdVehicles.map(v => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(v.plate)}</td>
      <td><span class="badge badge-blue">${escapeHtml(v.vehicleType || '-')}</span></td>
      <td>${escapeHtml(v.owner || '-')}</td>
      <td>${escapeHtml(v.businessUnit || '-')}</td>
      <td>${escapeHtml(v.yard || '-')}</td>
      <td>${escapeHtml(v.insuranceCompany || '-')}</td>
      <td>${formatDate(v.insuranceExpiry)}</td>
      <td>${formatDate(v.registrationExpiry)}</td>
      <td>${escapeHtml(v.assignedDriver || '-')}</td>
      <td>${v.status === 'ซ่อม' ? '<span class="badge badge-orange">ซ่อม</span>' : v.status === 'พักระวาง' ? '<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">พักระวาง</span>' : '<span class="badge badge-green">พร้อมใช้</span>'}</td>
      <td><button class="action-btn action-delete" onclick="deleteVehicleDB(${v.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadVehicleTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'ประเภทรถ', 'เจ้าของรถ (AP/Subcontractor)', 'หน่วยธุรกิจ', 'ลานจอด', 'บริษัทประกัน', 'วันหมดอายุประกัน (YYYY-MM-DD)', 'วันที่จดทะเบียน (YYYY-MM-DD)', 'วันหมดอายุทะเบียน (YYYY-MM-DD)', 'พนักงานขับประจำ', 'สถานะ'],
    ['70-1234', '6ล้อ', 'AP', 'AAT', 'ABC', 'วิริยะ', '2027-03-01', '2018-03-01', '2027-03-01', 'นายสมชาย ใจดี', 'พร้อมใช้'],
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
        owner: String(row[2] || '').trim(),
        businessUnit: String(row[3] || '').trim(),
        yard: String(row[4] || '').trim(),
        insuranceCompany: String(row[5] || '').trim(),
        insuranceExpiry: normalizeImportDate(row[6]),
        registerDate: normalizeImportDate(row[7]),
        registrationExpiry: normalizeImportDate(row[8]),
        assignedDriver: String(row[9] || '').trim(),
        status: String(row[10] || '').trim() || 'พร้อมใช้',
      });
      added++;
    });
    saveVehiclesDB();
    renderVehiclesTable();
    updatePlateDatalist();
    mdPushIfReady();
    showToast(`นำเข้ารถ ${added} รายการ`, 'success');
    event.target.value = '';
  });
}

function updatePlateDatalist() {
  const dl = document.getElementById('plateNoList');
  if (!dl) return;
  dl.innerHTML = mdVehicles.map(v => `<option value="${escapeHtml(v.plate)}"></option>`).join('');
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
  saveCategoriesDB(loadCategoriesDB().filter(c => c !== name));
  renderCategoriesTable();
  showToast('ลบแล้ว', 'warning');
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

function renderMasterData() {
  renderDriversTable();
  renderVehiclesTable();
  renderCustomersTable();
  updateCustomerDatalist();
  updateDriverDatalist();
  updatePlateDatalist();
  renderCategoriesTable();
  if (typeof loadTelegramSettingsForm === 'function') loadTelegramSettingsForm();
}

document.addEventListener('DOMContentLoaded', renderMasterData);

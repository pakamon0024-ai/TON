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
  if (!plate) { showToast('กรุณากรอกทะเบียนรถ', 'error'); return; }
  mdVehicles.push({
    id: Date.now(),
    plate,
    owner: document.getElementById('md-vehicle-owner').value,
    registerDate: document.getElementById('md-vehicle-date').value,
  });
  saveVehiclesDB();
  document.getElementById('md-vehicle-plate').value = '';
  document.getElementById('md-vehicle-owner').value = '';
  document.getElementById('md-vehicle-date').value = '';
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
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = mdVehicles.map(v => `
    <tr>
      <td style="font-family:monospace">${escapeHtml(v.plate)}</td>
      <td>${escapeHtml(v.owner || '-')}</td>
      <td>${formatDate(v.registerDate)}</td>
      <td>${formatDuration(v.registerDate)}</td>
      <td><button class="action-btn action-delete" onclick="deleteVehicleDB(${v.id})">ลบ</button></td>
    </tr>
  `).join('');
}

function downloadVehicleTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'เจ้าของรถ (AP/Subcontractor)', 'วันที่จดทะเบียน (YYYY-MM-DD)'],
    ['70-1234', 'AP', '2018-03-01'],
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
        owner: String(row[1] || '').trim(),
        registerDate: normalizeImportDate(row[2]),
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
  mdBusinessUnits = mdBusinessUnits.filter(n => n !== name);
  saveBusinessUnitsDB();
  renderBusinessUnitsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
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
  mdInsurers = mdInsurers.filter(n => n !== name);
  saveInsurersDB();
  renderInsurersTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
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
  mdYards = mdYards.filter(n => n !== name);
  saveYardsDB();
  renderYardsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
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
  mdIncidentPatterns = mdIncidentPatterns.filter(n => n !== name);
  savePatternsDB();
  renderIncidentPatternsTable();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
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
  mdIssueTopics = mdIssueTopics.filter(n => n !== name);
  saveIssueTopicsDB();
  renderIssueTopicsTable();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
}
function renderIssueTopicsTable() {
  const tbody = document.getElementById('md-topic-body');
  if (!tbody) return;
  if (mdIssueTopics.length === 0) { tbody.innerHTML = '<tr><td colspan="2" class="empty-state">ยังไม่มีข้อมูล</td></tr>'; return; }
  tbody.innerHTML = mdIssueTopics.map(name => `
    <tr><td>${escapeHtml(name)}</td><td><button class="action-btn action-delete" onclick="deleteIssueTopicDB('${escapeHtml(name).replace(/'/g, "&apos;")}')">ลบ</button></td></tr>
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
  if (!confirm('ยืนยันการลบพนักงานคนนี้?')) return;
  mdAbcStaff = mdAbcStaff.filter(s => s.id !== id);
  saveAbcStaffDB();
  renderAbcStaffTable();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
  mdPushIfReady();
  showToast('ลบแล้ว', 'warning');
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
    let added = 0;
    rows.forEach((row, i) => {
      const name = String(row[0] || '').trim();
      if (!name) return;
      if (mdAbcStaff.some(s => s.name === name)) return;
      mdAbcStaff.push({
        id: Date.now() + i,
        name,
        businessUnit: String(row[1] || '').trim(),
      });
      added++;
    });
    saveAbcStaffDB();
    renderAbcStaffTable();
    if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
    mdPushIfReady();
    showToast(`นำเข้าพนักงาน ${added} รายการ`, 'success');
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

// ===== เลือกหัวข้อที่จะบันทึก (แสดงเฉพาะส่วนที่เลือก) =====
const MD_TOPICS = ['driver', 'vehicle', 'bu', 'insurer', 'yard', 'pattern', 'topic', 'abcstaff', 'customer', 'category', 'telegram'];
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
  renderAbcStaffTable();
  renderCategoriesTable();
  if (typeof loadTelegramSettingsForm === 'function') loadTelegramSettingsForm();
  if (typeof incRefreshLookupDropdowns === 'function') incRefreshLookupDropdowns();
  if (typeof wiRefreshLookupDropdowns === 'function') wiRefreshLookupDropdowns();
  if (typeof alcRefreshLookupDropdowns === 'function') alcRefreshLookupDropdowns();
}

document.addEventListener('DOMContentLoaded', renderMasterData);

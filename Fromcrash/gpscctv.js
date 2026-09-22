// ===== ระบบจัดการ GPS/CCTV (ติดตั้ง/ถอด + แจ้งซ่อม) =====
// เก็บ local ที่ localStorage และ sync กับ Firebase (/gpsCctvInstalls, /gpsCctvRepairs)
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// ทะเบียนรถดึงจากฐานข้อมูลหลัก (mdVehicles) — พิมพ์ทะเบียนแล้วเจ้าของรถจะเติมให้อัตโนมัติ

let gcRecords = JSON.parse(localStorage.getItem('finflow_gpscctv_installs') || '[]');
let gcEditingId = null;
let gcRef = null;
let gcReady = false;

let grRecords = JSON.parse(localStorage.getItem('finflow_gpscctv_repairs') || '[]');
let grEditingId = null;
let grRef = null;
let grReady = false;

function gcSave() { safeLocalStorageSet('finflow_gpscctv_installs', JSON.stringify(gcRecords)); }
function grSave() { safeLocalStorageSet('finflow_gpscctv_repairs', JSON.stringify(grRecords)); }

// ===== Sub-tabs (4 แท็บ ใช้ตัวสลับร่วมกัน) =====
function gcSwitchTab(tab) {
  ['list', 'add', 'replist', 'repadd', 'camdb', 'gpsdb', 'bzdb'].forEach(t => {
    document.getElementById(`gc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`gc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') gcRenderList();
  if (tab === 'add' && !gcEditingId) gcClearForm();
  if (tab === 'replist') grRenderList();
  if (tab === 'repadd' && !grEditingId) grClearForm();
  if (tab === 'camdb') ddbRenderList('cam');
  if (tab === 'gpsdb') ddbRenderList('gps');
  if (tab === 'bzdb') ddbRenderList('bz');
}

function gcOnPageShown() {
  gcRenderList(); grRenderList();
  ddbRenderList('cam'); ddbRenderList('gps'); ddbRenderList('bz');
  grFillYardList();
}

// ลานจอดของแจ้งซ่อมเป็นช่องพิมพ์/เลือกอิสระ (ไม่ได้ผูกกับฐานข้อมูลหลักเหมือนเจ้าของรถ เพราะรถคันเดียวกัน
// อาจย้ายลานจอดไปมาได้ ไม่ใช่ค่าคงที่ต่อทะเบียนแบบเจ้าของรถ) — เติมตัวเลือกจากฐานข้อมูลหลัก mdYards
function grFillYardList() {
  const el = document.getElementById('gr-yard-list');
  if (!el) return;
  el.innerHTML = (mdYards || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

// ===== ทะเบียนรถ: ช่องพิมพ์ค้นหา + เลือกจากฐานข้อมูลหลัก (mdVehicles) เท่านั้น =====
// รวมทะเบียนที่เคยบันทึกไว้ในรายการเดิมด้วย เผื่อรถถูกลบออกจากฐานข้อมูลหลักไปแล้วจะได้ไม่หายจากตัวเลือกตอนแก้ไข
function gcAllKnownPlates() {
  const platesFromMaster = typeof mdVehicles !== 'undefined' ? mdVehicles.map(v => v.plate) : [];
  const platesFromRecords = [...gcRecords.map(r => r.plate), ...grRecords.map(r => r.plate)];
  return Array.from(new Set([...platesFromMaster, ...platesFromRecords])).filter(Boolean).sort();
}

// แสดงรายการทะเบียนที่ตรงกับคำที่พิมพ์ (prefix คือ 'gc' หรือ 'gr') — เรียกตอนพิมพ์และตอน focus ช่อง
function gcRenderPlateOptions(prefix) {
  const input = document.getElementById(`${prefix}-plate`);
  const list = document.getElementById(`${prefix}-plate-list`);
  if (!input || !list) return;
  const term = input.value.trim().toLowerCase();
  const all = gcAllKnownPlates();
  const filtered = term ? all.filter(p => p.toLowerCase().includes(term)) : all;
  list.innerHTML = filtered.length
    ? filtered.map(p => `<div class="combo-item" onmousedown="event.preventDefault();gcPickPlate('${prefix}','${escapeHtml(p).replace(/'/g, "\\'")}')">${escapeHtml(p)}</div>`).join('')
    : '<div class="combo-item combo-empty">ไม่พบทะเบียนที่ตรงกัน</div>';
  list.classList.add('show');
}

function gcPickPlate(prefix, plate) {
  document.getElementById(`${prefix}-plate`).value = plate;
  document.getElementById(`${prefix}-plate-list`).classList.remove('show');
  if (prefix === 'gc') { gcLookupVehicle(); gcAutoFillInstallDate(); }
}

// ตอนออกจากช่อง (blur) ถ้าพิมพ์มาไม่ตรงกับทะเบียนที่มีจริงในฐานข้อมูลหลัก ให้ล้างค่าทิ้ง
// (บังคับว่าต้องเลือกจากลิสต์เท่านั้น พิมพ์เองมั่วๆ ไม่ได้)
function gcCommitPlateInput(prefix) {
  setTimeout(() => {
    const input = document.getElementById(`${prefix}-plate`);
    const list = document.getElementById(`${prefix}-plate-list`);
    list.classList.remove('show');
    const val = input.value.trim();
    if (val && !gcAllKnownPlates().includes(val)) {
      input.value = '';
      const ownerEl = document.getElementById(`${prefix}-owner`);
      if (ownerEl) ownerEl.value = '';
      showToast('กรุณาเลือกทะเบียนรถจากรายการเท่านั้น', 'warning');
    } else if (val) {
      // พิมพ์ทะเบียนที่มีจริงมาครบแล้วออกจากช่องเลย (ไม่ได้กดเลือกจากลิสต์) ก็ให้เติมเจ้าของรถให้เหมือนกัน (เฉพาะ gc)
      if (prefix === 'gc') { gcLookupVehicle(); gcAutoFillInstallDate(); }
    }
  }, 150);
}

// วันที่ติดตั้งดึงจาก "ฐานข้อมูลหลัก" (mdVehicles) ตรงๆ เสมอ — ทะเบียนแต่ละคันมีช่อง "GPS วันที่ติดตั้ง"
// และ "CCTV วันที่ติดตั้ง" แยกกันในหน้าฐานข้อมูลหลัก แก้ไขที่นั่นเท่านั้น ช่องนี้จึงล็อกไว้เสมอไม่ให้พิมพ์เอง
function gcAutoFillInstallDate() {
  const plate = document.getElementById('gc-plate').value.trim();
  const device = document.getElementById('gc-device').value;
  const installDateInput = document.getElementById('gc-install-date');
  installDateInput.readOnly = true;
  const veh = typeof mdVehicles !== 'undefined' ? mdVehicles.find(v => v.plate === plate) : null;
  installDateInput.value = (device === 'CCTV' ? veh?.cctvInstallDate : veh?.gpsInstallDate) || '';
}

function gcLookupVehicle() {
  const plate = document.getElementById('gc-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('gc-owner').value = veh?.owner || '';
}

// ===== ติดตั้ง/ถอด: Running number =====
function gcNextRunningNo() { return gcRecords.length ? Math.max(...gcRecords.map(r => r.runningNo || 0)) + 1 : 1; }

function gcSaveCase() {
  const plate = document.getElementById('gc-plate').value.trim();
  const owner = document.getElementById('gc-owner').value.trim();
  const device = document.getElementById('gc-device').value;
  const company = document.getElementById('gc-company').value.trim();
  const installDate = document.getElementById('gc-install-date').value;
  const removeDate = document.getElementById('gc-remove-date').value;
  const note = document.getElementById('gc-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  // ไม่บังคับว่าต้องกรอกวันที่ติดตั้งเสมอไป — บันทึกแค่วันที่ติดตั้ง หรือแค่วันที่ถอด อย่างใดอย่างหนึ่งก็ได้
  if (!installDate && !removeDate) { showToast('กรุณาระบุวันที่ติดตั้งหรือวันที่ถอดอย่างน้อยหนึ่งอย่าง', 'warning'); return; }

  const record = { plate, owner, device, company, installDate, removeDate, note };

  let savedRecord;
  if (gcEditingId) {
    const idx = gcRecords.findIndex(r => r.id === gcEditingId);
    if (idx >= 0) {
      gcRecords[idx] = { ...gcRecords[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = gcRecords[idx];
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    gcCancelEdit();
  } else {
    record.id = 'GC_' + Date.now();
    record.runningNo = gcNextRunningNo();
    record.createdAt = new Date().toISOString();
    gcRecords.unshift(record);
    savedRecord = record;
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `📡 <b>บันทึกติดตั้ง${device}ใหม่</b>\nทะเบียน: ${escapeHtml(plate)}\nบริษัท: ${escapeHtml(company || '-')}` +
        (installDate ? `\nวันที่ติดตั้ง: ${formatDate(installDate)}` : '') +
        (removeDate ? `\nวันที่ถอด: ${formatDate(removeDate)}` : '')
      );
    }
    gcClearForm();
  }
  gcSave();
  gcPushOneIfReady(savedRecord);
  gcRenderList();
}

function gcClearForm() {
  gcEditingId = null;
  document.getElementById('gc-edit-banner').style.display = 'none';
  document.getElementById('gc-plate').value = '';
  document.getElementById('gc-owner').value = '';
  document.getElementById('gc-device').value = 'GPS';
  document.getElementById('gc-company').value = '';
  document.getElementById('gc-install-date').value = '';
  document.getElementById('gc-install-date').readOnly = true;
  document.getElementById('gc-remove-date').value = '';
  document.getElementById('gc-note').value = '';
}

function gcEditCase(id) {
  const rec = gcRecords.find(r => r.id === id);
  if (!rec) return;
  gcEditingId = id;
  document.getElementById('gc-edit-banner').style.display = 'flex';
  document.getElementById('gc-edit-no').textContent = rec.runningNo;
  document.getElementById('gc-plate').value = rec.plate || '';
  document.getElementById('gc-owner').value = rec.owner || '';
  document.getElementById('gc-device').value = rec.device || 'GPS';
  document.getElementById('gc-company').value = rec.company || '';
  document.getElementById('gc-install-date').value = rec.installDate || '';
  // ตอนแก้ไขรายการที่มีอยู่แล้ว ให้แก้วันที่ติดตั้งของรายการนั้นตรงๆ ได้ (ไม่ล็อก) ต่างจากตอนเพิ่มใหม่
  document.getElementById('gc-install-date').readOnly = false;
  document.getElementById('gc-remove-date').value = rec.removeDate || '';
  document.getElementById('gc-note').value = rec.note || '';
  gcSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function gcCancelEdit() { gcClearForm(); }

function gcDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  gcRecords = gcRecords.filter(r => r.id !== id);
  gcSave();
  gcRemoveOneIfReady(id);
  gcRenderList();
  showToast('ลบแล้ว', 'warning');
}

function gcDeleteAllCases() {
  if (typeof mdIsAdmin === 'function' && !mdIsAdmin()) { showToast('เฉพาะแอดมินเท่านั้นที่ลบทั้งหมดได้', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบรายการติดตั้ง/ถอดทั้งหมด ${gcRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  gcRecords = [];
  gcSave();
  gcPushIfReady();
  gcRenderList();
  showToast('ลบรายการติดตั้ง/ถอดทั้งหมดแล้ว', 'warning');
}

// หน้านี้เป็น "สถิติจากบันทึกการถอด" เท่านั้น — แสดงเฉพาะรายการที่บันทึกวันที่ถอดแล้ว (สร้างจากฟอร์ม
// "เพิ่มบันทึกติดตั้ง/ถอด") ไม่โชว์ข้อมูลติดตั้งดิบของรถทุกคันที่มีอยู่ในระบบ
function gcFilteredList() {
  const plate = (document.getElementById('gc-f-plate')?.value || '').trim().toLowerCase();
  const device = document.getElementById('gc-f-device')?.value || '';
  return gcRecords.filter(r => {
    if (!r.removeDate) return false;
    if (plate && !r.plate.toLowerCase().includes(plate)) return false;
    if (device && r.device !== device) return false;
    return true;
  });
}

function gcClearListFilters() {
  document.getElementById('gc-f-plate').value = '';
  document.getElementById('gc-f-device').value = '';
  gcRenderList();
}

function gcRenderList() {
  const list = gcFilteredList();
  const tbody = document.getElementById('gc-list-body');
  const countEl = document.getElementById('gc-list-count');
  const pagerEl = document.getElementById('gc-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('gc-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('gc-list', page, totalPages, total, 'gcRenderList');
  tbody.innerHTML = pageItems.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
      <td>${escapeHtml(r.device || '-')}</td>
      <td>${escapeHtml(r.company || '-')}</td>
      <td>${formatDate(r.installDate)}</td>
      <td>${formatDate(r.removeDate)}</td>
      <td>${escapeHtml(r.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="gcEditCase('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="gcDeleteCase('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== แจ้งซ่อม: Running number / สถานะ =====
function grNextRunningNo() { return grRecords.length ? Math.max(...grRecords.map(r => r.runningNo || 0)) + 1 : 1; }
const GR_STATUS_OPTIONS = [
  { value: 'pending', label: 'รอซ่อม', badge: 'badge-orange' },
  { value: 'done', label: 'ซ่อมเสร็จแล้ว', badge: 'badge-green' },
];
// เดิมสถานะคำนวนจาก "มีวันที่ช่างมาซ่อมหรือไม่" ตอนนี้ให้เลือกสถานะเองตรงๆ ในฟอร์มแทน
// รายการเก่าที่ยังไม่มีช่อง status (บันทึกไว้ก่อนเพิ่มฟีเจอร์นี้) ให้เดาจาก repairDate ไปพลางก่อน
// ไม่ต้องรันสคริปต์ย้อนหลัง — พอแก้ไขแล้วบันทึกใหม่ก็จะมี status ตรงๆ ทันที
function grStatusOf(rec) { return rec.status || (rec.repairDate ? 'done' : 'pending'); }
function grStatusBadge(rec) {
  const opt = GR_STATUS_OPTIONS.find(o => o.value === grStatusOf(rec)) || GR_STATUS_OPTIONS[0];
  return `<span class="badge ${opt.badge}">${opt.label}</span>`;
}

function grSaveCase() {
  const plate = document.getElementById('gr-plate').value.trim();
  const yard = document.getElementById('gr-yard').value.trim();
  const device = document.getElementById('gr-device').value;
  const symptom = document.getElementById('gr-symptom').value.trim();
  const appointmentDate = document.getElementById('gr-appointment-date').value;
  const repairDate = document.getElementById('gr-repair-date').value;
  const status = document.getElementById('gr-status').value;
  const note = document.getElementById('gr-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  if (!symptom) { showToast('กรุณาระบุอาการ', 'warning'); return; }

  const record = { plate, yard, device, symptom, appointmentDate, repairDate, status, note };

  let savedRecord;
  if (grEditingId) {
    const idx = grRecords.findIndex(r => r.id === grEditingId);
    if (idx >= 0) {
      grRecords[idx] = { ...grRecords[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = grRecords[idx];
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    grCancelEdit();
  } else {
    record.id = 'GR_' + Date.now();
    record.runningNo = grNextRunningNo();
    record.createdAt = new Date().toISOString();
    grRecords.unshift(record);
    savedRecord = record;
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🔧 <b>แจ้งซ่อม${device}ใหม่</b>\nทะเบียน: ${escapeHtml(plate)}\nอาการ: ${escapeHtml(symptom)}${appointmentDate ? `\nวันที่นัดซ่อม: ${formatDate(appointmentDate)}` : ''}`
      );
    }
    grClearForm();
  }
  grSave();
  grPushOneIfReady(savedRecord);
  grRenderList();
}

function grClearForm() {
  grEditingId = null;
  document.getElementById('gr-edit-banner').style.display = 'none';
  document.getElementById('gr-plate').value = '';
  document.getElementById('gr-yard').value = '';
  document.getElementById('gr-device').value = 'GPS';
  document.getElementById('gr-symptom').value = '';
  document.getElementById('gr-appointment-date').value = '';
  document.getElementById('gr-repair-date').value = '';
  document.getElementById('gr-status').value = 'pending';
  document.getElementById('gr-note').value = '';
}

function grEditCase(id) {
  const rec = grRecords.find(r => r.id === id);
  if (!rec) return;
  grEditingId = id;
  document.getElementById('gr-edit-banner').style.display = 'flex';
  document.getElementById('gr-edit-no').textContent = rec.runningNo;
  document.getElementById('gr-plate').value = rec.plate || '';
  document.getElementById('gr-yard').value = rec.yard || '';
  document.getElementById('gr-device').value = rec.device || 'GPS';
  document.getElementById('gr-symptom').value = rec.symptom || '';
  document.getElementById('gr-appointment-date').value = rec.appointmentDate || '';
  document.getElementById('gr-repair-date').value = rec.repairDate || '';
  document.getElementById('gr-status').value = grStatusOf(rec);
  document.getElementById('gr-note').value = rec.note || '';
  gcSwitchTab('repadd');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function grCancelEdit() { grClearForm(); }

function grDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  grRecords = grRecords.filter(r => r.id !== id);
  grSave();
  grRemoveOneIfReady(id);
  grRenderList();
  showToast('ลบแล้ว', 'warning');
}

function grFilteredList() {
  const plate = (document.getElementById('gr-f-plate')?.value || '').trim().toLowerCase();
  const device = document.getElementById('gr-f-device')?.value || '';
  const status = document.getElementById('gr-f-status')?.value || '';
  return grRecords.filter(r => {
    if (plate && !r.plate.toLowerCase().includes(plate)) return false;
    if (device && r.device !== device) return false;
    if (status && grStatusOf(r) !== status) return false;
    return true;
  });
}

function grClearListFilters() {
  document.getElementById('gr-f-plate').value = '';
  document.getElementById('gr-f-device').value = '';
  document.getElementById('gr-f-status').value = '';
  grRenderList();
}

function grRenderList() {
  const list = grFilteredList();
  const tbody = document.getElementById('gr-list-body');
  const countEl = document.getElementById('gr-list-count');
  const pagerEl = document.getElementById('gr-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('gr-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('gr-list', page, totalPages, total, 'grRenderList');
  tbody.innerHTML = pageItems.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.device || '-')}</td>
      <td>${escapeHtml(r.symptom || '-')}</td>
      <td>${r.appointmentDate ? formatDate(r.appointmentDate) : '-'}</td>
      <td>${r.repairDate ? formatDate(r.repairDate) : '-'}</td>
      <td>${grStatusBadge(r)}</td>
      <td>${escapeHtml(r.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="grEditCase('${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="grDeleteCase('${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel: ติดตั้ง/ถอด (นำเข้าซ้ำ = แก้ไข จับคู่ด้วยทะเบียน+อุปกรณ์+วันที่ติดตั้ง) =====
function gcDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์ (GPS/CCTV)', 'บริษัท', 'วันที่ติดตั้ง (dd/mm/yyyy)', 'วันที่ถอด (dd/mm/yyyy)', 'หมายเหตุ'],
    ['70-1234', 'นายสมชาย ใจดี', 'GPS', 'บริษัท ตัวอย่าง จำกัด', '15/01/2026', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ติดตั้ง-ถอด');
  XLSX.writeFile(wb, 'template_GPS_CCTV_ติดตั้ง.xlsx');
}

function gcExportExcel() {
  const list = gcFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์', 'บริษัท', 'วันที่ติดตั้ง', 'วันที่ถอด', 'หมายเหตุ'],
    ...list.map(r => [r.runningNo, r.plate, r.owner || '', r.device || '', r.company || '', formatDMY(r.installDate), formatDMY(r.removeDate), r.note || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ติดตั้ง-ถอด');
  XLSX.writeFile(wb, `GPS_CCTV_ติดตั้ง_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function gcImportExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      const device = String(row[2] || '').trim().toUpperCase() === 'CCTV' ? 'CCTV' : 'GPS';
      const installDate = normalizeImportDate(row[4]);
      const veh = mdVehicles.find(v => v.plate === plate);
      const record = {
        plate, owner: String(row[1] || '').trim() || veh?.owner || '', device,
        company: String(row[3] || '').trim(), installDate, removeDate: normalizeImportDate(row[5]),
        note: String(row[6] || '').trim(),
      };
      const idx = gcRecords.findIndex(r => r.plate === plate && r.device === device && r.installDate === installDate);
      if (idx >= 0) { gcRecords[idx] = { ...gcRecords[idx], ...record, updatedAt: new Date().toISOString() }; updated++; }
      else { gcRecords.unshift({ id: 'GC_' + Date.now() + '_' + i, runningNo: gcNextRunningNo(), ...record, createdAt: new Date().toISOString() }); added++; }
    });
    gcSave();
    gcPushIfReady();
    gcRenderList();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== Excel: แจ้งซ่อม (นำเข้าซ้ำ = แก้ไข จับคู่ด้วยทะเบียน+อุปกรณ์+วันที่แจ้ง) =====
function grDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'ลานจอด', 'ประเภทอุปกรณ์ (GPS/CCTV)', 'อาการ', 'วันที่แจ้ง (dd/mm/yyyy)', 'วันที่นัดซ่อม (dd/mm/yyyy)', 'สถานะ (รอซ่อม/ซ่อมเสร็จแล้ว)', 'หมายเหตุ'],
    ['70-1234', 'ABC', 'GPS', 'สัญญาณขาดหาย', '01/02/2026', '05/02/2026', 'รอซ่อม', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'แจ้งซ่อม');
  XLSX.writeFile(wb, 'template_GPS_CCTV_แจ้งซ่อม.xlsx');
}

function grExportExcel() {
  const list = grFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'ทะเบียนรถ', 'ลานจอด', 'ประเภทอุปกรณ์', 'อาการ', 'วันที่แจ้ง', 'วันที่นัดซ่อม', 'สถานะ', 'หมายเหตุ'],
    ...list.map(r => [r.runningNo, r.plate, r.yard || '', r.device || '', r.symptom || '', formatDMY(r.appointmentDate), formatDMY(r.repairDate), GR_STATUS_OPTIONS.find(o => o.value === grStatusOf(r))?.label || 'รอซ่อม', r.note || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'แจ้งซ่อม');
  XLSX.writeFile(wb, `GPS_CCTV_แจ้งซ่อม_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function grImportExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    rows.forEach((row, i) => {
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      const device = String(row[2] || '').trim().toUpperCase() === 'CCTV' ? 'CCTV' : 'GPS';
      const appointmentDate = normalizeImportDate(row[4]);
      const statusText = String(row[6] || '').trim();
      const record = {
        plate, yard: String(row[1] || '').trim(), device,
        symptom: String(row[3] || '').trim(), appointmentDate, repairDate: normalizeImportDate(row[5]),
        status: statusText === 'ซ่อมเสร็จแล้ว' ? 'done' : 'pending',
        note: String(row[7] || '').trim(),
      };
      const idx = grRecords.findIndex(r => r.plate === plate && r.device === device && r.appointmentDate === appointmentDate);
      if (idx >= 0) { grRecords[idx] = { ...grRecords[idx], ...record, updatedAt: new Date().toISOString() }; updated++; }
      else { grRecords.unshift({ id: 'GR_' + Date.now() + '_' + i, runningNo: grNextRunningNo(), ...record, createdAt: new Date().toISOString() }); added++; }
    });
    grSave();
    grPushIfReady();
    grRenderList();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== บันทึกภาพรายงานแจ้งซ่อม (ตารางสวยงาม แคปด้วย html2canvas เหมือนรายงานอุบัติเหตุ) =====
// ใช้ #gr-report-container ที่วางไว้นอกจอถาวร (left: -1300px) ดึงมาวางที่ left:0 ชั่วคราวตอนแคป
// แล้วเลื่อนกลับที่เดิม ไม่ต้องสร้าง DOM ใหม่ทุกครั้ง
async function grSaveReportImage() {
  const rpt = document.getElementById('gr-report-container');
  const tbody = document.getElementById('gr-report-body');
  if (!rpt || !tbody) return;

  const list = grFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้บันทึกภาพ', 'warning'); return; }

  const now = new Date();
  document.getElementById('gr-rpt-date-text').textContent = 'จัดทำ: ' + now.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('gr-rpt-total-count').textContent = list.length;
  tbody.innerHTML = list.map((r, i) => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.yard || '-')}</td>
      <td>${escapeHtml(r.device || '-')}</td>
      <td>${escapeHtml(r.symptom || '-')}</td>
      <td>${r.appointmentDate ? formatDate(r.appointmentDate) : '-'}</td>
      <td>${r.repairDate ? formatDate(r.repairDate) : '-'}</td>
      <td>${grStatusBadge(r)}</td>
      <td>${escapeHtml(r.note || '-')}</td>
    </tr>
  `).join('');

  rpt.style.height = 'auto';
  rpt.style.left = '0';
  await new Promise(r => setTimeout(r, 60));
  const captureH = rpt.offsetHeight;
  rpt.style.height = captureH + 'px';
  await new Promise(r => setTimeout(r, 60));

  const savedScroll = window.scrollY;
  window.scrollTo(0, 0);
  await new Promise(r => setTimeout(r, 60));

  try {
    const canvas = await html2canvas(rpt, { width: rpt.offsetWidth, height: captureH, scale: 2, useCORS: true, logging: false, scrollX: 0, scrollY: 0 });
    const link = document.createElement('a');
    link.download = 'รายงานแจ้งซ่อม_GPS_CCTV_' + now.toISOString().slice(0, 10) + '.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
    showToast('บันทึกภาพรายงานเรียบร้อย', 'success');
  } catch (e) {
    showToast('สร้างภาพรายงานไม่ได้: ' + e.message, 'error');
  }

  window.scrollTo(0, savedScroll);
  rpt.style.left = '-1300px';
}

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function gcRecordsToObj(arr) { const o = {}; (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; }); return o; }
function gcObjToRecords(obj) { if (!obj) return []; if (Array.isArray(obj)) return obj.filter(Boolean); return Object.values(obj).filter(r => r && r.id); }
function gcApplyServer(serverRecords) { gcRecords = serverRecords; gcSave(); gcRenderList(); }
async function gcWriteFB() {
  if (!gcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(gcRef, gcRecordsToObj(gcRecords));
  } catch (e) { console.warn('gcWriteFB error', e); notifySyncWriteError(e.message); }
}
function gcPushIfReady() { if (gcReady) gcWriteFB(); }

async function gcWriteOne(record) {
  if (!gcRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/gpsCctvInstalls/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('gcWriteOne error', e); notifySyncWriteError(e.message); }
}
function gcPushOneIfReady(record) { if (gcReady) gcWriteOne(record); }

async function gcRemoveOne(id) {
  if (!gcRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/gpsCctvInstalls/${id}`));
  } catch (e) { console.warn('gcRemoveOne error', e); notifySyncWriteError(e.message); }
}
function gcRemoveOneIfReady(id) { if (gcReady) gcRemoveOne(id); }

function grApplyServer(serverRecords) { grRecords = serverRecords; grSave(); grRenderList(); }
async function grWriteFB() {
  if (!grRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(grRef, gcRecordsToObj(grRecords));
  } catch (e) { console.warn('grWriteFB error', e); notifySyncWriteError(e.message); }
}
function grPushIfReady() { if (grReady) grWriteFB(); }

async function grWriteOne(record) {
  if (!grRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/gpsCctvRepairs/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('grWriteOne error', e); notifySyncWriteError(e.message); }
}
function grPushOneIfReady(record) { if (grReady) grWriteOne(record); }

async function grRemoveOne(id) {
  if (!grRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/gpsCctvRepairs/${id}`));
  } catch (e) { console.warn('grRemoveOne error', e); notifySyncWriteError(e.message); }
}
function grRemoveOneIfReady(id) { if (grReady) grRemoveOne(id); }

function gcWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function gcInit() {
  await gcWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    gcRef = ref(fbDb, '/gpsCctvInstalls');
    grRef = ref(fbDb, '/gpsCctvRepairs');
    const [gcSnap, grSnap] = await Promise.allSettled([get(gcRef), get(grRef)]);
    if (gcSnap.status === 'fulfilled' && gcSnap.value.exists()) gcApplyServer(gcObjToRecords(gcSnap.value.val()));
    if (grSnap.status === 'fulfilled' && grSnap.value.exists()) grApplyServer(gcObjToRecords(grSnap.value.val()));
    gcReady = true;
    grReady = true;
    if (gcSnap.status === 'fulfilled' && !gcSnap.value.exists() && gcRecords.length > 0) await gcWriteFB();
    if (grSnap.status === 'fulfilled' && !grSnap.value.exists() && grRecords.length > 0) await grWriteFB();
    onValue(gcRef, s => { if (s.exists()) gcApplyServer(gcObjToRecords(s.val())); });
    onValue(grRef, s => { if (s.exists()) grApplyServer(gcObjToRecords(s.val())); });
  } catch (e) {
    console.warn('gcInit error', e);
    notifySyncLoadError(e.message);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  gcClearForm();
  grClearForm();
  gcRenderList();
  grRenderList();
  grFillYardList();
  gcInit();
  ddbRenderList('cam'); ddbRenderList('gps'); ddbRenderList('bz');
  ddbInit();
});

// ===== ฐานข้อมูลอุปกรณ์ (กล้อง / GPS / เครื่องเป่าแอลกอฮอล์) =====
// ทั้ง 3 หัวข้อมีโครงสร้างข้อมูลเหมือนกันทุกช่อง เลยใช้ฟังก์ชันร่วมกันตัวเดียว รับ type ('cam'/'gps'/'bz')
// เก็บ local ที่ localStorage แยกคนละ key ต่อ type และ sync กับ Firebase คนละ path (/deviceCamDB, /deviceGpsDB, /deviceBzDB)
const DDB_TYPES = ['cam', 'gps', 'bz'];
const DDB_LABELS = { cam: 'กล้อง', gps: 'GPS', bz: 'เครื่องเป่าแอลกอฮอล์' };
const DDB_FB_PATH = { cam: '/deviceCamDB', gps: '/deviceGpsDB', bz: '/deviceBzDB' };
const DDB_STATUS_OPTIONS = ['ปกติ', 'รอย้าย', 'ติดตั้งใหม่', 'ย้ายแล้ว'];

let ddbRecords = {};
let ddbEditingId = {};
let ddbRef = {};
let ddbReady = {};
DDB_TYPES.forEach(t => {
  ddbRecords[t] = JSON.parse(localStorage.getItem(`finflow_devicedb_${t}`) || '[]');
  ddbEditingId[t] = null;
  ddbRef[t] = null;
  ddbReady[t] = false;
});

function ddbSave(type) { safeLocalStorageSet(`finflow_devicedb_${type}`, JSON.stringify(ddbRecords[type])); }
function ddbNextRunningNo(type) {
  const list = ddbRecords[type];
  return list.length ? Math.max(...list.map(r => r.runningNo || 0)) + 1 : 1;
}

function ddbLookupVehicle(type) {
  const plate = document.getElementById(`ddb-${type}-plate`).value.trim();
  const veh = (mdVehicles || []).find(v => v.plate === plate);
  if (veh?.owner) document.getElementById(`ddb-${type}-owner`).value = veh.owner;
}

// คำนวณวันที่หมดสัญญา (วันที่ติดตั้ง + 3 ปี) ใช้ทั้งตอนกรอกฟอร์มและตอนแสดงตาราง
function ddbComputeContractEnd(installDate) {
  if (!installDate) return '';
  const d = new Date(installDate);
  if (isNaN(d)) return '';
  d.setFullYear(d.getFullYear() + 3);
  return d.toISOString().substring(0, 10);
}

// พอกรอกวันที่ติดตั้ง คำนวณ "วันที่หมดสัญญา" ให้อัตโนมัติเป็นวันที่ติดตั้ง + 3 ปี (แก้ไขเองภายหลังได้ตามปกติ)
function ddbAutoFillContractEnd(type) {
  const contractEnd = ddbComputeContractEnd(document.getElementById(`ddb-${type}-install-date`).value);
  if (contractEnd) document.getElementById(`ddb-${type}-contract-end`).value = contractEnd;
}

function ddbFilteredList(type) {
  const search = (document.getElementById(`ddb-${type}-search`)?.value || '').trim().toLowerCase();
  const list = search ? ddbRecords[type].filter(r => (r.plate || '').toLowerCase().includes(search)) : ddbRecords[type];
  return list;
}

function ddbRenderList(type) {
  const tbody = document.getElementById(`ddb-${type}-body`);
  const pagerEl = document.getElementById(`ddb-${type}-pager`);
  if (!tbody) return;
  const list = ddbFilteredList(type);
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">${ddbRecords[type].length === 0 ? 'ยังไม่มีข้อมูล' : 'ไม่พบรายการที่ค้นหา'}</td></tr>`;
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total, start } = paginateSlice(`ddb-${type}`, list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml(`ddb-${type}`, page, totalPages, total, `ddbRenderList_${type}`);
  tbody.innerHTML = pageItems.map((r, i) => `
    <tr>
      <td>${start + i + 1}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || (mdVehicles || []).find(v => v.plate === r.plate)?.owner || '-')}</td>
      <td>${escapeHtml(r.simNo || '-')}</td>
      <td>${r.installDate ? formatDate(r.installDate) : '-'}</td>
      <td>${formatDate(r.contractEndDate || ddbComputeContractEnd(r.installDate))}</td>
      <td>${r.removeDate ? formatDate(r.removeDate) : '-'}</td>
      <td>${escapeHtml(r.status || '-')}</td>
      <td>${escapeHtml(r.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="ddbEditRecord('${type}', '${r.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="ddbDeleteRecord('${type}', '${r.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}
function ddbRenderList_cam() { ddbRenderList('cam'); }
function ddbRenderList_gps() { ddbRenderList('gps'); }
function ddbRenderList_bz() { ddbRenderList('bz'); }

function ddbClearForm(type) {
  ddbEditingId[type] = null;
  ['plate', 'owner', 'simno', 'install-date', 'contract-end', 'remove-date', 'note'].forEach(f => {
    const el = document.getElementById(`ddb-${type}-${f}`);
    if (el) el.value = '';
  });
  document.getElementById(`ddb-${type}-status`).value = DDB_STATUS_OPTIONS[0];
  const saveBtn = document.getElementById(`ddb-${type}-save-btn`);
  if (saveBtn) saveBtn.textContent = '💾 บันทึก';
  const cancelBtn = document.getElementById(`ddb-${type}-cancel-btn`);
  if (cancelBtn) cancelBtn.style.display = 'none';
}

function ddbSaveRecord(type) {
  const plate = document.getElementById(`ddb-${type}-plate`).value.trim();
  if (!plate) { showToast('กรุณากรอกทะเบียนรถ', 'error'); return; }
  const data = {
    plate,
    owner: document.getElementById(`ddb-${type}-owner`).value.trim(),
    simNo: document.getElementById(`ddb-${type}-simno`).value.trim(),
    installDate: document.getElementById(`ddb-${type}-install-date`).value,
    contractEndDate: document.getElementById(`ddb-${type}-contract-end`).value,
    removeDate: document.getElementById(`ddb-${type}-remove-date`).value,
    status: document.getElementById(`ddb-${type}-status`).value,
    note: document.getElementById(`ddb-${type}-note`).value.trim(),
  };

  let savedRecord;
  if (ddbEditingId[type]) {
    const idx = ddbRecords[type].findIndex(r => r.id === ddbEditingId[type]);
    if (idx >= 0) {
      ddbRecords[type][idx] = { ...ddbRecords[type][idx], ...data, updatedAt: new Date().toISOString() };
      savedRecord = ddbRecords[type][idx];
    }
    ddbClearForm(type);
    showToast(`แก้ไขฐานข้อมูล${DDB_LABELS[type]}แล้ว`, 'success');
  } else {
    savedRecord = { id: `DDB_${type}_${Date.now()}`, runningNo: ddbNextRunningNo(type), ...data, createdAt: new Date().toISOString() };
    ddbRecords[type].push(savedRecord);
    showToast(`เพิ่มฐานข้อมูล${DDB_LABELS[type]}แล้ว`, 'success');
  }
  ddbSave(type);
  ddbRenderList(type);
  if (ddbReady[type]) ddbWriteOne(type, savedRecord);
}

function ddbEditRecord(type, id) {
  const rec = ddbRecords[type].find(r => r.id === id);
  if (!rec) return;
  ddbEditingId[type] = id;
  document.getElementById(`ddb-${type}-plate`).value = rec.plate || '';
  document.getElementById(`ddb-${type}-owner`).value = rec.owner || '';
  document.getElementById(`ddb-${type}-simno`).value = rec.simNo || '';
  document.getElementById(`ddb-${type}-install-date`).value = rec.installDate || '';
  document.getElementById(`ddb-${type}-contract-end`).value = rec.contractEndDate || '';
  document.getElementById(`ddb-${type}-remove-date`).value = rec.removeDate || '';
  document.getElementById(`ddb-${type}-status`).value = rec.status || DDB_STATUS_OPTIONS[0];
  document.getElementById(`ddb-${type}-note`).value = rec.note || '';
  const saveBtn = document.getElementById(`ddb-${type}-save-btn`);
  if (saveBtn) saveBtn.textContent = '💾 บันทึกการแก้ไข';
  const cancelBtn = document.getElementById(`ddb-${type}-cancel-btn`);
  if (cancelBtn) cancelBtn.style.display = '';
  document.getElementById(`ddb-${type}-plate`).scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function ddbCancelEdit(type) { ddbClearForm(type); }

function ddbDeleteRecord(type, id) {
  if (!confirmDeleteWithPin(`ยืนยันการลบรายการนี้ออกจากฐานข้อมูล${DDB_LABELS[type]}?`)) return;
  ddbRecords[type] = ddbRecords[type].filter(r => r.id !== id);
  if (ddbEditingId[type] === id) ddbClearForm(type);
  ddbSave(type);
  ddbRenderList(type);
  if (ddbReady[type]) ddbRemoveOne(type, id);
  showToast('ลบแล้ว', 'warning');
}

function ddbDeleteAll(type) {
  if (!mdConfirmDeleteAll(`ฐานข้อมูล${DDB_LABELS[type]}`)) return;
  ddbRecords[type] = [];
  ddbSave(type);
  ddbRenderList(type);
  if (ddbReady[type]) ddbWriteFB(type);
  showToast(`ลบฐานข้อมูล${DDB_LABELS[type]}ทั้งหมดแล้ว`, 'warning');
}

// ===== Excel =====
function ddbDownloadTemplate(type) {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'ชื่อเจ้าของ', 'เลขซิม', 'วันที่ติดตั้ง (dd/mm/yyyy)', 'วันที่หมดสัญญา (dd/mm/yyyy)', 'วันที่ถอด (dd/mm/yyyy)', 'สถานะ (รอย้าย/ติดตั้งใหม่/ย้ายแล้ว)', 'หมายเหตุ'],
    ['70-1234', 'นายสมชาย ใจดี', '0812345678', '15/01/2026', '15/01/2027', '', 'ติดตั้งใหม่', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, DDB_LABELS[type]);
  XLSX.writeFile(wb, `template_ฐานข้อมูล${DDB_LABELS[type]}.xlsx`);
}

function ddbExportExcel(type) {
  const list = ddbFilteredList(type);
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['ลำดับ', 'ทะเบียนรถ', 'ชื่อเจ้าของ', 'เลขซิม', 'วันที่ติดตั้ง', 'วันที่หมดสัญญา', 'วันที่ถอด', 'สถานะ', 'หมายเหตุ'],
    ...list.map((r, i) => [i + 1, r.plate, r.owner || '', r.simNo || '', formatDMY(r.installDate), formatDMY(r.contractEndDate), formatDMY(r.removeDate), r.status || '', r.note || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, DDB_LABELS[type]);
  XLSX.writeFile(wb, `ฐานข้อมูล${DDB_LABELS[type]}_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

function ddbImportExcel(type, event) {
  const file = event.target.files[0]; if (!file) return;
  readExcelRows(file, (err, rows) => {
    if (err) { showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error'); event.target.value = ''; return; }
    let added = 0, updated = 0;
    const touched = [];
    rows.forEach((row, i) => {
      const plate = String(row[0] || '').trim();
      if (!plate) return;
      const status = DDB_STATUS_OPTIONS.includes(String(row[6] || '').trim()) ? String(row[6]).trim() : DDB_STATUS_OPTIONS[0];
      const veh = (mdVehicles || []).find(v => v.plate === plate);
      const record = {
        plate, owner: String(row[1] || '').trim() || veh?.owner || '', simNo: String(row[2] || '').trim(),
        installDate: normalizeImportDate(row[3]), contractEndDate: normalizeImportDate(row[4]), removeDate: normalizeImportDate(row[5]),
        status, note: String(row[7] || '').trim(),
      };
      const idx = ddbRecords[type].findIndex(r => r.plate === plate);
      if (idx >= 0) { ddbRecords[type][idx] = { ...ddbRecords[type][idx], ...record, updatedAt: new Date().toISOString() }; updated++; touched.push(ddbRecords[type][idx]); }
      else {
        const rec = { id: `DDB_${type}_${Date.now()}_${i}`, runningNo: ddbNextRunningNo(type), ...record, createdAt: new Date().toISOString() };
        ddbRecords[type].push(rec); added++; touched.push(rec);
      }
    });
    ddbSave(type);
    ddbRenderList(type);
    if (ddbReady[type]) touched.forEach(r => ddbWriteOne(type, r));
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== Firebase Sync =====
function ddbRecordsToObj(arr) { const o = {}; (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; }); return o; }
function ddbObjToRecords(obj) { if (!obj) return []; if (Array.isArray(obj)) return obj.filter(Boolean); return Object.values(obj).filter(r => r && r.id); }
function ddbApplyServer(type, serverRecords) { ddbRecords[type] = serverRecords; ddbSave(type); ddbRenderList(type); }

async function ddbWriteFB(type) {
  if (!ddbRef[type]) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ddbRef[type], ddbRecordsToObj(ddbRecords[type]));
  } catch (e) { console.warn('ddbWriteFB error', type, e); notifySyncWriteError(e.message); }
}

async function ddbWriteOne(type, record) {
  if (!ddbRef[type] || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `${DDB_FB_PATH[type]}/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('ddbWriteOne error', type, e); notifySyncWriteError(e.message); }
}

async function ddbRemoveOne(type, id) {
  if (!ddbRef[type]) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `${DDB_FB_PATH[type]}/${id}`));
  } catch (e) { console.warn('ddbRemoveOne error', type, e); notifySyncWriteError(e.message); }
}

async function ddbInit() {
  await gcWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    for (const type of DDB_TYPES) {
      ddbRef[type] = ref(fbDb, DDB_FB_PATH[type]);
      const snap = await get(ddbRef[type]);
      if (snap.exists()) ddbApplyServer(type, ddbObjToRecords(snap.val()));
      ddbReady[type] = true;
      if (!snap.exists() && ddbRecords[type].length > 0) await ddbWriteFB(type);
      onValue(ddbRef[type], s => { if (s.exists()) ddbApplyServer(type, ddbObjToRecords(s.val())); });
    }
  } catch (e) {
    console.warn('ddbInit error', e);
    notifySyncLoadError(e.message);
  }
}

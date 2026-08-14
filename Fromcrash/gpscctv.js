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

function gcSave() { localStorage.setItem('finflow_gpscctv_installs', JSON.stringify(gcRecords)); }
function grSave() { localStorage.setItem('finflow_gpscctv_repairs', JSON.stringify(grRecords)); }

// ===== Sub-tabs (4 แท็บ ใช้ตัวสลับร่วมกัน) =====
function gcSwitchTab(tab) {
  ['list', 'add', 'replist', 'repadd'].forEach(t => {
    document.getElementById(`gc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`gc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') gcRenderList();
  if (tab === 'add' && !gcEditingId) gcClearForm();
  if (tab === 'replist') grRenderList();
  if (tab === 'repadd' && !grEditingId) grClearForm();
}

function gcOnPageShown() { gcRenderList(); grRenderList(); }

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
  if (prefix === 'gc') { gcLookupVehicle(); gcAutoFillInstallInfo(); } else { grLookupVehicle(); }
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
      document.getElementById(`${prefix}-owner`).value = '';
      showToast('กรุณาเลือกทะเบียนรถจากรายการเท่านั้น', 'warning');
    } else if (val) {
      // พิมพ์ทะเบียนที่มีจริงมาครบแล้วออกจากช่องเลย (ไม่ได้กดเลือกจากลิสต์) ก็ให้เติมเจ้าของรถให้เหมือนกัน
      if (prefix === 'gc') { gcLookupVehicle(); gcAutoFillInstallInfo(); } else { grLookupVehicle(); }
    }
  }, 150);
}

// เทียบทะเบียน/ประเภทอุปกรณ์แบบไม่สนช่องว่าง/เครื่องหมายขีด/ตัวพิมพ์เล็ก-ใหญ่เลย — ตัดทุกอย่างที่ไม่ใช่
// ตัวอักษร/ตัวเลขทิ้งก่อนเทียบ เพราะข้อมูลเก่าบางรายการ (นำเข้าจาก Excel/พิมพ์ต่างเวลากัน) อาจใช้ขีดคนละแบบ
// (เช่น "-" กับ "–") หรือมีช่องว่างเกิน ทำให้จับคู่ไม่เจอถ้าเทียบแบบตรงตัวเป๊ะๆ
function gcNormalizePlate(p) { return String(p || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase(); }
function gcNormalizeDevice(d) { return String(d || '').replace(/[^\p{L}\p{N}]/gu, '').toUpperCase(); }

// ถ้าทะเบียน+ประเภทอุปกรณ์ที่เลือก มีรายการติดตั้งอยู่แล้ว (ยังไม่ถอด) ให้ดึง "วันที่ติดตั้ง" (พร้อมบริษัท/
// เลข S-N/เบอร์ SIM เพื่อความสะดวก) มาแสดงอัตโนมัติ โดยล็อกช่องวันที่ติดตั้งไว้ไม่ให้แก้ — ผู้ใช้กรอกแค่
// "วันที่ถอด" แล้วกดบันทึก ระบบจะสร้างเป็น "แถวสถิติใหม่" เสมอ (ไม่ใช่การแก้ไขรายการติดตั้งเดิม)
// ถ้าทะเบียน+อุปกรณ์นั้นไม่เคยมีรายการติดตั้งมาก่อน จะปลดล็อกให้กรอกวันที่ติดตั้งเองตามปกติ (กรณีติดตั้งใหม่จริงๆ)
function gcApplyInstallRecord(existing) {
  const installDateInput = document.getElementById('gc-install-date');
  const hint = document.getElementById('gc-install-auto-hint');
  document.getElementById('gc-device').value = existing.device === 'CCTV' ? 'CCTV' : 'GPS';
  gcToggleDeviceFields();
  document.getElementById('gc-company').value = existing.company || '';
  installDateInput.value = existing.installDate || '';
  installDateInput.readOnly = true;
  document.getElementById('gc-serial').value = existing.serialNumber || '';
  document.getElementById('gc-sim').value = existing.simNumber || '';
  if (existing.device === 'CCTV') document.getElementById('gc-cctv-type').value = existing.cctvType || 'CCTV';
  if (hint) hint.style.display = '';
  const box = document.getElementById('gc-install-candidates');
  if (box) box.style.display = 'none';
}

function gcApplyInstallCandidate(id) {
  const existing = gcRecords.find(r => r.id === id);
  if (existing) gcApplyInstallRecord(existing);
}

function gcRenderInstallCandidates(list) {
  const box = document.getElementById('gc-install-candidates');
  if (!box) return;
  if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
  box.style.display = '';
  box.innerHTML = `
    <div class="gc-candidates-box">
      <div class="gc-candidates-title">⚠️ ไม่พบรายการติดตั้งที่ตรงกับ "${escapeHtml(document.getElementById('gc-device').value)}" เป๊ะๆ
        แต่พบรายการใกล้เคียงของทะเบียนนี้ — กดเลือกถ้าใช่</div>
      ${list.map(r => `
        <div class="gc-candidate-item" onclick="gcApplyInstallCandidate('${r.id}')">
          <span><span class="gc-cand-plate">${escapeHtml(r.plate)}</span> — ${escapeHtml(r.device || '-')}
            ติดตั้ง ${r.installDate ? formatDate(r.installDate) : '-'} ${r.removeDate ? '(ถอดแล้ว ' + formatDate(r.removeDate) + ')' : '(ยังไม่ถอด)'}</span>
          <span class="action-btn action-view">ใช้รายการนี้</span>
        </div>
      `).join('')}
    </div>
  `;
}

// ถ้าทะเบียน+ประเภทอุปกรณ์ที่เลือก มีรายการติดตั้งอยู่แล้ว (ยังไม่ถอด) ให้ดึง "วันที่ติดตั้ง" (พร้อมบริษัท/
// เลข S-N/เบอร์ SIM เพื่อความสะดวก) มาแสดงอัตโนมัติ โดยล็อกช่องวันที่ติดตั้งไว้ไม่ให้แก้ — ผู้ใช้กรอกแค่
// "วันที่ถอด" แล้วกดบันทึก ระบบจะสร้างเป็น "แถวสถิติใหม่" เสมอ (ไม่ใช่การแก้ไขรายการติดตั้งเดิม)
// ถ้าทะเบียน+อุปกรณ์นั้นไม่เคยมีรายการติดตั้งมาก่อน จะปลดล็อกให้กรอกวันที่ติดตั้งเองตามปกติ (กรณีติดตั้งใหม่จริงๆ)
// ถ้าจับคู่แบบเป๊ะๆ ไม่เจอ (เช่น ข้อมูลเดิมพิมพ์ทะเบียน/ประเภทอุปกรณ์ไม่ตรงเป๊ะ) จะค้นหาแบบใกล้เคียง (เทียบแค่
// บางส่วนของทะเบียน) มาให้เลือกเองแทน กันกรณีจับคู่อัตโนมัติพลาดแบบเงียบๆ
function gcAutoFillInstallInfo() {
  const plate = document.getElementById('gc-plate').value.trim();
  const device = document.getElementById('gc-device').value;
  const installDateInput = document.getElementById('gc-install-date');
  const hint = document.getElementById('gc-install-auto-hint');
  const candidatesBox = document.getElementById('gc-install-candidates');
  if (!plate) {
    installDateInput.readOnly = false;
    if (hint) hint.style.display = 'none';
    if (candidatesBox) candidatesBox.style.display = 'none';
    return;
  }

  const normPlate = gcNormalizePlate(plate);
  const existing = gcRecords.find(r =>
    gcNormalizePlate(r.plate) === normPlate &&
    gcNormalizeDevice(r.device) === gcNormalizeDevice(device) &&
    !String(r.removeDate || '').trim()
  );
  if (existing) {
    gcApplyInstallRecord(existing);
    return;
  }

  installDateInput.readOnly = false;
  if (hint) hint.style.display = 'none';

  // ไม่เจอที่ตรงเป๊ะ — ลองหาแบบใกล้เคียง (ทะเบียนมีส่วนที่ตรงกัน ไม่ว่าจะอุปกรณ์ไหน/ถอดไปแล้วหรือยัง)
  // เผื่อข้อมูลเดิมพิมพ์ทะเบียนหรือประเภทอุปกรณ์ไม่ตรงเป๊ะ จะได้ไม่พลาดแบบไม่รู้ตัว
  const near = normPlate.length >= 4
    ? gcRecords.filter(r => {
        const rp = gcNormalizePlate(r.plate);
        return rp && (rp.includes(normPlate) || normPlate.includes(rp));
      }).slice(0, 5)
    : [];
  gcRenderInstallCandidates(near);
}

function gcLookupVehicle() {
  const plate = document.getElementById('gc-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('gc-owner').value = veh?.owner || '';
}
function grLookupVehicle() {
  const plate = document.getElementById('gr-plate').value.trim();
  const veh = mdVehicles.find(v => v.plate === plate);
  document.getElementById('gr-owner').value = veh?.owner || '';
}

// ===== ติดตั้ง/ถอด: Running number / สถานะ =====
function gcNextRunningNo() { return gcRecords.length ? Math.max(...gcRecords.map(r => r.runningNo || 0)) + 1 : 1; }
function gcStatusOf(rec) { return rec.removeDate ? 'removed' : 'active'; }

// ช่อง "ประเภท CCTV (CCTV/AI)" มีความหมายเฉพาะตอนอุปกรณ์เป็น CCTV เท่านั้น
function gcToggleDeviceFields() {
  const isCctv = document.getElementById('gc-device').value === 'CCTV';
  document.getElementById('gc-cctv-type-wrap').style.display = isCctv ? '' : 'none';
}
function gcStatusBadge(rec) {
  return gcStatusOf(rec) === 'removed'
    ? `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">ถอดแล้ว</span>`
    : `<span class="badge badge-green">ติดตั้งอยู่</span>`;
}

function gcSaveCase() {
  const plate = document.getElementById('gc-plate').value.trim();
  const owner = document.getElementById('gc-owner').value.trim();
  const device = document.getElementById('gc-device').value;
  const company = document.getElementById('gc-company').value.trim();
  const installDate = document.getElementById('gc-install-date').value;
  const removeDate = document.getElementById('gc-remove-date').value;
  const cctvType = device === 'CCTV' ? document.getElementById('gc-cctv-type').value : '';
  const serialNumber = document.getElementById('gc-serial').value.trim();
  const simNumber = document.getElementById('gc-sim').value.trim();
  const note = document.getElementById('gc-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  // ไม่บังคับว่าต้องกรอกวันที่ติดตั้งเสมอไป — บันทึกแค่วันที่ติดตั้ง หรือแค่วันที่ถอด อย่างใดอย่างหนึ่งก็ได้
  if (!installDate && !removeDate) { showToast('กรุณาระบุวันที่ติดตั้งหรือวันที่ถอดอย่างน้อยหนึ่งอย่าง', 'warning'); return; }

  const record = { plate, owner, device, company, installDate, removeDate, cctvType, serialNumber, simNumber, note };

  if (gcEditingId) {
    const idx = gcRecords.findIndex(r => r.id === gcEditingId);
    if (idx >= 0) {
      gcRecords[idx] = { ...gcRecords[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    gcCancelEdit();
  } else {
    record.id = 'GC_' + Date.now();
    record.runningNo = gcNextRunningNo();
    record.createdAt = new Date().toISOString();
    gcRecords.unshift(record);
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
  gcPushIfReady();
  gcRenderList();
  if (typeof renderVehiclesTable === 'function') renderVehiclesTable();
}

function gcClearForm() {
  gcEditingId = null;
  document.getElementById('gc-edit-banner').style.display = 'none';
  document.getElementById('gc-plate').value = '';
  document.getElementById('gc-owner').value = '';
  document.getElementById('gc-device').value = 'GPS';
  document.getElementById('gc-company').value = '';
  document.getElementById('gc-install-date').value = '';
  document.getElementById('gc-install-date').readOnly = false;
  const acHint = document.getElementById('gc-install-auto-hint');
  if (acHint) acHint.style.display = 'none';
  const acBox = document.getElementById('gc-install-candidates');
  if (acBox) acBox.style.display = 'none';
  document.getElementById('gc-remove-date').value = '';
  document.getElementById('gc-cctv-type').value = 'CCTV';
  document.getElementById('gc-serial').value = '';
  document.getElementById('gc-sim').value = '';
  document.getElementById('gc-note').value = '';
  gcToggleDeviceFields();
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
  document.getElementById('gc-install-date').readOnly = false;
  const acHint = document.getElementById('gc-install-auto-hint');
  if (acHint) acHint.style.display = 'none';
  const acBox = document.getElementById('gc-install-candidates');
  if (acBox) acBox.style.display = 'none';
  document.getElementById('gc-remove-date').value = rec.removeDate || '';
  document.getElementById('gc-cctv-type').value = rec.cctvType || 'CCTV';
  document.getElementById('gc-serial').value = rec.serialNumber || '';
  document.getElementById('gc-sim').value = rec.simNumber || '';
  document.getElementById('gc-note').value = rec.note || '';
  gcToggleDeviceFields();
  gcSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function gcCancelEdit() { gcClearForm(); }

function gcDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  gcRecords = gcRecords.filter(r => r.id !== id);
  gcSave();
  gcPushIfReady();
  gcRenderList();
  if (typeof renderVehiclesTable === 'function') renderVehiclesTable();
  showToast('ลบแล้ว', 'warning');
}

function gcDeleteAllCases() {
  if (typeof mdIsAdmin === 'function' && !mdIsAdmin()) { showToast('เฉพาะแอดมินเท่านั้นที่ลบทั้งหมดได้', 'error'); return; }
  if (!confirmDeleteWithPin(`ลบรายการติดตั้ง/ถอดทั้งหมด ${gcRecords.length} รายการ?\nการกระทำนี้ไม่สามารถย้อนกลับได้`)) return;
  gcRecords = [];
  gcSave();
  gcPushIfReady();
  gcRenderList();
  if (typeof renderVehiclesTable === 'function') renderVehiclesTable();
  showToast('ลบรายการติดตั้ง/ถอดทั้งหมดแล้ว', 'warning');
}

function gcFilteredList() {
  const plate = (document.getElementById('gc-f-plate')?.value || '').trim().toLowerCase();
  const device = document.getElementById('gc-f-device')?.value || '';
  const status = document.getElementById('gc-f-status')?.value || '';
  return gcRecords.filter(r => {
    if (plate && !r.plate.toLowerCase().includes(plate)) return false;
    if (device && r.device !== device) return false;
    if (status && gcStatusOf(r) !== status) return false;
    return true;
  });
}

function gcClearListFilters() {
  document.getElementById('gc-f-plate').value = '';
  document.getElementById('gc-f-device').value = '';
  document.getElementById('gc-f-status').value = '';
  gcRenderList();
}

function gcRenderList() {
  const list = gcFilteredList();
  const tbody = document.getElementById('gc-list-body');
  const countEl = document.getElementById('gc-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
      <td>${escapeHtml(r.device || '-')}</td>
      <td>${escapeHtml(r.device === 'CCTV' ? (r.cctvType || 'CCTV') : '-')}</td>
      <td>${escapeHtml(r.company || '-')}</td>
      <td>${formatDate(r.installDate)}</td>
      <td>${r.removeDate ? formatDate(r.removeDate) : '-'}</td>
      <td>${escapeHtml(r.serialNumber || '-')}</td>
      <td>${escapeHtml(r.simNumber || '-')}</td>
      <td>${gcStatusBadge(r)}</td>
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
function grStatusOf(rec) { return rec.repairDate ? 'done' : 'pending'; }
function grStatusBadge(rec) {
  return grStatusOf(rec) === 'done'
    ? `<span class="badge badge-green">ซ่อมเสร็จแล้ว</span>`
    : `<span class="badge badge-orange">รอซ่อม</span>`;
}

function grSaveCase() {
  const plate = document.getElementById('gr-plate').value.trim();
  const owner = document.getElementById('gr-owner').value.trim();
  const device = document.getElementById('gr-device').value;
  const symptom = document.getElementById('gr-symptom').value.trim();
  const appointmentDate = document.getElementById('gr-appointment-date').value;
  const repairDate = document.getElementById('gr-repair-date').value;
  const note = document.getElementById('gr-note').value.trim();

  if (!plate) { showToast('กรุณาระบุทะเบียนรถ', 'warning'); return; }
  if (!symptom) { showToast('กรุณาระบุอาการ', 'warning'); return; }

  const record = { plate, owner, device, symptom, appointmentDate, repairDate, note };

  if (grEditingId) {
    const idx = grRecords.findIndex(r => r.id === grEditingId);
    if (idx >= 0) {
      grRecords[idx] = { ...grRecords[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    grCancelEdit();
  } else {
    record.id = 'GR_' + Date.now();
    record.runningNo = grNextRunningNo();
    record.createdAt = new Date().toISOString();
    grRecords.unshift(record);
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🔧 <b>แจ้งซ่อม${device}ใหม่</b>\nทะเบียน: ${escapeHtml(plate)}\nอาการ: ${escapeHtml(symptom)}${appointmentDate ? `\nวันที่นัดซ่อม: ${formatDate(appointmentDate)}` : ''}`
      );
    }
    grClearForm();
  }
  grSave();
  grPushIfReady();
  grRenderList();
}

function grClearForm() {
  grEditingId = null;
  document.getElementById('gr-edit-banner').style.display = 'none';
  document.getElementById('gr-plate').value = '';
  document.getElementById('gr-owner').value = '';
  document.getElementById('gr-device').value = 'GPS';
  document.getElementById('gr-symptom').value = '';
  document.getElementById('gr-appointment-date').value = '';
  document.getElementById('gr-repair-date').value = '';
  document.getElementById('gr-note').value = '';
}

function grEditCase(id) {
  const rec = grRecords.find(r => r.id === id);
  if (!rec) return;
  grEditingId = id;
  document.getElementById('gr-edit-banner').style.display = 'flex';
  document.getElementById('gr-edit-no').textContent = rec.runningNo;
  document.getElementById('gr-plate').value = rec.plate || '';
  document.getElementById('gr-owner').value = rec.owner || '';
  document.getElementById('gr-device').value = rec.device || 'GPS';
  document.getElementById('gr-symptom').value = rec.symptom || '';
  document.getElementById('gr-appointment-date').value = rec.appointmentDate || '';
  document.getElementById('gr-repair-date').value = rec.repairDate || '';
  document.getElementById('gr-note').value = rec.note || '';
  gcSwitchTab('repadd');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function grCancelEdit() { grClearForm(); }

function grDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  grRecords = grRecords.filter(r => r.id !== id);
  grSave();
  grPushIfReady();
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
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(r => `
    <tr>
      <td>${r.runningNo}</td>
      <td style="font-family:monospace">${escapeHtml(r.plate)}</td>
      <td>${escapeHtml(r.owner || '-')}</td>
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
    ['ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์ (GPS/CCTV)', 'ประเภทย่อย CCTV (CCTV/AI)', 'บริษัท', 'วันที่ติดตั้ง (YYYY-MM-DD)', 'วันที่ถอด (YYYY-MM-DD)', 'เลข S/N', 'เบอร์ SIM', 'หมายเหตุ'],
    ['70-1234', 'นายสมชาย ใจดี', 'GPS', '', 'บริษัท ตัวอย่าง จำกัด', '2026-01-15', '', 'SN-12345', '081-234-5678', ''],
    ['70-1234', 'นายสมชาย ใจดี', 'CCTV', 'AI', 'บริษัท ตัวอย่าง จำกัด', '2026-01-15', '', 'SN-67890', '081-999-9999', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'ติดตั้ง-ถอด');
  XLSX.writeFile(wb, 'template_GPS_CCTV_ติดตั้ง.xlsx');
}

function gcExportExcel() {
  const list = gcFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์', 'ประเภทย่อย CCTV', 'บริษัท', 'วันที่ติดตั้ง', 'วันที่ถอด', 'เลข S/N', 'เบอร์ SIM', 'สถานะ', 'หมายเหตุ'],
    ...list.map(r => [r.runningNo, r.plate, r.owner || '', r.device || '', r.device === 'CCTV' ? (r.cctvType || 'CCTV') : '', r.company || '', r.installDate || '', r.removeDate || '', r.serialNumber || '', r.simNumber || '', gcStatusOf(r) === 'removed' ? 'ถอดแล้ว' : 'ติดตั้งอยู่', r.note || '']),
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
      const cctvType = device === 'CCTV' && String(row[3] || '').trim().toUpperCase() === 'AI' ? 'AI' : (device === 'CCTV' ? 'CCTV' : '');
      const installDate = normalizeImportDate(row[5]);
      const veh = mdVehicles.find(v => v.plate === plate);
      const record = {
        plate, owner: String(row[1] || '').trim() || veh?.owner || '', device, cctvType,
        company: String(row[4] || '').trim(), installDate, removeDate: normalizeImportDate(row[6]),
        serialNumber: String(row[7] || '').trim(), simNumber: String(row[8] || '').trim(),
        note: String(row[9] || '').trim(),
      };
      const idx = gcRecords.findIndex(r => r.plate === plate && r.device === device && r.installDate === installDate);
      if (idx >= 0) { gcRecords[idx] = { ...gcRecords[idx], ...record, updatedAt: new Date().toISOString() }; updated++; }
      else { gcRecords.unshift({ id: 'GC_' + Date.now() + '_' + i, runningNo: gcNextRunningNo(), ...record, createdAt: new Date().toISOString() }); added++; }
    });
    gcSave();
    gcPushIfReady();
    gcRenderList();
    if (typeof renderVehiclesTable === 'function') renderVehiclesTable();
    showToast(`นำเข้าสำเร็จ: เพิ่มใหม่ ${added} รายการ, แก้ไข ${updated} รายการ`, 'success');
    event.target.value = '';
  });
}

// ===== Excel: แจ้งซ่อม (นำเข้าซ้ำ = แก้ไข จับคู่ด้วยทะเบียน+อุปกรณ์+วันที่นัดซ่อม) =====
function grDownloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์ (GPS/CCTV)', 'อาการ', 'วันที่นัดซ่อม (YYYY-MM-DD)', 'วันที่ช่างมาซ่อม (YYYY-MM-DD)', 'หมายเหตุ'],
    ['70-1234', 'นายสมชาย ใจดี', 'GPS', 'สัญญาณขาดหาย', '2026-02-01', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'แจ้งซ่อม');
  XLSX.writeFile(wb, 'template_GPS_CCTV_แจ้งซ่อม.xlsx');
}

function grExportExcel() {
  const list = grFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'ทะเบียนรถ', 'เจ้าของรถ', 'ประเภทอุปกรณ์', 'อาการ', 'วันที่นัดซ่อม', 'วันที่ช่างมาซ่อม', 'สถานะ', 'หมายเหตุ'],
    ...list.map(r => [r.runningNo, r.plate, r.owner || '', r.device || '', r.symptom || '', r.appointmentDate || '', r.repairDate || '', grStatusOf(r) === 'done' ? 'ซ่อมเสร็จแล้ว' : 'รอซ่อม', r.note || '']),
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
      const veh = mdVehicles.find(v => v.plate === plate);
      const record = {
        plate, owner: String(row[1] || '').trim() || veh?.owner || '', device,
        symptom: String(row[3] || '').trim(), appointmentDate, repairDate: normalizeImportDate(row[5]),
        note: String(row[6] || '').trim(),
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

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function gcRecordsToObj(arr) { const o = {}; (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; }); return o; }
function gcObjToRecords(obj) { if (!obj) return []; if (Array.isArray(obj)) return obj.filter(Boolean); return Object.values(obj).filter(r => r && r.id); }
function gcApplyServer(serverRecords) { gcRecords = serverRecords; gcSave(); gcRenderList(); if (typeof renderVehiclesTable === 'function') renderVehiclesTable(); }
async function gcWriteFB() {
  if (!gcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(gcRef, gcRecordsToObj(gcRecords));
  } catch (e) { console.warn('gcWriteFB error', e); }
}
function gcPushIfReady() { if (gcReady) gcWriteFB(); }

function grApplyServer(serverRecords) { grRecords = serverRecords; grSave(); grRenderList(); }
async function grWriteFB() {
  if (!grRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(grRef, gcRecordsToObj(grRecords));
  } catch (e) { console.warn('grWriteFB error', e); }
}
function grPushIfReady() { if (grReady) grWriteFB(); }

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
  }
}

document.addEventListener('DOMContentLoaded', () => {
  gcClearForm();
  grClearForm();
  gcRenderList();
  grRenderList();
  gcInit();
});

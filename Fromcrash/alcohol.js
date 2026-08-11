// ===== ระบบบันทึกการเป่าวัดแอลกอฮอล์ (เฉพาะพนักงานลาน ABC) =====
// เก็บ local ที่ localStorage key 'finflow_alcohol_tests' และ sync กับ Firebase ที่ /alcoholTests
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// รายชื่อพนักงานใช้ list แยกต่างหาก (mdAbcStaff ใน masterdata.js) ไม่ใช่พนักงานขับรถหลัก
// เพราะเมนูนี้บันทึกเฉพาะพนักงานลาน ABC ลานเดียว ต่างจากเมนูอื่นที่บันทึกทุกลานจอด
//
// รูปแบบบันทึก: เลือกวันที่แล้วขึ้นรายชื่อพนักงานทุกคนให้เลือกผลตรวจทีละคน (แบบ roster)
// เวลาลงอัตโนมัติตามเวลาจริงตอนกดบันทึก ไม่ต้องเลือกเอง, ค่าที่วัดได้ fix ไว้ที่ 0 มก.

const ALC_FIXED_LEVEL = 0;
const ALC_DEFAULT_NOTE = '0 มก.';

let alcTests = JSON.parse(localStorage.getItem('finflow_alcohol_tests') || '[]');
let alcRef = null;
let alcReady = false;

function alcSave() { localStorage.setItem('finflow_alcohol_tests', JSON.stringify(alcTests)); }

// ===== Sub-tabs =====
function alcSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`alc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`alc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') alcRenderList();
  if (tab === 'add') {
    const dateEl = document.getElementById('alc-roster-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().substring(0, 10);
    alcRenderRoster();
  }
}

function alcOnPageShown() {
  alcRefreshLookupDropdowns();
  alcRenderList();
}

// ===== Filter dropdown (พนักงานลาน ABC จาก masterdata.js) =====
function alcFillSelect(id, names) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (names || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (names && names.includes(current)) el.value = current;
}
function alcRefreshLookupDropdowns() {
  alcFillSelect('alc-f-employee', mdAbcStaff.map(s => s.name));
  alcRenderRoster();
}

function alcQuickAddEmployee() {
  const name = (prompt('เพิ่มชื่อพนักงานลาน ABC ใหม่:') || '').trim();
  if (!name) return;
  if (typeof addAbcStaffDB !== 'function') return;
  const nameInput = document.getElementById('md-abcstaff-name');
  if (nameInput) {
    nameInput.value = name;
    const buInput = document.getElementById('md-abcstaff-bu');
    if (buInput) buInput.value = '';
    addAbcStaffDB();
  } else {
    if (!mdAbcStaff.some(s => s.name === name)) {
      mdAbcStaff.push({ id: Date.now(), name, businessUnit: '' });
      saveAbcStaffDB();
      alcRenderRoster();
      if (typeof mdPushIfReady === 'function') mdPushIfReady();
    }
  }
}

// ===== Running number =====
function alcNextRunningNo() {
  return alcTests.length ? Math.max(...alcTests.map(t => t.runningNo || 0)) + 1 : 1;
}

// ===== Roster (บันทึกผลตรวจรายวัน ทีละคนสำหรับวันที่เลือก) =====
function alcRenderRoster() {
  const tbody = document.getElementById('alc-roster-body');
  if (!tbody) return;
  const date = document.getElementById('alc-roster-date')?.value || '';
  if (!mdAbcStaff || mdAbcStaff.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีรายชื่อพนักงานลาน ABC — เพิ่มได้ที่ปุ่ม "+ เพิ่มพนักงานใหม่" ด้านบน</td></tr>';
    return;
  }
  tbody.innerHTML = mdAbcStaff.map((emp, i) => {
    const name = emp.name;
    const existing = date ? alcTests.find(t => t.date === date && t.employee === name) : null;
    const result = existing?.result || 'ผ่าน';
    const note = existing?.note ?? ALC_DEFAULT_NOTE;
    return `
      <tr data-name="${escapeHtml(name)}">
        <td>${i + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(emp.businessUnit || '-')}</td>
        <td>
          <select class="alc-roster-result">
            <option value="ผ่าน" ${result === 'ผ่าน' ? 'selected' : ''}>ผ่าน</option>
            <option value="ไม่ผ่าน" ${result === 'ไม่ผ่าน' ? 'selected' : ''}>ไม่ผ่าน</option>
          </select>
        </td>
        <td style="text-align:center;color:var(--text-muted);">${ALC_FIXED_LEVEL}</td>
        <td><input type="text" class="alc-roster-note" value="${escapeHtml(note)}" /></td>
      </tr>
    `;
  }).join('');
  alcFilterRosterRows();
}

// กรองแถวที่แสดง (ไม่รื้อ tbody ใหม่) เพื่อไม่ให้ผลตรวจ/หมายเหตุที่พิมพ์ค้างไว้ของคนอื่นหายไปตอนพิมพ์ค้นหา
function alcFilterRosterRows() {
  const term = (document.getElementById('alc-roster-search')?.value || '').trim().toLowerCase();
  document.querySelectorAll('#alc-roster-body tr[data-name]').forEach(row => {
    const match = !term || row.dataset.name.toLowerCase().includes(term);
    row.style.display = match ? '' : 'none';
  });
}

function alcSaveRoster() {
  const date = document.getElementById('alc-roster-date').value;
  if (!date) { showToast('กรุณาระบุวันที่ตรวจ', 'warning'); return; }
  const rows = document.querySelectorAll('#alc-roster-body tr[data-name]');
  if (rows.length === 0) { showToast('ยังไม่มีรายชื่อพนักงานลาน ABC ให้บันทึก', 'warning'); return; }

  const now = new Date();
  const timeStr = now.toTimeString().substring(0, 5); // เวลาจริงตอนกดบันทึก
  let failCount = 0;

  rows.forEach(row => {
    const name = row.dataset.name;
    const businessUnit = mdAbcStaff.find(s => s.name === name)?.businessUnit || '';
    const result = row.querySelector('.alc-roster-result').value;
    const note = row.querySelector('.alc-roster-note').value.trim();
    if (result === 'ไม่ผ่าน') failCount++;

    const idx = alcTests.findIndex(t => t.date === date && t.employee === name);
    if (idx >= 0) {
      alcTests[idx] = { ...alcTests[idx], time: timeStr, level: ALC_FIXED_LEVEL, result, note, businessUnit, updatedAt: now.toISOString() };
    } else {
      alcTests.unshift({
        id: 'ALC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        runningNo: alcNextRunningNo(),
        date, time: timeStr,
        employee: name,
        businessUnit,
        level: ALC_FIXED_LEVEL,
        result, note,
        createdAt: now.toISOString(),
      });
    }
  });

  alcSave();
  alcPushIfReady();
  alcRenderList();
  alcRenderRoster();
  showToast(`✅ บันทึกผลตรวจ ${rows.length} คนแล้ว`, 'success');
  if (typeof sendTelegramNotification === 'function') {
    sendTelegramNotification(
      `🍃 <b>บันทึกผลเป่าวัดแอลกอฮอล์ (ลาน ABC)</b>\nวันที่: ${formatDate(date)}\nจำนวนตรวจ: ${rows.length} คน${failCount > 0 ? `\n🚨 ไม่ผ่าน: ${failCount} คน` : ''}`
    );
  }
}

// ===== Edit / Delete (แก้ไข = เปิดวันที่ของรายการนั้นใน roster ให้แก้แล้วกดบันทึกใหม่) =====
function alcEditCase(id) {
  const rec = alcTests.find(t => t.id === id);
  if (!rec) return;
  document.getElementById('alc-roster-date').value = rec.date;
  alcSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  showToast(`เปิดบันทึกวันที่ ${formatDate(rec.date)} แล้ว — แก้ไขแล้วกด "บันทึกผลตรวจทั้งหมด"`, 'success');
}

function alcDeleteCase(id) {
  if (!confirm('ยืนยันการลบบันทึกนี้?')) return;
  alcTests = alcTests.filter(t => t.id !== id);
  alcSave();
  alcPushIfReady();
  alcRenderList();
  alcRenderRoster();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function alcFilteredList() {
  const employee = document.getElementById('alc-f-employee')?.value || '';
  const result = document.getElementById('alc-f-result')?.value || '';
  const dateFrom = document.getElementById('alc-f-datefrom')?.value || '';
  const dateTo = document.getElementById('alc-f-dateto')?.value || '';
  return alcTests.filter(t => {
    if (employee && t.employee !== employee) return false;
    if (result && t.result !== result) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    return true;
  });
}

function alcClearListFilters() {
  document.getElementById('alc-f-employee').value = '';
  document.getElementById('alc-f-result').value = '';
  document.getElementById('alc-f-datefrom').value = '';
  document.getElementById('alc-f-dateto').value = '';
  alcRenderList();
}

function alcResultBadge(result) {
  if (result === 'ไม่ผ่าน') return `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">${escapeHtml(result)}</span>`;
  return `<span class="badge badge-green">${escapeHtml(result)}</span>`;
}

function alcRenderList() {
  const list = alcFilteredList();
  const tbody = document.getElementById('alc-list-body');
  const countEl = document.getElementById('alc-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => `
    <tr>
      <td>${t.runningNo}</td>
      <td>${formatDate(t.date)}</td>
      <td>${escapeHtml(t.time || '-')}</td>
      <td>${escapeHtml(t.employee)}</td>
      <td>${escapeHtml(t.businessUnit || '-')}</td>
      <td>${t.level ?? ALC_FIXED_LEVEL}</td>
      <td>${alcResultBadge(t.result)}</td>
      <td>
        <button class="action-btn action-view" onclick="alcEditCase('${t.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="alcDeleteCase('${t.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function alcRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function alcObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function alcApplyServer(serverTests) {
  alcTests = serverTests;
  alcSave();
  alcRenderList();
  alcRenderRoster();
}
async function alcWriteFB() {
  if (!alcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(alcRef, alcRecordsToObj(alcTests));
  } catch (e) { console.warn('alcWriteFB error', e); }
}
function alcPushIfReady() { if (alcReady) alcWriteFB(); }

function alcWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function alcInit() {
  await alcWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    alcRef = ref(fbDb, '/alcoholTests');
    const snap = await get(alcRef);
    if (snap.exists()) alcApplyServer(alcObjToRecords(snap.val()));
    alcReady = true;
    if (!snap.exists() && alcTests.length > 0) await alcWriteFB();
    onValue(alcRef, s => { if (s.exists()) alcApplyServer(alcObjToRecords(s.val())); });
  } catch (e) {
    console.warn('alcInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  alcRefreshLookupDropdowns();
  const dateEl = document.getElementById('alc-roster-date');
  if (dateEl) dateEl.value = new Date().toISOString().substring(0, 10);
  alcRenderRoster();
  alcRenderList();
  alcInit();
});

// ===== ระบบบันทึกการเป่าวัดแอลกอฮอล์ (เฉพาะพนักงานลาน ABC) =====
// เก็บ local ที่ localStorage key 'finflow_alcohol_tests' และ sync กับ Firebase ที่ /alcoholTests
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// รายชื่อพนักงานใช้ list แยกต่างหาก (mdAbcStaff ใน masterdata.js) ไม่ใช่พนักงานขับรถหลัก
// เพราะเมนูนี้บันทึกเฉพาะพนักงานลาน ABC ลานเดียว ต่างจากเมนูอื่นที่บันทึกทุกลานจอด

let alcTests = JSON.parse(localStorage.getItem('finflow_alcohol_tests') || '[]');
let alcEditingId = null;
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
  if (tab === 'add' && !alcEditingId) alcClearForm();
}

function alcOnPageShown() {
  alcRefreshLookupDropdowns();
  alcRenderList();
}

// ===== Lookup dropdown (พนักงานลาน ABC จาก masterdata.js) =====
function alcFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}
function alcRefreshLookupDropdowns() {
  alcFillSelect('alc-employee', mdAbcStaff);
  alcFillSelect('alc-f-employee', mdAbcStaff);
}

function alcQuickAddEmployee() {
  const name = (prompt('เพิ่มชื่อพนักงานลาน ABC ใหม่:') || '').trim();
  if (!name) return;
  if (typeof addAbcStaffDB !== 'function') return;
  const input = document.getElementById('md-abcstaff-name');
  if (input) {
    input.value = name;
    addAbcStaffDB();
  } else {
    if (!mdAbcStaff.includes(name)) {
      mdAbcStaff.push(name);
      saveAbcStaffDB();
      alcRefreshLookupDropdowns();
      if (typeof mdPushIfReady === 'function') mdPushIfReady();
    }
  }
  const sel = document.getElementById('alc-employee');
  if (sel) sel.value = name;
}

// ===== Running number =====
function alcNextRunningNo() {
  return alcTests.length ? Math.max(...alcTests.map(t => t.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function alcSaveCase() {
  const date = document.getElementById('alc-date').value;
  const time = document.getElementById('alc-time').value;
  const employee = document.getElementById('alc-employee').value.trim();
  const levelRaw = document.getElementById('alc-level').value;
  const result = document.getElementById('alc-result').value;

  if (!date) { showToast('กรุณาระบุวันที่ตรวจ', 'warning'); return; }
  if (!employee) { showToast('กรุณาเลือกชื่อพนักงาน', 'warning'); return; }

  const record = {
    date, time,
    employee,
    level: levelRaw === '' ? null : parseFloat(levelRaw),
    result,
    tester: document.getElementById('alc-tester').value.trim(),
    note: document.getElementById('alc-note').value.trim(),
  };

  if (alcEditingId) {
    const idx = alcTests.findIndex(t => t.id === alcEditingId);
    if (idx >= 0) {
      alcTests[idx] = { ...alcTests[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
    }
    alcCancelEdit();
  } else {
    record.id = 'ALC_' + Date.now();
    record.runningNo = alcNextRunningNo();
    record.createdAt = new Date().toISOString();
    alcTests.unshift(record);
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      const resultIcon = record.result === 'ไม่ผ่าน' ? '🚨' : '🍃';
      sendTelegramNotification(
        `${resultIcon} <b>บันทึกการเป่าวัดแอลกอฮอล์ (ลาน ABC)</b>\nเลขที่: ${record.runningNo}\nพนักงาน: ${escapeHtml(employee)}\nค่าที่วัดได้: ${record.level ?? '-'} mg%\nผล: ${escapeHtml(record.result)}`
      );
    }
    alcClearForm();
  }
  alcSave();
  alcPushIfReady();
  alcRenderList();
}

function alcClearForm() {
  alcEditingId = null;
  document.getElementById('alc-edit-banner').style.display = 'none';
  document.getElementById('alc-date').value = '';
  document.getElementById('alc-time').value = '';
  document.getElementById('alc-employee').value = '';
  document.getElementById('alc-level').value = '';
  document.getElementById('alc-result').value = 'ผ่าน';
  document.getElementById('alc-tester').value = '';
  document.getElementById('alc-note').value = '';
}

function alcEditCase(id) {
  const rec = alcTests.find(t => t.id === id);
  if (!rec) return;
  alcEditingId = id;
  document.getElementById('alc-edit-banner').style.display = 'flex';
  document.getElementById('alc-edit-no').textContent = rec.runningNo;
  document.getElementById('alc-date').value = rec.date || '';
  document.getElementById('alc-time').value = rec.time || '';
  if (typeof setSelectValueSafe === 'function') setSelectValueSafe('alc-employee', rec.employee || '');
  else document.getElementById('alc-employee').value = rec.employee || '';
  document.getElementById('alc-level').value = rec.level ?? '';
  document.getElementById('alc-result').value = rec.result || 'ผ่าน';
  document.getElementById('alc-tester').value = rec.tester || '';
  document.getElementById('alc-note').value = rec.note || '';
  alcSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function alcCancelEdit() {
  alcClearForm();
}

function alcDeleteCase(id) {
  if (!confirm('ยืนยันการลบบันทึกนี้?')) return;
  alcTests = alcTests.filter(t => t.id !== id);
  alcSave();
  alcPushIfReady();
  alcRenderList();
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
      <td>${t.level ?? '-'}</td>
      <td>${alcResultBadge(t.result)}</td>
      <td>${escapeHtml(t.tester || '-')}</td>
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
  alcClearForm();
  alcRenderList();
  alcInit();
});

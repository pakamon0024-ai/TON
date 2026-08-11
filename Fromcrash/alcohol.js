// ===== ระบบบันทึกการเป่าวัดแอลกอฮอล์ (เฉพาะพนักงานลาน ABC) =====
// เก็บ local ที่ localStorage key 'finflow_alcohol_tests' และ sync กับ Firebase ที่ /alcoholTests
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// รายชื่อพนักงานใช้ list แยกต่างหาก (mdAbcStaff ใน masterdata.js) ไม่ใช่พนักงานขับรถหลัก
// เพราะเมนูนี้บันทึกเฉพาะพนักงานลาน ABC ลานเดียว ต่างจากเมนูอื่นที่บันทึกทุกลานจอด
//
// รูปแบบบันทึก: เลือกวันที่แล้วขึ้นรายชื่อพนักงานทุกคนให้เลือกผลตรวจทีละคน (แบบ roster)
// เวลาลงอัตโนมัติตามเวลาจริงตอนกดบันทึก ไม่ต้องเลือกเอง, ค่าที่วัดได้ตั้งต้นที่ 0 มก. แต่แก้ไขได้ทีละคน

const ALC_FIXED_LEVEL = 0; // ค่าตั้งต้นของช่อง "ค่าที่วัดได้" (แก้ไขได้ต่อคน ไม่ใช่ค่าคงที่ตายตัวอีกต่อไป)
// ลำดับแรก (ยังไม่เป่า) ถูก fix ไว้เป็นค่าเริ่มต้นของทั้ง 2 รอบ (ขา / ขากลับ)
const ALC_RESULT_OPTIONS = ['ยังไม่เป่า', 'ผ่าน', 'ไม่ผ่าน', 'ขาด/ลา', 'ต่อเนื่อง'];
const ALC_DOW_SHORT_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

let alcTests = JSON.parse(localStorage.getItem('finflow_alcohol_tests') || '[]');
let alcRef = null;
let alcReady = false;

function alcSave() { localStorage.setItem('finflow_alcohol_tests', JSON.stringify(alcTests)); }

// ===== Sub-tabs =====
function alcSwitchTab(tab) {
  ['list', 'add', 'summary'].forEach(t => {
    document.getElementById(`alc-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`alc-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') alcRenderList();
  if (tab === 'add') {
    const dateEl = document.getElementById('alc-roster-date');
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().substring(0, 10);
    alcRenderRoster();
  }
  if (tab === 'summary') {
    const monthEl = document.getElementById('alc-summary-month');
    if (monthEl && !monthEl.value) monthEl.value = new Date().toISOString().substring(0, 7);
    alcRenderSummary();
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
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">ยังไม่มีรายชื่อพนักงานลาน ABC — เพิ่มได้ที่ปุ่ม "+ เพิ่มพนักงานใหม่" ด้านบน</td></tr>';
    return;
  }
  tbody.innerHTML = mdAbcStaff.map((emp, i) => {
    const name = emp.name;
    const existing = date ? alcTests.find(t => t.date === date && t.employee === name) : null;
    // ค่าเริ่มต้นต้องเป็น "ยังไม่เป่า" เสมอสำหรับคนที่ยังไม่มีบันทึกในวันนี้ — ไม่สืบทอดค่า
    // ผลตรวจแบบเก่า (ฟิลด์ result ก่อนแยก 2 รอบ) มาเป็นค่าเริ่มต้นของ "ขา" เพราะนั่นไม่ใช่ผลที่
    // ถูกกดเลือกจริงสำหรับวันนี้
    const resultOut = existing?.resultOut || ALC_RESULT_OPTIONS[0];
    const resultReturn = existing?.resultReturn || ALC_RESULT_OPTIONS[0];
    const level = existing?.level ?? ALC_FIXED_LEVEL;
    // "0 มก." เป็นค่าเริ่มต้นเก่าของหมายเหตุที่ระบบเคยใส่ให้อัตโนมัติ (ไม่ใช่สิ่งที่คนพิมพ์เอง)
    // ถือว่าว่างเปล่าเสมอ เพื่อไม่ให้ข้อความหลอกๆ นี้ค้างอยู่ในฟอร์ม
    const note = (existing?.note && existing.note !== '0 มก.') ? existing.note : '';
    const optsHtml = (selected) => ALC_RESULT_OPTIONS.map(o =>
      `<option value="${escapeHtml(o)}" ${o === selected ? 'selected' : ''}>${escapeHtml(o)}</option>`
    ).join('');
    return `
      <tr data-name="${escapeHtml(name)}">
        <td>${i + 1}</td>
        <td>${escapeHtml(name)}</td>
        <td>${escapeHtml(emp.businessUnit || '-')}</td>
        <td><select class="alc-roster-result-out">${optsHtml(resultOut)}</select></td>
        <td><select class="alc-roster-result-return">${optsHtml(resultReturn)}</select></td>
        <td><input type="number" step="0.01" min="0" class="alc-roster-level" value="${level}" /></td>
        <td><input type="text" class="alc-roster-note" value="${escapeHtml(note)}" placeholder="หมายเหตุ..." /></td>
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
    const resultOut = row.querySelector('.alc-roster-result-out').value;
    const resultReturn = row.querySelector('.alc-roster-result-return').value;
    const levelRaw = parseFloat(row.querySelector('.alc-roster-level').value);
    const level = isNaN(levelRaw) ? ALC_FIXED_LEVEL : levelRaw;
    const note = row.querySelector('.alc-roster-note').value.trim();
    if (resultOut === 'ไม่ผ่าน' || resultReturn === 'ไม่ผ่าน') failCount++;

    const idx = alcTests.findIndex(t => t.date === date && t.employee === name);
    if (idx >= 0) {
      alcTests[idx] = { ...alcTests[idx], time: timeStr, level, resultOut, resultReturn, note, businessUnit, updatedAt: now.toISOString() };
      delete alcTests[idx].result; // เลิกใช้ฟิลด์เดี่ยวเดิม แยกเป็น 2 รอบแล้ว
    } else {
      alcTests.unshift({
        id: 'ALC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        runningNo: alcNextRunningNo(),
        date, time: timeStr,
        employee: name,
        businessUnit,
        level,
        resultOut, resultReturn, note,
        createdAt: now.toISOString(),
      });
    }
  });

  alcSave();
  alcPushIfReady();
  alcRenderList();
  alcRenderRoster();
  alcRenderSummary();
  showToast(`✅ บันทึกผลตรวจ ${rows.length} คนแล้ว`, 'success');
  if (typeof sendTelegramNotification === 'function') {
    sendTelegramNotification(
      `🍃 <b>บันทึกผลเป่าวัดแอลกอฮอล์ (ลาน ABC)</b>\nวันที่: ${formatDate(date)}\nจำนวนตรวจ: ${rows.length} คน (ขา + ขากลับ)${failCount > 0 ? `\n🚨 ไม่ผ่าน: ${failCount} คน` : ''}`
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
  alcRenderSummary();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function alcFilteredList() {
  const employee = document.getElementById('alc-f-employee')?.value || '';
  const resultOut = document.getElementById('alc-f-result-out')?.value || '';
  const resultReturn = document.getElementById('alc-f-result-return')?.value || '';
  const dateFrom = document.getElementById('alc-f-datefrom')?.value || '';
  const dateTo = document.getElementById('alc-f-dateto')?.value || '';
  return alcTests.filter(t => {
    if (employee && t.employee !== employee) return false;
    if (resultOut && (t.resultOut || t.result || ALC_RESULT_OPTIONS[0]) !== resultOut) return false;
    if (resultReturn && (t.resultReturn || ALC_RESULT_OPTIONS[0]) !== resultReturn) return false;
    if (dateFrom && t.date < dateFrom) return false;
    if (dateTo && t.date > dateTo) return false;
    return true;
  });
}

function alcClearListFilters() {
  document.getElementById('alc-f-employee').value = '';
  document.getElementById('alc-f-result-out').value = '';
  document.getElementById('alc-f-result-return').value = '';
  document.getElementById('alc-f-datefrom').value = '';
  document.getElementById('alc-f-dateto').value = '';
  alcRenderList();
}

function alcResultBadge(result) {
  const map = {
    'ผ่าน': 'badge-green',
    'ไม่ผ่าน': null, // สีแดง ใช้ inline style ด้านล่าง (ไม่มี badge-red สำเร็จรูปในระบบ)
    'ขาด/ลา': 'badge-orange',
    'ต่อเนื่อง': 'badge-blue',
    'ยังไม่เป่า': null,
  };
  if (result === 'ไม่ผ่าน') return `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">${escapeHtml(result)}</span>`;
  if (result === 'ยังไม่เป่า' || !result) return `<span class="badge" style="background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border)">${escapeHtml(result || ALC_RESULT_OPTIONS[0])}</span>`;
  return `<span class="badge ${map[result] || 'badge-green'}">${escapeHtml(result)}</span>`;
}

function alcRenderList() {
  const list = alcFilteredList();
  const tbody = document.getElementById('alc-list-body');
  const countEl = document.getElementById('alc-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => `
    <tr>
      <td>${t.runningNo}</td>
      <td>${formatDate(t.date)}</td>
      <td>${escapeHtml(t.time || '-')}</td>
      <td>${escapeHtml(t.employee)}</td>
      <td>${escapeHtml(t.businessUnit || '-')}</td>
      <td>${alcResultBadge(t.resultOut || t.result)}</td>
      <td>${alcResultBadge(t.resultReturn)}</td>
      <td>${t.level ?? ALC_FIXED_LEVEL}</td>
      <td>
        <button class="action-btn action-view" onclick="alcEditCase('${t.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="alcDeleteCase('${t.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

function alcExportListExcel() {
  const list = alcFilteredList();
  if (list.length === 0) { showToast('ไม่มีข้อมูลให้ export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'วันที่', 'เวลา', 'พนักงาน', 'หน่วยงาน', 'ผลตรวจ (ขาไป)', 'ผลตรวจ (ขากลับ)', 'ค่าที่วัดได้ (มก.)', 'หมายเหตุ'],
    ...list.map(t => [
      t.runningNo, t.date, t.time || '', t.employee, t.businessUnit || '',
      t.resultOut || t.result || '', t.resultReturn || '', t.level ?? ALC_FIXED_LEVEL, t.note || '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'เป่าวัดแอลกอฮอล์');
  XLSX.writeFile(wb, `บันทึกเป่าแอลกอฮอล์_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

// ===== ตารางสรุปผลเป่าแอลกอฮอล์รายวัน แยกตามเดือน (No./ชื่อ/หน่วยงาน x วันที่ 1-31) =====
function alcSummaryMonthValue() {
  return document.getElementById('alc-summary-month')?.value || new Date().toISOString().substring(0, 7);
}

// รวมข้อมูลของพนักงานแต่ละคนสำหรับเดือนที่เลือก: ผลรายวัน (byDay) + ค่าสูงสุดที่วัดได้ (maxLevel)
function alcSummaryDataForMonth(monthVal) {
  const [y, m] = monthVal.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const rows = (mdAbcStaff || []).map(emp => {
    const recordsForEmp = alcTests.filter(t => t.employee === emp.name && t.date && t.date.startsWith(monthVal));
    const levels = recordsForEmp.map(r => r.level).filter(v => typeof v === 'number' && !isNaN(v));
    const maxLevel = levels.length ? Math.max(...levels) : null;
    const byDay = {};
    recordsForEmp.forEach(r => { byDay[Number(r.date.slice(-2))] = r; });
    return { emp, byDay, maxLevel };
  });
  return { y, m, days, rows };
}

function alcRenderSummary() {
  const wrap = document.getElementById('alc-summary-table-wrap');
  if (!wrap) return;
  const monthVal = alcSummaryMonthValue();
  const { y, m, days, rows } = alcSummaryDataForMonth(monthVal);

  if (!mdAbcStaff || mdAbcStaff.length === 0) {
    wrap.innerHTML = '<p class="empty-state">ยังไม่มีรายชื่อพนักงานลาน ABC — เพิ่มได้ที่หน้า "เพิ่มบันทึก"</p>';
    return;
  }

  const dayHeaders = days.map(d => {
    const dow = new Date(y, m - 1, d).getDay();
    const weekend = dow === 0 || dow === 6;
    return `<th class="alc-sum-day${weekend ? ' alc-sum-weekend' : ''}"><div>${d}</div><div class="alc-sum-dow">${ALC_DOW_SHORT_TH[dow]}</div></th>`;
  }).join('');

  const bodyRows = rows.map(({ emp, byDay, maxLevel }, i) => {
    const timeCells = days.map(d => `<td class="alc-sum-cell">${byDay[d]?.time ? escapeHtml(byDay[d].time) : ''}</td>`).join('');
    const levelCells = days.map(d => {
      const rec = byDay[d];
      if (!rec) return '<td class="alc-sum-cell"></td>';
      const lv = rec.level ?? 0;
      return `<td class="alc-sum-cell${lv > 0 ? ' alc-sum-flag' : ''}">${lv}</td>`;
    }).join('');
    return `
      <tr>
        <td rowspan="2">${i + 1}</td>
        <td rowspan="2" class="alc-sum-name">${escapeHtml(emp.name)}</td>
        <td rowspan="2">${escapeHtml(emp.businessUnit || '-')}</td>
        <td class="alc-sum-label">เวลาตรวจ</td>
        <td rowspan="2" class="alc-sum-max${maxLevel > 0 ? ' alc-sum-flag' : ''}">${maxLevel === null ? '-' : maxLevel}</td>
        ${timeCells}
      </tr>
      <tr>
        <td class="alc-sum-label">แอลกอฮอล์ (มก.)</td>
        ${levelCells}
      </tr>
    `;
  }).join('');

  wrap.innerHTML = `
    <table class="data-table alc-summary-table">
      <thead>
        <tr>
          <th>No.</th><th>ชื่อพนักงาน</th><th>หน่วยงาน</th><th>รายการ</th><th>MAX</th>
          ${dayHeaders}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>
  `;
}

function alcExportSummaryExcel() {
  const monthVal = alcSummaryMonthValue();
  const { days, rows } = alcSummaryDataForMonth(monthVal);
  if (!mdAbcStaff || mdAbcStaff.length === 0) { showToast('ยังไม่มีรายชื่อพนักงานลาน ABC', 'warning'); return; }

  const sheetRows = [['No.', 'ชื่อพนักงาน', 'หน่วยงาน', 'รายการ', 'MAX', ...days.map(String)]];
  rows.forEach(({ emp, byDay, maxLevel }, i) => {
    sheetRows.push([i + 1, emp.name, emp.businessUnit || '-', 'เวลาตรวจ', maxLevel === null ? '-' : maxLevel, ...days.map(d => byDay[d]?.time || '')]);
    sheetRows.push(['', '', '', 'แอลกอฮอล์ (มก.)', '', ...days.map(d => byDay[d] ? (byDay[d].level ?? 0) : '')]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปแอลกอฮอล์');
  XLSX.writeFile(wb, `สรุปเป่าแอลกอฮอล์_${monthVal}.xlsx`);
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
  alcRenderSummary();
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

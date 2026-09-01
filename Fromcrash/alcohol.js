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
const ALC_RESULT_OPTIONS = ['ยังไม่เป่า', 'ผ่าน', 'ไม่ผ่าน', 'ขาด/ลา', 'ต่อเนื่อง', 'ลาออก'];
const ALC_DOW_SHORT_TH = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const ALC_MONTH_SHORT_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const ALC_MONTH_FULL_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

let alcTests = JSON.parse(localStorage.getItem('finflow_alcohol_tests') || '[]');
let alcRef = null;
let alcReady = false;

function alcSave() { localStorage.setItem('finflow_alcohol_tests', JSON.stringify(alcTests)); }

// ===== Sub-tabs =====
function alcSwitchTab(tab) {
  ['list', 'add', 'summary', 'daily'].forEach(t => {
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
  if (tab === 'daily') {
    const monthEl = document.getElementById('alc-daily-month');
    if (monthEl && !monthEl.value) monthEl.value = new Date().toISOString().substring(0, 7);
    alcRenderDailyReport();
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
  const touched = []; // เก็บเฉพาะ record ที่เปลี่ยนจริงรอบนี้ ไว้ sync ขึ้น Firebase แบบเจาะจง

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
      touched.push(alcTests[idx]);
    } else {
      const rec = {
        id: 'ALC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
        runningNo: alcNextRunningNo(),
        date, time: timeStr,
        employee: name,
        businessUnit,
        level,
        resultOut, resultReturn, note,
        createdAt: now.toISOString(),
      };
      alcTests.unshift(rec);
      touched.push(rec);
    }
  });

  alcSave();
  alcPushManyIfReady(touched);
  alcRenderList();
  alcRenderRoster();
  alcRenderSummary();
  alcRenderDailyReport();
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
  if (!confirmDeleteWithPin('ยืนยันการลบบันทึกนี้?')) return;
  alcTests = alcTests.filter(t => t.id !== id);
  alcSave();
  alcRemoveOneIfReady(id);
  alcRenderList();
  alcRenderRoster();
  alcRenderSummary();
  alcRenderDailyReport();
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
    'ลาออก': null,
  };
  if (result === 'ไม่ผ่าน') return `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">${escapeHtml(result)}</span>`;
  if (result === 'ยังไม่เป่า' || !result) return `<span class="badge" style="background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border)">${escapeHtml(result || ALC_RESULT_OPTIONS[0])}</span>`;
  if (result === 'ลาออก') return `<span class="badge" style="background:var(--bg-input);color:var(--text-muted);border:1px solid var(--border)">${escapeHtml(result)}</span>`;
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
      t.runningNo, formatDMY(t.date), t.time || '', t.employee, t.businessUnit || '',
      t.resultOut || t.result || '', t.resultReturn || '', t.level ?? ALC_FIXED_LEVEL, t.note || '',
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'เป่าวัดแอลกอฮอล์');
  XLSX.writeFile(wb, `บันทึกเป่าแอลกอฮอล์_${new Date().toISOString().substring(0, 10)}.xlsx`);
}

// รูปแบบไฟล์ตาราง matrix (No./ชื่อ/หน่วยงาน x วันที่ 1-31) ใช้ทั้ง Template/Export/Import ให้ตรงกัน
// ต่อพนักงาน 1 คน = 2 แถว: จำนวนตรวจ (ค่าเดียวต่อวัน — ใช้ได้ทั้งขาไป/ขากลับ) / แอลกอฮอล์ (มก.)
const ALC_SUMMARY_ROW_LABELS = ['จำนวนตรวจ', 'แอลกอฮอล์ (มก.)'];

function alcDownloadTemplate() {
  if (!mdAbcStaff || mdAbcStaff.length === 0) { showToast('ยังไม่มีรายชื่อพนักงานลาน ABC', 'warning'); return; }
  const monthVal = alcSummaryMonthValue();
  const { days } = alcSummaryDataForMonth(monthVal);
  const sheetRows = [['No.', 'ชื่อพนักงาน', 'หน่วยงาน', 'รายการ', 'MAX', ...days.map(String)]];
  mdAbcStaff.forEach((emp, i) => {
    sheetRows.push([i + 1, emp.name, emp.businessUnit || '-', ALC_SUMMARY_ROW_LABELS[0], '-', ...days.map(() => '')]);
    sheetRows.push(['', '', '', ALC_SUMMARY_ROW_LABELS[1], '', ...days.map(() => '')]);
  });
  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปแอลกอฮอล์');
  XLSX.writeFile(wb, `template_เป่าวัดแอลกอฮอล์_${monthVal}.xlsx`);
}

function alcNormalizeResult(v) {
  const s = String(v || '').trim();
  return ALC_RESULT_OPTIONS.includes(s) ? s : ALC_RESULT_OPTIONS[0];
}

// ตีความค่าในช่อง "จำนวนตรวจ" ของ 1 วัน: อาจเป็นตัวเลข (0/1/2 = จำนวนรอบที่เป่า)
// หรือคำสถานะตรงๆ (ผ่าน/ไม่ผ่าน/ขาด-ลา/ต่อเนื่อง) ที่พิมพ์ทับไว้เอง — คืน status เดียวใช้กับทั้งขาไป/ขากลับ
// null = ไม่มีข้อมูลวันนั้น (0 หรือว่าง) ให้ข้าม ไม่สร้างบันทึก
function alcParseCountCell(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  if (ALC_RESULT_OPTIONS.includes(s)) return s;
  const n = parseFloat(s);
  if (isNaN(n) || n <= 0) return null;
  return 'ผ่าน'; // เป่าแล้ว (1 หรือ 2 ครั้ง) แต่ไม่ได้ระบุผลไว้ ถือว่าผ่าน
}

// นำเข้าไฟล์ตาราง matrix เดียวกับที่ได้จากปุ่ม "Export Excel" ของแท็บสรุปรายเดือน
// ใช้เดือนที่เลือกอยู่ในตัวเลือก "เดือน" ของแท็บนี้เป็นเดือนอ้างอิง (ไฟล์มีแค่เลขวันที่ ไม่มีปี-เดือนในตัว)
function alcImportExcel(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const header = rows[0] || [];
      const dayCols = header.map((v, col) => ({ day: parseInt(v), col })).filter(d => !isNaN(d.day) && d.col >= 5);
      const monthVal = alcSummaryMonthValue();
      const [y, m] = monthVal.split('-').map(Number);

      let updated = 0, added = 0;
      const now = new Date();
      for (let i = 1; i < rows.length; i += 2) {
        const countRow = rows[i];
        if (!countRow) break;
        const employee = String(countRow[1] || '').trim();
        if (!employee) continue;
        const levelRow = rows[i + 1] || [];
        const businessUnit = String(countRow[2] || '').trim() || mdAbcStaff.find(s => s.name === employee)?.businessUnit || '';

        dayCols.forEach(({ day, col }) => {
          const status = alcParseCountCell(countRow[col]);
          if (!status) return; // ไม่มีข้อมูลวันนั้น ข้าม
          const levelRaw = parseFloat(levelRow[col]);
          const level = isNaN(levelRaw) ? ALC_FIXED_LEVEL : levelRaw;
          const date = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

          const idx = alcTests.findIndex(t => t.date === date && t.employee === employee);
          if (idx >= 0) {
            alcTests[idx] = { ...alcTests[idx], businessUnit, resultOut: status, resultReturn: status, level, updatedAt: now.toISOString() };
            delete alcTests[idx].result;
            updated++;
          } else {
            alcTests.unshift({
              id: 'ALC_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
              runningNo: alcNextRunningNo(),
              date, time: '', employee, businessUnit, level, resultOut: status, resultReturn: status, note: '',
              createdAt: now.toISOString(),
            });
            added++;
          }
        });
      }
      alcSave();
      alcPushIfReady();
      alcRenderList();
      alcRenderRoster();
      alcRenderSummary();
      alcRenderDailyReport();
      const msg = [updated ? `อัปเดต ${updated} รายการ` : '', added ? `เพิ่มใหม่ ${added} รายการ` : ''].filter(Boolean).join(', ');
      showToast(msg || `ไม่มีข้อมูลใหม่ (เช็คว่าตัวเลือก "เดือน" ตรงกับเดือน ${monthVal} ของไฟล์หรือไม่)`, msg ? 'success' : 'warning');
    } catch (err) {
      showToast('ไฟล์ไม่ถูกต้อง: ' + err.message, 'error');
    }
    event.target.value = '';
  };
  reader.readAsArrayBuffer(file);
}

// ===== ตารางสรุปผลเป่าแอลกอฮอล์รายวัน แยกตามเดือน (No./ชื่อ/หน่วยงาน x วันที่ 1-31) =====
function alcSummaryMonthValue() {
  return document.getElementById('alc-summary-month')?.value || new Date().toISOString().substring(0, 7);
}

// จำนวนรอบที่เป่าจริงของวันนั้น (0-2) — นับจากผลตรวจที่ไม่ใช่ "ยังไม่เป่า" ของขาไป+ขากลับรวมกัน
// 1 = เป่าแค่ขาเดียว, 2 = เป่าครบทั้ง 2 ขา
function alcTestedCount(rec) {
  if (!rec) return 0;
  let count = 0;
  if (rec.resultOut && rec.resultOut !== ALC_RESULT_OPTIONS[0]) count++;
  if (rec.resultReturn && rec.resultReturn !== ALC_RESULT_OPTIONS[0]) count++;
  return count;
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
    const countCells = days.map(d => {
      const rec = byDay[d];
      if (!rec) return '<td class="alc-sum-cell"></td>';
      const cell = alcSummaryCountCell(rec);
      const isText = typeof cell === 'string';
      const c = isText ? 0 : cell;
      return `<td class="alc-sum-cell${isText || c < 2 ? ' alc-sum-flag' : ''}">${isText ? escapeHtml(cell) : (c || '')}</td>`;
    }).join('');
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
        <td class="alc-sum-label">จำนวนตรวจ</td>
        <td rowspan="2" class="alc-sum-max${maxLevel > 0 ? ' alc-sum-flag' : ''}">${maxLevel === null ? '-' : maxLevel}</td>
        ${countCells}
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

// ค่าที่ลงในช่อง "จำนวนตรวจ" ของ 1 วัน — ถ้าทั้งขาไป/ขากลับผลตรงกันและไม่ใช่ "ผ่าน" (เช่น ขาด/ลา, ต่อเนื่อง, ไม่ผ่าน)
// ให้ export เป็นคำสถานะตรงๆ (ตรงกับที่ผู้ใช้เคยพิมพ์ทับเองในไฟล์จริง) ไม่งั้นใช้ตัวเลขจำนวนรอบตามเดิม
function alcSummaryCountCell(rec) {
  if (!rec) return '';
  const out = rec.resultOut || rec.result || ALC_RESULT_OPTIONS[0];
  const ret = rec.resultReturn || ALC_RESULT_OPTIONS[0];
  if (out === ret && out !== 'ผ่าน' && out !== ALC_RESULT_OPTIONS[0]) return out;
  return alcTestedCount(rec);
}

function alcExportSummaryExcel() {
  const monthVal = alcSummaryMonthValue();
  const { days, rows } = alcSummaryDataForMonth(monthVal);
  if (!mdAbcStaff || mdAbcStaff.length === 0) { showToast('ยังไม่มีรายชื่อพนักงานลาน ABC', 'warning'); return; }

  const sheetRows = [['No.', 'ชื่อพนักงาน', 'หน่วยงาน', 'รายการ', 'MAX', ...days.map(String)]];
  rows.forEach(({ emp, byDay, maxLevel }, i) => {
    sheetRows.push([i + 1, emp.name, emp.businessUnit || '-', ALC_SUMMARY_ROW_LABELS[0], maxLevel === null ? '-' : maxLevel, ...days.map(d => byDay[d] ? alcSummaryCountCell(byDay[d]) : '')]);
    sheetRows.push(['', '', '', ALC_SUMMARY_ROW_LABELS[1], '', ...days.map(d => byDay[d] ? (byDay[d].level ?? 0) : '')]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'สรุปแอลกอฮอล์');
  XLSX.writeFile(wb, `สรุปเป่าแอลกอฮอล์_${monthVal}.xlsx`);
}

// ===== รายงานตัวประจำวัน (แยกผลตรวจขาไป/ขากลับ ต่อวัน) =====
function alcDailyMonthValue() {
  return document.getElementById('alc-daily-month')?.value || new Date().toISOString().substring(0, 7);
}

function alcDailyReportData(monthVal) {
  const [y, m] = monthVal.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const fullStaff = (mdAbcStaff || []).length;

  // สถิติของรอบตรวจหนึ่งรอบ (ขาไปหรือขากลับ): ตรวจแล้ว(ผ่าน+ไม่ผ่าน) / ไม่ผ่าน / % = (ตรวจ+ต่อเนื่อง)/มาทำงาน
  const roundStats = (dayRecords, getResult, atWork, continuous) => {
    const checked = dayRecords.filter(r => getResult(r) === 'ผ่าน' || getResult(r) === 'ไม่ผ่าน').length;
    const failed = dayRecords.filter(r => getResult(r) === 'ไม่ผ่าน').length;
    const pct = atWork > 0 ? Math.round((checked + continuous) / atWork * 100) : 0;
    return { checked, failed, pct };
  };

  return Array.from({ length: daysInMonth }, (_, i) => {
    const day = i + 1;
    const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dow = new Date(y, m - 1, day).getDay();
    const dayRecords = alcTests.filter(t => t.date === dateStr);

    // พนักงานที่มีสถานะ "ลาออก" ในวันนั้น ไม่นับรวมใน "ทั้งหมด (คน)" ของวันนั้น
    // (ต่างจาก "ขาด/ลา" ที่ยังนับเป็นพนักงานทั้งหมดอยู่ แค่ไม่ได้มาทำงานวันนั้นวันเดียว)
    const resigned = dayRecords.filter(r => (r.resultOut || r.result) === 'ลาออก').length;
    const totalStaff = fullStaff - resigned;

    const leaveAbsent = dayRecords.filter(r => (r.resultOut || r.result) === 'ขาด/ลา').length;
    const continuous = dayRecords.filter(r => (r.resultOut || r.result) === 'ต่อเนื่อง').length;
    const atWork = totalStaff - leaveAbsent;

    const out = roundStats(dayRecords, r => r.resultOut || r.result, atWork, continuous);
    const ret = roundStats(dayRecords, r => r.resultReturn, atWork, continuous);
    const summaryPct = Math.round((out.pct + ret.pct) / 2);

    return {
      day, dow, dateStr, hasData: dayRecords.length > 0,
      totalStaff, atWork, continuous, leaveAbsent, out, ret, summaryPct,
    };
  });
}

// รวม/เฉลี่ยของทุกวันที่มีข้อมูลในเดือนนั้น (แถวท้ายตาราง)
function alcDailyReportTotals(rows) {
  const withData = rows.filter(r => r.hasData);
  const n = withData.length;
  const sum = key => withData.reduce((s, r) => s + r[key], 0);
  const sumOut = key => withData.reduce((s, r) => s + r.out[key], 0);
  const sumRet = key => withData.reduce((s, r) => s + r.ret[key], 0);

  const totalStaff = sum('totalStaff'), atWork = sum('atWork'), continuous = sum('continuous'), leaveAbsent = sum('leaveAbsent');
  const outChecked = sumOut('checked'), outFailed = sumOut('failed');
  const retChecked = sumRet('checked'), retFailed = sumRet('failed');
  const outPct = atWork > 0 ? Math.round((outChecked + continuous) / atWork * 100) : 0;
  const retPct = atWork > 0 ? Math.round((retChecked + continuous) / atWork * 100) : 0;
  const summaryPct = Math.round((outPct + retPct) / 2);

  const total = { totalStaff, atWork, continuous, leaveAbsent, out: { checked: outChecked, failed: outFailed, pct: outPct }, ret: { checked: retChecked, failed: retFailed, pct: retPct }, summaryPct };
  const avg = n > 0 ? {
    totalStaff: totalStaff / n, atWork: atWork / n, continuous: continuous / n, leaveAbsent: leaveAbsent / n,
    out: { checked: outChecked / n, failed: outFailed / n, pct: outPct },
    ret: { checked: retChecked / n, failed: retFailed / n, pct: retPct },
    summaryPct,
  } : { totalStaff: 0, atWork: 0, continuous: 0, leaveAbsent: 0, out: { checked: 0, failed: 0, pct: 0 }, ret: { checked: 0, failed: 0, pct: 0 }, summaryPct: 0 };
  return { total, avg, n };
}

function alcRenderDailyReport() {
  const wrap = document.getElementById('alc-daily-table-wrap');
  if (!wrap) return;
  const monthVal = alcDailyMonthValue();
  const [y, m] = monthVal.split('-').map(Number);
  const rows = alcDailyReportData(monthVal);

  if (!mdAbcStaff || mdAbcStaff.length === 0) {
    wrap.innerHTML = '<p class="empty-state">ยังไม่มีรายชื่อพนักงานลาน ABC — เพิ่มได้ที่หน้า "เพิ่มบันทึก"</p>';
    return;
  }

  const daysWithData = rows.filter(r => r.hasData).map(r => r.day);
  const rangeLabel = daysWithData.length
    ? `${Math.min(...daysWithData)} – ${Math.max(...daysWithData)}`
    : `1 – ${rows.length}`;

  const bodyRows = rows.map(r => {
    if (!r.hasData) {
      return `<tr class="alc-daily-empty"><td>${r.day}-${ALC_MONTH_SHORT_TH[m - 1]}</td><td colspan="11"></td></tr>`;
    }
    return `
      <tr>
        <td>${r.day}-${ALC_MONTH_SHORT_TH[m - 1]}</td>
        <td class="alc-daily-col-emp">${r.totalStaff}</td>
        <td class="alc-daily-col-emp">${r.atWork}</td>
        <td class="alc-daily-col-emp">${r.continuous}</td>
        <td class="alc-daily-col-emp">${r.leaveAbsent}</td>
        <td class="alc-daily-col-out">${r.out.checked}</td>
        <td class="alc-daily-col-out"><span class="alc-daily-pct alc-daily-pct-out">${r.out.pct}%</span></td>
        <td class="alc-daily-col-out">${r.out.failed}</td>
        <td class="alc-daily-col-ret">${r.ret.checked}</td>
        <td class="alc-daily-col-ret"><span class="alc-daily-pct alc-daily-pct-ret">${r.ret.pct}%</span></td>
        <td class="alc-daily-col-ret">${r.ret.failed}</td>
        <td class="alc-daily-col-summary">${r.summaryPct}%</td>
      </tr>
    `;
  }).join('');

  const { total, avg } = alcDailyReportTotals(rows);
  const totalsRow = `
    <tr class="alc-daily-totals-row">
      <td>รวม</td>
      <td class="alc-daily-col-emp">${total.totalStaff}</td>
      <td class="alc-daily-col-emp">${total.atWork}</td>
      <td class="alc-daily-col-emp">${total.continuous}</td>
      <td class="alc-daily-col-emp">${total.leaveAbsent}</td>
      <td class="alc-daily-col-out">${total.out.checked}</td>
      <td class="alc-daily-col-out"><span class="alc-daily-pct alc-daily-pct-out">${total.out.pct}%</span></td>
      <td class="alc-daily-col-out">${total.out.failed}</td>
      <td class="alc-daily-col-ret">${total.ret.checked}</td>
      <td class="alc-daily-col-ret"><span class="alc-daily-pct alc-daily-pct-ret">${total.ret.pct}%</span></td>
      <td class="alc-daily-col-ret">${total.ret.failed}</td>
      <td class="alc-daily-col-summary">${total.summaryPct}%</td>
    </tr>
    <tr class="alc-daily-avg-row">
      <td>เฉลี่ย</td>
      <td class="alc-daily-col-emp">${avg.totalStaff.toFixed(2)}</td>
      <td class="alc-daily-col-emp">${avg.atWork.toFixed(2)}</td>
      <td class="alc-daily-col-emp">${avg.continuous.toFixed(2)}</td>
      <td class="alc-daily-col-emp">${avg.leaveAbsent.toFixed(2)}</td>
      <td class="alc-daily-col-out">${avg.out.checked.toFixed(2)}</td>
      <td class="alc-daily-col-out"><span class="alc-daily-pct alc-daily-pct-out">${avg.out.pct}%</span></td>
      <td class="alc-daily-col-out">${avg.out.failed.toFixed(2)}</td>
      <td class="alc-daily-col-ret">${avg.ret.checked.toFixed(2)}</td>
      <td class="alc-daily-col-ret"><span class="alc-daily-pct alc-daily-pct-ret">${avg.ret.pct}%</span></td>
      <td class="alc-daily-col-ret">${avg.ret.failed.toFixed(2)}</td>
      <td class="alc-daily-col-summary">${avg.summaryPct}%</td>
    </tr>
  `;

  wrap.innerHTML = `
    <table class="data-table alc-daily-table">
      <caption>
        <div class="alc-daily-title">รายงานการตรวจสอบแอลกอฮอล์</div>
        <div class="alc-daily-subtitle">ประจำวันที่ ${rangeLabel} ${ALC_MONTH_FULL_TH[m - 1]} ${y}</div>
      </caption>
      <thead>
        <tr>
          <th rowspan="2">วันที่</th>
          <th colspan="4" class="alc-daily-grp-emp">พนักงาน</th>
          <th colspan="3" class="alc-daily-grp-out">ขาไป (ก่อนปฏิบัติงาน)</th>
          <th colspan="3" class="alc-daily-grp-ret">ขากลับ (หลังปฏิบัติงาน)</th>
          <th rowspan="2" class="alc-daily-grp-summary">% สรุปการตรวจ<br>(เฉลี่ยทั้งไปและกลับ)</th>
        </tr>
        <tr>
          <th class="alc-daily-col-emp">ทั้งหมด<br>(คน)</th>
          <th class="alc-daily-col-emp">มาทำงาน<br>(คน)</th>
          <th class="alc-daily-col-emp">ต่อเนื่อง<br>(คน)</th>
          <th class="alc-daily-col-emp">ขาด/ลา<br>(คน)</th>
          <th class="alc-daily-col-out">ตรวจ<br>(คน)</th>
          <th class="alc-daily-col-out">%</th>
          <th class="alc-daily-col-out">ไม่ผ่าน<br>(คน)</th>
          <th class="alc-daily-col-ret">ตรวจ<br>(คน)</th>
          <th class="alc-daily-col-ret">%</th>
          <th class="alc-daily-col-ret">ไม่ผ่าน<br>(คน)</th>
        </tr>
      </thead>
      <tbody>${bodyRows}${totalsRow}</tbody>
    </table>
  `;
}

function alcExportDailyReportExcel() {
  const monthVal = alcDailyMonthValue();
  const [y, m] = monthVal.split('-').map(Number);
  const rows = alcDailyReportData(monthVal);
  if (!mdAbcStaff || mdAbcStaff.length === 0) { showToast('ยังไม่มีรายชื่อพนักงานลาน ABC', 'warning'); return; }

  const header1 = ['วันที่', 'พนักงาน', '', '', '', 'ขาไป (ก่อนปฏิบัติงาน)', '', '', 'ขากลับ (หลังปฏิบัติงาน)', '', '', '% สรุปการตรวจ (เฉลี่ยทั้งไปและกลับ)'];
  const header2 = ['', 'ทั้งหมด (คน)', 'มาทำงาน (คน)', 'ต่อเนื่อง (คน)', 'ขาด/ลา (คน)', 'ตรวจ (คน)', '%', 'ไม่ผ่าน (คน)', 'ตรวจ (คน)', '%', 'ไม่ผ่าน (คน)', ''];
  const toRow = r => r.hasData
    ? [`${r.day}-${ALC_MONTH_SHORT_TH[m - 1]}`, r.totalStaff, r.atWork, r.continuous, r.leaveAbsent, r.out.checked, `${r.out.pct}%`, r.out.failed, r.ret.checked, `${r.ret.pct}%`, r.ret.failed, `${r.summaryPct}%`]
    : [`${r.day}-${ALC_MONTH_SHORT_TH[m - 1]}`, '', '', '', '', '', '', '', '', '', '', ''];

  const { total, avg } = alcDailyReportTotals(rows);
  const sheetRows = [
    [`รายงานการตรวจสอบแอลกอฮอล์ ประจำวันที่ ${ALC_MONTH_FULL_TH[m - 1]} ${y}`],
    header1, header2,
    ...rows.map(toRow),
    ['รวม', total.totalStaff, total.atWork, total.continuous, total.leaveAbsent, total.out.checked, `${total.out.pct}%`, total.out.failed, total.ret.checked, `${total.ret.pct}%`, total.ret.failed, `${total.summaryPct}%`],
    ['เฉลี่ย', avg.totalStaff.toFixed(2), avg.atWork.toFixed(2), avg.continuous.toFixed(2), avg.leaveAbsent.toFixed(2), avg.out.checked.toFixed(2), `${avg.out.pct}%`, avg.out.failed.toFixed(2), avg.ret.checked.toFixed(2), `${avg.ret.pct}%`, avg.ret.failed.toFixed(2), `${avg.summaryPct}%`],
  ];

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'รายงานประจำวัน');
  XLSX.writeFile(wb, `รายงานประจำวันแอลกอฮอล์_${monthVal}.xlsx`);
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
  alcRenderDailyReport();
}
async function alcWriteFB() {
  if (!alcRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(alcRef, alcRecordsToObj(alcTests));
  } catch (e) { console.warn('alcWriteFB error', e); }
}
function alcPushIfReady() { if (alcReady) alcWriteFB(); }

// ===== เขียนเฉพาะรายการที่เปลี่ยนจริง (ไม่ใช่ทั้งอาเรย์) =====
// alcSaveRoster บันทึกทีเดียวหลายสิบคน (ทั้งลาน) แต่ก่อนหน้านี้ยังคง set() ทับข้อมูลย้อนหลังทั้งหมดทุกครั้ง
// (เป็นหมื่นกว่า record/ปีถ้าบันทึกทุกวัน) ทำให้ยิ่งใช้นานยิ่งช้า — เปลี่ยนมาใช้ update() แบบ multi-path
// อัปเดตเฉพาะ record ที่เปลี่ยนของวันนั้น ส่วนรายการเก่าที่ไม่เปลี่ยนจะไม่ถูกแตะต้อง/ส่งซ้ำเลย
async function alcWriteMany(records) {
  if (!alcRef || !records || !records.length) return;
  try {
    const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const updates = {};
    records.forEach(r => { if (r && r.id) updates[`/alcoholTests/${r.id}`] = r; });
    await update(ref(fbDb), updates);
  } catch (e) { console.warn('alcWriteMany error', e); }
}
function alcPushManyIfReady(records) { if (alcReady) alcWriteMany(records); }

async function alcRemoveOne(id) {
  if (!alcRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/alcoholTests/${id}`));
  } catch (e) { console.warn('alcRemoveOne error', e); }
}
function alcRemoveOneIfReady(id) { if (alcReady) alcRemoveOne(id); }

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

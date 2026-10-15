// ===== ระบบเบิกจ่าย Stock Safety (สติ๊กเกอร์ / สายรัดชิ่ง / ไม้หนุนล้อ) =====
// เก็บเป็น "รายการเคลื่อนไหว" (รับเข้า / เบิกจ่าย) แล้วคำนวณยอดคงเหลือจากผลรวม ไม่เก็บยอดคงเหลือแยก
// เพื่อไม่ให้ตัวเลขเพี้ยนเวลาแก้ไข/ลบรายการย้อนหลัง
// เก็บ local ที่ key 'finflow_safety_stock' และ sync กับ Firebase ที่ /safetyStock (โครงสร้างเหมือน breakdown.js)

// รายการสินค้า (เพิ่ม/ลบเองได้ในหน้าเว็บ) — 3 รายการตั้งต้นใช้ id คงที่ เพื่อไม่ให้เครื่องต่างๆ สร้างซ้ำกัน
const SS_DEFAULT_ITEMS = [
  { id: 'SI_default_h', name: 'สายรัดชิ่ง (หัว)', unit: 'หัว' },
  { id: 'SI_default_s', name: 'สายรัดชิ่ง (สาย)', unit: 'สาย' },
  { id: 'SI_default_c', name: 'ไม้หนุนล้อ', unit: 'คู่' },
  { id: 'SI_default_st1', name: 'สติ๊กเกอร์ ประกอบการเอพีฯ', unit: 'แผ่น' },
  { id: 'SI_default_st2', name: 'สติ๊กเกอร์ ประกอบการอำพล', unit: 'แผ่น' },
  { id: 'SI_default_st3', name: 'สติ๊กเกอร์ คาดหน้า', unit: 'แผ่น' },
  { id: 'SI_default_st4', name: 'สติ๊กเกอร์ รูปโลก', unit: 'แผ่น' },
  { id: 'SI_default_st5', name: 'สติ๊กเกอร์ ตรวจสอบก่อนขึ้นขับ', unit: 'แผ่น' },
  { id: 'SI_default_st6', name: 'สติ๊กเกอร์ ห้ามโดยสาร', unit: 'แผ่น' },
  { id: 'SI_default_st7', name: 'สติ๊กเกอร์ อย่าลืมล็อกกลอนประตูตู้', unit: 'แผ่น' },
  { id: 'SI_default_st8', name: 'สติ๊กเกอร์ Q-Mark', unit: 'แผ่น' },
  { id: 'SI_default_st9', name: 'สติ๊กเกอร์ ISO', unit: 'แผ่น' },
];
// รุ่นแรกของแอปใช้ 3 รายการรวม (สติ๊กเกอร์ / สายรัดชิ่ง / ไม้หนุนล้อ) — ย้ายมาแบบแยกประเภทแล้ว
// รายการเก่าจะถูกเอาออกอัตโนมัติถ้ายังไม่มีประวัติรับเข้า/เบิกจ่ายอ้างถึง (ดู ssMigrateItems)
const SS_LEGACY_ITEM_IDS = ['SI_default_1', 'SI_default_2', 'SI_default_3'];
const SS_ITEMS_SCHEMA = 2;
let ssItems = SS_DEFAULT_ITEMS.map(i => ({ ...i }));
let ssItemsFbLoaded = false;
cacheLoad('finflow_safety_items').then(v => {
  if (ssItemsFbLoaded || !Array.isArray(v) || v.length === 0) return;
  ssItems = v;
  if (document.readyState !== 'loading') { ssRefreshItemSelects(); ssRenderAll(); }
});
const SS_TYPE_OUT = 'เบิกจ่าย';
const SS_TYPE_IN = 'รับเข้า';

let safetyStock = [];
let ssFbLoaded = false; // ถ้า Firebase ส่งข้อมูลมาแล้ว แคชในเครื่องจะไม่ทับข้อมูลจริง
cacheLoad('finflow_safety_stock').then(v => {
  if (ssFbLoaded || !Array.isArray(v)) return;
  safetyStock = v;
  if (document.readyState !== 'loading') ssRenderAll();
});
let ssEditingId = null;
let ssRef = null;
let ssReady = false;

function ssSave() { cacheSet('finflow_safety_stock', safetyStock); }
function ssSaveItems() { cacheSet('finflow_safety_items', ssItems); }
function ssUnit(name) { return (ssItems.find(i => i.name === name) || {}).unit || ''; }

// ยอดคงเหลือต่อรายการ (รับเข้า - เบิกจ่าย) ; excludeId ใช้ตอนแก้ไขรายการเดิม ไม่ให้นับซ้ำ
function ssBalance(itemName, excludeId) {
  return safetyStock.reduce((sum, r) => {
    if (r.item !== itemName || r.id === excludeId) return sum;
    return sum + (r.type === SS_TYPE_IN ? 1 : -1) * (Number(r.qty) || 0);
  }, 0);
}

// ===== Tabs =====
function ssSwitchTab(tab) {
  ['summary', 'list', 'add'].forEach(t => {
    document.getElementById(`ss-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`ss-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'summary') ssRenderSummary();
  if (tab === 'list') ssRenderList();
  if (tab === 'add' && !ssEditingId) ssClearForm();
}

function ssOnPageShown() {
  ssRefreshItemSelects();
  ssRefreshLookupDropdowns();
  ssRenderAll();
}

function ssRenderAll() {
  ssRenderSummary();
  ssRenderList();
}

// ===== Summary =====
function ssRenderSummary() {
  const wrap = document.getElementById('ss-balance-cards');
  if (!wrap) return;
  wrap.innerHTML = ssItems.map(it => {
    const bal = ssBalance(it.name);
    const color = bal <= 0 ? '#ef4444' : bal <= 10 ? '#f59e0b' : '#22c55e';
    return `<div class="stat-card" style="border-left:4px solid ${color};">
      <div class="stat-label">${escapeHtml(it.name)}
        <button class="action-btn action-delete" style="float:right;padding:0 6px;" title="ลบรายการนี้" onclick="ssDeleteItem('${it.id}')">×</button></div>
      <div class="stat-value" style="color:${color};">${bal.toLocaleString()} <span style="font-size:0.9rem;">${escapeHtml(it.unit)}</span></div>
      <div style="font-size:0.75rem;color:var(--text-muted);">คงเหลือ${bal <= 10 ? ' (ใกล้หมด)' : ''}</div>
    </div>`;
  }).join('');

  // สรุปเบิกจ่ายรายเดือน (ปีปัจจุบัน) แยกตามรายการ
  const year = String(new Date().getFullYear());
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const tbody = document.getElementById('ss-month-body');
  if (!tbody) return;
  const head = document.getElementById('ss-month-head');
  if (head) head.innerHTML = '<tr><th>เดือน</th>' + ssItems.map(it => `<th>${escapeHtml(it.name)} (${escapeHtml(it.unit)})</th>`).join('') + '</tr>';
  tbody.innerHTML = months.map((m, idx) => {
    const prefix = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const cells = ssItems.map(it => {
      const n = safetyStock
        .filter(r => r.type === SS_TYPE_OUT && r.item === it.name && (r.date || '').startsWith(prefix))
        .reduce((s, r) => s + (Number(r.qty) || 0), 0);
      return `<td>${n || '-'}</td>`;
    }).join('');
    return `<tr><td>${m} ${year}</td>${cells}</tr>`;
  }).join('');
}

// ย้ายจากรายการรุ่นแรกมาเป็นรายการแยกประเภท: เอา legacy ที่ไม่มีประวัติออก แล้วเติมรายการตั้งต้นที่ยังไม่มี
// ทำครั้งเดียว (ใช้ _schema ใน Firebase เป็นตัวกัน) เพื่อไม่ให้รายการตั้งต้นที่ผู้ใช้ลบทิ้งแล้วเด้งกลับมาอีก
function ssMigrateItems() {
  const used = new Set(safetyStock.map(r => r.item));
  ssItems = ssItems.filter(i => !SS_LEGACY_ITEM_IDS.includes(i.id) || used.has(i.name));
  SS_DEFAULT_ITEMS.forEach(d => {
    if (!ssItems.some(i => i.id === d.id || i.name === d.name)) ssItems.push({ ...d });
  });
  ssSaveItems();
  ssRefreshItemSelects();
  ssRenderAll();
}

// ===== จัดการรายการสินค้า (เพิ่ม/ลบเอง) =====
function ssRefreshItemSelects() {
  const fill = (id, placeholder) => {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = `<option value="">${placeholder}</option>` +
      ssItems.map(it => `<option value="${escapeHtml(it.name)}">${escapeHtml(it.name)}</option>`).join('');
    if (ssItems.some(it => it.name === current)) el.value = current;
  };
  fill('ss-item', '-- เลือก --');
  fill('ss-f-item', 'ทั้งหมด');
}

function ssAddItem() {
  const name = (prompt('ชื่อรายการสินค้าใหม่ (เช่น กรวยจราจร):') || '').trim();
  if (!name) return;
  if (ssItems.some(it => it.name === name)) { showToast('มีรายการนี้อยู่แล้ว', 'warning'); return; }
  const unit = (prompt(`หน่วยนับของ "${name}" (เช่น อัน, เส้น, แผ่น):`, 'อัน') || '').trim();
  if (!unit) return;
  ssItems.push({ id: 'SI_' + Date.now(), name, unit });
  ssSaveItems();
  ssPushItemsIfReady();
  ssRefreshItemSelects();
  ssRenderAll();
  showToast('เพิ่มรายการแล้ว — อย่าลืมบันทึก "รับเข้า" เป็นยอดตั้งต้น', 'success');
}

function ssDeleteItem(id) {
  const it = ssItems.find(i => i.id === id);
  if (!it) return;
  // มีประวัติรับเข้า/เบิกจ่ายแล้วลบไม่ได้ เพราะรายการเก่าจะอ้างชื่อที่หายไป ยอดคงเหลือจะเพี้ยน
  if (safetyStock.some(r => r.item === it.name)) { showToast('ลบไม่ได้: รายการนี้มีประวัติรับเข้า/เบิกจ่ายแล้ว', 'error'); return; }
  if (!confirmDeleteWithPin(`ยืนยันการลบรายการ "${it.name}"?`)) return;
  ssItems = ssItems.filter(i => i.id !== id);
  ssSaveItems();
  ssPushItemsIfReady();
  ssRefreshItemSelects();
  ssRenderAll();
  showToast('ลบรายการแล้ว', 'warning');
}

// ===== Lookup dropdowns =====
function ssFillDatalist(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = (list || []).map(name => `<option value="${escapeHtml(name)}">`).join('');
}

function ssRefreshLookupDropdowns() {
  ssFillDatalist('ss-driver-list', (typeof mdDrivers !== 'undefined' ? mdDrivers : []).map(d => d.name).filter(Boolean));
  ssFillDatalist('ss-plate-list', (typeof mdVehicles !== 'undefined' ? mdVehicles : []).map(v => v.plate).filter(Boolean));
  ssFillDatalist('ss-bu-list', typeof mdBusinessUnits !== 'undefined' ? mdBusinessUnits : []);
  ssFillDatalist('ss-yard-list', typeof mdYards !== 'undefined' ? mdYards : []);
}

function ssLookupVehicle() {
  const plate = document.getElementById('ss-plate').value.trim();
  const veh = (typeof mdVehicles !== 'undefined' ? mdVehicles : []).find(v => v.plate === plate);
  if (veh) {
    if (veh.businessUnit) document.getElementById('ss-bu').value = veh.businessUnit;
    if (veh.yard) document.getElementById('ss-yard').value = veh.yard;
  }
}

function ssUpdateFormHints() {
  const item = document.getElementById('ss-item').value;
  const isOut = document.getElementById('ss-type').value === SS_TYPE_OUT;
  const hint = document.getElementById('ss-balance-hint');
  const unit = document.getElementById('ss-unit');
  if (unit) unit.textContent = ssUnit(item);
  if (hint) hint.textContent = item ? `คงเหลือปัจจุบัน ${ssBalance(item, ssEditingId).toLocaleString()} ${ssUnit(item)}` : '';
  // ฟิลด์ผู้รับ/ทะเบียน ใช้เฉพาะตอนเบิกจ่าย
  document.querySelectorAll('.ss-out-only').forEach(el => { el.style.display = isOut ? '' : 'none'; });
}

// ===== Running number =====
function ssNextRunningNo() {
  return safetyStock.length ? Math.max(...safetyStock.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function ssSaveCase() {
  const date = document.getElementById('ss-date').value;
  const type = document.getElementById('ss-type').value;
  const item = document.getElementById('ss-item').value;
  const qty = Number(document.getElementById('ss-qty').value);
  const receiver = document.getElementById('ss-receiver').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่', 'warning'); return; }
  if (!item) { showToast('กรุณาเลือกรายการ', 'warning'); return; }
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) { showToast('จำนวนต้องเป็นจำนวนเต็มมากกว่า 0', 'warning'); return; }
  if (type === SS_TYPE_OUT) {
    if (!receiver) { showToast('กรุณาระบุชื่อผู้เบิก/ผู้รับ', 'warning'); return; }
    const bal = ssBalance(item, ssEditingId);
    if (qty > bal) { showToast(`ยอดคงเหลือไม่พอ (${item} เหลือ ${bal} ${ssUnit(item)})`, 'error'); return; }
  } else if (ssEditingId) {
    // แก้รายการ "รับเข้า" ให้ยอดลดลงจนทำให้ยอดคงเหลือติดลบไม่ได้
    const old = safetyStock.find(r => r.id === ssEditingId);
    const newBal = ssBalance(item, ssEditingId) + qty;
    if (old && old.item === item && newBal < 0) { showToast('แก้ไขแล้วยอดคงเหลือจะติดลบ', 'error'); return; }
  }

  const record = {
    date, type, item, qty, unit: ssUnit(item),
    receiver: type === SS_TYPE_OUT ? receiver : '',
    plate: type === SS_TYPE_OUT ? document.getElementById('ss-plate').value.trim() : '',
    businessUnit: type === SS_TYPE_OUT ? document.getElementById('ss-bu').value.trim() : '',
    yard: type === SS_TYPE_OUT ? document.getElementById('ss-yard').value.trim() : '',
    note: document.getElementById('ss-note').value.trim(),
  };

  let savedRecord;
  if (ssEditingId) {
    const idx = safetyStock.findIndex(i => i.id === ssEditingId);
    if (idx >= 0) {
      safetyStock[idx] = { ...safetyStock[idx], ...record, updatedAt: new Date().toISOString() };
      savedRecord = safetyStock[idx];
      showToast('บันทึกการแก้ไขแล้ว', 'success');
    }
    ssClearForm();
  } else {
    record.id = 'SS_' + Date.now();
    record.runningNo = ssNextRunningNo();
    record.createdAt = new Date().toISOString();
    safetyStock.unshift(record);
    savedRecord = record;
    showToast(type === SS_TYPE_OUT ? 'บันทึกการเบิกจ่ายแล้ว' : 'บันทึกการรับเข้าแล้ว', 'success');
    if (type === SS_TYPE_OUT && typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `🦺 <b>เบิกจ่าย Stock Safety</b>\nเลขที่: ${record.runningNo}\nรายการ: ${escapeHtml(item)} ${qty} ${escapeHtml(record.unit)}\nผู้เบิก: ${escapeHtml(receiver)}\nทะเบียน: ${escapeHtml(record.plate)}\nคงเหลือ: ${ssBalance(item)} ${escapeHtml(record.unit)}`
      );
    }
    ssClearForm();
  }
  ssSave();
  if (savedRecord) ssPushOneIfReady(savedRecord);
  ssRenderAll();
  ssUpdateFormHints();
}

function ssClearForm() {
  ssEditingId = null;
  document.getElementById('ss-edit-banner').style.display = 'none';
  document.getElementById('ss-date').value = alcTodayLocalSafe();
  document.getElementById('ss-type').value = SS_TYPE_OUT;
  document.getElementById('ss-item').value = '';
  document.getElementById('ss-qty').value = '';
  ['ss-receiver', 'ss-plate', 'ss-bu', 'ss-yard', 'ss-note'].forEach(id => { document.getElementById(id).value = ''; });
  ssUpdateFormHints();
}

function alcTodayLocalSafe() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ssEditCase(id) {
  const rec = safetyStock.find(i => i.id === id);
  if (!rec) return;
  ssSwitchTab('add');
  ssEditingId = id;
  document.getElementById('ss-edit-banner').style.display = 'flex';
  document.getElementById('ss-edit-no').textContent = rec.runningNo;
  document.getElementById('ss-date').value = rec.date || '';
  document.getElementById('ss-type').value = rec.type || SS_TYPE_OUT;
  document.getElementById('ss-item').value = rec.item || '';
  document.getElementById('ss-qty').value = rec.qty || '';
  document.getElementById('ss-receiver').value = rec.receiver || '';
  document.getElementById('ss-plate').value = rec.plate || '';
  document.getElementById('ss-bu').value = rec.businessUnit || '';
  document.getElementById('ss-yard').value = rec.yard || '';
  document.getElementById('ss-note').value = rec.note || '';
  ssUpdateFormHints();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function ssCancelEdit() { ssClearForm(); }

function ssDeleteCase(id) {
  const rec = safetyStock.find(i => i.id === id);
  if (!rec) return;
  // ลบรายการ "รับเข้า" แล้วยอดคงเหลือติดลบไม่ได้
  if (rec.type === SS_TYPE_IN && ssBalance(rec.item, id) < 0) { showToast('ลบไม่ได้: ยอดคงเหลือจะติดลบ', 'error'); return; }
  if (!confirmDeleteWithPin('ยืนยันการลบรายการนี้?')) return;
  safetyStock = safetyStock.filter(i => i.id !== id);
  ssSave();
  ssRemoveOneIfReady(id);
  ssRenderAll();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function ssFilteredList() {
  const type = document.getElementById('ss-f-type')?.value || '';
  const item = document.getElementById('ss-f-item')?.value || '';
  const month = document.getElementById('ss-f-month')?.value || '';
  const search = (document.getElementById('ss-f-search')?.value || '').toLowerCase().trim();
  return safetyStock.filter(i => {
    if (type && i.type !== type) return false;
    if (item && i.item !== item) return false;
    if (month && !(i.date || '').startsWith(month)) return false;
    if (search && !(`${i.receiver} ${i.plate} ${i.businessUnit} ${i.yard} ${i.note}`.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.runningNo || 0) - (a.runningNo || 0));
}

function ssClearListFilters() {
  ['ss-f-type', 'ss-f-item', 'ss-f-month', 'ss-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ssRenderList();
}

function ssRenderList() {
  const list = ssFilteredList();
  const tbody = document.getElementById('ss-list-body');
  const countEl = document.getElementById('ss-list-count');
  const pagerEl = document.getElementById('ss-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('ss-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('ss-list', page, totalPages, total, 'ssRenderList');
  tbody.innerHTML = pageItems.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${i.type === SS_TYPE_IN ? '📥 รับเข้า' : '📤 เบิกจ่าย'}</td>
      <td>${escapeHtml(i.item)}</td>
      <td>${Number(i.qty).toLocaleString()} ${escapeHtml(i.unit || '')}</td>
      <td>${escapeHtml(i.receiver || '-')}</td>
      <td>${escapeHtml(i.plate || '-')}</td>
      <td>${escapeHtml(i.yard || '-')}</td>
      <td>${escapeHtml(i.note || '-')}</td>
      <td>
        <button class="action-btn action-view" onclick="ssEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="ssDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Excel Export =====
function ssExportExcel() {
  if (!safetyStock.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const rows = [
    ['เลขที่', 'วันที่', 'ประเภท', 'รายการ', 'จำนวน', 'หน่วย', 'ผู้เบิก', 'ทะเบียน', 'หน่วยงาน', 'ลานจอด', 'หมายเหตุ'],
    ...safetyStock.map(i => [i.runningNo, formatDMY(i.date), i.type || '', i.item || '', i.qty, i.unit || '',
      i.receiver || '', i.plate || '', i.businessUnit || '', i.yard || '', i.note || '']),
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [8, 14, 12, 16, 10, 8, 18, 14, 16, 14, 30].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Safety');
  XLSX.writeFile(wb, 'StockSafety_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// ===== Firebase Sync =====
function ssRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function ssObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
// เก็บรายการที่มีเฉพาะในเครื่อง (ยัง push ไม่สำเร็จ) ไว้ ไม่ให้ข้อมูลจาก server ทับหาย แล้ว sync ขึ้นไปทันที
function ssApplyServer(serverRecords) {
  ssFbLoaded = true;
  const serverIds = new Set(serverRecords.map(r => r.id));
  const localOnly = (safetyStock || []).filter(t => t && t.id && !serverIds.has(t.id));
  safetyStock = serverRecords.concat(localOnly);
  ssSave();
  ssRenderAll();
  ssUpdateFormHints();
  if (localOnly.length > 0) ssWriteFB();
}
async function ssWriteFB() {
  if (!ssRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ssRef, ssRecordsToObj(safetyStock));
  } catch (e) { console.warn('ssWriteFB error', e); notifySyncWriteError(e.message); }
}

async function ssWriteOne(record) {
  if (!ssRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/safetyStock/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('ssWriteOne error', e); notifySyncWriteError(e.message); }
}
function ssPushOneIfReady(record) { if (ssReady) ssWriteOne(record); }

async function ssRemoveOne(id) {
  if (!ssRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/safetyStock/${id}`));
  } catch (e) { console.warn('ssRemoveOne error', e); notifySyncWriteError(e.message); }
}
function ssRemoveOneIfReady(id) { if (ssReady) ssRemoveOne(id); }

// รายการสินค้า sync ที่ /safetyStockItems (เขียนทั้งก้อน เพราะมีไม่กี่รายการ)
let ssItemsRef = null;
function ssApplyServerItems(serverItems) {
  ssItemsFbLoaded = true;
  const serverIds = new Set(serverItems.map(i => i.id));
  const localOnly = ssItems.filter(i => i && i.id && !serverIds.has(i.id) && !String(i.id).startsWith('SI_default_'));
  ssItems = serverItems.concat(localOnly);
  ssSaveItems();
  ssRefreshItemSelects();
  ssRenderAll();
  if (localOnly.length > 0) ssWriteItemsFB();
}
async function ssWriteItemsFB() {
  if (!ssItemsRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const o = {};
    ssItems.forEach(i => { o[i.id] = i; });
    o._schema = SS_ITEMS_SCHEMA; // ไม่ใช่ record (ไม่มี id) — ssObjToRecords กรองทิ้งเอง
    await set(ssItemsRef, o);
  } catch (e) { console.warn('ssWriteItemsFB error', e); notifySyncWriteError(e.message); }
}
function ssPushItemsIfReady() { if (ssReady) ssWriteItemsFB(); }

function ssWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function ssInit() {
  await ssWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    ssRef = ref(fbDb, '/safetyStock');
    ssItemsRef = ref(fbDb, '/safetyStockItems');
    const itemsSnap = await get(ssItemsRef);
    if (itemsSnap.exists()) ssApplyServerItems(ssObjToRecords(itemsSnap.val()));
    const snap = await get(ssRef);
    if (snap.exists()) ssApplyServer(ssObjToRecords(snap.val()));
    ssReady = true;
    if (!itemsSnap.exists() || itemsSnap.val()?._schema !== SS_ITEMS_SCHEMA) {
      ssMigrateItems();
      await ssWriteItemsFB();
    }
    onValue(ssItemsRef, s => { if (s.exists()) ssApplyServerItems(ssObjToRecords(s.val())); });
    if (!snap.exists() && safetyStock.length > 0) await ssWriteFB();
    onValue(ssRef, s => { if (s.exists()) ssApplyServer(ssObjToRecords(s.val())); });
  } catch (e) { console.warn('ssInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  ssRefreshItemSelects();
  ssRefreshLookupDropdowns();
  ssClearForm();
  ssRenderAll();
  ssInit();
});

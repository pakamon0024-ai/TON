// ===== ระบบเบิกจ่าย Stock Safety (สติ๊กเกอร์ / สายรัดชิ่ง / ไม้หนุนล้อ) =====
// เก็บเป็น "รายการเคลื่อนไหว" (รับเข้า / เบิกจ่าย) แล้วคำนวณยอดคงเหลือจากผลรวม ไม่เก็บยอดคงเหลือแยก
// เพื่อไม่ให้ตัวเลขเพี้ยนเวลาแก้ไข/ลบรายการย้อนหลัง
// เก็บ local ที่ key 'finflow_safety_stock' และ sync กับ Firebase ที่ /safetyStock (โครงสร้างเหมือน breakdown.js)

// ย้ายที่เก็บเป็น /safetyStockV2 + แคช key ใหม่: เครื่อง/แท็บที่ยังรันโค้ดรุ่นเก่า (ซึ่งเขียนทับทั้ง /safetyStock และไม่รู้จักป้ายลบ) จะเขียนไปที่เดิมโดยไม่กระทบข้อมูลชุดนี้
// ทำให้ "ลบแล้วกลับมา" จากเครื่องเก่าเกิดขึ้นไม่ได้ ข้อมูลชุดเก่าที่ /safetyStock ไม่ถูกอ่านอีก
const SS_FB_PATH = '/safetyStockV2';
const SS_CACHE_KEY = 'finflow_safety_stock_v2';
const SS_VERSION = 'v2';

// รายการสินค้า (เพิ่ม/ลบเองได้ในหน้าเว็บ) — 3 รายการตั้งต้นใช้ id คงที่ เพื่อไม่ให้เครื่องต่างๆ สร้างซ้ำกัน
// หมวดหลัก 3 หมวด — เลือกหมวดแล้วค่อยเลือกรายการย่อย (item.group / item.sub)
const SS_GROUPS = ['สติ๊กเกอร์', 'สายรัดชิ่ง', 'ไม้หนุนล้อ'];
const SS_OTHER_GROUP = 'อื่นๆ'; // รายการที่ไม่รู้หมวด (เช่น เพิ่มไว้รุ่นก่อนมีหมวด)
const SS_DEFAULT_ITEMS = [
  { id: 'SI_default_sc', group: 'สายรัดชิ่ง', sub: 'สายรัดชิ่ง', name: 'สายรัดชิ่ง', unit: 'คู่' },
  { id: 'SI_default_c', group: 'ไม้หนุนล้อ', sub: 'ไม้หนุนล้อ', name: 'ไม้หนุนล้อ', unit: 'คู่' },
  { id: 'SI_default_st1', group: 'สติ๊กเกอร์', sub: 'ประกอบการเอพีฯ', name: 'สติ๊กเกอร์ ประกอบการเอพีฯ', unit: 'แผ่น' },
  { id: 'SI_default_st2', group: 'สติ๊กเกอร์', sub: 'ประกอบการอำพล', name: 'สติ๊กเกอร์ ประกอบการอำพล', unit: 'แผ่น' },
  { id: 'SI_default_st3', group: 'สติ๊กเกอร์', sub: 'คาดหน้า', name: 'สติ๊กเกอร์ คาดหน้า', unit: 'แผ่น' },
  { id: 'SI_default_st4', group: 'สติ๊กเกอร์', sub: 'รูปโลก', name: 'สติ๊กเกอร์ รูปโลก', unit: 'แผ่น' },
  { id: 'SI_default_st5', group: 'สติ๊กเกอร์', sub: 'ตรวจสอบก่อนขึ้นขับ', name: 'สติ๊กเกอร์ ตรวจสอบก่อนขึ้นขับ', unit: 'แผ่น' },
  { id: 'SI_default_st6', group: 'สติ๊กเกอร์', sub: 'ห้ามโดยสาร', name: 'สติ๊กเกอร์ ห้ามโดยสาร', unit: 'แผ่น' },
  { id: 'SI_default_st7', group: 'สติ๊กเกอร์', sub: 'อย่าลืมล็อกกลอนประตูตู้', name: 'สติ๊กเกอร์ อย่าลืมล็อกกลอนประตูตู้', unit: 'แผ่น' },
  { id: 'SI_default_st8', group: 'สติ๊กเกอร์', sub: 'Q-Mark', name: 'สติ๊กเกอร์ Q-Mark', unit: 'แผ่น' },
  { id: 'SI_default_st9', group: 'สติ๊กเกอร์', sub: 'ISO', name: 'สติ๊กเกอร์ ISO', unit: 'แผ่น' },
];
// รุ่นแรกของแอปใช้ 3 รายการรวม (สติ๊กเกอร์ / สายรัดชิ่ง / ไม้หนุนล้อ) — ย้ายมาแบบแยกประเภทแล้ว
// รายการเก่าจะถูกเอาออกอัตโนมัติถ้ายังไม่มีประวัติรับเข้า/เบิกจ่ายอ้างถึง (ดู ssMigrateItems)
const SS_LEGACY_ITEM_IDS = ['SI_default_1', 'SI_default_2', 'SI_default_3', 'SI_default_h', 'SI_default_s']; // h/s = สายรัดชิ่งแยกหัว/สาย (เลิกใช้ เปลี่ยนเป็นหน่วย "คู่")
const SS_ITEMS_SCHEMA = 4;
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
cacheLoad(SS_CACHE_KEY).then(v => {
  if (ssFbLoaded || !Array.isArray(v)) return;
  safetyStock = v;
  if (document.readyState !== 'loading') ssRenderAll();
});
let ssEditingId = null;
let ssRef = null;
let ssReady = false;
// id ของรายการที่ถูกลบแล้ว (เก็บที่ /safetyStock/_deleted บน Firebase) — เครื่องที่ยังถือรายการเก่าไว้ในแคชจะไม่ดันรายการที่ถูกลบกลับขึ้น server
let ssDeleted = new Set();

function ssSave() { cacheSet(SS_CACHE_KEY, safetyStock); }
function ssSaveItems() { cacheSet('finflow_safety_items', ssItems); }
// หมวด/ชื่อย่อยของรายการ — รายการเก่าที่ยังไม่มีฟิลด์ group จะเดาจากชื่อที่ขึ้นต้นด้วยชื่อหมวด
function ssGroupOf(it) {
  if (it.group) return it.group;
  return SS_GROUPS.find(g => (it.name || '').startsWith(g)) || SS_OTHER_GROUP;
}
function ssSubOf(it) {
  if (it.sub) return it.sub;
  const g = ssGroupOf(it);
  const rest = (it.name || '').slice(g.length).replace(/^[\s(]+|[\s)]+$/g, '');
  return rest || it.name;
}
function ssGroupsInUse() {
  const extra = ssItems.some(it => ssGroupOf(it) === SS_OTHER_GROUP) ? [SS_OTHER_GROUP] : [];
  return SS_GROUPS.concat(extra);
}
function ssItemsOfGroup(group) { return ssItems.filter(it => ssGroupOf(it) === group); }
function ssGroupOfItemName(name) {
  const it = ssItems.find(i => i.name === name);
  return it ? ssGroupOf(it) : (SS_GROUPS.find(g => (name || '').startsWith(g)) || SS_OTHER_GROUP);
}
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
  ['summary', 'dashboard', 'list', 'add'].forEach(t => {
    document.getElementById(`ss-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`ss-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'summary') ssRenderSummary();
  if (tab === 'dashboard') { ssDashRefreshFilters(); ssRenderDashboard(); }
  if (tab === 'list') ssRenderList();
  if (tab === 'add' && !ssEditingId) ssClearForm();
}

function ssOnPageShown() {
  const ver = document.getElementById('ss-version'); if (ver) ver.textContent = `· ซิงก์ ${SS_VERSION}`; // ป้ายบอกเวอร์ชันโค้ดที่เครื่องนี้ใช้อยู่ (ถ้าไม่ขึ้น = ยังใช้โค้ดเก่า ให้ Ctrl+Shift+R)
  if (typeof mdApplyAdminOnlyVisibility === 'function') mdApplyAdminOnlyVisibility(); // ปุ่ม "ลบทั้งหมด" เห็นเฉพาะแอดมิน
  ssRefreshItemSelects();
  ssRefreshLookupDropdowns();
  ssRenderAll();
}

function ssRenderAll() {
  ssRenderSummary();
  ssRenderList();
  if (document.getElementById('ss-subpage-dashboard')?.classList.contains('active')) { ssDashRefreshFilters(); ssRenderDashboard(); }
}

// ===== Summary =====
function ssRenderSummary() {
  const wrap = document.getElementById('ss-balance-cards');
  if (!wrap) return;
  wrap.innerHTML = ssGroupsInUse().map(g => {
    const cards = ssItemsOfGroup(g).map(it => {
      const bal = ssBalance(it.name);
      // สถานะตามยอดคงเหลือ: หมด (<=0) / ใกล้หมด (<=10) / พร้อมใช้ — สีขอบบนและป้ายสถานะเปลี่ยนตาม
      const state = bal <= 0 ? 'out' : bal <= 10 ? 'low' : 'ok';
      const label = { out: 'หมดสต็อก', low: 'ใกล้หมด', ok: 'พร้อมใช้' }[state];
      return `<div class="ss-card ss-${state}" title="กดเพื่อดูประวัติรับเข้า/เบิกจ่ายของรายการนี้" onclick="ssShowItemHistory('${it.id}')">
        <div class="ss-card-name">${escapeHtml(ssSubOf(it))}</div>
        <div class="ss-card-qty"><span class="ss-card-num">${bal.toLocaleString()}</span><span class="ss-card-unit">${escapeHtml(it.unit)}</span></div>
        <div class="ss-card-status">${label}</div>
      </div>`;
    }).join('');
    const addBtn = g === SS_OTHER_GROUP ? '' :
      `<button class="btn-secondary ss-add-btn" onclick="ssAddItem('${escapeHtml(g)}')">➕ เพิ่มรายการย่อย</button>`;
    const icon = { 'สติ๊กเกอร์': '🏷️', 'สายรัดชิ่ง': '🔗', 'ไม้หนุนล้อ': '🛞' }[g] || '📦';
    return `<div class="ss-group">
      <div class="ss-group-head"><span class="ss-group-title">${icon} ${escapeHtml(g)}</span>${addBtn}</div>
      <div class="ss-card-grid">${cards || '<div class="empty-state">ยังไม่มีรายการย่อย</div>'}</div>
    </div>`;
  }).join('');

  // สรุปเบิกจ่ายรายเดือน (ปีปัจจุบัน) เฉพาะหมวดที่เลือก
  const sel = document.getElementById('ss-month-group');
  if (sel && !sel.options.length) {
    sel.innerHTML = ssGroupsInUse().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  }
  const group = sel ? sel.value : SS_GROUPS[0];
  const groupItems = ssItemsOfGroup(group);
  const year = String(new Date().getFullYear());
  const months = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const tbody = document.getElementById('ss-month-body');
  if (!tbody) return;
  const head = document.getElementById('ss-month-head');
  if (head) head.innerHTML = '<tr><th>เดือน</th>' + groupItems.map(it => `<th>${escapeHtml(ssSubOf(it))} (${escapeHtml(it.unit)})</th>`).join('') + '</tr>';
  tbody.innerHTML = months.map((m, idx) => {
    const prefix = `${year}-${String(idx + 1).padStart(2, '0')}`;
    const cells = groupItems.map(it => {
      const n = safetyStock
        .filter(r => r.type === SS_TYPE_OUT && r.item === it.name && (r.date || '').startsWith(prefix))
        .reduce((sum, r) => sum + (Number(r.qty) || 0), 0);
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
  // รายการที่ยังไม่มีหมวด (รุ่นก่อน) ใส่หมวด/ชื่อย่อยให้ ไม่แตะชื่อเดิมเพราะประวัติอ้างชื่อนี้อยู่
  ssItems = ssItems.map(i => i.group ? i : { ...i, group: ssGroupOf(i), sub: ssSubOf(i) });
  ssSaveItems();
  ssRefreshItemSelects();
  ssRenderAll();
}

// ===== จัดการรายการสินค้า (เพิ่ม/ลบเอง) =====
function ssFillItemSelect(id, group, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const list = group ? ssItemsOfGroup(group) : [];
  el.innerHTML = `<option value="">${placeholder}</option>` +
    list.map(it => `<option value="${escapeHtml(it.name)}">${escapeHtml(ssSubOf(it))}</option>`).join('');
  if (list.some(it => it.name === current)) el.value = current;
}

function ssFillGroupSelect(id, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  el.innerHTML = `<option value="">${placeholder}</option>` +
    ssGroupsInUse().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  if (ssGroupsInUse().includes(current)) el.value = current;
}

function ssRefreshItemSelects() {
  ssFillGroupSelect('ss-group', '-- เลือกหมวด --');
  ssFillItemSelect('ss-item', document.getElementById('ss-group')?.value, '-- เลือกรายการย่อย --');
  ssFillGroupSelect('ss-f-group', 'ทั้งหมด');
  ssFillItemSelect('ss-f-item', document.getElementById('ss-f-group')?.value, 'ทั้งหมด');
  const ms = document.getElementById('ss-month-group');
  if (ms) {
    const cur = ms.value;
    ms.innerHTML = ssGroupsInUse().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    if (ssGroupsInUse().includes(cur)) ms.value = cur;
  }
}

// เปลี่ยนหมวดในฟอร์ม -> โหลดรายการย่อยของหมวดนั้นขึ้นมา
function ssOnGroupChange() {
  ssFillItemSelect('ss-item', document.getElementById('ss-group').value, '-- เลือกรายการย่อย --');
  document.getElementById('ss-item').value = '';
  ssUpdateFormHints();
}

function ssOnFilterGroupChange() {
  ssFillItemSelect('ss-f-item', document.getElementById('ss-f-group').value, 'ทั้งหมด');
  const it = document.getElementById('ss-f-item');
  if (it) it.value = '';
  ssRenderList();
}

// เพิ่มรายการย่อยในหมวดที่ระบุ (ปุ่มในแต่ละหมวดของหน้ายอดคงเหลือ หรือปุ่ม + ในฟอร์ม ซึ่งใช้หมวดที่เลือกอยู่)
function ssAddItem(group) {
  group = group || document.getElementById('ss-group')?.value;
  if (!group) { showToast('เลือกหมวดก่อน แล้วค่อยเพิ่มรายการย่อย', 'warning'); return; }
  const sub = (prompt(`ชื่อรายการย่อยใหม่ในหมวด "${group}":`) || '').trim();
  if (!sub) return;
  const name = `${group} ${sub}`;
  if (ssItems.some(it => it.name === name)) { showToast('มีรายการนี้อยู่แล้ว', 'warning'); return; }
  const unit = (prompt(`หน่วยนับของ "${name}" (เช่น อัน, เส้น, แผ่น, คู่):`, ssItemsOfGroup(group)[0]?.unit || 'อัน') || '').trim();
  if (!unit) return;
  ssItems.push({ id: 'SI_' + Date.now(), group, sub, name, unit });
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
  let date = document.getElementById('ss-date').value;
  if (date) {
    const fx = ssNormalizeYear(date);
    if (!fx.ok) { showToast('ปีของวันที่ผิดปกติ ตรวจสอบอีกครั้ง (ใช้ปี ค.ศ. เช่น 2026)', 'warning'); return; }
    if (fx.converted) { showToast(`แปลงปี พ.ศ. ${date.slice(0, 4)} เป็น ค.ศ. ${fx.date.slice(0, 4)} ให้แล้ว`, 'warning'); date = fx.date; }
  }
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
  document.getElementById('ss-group').value = '';
  ssFillItemSelect('ss-item', '', '-- เลือกรายการย่อย --');
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
  document.getElementById('ss-group').value = ssGroupOfItemName(rec.item);
  ssFillItemSelect('ss-item', document.getElementById('ss-group').value, '-- เลือกรายการย่อย --');
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
  ssTombstone([id]);
  ssRenderAll();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function ssFilteredList() {
  const type = document.getElementById('ss-f-type')?.value || '';
  const item = document.getElementById('ss-f-item')?.value || '';
  const group = document.getElementById('ss-f-group')?.value || '';
  const month = document.getElementById('ss-f-month')?.value || '';
  const search = (document.getElementById('ss-f-search')?.value || '').toLowerCase().trim();
  return safetyStock.filter(i => {
    if (type && i.type !== type) return false;
    if (item && i.item !== item) return false;
    if (group && ssGroupOfItemName(i.item) !== group) return false;
    if (month && !(i.date || '').startsWith(month)) return false;
    if (search && !(`${i.receiver} ${i.plate} ${i.businessUnit} ${i.yard} ${i.note}`.toLowerCase().includes(search))) return false;
    return true;
  }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.runningNo || 0) - (a.runningNo || 0));
}

function ssClearListFilters() {
  ['ss-f-type', 'ss-f-group', 'ss-f-month', 'ss-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ssFillItemSelect('ss-f-item', '', 'ทั้งหมด');
  ssRenderList();
}

function ssRenderList() {
  const list = ssFilteredList();
  const tbody = document.getElementById('ss-list-body');
  const countEl = document.getElementById('ss-list-count');
  const pagerEl = document.getElementById('ss-list-pager');
  if (!tbody) return;
  if (countEl) {
    // เลือกรายการย่อยแล้วโชว์ยอดรวมรับเข้า/เบิก/คงเหลือ ไว้ตรวจว่ายอดในการ์ดมาจากไหน (รวมเฉพาะรายการที่ผ่านตัวกรองอยู่)
    const f = document.getElementById('ss-f-item')?.value;
    const sum = t => list.filter(r => r.type === t).reduce((s, r) => s + (Number(r.qty) || 0), 0);
    countEl.textContent = `ทั้งหมด ${list.length} รายการ` + (f ? ` · รับเข้า ${sum(SS_TYPE_IN).toLocaleString()} · เบิกจ่าย ${sum(SS_TYPE_OUT).toLocaleString()} · คงเหลือทั้งหมด ${ssBalance(f).toLocaleString()} ${ssUnit(f)}` : '');
  }
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
// คอลัมน์ Export = คอลัมน์ Template/Import เดียวกัน (Export แล้วนำกลับมา Import ได้) — ช่อง "หน่วย" ตอน Import ไม่ใช้
// เพราะหน่วยมาจากรายการสินค้าเสมอ; ไม่มีคอลัมน์เลขที่ เพราะระบบออกเลขเองตอนบันทึก
const SS_XLSX_HEADERS = ['วันที่', 'ประเภท', 'หมวด', 'รายการย่อย', 'จำนวน', 'หน่วย', 'ผู้เบิก', 'ทะเบียน', 'หน่วยงาน', 'ลานจอด', 'หมายเหตุ'];
const SS_XLSX_COLS = [14, 10, 14, 28, 10, 8, 18, 14, 16, 14, 30];

function ssExportExcel() {
  if (!safetyStock.length) { showToast('ไม่มีข้อมูลให้ Export', 'warning'); return; }
  const sorted = [...safetyStock].sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.runningNo || 0) - (b.runningNo || 0));
  const rows = [SS_XLSX_HEADERS, ...sorted.map(i => {
    const it = ssItems.find(x => x.name === i.item);
    return [formatDMY(i.date), i.type || '', it ? ssGroupOf(it) : ssGroupOfItemName(i.item), it ? ssSubOf(it) : (i.item || ''),
      i.qty, i.unit || '', i.receiver || '', i.plate || '', i.businessUnit || '', i.yard || '', i.note || ''];
  })];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = SS_XLSX_COLS.map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock Safety');
  XLSX.writeFile(wb, 'StockSafety_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  showToast('Export เรียบร้อย', 'success');
}

// Template: ชีทแรกเป็นตัวอย่างให้กรอก, ชีทที่สองเป็นรายการหมวด/รายการย่อยที่ใช้ได้ (ตอนนี้ในระบบ) ให้คัดลอกชื่อไปใช้
function ssDownloadTemplate() {
  const first = ssItems[0];
  const sample = [
    SS_XLSX_HEADERS,
    ['01/10/2026', 'รับเข้า', first ? ssGroupOf(first) : 'สติ๊กเกอร์', first ? ssSubOf(first) : 'ISO', 100, first ? first.unit : 'แผ่น', '', '', '', '', 'ยอดยกมา'],
    ['15/10/2026', 'เบิกจ่าย', first ? ssGroupOf(first) : 'สติ๊กเกอร์', first ? ssSubOf(first) : 'ISO', 5, first ? first.unit : 'แผ่น', 'สมชาย ใจดี', '70-1234', 'ABC', 'ABC', 'ตัวอย่างการเบิก'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(sample);
  ws['!cols'] = SS_XLSX_COLS.map(w => ({ wch: w }));
  const list = [['หมวด', 'รายการย่อย', 'หน่วย'], ...ssGroupsInUse().flatMap(g => ssItemsOfGroup(g).map(it => [g, ssSubOf(it), it.unit]))];
  const ws2 = XLSX.utils.aoa_to_sheet(list);
  ws2['!cols'] = [14, 30, 10].map(w => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Template');
  XLSX.utils.book_append_sheet(wb, ws2, 'รายการที่ใช้ได้');
  XLSX.writeFile(wb, 'Template_StockSafety.xlsx');
  showToast('ดาวน์โหลด Template เรียบร้อย', 'success');
}

// Import: ตรวจทุกแถวก่อน แถวที่ผิดจะถูกข้ามพร้อมแจ้งสาเหตุ; แถวที่ซ้ำกับของเดิมทุกช่อง (นำเข้าไฟล์เดิมซ้ำ) ข้ามเงียบๆ
// และก่อนบันทึกจริงจะตรวจยอดรวมหลังนำเข้า — ถ้ารายการไหนจะติดลบ ไม่นำเข้าอะไรเลย (กันเบิกเกินยอดผ่านไฟล์)
function ssImportExcel(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  // ต้องรอข้อมูลจาก server มาก่อน ไม่งั้นตรวจรายการซ้ำกับข้อมูลที่ยังโหลดไม่ครบ แล้วนำเข้าซ้ำ
  if (!ssReady) { showToast('ยังเชื่อมต่อฐานข้อมูลไม่เสร็จ รอสักครู่แล้วนำเข้าอีกครั้ง', 'warning'); evt.target.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      const str = v => String(v ?? '').trim();
      const errors = [];
      const parsed = [];
      let skippedDup = 0;
      const sigOf = ssRecordSig;
      // นับจำนวนที่มีอยู่แล้วต่อ signature (ไม่ใช้ Set) — แถวที่เหมือนกันเป๊ะ 2 แถวในไฟล์เดียวกัน (เช่น เบิกจำนวนเท่ากันวันเดียวกัน) เป็นรายการจริง 2 รายการ ต้องนำเข้าทั้งคู่
      // ข้ามเฉพาะแถวที่ซ้ำกับของที่บันทึกไว้แล้วในระบบ (กรณีนำเข้าไฟล์เดิมซ้ำ)
      const existing = new Map();
      safetyStock.forEach(r => { const k = sigOf(r); existing.set(k, (existing.get(k) || 0) + 1); });
      const occBase = new Map(existing); // จำนวนรายการเหมือนกันที่มีอยู่แล้วก่อนนำเข้า (ใช้ต่อเลขลำดับของ id)

      rows.slice(1).forEach((row, idx) => {
        const line = idx + 2;
        if (row.every(c => str(c) === '')) return;
        let date = normalizeImportDate(row[0]);
        if (date) {
          const fx = ssNormalizeYear(date);
          if (!fx.ok) { errors.push(`แถว ${line}: ปีของวันที่ผิดปกติ (${date})`); return; }
          date = fx.date; // ปี พ.ศ. ในไฟล์แปลงเป็น ค.ศ. ให้อัตโนมัติ
        }
        const type = str(row[1]);
        const group = str(row[2]), sub = str(row[3]);
        const qty = Number(row[4]);
        if (!date) { errors.push(`แถว ${line}: วันที่ไม่ถูกต้อง`); return; }
        if (type !== SS_TYPE_IN && type !== SS_TYPE_OUT) { errors.push(`แถว ${line}: ประเภทต้องเป็น "รับเข้า" หรือ "เบิกจ่าย"`); return; }
        const item = ssItems.find(it => ssGroupOf(it) === group && ssSubOf(it) === sub) ||
          ssItems.find(it => it.name === sub || it.name === `${group} ${sub}`);
        if (!item) { errors.push(`แถว ${line}: ไม่พบรายการ "${group} / ${sub}" (ดูชื่อที่ใช้ได้ในชีท "รายการที่ใช้ได้" ของ Template)`); return; }
        if (!Number.isInteger(qty) || qty <= 0) { errors.push(`แถว ${line}: จำนวนต้องเป็นจำนวนเต็มมากกว่า 0`); return; }
        const receiver = str(row[6]);
        if (type === SS_TYPE_OUT && !receiver) { errors.push(`แถว ${line}: เบิกจ่ายต้องระบุผู้เบิก`); return; }
        const isOut = type === SS_TYPE_OUT;
        const rec = {
          date, type, item: item.name, qty, unit: item.unit,
          receiver: isOut ? receiver : '', plate: isOut ? str(row[7]) : '',
          businessUnit: isOut ? str(row[8]) : '', yard: isOut ? str(row[9]) : '', note: str(row[10]),
        };
        const sig = sigOf(rec);
        if ((existing.get(sig) || 0) > 0) { existing.set(sig, existing.get(sig) - 1); skippedDup++; return; }
        parsed.push(rec);
      });

      // ตรวจยอดคงเหลือหลังนำเข้าทั้งชุด
      const delta = {};
      parsed.forEach(r => { delta[r.item] = (delta[r.item] || 0) + (r.type === SS_TYPE_IN ? 1 : -1) * r.qty; });
      const negative = Object.keys(delta).filter(name => ssBalance(name) + delta[name] < 0);
      if (negative.length) {
        showToast(`ไม่ได้นำเข้า: ยอดคงเหลือจะติดลบ — ${negative.join(', ')} (ใส่ "รับเข้า" ยอดตั้งต้นก่อน)`, 'error');
        evt.target.value = '';
        return;
      }
      if (!parsed.length) {
        showToast(errors.length ? `ไม่มีแถวที่นำเข้าได้ — ${errors[0]}` : `ไม่มีรายการใหม่ให้นำเข้า${skippedDup ? ` (ซ้ำของเดิม ${skippedDup} แถว)` : ''}`, 'warning');
        evt.target.value = '';
        return;
      }
      const note = (errors.length ? `\nข้าม ${errors.length} แถวที่ผิด:\n${errors.slice(0, 8).join('\n')}${errors.length > 8 ? '\n...' : ''}` : '') +
        (skippedDup ? `\nข้าม ${skippedDup} แถวที่ซ้ำกับของเดิม` : '');
      if (!confirm(`นำเข้า ${parsed.length} รายการ ใช่ไหม?${note}`)) { evt.target.value = ''; return; }

      parsed.sort((a, b) => a.date.localeCompare(b.date));
      // id ผูกกับเนื้อหาแถว (hash ของ signature + ลำดับที่ซ้ำ) ไม่สุ่ม — นำเข้าแถวเดิมจากอีกเครื่อง/แคชเก่า/ซ้ำอีกรอบ
      // จะได้ id เดิมและทับของเดิม ไม่เพิ่มเป็นรายการซ้ำ (id สุ่มทำให้ทุกครั้งที่นำเข้าได้รายการใหม่เสมอ)
      const occ = new Map(occBase);
      parsed.forEach(r => {
        const sig = sigOf(r);
        const n = (occ.get(sig) || 0) + 1;
        occ.set(sig, n);
        r.id = `SS_IMP_${ssHash(sig)}_${n}`;
        r.runningNo = ssNextRunningNo();
        r.createdAt = new Date().toISOString();
        safetyStock.unshift(r);
      });
      ssSave();
      ssWriteFB(parsed);
      ssRenderAll();
      showToast(`นำเข้า ${parsed.length} รายการ${errors.length ? ` (ข้าม ${errors.length} แถวที่ผิด)` : ''}`, errors.length ? 'warning' : 'success');
    } catch (err) { showToast('นำเข้าไม่ได้: ' + err.message, 'error'); }
    evt.target.value = '';
  };
  reader.readAsArrayBuffer(file);
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
// raw = snapshot.val() ของ /safetyStock ; มีคีย์พิเศษ _deleted (ป้ายรายการที่ถูกลบ) ปนอยู่กับรายการ
// รายการที่ถูกลบแล้วแต่ยังโผล่บน server (เครื่องเก่าดันกลับขึ้นไป) จะถูกกรองทิ้งและลบออกจาก server ซ้ำให้
function ssParseServer(raw) {
  ssDeleted = new Set(Object.keys((raw && raw._deleted) || {}));
  const all = ssObjToRecords(raw);
  const resurrected = all.filter(r => ssDeleted.has(r.id));
  if (resurrected.length) ssTombstone(resurrected.map(r => r.id));
  return all.filter(r => !ssDeleted.has(r.id));
}

function ssApplyServer(serverRecords) {
  ssFbLoaded = true;
  const serverIds = new Set(serverRecords.map(r => r.id));
  // รายการที่มีเฉพาะในเครื่อง = ยังไม่เคยขึ้น server (push ไม่สำเร็จ) ให้เก็บไว้ ยกเว้นที่ถูกลบไปแล้ว
  const localOnly = (safetyStock || []).filter(t => t && t.id && !serverIds.has(t.id) && !ssDeleted.has(t.id));
  safetyStock = serverRecords.concat(localOnly);
  ssSave();
  ssRenderAll();
  ssUpdateFormHints();
  if (localOnly.length > 0) ssWriteFB(localOnly);
}
// เขียนเฉพาะรายการที่ส่งมา (ไม่ใช่ set ทับทั้ง /safetyStock เพราะจะลบป้าย _deleted ทิ้งไปด้วย) และล้างป้าย "ถูกลบ" ของ id นั้นด้วย
async function ssWriteFB(records) {
  if (!ssRef) return;
  const list = (records || safetyStock).filter(r => r && r.id);
  if (!list.length) return;
  try {
    const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const updates = {};
    list.forEach(r => { updates[SS_FB_PATH + '/' + r.id] = r; updates[SS_FB_PATH + '/_deleted/' + r.id] = null; ssDeleted.delete(r.id); });
    await update(ref(fbDb), updates);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('ssWriteFB error', e); notifySyncWriteError(e.message); }
}

// ลบรายการออกจาก server และขึ้นป้าย _deleted กันเครื่องอื่นที่ยังถือรายการนี้ไว้ดันกลับขึ้นมา
async function ssTombstone(ids) {
  ids.forEach(id => ssDeleted.add(id));
  if (!ssRef || !ids.length) return;
  try {
    const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const updates = {};
    ids.forEach(id => { updates[SS_FB_PATH + '/' + id] = null; updates[SS_FB_PATH + '/_deleted/' + id] = true; });
    await update(ref(fbDb), updates);
  } catch (e) { console.warn('ssTombstone error', e); notifySyncWriteError(e.message); }
}

async function ssWriteOne(record) {
  if (!ssRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `${SS_FB_PATH}/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('ssWriteOne error', e); notifySyncWriteError(e.message); }
}
function ssPushOneIfReady(record) { if (ssReady) ssWriteOne(record); }


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
    ssRef = ref(fbDb, SS_FB_PATH);
    ssItemsRef = ref(fbDb, '/safetyStockItems');
    const itemsSnap = await get(ssItemsRef);
    if (itemsSnap.exists()) ssApplyServerItems(ssObjToRecords(itemsSnap.val()));
    const snap = await get(ssRef);
    if (snap.exists()) ssApplyServer(ssParseServer(snap.val()));
    ssReady = true;
    if (!itemsSnap.exists() || itemsSnap.val()?._schema !== SS_ITEMS_SCHEMA) {
      ssMigrateItems();
      await ssWriteItemsFB();
    }
    onValue(ssItemsRef, s => { if (s.exists()) ssApplyServerItems(ssObjToRecords(s.val())); });
    if (!snap.exists() && safetyStock.length > 0) await ssWriteFB();
    onValue(ssRef, s => { if (s.exists()) ssApplyServer(ssParseServer(s.val())); });
  } catch (e) { console.warn('ssInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  ssRefreshItemSelects();
  ssRefreshLookupDropdowns();
  ssClearForm();
  ssRenderAll();
  ssInit();
});

// กดการ์ดยอดคงเหลือ -> ไปแท็บรายการทั้งหมด กรองเฉพาะรายการย่อยนั้น เพื่อไล่ดูว่ายอดมาจากรายการไหนบ้าง
function ssShowItemHistory(itemId) {
  const it = ssItems.find(i => i.id === itemId);
  if (!it) return;
  ssSwitchTab('list');
  ['ss-f-type', 'ss-f-month', 'ss-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('ss-f-group').value = ssGroupOf(it);
  ssFillItemSelect('ss-f-item', ssGroupOf(it), 'ทั้งหมด');
  document.getElementById('ss-f-item').value = it.name;
  ssRenderList();
}

// ลบรายการรับเข้า/เบิกจ่ายทั้งหมด (เฉพาะแอดมิน + ใส่ PIN) — ไม่แตะรายการสินค้า (หมวด/รายการย่อย) ยอดทุกรายการจะกลับเป็น 0
// ต้องรอเชื่อม Firebase เสร็จก่อน ไม่งั้นลบแค่ในเครื่อง แล้วข้อมูลบน server จะไหลกลับมาทับตอนเชื่อมต่อได้
async function ssDeleteAll() {
  if (!safetyStock.length) { showToast('ไม่มีรายการให้ลบ', 'warning'); return; }
  if (!ssReady) { showToast('ยังเชื่อมต่อฐานข้อมูลไม่เสร็จ รอสักครู่แล้วลองอีกครั้ง (กันข้อมูลบน server ไหลกลับมา)', 'warning'); return; }
  if (!mdConfirmDeleteAll(`เบิกจ่าย Stock Safety (รับเข้า/เบิกจ่าย ${safetyStock.length} รายการ)`)) return;
  const ids = safetyStock.map(r => r.id);
  safetyStock = [];
  ssSave();
  // รวมรายการที่อยู่บน server ด้วย (อาจมีที่เครื่องนี้ยังไม่เห็น เช่นถูกเครื่องอื่นดันขึ้นไป) แล้วขึ้นป้าย "ถูกลบ" ทั้งหมด
  try {
    const { get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const snap = await get(ssRef);
    if (snap.exists()) Object.keys(snap.val()).filter(k => k !== '_deleted').forEach(k => ids.push(k));
  } catch (e) { console.warn('ssDeleteAll read error', e); }
  await ssTombstone([...new Set(ids)]);
  ssRenderAll();
  ssUpdateFormHints();
  showToast('ลบรายการเบิกจ่าย/รับเข้าทั้งหมดแล้ว', 'warning');
}

// ลายนิ้วมือของรายการ (ทุกช่องที่เป็นเนื้อหา ไม่รวม id/เลขที่) — ใช้ตรวจรายการซ้ำและสร้าง id ตอน Import
function ssRecordSig(r) {
  return [r.date, r.type, r.item, r.qty, r.receiver || '', r.plate || '', r.note || ''].join('|');
}
function ssHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// ลบรายการซ้ำ: "เลขที่ + เนื้อหาเหมือนกันทุกช่อง" = สำเนาของรายการเดียวกัน (รายการจริงแต่ละรายการมีเลขที่ไม่ซ้ำกัน
// ถึงเนื้อหาจะเหมือนกัน เช่น เบิก 3 คู่ 2 ครั้งในวันเดียว ก็ยังได้เลขที่คนละเลข จึงไม่ถูกลบ) เก็บชุดที่สร้างก่อนไว้ 1 รายการ
async function ssRemoveDuplicates() {
  if (!ssReady) { showToast('ยังเชื่อมต่อฐานข้อมูลไม่เสร็จ รอสักครู่แล้วลองอีกครั้ง', 'warning'); return; }
  const seen = new Set();
  const dups = [];
  [...safetyStock].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).forEach(r => {
    const key = `${r.runningNo}|${ssRecordSig(r)}`;
    if (seen.has(key)) dups.push(r); else seen.add(key);
  });
  if (!dups.length) { showToast('ไม่พบรายการซ้ำ', 'success'); return; }
  if (!confirm(`พบรายการซ้ำ ${dups.length} รายการ (เลขที่และเนื้อหาเหมือนกันทุกช่อง)\nลบส่วนที่ซ้ำออก เก็บไว้อย่างละ 1 รายการ ใช่ไหม?`)) return;

  const ids = new Set(dups.map(r => r.id));
  safetyStock = safetyStock.filter(r => !ids.has(r.id));
  ssSave();
  await ssTombstone([...ids]);
  ssRenderAll();
  ssUpdateFormHints();
  showToast(`ลบรายการซ้ำ ${dups.length} รายการแล้ว`, 'success');
}

// ===== แดชบอร์ด: รับเข้า/เบิกจ่ายรายเดือน, ตามหน่วยงาน, ตามลานจอด =====
// กรองด้วย "หมวด" เสมอ (ไม่มีตัวเลือกทั้งหมด) เพราะรายการต่างหมวดนับคนละหน่วย (แผ่น/คู่) รวมกันแล้วตัวเลขไม่มีความหมาย
// ภายในหมวดเดียวกันหน่วยเดียวกัน จึงรวมได้ และเลือกรายการย่อยเจาะลึกต่อได้
let ssCharts = {};
const SS_DASH_COLORS = {
  in:   { bg: 'rgba(34,197,94,0.85)',  border: '#22c55e' },
  out:  { bg: 'rgba(255,107,0,0.88)',  border: '#ff6b00' },
  unit: { bg: 'rgba(155,93,229,0.85)', border: '#9b5de5' },
  yard: { bg: 'rgba(6,214,160,0.88)',  border: '#06d6a0' },
};
const SS_MONTHS_TH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

function ssDestroyChart(key) { if (ssCharts[key]) { ssCharts[key].destroy(); delete ssCharts[key]; } }

function ssDashRefreshFilters() {
  const yearEl = document.getElementById('ss-dash-year');
  const groupEl = document.getElementById('ss-dash-group');
  if (!yearEl || !groupEl) return;
  const curYear = new Date().getFullYear();
  const years = new Set([curYear]);
  safetyStock.forEach(r => { const y = Number((r.date || '').slice(0, 4)); if (y > 2000 && y < 2100) years.add(y); });
  const prevYear = yearEl.value;
  yearEl.innerHTML = [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y + 543}</option>`).join('');
  yearEl.value = prevYear && years.has(Number(prevYear)) ? prevYear : String(curYear);
  const prevGroup = groupEl.value;
  groupEl.innerHTML = ssGroupsInUse().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  if (prevGroup && ssGroupsInUse().includes(prevGroup)) groupEl.value = prevGroup;
  ssDashFillItems();
}

function ssDashFillItems() {
  const itemEl = document.getElementById('ss-dash-item');
  const group = document.getElementById('ss-dash-group')?.value;
  if (!itemEl) return;
  const prev = itemEl.value;
  itemEl.innerHTML = '<option value="">ทุกรายการในหมวด</option>' +
    ssItemsOfGroup(group).map(it => `<option value="${escapeHtml(it.name)}">${escapeHtml(ssSubOf(it))}</option>`).join('');
  if (ssItemsOfGroup(group).some(it => it.name === prev)) itemEl.value = prev;
}

function ssDashOnGroupChange() { ssDashFillItems(); ssRenderDashboard(); }

function ssDashBar(canvasId, key, labels, datasets, rotation, showZero) {
  ssDestroyChart(key);
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  ssCharts[key] = new Chart(canvas, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: datasets.length > 1, labels: { font: { family: "'Kanit','Sarabun',sans-serif", size: 13 } } },
        datalabels: {
          display: true, anchor: 'end', align: 'end', color: '#1a2540',
          font: { family: "'Kanit','Sarabun',sans-serif", size: 12, weight: '700' },
          formatter: v => (v > 0 || (showZero && v === 0)) ? v.toLocaleString() : '',
        },
      },
      scales: {
        y: { beginAtZero: true, grace: '15%', grid: { color: 'rgba(10,31,56,0.07)' }, ticks: { color: '#3d4f6d', precision: 0 } },
        x: { grid: { display: false }, ticks: { color: '#3d4f6d', autoSkip: false, minRotation: rotation || 0, maxRotation: rotation || 0 } },
      },
    },
  });
}

function ssRenderDashboard() {
  const year = document.getElementById('ss-dash-year')?.value;
  const group = document.getElementById('ss-dash-group')?.value;
  if (!year || !group) return;
  const itemName = document.getElementById('ss-dash-item')?.value || '';
  const month = document.getElementById('ss-dash-month')?.value || ''; // '' = ทั้งปี (ใช้กับกราฟหน่วยงาน/ลานจอด และการ์ดสรุป)
  const names = new Set(itemName ? [itemName] : ssItemsOfGroup(group).map(i => i.name));
  const unit = itemName ? ssUnit(itemName) : (ssItemsOfGroup(group)[0]?.unit || '');
  const inGroup = safetyStock.filter(r => names.has(r.item));

  // กราฟสต็อกคงเหลือแยกแต่ละรายการย่อยในหมวด (ยอดปัจจุบัน ไม่ขึ้นกับปี/เดือนที่เลือก) สีแท่งตามสถานะเดียวกับการ์ด:
  // เขียว = พร้อมใช้ (>10), เหลือง = ใกล้หมด (1-10), แดง = หมด (0)
  const stockItems = ssItemsOfGroup(group);
  const stockVals = stockItems.map(it => ssBalance(it.name));
  const stockColor = v => v <= 0 ? 'rgba(239,68,68,0.88)' : v <= 10 ? 'rgba(245,158,11,0.9)' : 'rgba(34,197,94,0.85)';
  const stockUnit = stockItems[0]?.unit || '';
  ssDashBar('ss-chart-stock', 'stock', stockItems.map(it => ssSubOf(it)), [
    { label: `คงเหลือ (${stockUnit})`, data: stockVals, backgroundColor: stockVals.map(stockColor), borderRadius: 5 },
  ], stockItems.length > 4 ? 30 : 0, true);
  const stockTotalEl = document.getElementById('ss-chart-stock-total');
  if (stockTotalEl) stockTotalEl.textContent = `รวม ${stockVals.reduce((s, v) => s + v, 0).toLocaleString()} ${stockUnit}`;

  // กราฟรายเดือน: ทั้งปีที่เลือก รับเข้า vs เบิกจ่าย
  const monthIn = new Array(12).fill(0), monthOut = new Array(12).fill(0);
  inGroup.forEach(r => {
    if (!(r.date || '').startsWith(year + '-')) return;
    const mi = Number(r.date.slice(5, 7)) - 1;
    if (mi < 0 || mi > 11) return;
    (r.type === SS_TYPE_IN ? monthIn : monthOut)[mi] += Number(r.qty) || 0;
  });
  ssDashBar('ss-chart-month', 'month', SS_MONTHS_TH, [
    { label: `รับเข้า (${unit})`, data: monthIn, backgroundColor: SS_DASH_COLORS.in.bg, borderRadius: 5 },
    { label: `เบิกจ่าย (${unit})`, data: monthOut, backgroundColor: SS_DASH_COLORS.out.bg, borderRadius: 5 },
  ]);

  // ช่วงที่ใช้กับ KPI / หน่วยงาน / ลานจอด: ทั้งปี หรือเดือนที่เลือก
  const prefix = month ? `${year}-${month}` : `${year}-`;
  const period = inGroup.filter(r => (r.date || '').startsWith(prefix));
  const sum = list => list.reduce((s, r) => s + (Number(r.qty) || 0), 0);
  const totalIn = sum(period.filter(r => r.type === SS_TYPE_IN));
  const outs = period.filter(r => r.type === SS_TYPE_OUT);
  const totalOut = sum(outs);
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  // รายการที่ปีอยู่นอก 2000-2100 (เช่น ปี พ.ศ. ที่บันทึกลงช่อง ค.ศ.) ไม่ถูกนับในกราฟ แต่ยังนับในยอดคงเหลือ — เตือนให้แก้
  const badYear = safetyStock.filter(r => !/^(20\d\d|2100)/.test(r.date || '')).length;
  const warnEl = document.getElementById('ss-dash-warn');
  if (warnEl) {
    warnEl.style.display = badYear ? '' : 'none';
    warnEl.textContent = badYear ? `⚠️ มี ${badYear} รายการที่ปีของวันที่ผิดปกติ (เช่นปี พ.ศ.) จึงไม่แสดงในกราฟ — ไปที่แท็บ "รายการทั้งหมด" กดปุ่ม 📅 แก้ปี พ.ศ.` : '';
  }
  setText('ss-kpi-in', `${totalIn.toLocaleString()} ${unit}`);
  setText('ss-kpi-out', `${totalOut.toLocaleString()} ${unit}`);
  setText('ss-kpi-bal', `${[...names].reduce((s, n) => s + ssBalance(n), 0).toLocaleString()} ${unit}`);
  setText('ss-kpi-period', month ? `${SS_MONTHS_TH[Number(month) - 1]} ${Number(year) + 543}` : `ทั้งปี ${Number(year) + 543}`);

  // เบิกจ่ายตามหน่วยงาน / ลานจอด (เรียงมากไปน้อย; ไม่ได้ระบุ = "ไม่ระบุ")
  const countBy = field => {
    const map = {};
    outs.forEach(r => { const k = (r[field] || '').trim() || 'ไม่ระบุ'; map[k] = (map[k] || 0) + (Number(r.qty) || 0); });
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  };
  const bu = countBy('businessUnit');
  ssDashBar('ss-chart-unit', 'unit', bu.map(e => e[0]), [{ label: `เบิกจ่าย (${unit})`, data: bu.map(e => e[1]), backgroundColor: SS_DASH_COLORS.unit.bg, borderRadius: 5 }], 30);
  const yd = countBy('yard');
  ssDashBar('ss-chart-yard', 'yard', yd.map(e => e[0]), [{ label: `เบิกจ่าย (${unit})`, data: yd.map(e => e[1]), backgroundColor: SS_DASH_COLORS.yard.bg, borderRadius: 5 }], 30);
}

// ===== ปีของวันที่: กันพิมพ์ปี พ.ศ. ลงช่อง ค.ศ. =====
// ระบบเก็บวันที่เป็น ค.ศ. (2026) ถ้าพิมพ์/ไฟล์เป็น พ.ศ. (2569) แล้วเก็บตรงๆ รายการจะไปอยู่ปีอนาคต ไม่โผล่ในแดชบอร์ดของปีนี้
// ปี 2400-2700 ถือเป็น พ.ศ. แปลงเป็น ค.ศ. ให้ ; ปีที่อยู่นอก 2000-2100 หลังแปลง ถือว่าผิดปกติ ไม่รับ
function ssNormalizeYear(dateStr) {
  const y = Number(String(dateStr || '').slice(0, 4));
  if (y >= 2400 && y <= 2700) return { ok: true, converted: true, date: `${y - 543}${String(dateStr).slice(4)}` };
  if (!(y >= 2000 && y <= 2100)) return { ok: false };
  return { ok: true, converted: false, date: dateStr };
}

// แก้รายการที่บันทึกไว้แล้วให้ปี พ.ศ. กลายเป็น ค.ศ. (ปีอื่นที่ผิดปกติเกินเดา ให้แก้เองที่ปุ่ม "แก้ไข")
async function ssFixBuddhistYears() {
  if (!ssReady) { showToast('ยังเชื่อมต่อฐานข้อมูลไม่เสร็จ รอสักครู่แล้วลองอีกครั้ง', 'warning'); return; }
  const fixed = [];
  const odd = [];
  safetyStock.forEach(r => {
    const fx = ssNormalizeYear(r.date);
    if (!fx.ok) odd.push(r);
    else if (fx.converted) fixed.push({ rec: r, date: fx.date });
  });
  if (!fixed.length && !odd.length) { showToast('ไม่พบรายการที่ปีผิดปกติ', 'success'); return; }
  if (fixed.length && !confirm(`พบ ${fixed.length} รายการที่วันที่เป็นปี พ.ศ. (เช่น ${fixed[0].rec.date})\nแปลงเป็นปี ค.ศ. ให้ทั้งหมด ใช่ไหม?`)) return;
  const changed = fixed.map(f => {
    const idx = safetyStock.findIndex(r => r.id === f.rec.id);
    safetyStock[idx] = { ...safetyStock[idx], date: f.date, updatedAt: new Date().toISOString() };
    return safetyStock[idx];
  });
  if (changed.length) { ssSave(); await ssWriteFB(changed); ssRenderAll(); }
  showToast(`แปลงปี ${changed.length} รายการแล้ว` + (odd.length ? ` · ยังมี ${odd.length} รายการที่ปีผิดปกติ (เช่น ${odd[0].date}) กดแก้ไขทีละรายการ` : ''), odd.length ? 'warning' : 'success');
}

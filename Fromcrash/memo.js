// ===== MEMO — บันทึกข้อความแจ้งผู้บริหารรับทราบ (กรอกฟอร์ม -> ตัวอย่าง -> พิมพ์/Export PDF) =====
// เก็บ local ที่ key 'finflow_memos' และ sync กับ Firebase ที่ /memos (โครงสร้างเหมือน breakdown.js)
// หน้าตัวอย่างใช้ modal ร่วม (printModal) เหมือนเอกสารอื่น — ข้อควรระวังที่เรียนรู้จาก probation.js/style.css:
//  - capture จาก modalBody ตรงๆ (เหมือนใบสั่ง) เพื่อให้ตัดบรรทัดตรงกับพรีวิว — clone ออกนอก modal แล้วตัดบรรทัดเพี้ยน
//  - อย่าใช้ text-indent กับย่อหน้ายาว และอย่าใช้ flex กับโครงสร้างที่ต้องแม่น (ใช้ grid/table แทน)

let memos = [];
let mmFbLoaded = false; // ถ้า Firebase ส่งข้อมูลมาแล้ว แคชในเครื่องจะไม่ทับข้อมูลจริง
cacheLoad('finflow_memos').then(v => {
  if (mmFbLoaded || !Array.isArray(v)) return;
  memos = v;
  if (document.readyState !== 'loading') mmRenderList();
});
let mmEditingId = null;
let mmRef = null;
let mmReady = false;

const MM_DEFAULT_CLOSING = 'จึงเรียนมาเพื่อโปรดทราบ';
const MM_RECIPIENTS = ['ประธานกรรมการ', 'กรรมการผู้จัดการ', 'รองประธาน', 'ผู้จัดการทั่วไป', 'ผู้บริหารทุกท่าน'];
const MM_LAST_KEY = 'finflow_memo_last'; // จำ จาก/ผู้เสนอ/ตำแหน่ง/เรียน ที่ใช้ล่าสุด กรอกซ้ำทุกครั้งเสียเวลา

function mmSave() { cacheSet('finflow_memos', memos); }

function mmLoadLast() { try { return JSON.parse(localStorage.getItem(MM_LAST_KEY) || '{}'); } catch { return {}; } }
function mmRememberLast(r) {
  safeLocalStorageSet(MM_LAST_KEY, JSON.stringify({ from: r.from, to: r.to, requester: r.requester, position: r.position }));
}

// ===== Tabs =====
function mmSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`mm-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`mm-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') mmRenderList();
  if (tab === 'add' && !mmEditingId) mmClearForm();
}

function mmOnPageShown() {
  mmFillDatalists();
  mmRenderList();
}

// ในช่องเนื้อหา กด Tab = แทรก Tab (เยื้องย่อหน้า) แทนการย้ายโฟกัสไปช่องถัดไป; Shift+Tab ยังย้ายโฟกัสกลับได้ตามปกติ
document.addEventListener('keydown', e => {
  if (e.target?.id !== 'mm-body' || e.key !== 'Tab' || e.shiftKey) return;
  e.preventDefault();
  const t = e.target, start = t.selectionStart, end = t.selectionEnd;
  t.value = t.value.slice(0, start) + '\t' + t.value.slice(end);
  t.selectionStart = t.selectionEnd = start + 1;
});

function mmFillDatalists() {
  const el = document.getElementById('mm-to-list');
  if (el) el.innerHTML = MM_RECIPIENTS.map(n => `<option value="${escapeHtml(n)}">`).join('');
}

// ===== เลขที่เอกสาร: MEMO-ปี-001 (นับต่อปี) =====
function mmNextRunningNo() {
  return memos.length ? Math.max(...memos.map(m => m.runningNo || 0)) + 1 : 1;
}
function mmNextDocNo(dateStr) {
  const year = (dateStr || new Date().toISOString()).substring(0, 4);
  const used = memos.filter(m => (m.docno || '').startsWith(`MEMO-${year}-`)).length;
  return `MEMO-${year}-${String(used + 1).padStart(3, '0')}`;
}

// ===== Form =====
function mmReadForm() {
  const v = id => document.getElementById(id).value.trim();
  return {
    docno: v('mm-docno'), date: document.getElementById('mm-date').value, priority: document.getElementById('mm-priority').value,
    from: v('mm-from'), to: v('mm-to'), cc: v('mm-cc'), subject: v('mm-subject'),
    // ไม่ trim หน้าข้อความ — Tab/ช่องว่างที่ผู้ใช้เคาะไว้ต้นย่อหน้าแรกต้องเก็บไว้ (ตัดเฉพาะบรรทัดว่างหน้าสุดและช่องว่างท้ายสุด)
    body: document.getElementById('mm-body').value.replace(/^(\s*\n)+/, '').replace(/\s+$/, ''),
    attachments: v('mm-attach'), closing: v('mm-closing'),
    requester: v('mm-requester'), position: v('mm-position'),
    showAck: document.getElementById('mm-ack').checked,
  };
}

function mmValidate(r) {
  if (!r.date) { showToast('กรุณาระบุวันที่', 'warning'); return false; }
  if (!r.to) { showToast('กรุณาระบุผู้รับ (เรียน)', 'warning'); return false; }
  if (!r.subject) { showToast('กรุณาระบุเรื่อง', 'warning'); return false; }
  if (!r.body) { showToast('กรุณาระบุเนื้อหา', 'warning'); return false; }
  return true;
}

function mmSaveCase() {
  const r = mmReadForm();
  if (!mmValidate(r)) return;
  if (!r.docno) r.docno = mmNextDocNo(r.date);
  if (memos.some(m => m.docno === r.docno && m.id !== mmEditingId)) { showToast('เลขที่เอกสารนี้ถูกใช้แล้ว', 'error'); return; }

  let saved;
  if (mmEditingId) {
    const idx = memos.findIndex(m => m.id === mmEditingId);
    if (idx >= 0) { memos[idx] = { ...memos[idx], ...r, updatedAt: new Date().toISOString() }; saved = memos[idx]; }
    showToast('บันทึกการแก้ไขแล้ว', 'success');
  } else {
    saved = { ...r, id: 'MM_' + Date.now(), runningNo: mmNextRunningNo(), createdAt: new Date().toISOString() };
    memos.unshift(saved);
    showToast('บันทึก MEMO แล้ว', 'success');
  }
  mmRememberLast(r);
  mmSave();
  if (saved) mmPushOneIfReady(saved);
  mmClearForm();
  mmSwitchTab('list');
}

function mmClearForm() {
  mmEditingId = null;
  const last = mmLoadLast();
  document.getElementById('mm-edit-banner').style.display = 'none';
  const today = new Date();
  const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  document.getElementById('mm-date').value = iso;
  document.getElementById('mm-docno').value = '';
  document.getElementById('mm-docno').placeholder = `เว้นว่าง = ออกเลขให้อัตโนมัติ (${mmNextDocNo(iso)})`;
  document.getElementById('mm-priority').value = 'ปกติ';
  document.getElementById('mm-from').value = last.from || '';
  document.getElementById('mm-to').value = last.to || '';
  document.getElementById('mm-cc').value = '';
  document.getElementById('mm-subject').value = '';
  document.getElementById('mm-body').value = '';
  document.getElementById('mm-attach').value = '';
  document.getElementById('mm-closing').value = MM_DEFAULT_CLOSING;
  document.getElementById('mm-requester').value = last.requester || '';
  document.getElementById('mm-position').value = last.position || '';
  document.getElementById('mm-ack').checked = true;
}

function mmEditCase(id) {
  const m = memos.find(x => x.id === id);
  if (!m) return;
  mmSwitchTab('add');
  mmEditingId = id;
  document.getElementById('mm-edit-banner').style.display = 'flex';
  document.getElementById('mm-edit-no').textContent = m.docno;
  document.getElementById('mm-docno').value = m.docno || '';
  document.getElementById('mm-date').value = m.date || '';
  document.getElementById('mm-priority').value = m.priority || 'ปกติ';
  document.getElementById('mm-from').value = m.from || '';
  document.getElementById('mm-to').value = m.to || '';
  document.getElementById('mm-cc').value = m.cc || '';
  document.getElementById('mm-subject').value = m.subject || '';
  document.getElementById('mm-body').value = m.body || '';
  document.getElementById('mm-attach').value = m.attachments || '';
  document.getElementById('mm-closing').value = m.closing || '';
  document.getElementById('mm-requester').value = m.requester || '';
  document.getElementById('mm-position').value = m.position || '';
  document.getElementById('mm-ack').checked = m.showAck !== false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function mmCancelEdit() { mmClearForm(); }

function mmDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบ MEMO นี้?')) return;
  memos = memos.filter(m => m.id !== id);
  mmSave();
  mmRemoveOneIfReady(id);
  mmRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List =====
function mmRenderList() {
  const search = (document.getElementById('mm-f-search')?.value || '').toLowerCase().trim();
  const list = memos.filter(m => !search || `${m.docno} ${m.subject} ${m.to} ${m.from} ${m.body}`.toLowerCase().includes(search))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.runningNo || 0) - (a.runningNo || 0));
  const tbody = document.getElementById('mm-list-body');
  const countEl = document.getElementById('mm-list-count');
  const pagerEl = document.getElementById('mm-list-pager');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มี MEMO</td></tr>';
    if (pagerEl) pagerEl.innerHTML = '';
    return;
  }
  const { pageItems, page, totalPages, total } = paginateSlice('mm-list', list);
  if (pagerEl) pagerEl.innerHTML = paginatePagerHtml('mm-list', page, totalPages, total, 'mmRenderList');
  tbody.innerHTML = pageItems.map(m => `
    <tr>
      <td>${escapeHtml(m.docno)}</td>
      <td>${formatDate(m.date)}</td>
      <td>${escapeHtml(m.to || '-')}</td>
      <td>${escapeHtml(m.subject)}</td>
      <td>${m.priority && m.priority !== 'ปกติ' ? `<span class="badge badge-orange">${escapeHtml(m.priority)}</span>` : 'ปกติ'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="action-btn" onclick="mmShowPrint('${m.id}')">🖨️ พิมพ์</button>
          <button class="action-btn action-view" onclick="mmEditCase('${m.id}')">แก้ไข</button>
          <button class="action-btn action-delete" onclick="mmDeleteCase('${m.id}')">ลบ</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ===== เอกสาร (ตัวอย่าง / พิมพ์ / PDF) =====
function mmThaiLongDate(val) {
  const monthsTh = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const d = val ? new Date(val) : new Date();
  if (isNaN(d)) return '';
  return `${d.getDate()} ${monthsTh[d.getMonth()]} พ.ศ. ${d.getFullYear() + 543}`;
}

function mmBuildDoc(m) {
  // ทุกย่อหน้าเริ่มด้วยการเยื้องบรรทัดแรก (3 em ≈ 1 Tab) ใช้ตัวอักษร em-space แทน text-indent เพราะ html2canvas
  // วาดย่อหน้ายาวที่ใช้ text-indent เพี้ยน; Tab/ช่องว่างที่ผู้ใช้เคาะไว้หน้าย่อหน้าจะเยื้องเพิ่มจากฐานนี้
  const paragraphs = String(m.body || '').split(/\n+/).map(s => s.replace(/\s+$/, '')).filter(s => s.trim())
    .map(s => {
      const lead = s.match(/^[ \t]*/)[0];
      const extra = lead.replace(/\t/g, '&emsp;&emsp;&emsp;').replace(/ /g, '&nbsp;');
      return `<p class="print-body-text mm-para">&emsp;&emsp;&emsp;${extra}${escapeHtml(s.slice(lead.length))}</p>`;
    }).join('');
  const urgent = m.priority && m.priority !== 'ปกติ' ? `<div class="mm-priority">${escapeHtml(m.priority)}</div>` : '';
  const ack = m.showAck === false ? '' : `
    <div class="mm-ack-box">
      <div class="mm-ack-title">ผู้บริหารรับทราบ / สั่งการ</div>
      <div class="mm-ack-lines">${Array(3).fill('<div class="mm-ack-line"></div>').join('')}</div>
      <div class="mm-ack-sig"><div>ลงชื่อ ${'.'.repeat(30)} &nbsp;ผู้บริหาร</div><div>วันที่ ........../............../..........</div></div>
    </div>`;
  return `
    <div class="print-doc mm-memo-doc">
      ${companyLetterhead()}
      ${urgent}
      <h1>บันทึกข้อความ</h1>
      <table class="mm-head">
        <tr><td class="mm-k">ที่</td><td>${escapeHtml(m.docno || '')}</td><td class="mm-k" style="text-align:right;">วันที่ ${mmThaiLongDate(m.date)}</td></tr>
        <tr><td class="mm-k">จาก</td><td colspan="2">${escapeHtml(m.from || '-')}</td></tr>
        <tr><td class="mm-k">เรียน</td><td colspan="2">${escapeHtml(m.to || '-')}</td></tr>
        ${m.cc ? `<tr><td class="mm-k">สำเนาเรียน</td><td colspan="2">${escapeHtml(m.cc)}</td></tr>` : ''}
        <tr><td class="mm-k">เรื่อง</td><td colspan="2" style="font-weight:700;">${escapeHtml(m.subject || '')}</td></tr>
      </table>
      <hr class="print-divider" />
      ${paragraphs}
      ${m.attachments ? `<p class="print-body-text mm-para" style="margin-top:14px;">สิ่งที่แนบมาด้วย: ${escapeHtml(m.attachments)}</p>` : ''}
      ${m.closing ? `<p class="print-body-text mm-para" style="margin-top:16px;">${escapeHtml(m.closing)}</p>` : ''}
      <div class="mm-sender">
        <div class="mm-sender-line">ลงชื่อ ${'.'.repeat(34)}</div>
        <div>( ${escapeHtml(m.requester || '..................................')} )</div>
        <div>${escapeHtml(m.position || '')}</div>
      </div>
      ${ack}
    </div>
  `;
}

// ตัวอย่างจากข้อมูลในฟอร์ม (ยังไม่ต้องบันทึก)
function mmPreviewForm() {
  const r = mmReadForm();
  if (!mmValidate(r)) return;
  if (!r.docno) r.docno = mmNextDocNo(r.date);
  mmOpenPrint(r);
}

function mmShowPrint(id) {
  const m = memos.find(x => x.id === id);
  if (m) mmOpenPrint(m);
}

function mmOpenPrint(m) {
  document.getElementById('modalTitle').textContent = `MEMO - ${m.docno}`;
  document.getElementById('modalBody').innerHTML = mmBuildDoc(m);
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    // capture จาก modalBody ตรงๆ เหมือนใบสั่ง/อนุมัติสำรองจ่าย — ตัวที่ clone ออกไปนอก modal (แบบ probation.js)
    // ทำให้ความกว้างเลย์เอาต์ต่างจากที่เห็นในพรีวิว ข้อความเลยตัดบรรทัดคนละที่กับตัวอย่าง
    html2pdf().set({
      margin: [8, 8, 8, 8],
      filename: `MEMO_${m.docno}.pdf`,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'avoid-all'] },
    }).from(document.getElementById('modalBody')).save();
  };
}

// ===== Firebase Sync =====
function mmRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function mmObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
// เก็บรายการที่มีเฉพาะในเครื่อง (ยัง push ไม่สำเร็จ) ไว้ ไม่ให้ข้อมูลจาก server ทับหาย แล้ว sync ขึ้นไปทันที
function mmApplyServer(serverRecords) {
  mmFbLoaded = true;
  const serverIds = new Set(serverRecords.map(r => r.id));
  const localOnly = (memos || []).filter(t => t && t.id && !serverIds.has(t.id));
  memos = serverRecords.concat(localOnly);
  mmSave();
  mmRenderList();
  if (localOnly.length > 0) mmWriteFB();
}
async function mmWriteFB() {
  if (!mmRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(mmRef, mmRecordsToObj(memos));
  } catch (e) { console.warn('mmWriteFB error', e); notifySyncWriteError(e.message); }
}
async function mmWriteOne(record) {
  if (!mmRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/memos/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('mmWriteOne error', e); notifySyncWriteError(e.message); }
}
function mmPushOneIfReady(record) { if (mmReady) mmWriteOne(record); }
async function mmRemoveOne(id) {
  if (!mmRef) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/memos/${id}`));
  } catch (e) { console.warn('mmRemoveOne error', e); notifySyncWriteError(e.message); }
}
function mmRemoveOneIfReady(id) { if (mmReady) mmRemoveOne(id); }

function mmWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function mmInit() {
  await mmWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    mmRef = ref(fbDb, '/memos');
    const snap = await get(mmRef);
    if (snap.exists()) mmApplyServer(mmObjToRecords(snap.val()));
    mmReady = true;
    if (!snap.exists() && memos.length > 0) await mmWriteFB();
    onValue(mmRef, s => { if (s.exists()) mmApplyServer(mmObjToRecords(s.val())); });
  } catch (e) { console.warn('mmInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  mmFillDatalists();
  mmClearForm();
  mmRenderList();
  mmInit();
});

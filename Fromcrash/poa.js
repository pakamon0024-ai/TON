// ===== หนังสือมอบอำนาจ =====
// บันทึกรวมใน "ประวัติรายการ" (records ของ app.js, type 'poa') แบบเดียวกับใบรับรองแทนใบเสร็จ: ข้อมูลฟอร์มอยู่ใน record.data

let editingPoaId = null;

const POA_PERSON_FIELDS = ['name', 'age', 'race', 'nationality', 'house', 'moo', 'subdistrict', 'district', 'province'];
const POA_TEXT_FIELDS = ['docno', 'place', 'place2', 'date', 'matter', 'witness1', 'witness2'];
const POA_TH_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

function poaVal(id) { return (document.getElementById(id)?.value || '').trim(); }
function poaSet(id, v) { const el = document.getElementById(id); if (el) el.value = v || ''; }

function getPoaData() {
  const data = {};
  POA_TEXT_FIELDS.forEach(f => { data[f] = poaVal(`poa-${f}`); });
  ['grantor', 'grantee'].forEach(who => {
    data[who] = {};
    POA_PERSON_FIELDS.forEach(f => { data[who][f] = poaVal(`poa-${who}-${f}`); });
  });
  return data;
}

function poaFillForm(data) {
  POA_TEXT_FIELDS.forEach(f => poaSet(`poa-${f}`, data[f]));
  ['grantor', 'grantee'].forEach(who => {
    POA_PERSON_FIELDS.forEach(f => poaSet(`poa-${who}-${f}`, (data[who] || {})[f]));
  });
}

function poaNextDocNo() {
  const now = new Date();
  const prefix = `POA-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const nums = records.filter(r => r.type === 'poa' && String(r.docno || '').startsWith(prefix))
    .map(r => parseInt(String(r.docno).slice(prefix.length), 10) || 0);
  return prefix + String(Math.max(0, ...nums) + 1).padStart(3, '0');
}

function poaResetForm() {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  poaFillForm({
    docno: poaNextDocNo(), date: today,
    grantor: { race: 'ไทย', nationality: 'ไทย' }, grantee: { race: 'ไทย', nationality: 'ไทย' },
  });
}

function poaOnPageShown() {
  // เลขที่เอกสารอาจเปลี่ยนหลังซิงค์ประวัติจากเครื่องอื่น — อัปเดตเฉพาะตอนที่ยังไม่ได้เริ่มกรอก
  if (!editingPoaId && !poaVal('poa-grantor-name') && !poaVal('poa-matter')) poaSet('poa-docno', poaNextDocNo());
}

function savePoa() {
  const data = getPoaData();
  if (!data.docno || !data.grantor.name || !data.grantee.name || !data.matter) {
    showToast('กรุณากรอก เลขที่เอกสาร, ชื่อผู้มอบอำนาจ, ชื่อผู้รับมอบอำนาจ และเรื่องที่มอบอำนาจ', 'error'); return;
  }
  const summary = { docno: data.docno, date: data.date, requester: data.grantor.name, total: 0, data };
  let savedRecord;
  if (editingPoaId) {
    const idx = records.findIndex(r => r.id === editingPoaId);
    if (idx >= 0) { records[idx] = { ...records[idx], ...summary }; savedRecord = records[idx]; }
    showToast('✅ แก้ไขหนังสือมอบอำนาจแล้ว!', 'success');
    cancelEditPoa();
  } else {
    savedRecord = { id: Date.now(), type: 'poa', ...summary, status: 'pending', savedAt: new Date().toISOString() };
    records.unshift(savedRecord);
    showToast('✅ บันทึกหนังสือมอบอำนาจแล้ว!', 'success');
    poaSet('poa-docno', poaNextDocNo());
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `📜 <b>บันทึกหนังสือมอบอำนาจใหม่</b>\nเลขที่: ${escapeHtml(savedRecord.docno)}\nผู้มอบอำนาจ: ${escapeHtml(data.grantor.name)}\nผู้รับมอบอำนาจ: ${escapeHtml(data.grantee.name)}`
      );
    }
  }
  saveRecords();
  if (savedRecord && typeof rcsPushOneIfReady === 'function') rcsPushOneIfReady(savedRecord);
  renderDashboard();
  renderHistory();
}

function clearPoa() {
  poaResetForm();
  showToast('ล้างข้อมูลแล้ว', 'warning');
}

function loadPoaForEdit(rec) {
  editingPoaId = rec.id;
  poaFillForm(rec.data || {});
  document.getElementById('poa-edit-docno').textContent = rec.docno || '';
  document.getElementById('poa-edit-banner').style.display = 'flex';
  showToast('โหลดข้อมูลเพื่อแก้ไขแล้ว', 'success');
}

function cancelEditPoa() {
  editingPoaId = null;
  document.getElementById('poa-edit-banner').style.display = 'none';
  poaResetForm();
}

// ===== เอกสารสำหรับพิมพ์ / Export PDF — จัดวางตามแบบฟอร์มต้นฉบับ (ช่องว่างเป็นเส้นประไว้เขียนมือ) =====
// ช่องเติมคำ: ป้ายชื่อกว้างพอดีข้อความ ส่วนช่องค่ายืดตามสัดส่วน w
function poaRow(parts, cls) {
  return `<div class="poa-row ${cls || ''}">` + parts.map(p => typeof p === 'string'
    ? `<span class="poa-lbl">${p}</span>`
    : `<span class="poa-fill" style="flex:${p.w || 1} 1 0">${escapeHtml(p.v || '')}</span>`).join('') + '</div>';
}

// ตัดข้อความเรื่องที่มอบอำนาจเป็นบรรทัดตามความกว้างจริง เพื่อให้ทุกบรรทัดมีเส้นประรองรับ
function poaWrapText(text, firstWidth, restWidth) {
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = "15px 'Sarabun', sans-serif";
  const split = s => (typeof Intl !== 'undefined' && Intl.Segmenter)
    ? Array.from(new Intl.Segmenter('th', { granularity: 'word' }).segment(s), x => x.segment)
    : s.split(/(\s+)/);
  const lines = [];
  String(text || '').split(/\r?\n/).forEach(paragraph => {
    let line = '';
    split(paragraph).forEach(word => {
      const max = lines.length === 0 ? firstWidth : restWidth;
      if (line && ctx.measureText(line + word).width > max) { lines.push(line.trim()); line = word; }
      else line += word;
    });
    if (line.trim()) lines.push(line.trim());
  });
  while (lines.length < 2) lines.push('');
  return lines;
}

function poaPersonRows(p) {
  return poaRow(['อายุ', { v: p.age, w: 1 }, 'ปี เชื้อชาติ', { v: p.race, w: 1.4 }, 'สัญชาติ', { v: p.nationality, w: 1.3 }, 'อยู่บ้านเลขที่', { v: p.house, w: 1.4 }, 'หมู่', { v: p.moo, w: 1 }])
    + poaRow(['แขวง/ตำบล', { v: p.subdistrict }, 'เขต/อำเภอ', { v: p.district, w: 1.2 }, 'จังหวัด', { v: p.province, w: 1.1 }]);
}

function poaSignBlock(role, name) {
  return `<div class="poa-sign">
    ${poaRow(['ลงชื่อ', { v: '' }, role])}
    ${poaRow(['(', { v: name }, ') ตัวบรรจง'], 'poa-sign-name')}
  </div>`;
}

function buildPoaDoc(data) {
  const g = data.grantor || {}, r = data.grantee || {};
  const [y, m, d] = String(data.date || '').split('-');
  const day = d ? String(Number(d)) : '', month = m ? POA_TH_MONTHS[Number(m) - 1] : '', year = y ? String(Number(y) + 543) : '';
  const matter = poaWrapText(data.matter, 500, 660);
  return `
    <div class="print-doc poa-doc">
      <div class="poa-title">หนังสือมอบอำนาจ</div>
      <div class="poa-head">
        ${poaRow(['เขียนที่', { v: data.place }])}
        ${poaRow([{ v: data.place2 }])}
        ${poaRow(['วันที่', { v: day, w: 1 }, 'เดือน', { v: month, w: 2.6 }, 'พ.ศ.', { v: year, w: 1.2 }])}
      </div>
      ${poaRow(['โดยหนังสือฉบับนี้ ข้าพเจ้า', { v: g.name }], 'poa-indent poa-gap')}
      ${poaPersonRows(g)}
      ${poaRow(['ได้มอบอำนาจให้', { v: r.name }], 'poa-indent')}
      ${poaPersonRows(r)}
      ${poaRow(['เป็นผู้มีอำนาจจัดการ', { v: matter[0] }], 'poa-indent poa-gap poa-left')}
      ${matter.slice(1).map(line => poaRow([{ v: line }], 'poa-left')).join('')}
      <div class="poa-para">แทนข้าพเจ้าจนเสร็จการ และข้าพเจ้ายอมรับผิดชอบในการที่ผู้รับมอบอำนาจได้ทำไปตามที่มอบอำนาจนี้<br>เสมือนหนึ่งข้าพเจ้าได้ทำการด้วยตนเอง เพื่อเป็นหลักฐานข้าพเจ้าได้ลงลายมือชื่อหรือพิมพ์ลายนิ้วมือไว้เป็น<br>สำคัญต่อหน้าพยานแล้ว</div>
      ${poaSignBlock('ผู้มอบอำนาจ', g.name)}
      ${poaSignBlock('ผู้รับมอบอำนาจ', r.name)}
      ${poaSignBlock('พยาน', data.witness1)}
      ${poaSignBlock('พยาน', data.witness2)}
    </div>
  `;
}

function showPoaPrint(data) {
  document.getElementById('modalTitle').textContent = `หนังสือมอบอำนาจ - ${data.docno || ''}`;
  document.getElementById('modalBody').innerHTML = buildPoaDoc(data);
  document.getElementById('printModal').classList.add('show');
  currentPrintFn = () => {
    savePdfOnePage(document.getElementById('modalBody'), `หนังสือมอบอำนาจ_${data.docno || ''}.pdf`);
  };
}

// รอฟอนต์ Sarabun โหลดก่อน เพื่อให้การวัดความกว้างตอนตัดบรรทัดตรงกับที่แสดงจริง
async function printPoa() {
  const data = getPoaData();
  try { await document.fonts.load("15px 'Sarabun'", 'กขค'); } catch (e) {}
  showPoaPrint(data);
}

document.addEventListener('DOMContentLoaded', poaResetForm);

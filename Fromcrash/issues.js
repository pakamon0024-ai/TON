// ===== ระบบบันทึกปัญหาการทำงาน =====
// เก็บ local ที่ localStorage key 'finflow_work_issues' และ sync กับ Firebase ที่ /workIssues
// (ใช้ Firebase connection เดียวกับ claims.js — fbDb/fbReady)
// หัวข้อปัญหาเป็นรายการที่จัดการได้เอง (mdIssueTopics ใน masterdata.js) เลือกจาก dropdown
// หรือกดปุ่ม "+" ในฟอร์มเพื่อเพิ่มหัวข้อใหม่ทันทีโดยไม่ต้องไปหน้าฐานข้อมูลหลัก

let workIssues = JSON.parse(localStorage.getItem('finflow_work_issues') || '[]');
let wiEditingId = null;
let wiRef = null;
let wiReady = false;

function wiSave() { localStorage.setItem('finflow_work_issues', JSON.stringify(workIssues)); }

// ===== Sub-tabs =====
function wiSwitchTab(tab) {
  ['list', 'add'].forEach(t => {
    document.getElementById(`wi-tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`wi-subpage-${t}`).classList.toggle('active', t === tab);
  });
  if (tab === 'list') wiRenderList();
  if (tab === 'add' && !wiEditingId) wiClearForm();
}

function wiOnPageShown() {
  wiRefreshLookupDropdowns();
  wiRenderList();
}

// ===== Lookup dropdown (หัวข้อปัญหา จาก masterdata.js) =====
function wiFillSelect(id, list) {
  const el = document.getElementById(id);
  if (!el) return;
  const current = el.value;
  const placeholder = el.options[0]?.outerHTML || '<option value="">-- เลือก --</option>';
  el.innerHTML = placeholder + (list || []).map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
  if (list && list.includes(current)) el.value = current;
}
function wiRefreshLookupDropdowns() {
  wiFillSelect('wi-topic', mdIssueTopics);
  wiFillSelect('wi-f-topic', mdIssueTopics);
}

function wiQuickAddTopic() {
  const name = (prompt('เพิ่มหัวข้อปัญหาใหม่:') || '').trim();
  if (!name) return;
  if (typeof addIssueTopicDB !== 'function') return;
  const input = document.getElementById('md-topic-name');
  if (input) {
    input.value = name;
    addIssueTopicDB();
  } else {
    // fallback หากยังไม่เคยเข้าหน้าฐานข้อมูลหลัก (input ไม่ถูกสร้างใน DOM)
    if (!mdIssueTopics.includes(name)) {
      mdIssueTopics.push(name);
      saveIssueTopicsDB();
      wiRefreshLookupDropdowns();
      if (typeof mdPushIfReady === 'function') mdPushIfReady();
    }
  }
  const sel = document.getElementById('wi-topic');
  if (sel) sel.value = name;
}

// ===== Running number =====
function wiNextRunningNo() {
  return workIssues.length ? Math.max(...workIssues.map(i => i.runningNo || 0)) + 1 : 1;
}

// ===== Save / Edit / Delete =====
function wiSaveCase() {
  const date = document.getElementById('wi-date').value;
  const topic = document.getElementById('wi-topic').value.trim();
  const reporter = document.getElementById('wi-reporter').value.trim();
  const detail = document.getElementById('wi-detail').value.trim();

  if (!date) { showToast('กรุณาระบุวันที่แจ้งปัญหา', 'warning'); return; }
  if (!topic) { showToast('กรุณาเลือกหัวข้อปัญหา', 'warning'); return; }
  if (!detail) { showToast('กรุณาระบุรายละเอียดปัญหา', 'warning'); return; }

  const record = {
    date, topic, reporter,
    detail,
    status: document.getElementById('wi-status').value,
    solution: document.getElementById('wi-solution').value.trim(),
    resolvedDate: document.getElementById('wi-resolved-date').value,
  };

  if (wiEditingId) {
    const idx = workIssues.findIndex(i => i.id === wiEditingId);
    if (idx >= 0) {
      workIssues[idx] = { ...workIssues[idx], ...record, updatedAt: new Date().toISOString() };
      showToast('✅ บันทึกการแก้ไขแล้ว', 'success');
      if (typeof sendTelegramNotification === 'function') {
        sendTelegramNotification(
          `✏️ <b>แก้ไขบันทึกปัญหาการทำงาน</b>\nเลขที่: ${workIssues[idx].runningNo}\nหัวข้อ: ${escapeHtml(topic)}\nสถานะ: ${escapeHtml(record.status)}`
        );
      }
    }
    wiCancelEdit();
  } else {
    record.id = 'WI_' + Date.now();
    record.runningNo = wiNextRunningNo();
    record.createdAt = new Date().toISOString();
    workIssues.unshift(record);
    showToast('✅ บันทึกข้อมูลแล้ว', 'success');
    if (typeof sendTelegramNotification === 'function') {
      sendTelegramNotification(
        `⚠️ <b>บันทึกปัญหาการทำงานใหม่</b>\nเลขที่: ${record.runningNo}\nหัวข้อ: ${escapeHtml(topic)}\nผู้แจ้ง: ${escapeHtml(reporter)}\nรายละเอียด: ${escapeHtml(detail)}`
      );
    }
    wiClearForm();
  }
  wiSave();
  wiPushIfReady();
  wiRenderList();
}

function wiClearForm() {
  wiEditingId = null;
  document.getElementById('wi-edit-banner').style.display = 'none';
  document.getElementById('wi-date').value = '';
  document.getElementById('wi-topic').value = '';
  document.getElementById('wi-reporter').value = '';
  document.getElementById('wi-detail').value = '';
  document.getElementById('wi-status').value = 'รอดำเนินการ';
  document.getElementById('wi-solution').value = '';
  document.getElementById('wi-resolved-date').value = '';
}

function wiEditCase(id) {
  const rec = workIssues.find(i => i.id === id);
  if (!rec) return;
  wiEditingId = id;
  document.getElementById('wi-edit-banner').style.display = 'flex';
  document.getElementById('wi-edit-no').textContent = rec.runningNo;
  document.getElementById('wi-date').value = rec.date || '';
  if (typeof setSelectValueSafe === 'function') setSelectValueSafe('wi-topic', rec.topic || '');
  else document.getElementById('wi-topic').value = rec.topic || '';
  document.getElementById('wi-reporter').value = rec.reporter || '';
  document.getElementById('wi-detail').value = rec.detail || '';
  document.getElementById('wi-status').value = rec.status || 'รอดำเนินการ';
  document.getElementById('wi-solution').value = rec.solution || '';
  document.getElementById('wi-resolved-date').value = rec.resolvedDate || '';
  wiSwitchTab('add');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function wiCancelEdit() {
  wiClearForm();
}

function wiDeleteCase(id) {
  if (!confirm('ยืนยันการลบบันทึกนี้?')) return;
  workIssues = workIssues.filter(i => i.id !== id);
  wiSave();
  wiPushIfReady();
  wiRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== List / Filter =====
function wiFilteredList() {
  const topic = document.getElementById('wi-f-topic')?.value || '';
  const status = document.getElementById('wi-f-status')?.value || '';
  const search = (document.getElementById('wi-f-search')?.value || '').toLowerCase().trim();
  return workIssues.filter(i => {
    if (topic && i.topic !== topic) return false;
    if (status && i.status !== status) return false;
    if (search && !(`${i.topic} ${i.reporter} ${i.detail}`.toLowerCase().includes(search))) return false;
    return true;
  });
}

function wiClearListFilters() {
  document.getElementById('wi-f-topic').value = '';
  document.getElementById('wi-f-status').value = '';
  document.getElementById('wi-f-search').value = '';
  wiRenderList();
}

function wiStatusBadge(status) {
  if (status === 'เสร็จสิ้น') return `<span class="badge badge-green">${escapeHtml(status)}</span>`;
  if (status === 'กำลังดำเนินการ') return `<span class="badge badge-orange">${escapeHtml(status)}</span>`;
  return `<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">${escapeHtml(status)}</span>`;
}

function wiRenderList() {
  const list = wiFilteredList();
  const tbody = document.getElementById('wi-list-body');
  const countEl = document.getElementById('wi-list-count');
  if (!tbody) return;
  if (countEl) countEl.textContent = `ทั้งหมด ${list.length} รายการ`;
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">ยังไม่มีข้อมูล</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(i => `
    <tr>
      <td>${i.runningNo}</td>
      <td>${formatDate(i.date)}</td>
      <td>${escapeHtml(i.topic)}</td>
      <td>${escapeHtml(i.reporter || '-')}</td>
      <td>${escapeHtml(i.detail)}</td>
      <td>${wiStatusBadge(i.status)}</td>
      <td>
        <button class="action-btn action-view" onclick="wiEditCase('${i.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="wiDeleteCase('${i.id}')">ลบ</button>
      </td>
    </tr>
  `).join('');
}

// ===== Firebase Sync (ใช้ fbDb/fbReady จาก claims.js) =====
function wiRecordsToObj(arr) {
  const o = {};
  (arr || []).forEach(r => { if (r && r.id) o[r.id] = r; });
  return o;
}
function wiObjToRecords(obj) {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj.filter(Boolean);
  return Object.values(obj).filter(r => r && r.id);
}
function wiApplyServer(serverIssues) {
  workIssues = serverIssues;
  wiSave();
  wiRenderList();
}
async function wiWriteFB() {
  if (!wiRef) return;
  try {
    const { set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(wiRef, wiRecordsToObj(workIssues));
  } catch (e) { console.warn('wiWriteFB error', e); }
}
function wiPushIfReady() { if (wiReady) wiWriteFB(); }

function wiWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function wiInit() {
  await wiWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    wiRef = ref(fbDb, '/workIssues');
    const snap = await get(wiRef);
    if (snap.exists()) wiApplyServer(wiObjToRecords(snap.val()));
    wiReady = true;
    if (!snap.exists() && workIssues.length > 0) await wiWriteFB();
    onValue(wiRef, s => { if (s.exists()) wiApplyServer(wiObjToRecords(s.val())); });
  } catch (e) {
    console.warn('wiInit error', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  wiRefreshLookupDropdowns();
  wiClearForm();
  wiRenderList();
  wiInit();
});

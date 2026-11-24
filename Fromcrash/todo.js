// ===== งานที่ต้องทำ =====
// เก็บ local ที่ localStorage key 'finflow_todo_tasks' และ sync กับ Firebase ที่ /todoTasks
// (ใช้ gsSplit / gsMerge / gsWriteMany / gsDeleteMany จาก gpscctv.js — มีป้ายลบ กันรายการที่ลบแล้วกลับมา)

let todoTasks = JSON.parse(localStorage.getItem('finflow_todo_tasks') || '[]');
let todoEditingId = null;
let todoRef = null;
let todoReady = false;

function todoSave() { safeLocalStorageSet('finflow_todo_tasks', JSON.stringify(todoTasks)); }

function todoTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// เกินกำหนด = ยังไม่เสร็จ และกำหนดวันเสร็จ < วันนี้
function todoIsOverdue(t) { return !t.done && !!t.dueDate && t.dueDate < todoTodayStr(); }

// ===== ฟอร์ม =====
function todoClearForm() {
  todoEditingId = null;
  document.getElementById('todo-edit-banner').style.display = 'none';
  document.getElementById('todo-title').value = '';
  document.getElementById('todo-detail').value = '';
  document.getElementById('todo-due').value = '';
  document.getElementById('todo-save-btn').textContent = '💾 เพิ่มงาน';
}

function todoSaveCase() {
  const title = document.getElementById('todo-title').value.trim();
  const detail = document.getElementById('todo-detail').value.trim();
  const dueDate = document.getElementById('todo-due').value;
  if (!title) { showToast('กรุณาระบุหัวข้อ', 'warning'); return; }

  let saved;
  if (todoEditingId) {
    const idx = todoTasks.findIndex(t => t.id === todoEditingId);
    if (idx >= 0) {
      todoTasks[idx] = { ...todoTasks[idx], title, detail, dueDate, updatedAt: new Date().toISOString() };
      saved = todoTasks[idx];
    }
    showToast('บันทึกการแก้ไขแล้ว', 'success');
  } else {
    saved = { id: 'TD_' + Date.now(), title, detail, dueDate, done: false, doneAt: '', createdAt: new Date().toISOString() };
    todoTasks.unshift(saved);
    showToast('เพิ่มงานแล้ว', 'success');
  }
  todoClearForm();
  todoSave();
  if (saved) todoPushOneIfReady(saved);
  todoRenderList();
}

function todoEditCase(id) {
  const t = todoTasks.find(x => x.id === id);
  if (!t) return;
  todoEditingId = id;
  document.getElementById('todo-edit-banner').style.display = 'flex';
  document.getElementById('todo-title').value = t.title || '';
  document.getElementById('todo-detail').value = t.detail || '';
  document.getElementById('todo-due').value = t.dueDate || '';
  document.getElementById('todo-save-btn').textContent = '💾 บันทึกการแก้ไข';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function todoToggleDone(id, checked) {
  const idx = todoTasks.findIndex(t => t.id === id);
  if (idx < 0) return;
  todoTasks[idx] = { ...todoTasks[idx], done: !!checked, doneAt: checked ? new Date().toISOString() : '', updatedAt: new Date().toISOString() };
  todoSave();
  todoPushOneIfReady(todoTasks[idx]);
  todoRenderList();
}

function todoDeleteCase(id) {
  if (!confirmDeleteWithPin('ยืนยันการลบงานนี้?')) return;
  todoTasks = todoTasks.filter(t => t.id !== id);
  if (todoEditingId === id) todoClearForm();
  todoSave();
  todoRemoveOneIfReady(id);
  todoRenderList();
  showToast('ลบแล้ว', 'warning');
}

// ===== รายการ =====
function todoFilteredList() {
  const status = document.getElementById('todo-f-status')?.value || '';
  const search = (document.getElementById('todo-f-search')?.value || '').toLowerCase().trim();
  const list = todoTasks.filter(t => {
    if (status === 'pending' && t.done) return false;
    if (status === 'done' && !t.done) return false;
    if (status === 'overdue' && !todoIsOverdue(t)) return false;
    if (search && !`${t.title} ${t.detail}`.toLowerCase().includes(search)) return false;
    return true;
  });
  // ยังไม่เสร็จขึ้นก่อน เรียงตามกำหนดวันเสร็จ (ใกล้สุดก่อน, ไม่มีกำหนดไว้ท้าย) ; เสร็จแล้วไว้ล่างสุด
  return list.sort((a, b) => {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const da = a.dueDate || '9999-99-99', db = b.dueDate || '9999-99-99';
    return da.localeCompare(db);
  });
}

function todoClearListFilters() {
  ['todo-f-status', 'todo-f-search'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  todoRenderList();
}

function todoRenderList() {
  const tbody = document.getElementById('todo-list-body');
  const countEl = document.getElementById('todo-list-count');
  if (!tbody) return;
  const list = todoFilteredList();
  if (countEl) {
    const pend = todoTasks.filter(t => !t.done).length;
    const over = todoTasks.filter(todoIsOverdue).length;
    countEl.textContent = `ทั้งหมด ${todoTasks.length} งาน · ยังไม่เสร็จ ${pend} · เกินกำหนด ${over} · แสดง ${list.length} รายการ`;
  }
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">ยังไม่มีงาน</td></tr>';
    return;
  }
  tbody.innerHTML = list.map(t => {
    const over = todoIsOverdue(t);
    return `
    <tr class="${t.done ? 'todo-row-done' : over ? 'dtk-row-late' : ''}">
      <td style="text-align:center;"><input type="checkbox" ${t.done ? 'checked' : ''} onchange="todoToggleDone('${t.id}', this.checked)" title="ติ๊กเมื่อทำเสร็จแล้ว" /></td>
      <td class="todo-title-cell">${escapeHtml(t.title)}</td>
      <td>${escapeHtml(t.detail || '-')}</td>
      <td>${t.dueDate ? formatDate(t.dueDate) : '-'}</td>
      <td>${t.done ? `✅ เสร็จแล้ว${t.doneAt ? ' ' + formatDate(t.doneAt.slice(0, 10)) : ''}` : over ? '⚠️ เกินกำหนด' : '⏳ ยังไม่เสร็จ'}</td>
      <td>
        <button class="action-btn action-view" onclick="todoEditCase('${t.id}')">แก้ไข</button>
        <button class="action-btn action-delete" onclick="todoDeleteCase('${t.id}')">ลบ</button>
      </td>
    </tr>`;
  }).join('');
}

function todoOnPageShown() { todoRenderList(); }

// ===== Firebase Sync =====
function todoRecTs(r) {
  const t = Date.parse(r.updatedAt || r.createdAt || '');
  return isNaN(t) ? 0 : t;
}
const TODO_LASTSYNC_KEY = 'finflow_todo_lastsync';
function todoApplyServer(serverList, deleted) {
  deleted = deleted || new Set();
  // รายการในเครื่องที่ server ไม่มี: ถ้าสร้าง/แก้หลังซิงค์ล่าสุด = ยังไม่ได้ส่งขึ้น ให้เก็บ+ส่ง ; ถ้าเก่ากว่า = เครื่องอื่นลบไปแล้ว ให้ทิ้ง
  let last = 0;
  try { last = Number(localStorage.getItem(TODO_LASTSYNC_KEY) || 0); } catch (e) {}
  const cutoff = last || (Date.now() - 10 * 60 * 1000);
  const serverIds = new Set(serverList.map(r => r.id));
  const localOnly = (todoTasks || []).filter(t => t && t.id && !serverIds.has(t.id) && !deleted.has(t.id) && todoRecTs(t) > cutoff);
  todoTasks = serverList.concat(localOnly);
  if (localOnly.length === 0) { try { localStorage.setItem(TODO_LASTSYNC_KEY, String(Date.now())); } catch (e) {} }
  todoSave();
  todoRenderList();
  if (localOnly.length > 0) gsWriteMany('/todoTasks', localOnly);
}

async function todoWriteOne(record) {
  if (!todoRef || !record?.id) return;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/todoTasks/${record.id}`), record);
    notifySyncWriteSuccess();
  } catch (e) { console.warn('todoWriteOne error', e); notifySyncWriteError(e.message); }
}
function todoPushOneIfReady(record) { if (todoReady) todoWriteOne(record); }
function todoRemoveOneIfReady(id) { if (todoReady) gsDeleteMany('/todoTasks', [id]); }

function todoWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function todoInit() {
  await todoWaitForFirebase();
  try {
    const { ref, onValue, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    todoRef = ref(fbDb, '/todoTasks');
    const snap = await get(todoRef);
    if (snap.exists()) { const p = gsSplit(snap.val()); todoApplyServer(p.records, p.deleted); }
    todoReady = true;
    if (!snap.exists() && todoTasks.length > 0) await gsWriteMany('/todoTasks', todoTasks);
    onValue(todoRef, s => { if (s.exists()) { const p = gsSplit(s.val()); todoApplyServer(p.records, p.deleted); } else todoApplyServer([], new Set()); });
  } catch (e) { console.warn('todoInit error', e); notifySyncLoadError(e.message); }
}

document.addEventListener('DOMContentLoaded', () => {
  todoClearForm();
  todoRenderList();
  todoInit();
});

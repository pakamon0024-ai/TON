// ===== ระบบผู้ใช้ (สมัครสมาชิก / เข้าสู่ระบบ) ผ่าน Firebase Authentication =====
// ใช้ Firebase App instance เดียวกับที่ claims.js เชื่อมต่อไว้แล้ว (ตัวแปร fbApp/fbReady
// เป็น top-level let ใน claims.js ซึ่งมองเห็นได้จากไฟล์ script อื่นในหน้าเดียวกัน)
//
// โครงสร้างข้อมูลผู้ใช้ที่ /users/{uid}:
//   { email, role: 'admin' | 'staff', disabled: false, createdAt }
// ผู้สมัครคนแรกสุดของระบบจะได้สิทธิ์ admin อัตโนมัติ คนถัดไปเป็น staff
//
// ⚠️ สำคัญ: การมี login UI ฝั่งหน้าเว็บอย่างเดียวไม่ได้ปกป้องข้อมูลจริง ต้องตั้งค่า
// Firebase Realtime Database Rules ที่ฝั่ง Firebase Console ด้วย (ดูคำแนะนำท้ายไฟล์ CLAUDE
// หรือถามผู้ที่ตั้งระบบนี้ให้) ไม่เช่นนั้นใครก็ยังเรียก REST API ตรงไปที่ Firebase ได้อยู่ดี

let authInstance = null;
let currentUser = null;
let currentUserProfile = null; // { email, role, disabled }

// รอแค่ fbApp (สร้าง Firebase App instance แล้ว) — "ไม่" รอ fbReady เพราะ fbReady ต้องอ่าน
// ข้อมูลจาก Realtime Database สำเร็จก่อน ซึ่งตอนนี้ Security Rules บังคับให้ login ก่อนถึงจะ
// อ่านได้ ถ้ารอ fbReady ที่นี่จะกลายเป็นวนตายทั้งคู่ (ต้อง login ถึงจะเห็นหน้า login)
function authWaitForFirebase() {
  return new Promise(resolve => {
    const check = () => {
      if (typeof fbApp !== 'undefined' && fbApp) resolve();
      else setTimeout(check, 300);
    };
    check();
  });
}

async function authInit() {
  await authWaitForFirebase();
  const { getAuth, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
  authInstance = getAuth(fbApp);

  onAuthStateChanged(authInstance, async user => {
    currentUser = user;
    if (user) {
      // ตอนโหลดหน้าเว็บครั้งแรก claims.js พยายามอ่านข้อมูลก่อน login เสร็จ (โดน permission
      // denied เพราะ Security Rules) ทำให้ fbReady ค้างเป็น false — พอ login สำเร็จแล้วต้อง
      // ลองอ่านใหม่อีกครั้ง ไม่งั้นข้อมูลเคลมประกัน/เงินสดย่อย/ฐานข้อมูลหลักจะไม่โหลดเลย
      if (typeof icRetryAfterLogin === 'function') icRetryAfterLogin();
      currentUserProfile = await authLoadProfile(user.uid, user.email);
      if (currentUserProfile.disabled) {
        authShowError('บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ');
        await authSignOut();
        return;
      }
      authShowApp();
    } else {
      currentUserProfile = null;
      authShowLogin();
    }
  });
}

async function authLoadProfile(uid, email) {
  const { ref, get, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
  const userRef = ref(fbDb, `/users/${uid}`);
  const snap = await get(userRef);
  if (snap.exists()) return snap.val();

  // ยังไม่มีโปรไฟล์ (บัญชีใหม่) -> สร้างให้ คนแรกสุดของระบบเป็น admin
  const allUsersSnap = await get(ref(fbDb, '/users'));
  const isFirstUser = !allUsersSnap.exists();
  const profile = {
    email,
    role: isFirstUser ? 'admin' : 'staff',
    disabled: false,
    createdAt: new Date().toISOString(),
  };
  await set(userRef, profile);
  return profile;
}

async function authSignUp() {
  const email = document.getElementById('auth-signup-email').value.trim();
  const password = document.getElementById('auth-signup-password').value;
  const password2 = document.getElementById('auth-signup-password2').value;
  authShowError('');
  if (!email || !password) { authShowError('กรุณากรอกอีเมลและรหัสผ่าน'); return; }
  if (password.length < 6) { authShowError('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร'); return; }
  if (password !== password2) { authShowError('รหัสผ่านทั้งสองช่องไม่ตรงกัน'); return; }
  try {
    const { createUserWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    await createUserWithEmailAndPassword(authInstance, email, password);
    // onAuthStateChanged จะทำงานต่อเอง (สร้างโปรไฟล์ + เข้าแอป)
  } catch (e) {
    authShowError(authTranslateError(e.code));
  }
}

async function authSignIn() {
  const email = document.getElementById('auth-login-email').value.trim();
  const password = document.getElementById('auth-login-password').value;
  authShowError('');
  if (!email || !password) { authShowError('กรุณากรอกอีเมลและรหัสผ่าน'); return; }
  try {
    const { signInWithEmailAndPassword } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
    await signInWithEmailAndPassword(authInstance, email, password);
  } catch (e) {
    authShowError(authTranslateError(e.code));
  }
}

async function authSignOut() {
  const { signOut } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js');
  await signOut(authInstance);
}

function authTranslateError(code) {
  const map = {
    'auth/email-already-in-use': 'อีเมลนี้ถูกใช้สมัครไปแล้ว',
    'auth/invalid-email': 'รูปแบบอีเมลไม่ถูกต้อง',
    'auth/weak-password': 'รหัสผ่านสั้นเกินไป (อย่างน้อย 6 ตัวอักษร)',
    'auth/user-not-found': 'ไม่พบบัญชีนี้',
    'auth/wrong-password': 'รหัสผ่านไม่ถูกต้อง',
    'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่',
  };
  return map[code] || ('เกิดข้อผิดพลาด: ' + code);
}

function authShowError(msg) {
  const el = document.getElementById('auth-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function authSwitchTab(tab) {
  document.getElementById('auth-tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('auth-tab-signup').classList.toggle('active', tab === 'signup');
  document.getElementById('auth-form-login').style.display = tab === 'login' ? 'block' : 'none';
  document.getElementById('auth-form-signup').style.display = tab === 'signup' ? 'block' : 'none';
  authShowError('');
}

function authShowLogin() {
  document.getElementById('authOverlay').style.display = 'flex';
  document.getElementById('appRoot').style.visibility = 'hidden';
}

function authShowApp() {
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appRoot').style.visibility = 'visible';
  authRenderUserBadge();
  authApplyRoleVisibility();
}

function authRenderUserBadge() {
  const nameEl = document.querySelector('#userBadge .user-name');
  const roleEl = document.querySelector('#userBadge .user-role');
  if (nameEl) nameEl.textContent = currentUserProfile?.email || '-';
  if (roleEl) roleEl.textContent = currentUserProfile?.role === 'admin' ? 'แอดมิน' : 'พนักงาน';
}

function authApplyRoleVisibility() {
  const isAdmin = currentUserProfile?.role === 'admin';
  const navUsers = document.getElementById('nav-users');
  if (navUsers) navUsers.style.display = isAdmin ? 'flex' : 'none';
  if (typeof mdApplyAdminOnlyVisibility === 'function') mdApplyAdminOnlyVisibility();
}

function authToggleUserMenu() {
  document.getElementById('userMenuDropdown').classList.toggle('open');
}

// ===== หน้าจัดการผู้ใช้ (เฉพาะแอดมิน) =====
async function renderUsersPage() {
  if (currentUserProfile?.role !== 'admin') return;
  const tbody = document.getElementById('users-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="4" class="empty-state">กำลังโหลด...</td></tr>';
  const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
  const snap = await get(ref(fbDb, '/users'));
  if (!snap.exists()) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">ยังไม่มีผู้ใช้</td></tr>';
    return;
  }
  const users = snap.val();
  const rows = Object.entries(users).map(([uid, u]) => `
    <tr>
      <td>${escapeHtml(u.email || '-')}</td>
      <td><span class="badge ${u.role === 'admin' ? 'badge-purple' : 'badge-blue'}">${u.role === 'admin' ? 'แอดมิน' : 'พนักงาน'}</span></td>
      <td>${u.disabled ? '<span class="badge" style="background:#f64f5911;color:#f64f59;border:1px solid #f64f5933">ระงับใช้งาน</span>' : '<span class="badge badge-green">ใช้งานได้</span>'}</td>
      <td>
        <div style="display:flex;gap:6px">
          <button class="action-btn action-view" onclick="adminToggleRole('${uid}', '${u.role}')">${u.role === 'admin' ? 'ลดเป็นพนักงาน' : 'ตั้งเป็นแอดมิน'}</button>
          <button class="action-btn ${u.disabled ? 'action-view' : 'action-delete'}" onclick="adminToggleDisabled('${uid}', ${!!u.disabled})">${u.disabled ? 'ปลดระงับ' : 'ระงับใช้งาน'}</button>
        </div>
      </td>
    </tr>
  `).join('');
  tbody.innerHTML = rows;
}

async function adminToggleRole(uid, currentRole) {
  if (currentUser && uid === currentUser.uid) {
    if (!confirm('นี่คือบัญชีของคุณเอง ต้องการเปลี่ยนสิทธิ์ตัวเองจริงหรือไม่?')) return;
  }
  const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
  await update(ref(fbDb, `/users/${uid}`), { role: currentRole === 'admin' ? 'staff' : 'admin' });
  showToast('อัปเดตสิทธิ์แล้ว', 'success');
  renderUsersPage();
}

async function adminToggleDisabled(uid, currentlyDisabled) {
  if (currentUser && uid === currentUser.uid) { showToast('ไม่สามารถระงับบัญชีตัวเองได้', 'error'); return; }
  const { ref, update } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
  await update(ref(fbDb, `/users/${uid}`), { disabled: !currentlyDisabled });
  showToast(currentlyDisabled ? 'ปลดระงับบัญชีแล้ว' : 'ระงับบัญชีแล้ว', 'warning');
  renderUsersPage();
}

document.addEventListener('DOMContentLoaded', () => {
  authInit();
  document.addEventListener('click', e => {
    const menu = document.getElementById('userMenuDropdown');
    const badge = document.getElementById('userBadge');
    if (menu && menu.classList.contains('open') && !badge.contains(e.target)) menu.classList.remove('open');
  });
});

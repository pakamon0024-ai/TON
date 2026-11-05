// ===== รูปแนบรายการ (ใช้ร่วมกัน: บันทึกปัญหาการทำงาน / แจ้งซ่อม GPS-CCTV) =====
// เก็บรูปแยกที่ Firebase /recordPhotos/<kind>/<id> ไม่ฝังในตัวบันทึก — ตัวบันทึกมีแค่ hasPhoto: true
// เพื่อไม่ให้รูปถูกดึงลงมาทุกครั้งที่เปิดแอป และไม่กิน localStorage ของเครื่อง (โหลดรูปเฉพาะตอนกดดู/แก้ไข/ทำภาพรายงาน)

const PHOTO_MAX_SIDE = 800;
const PHOTO_QUALITY = 0.62;
const photoCache = {};

function photoFbReady() {
  return typeof fbDb !== 'undefined' && fbDb && typeof fbReady !== 'undefined' && fbReady;
}

// ย่อรูปและบีบเป็น JPEG — คืนค่า data URL
function photoCompress(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์ไม่ได้'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('อ่านไฟล์รูปไม่ได้'));
      img.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function photoPut(kind, id, data) {
  if (!photoFbReady()) return false;
  try {
    const { ref, set } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await set(ref(fbDb, `/recordPhotos/${kind}/${id}`), data);
    photoCache[`${kind}/${id}`] = data;
    return true;
  } catch (e) { console.warn('photoPut error', e); return false; }
}

async function photoFetch(kind, id) {
  const key = `${kind}/${id}`;
  if (photoCache[key]) return photoCache[key];
  if (!photoFbReady()) return '';
  try {
    const { ref, get } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    const snap = await get(ref(fbDb, `/recordPhotos/${kind}/${id}`));
    const val = snap.exists() ? snap.val() : '';
    if (val) photoCache[key] = val;
    return val;
  } catch (e) { console.warn('photoFetch error', e); return ''; }
}

async function photoDelete(kind, id) {
  delete photoCache[`${kind}/${id}`];
  if (!photoFbReady()) return;
  try {
    const { ref, remove } = await import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js');
    await remove(ref(fbDb, `/recordPhotos/${kind}/${id}`));
  } catch (e) { console.warn('photoDelete error', e); }
}

// รูปของรายการ: รายการที่แนบไว้ก่อนหน้านี้ (ฝัง rec.photo ในตัวบันทึก) ยังใช้ได้ ส่วนรายการใหม่ดึงจาก /recordPhotos
async function photoOf(kind, rec) {
  if (!rec) return '';
  if (rec.photo) return rec.photo;
  if (rec.hasPhoto) return photoFetch(kind, rec.id);
  return '';
}

function photoShow(src) {
  if (!src) { showToast('โหลดรูปไม่ได้ (ตรวจสอบการเชื่อมต่อ)', 'warning'); return; }
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:10000;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:16px;';
  ov.innerHTML = `<img src="${src}" style="max-width:95vw;max-height:92vh;border-radius:8px;background:#fff;" />`;
  ov.onclick = () => ov.remove();
  document.body.appendChild(ov);
}

async function photoViewOf(kind, rec) {
  photoShow(await photoOf(kind, rec));
}

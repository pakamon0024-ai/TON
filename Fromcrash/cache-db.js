// ===== แคชข้อมูลขนาดใหญ่ใน IndexedDB (แทน localStorage ที่จำกัดประมาณ 5 MB) =====
// IndexedDB รับข้อมูลได้หลายร้อย MB ถึงหลาย GB ตามพื้นที่ดิสก์ จึงเก็บข้อมูลทุกปีในเครื่องได้
// ข้อมูลเต็มยังอยู่บน Firebase เสมอ แคชนี้มีไว้ให้เปิดหน้าเห็นข้อมูลทันที/ใช้ตอนออฟไลน์

const CACHE_DB_NAME = 'finflow_cache';
const CACHE_STORE = 'kv';
let cacheDbPromise = null;

function cacheDb() {
  if (!cacheDbPromise) {
    cacheDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CACHE_DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(CACHE_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return cacheDbPromise;
}

async function cacheGet(key) {
  try {
    const db = await cacheDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('cacheGet error', key, e);
    return null;
  }
}

async function cacheSet(key, value) {
  try {
    const db = await cacheDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CACHE_STORE, 'readwrite');
      tx.objectStore(CACHE_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('cacheSet error', key, e);
  }
}

// ย้ายค่าเก่าจาก localStorage มาไว้ใน IndexedDB แล้วลบออกจาก localStorage เพื่อคืนพื้นที่โควตา
async function cacheMigrateFromLocalStorage(key) {
  const raw = localStorage.getItem(key);
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw);
    await cacheSet(key, value);
    localStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

// โหลดแคชของ key นี้: ลองจาก IndexedDB ก่อน ถ้ายังไม่มีให้ย้ายจาก localStorage เดิม
async function cacheLoad(key) {
  const value = await cacheGet(key);
  if (value !== null) return value;
  return await cacheMigrateFromLocalStorage(key);
}

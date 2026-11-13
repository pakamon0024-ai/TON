// ที่เก็บข้อมูล: chrome.storage.local (ถ้าเปิดนอก Extension เพื่อทดสอบ ใช้ localStorage แทน)
(function (root) {
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  const FIXED_STATIONS = [
    { id: 'st-qmb', name: 'QMB บ้านบึง', type: 'pickup', fixed: true, polygon: null },
    { id: 'st-mentor', name: 'Mentor เขาตะแบก', type: 'pickup', fixed: true, polygon: null },
    { id: 'st-airport', name: 'สนามบิน Expeditors', type: 'delivery', fixed: true, polygon: null }
  ];
  const DEFAULT_ROUTES = [
    { id: 'rt-qmb', pattern: 'QMB (บ้านบึง) - สนามบิน', match: 'prefix', pickupStationId: 'st-qmb', deliveryStationId: 'st-airport' },
    { id: 'rt-mentor', pattern: 'Mentor (เขาตะแบก) - สนามบิน', match: 'prefix', pickupStationId: 'st-mentor', deliveryStationId: 'st-airport' }
  ];
  const DEFAULT_SETTINGS = {
    gpsBaseUrl: 'https://th-slt.eupfin.com/Eup_Servlet_API_SOAP',
    gpsToken: '',
    pollSeconds: 60,
    etaSpeedKmh: 40,
    syncUrl: '',
    syncKey: '',
    isPoller: true,
    cloudGps: false,
    waitFreeHours: 3,
    waitRate: 30,
    remindMinutes: 30
  };

  async function getRaw(keys) {
    if (hasChrome) return chrome.storage.local.get(keys);
    const out = {};
    for (const k of keys) {
      const v = localStorage.getItem('ap.' + k);
      if (v != null) out[k] = JSON.parse(v);
    }
    return out;
  }
  async function setRaw(obj) {
    if (hasChrome) return chrome.storage.local.set(obj);
    for (const [k, v] of Object.entries(obj)) localStorage.setItem('ap.' + k, JSON.stringify(v));
  }

  async function load() {
    const d = await getRaw(['stations', 'routes', 'trips', 'settings', 'seeded', 'gpsStatus', 'syncMeta', 'syncStatus']);
    if (!d.seeded) {
      d.stations = FIXED_STATIONS.slice();
      d.routes = DEFAULT_ROUTES.slice();
      d.settings = { ...DEFAULT_SETTINGS };
      d.trips = [];
      await setRaw({ stations: d.stations, routes: d.routes, settings: d.settings, trips: d.trips, seeded: true });
    }
    // สถานีหลักต้องมีเสมอ (กันกรณีข้อมูลเก่า)
    d.stations = d.stations || [];
    for (const f of FIXED_STATIONS) {
      if (!d.stations.some((s) => s.id === f.id)) d.stations.push({ ...f });
    }
    d.routes = d.routes || [];
    // เส้นทางว่าง (เช่นหลังล้างข้อมูล) → คืนเส้นทางตั้งต้น QMB / Mentor ตามไฟล์ Truck Detail
    if (!d.routes.length) {
      d.routes = DEFAULT_ROUTES.map((r) => ({ ...r }));
      await setRaw({ routes: d.routes });
    }
    d.trips = d.trips || [];
    d.settings = { ...DEFAULT_SETTINGS, ...(d.settings || {}) };
    await restoreConnection(d.settings);
    return d;
  }

  // ค่าเชื่อมต่อฐานข้อมูลกลาง (ไม่รวม Token GPS) สำรองไว้ใน chrome.storage.sync ด้วย
  // ติดตั้งใหม่/ล้างข้อมูลในเครื่อง แล้วโหลดมาให้อัตโนมัติ (ต้องเป็น Extension ID เดิม + ล็อกอิน Chrome บัญชีเดิม)
  const hasSync = hasChrome && chrome.storage.sync;
  const CONN_KEYS = ['syncUrl', 'syncKey', 'cloudGps'];
  async function mirrorConnection(settings) {
    if (!hasSync || !settings || !settings.syncUrl || !settings.syncKey) return;
    const cfg = {};
    CONN_KEYS.forEach((k) => (cfg[k] = settings[k]));
    try { await chrome.storage.sync.set({ connCfg: cfg }); } catch (e) { /* โควตา/ไม่ได้ล็อกอิน ไม่เป็นไร */ }
  }
  async function restoreConnection(settings) {
    if (!hasSync) return;
    try {
      if (settings.syncUrl && settings.syncKey) return mirrorConnection(settings); // มีอยู่แล้ว: ให้สำเนาตรงกัน
      const { connCfg } = await chrome.storage.sync.get('connCfg');
      if (connCfg && connCfg.syncUrl && connCfg.syncKey) {
        CONN_KEYS.forEach((k) => { if (connCfg[k] !== undefined) settings[k] = connCfg[k]; });
        await setRaw({ settings });
      }
    } catch (e) { /* ใช้ค่าในเครื่องต่อ */ }
  }

  const save = async (patch) => {
    await setRaw(patch);
    if (patch.settings) await mirrorConnection(patch.settings);
  };

  async function bytesInUse() {
    if (hasChrome && chrome.storage.local.getBytesInUse) return chrome.storage.local.getBytesInUse(null);
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) n += (localStorage.getItem(localStorage.key(i)) || '').length;
    return n;
  }

  root.Store = { load, save, bytesInUse, FIXED_STATIONS, DEFAULT_ROUTES, DEFAULT_SETTINGS };
})(this);

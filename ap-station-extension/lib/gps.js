// ดึงตำแหน่งรถจาก Eup API (ตามเอกสาร Eup API V1.0.0.0)
//   1) POST {base}/login/session?token=TOKEN  → result.sessionId / result.token
//   2) GET  {base}/car/log_data/car_status?carNumber=ทะเบียน  (Authorization: Bearer ...) → result[] ของ CarStatusDto
//      logGisx = ลองจิจูด×1e6, logGisy = ละติจูด×1e6, logDTime = เวลาที่ได้พิกัด
(function (root) {
  let session = null; // { base, token, bearer } เก็บในหน่วยความจำ ล็อกอินใหม่เมื่อโดน 401/403

  const toIso = (v) => {
    if (v == null || v === '') return null;
    const t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v).replace(' ', 'T'));
    return t > 0 ? new Date(t).toISOString() : null;
  };

  async function call(url, init) {
    let res;
    try { res = await fetch(url, init); }
    catch (e) { throw new Error('เชื่อมต่อ GPS ไม่ได้ (' + e.message + ')'); }
    const raw = await res.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (e) { /* ไม่ใช่ JSON */ }
    return { status: res.status, ok: res.ok, raw, json };
  }

  async function login(settings) {
    if (!settings.gpsBaseUrl) throw new Error('ยังไม่ได้ตั้ง Base URL');
    if (!settings.gpsToken) throw new Error('ยังไม่ได้ใส่ Token GPS');
    const r = await call(`${settings.gpsBaseUrl}/login/session?token=${encodeURIComponent(settings.gpsToken)}`, { method: 'POST' });
    if (r.status === 401 || r.status === 403) throw new Error('Token GPS ไม่ถูกต้องหรือไม่มีสิทธิ์ (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('ล็อกอิน GPS ไม่สำเร็จ HTTP ' + r.status);
    const res = r.json && r.json.result;
    // เอกสารไม่ระบุว่าใช้ sessionId หรือ token เป็น Bearer — ลอง sessionId ก่อน แล้วสำรองด้วย token
    const candidates = [res && res.sessionId, res && res.token].filter(Boolean);
    if (!candidates.length) throw new Error('ล็อกอินแล้วแต่ไม่พบ sessionId ในผลลัพธ์: ' + r.raw.slice(0, 200));
    session = { base: settings.gpsBaseUrl, token: settings.gpsToken, candidates, bearer: candidates[0] };
    return session;
  }

  async function getSession(settings) {
    if (session && session.base === settings.gpsBaseUrl && session.token === settings.gpsToken) return session;
    return login(settings);
  }

  async function carStatus(settings, plate, retry) {
    const s = await getSession(settings);
    const r = await call(`${s.base}/car/log_data/car_status?carNumber=${encodeURIComponent(plate)}`, {
      headers: { Authorization: 'Bearer ' + s.bearer }
    });
    if (r.status === 401 || r.status === 403) {
      const next = s.candidates[s.candidates.indexOf(s.bearer) + 1];
      if (next) { s.bearer = next; return carStatus(settings, plate, retry); } // ลองค่าสำรอง
      session = null;
      if (!retry) return carStatus(settings, plate, true); // session หมดอายุ ล็อกอินใหม่หนึ่งครั้ง
      throw new Error('GPS ปฏิเสธการเข้าถึง (HTTP ' + r.status + ')');
    }
    if (!r.ok) throw new Error(`GPS ตอบ HTTP ${r.status} (${plate})`);
    return r;
  }

  function toRecord(dto, fallbackPlate) {
    const lat = Number(dto.logGisy) / 1e6, lng = Number(dto.logGisx) / 1e6;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    // ใช้ทะเบียนที่ขอ ไม่ใช้ carNumber จาก API เผื่อรูปแบบเขียนต่างกัน
    return { plate: fallbackPlate, lat, lng, speed: Number(dto.logSpeed) || 0, time: toIso(dto.logDTime) || new Date().toISOString() };
  }

  // คืน { records, raw, errors } — ล้มเหลวทีละคัน ไม่ทำให้คันอื่นพลาดไปด้วย
  async function fetchPositions(settings, plates) {
    await getSession(settings);
    const records = [], errors = [];
    let raw = '';
    for (const plate of plates) {
      try {
        const r = await carStatus(settings, plate);
        if (!raw) raw = r.raw;
        const list = (r.json && r.json.result) || [];
        const rec = list.map((d) => toRecord(d, plate)).find(Boolean);
        if (rec) records.push(rec); else errors.push(`${plate}: ไม่พบพิกัด`);
      } catch (e) { errors.push(`${plate}: ${e.message}`); }
    }
    return { records, raw, errors };
  }

  const api = { fetchPositions, login, toRecord };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Gps = api;
})(this);

// @ts-nocheck
// Supabase Edge Function: ดึง GPS จาก Eup + ตรวจจับเข้า-ออกสถานี แล้วเขียนลงตาราง docs
// ทำงานแทนเครื่องที่เคยเป็น "เครื่องดึง GPS" จึงรันได้โดยไม่ต้องเปิดเบราว์เซอร์/เครื่องใด ๆ
// เรียกโดย pg_cron ทุก 1 นาที (ดู supabase-cron.sql) · ตรรกะเดียวกับ lib/detect.js และ lib/gps.js ใน Extension
// เขียนเป็น JavaScript ล้วน (ไม่มี type annotation) เพื่อให้ทดสอบด้วย Node ได้

const CONFIRM = 2;       // ต้องเจอผลตรงกันติดกัน 2 รอบถึงนับ
const TRACK_DAYS = 2;    // ติดตามเที่ยวที่ยังไม่เสร็จย้อนหลังกี่วัน

// ---------- geo / detect (สำเนาจาก lib/) ----------
export function pointInPolygon(lat, lng, polygon) {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const normPlate = (s) => String(s || '').toLowerCase().replace(/[\s\-_.]/g, '');
export function plateMatches(a, b) {
  const x = normPlate(a), y = normPlate(b);
  return !!x && !!y && (x === y || y.includes(x) || x.includes(y));
}

// เส้นตรงจุด 1 → จุด 2 ตัดผ่าน polygon ไหม คืน { tIn, tOut } หรือ null (สำเนาจาก lib/geo.js)
function segmentPolygonSpan(lat1, lng1, lat2, lng2, polygon) {
  if (!polygon || polygon.length < 3) return null;
  const rx = lng2 - lng1, ry = lat2 - lat1;
  let tIn = Infinity, tOut = -Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const sx = polygon[i][1] - polygon[j][1], sy = polygon[i][0] - polygon[j][0];
    const qx = polygon[j][1] - lng1, qy = polygon[j][0] - lat1;
    const den = rx * sy - ry * sx;
    if (!den) continue;
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) { tIn = Math.min(tIn, t); tOut = Math.max(tOut, t); }
  }
  return tIn <= tOut ? { tIn, tOut } : null;
}

// obs.virt = { id, inside } คือการสังเกตสมมติ (รถขับผ่านสถานีระหว่างรอบ GPS) ใช้แทนผลตรวจ polygon
const inside = (st, lat, lng, obs) => {
  if (!st || !st.polygon) return false;
  if (obs && obs.virt) return st.id === obs.virt.id && obs.virt.inside;
  return pointInPolygon(lat, lng, st.polygon);
};

// สถานะถัดไปที่ตำแหน่งนี้บ่งชี้ (หรือ null ถ้ายังไม่เปลี่ยน) พร้อมชนิดเหตุการณ์
// prev = ตำแหน่งรอบก่อนหน้า (ใช้กันรถที่จอดค้างในสถานีส่งอยู่ก่อนเริ่มเที่ยว)
function candidate(trip, pickup, delivery, lat, lng, obs, prev) {
  const at = (st) => inside(st, lat, lng, obs);
  switch (trip.status) {
    case 'waiting_pickup':
      if (pickup && at(pickup)) return { status: 'at_pickup', type: 'pick_in', stationId: pickup.id };
      // พลาดจุดรับ: รถเข้าจุดส่งก่อน (ต้องเห็นรถอยู่นอกจุดส่งมาก่อน ไม่ใช่จอดค้างจากเที่ยวก่อน) → จับจุดส่งต่อเลย จุดรับเป็น "ไม่ทราบเวลา"
      if (delivery && at(delivery) && (obs.virt || (trip.pending && trip.pending.status === 'at_delivery') || (prev && !pointInPolygon(prev.lat, prev.lng, delivery.polygon || [])))) {
        return { status: 'at_delivery', type: 'del_in', stationId: delivery.id };
      }
      return null;
    case 'at_pickup':
      return pickup && !at(pickup) ? { status: 'pending_pickup_entry', type: 'pick_out', stationId: pickup.id } : null;
    case 'pending_pickup_entry':
    case 'waiting_delivery':
      return delivery && at(delivery) ? { status: 'at_delivery', type: 'del_in', stationId: delivery.id } : null;
    case 'at_delivery':
      return delivery && !at(delivery) ? { status: 'pending_delivery_entry', type: 'del_out', stationId: delivery.id } : null;
    default:
      return null;
  }
}

// ประมวลผลหนึ่งการสังเกต; obs = { lat, lng, time, virt? }
function observe(trip, pickup, delivery, obs, prev) {
  const c = candidate(trip, pickup, delivery, obs.lat, obs.lng, obs, prev);
  if (!c) { if (!obs.virt) delete trip.pending; return null; }
  if (obs.virt) trip.pending = { status: c.status, count: CONFIRM, at: obs.time, lat: obs.lat, lng: obs.lng };
  else if (trip.pending && trip.pending.status === c.status) trip.pending.count++;
  else trip.pending = { status: c.status, count: 1, at: obs.time, lat: obs.lat, lng: obs.lng };
  if (trip.pending.count < CONFIRM) return null;

  const ev = { type: c.type, stationId: c.stationId, at: trip.pending.at, lat: trip.pending.lat, lng: trip.pending.lng, source: obs.virt ? 'gps-path' : 'gps' };
  trip.status = c.status;
  // ถ้าผู้ใช้ย้อนสถานะแล้วจับซ้ำ ให้ค่าใหม่แทนค่าเก่าของชนิดเดียวกัน
  trip.events = (trip.events || []).filter((e) => e.type !== ev.type);
  trip.events.push(ev);
  delete trip.pending;
  return ev;
}

const MAX_GAP_MIN = 20; // เส้นทางระหว่าง 2 รอบ GPS ที่ห่างกันเกินนี้ไม่เชื่อว่าเป็นเส้นตรง

// pos = { lat, lng, time (ISO) }. แก้ trip ตรง ๆ และคืนเหตุการณ์ล่าสุด (ถ้ามี) หรือ null
export function applyPosition(trip, stations, pos) {
  if (!pos || !(Date.parse(pos.time) > 0)) return null;
  // ข้ามเฉพาะตำแหน่งที่เก่ากว่าเดิม; ตำแหน่งเวลาเดิมนับเป็นการยืนยันได้ เพราะรถจอดนิ่งจะมีเวลาพิกัดไม่เปลี่ยน
  if (trip.lastGpsAt && Date.parse(pos.time) < Date.parse(trip.lastGpsAt)) return null;
  const prev = trip.lastPos && Date.parse(trip.lastPos.time) > 0 ? trip.lastPos : null;
  trip.lastGpsAt = pos.time;
  trip.lastPos = { lat: pos.lat, lng: pos.lng, speed: pos.speed || 0, time: pos.time };

  const pickup = stations.find((s) => s.id === trip.pickupStationId);
  const delivery = stations.find((s) => s.id === trip.deliveryStationId);
  let last = null;

  // ตรวจย้อน: เส้นจากตำแหน่งรอบก่อนมารอบนี้ตัดผ่านสถานี โดยไม่มีจุดไหนอยู่ใน polygon (ขับผ่านเร็ว/รอบ GPS ห่าง)
  if (prev) {
    const t0 = Date.parse(prev.time), gap = Date.parse(pos.time) - t0;
    if (gap > 0 && gap <= MAX_GAP_MIN * 60000) {
      const hits = [];
      for (const st of [pickup, delivery]) {
        if (!st || !st.polygon || hits.some((h) => h.st.id === st.id)) continue;
        if (pointInPolygon(prev.lat, prev.lng, st.polygon) || pointInPolygon(pos.lat, pos.lng, st.polygon)) continue;
        const span = segmentPolygonSpan(prev.lat, prev.lng, pos.lat, pos.lng, st.polygon);
        if (span) hits.push({ st, ...span });
      }
      hits.sort((a, b) => a.tIn - b.tIn);
      for (const h of hits) {
        const mk = (f, inside) => ({
          lat: prev.lat + (pos.lat - prev.lat) * f, lng: prev.lng + (pos.lng - prev.lng) * f,
          time: new Date(t0 + gap * f).toISOString(), virt: { id: h.st.id, inside }
        });
        last = observe(trip, pickup, delivery, mk(h.tIn, true), prev) || last;
        last = observe(trip, pickup, delivery, mk(h.tOut, false), prev) || last;
      }
    }
  }
  return observe(trip, pickup, delivery, { lat: pos.lat, lng: pos.lng, time: pos.time }, prev) || last;
}


// ---------- Eup API ----------
// logDTime เป็นเวลาท้องถิ่น (ไม่มี offset) → ต้องระบุโซนเวลา ไม่งั้นเซิร์ฟเวอร์ (UTC) จะเพี้ยน 7 ชม.
export function toIso(v, tz) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v).toISOString();
  let s = String(v).trim().replace(' ', 'T');
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(s)) s += tz;
  const t = Date.parse(s);
  return t > 0 ? new Date(t).toISOString() : null;
}

async function eupLogin(base, token, fetchFn) {
  const r = await fetchFn(`${base}/login/session?token=${encodeURIComponent(token)}`, { method: 'POST' });
  const j = await r.json().catch(() => null);
  if (r.status === 401 || r.status === 403) throw new Error('Token GPS ไม่ถูกต้อง/ไม่มีสิทธิ์ (HTTP ' + r.status + ')');
  if (!r.ok) throw new Error('ล็อกอิน GPS ไม่สำเร็จ HTTP ' + r.status);
  const res = j && j.result;
  const candidates = [res && res.sessionId, res && res.token].filter(Boolean);
  if (!candidates.length) throw new Error('ล็อกอินแล้วแต่ไม่พบ sessionId');
  return candidates;
}

async function eupCarStatus(base, candidates, plate, fetchFn) {
  for (const bearer of candidates) {
    const r = await fetchFn(`${base}/car/log_data/car_status?carNumber=${encodeURIComponent(plate)}`, { headers: { Authorization: 'Bearer ' + bearer } });
    if (r.status === 401 || r.status === 403) continue; // ลองค่าสำรอง (token แทน sessionId)
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json().catch(() => null);
    return (j && j.result) || [];
  }
  throw new Error('GPS ปฏิเสธการเข้าถึง');
}

export function toRecord(dto, plate, tz) {
  const lat = Number(dto.logGisy) / 1e6, lng = Number(dto.logGisx) / 1e6;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (!lat && !lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { plate, lat, lng, speed: Number(dto.logSpeed) || 0, time: toIso(dto.logDTime, tz) || new Date().toISOString() };
}

// ---------- Supabase REST ----------
function makeDb(cfg, fetchFn) {
  const headers = { apikey: cfg.serviceKey, Authorization: 'Bearer ' + cfg.serviceKey, 'Content-Type': 'application/json' };
  const call = (path, init) => fetchFn(`${cfg.url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...((init && init.headers) || {}) } });
  return {
    async list() {
      const r = await call('docs?select=kind,id,data,rev&kind=in.(trip,station,state)');
      if (!r.ok) throw new Error('อ่านฐานข้อมูลไม่ได้ HTTP ' + r.status);
      return r.json();
    },
    // true = เขียนสำเร็จ, false = มีคนแก้ก่อน (rev ไม่ตรง)
    async patchTrip(key, rev, data) {
      const r = await call(`docs?kind=eq.trip&id=eq.${encodeURIComponent(key)}&rev=eq.${rev}`, {
        method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, rev: rev + 1 })
      });
      if (!r.ok) throw new Error('เขียนเที่ยวไม่ได้ HTTP ' + r.status);
      const j = await r.json();
      return Array.isArray(j) && j.length > 0;
    },
    async upsert(rows) {
      if (!rows.length) return;
      const r = await call('docs?on_conflict=kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
      if (!r.ok) throw new Error('เขียนตำแหน่ง/สถานะไม่ได้ HTTP ' + r.status);
    }
  };
}

// ---------- งานหลัก ----------
// cfg = { url, serviceKey, eupBase, eupToken, tz }
export async function runPoll(cfg, fetchFn) {
  const db = makeDb(cfg, fetchFn);
  const status = { at: new Date().toISOString(), ok: false, message: '', tracked: 0, matched: 0, events: 0, conflicts: 0 };
  try {
    const rows = await db.list();
    const stations = rows.filter((r) => r.kind === 'station').map((r) => r.data);
    const stateRow = rows.find((r) => r.kind === 'state' && r.id === 'poller');
    const state = { trips: {}, ...((stateRow && stateRow.data) || {}) };
    const cutoff = new Date(Date.now() - TRACK_DAYS * 86400000).toISOString().slice(0, 10);
    const tracked = rows.filter((r) => r.kind === 'trip' && r.data && !r.data._deleted && r.data.status !== 'done' && r.data.date >= cutoff);
    status.tracked = tracked.length;
    if (!tracked.length) {
      status.ok = true; status.message = 'ไม่มีเที่ยวที่ต้องติดตาม';
      // ต้องรายงานสถานะด้วย ไม่งั้น Extension จะคิดว่าตัวดึงบนคลาวด์ไม่ทำงาน (ขึ้น "GPS ผิดพลาด")
      try { await db.upsert([{ kind: 'status', id: 'poller', data: status, rev: 0 }]); } catch (e) { /* ไม่เป็นไร */ }
      return status;
    }
    if (!cfg.eupToken) throw new Error('ยังไม่ได้ตั้ง EUP_TOKEN');

    const plates = [...new Set(tracked.map((r) => r.data.plate))];
    const candidates = await eupLogin(cfg.eupBase, cfg.eupToken, fetchFn);
    const records = [], errors = [];
    for (const plate of plates) {
      try {
        const rec = (await eupCarStatus(cfg.eupBase, candidates, plate, fetchFn)).map((d) => toRecord(d, plate, cfg.tz)).find(Boolean);
        if (rec) records.push(rec); else errors.push(`${plate}: ไม่พบพิกัด`);
      } catch (e) { errors.push(`${plate}: ${e.message}`); }
    }

    const posRows = [];
    for (const row of tracked) {
      const rec = records.find((r) => plateMatches(row.data.plate, r.plate));
      if (!rec) continue;
      status.matched++;
      // รถคันเดียวมีได้หลายเที่ยว: ส่งตำแหน่งทะเบียนละแถว ไม่งั้น upsert ซ้ำแถวเดียวกันแล้ว Postgres ปฏิเสธทั้งชุด (HTTP 500)
      if (!posRows.some((p) => p.id === row.data.plate)) posRows.push({ kind: 'pos', id: row.data.plate, data: { lat: rec.lat, lng: rec.lng, speed: rec.speed, time: rec.time }, rev: 0 });

      const key = row.id;
      const saved = state.trips[key] || {};
      const work = { ...row.data, pending: saved.pending, lastGpsAt: saved.lastGpsAt, lastPos: saved.lastPos };
      if (!work.pending) delete work.pending;
      const ev = applyPosition(work, stations, rec);

      const { pending, lastGpsAt, lastPos, ...data } = work;
      if (ev) {
        if (await db.patchTrip(key, row.rev, data)) { status.events++; state.trips[key] = { pending, lastGpsAt, lastPos }; }
        else status.conflicts++; // มีคนแก้เที่ยวนี้ก่อน → ไม่บันทึกสถานะ รอบหน้าตรวจใหม่จากข้อมูลล่าสุด
      } else {
        state.trips[key] = { pending, lastGpsAt, lastPos };
      }
    }
    // เก็บสถานะของตัวดึงเฉพาะเที่ยวที่ยังติดตามอยู่
    const live = new Set(tracked.map((r) => r.id));
    for (const k of Object.keys(state.trips)) if (!live.has(k)) delete state.trips[k];

    await db.upsert([...posRows, { kind: 'state', id: 'poller', data: state, rev: 0 }]);
    status.ok = true;
    status.message = `พบพิกัด ${records.length}/${plates.length} คัน · ตรงกับเที่ยว ${status.matched}/${status.tracked}` +
      (errors.length ? ` · ผิดพลาด: ${errors.slice(0, 3).join('; ')}` : '') + (status.conflicts ? ` · ชนกับคนแก้ ${status.conflicts}` : '');
  } catch (e) {
    status.message = e.message;
  }
  try { await db.upsert([{ kind: 'status', id: 'poller', data: status, rev: 0 }]); } catch (e) { /* รายงานสถานะไม่ได้ ไม่เป็นไร */ }
  return status;
}

// ---------- entry (Deno / Supabase) ----------
if (typeof Deno !== 'undefined') {
  Deno.serve(async (req) => {
    // trim ทั้งสองฝั่ง: ช่อง secret ใน dashboard มักติดบรรทัดใหม่ท้ายค่ามาด้วย
    const secret = (Deno.env.get('CRON_SECRET') || '').trim();
    if (!secret || (req.headers.get('x-cron-secret') || '').trim() !== secret) return new Response('forbidden', { status: 403 });
    const out = await runPoll({
      url: Deno.env.get('SUPABASE_URL'),
      serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
      eupBase: (Deno.env.get('EUP_BASE') || 'https://th-slt.eupfin.com/Eup_Servlet_API_SOAP').replace(/\/+$/, ''),
      eupToken: (Deno.env.get('EUP_TOKEN') || '').trim(),
      tz: Deno.env.get('GPS_TZ') || '+07:00'
    }, fetch);
    return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
  });
}

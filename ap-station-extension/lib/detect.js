// ตรวจจับเข้า-ออกสถานีจากพิกัด GPS แล้วเลื่อนสถานะของเที่ยว (ฟังก์ชันล้วน ไม่แตะ storage)
(function (root) {
  const Geo = root.Geo || require('./geo.js');
  const CONFIRM = 2; // ต้องเจอผลตรงกันติดกัน 2 ครั้งถึงนับ กัน GPS กระโดด

  const normPlate = (s) => String(s || '').toLowerCase().replace(/[\s\-_.]/g, '');

  // ทะเบียนในเที่ยว กับชื่อรถจาก GPS (อาจมีจังหวัดต่อท้าย) ถือว่าตรงกันถ้าอย่างใดอย่างหนึ่งมีอีกอันอยู่ข้างใน
  function plateMatches(tripPlate, gpsPlate) {
    const a = normPlate(tripPlate), b = normPlate(gpsPlate);
    return !!a && !!b && (a === b || b.includes(a) || a.includes(b));
  }

  // obs.virt = { id, inside } คือการสังเกตสมมติ (รถขับผ่านสถานีระหว่างรอบ GPS) ใช้แทนผลตรวจ polygon
  const inside = (st, lat, lng, obs) => {
    if (!st || !st.polygon) return false;
    if (obs && obs.virt) return st.id === obs.virt.id && obs.virt.inside;
    return Geo.pointInPolygon(lat, lng, st.polygon);
  };

  // สถานะถัดไปที่ตำแหน่งนี้บ่งชี้ (หรือ null ถ้ายังไม่เปลี่ยน) พร้อมชนิดเหตุการณ์
  // prev = ตำแหน่งรอบก่อนหน้า (ใช้กันรถที่จอดค้างในสถานีส่งอยู่ก่อนเริ่มเที่ยว)
  function candidate(trip, pickup, delivery, lat, lng, obs, prev) {
    const at = (st) => inside(st, lat, lng, obs);
    switch (trip.status) {
      case 'waiting_pickup':
        if (pickup && at(pickup)) return { status: 'at_pickup', type: 'pick_in', stationId: pickup.id };
        // พลาดจุดรับ: รถเข้าจุดส่งก่อน (ต้องเห็นรถอยู่นอกจุดส่งมาก่อน ไม่ใช่จอดค้างจากเที่ยวก่อน) → จับจุดส่งต่อเลย จุดรับเป็น "ไม่ทราบเวลา"
        if (delivery && at(delivery) && (obs.virt || (trip.pending && trip.pending.status === 'at_delivery') || (prev && !Geo.pointInPolygon(prev.lat, prev.lng, delivery.polygon || [])))) {
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
  function applyPosition(trip, stations, pos) {
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
          if (Geo.pointInPolygon(prev.lat, prev.lng, st.polygon) || Geo.pointInPolygon(pos.lat, pos.lng, st.polygon)) continue;
          const span = Geo.segmentPolygonSpan(prev.lat, prev.lng, pos.lat, pos.lng, st.polygon);
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

  const ROAD_FACTOR = 1.3;      // ถนนจริงยาวกว่าเส้นตรงโดยประมาณ
  const MOVING_KMH = 20;        // เร็วกว่านี้ถือว่ากำลังวิ่ง ใช้ความเร็วจริงจาก GPS
  const STALE_MIN = 10;         // พิกัดเก่ากว่านี้ถือว่าไม่สด

  // สถานีที่รถกำลังมุ่งหน้าไป (null ถ้าอยู่ในสถานีหรือจบแล้ว)
  function targetStation(trip, stations) {
    const id = trip.status === 'waiting_pickup' ? trip.pickupStationId
      : (trip.status === 'pending_pickup_entry' || trip.status === 'waiting_delivery') ? trip.deliveryStationId : null;
    return id ? stations.find((s) => s.id === id) || null : null;
  }

  // ประมาณเวลาถึงสถานีถัดไปจากพิกัดล่าสุด: ระยะถึงขอบ polygon × 1.3 ÷ ความเร็ว
  // คืน { station, center, km, minutes, eta (ISO), stale, speedKmh } หรือ null ถ้าคำนวณไม่ได้
  function eta(trip, stations, settings) {
    const st = targetStation(trip, stations);
    const p = trip.lastPos;
    if (!st || !st.polygon || !p) return null;
    const center = Geo.centroid(st.polygon);
    const meters = Geo.distToPolygonM(p.lat, p.lng, st.polygon);
    if (meters == null || !center) return null;
    const speedKmh = p.speed >= MOVING_KMH ? p.speed : ((settings && settings.etaSpeedKmh) || 40);
    const km = (meters * ROAD_FACTOR) / 1000;
    const minutes = (km / speedKmh) * 60;
    const base = Date.parse(p.time);
    return {
      station: st, center, km, minutes, speedKmh, moving: p.speed >= MOVING_KMH,
      eta: new Date(base + minutes * 60000).toISOString(),
      stale: Date.now() - base > STALE_MIN * 60000
    };
  }

  const api = { eta, targetStation, applyPosition, plateMatches, normPlate, CONFIRM };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  else root.Detect = api;
})(this);

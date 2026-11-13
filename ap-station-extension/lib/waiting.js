// Waiting Time ที่จุดรับงาน: รอฟรีช่วงแรก ส่วนที่เกินปัดเป็นชั่วโมงที่คิดเงินได้ตามกติกา
//   ส่วนเกิน < 40 นาที            → 0
//   40–60 นาที                    → 1 ชม.
//   เกิน 1 ชม. แล้ว เศษ 0         → ชั่วโมงเต็ม
//   เศษ 1–40 นาที                 → +0.5 ชม. (เช่น 1.30)
//   เศษเกิน 40 นาที               → ปัดขึ้นเป็นชั่วโมงเต็มถัดไป (เช่น 1.40 → 2)
(function (root) {
  const DEFAULTS = { freeHours: 3, ratePerHour: 30, graceMin: 40 };

  // excessMin = นาทีที่เกินช่วงฟรี → ชั่วโมงที่คิดเงิน
  function billableHours(excessMin, graceMin) {
    const g = graceMin == null ? DEFAULTS.graceMin : graceMin;
    if (!(excessMin > 0) || excessMin < g) return 0;
    const n = Math.floor(excessMin / 60);
    const r = excessMin - n * 60;
    if (n === 0) return 1;
    if (r === 0) return n;
    return r <= g ? n + 0.5 : n + 1;
  }

  // stayMin = เวลาที่อยู่จุดรับทั้งหมด (นาที)
  function calc(stayMin, opts) {
    const o = { ...DEFAULTS, ...(opts || {}) };
    const excess = Math.max(0, stayMin - o.freeHours * 60);
    const hours = billableHours(excess, o.graceMin);
    return { stayMin, excessMin: excess, hours, amount: hours * o.ratePerHour };
  }

  // เที่ยวหนึ่ง: เริ่มนับตอนเข้าจุดรับ จบตอนออกจุดรับ (ถ้ายังอยู่ ใช้เวลาปัจจุบัน) คืน null ถ้ายังไม่เข้าจุดรับ
  function forTrip(trip, opts, now) {
    const ev = (type) => (trip.events || []).find((e) => e.type === type);
    const inE = ev('pick_in'), outE = ev('pick_out');
    if (!inE) return null;
    const start = Date.parse(inE.at);
    const end = outE ? Date.parse(outE.at) : (now || Date.now());
    if (!(start > 0) || !(end >= start)) return null;
    return { ...calc((end - start) / 60000, opts), ongoing: !outE };
  }

  const api = { billableHours, calc, forTrip, DEFAULTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Waiting = api;
})(this);

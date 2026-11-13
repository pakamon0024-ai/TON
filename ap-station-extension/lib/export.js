// สร้างตารางข้อมูลสำหรับส่งออก Excel (ฟังก์ชันล้วน ไม่แตะ XLSX/DOM เพื่อทดสอบได้)
(function (root) {
  const Waiting = root.Waiting || (typeof require !== 'undefined' ? require('./waiting.js') : null);

  const STATUS = {
    waiting_pickup: 'รอขึ้นงาน', at_pickup: 'รอขึ้นงาน', pending_pickup_entry: 'รอกรอกขึ้นงาน',
    waiting_delivery: 'รอส่งงาน', at_delivery: 'รอลงงาน', pending_delivery_entry: 'รอบันทึกเว็บลูกค้า', done: 'บันทึกเว็บลูกค้าแล้ว'
  };
  const pad = (n) => String(n).padStart(2, '0');
  const thDT = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const thDate = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const evAt = (t, type) => ((t.events || []).find((e) => e.type === type) || {}).at;
  const hoursText = (h) => (h ? (Math.floor(h) + (h % 1 ? '.30' : '')) : '0');

  // trips = เที่ยวที่จะส่งออก (เรียงตามวันที่/ลำดับให้แล้ว) · คืน { trips, hawbs, days } เป็น array ของแถว (แถวแรก = หัวคอลัมน์)
  function buildSheets(trips, stations, settings, now) {
    const st = (id) => (stations.find((s) => s.id === id) || {}).name || '';
    const wopts = { freeHours: settings.waitFreeHours, ratePerHour: settings.waitRate };

    const tripRows = [[
      'วันที่', 'ลำดับ', 'ทะเบียน', 'คนขับ', 'สถานีรับ', 'สถานีส่ง', 'จำนวน HAWB', 'HAWB', 'สถานะ',
      'เข้าจุดรับ (GPS)', 'ออกจุดรับ (GPS)', 'เข้าจุดส่ง (GPS)', 'ออกจุดส่ง (GPS)',
      'อยู่จุดรับ (นาที)', 'Waiting ที่คิดเงิน (ชม.)', 'Waiting เงิน (บาท)', 'หมายเหตุ Waiting',
      'กรอกขึ้นงานแล้วเมื่อ', 'กรอกส่งงานแล้วเมื่อ'
    ]];
    const hawbRows = [['วันที่', 'ทะเบียน', 'คนขับ', 'สถานีรับ', 'สถานีส่ง', 'HAWB', 'Packing No.', 'Total', 'สถานะเที่ยว']];
    const byDay = new Map();

    for (const t of trips) {
      const w = Waiting.forTrip(t, wopts, now);
      tripRows.push([
        thDate(t.date), t.no || '', t.plate, t.driver || '', st(t.pickupStationId), st(t.deliveryStationId),
        t.hawbs.length, t.hawbs.map((h) => h.hawb).join(' '), STATUS[t.status] || t.status,
        thDT(evAt(t, 'pick_in')), thDT(evAt(t, 'pick_out')), thDT(evAt(t, 'del_in')), thDT(evAt(t, 'del_out')),
        w ? Math.round(w.stayMin) : '', w ? w.hours : '', w ? w.amount : '', w && w.ongoing ? 'ยังอยู่จุดรับ (นับถึงเวลาที่ส่งออก)' : '',
        thDT(evAt(t, 'pick_filled')), thDT(evAt(t, 'del_filled'))
      ]);
      for (const h of t.hawbs) {
        hawbRows.push([thDate(t.date), t.plate, t.driver || '', st(t.pickupStationId), st(t.deliveryStationId),
          h.hawb, h.packingNo || '', h.total || '', STATUS[t.status] || t.status]);
      }
      const d = byDay.get(t.date) || { trips: 0, hawb: 0, done: 0, hours: 0, amount: 0 };
      d.trips++; d.hawb += t.hawbs.length; if (t.status === 'done') d.done++;
      if (w) { d.hours += w.hours; d.amount += w.amount; }
      byDay.set(t.date, d);
    }

    const dayRows = [['วันที่', 'จำนวนเที่ยว', 'จำนวน HAWB', 'เที่ยวเสร็จสิ้น', 'Waiting รวม (ชม.)', 'Waiting รวม (บาท)']];
    const total = { trips: 0, hawb: 0, done: 0, hours: 0, amount: 0 };
    for (const date of [...byDay.keys()].sort()) {
      const d = byDay.get(date);
      dayRows.push([thDate(date), d.trips, d.hawb, d.done, d.hours, d.amount]);
      for (const k of Object.keys(total)) total[k] += d[k];
    }
    if (byDay.size > 1) dayRows.push(['รวม', total.trips, total.hawb, total.done, total.hours, total.amount]);
    return { trips: tripRows, hawbs: hawbRows, days: dayRows };
  }

  const api = { buildSheets, hoursText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Exporter = api;
})(this);

// อ่านไฟล์ "Truck Detail" (CSV/XLSX ที่แปลงเป็นแถวแล้ว) → รายการเที่ยว
// ไม่อ่านคอลัมน์เลขบัตรประชาชนและเบอร์โทรเลย (PDPA)
(function (root) {
  const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
    'มกราคม': 1, 'กุมภาพันธ์': 2, 'มีนาคม': 3, 'เมษายน': 4, 'พฤษภาคม': 5, 'มิถุนายน': 6,
    'กรกฎาคม': 7, 'สิงหาคม': 8, 'กันยายน': 9, 'ตุลาคม': 10, 'พฤศจิกายน': 11, 'ธันวาคม': 12
  };
  const MAX_HAWB_PER_TRIP = 12;

  const clean = (v) => String(v == null ? '' : v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  const norm = (v) => clean(v).toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');

  // HAWB: เอาเฉพาะตัวเลข ตัดท้าย /BKK ถ้ามี
  function normalizeHawb(v) {
    const s = clean(v).split('/')[0].replace(/\s/g, '');
    return /^\d{6,}$/.test(s) ? s : '';
  }

  function normalizePlate(v) {
    return clean(v).replace(/\s*-\s*/g, '-');
  }

  function findTripDate(rows) {
    for (let r = 0; r < Math.min(rows.length, 4); r++) {
      const text = rows[r].map(clean).join(' ');
      if (!/date/i.test(text) && !/วันที่/.test(text)) continue;
      const m = text.match(/(\d{1,2})\s+([A-Za-zก-๙]+)\.?\s+(\d{4})/);
      if (m) {
        const mon = MONTHS[m[2].toLowerCase()];
        let year = parseInt(m[3], 10);
        if (year > 2400) year -= 543; // ปี พ.ศ.
        if (mon) return `${year}-${pad(mon)}-${pad(m[1])}`;
      }
      const d = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (d) {
        let year = parseInt(d[3], 10);
        if (year > 2400) year -= 543;
        return `${year}-${pad(d[2])}-${pad(d[1])}`;
      }
    }
    return '';
  }

  function findHeader(rows) {
    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const cells = rows[r].map((c) => norm(c));
      if (!cells.includes('hawb')) continue;
      const all = (name) => cells.reduce((a, c, i) => (c === name ? a.concat(i) : a), []);
      const first = (pred) => cells.findIndex(pred);
      const ins = all('in');
      const outs = all('out');
      return {
        row: r,
        no: first((c) => c === 'no.' || c === 'no' || c === 'ลำดับ'),
        packing: first((c) => c.startsWith('packing')),
        hawb: first((c) => c === 'hawb'),
        total: first((c) => c === 'total'),
        route: first((c) => c === 'pick up' || c === 'pickup' || c === 'เส้นทาง'),
        truck: first((c) => c === 'truck' || c === 'ทะเบียน'),
        driver: first((c) => c === 'driver' || c === 'พนักงานขับรถ'),
        remark: first((c) => c === 'remark' || c === 'หมายเหตุ'),
        pickIn: ins[0] ?? -1,
        pickOut: outs[0] ?? -1,
        delIn: ins[1] ?? -1,
        delOut: outs[1] ?? -1
      };
    }
    return null;
  }

  function matchRoute(routeText, routes) {
    const t = norm(routeText);
    if (!t) return null;
    let best = null;
    for (const r of routes || []) {
      const p = norm(r.pattern);
      if (!p) continue;
      const ok = r.match === 'exact' ? t === p : t.startsWith(p);
      if (ok && (!best || p.length > norm(best.pattern).length)) best = r;
    }
    return best;
  }

  // "2:15" = เวลาในวันเที่ยว, "2:15 (29/10)" = เวลา 02:15 ของวันที่ 29/10 (มักเป็นข้ามวัน)
  // คืน 'YYYY-MM-DDTHH:MM' (เวลาท้องถิ่น) หรือ '' ถ้าอ่านไม่ได้
  function parseClock(text, tripDate) {
    const m = clean(text).match(/(\d{1,2})[:.](\d{2})(?:\s*\(\s*(\d{1,2})\/(\d{1,2})\s*\))?/);
    if (!m || +m[1] > 23 || +m[2] > 59) return '';
    let date = tripDate;
    if (m[3]) {
      if (!tripDate) return '';
      let y = +tripDate.slice(0, 4);
      const tripMonth = +tripDate.slice(5, 7), mon = +m[4];
      if (tripMonth - mon > 6) y++;      // ธ.ค. → ม.ค.
      else if (mon - tripMonth > 6) y--; // ม.ค. → ธ.ค.
      date = `${y}-${pad(mon)}-${pad(m[3])}`;
    }
    return date ? `${date}T${pad(m[1])}:${m[2]}` : '';
  }

  // rows: array ของ array (ทุกเซลล์เป็น string)
  function parseTruckDetail(rows, opts) {
    opts = opts || {};
    const result = { tripDate: '', trips: [], skipped: [], warnings: [], errors: [] };
    rows = (rows || []).map((r) => (Array.isArray(r) ? r : []));
    result.tripDate = findTripDate(rows);
    if (!result.tripDate) result.warnings.push({ type: 'no-date', text: 'ไม่พบวันที่รับงานในหัวไฟล์ กรุณาเลือกวันที่เอง' });

    const h = findHeader(rows);
    if (!h || h.hawb < 0 || h.truck < 0 || h.no < 0) {
      result.errors.push('ไม่พบหัวคอลัมน์ No. / HAWB / Truck ในไฟล์ — ไฟล์นี้ไม่ใช่รูปแบบ Truck Detail');
      return result;
    }
    const cell = (row, idx) => (idx >= 0 ? clean(row[idx]) : '');

    let current = null;
    let block = 0;
    const all = [];
    for (let r = h.row + 1; r < rows.length; r++) {
      const row = rows[r];
      const no = cell(row, h.no);
      const remark = cell(row, h.remark);
      const hawb = normalizeHawb(cell(row, h.hawb));
      if (no) {
        block++;
        current = {
          block,
          no,
          sourceRow: r + 1,
          routeText: cell(row, h.route),
          plate: normalizePlate(cell(row, h.truck)),
          driver: cell(row, h.driver),
          cancelled: false,
          remarks: [],
          manual: {
            pickIn: cell(row, h.pickIn), pickOut: cell(row, h.pickOut),
            delIn: cell(row, h.delIn), delOut: cell(row, h.delOut)
          },
          hawbs: []
        };
        all.push(current);
      }
      if (!current) continue;
      // บางไฟล์ทะเบียน/คนขับอยู่แถวที่สองของเที่ยว (แถวแรกมีแค่เลข No.) เติมจากแถวต่อ ๆ ไปถ้ายังว่าง
      if (!current.plate) current.plate = normalizePlate(cell(row, h.truck));
      if (!current.driver) current.driver = cell(row, h.driver);
      if (remark) {
        current.remarks.push(remark);
        if (/ยกเลิก|cancel/i.test(remark)) current.cancelled = true;
      }
      if (hawb) {
        current.hawbs.push({
          hawb,
          packingNo: cell(row, h.packing),
          total: cell(row, h.total),
          sourceRow: r + 1
        });
      }
    }

    const date = opts.tripDate || result.tripDate;
    for (const t of all) {
      t.key = `${date}|${t.plate}|${t.block}`;
      t.date = date;
      t.manualAt = {};
      for (const k of Object.keys(t.manual)) t.manualAt[k] = parseClock(t.manual[k], date);
      if (t.cancelled) { result.skipped.push({ trip: t, reason: 'ยกเลิก' }); continue; }
      // ไม่มี HAWB: ถ้าเส้นทางตรงกับที่ตั้งไว้ (QMB/Mentor) ถือว่าเป็นงานของเรา รอ HAWB ภายหลัง; ถ้าไม่รู้จักเส้นทางถือว่าไม่ใช่งาน Expeditors
      t.noHawb = !t.hawbs.length;
      if (t.noHawb && !matchRoute(t.routeText, opts.routes)) { result.skipped.push({ trip: t, reason: 'ไม่มี HAWB (ไม่ใช่งาน Expeditors)' }); continue; }
      if (!t.plate) { result.skipped.push({ trip: t, reason: 'ไม่มีทะเบียนรถ' }); continue; }
      result.trips.push(t);
    }

    // HAWB ซ้ำข้ามเที่ยว
    const seen = new Map();
    for (const t of result.trips) {
      for (const hw of t.hawbs) {
        if (!seen.has(hw.hawb)) seen.set(hw.hawb, []);
        seen.get(hw.hawb).push(t.key);
      }
    }
    result.duplicates = [];
    for (const [hawb, keys] of seen) {
      const uniq = [...new Set(keys)];
      if (keys.length > 1) result.duplicates.push({ hawb, tripKeys: uniq });
    }

    for (const t of result.trips) {
      if (t.hawbs.length > MAX_HAWB_PER_TRIP) {
        result.warnings.push({ type: 'too-many', tripKey: t.key, text: `รถ ${t.plate} มี ${t.hawbs.length} HAWB เกิน ${MAX_HAWB_PER_TRIP}` });
      }
      const route = matchRoute(t.routeText, opts.routes);
      t.routeId = route ? route.id : null;
    }
    result.unknownRoutes = [...new Set(result.trips.filter((t) => !t.routeId).map((t) => t.routeText))];
    return result;
  }

  const api = { parseTruckDetail, parseClock,matchRoute, normalizeHawb, normalizePlate, MAX_HAWB_PER_TRIP };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TruckParser = api;
})(this);

/* global L, XLSX, Geo, TruckParser, Store, CcSync */
(async function () {
  'use strict';

  // ป้ายสถานะที่แสดง: รถยังไม่ออกจากจุดรับ (ทั้งยังไม่ถึงและอยู่ในสถานี) = รอขึ้นงาน, ยังไม่ออกจากจุดส่ง = รอลงงาน
  const STATUS = {
    waiting_pickup: 'รอขึ้นงาน',
    at_pickup: 'รอขึ้นงาน',
    pending_pickup_entry: 'รอกรอกขึ้นงาน',
    waiting_delivery: 'รอส่งงาน',
    at_delivery: 'รอลงงาน',
    pending_delivery_entry: 'รอบันทึกเว็บลูกค้า',
    done: 'บันทึกเว็บลูกค้าแล้ว'
  };
  // ตัวเลือกในหน้าแก้ไข ต้องแยกให้ชัดเพราะป้ายซ้ำกันได้
  const EDIT_STATUS = {
    waiting_pickup: 'รอขึ้นงาน (ยังไม่ถึงจุดรับ)',
    at_pickup: 'รอขึ้นงาน (อยู่ในจุดรับ)',
    pending_pickup_entry: STATUS.pending_pickup_entry,
    waiting_delivery: STATUS.waiting_delivery,
    at_delivery: 'รอลงงาน (อยู่ในจุดส่ง)',
    pending_delivery_entry: STATUS.pending_delivery_entry,
    done: STATUS.done
  };
  const statusLabel = (s) => STATUS[s] || s;

  let db = await Store.load();
  let importState = null;

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = (p) => p + '-' + Math.random().toString(36).slice(2, 9);
  const stationById = (id) => db.stations.find((s) => s.id === id);
  const routeById = (id) => db.routes.find((r) => r.id === id);
  const completeRoutes = () => db.routes.filter((r) => r.pattern && r.pickupStationId && r.deliveryStationId);
  const todayStr = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const thDate = (iso) => { if (!iso) return '-'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };

  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2600);
  }

  async function persist(keys) {
    const patch = {};
    for (const k of keys) patch[k] = db[k];
    await Store.save(patch);
    if (keys.some((k) => SYNCED.includes(k))) kickSync();
  }

  // แก้ข้อมูลที่แชร์ → ให้ background ซิงก์ (รวมการแก้ถี่ ๆ เป็นรอบเดียว)
  const SYNCED = ['trips', 'stations', 'routes'];
  let syncTimer = null;
  function kickSync() {
    if (!(db.settings.syncUrl && db.settings.syncKey) || typeof chrome === 'undefined' || !chrome.runtime) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { chrome.runtime.sendMessage({ type: 'sync-now' }).catch(() => {}); }, 800);
  }

  function stationOptions(selectedId, type) {
    const list = db.stations.filter((s) => !type || s.type === type);
    return '<option value="">— เลือก —</option>' + list.map((s) =>
      `<option value="${esc(s.id)}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  // ---------- แท็บ ----------
  let mapReady = false;
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  function showTab(name) {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
    if (name === 'trips') renderTrips();
    if (name === 'stations') { if (!mapReady) initMap(); setTimeout(() => map.invalidateSize(), 50); renderStations(); }
    if (name === 'cc') renderCc();
    if (name === 'routes') renderRoutes();
    if (name === 'settings') renderSettings();
    try { localStorage.setItem('ap.lastTab', name); } catch (e) { /* ไม่สำคัญ */ }
  }

  // ---------- เที่ยวงาน ----------
  function defaultTripDate() {
    const dates = [...new Set(db.trips.map((t) => t.date))].sort();
    return dates.includes(todayStr()) ? todayStr() : (dates[dates.length - 1] || todayStr());
  }
  $('trips-date').value = defaultTripDate();
  $('trips-date').addEventListener('change', renderTrips);

  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '-');
  // เวลา + วันในวงเล็บ (d/m) เมื่อไม่ใช่วันเดียวกับเที่ยว เช่น 02:15 (29/10)
  function hhmmDay(iso, tripDate) {
    if (!iso) return '-';
    const d = new Date(iso);
    const day = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    return hhmm(iso) + (day !== tripDate ? ` (${+day.slice(8)}/${+day.slice(5, 7)})` : '');
  }
  function gpsTimes(t) {
    const at = (type) => hhmmDay(((t.events || []).find((e) => e.type === type) || {}).at, t.date);
    let where = '';
    if (t.lastPos) {
      const hit = db.stations.find((s) => s.polygon && Geo.pointInPolygon(t.lastPos.lat, t.lastPos.lng, s.polygon));
      where = `<div class="muted">ล่าสุด ${hhmmDay(t.lastPos.time, t.date)} · ${hit ? 'ใน ' + esc(hit.name) : 'นอกสถานี'}` +
        `${t.pending ? ` · รอยืนยัน ${t.pending.count}` : ''}</div>`;
      const e = Detect.eta(t, db.stations, db.settings);
      if (e) {
        const [clat, clng] = e.center;
        where += `<div title="พิกัดกลางสถานี ${clat.toFixed(5)}, ${clng.toFixed(5)} · คำนวณจากระยะเส้นตรง×1.3 ÷ ${Math.round(e.speedKmh)} กม./ชม.${e.moving ? ' (ความเร็วจริง)' : ' (ค่าตั้งต้น)'}">` +
          `<b>ETA ${esc(e.station.name)} ${hhmmDay(e.eta, t.date)}</b> <span class="muted">· ${e.km.toFixed(1)} กม. · ~${Math.max(1, Math.round(e.minutes))} นาที${e.stale ? ' · พิกัดไม่สด' : ''}</span></div>`;
      }
    } else where = '<div class="muted">ยังไม่มีพิกัด</div>';
    // ข้ามจุดรับไปแล้ว (อยู่จุดส่ง/ออกจุดส่ง/เสร็จ) แต่ไม่มีเวลาเข้า-ออกจุดรับ = GPS พลาด ให้แสดง "ไม่ทราบ" แล้วแก้เวลาเองได้ที่ปุ่มแก้ไข
    const pastPickup = ['at_delivery', 'pending_delivery_entry', 'done'].includes(t.status);
    const tm = (type, cls) => {
      const v = at(type);
      if (v === '-' && pastPickup && (type === 'pick_in' || type === 'pick_out')) {
        return '<span class="tm unk" title="GPS ไม่ได้จับเวลาจุดรับ — กดแก้ไขเพื่อใส่เวลาเอง">ไม่ทราบเวลา</span>';
      }
      return `<span class="tm ${v === '-' ? 'none' : cls}">${v}</span>`;
    };
    return `<div class="tm-row"><b>รับ</b> เข้า ${tm('pick_in', 'in')} ออก ${tm('pick_out', 'out')}</div>` +
      `<div class="tm-row"><b>ส่ง</b> เข้า ${tm('del_in', 'in')} ออก ${tm('del_out', 'out')}</div>${where}`;
  }

  // กรอกเว็บลูกค้าเสร็จแล้ว → เลื่อนไปขั้นถัดไป
  const NEXT_AFTER_FILL = { pending_pickup_entry: 'waiting_delivery', pending_delivery_entry: 'done' };
  const EVENT_TYPES = ['pick_in', 'pick_out', 'del_in', 'del_out'];
  const toLocalInput = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  let editingKey = null;

  function openEdit(key) {
    const t = db.trips.find((x) => x.key === key);
    if (!t) return;
    editingKey = key;
    $('edit-title').textContent = `แก้ไขเที่ยว ${t.plate}`;
    $('edit-status').innerHTML = Object.entries(EDIT_STATUS).map(([k, v]) => `<option value="${k}"${k === t.status ? ' selected' : ''}>${esc(v)}</option>`).join('');
    for (const type of EVENT_TYPES) {
      const ev = (t.events || []).find((e) => e.type === type);
      $('edit-' + type).value = toLocalInput(ev && ev.at);
    }
    $('edit-dlg').showModal();
  }
  $('edit-cancel').addEventListener('click', () => $('edit-dlg').close());
  $('edit-save').addEventListener('click', async () => {
    const t = db.trips.find((x) => x.key === editingKey);
    if (!t) return $('edit-dlg').close();
    const times = {};
    for (const type of EVENT_TYPES) {
      const v = $('edit-' + type).value;
      if (v && !(Date.parse(v) > 0)) return toast('รูปแบบเวลาไม่ถูกต้อง', true);
      times[type] = v ? new Date(v).toISOString() : '';
    }
    // เวลาต้องเรียงตามลำดับจริง: เข้ารับ ≤ ออกรับ ≤ เข้าส่ง ≤ ออกส่ง (เฉพาะที่กรอก)
    const filled = EVENT_TYPES.map((k) => times[k]).filter(Boolean);
    if (filled.some((v, i) => i && v < filled[i - 1])) return toast('เวลาเรียงไม่ถูกต้อง (เข้ารับ → ออกรับ → เข้าส่ง → ออกส่ง)', true);
    const stationOf = { pick_in: t.pickupStationId, pick_out: t.pickupStationId, del_in: t.deliveryStationId, del_out: t.deliveryStationId };
    const kept = (t.events || []).filter((e) => !EVENT_TYPES.includes(e.type));
    for (const type of EVENT_TYPES) {
      if (!times[type]) continue;
      const old = (t.events || []).find((e) => e.type === type);
      kept.push(old && old.at === times[type] ? old : { type, stationId: stationOf[type], at: times[type], source: 'manual' });
    }
    t.events = kept;
    t.status = $('edit-status').value;
    delete t.pending; // ล้างผลรอยืนยันเดิม ให้ตรวจใหม่จากสถานะที่ตั้ง
    await persist(['trips']);
    $('edit-dlg').close();
    renderTrips();
    toast('บันทึกแล้ว');
  });

  const fmtDur = (min) => `${Math.floor(min / 60)}:${String(Math.floor(min % 60)).padStart(2, '0')} ชม.`;
  const fmtHours = (h) => { const w = Math.floor(h), m = h - w ? 30 : 0; return m ? `${w}.30` : String(w); };

  function waitingCell(t) {
    const w = Waiting.forTrip(t, { freeHours: db.settings.waitFreeHours, ratePerHour: db.settings.waitRate });
    if (!w) return '<span class="muted">-</span>';
    const pay = w.hours
      ? `<b>${fmtHours(w.hours)} ชม. · ${w.amount.toLocaleString('th-TH')} บาท</b>`
      : '<span class="muted">ไม่คิด (0 บาท)</span>';
    return `อยู่จุดรับ ${fmtDur(w.stayMin)}${w.ongoing ? ' <span class="muted">(ยังอยู่)</span>' : ''}<br>${pay}`;
  }

  function renderGpsPill() {
    const sp = $('sync-pill'), ss = db.syncStatus;
    sp.hidden = !(db.settings.syncUrl && db.settings.syncKey);
    if (!sp.hidden) {
      sp.textContent = ss ? (ss.ok ? 'ซิงก์ · ' : 'ซิงก์ผิดพลาด · ') + hhmm(ss.at) : 'ซิงก์ · ยังไม่เริ่ม';
      sp.title = ss ? ss.message : '';
    }
    const g = db.gpsStatus, pill = $('gps-pill');
    if (!g) { pill.textContent = 'GPS · ยังไม่เริ่ม'; pill.title = ''; return; }
    pill.textContent = (g.ok ? 'GPS · ' : 'GPS ผิดพลาด · ') + hhmm(g.at);
    pill.title = g.message;
    pill.style.opacity = g.ok ? '' : '0.75';
  }

  // background เขียน trips / gpsStatus เอง ต้องซิงก์เข้ามา ไม่งั้นการบันทึกจากหน้านี้จะทับของใหม่
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.trips) { db.trips = ch.trips.newValue || []; if ($('view-trips').classList.contains('active')) renderTrips(); }
      if (ch.gpsStatus) { db.gpsStatus = ch.gpsStatus.newValue; renderGpsPill(); }
      if (ch.syncStatus) { db.syncStatus = ch.syncStatus.newValue; renderGpsPill(); }
      if (ch.stations) {
        db.stations = ch.stations.newValue || [];
        if (mapReady && !drawing) drawStations(false);
        if ($('view-stations').classList.contains('active') && !drawing) renderStations();
        if ($('view-trips').classList.contains('active')) renderTrips();
      }
      if (ch.routes) { db.routes = ch.routes.newValue || []; if ($('view-routes').classList.contains('active')) renderRoutes(); }
    });
  }
  $('poll-now').addEventListener('click', async () => {
    $('poll-now').disabled = true;
    try {
      const s = await chrome.runtime.sendMessage({ type: 'poll-now' });
      toast(s ? s.message || 'เสร็จแล้ว' : 'ไม่มีการตอบกลับจาก background', !(s && s.ok));
    } catch (e) { toast('ดึงไม่ได้: ' + e.message, true); }
    $('poll-now').disabled = false;
  });

  let statusFilter = '';

  // ---------- วันที่มีข้อมูล + ส่งออก Excel ----------
  function renderDays() {
    const counts = {};
    db.trips.forEach((t) => (counts[t.date] = (counts[t.date] || 0) + 1));
    const dates = Object.keys(counts).sort().reverse();
    const cur = $('trips-date').value;
    $('trips-days').innerHTML = '<option value="">— เลือกวัน —</option>' + dates.map((d) =>
      `<option value="${esc(d)}"${d === cur ? ' selected' : ''}>${thDate(d)} (${counts[d]} เที่ยว)</option>`).join('');
  }
  $('trips-days').addEventListener('change', (e) => { if (e.target.value) { $('trips-date').value = e.target.value; renderTrips(); } });

  const tripsInRange = (from, to) => db.trips.filter((t) => (!from || t.date >= from) && (!to || t.date <= to))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (parseInt(a.no, 10) || 0) - (parseInt(b.no, 10) || 0)));

  function updateExportInfo() {
    const n = tripsInRange($('export-from').value, $('export-to').value);
    $('export-info').textContent = n.length ? `จะส่งออก ${n.length} เที่ยว · ${n.reduce((s, t) => s + t.hawbs.length, 0)} HAWB` : 'ไม่มีเที่ยวในช่วงวันที่นี้';
    $('export-go').disabled = !n.length;
  }
  $('export-open').addEventListener('click', () => {
    $('export-from').value = $('export-to').value = $('trips-date').value;
    updateExportInfo();
    $('export-dlg').showModal();
  });
  ['export-from', 'export-to'].forEach((id) => $(id).addEventListener('change', updateExportInfo));
  $('export-cancel').addEventListener('click', () => $('export-dlg').close());
  $('export-go').addEventListener('click', () => {
    const from = $('export-from').value, to = $('export-to').value;
    if (from && to && from > to) return toast('วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด', true);
    const list = tripsInRange(from, to);
    if (!list.length) return;
    const sheets = Exporter.buildSheets(list, db.stations, db.settings, Date.now());
    const wb = XLSX.utils.book_new();
    const add = (rows, name, widths) => {
      const ws = XLSX.utils.aoa_to_sheet(rows);
      ws['!cols'] = widths.map((wch) => ({ wch }));
      XLSX.utils.book_append_sheet(wb, ws, name);
    };
    add(sheets.trips, 'รายเที่ยว', [11, 7, 11, 22, 18, 18, 11, 40, 16, 17, 17, 17, 17, 14, 16, 14, 28, 17, 17]);
    add(sheets.hawbs, 'รายการ HAWB', [11, 11, 22, 18, 18, 14, 14, 8, 16]);
    add(sheets.days, 'สรุปรายวัน', [12, 12, 12, 14, 16, 16]);
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    a.download = `ap-station-${(from || list[0].date).replace(/-/g, '')}${to && to !== from ? '-' + to.replace(/-/g, '') : ''}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
    $('export-dlg').close();
    toast(`ส่งออก ${list.length} เที่ยวแล้ว`);
  });

  function renderTrips() {
    const date = $('trips-date').value;
    renderDays();
    const trips = db.trips.filter((t) => t.date === date);
    const hawbCount = trips.reduce((s, t) => s + t.hawbs.length, 0);
    const byStatus = {};
    // นับตามป้ายที่แสดง (รอขึ้นงานรวมทั้งยังไม่ถึงและอยู่ในจุดรับ)
    trips.forEach((t) => { const l = statusLabel(t.status); byStatus[l] = (byStatus[l] || 0) + 1; });
    if (statusFilter && !byStatus[statusFilter]) statusFilter = ''; // สถานะนี้ไม่มีเที่ยวเหลือแล้ว
    const shown = statusFilter ? trips.filter((t) => statusLabel(t.status) === statusFilter) : trips;
    // ชิปสถานะกดเลือกได้ (กดซ้ำ = ยกเลิก) เรียงตามลำดับขั้นงาน
    const labels = [...new Set(Object.keys(STATUS).map(statusLabel))];
    const ordered = labels.filter((l) => byStatus[l]).concat(Object.keys(byStatus).filter((l) => !labels.includes(l)));
    $('trips-summary').innerHTML =
      `<button class="chip chip-btn${statusFilter ? '' : ' on'}" data-status="">ทั้งหมด <b>${trips.length}</b></button><span class="chip">HAWB <b>${hawbCount}</b></span>` +
      ordered.map((s) => `<button class="chip chip-btn${s === statusFilter ? ' on' : ''}" data-status="${esc(s)}">${esc(s)} <b>${byStatus[s]}</b></button>`).join('');
    $('trips-summary').querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
      statusFilter = b.dataset.status === statusFilter ? '' : b.dataset.status;
      renderTrips();
    }));
    $('trips-clear-day').disabled = !trips.length;

    if (!trips.length) {
      $('trips-body').innerHTML = `<div class="empty">ยังไม่มีเที่ยวของวันที่ ${thDate(date)}<br><br><button class="btn primary" id="go-import">นำเข้าไฟล์ Truck Detail</button></div>`;
      $('go-import').onclick = () => showTab('import');
      return;
    }
    const rows = shown.map((t) => {
      const pk = stationById(t.pickupStationId), dl = stationById(t.deliveryStationId);
      const poly = (s) => (s && s.polygon ? '' : ' <span class="nopoly">(ยังไม่วาด)</span>');
      return `<tr>
        <td class="num">${trips.indexOf(t) + 1}</td>
        <td><b>${esc(t.plate)}</b><div class="muted">${esc(t.driver)}</div></td>
        <td class="station-pair"><span class="pk">${esc(pk ? pk.name : '?')}</span>${poly(pk)}<br>→ <span class="dl">${esc(dl ? dl.name : '?')}</span>${poly(dl)}</td>
        <td>${t.hawbs.length ? `<b>${t.hawbs.length}</b> HAWB <button class="btn small" data-copy="${esc(t.key)}">คัดลอก</button>` : '<span class="muted">ยังไม่มี HAWB</span>'}
          <div class="hawb-list mono">${t.hawbs.map((h) => esc(h.hawb)).join(' ')}</div></td>
        <td><span class="status ${esc(t.status)}">${esc(statusLabel(t.status))}</span></td>
        <td class="manual">${gpsTimes(t)}</td>
        <td class="manual">${waitingCell(t)}</td>
        <td class="row-actions">
          ${NEXT_AFTER_FILL[t.status] ? `<button class="btn small primary" data-fill="${esc(t.key)}">กรอกแล้ว</button>` : ''}
          <button class="btn small" data-edit="${esc(t.key)}">แก้ไข</button>
          <button class="btn small ghost danger" data-del="${esc(t.key)}">ลบ</button></td>
      </tr>`;
    }).join('');
    const plateLine = statusFilter
      ? `<div class="plate-line"><b>${esc(statusFilter)}</b> ${shown.length} คัน: ` +
        `${shown.map((t) => `<span class="plate">${esc(t.plate)}</span>`).join(' ')} ` +
        `<button class="btn small" id="copy-plates">คัดลอกทะเบียน</button></div>`
      : '';
    $('trips-body').innerHTML = plateLine + `<div class="table-wrap"><table>
      <thead><tr><th>#</th><th>ทะเบียน / คนขับ</th><th>สถานีรับ → ส่ง</th><th>HAWB</th><th>สถานะ</th><th title="เวลาที่ระบบจับได้จาก GPS">เวลา GPS (เข้า/ออก)</th><th title="นับจากรถเข้าจุดรับ รอฟรีตามตั้งค่า ส่วนเกินปัดตามกติกา">Waiting Time</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
    const cp = $('copy-plates');
    if (cp) cp.addEventListener('click', async () => {
      await navigator.clipboard.writeText(shown.map((t) => t.plate).join('\n'));
      toast(`คัดลอก ${shown.length} ทะเบียนแล้ว`);
    });
    $('trips-body').querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      const t = db.trips.find((x) => x.key === b.dataset.copy);
      await navigator.clipboard.writeText(t.hawbs.map((h) => h.hawb).join('\n'));
      toast(`คัดลอก ${t.hawbs.length} HAWB แล้ว`);
    }));
    $('trips-body').querySelectorAll('[data-fill]').forEach((b) => b.addEventListener('click', async () => {
      const t = db.trips.find((x) => x.key === b.dataset.fill);
      if (!t || !NEXT_AFTER_FILL[t.status]) return;
      t.events = t.events || [];
      t.events.push({ type: t.status === 'pending_pickup_entry' ? 'pick_filled' : 'del_filled', at: new Date().toISOString(), source: 'manual' });
      t.status = NEXT_AFTER_FILL[t.status];
      await persist(['trips']);
      renderTrips();
    }));
    $('trips-body').querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openEdit(b.dataset.edit)));
    $('trips-body').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
      const t = db.trips.find((x) => x.key === b.dataset.del);
      if (!confirm(`ลบเที่ยว ${t.plate} (${t.hawbs.length} HAWB)?`)) return;
      db.trips = db.trips.filter((x) => x.key !== t.key);
      await persist(['trips']);
      renderTrips();
    }));
  }

  $('trips-clear-day').addEventListener('click', async () => {
    const date = $('trips-date').value;
    const n = db.trips.filter((t) => t.date === date).length;
    if (!n || !confirm(`ลบเที่ยวทั้งหมด ${n} เที่ยว ของวันที่ ${thDate(date)}?

การลบจะลบออกจากฐานข้อมูลกลางด้วย (ถ้าเปิดซิงก์) ควรกด "ส่งออก Excel" เก็บไว้ก่อน`)) return;
    db.trips = db.trips.filter((t) => t.date !== date);
    await persist(['trips']);
    renderTrips();
    toast('ลบแล้ว');
  });

  // ---------- นำเข้าไฟล์ ----------
  const dz = $('dropzone');
  $('file-pick').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', (e) => { if (e.target.files[0]) readFile(e.target.files[0]); e.target.value = ''; });
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

  async function readFile(file) {
    try {
      const name = file.name.toLowerCase();
      let wb;
      if (name.endsWith('.csv')) {
        const buf = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-874').decode(buf); // ไฟล์ CSV ภาษาไทยจาก Excel รุ่นเก่า
        wb = XLSX.read(text.replace(/^﻿/, ''), { type: 'string', raw: true });
      } else if (name.endsWith('.xlsx')) {
        wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      } else {
        toast('รองรับเฉพาะ .csv และ .xlsx', true);
        return;
      }
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      startImport(rows, file.name);
    } catch (err) {
      console.error(err);
      toast('อ่านไฟล์ไม่ได้: ' + err.message, true);
    }
  }

  function startImport(rows, fileName) {
    const first = TruckParser.parseTruckDetail(rows, { routes: completeRoutes() });
    importState = {
      rows, fileName,
      date: first.tripDate || todayStr(),
      dupChoice: {},       // hawb -> ลำดับบล็อกเที่ยวที่เลือกเก็บ
      routeDraft: {}       // routeText -> {pickup, delivery}
    };
    (first.duplicates || []).forEach((d) => (importState.dupChoice[d.hawb] = +d.tripKeys[0].split('|').pop()));
    reparse();
  }

  function reparse() {
    importState.result = TruckParser.parseTruckDetail(importState.rows, { routes: completeRoutes(), tripDate: importState.date });
    renderImport();
  }

  function existingHawbs() {
    const m = new Map();
    db.trips.forEach((t) => t.hawbs.forEach((h) => m.set(h.hawb, t)));
    return m;
  }

  function renderImport() {
    const st = importState, r = st.result, box = $('import-preview');
    if (r.errors.length) {
      box.innerHTML = `<div class="preview"><div class="notice err"><h3>นำเข้าไม่ได้</h3><ul>${r.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div></div>`;
      return;
    }
    const exist = existingHawbs();
    const already = [];
    r.trips.forEach((t) => t.hawbs.forEach((h) => { if (exist.has(h.hawb)) already.push({ hawb: h.hawb, plate: t.plate, other: exist.get(h.hawb) }); }));
    const hawbTotal = r.trips.reduce((s, t) => s + t.hawbs.length, 0);
    const unmappedReady = r.unknownRoutes.every((txt) => {
      const d = st.routeDraft[txt]; return d && d.pickup && d.delivery;
    });

    let html = `<div class="preview">
      <div class="preview-head">
        <div><div class="muted">ไฟล์</div><b>${esc(st.fileName)}</b></div>
        <label>วันที่เที่ยว <input type="date" id="imp-date" value="${esc(st.date)}"></label>
        <span class="chip">เที่ยว <b>${r.trips.length}</b></span>
        <span class="chip">HAWB <b>${hawbTotal}</b></span>
        <span class="chip">ข้าม <b>${r.skipped.length}</b></span>
      </div>`;

    if (r.warnings.length) {
      html += `<div class="notice warn"><h3>คำเตือน</h3><ul>${r.warnings.map((w) => `<li>${esc(w.text)}</li>`).join('')}</ul></div>`;
    }
    if (r.unknownRoutes.length) {
      html += `<div class="notice warn"><h3>เส้นทางใหม่ ${r.unknownRoutes.length} รายการ — เลือกสถานีก่อนนำเข้า (บันทึกเป็นเส้นทางให้อัตโนมัติ)</h3>
        <div class="route-map muted"><span>ข้อความ Pick up</span><span>สถานีรับ</span><span>สถานีส่ง</span></div>
        ${r.unknownRoutes.map((txt, i) => {
          const d = st.routeDraft[txt] || {};
          return `<div class="route-map"><span>${esc(txt || '(ว่าง)')}</span>
            <select data-rt="${i}" data-k="pickup">${stationOptions(d.pickup, 'pickup')}</select>
            <select data-rt="${i}" data-k="delivery">${stationOptions(d.delivery, 'delivery')}</select></div>`;
        }).join('')}</div>`;
    }
    if (r.duplicates.length) {
      html += `<div class="notice warn"><h3>HAWB ซ้ำในไฟล์ ${r.duplicates.length} รายการ — เลือกว่าอยู่เที่ยวไหน</h3>
        ${r.duplicates.map((d) => `<div class="choice"><b class="mono">${esc(d.hawb)}</b>
          ${d.tripKeys.map((k) => {
            const t = r.trips.find((x) => x.key === k);
            return `<label><input type="radio" name="dup-${esc(d.hawb)}" value="${t.block}" data-dup="${esc(d.hawb)}"${st.dupChoice[d.hawb] === t.block ? ' checked' : ''}> เที่ยว ${esc(t.no)} · ${esc(t.plate)} · ${esc(t.driver)}</label>`;
          }).join('')}</div>`).join('')}</div>`;
    }
    if (already.length) {
      html += `<div class="notice info"><h3>HAWB ที่มีในระบบแล้ว ${already.length} รายการ — จะข้าม ไม่นำเข้าซ้ำ</h3>
        <div class="mono">${already.map((a) => esc(a.hawb)).join(' ')}</div></div>`;
    }

    html += `<div class="table-wrap"><table><thead><tr><th>No.</th><th>ทะเบียน</th><th>คนขับ</th><th>เส้นทาง</th><th>สถานีรับ → ส่ง</th><th>HAWB</th></tr></thead><tbody>
      ${r.trips.map((t) => {
        const rt = t.routeId ? routeById(t.routeId) : null;
        const draft = !rt ? st.routeDraft[t.routeText] : null;
        const pk = stationById(rt ? rt.pickupStationId : draft && draft.pickup);
        const dl = stationById(rt ? rt.deliveryStationId : draft && draft.delivery);
        return `<tr><td class="num">${esc(t.no)}</td><td><b>${esc(t.plate)}</b></td><td>${esc(t.driver)}</td>
          <td class="muted">${esc(t.routeText)}</td>
          <td class="station-pair"><span class="pk">${esc(pk ? pk.name : '?')}</span> → <span class="dl">${esc(dl ? dl.name : '?')}</span></td>
          <td>${t.hawbs.length ? `<b>${t.hawbs.length}</b>` : '<span class="muted">ยังไม่มี HAWB</span>'}<div class="hawb-list mono">${t.hawbs.map((h) => esc(h.hawb)).join(' ')}</div></td></tr>`;
      }).join('')}</tbody></table></div>`;

    if (r.skipped.length) {
      html += `<details class="skipped"><summary>แถวที่ข้าม ${r.skipped.length} เที่ยว</summary><div class="table-wrap" style="margin-top:8px"><table>
        <thead><tr><th>No.</th><th>ทะเบียน</th><th>เส้นทาง</th><th>เหตุผล</th></tr></thead><tbody>
        ${r.skipped.map((s) => `<tr><td>${esc(s.trip.no)}</td><td>${esc(s.trip.plate)}</td><td class="muted">${esc(s.trip.routeText)}</td><td>${esc(s.reason)}</td></tr>`).join('')}
        </tbody></table></div></details>`;
    }

    html += `<div class="confirm-bar">
        <button class="btn primary" id="imp-confirm"${!r.trips.length || !unmappedReady ? ' disabled' : ''}>นำเข้า ${r.trips.length} เที่ยว</button>
        <button class="btn ghost" id="imp-cancel">ยกเลิก</button>
        ${!unmappedReady ? '<span class="muted">เลือกสถานีของเส้นทางใหม่ให้ครบก่อน</span>' : ''}
      </div></div>`;
    box.innerHTML = html;

    $('imp-date').addEventListener('change', (e) => { st.date = e.target.value; reparse(); });
    box.querySelectorAll('select[data-rt]').forEach((s) => s.addEventListener('change', () => {
      const txt = r.unknownRoutes[+s.dataset.rt];
      st.routeDraft[txt] = st.routeDraft[txt] || {};
      st.routeDraft[txt][s.dataset.k] = s.value;
      renderImport();
    }));
    box.querySelectorAll('input[data-dup]').forEach((rb) => rb.addEventListener('change', () => { st.dupChoice[rb.dataset.dup] = +rb.value; }));
    $('imp-cancel').addEventListener('click', () => { importState = null; box.innerHTML = ''; });
    $('imp-confirm').addEventListener('click', commitImport);
  }

  async function commitImport() {
    const st = importState;
    // 1) บันทึกเส้นทางใหม่
    let newRoutes = 0;
    for (const txt of st.result.unknownRoutes) {
      const d = st.routeDraft[txt];
      db.routes.push({ id: uid('rt'), pattern: txt, match: 'exact', pickupStationId: d.pickup, deliveryStationId: d.delivery });
      newRoutes++;
    }
    if (newRoutes) await persist(['routes']);
    const r = TruckParser.parseTruckDetail(st.rows, { routes: completeRoutes(), tripDate: st.date });

    // 2) HAWB ซ้ำในไฟล์: เก็บไว้เฉพาะเที่ยวที่เลือก
    const dupSet = new Set((r.duplicates || []).map((d) => d.hawb));
    const exist = existingHawbs();
    let added = 0, addedHawb = 0, skippedHawb = 0;
    for (const t of r.trips) {
      const rt = routeById(t.routeId);
      const hawbs = t.hawbs.filter((h) => {
        if (dupSet.has(h.hawb) && st.dupChoice[h.hawb] !== t.block) return false;
        if (exist.has(h.hawb)) { skippedHawb++; return false; }
        return true;
      });
      if (!hawbs.length && !t.noHawb) continue;
      const prev = db.trips.find((x) => x.key === t.key);
      if (prev) {
        prev.hawbs.push(...hawbs);
      } else {
        db.trips.push({
          key: t.key, date: st.date, no: t.no, plate: t.plate, driver: t.driver,
          routeText: t.routeText, routeId: rt.id,
          pickupStationId: rt.pickupStationId, deliveryStationId: rt.deliveryStationId,
          hawbs: hawbs.map((h) => ({ hawb: h.hawb, packingNo: h.packingNo, total: h.total })),
          status: 'waiting_pickup',
          events: [],
          fileName: st.fileName,
          importedAt: new Date().toISOString()
        });
        added++;
      }
      hawbs.forEach((h) => exist.set(h.hawb, t));
      addedHawb += hawbs.length;
    }
    await persist(['trips']);
    importState = null;
    $('import-preview').innerHTML = '';
    $('trips-date').value = st.date;
    showTab('trips');
    toast(`นำเข้า ${added} เที่ยว ${addedHawb} HAWB` + (skippedHawb ? ` · ข้ามที่มีแล้ว ${skippedHawb}` : ''));
  }

  // ---------- สถานี + แผนที่ ----------
  let map, layerGroup, drawLayer, testMarker;
  let selectedStationId = null;
  let drawing = null; // { stationId, points: [[lat,lng]] }
  const COLORS = { pickup: '#0f8a7e', delivery: '#e86f2d' };

  function initMap() {
    map = L.map('map', { zoomControl: true }).setView([13.55, 100.95], 10);
    const streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20, subdomains: 'abcd', attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
    const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri'
    });
    sat.addTo(map);
    L.control.layers({ 'ภาพดาวเทียม': sat, 'แผนที่ถนน': streets }, null, { position: 'topright' }).addTo(map);
    L.control.scale({ imperial: false }).addTo(map);
    layerGroup = L.layerGroup().addTo(map);
    drawLayer = L.layerGroup().addTo(map);
    map.on('click', (e) => {
      if (!drawing) return;
      drawing.points.push([+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6)]);
      renderDrawing();
    });
    mapReady = true;
    drawStations(true);
  }

  function drawStations(fit) {
    if (!map) return;
    layerGroup.clearLayers();
    const bounds = [];
    for (const s of db.stations) {
      if (!s.polygon || (drawing && drawing.stationId === s.id)) continue;
      const poly = L.polygon(s.polygon, {
        color: COLORS[s.type], weight: s.id === selectedStationId ? 4 : 2, fillOpacity: 0.18
      }).bindTooltip(s.name, { permanent: true, direction: 'center', className: '' });
      poly.on('click', () => { if (!drawing) selectStation(s.id); });
      layerGroup.addLayer(poly);
      s.polygon.forEach((p) => bounds.push(p));
    }
    if (fit && bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  function renderStations() {
    const list = $('station-list');
    list.innerHTML = db.stations.map((s) => {
      const has = s.polygon && s.polygon.length >= 3;
      const area = has ? Math.round(Geo.areaSqm(s.polygon)).toLocaleString('th-TH') + ' ตร.ม.' : '';
      return `<div class="station-item${s.id === selectedStationId ? ' sel' : ''}" data-id="${esc(s.id)}">
        <div class="row1"><span class="dot ${esc(s.type)}"></span><span class="name">${esc(s.name)}</span>
          ${has ? '<span class="tag ok">วาดแล้ว</span>' : '<span class="tag miss">ยังไม่ได้วาด</span>'}</div>
        <div class="meta">${s.type === 'pickup' ? 'จุดรับ' : 'จุดส่ง'}${s.fixed ? ' · สถานีหลัก' : ''}${has ? ` · ${s.polygon.length} มุม · ${area}` : ''}</div>
        <div class="actions">
          <button class="btn small" data-draw="${esc(s.id)}">${has ? 'แก้ polygon' : 'วาด polygon'}</button>
          ${has ? `<button class="btn small" data-zoom="${esc(s.id)}">ดูบนแผนที่</button>` : ''}
          ${!s.fixed ? `<button class="btn small ghost danger" data-remove="${esc(s.id)}">ลบ</button>` : ''}
        </div></div>`;
    }).join('');
    list.querySelectorAll('.station-item').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      selectStation(el.dataset.id);
    }));
    list.querySelectorAll('[data-draw]').forEach((b) => b.addEventListener('click', () => startDrawing(b.dataset.draw)));
    list.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => selectStation(b.dataset.zoom)));
    list.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => removeStation(b.dataset.remove)));
  }

  function selectStation(id) {
    selectedStationId = id;
    const s = stationById(id);
    renderStations();
    drawStations(false);
    if (s && s.polygon) map.fitBounds(s.polygon, { padding: [60, 60], maxZoom: 18 });
  }

  function startDrawing(id) {
    if (drawing && !confirm('ยกเลิก polygon ที่กำลังวาดอยู่?')) return;
    const s = stationById(id);
    drawing = { stationId: id, points: s.polygon ? s.polygon.map((p) => p.slice()) : [] };
    selectedStationId = id;
    $('draw-tools').classList.remove('hidden');
    $('draw-title').textContent = 'กำลังวาด: ' + s.name;
    $('map').classList.add('drawing');
    renderStations();
    drawStations(false);
    renderDrawing();
    if (s.polygon) map.fitBounds(s.polygon, { padding: [60, 60], maxZoom: 18 });
  }

  function renderDrawing() {
    drawLayer.clearLayers();
    if (!drawing) return;
    const s = stationById(drawing.stationId);
    const pts = drawing.points;
    if (pts.length >= 2) {
      drawLayer.addLayer(L.polygon(pts, { color: COLORS[s.type], weight: 3, dashArray: '6 4', fillOpacity: 0.15, interactive: false }));
    }
    pts.forEach((p, i) => {
      const m = L.marker(p, {
        draggable: true,
        icon: L.divIcon({ className: '', html: `<div class="vertex-icon${i === 0 ? ' first' : ''}"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] })
      });
      m.on('drag', (e) => { const ll = e.target.getLatLng(); pts[i] = [+ll.lat.toFixed(6), +ll.lng.toFixed(6)]; });
      m.on('dragend', renderDrawing);
      m.on('contextmenu', () => { pts.splice(i, 1); renderDrawing(); });
      drawLayer.addLayer(m);
    });
    const area = pts.length >= 3 ? ` · พื้นที่ประมาณ ${Math.round(Geo.areaSqm(pts)).toLocaleString('th-TH')} ตร.ม.` : '';
    $('draw-stat').textContent = `${pts.length} มุม${area}`;
    $('draw-save').disabled = pts.length < 3;
  }

  function stopDrawing() {
    drawing = null;
    drawLayer.clearLayers();
    $('draw-tools').classList.add('hidden');
    $('map').classList.remove('drawing');
    renderStations();
    drawStations(false);
  }

  $('draw-undo').addEventListener('click', () => { if (drawing) { drawing.points.pop(); renderDrawing(); } });
  $('draw-clear').addEventListener('click', () => { if (drawing && confirm('ล้างทุกจุด?')) { drawing.points = []; renderDrawing(); } });
  $('draw-cancel').addEventListener('click', stopDrawing);
  $('draw-save').addEventListener('click', async () => {
    if (!drawing || drawing.points.length < 3) return;
    const s = stationById(drawing.stationId);
    // เตือนถ้าทับกับสถานีอื่น
    const overlap = db.stations.find((o) => o.id !== s.id && o.polygon && drawing.points.some((p) => Geo.pointInPolygon(p[0], p[1], o.polygon)));
    if (overlap && !confirm(`polygon นี้ทับกับ "${overlap.name}" ยืนยันบันทึก?`)) return;
    s.polygon = drawing.points.map((p) => p.slice());
    s.updatedAt = new Date().toISOString();
    await persist(['stations']);
    toast('บันทึก polygon ' + s.name + ' แล้ว');
    stopDrawing();
  });

  $('new-station-add').addEventListener('click', async () => {
    const name = $('new-station-name').value.trim();
    if (!name) return toast('ใส่ชื่อสถานีก่อน', true);
    if (db.stations.some((s) => s.name === name)) return toast('มีชื่อสถานีนี้แล้ว', true);
    const st = { id: uid('st'), name, type: $('new-station-type').value, fixed: false, polygon: null };
    db.stations.push(st);
    await persist(['stations']);
    $('new-station-name').value = '';
    renderStations();
    startDrawing(st.id);
  });

  async function removeStation(id) {
    const s = stationById(id);
    const used = db.routes.filter((r) => r.pickupStationId === id || r.deliveryStationId === id);
    if (used.length) return toast(`ลบไม่ได้: ใช้อยู่ใน ${used.length} เส้นทาง`, true);
    if (!confirm(`ลบสถานี "${s.name}"?`)) return;
    db.stations = db.stations.filter((x) => x.id !== id);
    await persist(['stations']);
    renderStations();
    drawStations(false);
  }

  $('goto-btn').addEventListener('click', () => {
    const ll = Geo.parseLatLng($('goto-input').value);
    if (!ll) return toast('รูปแบบพิกัดไม่ถูกต้อง', true);
    map.setView(ll, 17);
  });
  $('test-btn').addEventListener('click', () => {
    const ll = Geo.parseLatLng($('test-input').value);
    if (!ll) return toast('รูปแบบพิกัดไม่ถูกต้อง', true);
    const hits = db.stations.filter((s) => s.polygon && Geo.pointInPolygon(ll[0], ll[1], s.polygon));
    $('test-result').textContent = hits.length ? '✓ อยู่ใน: ' + hits.map((h) => h.name).join(', ') : '✗ ไม่อยู่ในสถานีใด';
    $('test-result').style.color = hits.length ? 'var(--ok)' : 'var(--err)';
    if (testMarker) testMarker.remove();
    testMarker = L.circleMarker(ll, { radius: 8, color: '#fff', weight: 2, fillColor: hits.length ? '#2e7d32' : '#c62828', fillOpacity: 1 }).addTo(map);
    map.setView(ll, Math.max(map.getZoom(), 16));
  });

  // ---------- เส้นทาง ----------
  function renderRoutes() {
    const body = $('routes-body');
    if (!db.routes.length) { body.innerHTML = '<div class="empty">ยังไม่มีเส้นทาง</div>'; return; }
    body.innerHTML = `<div class="table-wrap"><table><thead><tr><th style="width:40%">ข้อความ Pick up</th><th>วิธีจับคู่</th><th>สถานีรับ</th><th>สถานีส่ง</th><th></th></tr></thead><tbody>
      ${db.routes.map((r) => `<tr data-id="${esc(r.id)}">
        <td><input data-f="pattern" value="${esc(r.pattern)}"></td>
        <td><select data-f="match"><option value="prefix"${r.match !== 'exact' ? ' selected' : ''}>ขึ้นต้นด้วย</option><option value="exact"${r.match === 'exact' ? ' selected' : ''}>ตรงทั้งหมด</option></select></td>
        <td><select data-f="pickupStationId">${stationOptions(r.pickupStationId, 'pickup')}</select></td>
        <td><select data-f="deliveryStationId">${stationOptions(r.deliveryStationId, 'delivery')}</select></td>
        <td><button class="btn small ghost danger" data-del>ลบ</button></td></tr>`).join('')}
      </tbody></table></div>`;
    body.querySelectorAll('tr[data-id]').forEach((tr) => {
      const r = routeById(tr.dataset.id);
      tr.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', async () => {
        r[el.dataset.f] = el.value.trim();
        await persist(['routes']);
        toast('บันทึกเส้นทางแล้ว · มีผลกับการนำเข้าครั้งต่อไป');
      }));
      tr.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('ลบเส้นทางนี้?')) return;
        db.routes = db.routes.filter((x) => x.id !== r.id);
        await persist(['routes']);
        renderRoutes();
      });
    });
  }
  $('route-add').addEventListener('click', async () => {
    db.routes.push({ id: uid('rt'), pattern: '', match: 'prefix', pickupStationId: '', deliveryStationId: '' });
    await persist(['routes']);
    renderRoutes();
    const inputs = $('routes-body').querySelectorAll('input[data-f="pattern"]');
    inputs[inputs.length - 1].focus();
  });

  // ---------- ตั้งค่า ----------
  async function renderSettings() {
    const s = db.settings;
    $('set-gps-url').value = s.gpsBaseUrl;
    $('set-gps-token').value = s.gpsToken;
    $('set-poll').value = s.pollSeconds;
    $('set-eta-speed').value = s.etaSpeedKmh;
    $('set-wait-free').value = s.waitFreeHours;
    $('set-wait-rate').value = s.waitRate;
    $('set-remind').value = s.remindMinutes;
    $('set-sync-url').value = s.syncUrl;
    $('set-sync-key').value = s.syncKey;
    $('set-poller').checked = s.isPoller;
    $('set-cloud').checked = s.cloudGps;
    const bytes = await Store.bytesInUse();
    const hawb = db.trips.reduce((n, t) => n + t.hawbs.length, 0);
    $('storage-info').textContent = `สถานี ${db.stations.length} · เส้นทาง ${db.routes.length} · เที่ยว ${db.trips.length} (${hawb} HAWB) · ใช้พื้นที่ ${(bytes / 1024).toFixed(1)} KB`;
  }
  $('set-save').addEventListener('click', async () => {
    const poll = Math.max(30, parseInt($('set-poll').value, 10) || 60);
    db.settings = readGpsForm({
      ...db.settings,
      pollSeconds: poll,
      waitFreeHours: Math.max(0, parseFloat($('set-wait-free').value) || 0),
      waitRate: Math.max(0, parseFloat($('set-wait-rate').value) || 0),
      etaSpeedKmh: Math.min(120, Math.max(10, parseInt($('set-eta-speed').value, 10) || 40)),
      syncUrl: cleanUrl($('set-sync-url').value),
      syncKey: $('set-sync-key').value.trim(),
      isPoller: $('set-poller').checked,
      cloudGps: $('set-cloud').checked,
      remindMinutes: Math.max(5, parseInt($('set-remind').value, 10) || 30)
    });
    // ขอสิทธิ์เข้าถึงโดเมน GPS ถ้ายังไม่มี (ต้องทำใน click handler นี้)
    let granted = true;
    try {
      // ขอสิทธิ์ GPS และฐานข้อมูลกลางในคำขอเดียว (ต้องอยู่ใน click เดียวกัน)
      const origins = [new URL(db.settings.gpsBaseUrl).origin + '/*'];
      if (db.settings.syncUrl) origins.push(new URL(db.settings.syncUrl).origin + '/*');
      granted = await chrome.permissions.request({ origins });
    } catch (e) { granted = false; }
    await persist(['settings']);
    renderSettings();
    renderGpsPill();
    kickSync();
    toast(granted ? 'บันทึกการตั้งค่าแล้ว' : 'บันทึกแล้ว แต่ยังไม่ได้สิทธิ์เข้าถึง URL นี้ (ตรวจ Base URL)', !granted);
  });

  // Project URL เก็บเฉพาะ https://xxxx.supabase.co (ตัดพาธ เช่น /rest/v1 ที่ติดมาตอนคัดลอก)
  const cleanUrl = (v) => { const t = String(v).trim(); try { return new URL(t).origin; } catch (e) { return t.replace(/\/+$/, ''); } };

  function readGpsForm(base) {
    return {
      ...base,
      gpsBaseUrl: $('set-gps-url').value.trim().replace(/\/+$/, ''),
      gpsToken: $('set-gps-token').value.trim()
    };
  }

  // ช่องซิงก์บันทึกทันทีเมื่อแก้ (ไม่ต้องกด "บันทึกการตั้งค่า" ก็ไม่หาย)
  ['set-sync-url', 'set-sync-key', 'set-cloud', 'set-poller'].forEach((id) => $(id).addEventListener('change', async () => {
    db.settings = {
      ...db.settings,
      syncUrl: cleanUrl($('set-sync-url').value),
      syncKey: $('set-sync-key').value.trim(),
      cloudGps: $('set-cloud').checked,
      isPoller: $('set-poller').checked
    };
    await persist(['settings']);
    renderGpsPill();
  }));

  async function bigSync(type, confirmText) {
    if (!confirm(confirmText)) return;
    downloadBackup('ap-backup-before-' + type); // สำรองข้อมูลเครื่องนี้เป็นไฟล์ก่อนเสมอ
    const out = $('sync-result');
    out.textContent = 'กำลังทำงาน...';
    try {
      if (db.settings.syncUrl) await chrome.permissions.request({ origins: [new URL(db.settings.syncUrl).origin + '/*'] });
      const s = await chrome.runtime.sendMessage({ type });
      out.textContent = (s && s.ok ? '✓ ' : '✗ ') + (s ? s.message : 'ไม่มีการตอบกลับจาก background');
      db = await Store.load();
      renderSettings(); renderGpsPill();
      if (mapReady) drawStations(true);
      renderDays();
    } catch (e) { out.textContent = '✗ ' + e.message; }
  }
  $('sync-master').addEventListener('click', () => bigSync('push-all',
    'ตั้งเครื่องนี้เป็นเครื่องแม่?\n\nข้อมูลในฐานข้อมูลกลางจะถูกเขียนทับให้เหมือนเครื่องนี้ทุกประการ (เที่ยว สถานี เส้นทาง) รายการที่เครื่องนี้ไม่มีจะถูกลบออกจากกลาง\n\nระบบจะดาวน์โหลดไฟล์สำรองของเครื่องนี้ให้ก่อน'));
  $('sync-adopt').addEventListener('click', () => bigSync('adopt-remote',
    'ใช้ข้อมูลของกลางแทนเครื่องนี้?\n\nเที่ยว สถานี และเส้นทางในเครื่องนี้จะถูกแทนที่ด้วยข้อมูลจากฐานข้อมูลกลาง (ข้อมูลที่ยังไม่เคยซิงก์ขึ้นกลางจะหาย)\n\nระบบจะดาวน์โหลดไฟล์สำรองของเครื่องนี้ให้ก่อน'));

  $('sync-now').addEventListener('click', async () => {
    const out = $('sync-result');
    out.textContent = 'กำลังซิงก์...';
    try {
      if (db.settings.syncUrl) await chrome.permissions.request({ origins: [new URL(db.settings.syncUrl).origin + '/*'] });
      const s = await chrome.runtime.sendMessage({ type: 'sync-now' });
      out.textContent = (s && s.ok ? '✓ ' : '✗ ') + (s ? s.message : 'ไม่มีการตอบกลับจาก background');
    } catch (e) { out.textContent = '✗ ' + e.message; }
  });

  $('gps-test').addEventListener('click', async () => {
    const out = $('gps-test-result'), raw = $('gps-test-raw');
    out.textContent = 'กำลังเชื่อมต่อ...';
    raw.classList.add('hidden');
    try {
      const plate = $('gps-test-plate').value.trim() || (db.trips.find((t) => t.status !== 'done') || {}).plate;
      if (!plate) { await Gps.login(readGpsForm(db.settings)); out.textContent = '✓ ล็อกอินด้วย Token สำเร็จ (ใส่ทะเบียนทดสอบเพื่อลองดึงพิกัดต่อ)'; return; }
      const { records, raw: text, errors } = await Gps.fetchPositions(readGpsForm(db.settings), [plate]);
      const r = records[0];
      out.textContent = r
        ? `✓ ${plate}: ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)} เวลา ${new Date(r.time).toLocaleString('th-TH')}`
        : '✗ ' + (errors[0] || 'ไม่พบพิกัด');
      raw.textContent = text.slice(0, 3000);
      raw.classList.toggle('hidden', !text);
    } catch (e) {
      out.textContent = '✗ ' + e.message;
    }
  });

  // ไฟล์สำรอง: สถานี + เส้นทาง + เที่ยว (รวมเวลาเข้า-ออกที่จับได้) ไม่รวม Token
  function downloadBackup(prefix) {
    const data = { app: 'ap-station-extension', version: 2, exportedAt: new Date().toISOString(), stations: db.stations, routes: db.routes, trips: db.trips };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const t = new Date();
    a.download = `${prefix}-${todayStr()}-${String(t.getHours()).padStart(2, '0')}${String(t.getMinutes()).padStart(2, '0')}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
  $('backup-export').addEventListener('click', () => downloadBackup('ap-backup'));
  $('backup-import-btn').addEventListener('click', () => $('backup-import').click());
  $('backup-import').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'ap-station-extension' || !Array.isArray(data.stations) || !Array.isArray(data.routes)) throw new Error('ไม่ใช่ไฟล์สำรองของระบบนี้');
      if (!confirm(`แทนที่สถานี ${data.stations.length} และเส้นทาง ${data.routes.length} รายการ ด้วยข้อมูลจากไฟล์?`)) return;
      db.stations = data.stations;
      db.routes = data.routes;
      const keys = ['stations', 'routes'];
      if (Array.isArray(data.trips) && data.trips.length && confirm(`ไฟล์นี้มีเที่ยว ${data.trips.length} เที่ยว (รวมเวลาเข้า-ออก) กู้คืนด้วยไหม?
เที่ยวในเครื่องที่ key ตรงกันจะถูกแทนที่ เที่ยวอื่นยังอยู่`)) {
        const byKey = new Map(db.trips.map((t) => [t.key, t]));
        data.trips.forEach((t) => byKey.set(t.key, t));
        db.trips = [...byKey.values()];
        keys.push('trips');
      }
      await persist(keys);
      db = await Store.load(); // เติมสถานีหลักถ้าไฟล์ไม่มี
      renderSettings();
      if (mapReady) drawStations(true);
      toast('นำเข้าไฟล์สำรองแล้ว');
    } catch (err) {
      toast('นำเข้าไม่ได้: ' + err.message, true);
    }
  });

  // เปิดหน้าอยู่ → ซิงก์ทุก 15 วินาที เห็นการเปลี่ยนแปลงของทีม/คลาวด์เกือบทันที (ปิดหน้า background ยังซิงก์ตามรอบปกติ)
  setInterval(() => {
    if (document.visibilityState === 'visible' && db.settings.syncUrl && db.settings.syncKey) {
      chrome.runtime.sendMessage({ type: 'sync-now' }).catch(() => {});
    }
  }, 15000);

  // ---------- ส่งเวลาเข้าเว็บลูกค้า (Carrier Connect) ----------
  const CC_STATE = { ready: '✅ พร้อมส่ง', dup: '⚠ ซ้ำ', notfound: '❌ ไม่พบ', sent: '⏭ ส่งแล้ว', nogps: '⛔ ไม่มี GPS', blocked: '🚫 ติดเงื่อนไข' };
  let ccWos = [], ccRows = [], ccSelected = new Set(), ccLog = [], ccLastFailed = [];
  const ccKey = (r) => `${r.tripKey}|${r.hawb}|${r.code}`;
  const ccStore = {
    async get(k) {
      try { if (chrome.storage && chrome.storage.local) return (await chrome.storage.local.get(k))[k]; } catch (e) { /* ใช้ localStorage */ }
      try { return JSON.parse(localStorage.getItem('ap.' + k)); } catch (e) { return undefined; }
    },
    async set(k, v) {
      try { if (chrome.storage && chrome.storage.local) return await chrome.storage.local.set({ [k]: v }); } catch (e) { /* ใช้ localStorage */ }
      localStorage.setItem('ap.' + k, JSON.stringify(v));
    }
  };
  $('cc-from').value = $('cc-to').value = todayStr();
  ['cc-from', 'cc-to', 'cc-filter', 'cc-arrived'].forEach((id) => $(id).addEventListener('change', () => { ccSelected.clear(); renderCc(); }));

  async function renderCc() {
    ccLog = (await ccStore.get('ccLog')) || [];
    if (!ccWos.length) {
      ccWos = (await ccStore.get('ccWos')) || [];
      if (ccWos.length && !$('cc-wo-text').value) $('cc-wo-text').value = ccWos.map((w) => [w.workOrderNumber, w.houseBill, w.status, ...(w.eventCodes || [])].join(' ')).join('\n');
    }
    $('cc-wo-count').textContent = ccWos.length ? `· ${ccWos.length} WO` : '· ยังไม่มี';
    const from = $('cc-from').value, to = $('cc-to').value;
    const trips = db.trips.filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
    const sent = new Set(ccLog.filter((l) => l.ok).map((l) => l.wo + '|' + l.code));
    ccRows = CcSync.buildPlan(trips, { workOrders: ccWos, sent, includeArrived: $('cc-arrived').checked });
    const f = $('cc-filter').value;
    const shown = ccRows.filter((r) => !f || r.state === f);
    if (!shown.length) { $('cc-table').innerHTML = '<div class="empty">ไม่มีรายการ — ตรวจช่วงวันที่ และวางรายการ WO ก่อน</div>'; return; }
    $('cc-table').innerHTML = '<div class="table-wrap"><table><thead><tr><th></th><th>เที่ยว/ทะเบียน</th><th>HAWB</th><th>WO</th><th>สถานะปัจจุบัน</th><th>Event ที่จะส่ง</th><th>เวลา (ไทย)</th><th>ผลจับคู่</th></tr></thead><tbody>' +
      shown.map((r) => {
        const k = ccKey(r);
        const th = r.at ? new Date(r.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-';
        return `<tr><td>${r.state === 'ready' ? `<input type="checkbox" data-k="${esc(k)}"${ccSelected.has(k) ? ' checked' : ''}>` : ''}</td>` +
          `<td>${esc(thDate(r.date))} · ${esc(r.plate || '')}</td><td class="mono">${esc(r.hawb)}</td><td class="mono">${esc(r.wo || '-')}</td><td>${esc(r.woStatus || '-')}</td>` +
          `<td>${esc(r.label ? r.label + ' · ' + r.code : '-')}</td><td>${th}${r.estimated ? ' <span class="tm unk" title="คำนวณจากเส้นทางระหว่างรอบ GPS">ประมาณ</span>' : ''}</td><td>${CC_STATE[r.state]}${r.reason ? `<div class="muted">${esc(r.reason)}</div>` : ''}</td></tr>`;
      }).join('') + '</tbody></table></div>';
    $('cc-table').querySelectorAll('input[data-k]').forEach((c) => c.addEventListener('change', () => { if (c.checked) ccSelected.add(c.dataset.k); else ccSelected.delete(c.dataset.k); }));
  }

  $('cc-wo-apply').addEventListener('click', async () => {
    ccWos = CcSync.parseWoText($('cc-wo-text').value);
    await ccStore.set('ccWos', ccWos);
    ccSelected.clear();
    toast(`ใช้รายการ ${ccWos.length} WO`);
    renderCc();
  });
  $('cc-select-ready').addEventListener('click', () => {
    ccRows.filter((r) => r.state === 'ready' && !r.estimated).forEach((r) => ccSelected.add(ccKey(r))); // เวลาประมาณต้องติ๊กเอง
    renderCc();
  });
  async function ccCheckSession() {
    const s = await CcSync.readSession().catch((e) => ({ error: e.message }));
    $('cc-session').title = s.diag || '';
    $('cc-session').textContent = s.error ? '⚠ ' + s.error : '✅ ล็อกอินอยู่' + (s.expiresAt ? ' · หมดอายุ ' + new Date(s.expiresAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '');
    return s;
  }
  $('cc-check').addEventListener('click', ccCheckSession);

  // ดึงรายการ WO จากเว็บลูกค้าเอง (อ่านอย่างเดียว) แล้วจับคู่ด้วย HAWB = House Bill
  ccStore.get('ccUser').then((v) => { if (v) { $('cc-user').value = v.user || ''; $('cc-role').value = v.role || $('cc-role').value; } });
  $('cc-fetch').addEventListener('click', async () => {
    const user = $('cc-user').value.trim(), role = $('cc-role').value.trim();
    if (!user || !role) return toast('ใส่ชื่อผู้ใช้และ Role ของ Carrier Connect ก่อน', true);
    const s = await ccCheckSession();
    if (s.error) return toast(s.error, true);
    await ccStore.set('ccUser', { user, role });
    $('cc-fetch').disabled = true;
    try {
      const r = await CcSync.fetchWorkOrders(s.transport, { user, role });
      if (r.workOrders.length) {
        ccWos = r.workOrders;
        await ccStore.set('ccWos', ccWos);
        $('cc-wo-text').value = ccWos.map((w) => [w.workOrderNumber, w.houseBill, w.status, ...(w.eventCodes || [])].join(' ')).join('\n');
        ccSelected.clear();
      }
      const by = {};
      r.workOrders.forEach((w) => (by[w.status] = (by[w.status] || 0) + 1));
      toast(`ดึงได้ ${r.workOrders.length} WO (${Object.entries(by).map(([k, v]) => k + ' ' + v).join(', ') || '-'})` + (r.errors.length ? ' · ผิดพลาด: ' + r.errors.join('; ') + (r.auth && s.diag ? ' [' + s.diag + ']' : '') : ''), !!r.errors.length && !r.workOrders.length);
      renderCc();
    } catch (e) { toast('ดึงรายการไม่สำเร็จ: ' + e.message, true); }
    finally { $('cc-fetch').disabled = false; }
  });

  // ---------- ส่งอัตโนมัติ (ตัวทำงานอยู่ใน background.js: runCcAuto) ----------
  const AUTO_DEFAULT = { enabled: false, mode: 'dry', delayMin: 10, maxPerDay: 30 };
  let ccAuto = { ...AUTO_DEFAULT };
  const fmtDt = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : '-');

  function renderAutoStatus(st) {
    $('cca-status').textContent = st ? `${fmtDt(st.at)} · ${st.dry ? '[ทดลอง] ' : ''}${st.message}` : 'ยังไม่เคยรัน';
    if (!st) { $('cca-detail').innerHTML = ''; return; }
    const table = (arr, label) => (arr && arr.length
      ? `<div class="muted" style="margin-top:8px"><b>${label}</b> (${arr.length})</div><div class="table-wrap"><table><tbody>` +
        arr.map((x) => `<tr><td>${esc(x.plate || '')}</td><td class="mono">${esc(x.hawb)}</td><td class="mono">${esc(x.wo)}</td><td>${esc(x.code)}</td><td>${fmtDt(x.at)}</td><td>${esc(x.reason || '')}</td></tr>`).join('') +
        '</tbody></table></div>'
      : '');
    $('cca-detail').innerHTML = table(st.wouldSend, st.dry ? 'จะส่ง (ยังไม่ส่งจริง)' : 'ส่งในรอบล่าสุด') + table(st.held, 'พักไว้ ให้ตรวจเอง');
  }
  function renderAutoState() {
    $('cca-on').checked = !!ccAuto.enabled;
    $('cca-mode').value = ccAuto.mode || 'dry';
    $('cca-delay').value = ccAuto.delayMin;
    $('cca-max').value = ccAuto.maxPerDay;
    $('cca-state').textContent = ccAuto.enabled ? (ccAuto.mode === 'live' ? '· เปิด (ส่งจริง)' : '· เปิด (ทดลอง)') : '· ปิด';
  }
  async function saveAuto(patch) {
    ccAuto = { ...ccAuto, ...patch };
    await ccStore.set('ccAuto', ccAuto);
    const user = $('cc-user').value.trim(), role = $('cc-role').value.trim();
    if (user && role) await ccStore.set('ccUser', { user, role }); // background ต้องใช้ชื่อผู้ใช้/Role
    renderAutoState();
  }
  // เปิดโหมดส่งจริงได้ต่อเมื่อเคยรันทดลองสำเร็จ และผู้ใช้ยืนยันแล้ว
  function allowLive() {
    if (!ccAuto.dryVerifiedAt) { toast('ต้องกด "รันทดลองตอนนี้" ให้สำเร็จก่อน จึงเปิดส่งจริงได้', true); return false; }
    return confirm('เปิดส่งอัตโนมัติแบบ "ส่งจริง"?\n\n• ส่งเข้าระบบ Carrier Connect ด้วยบัญชีของคุณ แก้/ลบย้อนหลังจากที่นี่ไม่ได้\n• ต้องเปิด Chrome และแท็บ Carrier Connect ที่ล็อกอินค้างไว้\n• ใช้เครื่องนี้เครื่องเดียว\n• ช่องทางนี้ไม่ใช่ API ทางการ');
  }
  $('cca-on').addEventListener('change', async () => {
    const on = $('cca-on').checked;
    if (on && ccAuto.mode === 'live' && !allowLive()) { $('cca-on').checked = false; return; }
    await saveAuto({ enabled: on });
  });
  $('cca-mode').addEventListener('change', async () => {
    const mode = $('cca-mode').value;
    if (mode === 'live' && ccAuto.enabled && !allowLive()) { $('cca-mode').value = ccAuto.mode; return; }
    await saveAuto({ mode });
  });
  $('cca-delay').addEventListener('change', () => saveAuto({ delayMin: Math.max(0, Math.min(180, parseInt($('cca-delay').value, 10) || 0)) }));
  $('cca-max').addEventListener('change', () => saveAuto({ maxPerDay: Math.max(0, Math.min(500, parseInt($('cca-max').value, 10) || 0)) }));
  $('cca-now').addEventListener('click', async () => {
    const user = $('cc-user').value.trim(), role = $('cc-role').value.trim();
    if (!user || !role) return toast('ใส่ชื่อผู้ใช้และ Role ของ Carrier Connect ก่อน', true);
    await ccStore.set('ccUser', { user, role });
    $('cca-now').disabled = true;
    try {
      const st = await chrome.runtime.sendMessage({ type: 'cc-auto-now' });
      renderAutoStatus(st);
      if (st && st.ok && st.dry) { await saveAuto({ dryVerifiedAt: st.at }); toast('รันทดลองสำเร็จ (ยังไม่ได้ส่งจริง)'); }
      else toast((st && st.message) || 'ไม่มีผลตอบกลับ', true);
    } catch (e) { toast('รันไม่ได้: ' + e.message, true); }
    $('cca-now').disabled = false;
  });
  (async () => {
    ccAuto = { ...AUTO_DEFAULT, ...((await ccStore.get('ccAuto')) || {}) };
    renderAutoState();
    renderAutoStatus(await ccStore.get('ccAutoStatus'));
  })();
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((ch, area) => {
      if (area !== 'local') return;
      if (ch.ccAuto) { ccAuto = { ...AUTO_DEFAULT, ...(ch.ccAuto.newValue || {}) }; renderAutoState(); }
      if (ch.ccAutoStatus) renderAutoStatus(ch.ccAutoStatus.newValue);
      if (ch.ccLog && $('view-cc').classList.contains('active')) renderCc();
    });
  }

  // ส่ง DELIVERED สำเร็จครบทุก HAWB ของเที่ยว → เที่ยวเป็น "บันทึกเว็บลูกค้าแล้ว" (เฉพาะเที่ยวที่รอบันทึกอยู่)
  async function ccMarkDone() {
    const okDel = new Set(ccLog.filter((l) => l.ok && l.code === 'DELIVERED').map((l) => CcSync.hawbKey(l.hawb)));
    let n = 0;
    for (const t of db.trips) {
      if (t.status !== 'pending_delivery_entry' || !t.hawbs.length) continue;
      if (!t.hawbs.every((h) => okDel.has(CcSync.hawbKey(h.hawb)))) continue;
      t.events = (t.events || []).filter((e) => e.type !== 'del_filled').concat({ type: 'del_filled', at: new Date().toISOString(), source: 'carrier-connect' });
      t.status = 'done';
      n++;
    }
    if (n) { await persist(['trips']); toast(`เปลี่ยนสถานะ ${n} เที่ยวเป็น บันทึกเว็บลูกค้าแล้ว`); }
  }

  async function ccDoSend(rows) {
    if (!rows.length) return toast('ยังไม่ได้เลือกรายการ', true);
    if (ccAuto.enabled && ccAuto.mode === 'live') return toast('ปิดส่งอัตโนมัติก่อน แล้วค่อยส่งด้วยมือ (กันส่งซ้ำพร้อมกัน)', true);
    const s = await ccCheckSession();
    if (s.error) return toast(s.error, true);
    const est = rows.filter((r) => r.estimated).length;
    if (!confirm(`ยืนยันบันทึก ${rows.length} รายการลงเว็บลูกค้า?\nบันทึกแล้วแก้ไข/ลบจากที่นี่ไม่ได้` + (est ? `\n\n⚠ ${est} รายการเป็นเวลา "ประมาณ" จากเส้นทาง (ไม่ใช่เวลาที่ GPS เห็นจริง) ตรวจแล้วใช่ไหม?` : ''))) return;
    $('cc-send').disabled = true;
    try {
      const results = await CcSync.send(rows, s.transport, { remarks: (r) => (r.job ? 'TMS JOB ' + r.job : '') });
      const now = new Date().toISOString();
      for (const x of results) ccLog.push({ sentAt: now, user: '', job: x.row.job, hawb: x.row.hawb, wo: x.row.wo, code: x.row.code, eventDateTime: x.row.utc, ok: x.ok, message: x.message });
      ccLog = ccLog.slice(-5000);
      await ccStore.set('ccLog', ccLog);
      ccLastFailed = results.filter((x) => !x.ok).map((x) => x.row);
      const ok = results.length - ccLastFailed.length;
      $('cc-result').innerHTML = `<div class="notice ${ccLastFailed.length ? 'warn' : 'info'}"><h3>สำเร็จ ${ok} · ล้มเหลว ${ccLastFailed.length}</h3>` +
        (ok ? '<div class="muted">หน้าเว็บ Carrier Connect แคชรายการไว้ — กด <b>รีเฟรชหน้าเว็บลูกค้า</b> เพื่อเห็นงานย้ายไปแท็บใหม่ (หลังรีเฟรช ตัวดักหาย ต้องสลับแท็บสถานะ 1 ครั้งแล้วกด ตรวจ session ใหม่ ก่อนส่งชุดต่อไป)</div>' : '') +
        results.filter((x) => !x.ok).map((x) => `<div>❌ <span class="mono">${esc(x.row.hawb)}</span> ${esc(x.row.code)} — ${esc(x.message)}</div>`).join('') + '</div>';
      $('cc-retry').hidden = !ccLastFailed.length;
      ccSelected.clear();
      await ccMarkDone();
    } finally { $('cc-send').disabled = false; }
    renderCc();
  }
  $('cc-send').addEventListener('click', () => ccDoSend(ccRows.filter((r) => r.state === 'ready' && ccSelected.has(ccKey(r)))));
  $('cc-retry').addEventListener('click', () => ccDoSend(ccLastFailed.filter((r) => ccRows.some((x) => ccKey(x) === ccKey(r) && x.state === 'ready'))));
  $('cc-csv').addEventListener('click', async () => {
    const log = (await ccStore.get('ccLog')) || [];
    if (!log.length) return toast('ยังไม่มี log', true);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([CcSync.logToCsv(log)], { type: 'text/csv;charset=utf-8' }));
    a.download = 'carrier-connect-log_' + todayStr() + '.csv';
    a.click();
  });

  // ---------- เริ่ม ----------
  try {
    const sub = document.querySelector('.brand-sub');
    if (sub && chrome.runtime.getManifest) sub.textContent += ' · v' + chrome.runtime.getManifest().version;
  } catch (e) { /* ไม่สำคัญ */ }
  renderGpsPill();
  let start = 'trips';
  try { start = localStorage.getItem('ap.lastTab') || 'trips'; } catch (e) { /* ไม่สำคัญ */ }
  const noPolygon = db.stations.filter((s) => s.fixed && !s.polygon).length;
  if (noPolygon === db.stations.filter((s) => s.fixed).length && !db.trips.length) start = 'stations';
  showTab(start);
})();

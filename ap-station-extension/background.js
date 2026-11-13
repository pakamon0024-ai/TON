// คลิกไอคอนแล้วเปิดหน้าหลักของ Extension (ถ้าเปิดอยู่แล้วให้สลับไปแท็บเดิม)
// ช่วง 2: ดึง GPS ตามรอบด้วย chrome.alarms แล้วตรวจจับเข้า-ออก polygon ของเที่ยวที่ยังไม่เสร็จ
importScripts('lib/geo.js', 'lib/store.js', 'lib/detect.js', 'lib/gps.js', 'lib/sync.js', 'lib/ccsync.js');

const APP_URL = chrome.runtime.getURL('app.html');
const ALARM = 'gps-poll';
const CC_ALARM = 'cc-auto'; // ส่งเวลาเข้า Carrier Connect อัตโนมัติ (ปิดไว้เป็นค่าตั้งต้น)
const CC_EVERY_MIN = 5;
const TRACK_DAYS = 2; // ติดตามเที่ยวที่ยังไม่เสร็จย้อนหลังกี่วัน

chrome.action.onClicked.addListener(async () => {
  const tabs = await chrome.tabs.query({ url: APP_URL + '*' });
  if (tabs.length) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: APP_URL });
  }
});

async function scheduleAlarm() {
  const { settings } = await Store.load();
  await chrome.alarms.create(ALARM, { periodInMinutes: Math.max(30, settings.pollSeconds) / 60 });
  await chrome.alarms.create(CC_ALARM, { periodInMinutes: CC_EVERY_MIN });
}

chrome.runtime.onInstalled.addListener(scheduleAlarm);
chrome.runtime.onStartup.addListener(scheduleAlarm);
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === ALARM) queued(() => runCycle(true));
  if (a.name === CC_ALARM) queued(() => runCcAuto({}));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) scheduleAlarm();
});
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === 'poll-now') { queued(() => runCycle(true)).then(reply); return true; }
  if (msg && msg.type === 'push-all') { queued(() => Sync.pushAll(Store)).then(reply, (e) => reply({ ok: false, message: e.message })); return true; }
  if (msg && msg.type === 'adopt-remote') { queued(() => Sync.adoptRemote(Store)).then(reply, (e) => reply({ ok: false, message: e.message })); return true; }
  if (msg && msg.type === 'cc-auto-now') { queued(() => runCcAuto({ forceDry: true })).then(reply, (e) => reply({ ok: false, message: e.message })); return true; }
  if (msg && msg.type === 'sync-now') { queued(() => runCycle(false)).then(reply); return true; }
});

const isActive = (t, cutoff) => t.status !== 'done' && t.date >= cutoff;

// รันทีละงาน กัน GPS รอบใหม่/ซิงก์ซ้อนกันเขียนทับ storage
let chain = Promise.resolve();
const queued = (fn) => (chain = chain.then(fn, fn));

// ดึง GPS + ตรวจจับเข้า-ออก; pos = ตำแหน่งล่าสุดต่อทะเบียน (เอาไปประกาศให้เครื่องอื่น)
async function gpsPart(pos) {
  const status = { at: new Date().toISOString(), ok: false, message: '', tracked: 0, matched: 0, events: 0 };
  try {
    const before = await Store.load();
    const cutoff = new Date(Date.now() - TRACK_DAYS * 86400000).toISOString().slice(0, 10);
    status.tracked = before.trips.filter((t) => isActive(t, cutoff)).length;
    if (!status.tracked) { status.ok = true; status.message = 'ไม่มีเที่ยวที่ต้องติดตาม'; return status; }

    const plates = [...new Set(before.trips.filter((t) => isActive(t, cutoff)).map((t) => t.plate))];
    const { records, errors } = await Gps.fetchPositions(before.settings, plates);
    status.failed = errors;

    // โหลดใหม่ก่อนเขียน เผื่อผู้ใช้นำเข้า/ลบเที่ยวระหว่างรอ GPS ตอบ
    const db = await Store.load();
    for (const t of db.trips) {
      if (!isActive(t, cutoff)) continue;
      const recs = records.filter((r) => Detect.plateMatches(t.plate, r.plate));
      if (!recs.length) continue;
      status.matched++;
      recs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      for (const r of recs) if (Detect.applyPosition(t, db.stations, r)) status.events++;
      const last = recs[recs.length - 1];
      pos[t.plate] = { lat: last.lat, lng: last.lng, speed: last.speed || 0, time: last.time };
    }
    await Store.save({ trips: db.trips });
    status.ok = true;
    status.message = `พบพิกัด ${records.length}/${plates.length} คัน · ตรงกับเที่ยว ${status.matched}/${status.tracked}` +
      (errors.length ? ` · ผิดพลาด: ${errors.slice(0, 3).join('; ')}` : '');
  } catch (e) {
    status.message = e.message;
  }
  return status;
}

// หนึ่งรอบ: ดึงของคนอื่น → (เครื่อง poller) ดึง GPS → ส่งของเราและตำแหน่งรถ
async function runCycle(withGps) {
  const { settings } = await Store.load();
  const syncOn = Sync.enabled(settings);
  const cloud = syncOn && settings.cloudGps; // GPS ดึงโดยคลาวด์ เครื่องนี้ซิงก์อย่างเดียว (ยกเว้นคลาวด์เงียบ → สำรองดึงเอง)
  const syncStatus = { at: new Date().toISOString(), ok: true, message: '' };
  const trySync = async (opts) => {
    try { const r = await Sync.syncNow(Store, opts); syncStatus.message = r.message; }
    catch (e) { syncStatus.ok = false; syncStatus.message = e.message; }
  };

  if (syncOn) await trySync();

  // คลาวด์ถือว่าทำงานอยู่ถ้ารายงานล่าสุดสำเร็จและไม่เก่ากว่า 5 นาที
  const cs = cloud ? ((await Store.load()).syncMeta || {}).status : null;
  const cloudAlive = !!(cs && cs.ok && Date.now() - Date.parse(cs.at) < 5 * 60000);
  // เครื่อง poller ดึงเองเมื่อ: ไม่ใช้ซิงก์ / ใช้ซิงก์แบบเครื่อง poller / โหมดคลาวด์แต่คลาวด์เงียบ (ต้องมี Token GPS ในเครื่องนี้)
  const failover = cloud && !cloudAlive && !!settings.gpsToken && settings.isPoller;
  const doGps = withGps && (!syncOn || (cloud ? failover : settings.isPoller));

  const pos = {};
  let gps;
  if (doGps) {
    gps = await gpsPart(pos);
    if (failover) gps.message = 'คลาวด์ไม่ตอบ → เครื่องนี้ดึงแทน · ' + gps.message;
  } else if (cloud) {
    gps = cs ? { ...cs, ok: cs.ok && cloudAlive, message: 'คลาวด์: ' + cs.message + (cloudAlive ? '' : ' (รายงานเก่าเกิน 5 นาที)') }
      : { at: new Date().toISOString(), ok: false, message: 'ยังไม่มีรายงานจากตัวดึง GPS บนคลาวด์ (ตรวจ cron/ฟังก์ชัน)' + (settings.gpsToken ? '' : ' · ใส่ Token GPS และติ๊ก "เครื่องดึง GPS" เพื่อให้เครื่องนี้ดึงแทน') };
  } else gps = { at: new Date().toISOString(), ok: true, message: withGps ? 'เครื่องนี้ไม่ได้ดึง GPS (ซิงก์อย่างเดียว)' : '' };
  if (syncOn) await trySync({ pos });

  await Store.save({ gpsStatus: gps, syncStatus: syncOn ? syncStatus : null });
  return { ...gps, message: [gps.message, syncOn && (syncStatus.ok ? '' : 'ซิงก์ผิดพลาด: ') + syncStatus.message].filter(Boolean).join(' · '), ok: gps.ok && syncStatus.ok };
}


// ---------- ส่งเวลาเข้า Carrier Connect อัตโนมัติ ----------
// ปลอดภัยไว้ก่อน: ปิดเป็นค่าตั้งต้น · โหมดทดลองไม่ส่งจริง · ส่งเฉพาะเวลาที่ GPS เห็นจริง (ไม่ใช่ "ประมาณ") หลังหน่วงเวลา
// เจอ session ผิด/เครือข่ายล้ม → ปิดระบบทันที · ต้องเปิดแท็บ Carrier Connect และล็อกอินค้างไว้ (ล็อกอินแทนไม่ได้)
const CC_DAY_MS = 86400000;

async function runCcAuto(opts) {
  const get = async (k) => (await chrome.storage.local.get(k))[k];
  const cfg = (await get('ccAuto')) || {};
  if (!cfg.enabled && !opts.forceDry) return;
  const dry = !!opts.forceDry || cfg.mode !== 'live';
  const status = { at: new Date().toISOString(), dry, ok: false, message: '', wouldSend: [], held: [], sent: 0, failed: 0 };
  const finish = async () => { await chrome.storage.local.set({ ccAutoStatus: status }); return status; };
  const badge = (t) => { try { chrome.action.setBadgeText({ text: t }); if (t) chrome.action.setBadgeBackgroundColor({ color: '#c62828' }); } catch (e) { /* ไม่เป็นไร */ } };
  const stopAll = async (msg) => {
    status.message = msg;
    if (cfg.enabled) { cfg.enabled = false; await chrome.storage.local.set({ ccAuto: cfg }); }
    badge('!');
    return finish();
  };

  try {
    const who = (await get('ccUser')) || {};
    if (!who.user || !who.role) { status.message = 'ยังไม่ได้ตั้งผู้ใช้/Role ของ Carrier Connect'; return finish(); }

    const s = await CcSync.readSession();
    if (s.error) { status.message = 'รอ session: ' + s.error; if (!opts.forceDry) badge('!'); return finish(); }

    const r = await CcSync.fetchWorkOrders(s.transport, { user: who.user, role: who.role });
    if (r.auth) return stopAll('session Carrier Connect ไม่ถูกต้อง/หมดอายุ — ปิดส่งอัตโนมัติแล้ว ล็อกอินใหม่แล้วเปิดเอง');
    // ข้อมูล WO ไม่ครบ = ตรวจ "ส่งแล้ว/สถานะ" ไม่ได้ → ไม่ส่งรอบนี้
    if (r.errors.length || !r.workOrders.length) { status.message = 'ดึงรายการ WO ไม่ครบ: ' + (r.errors.join('; ') || 'ไม่พบ WO'); return finish(); }

    const db = await Store.load();
    const cutoff = new Date(Date.now() - TRACK_DAYS * CC_DAY_MS).toISOString().slice(0, 10);
    const trips = db.trips.filter((t) => t.date >= cutoff);
    const log = (await get('ccLog')) || [];
    const since = Date.now() - CC_DAY_MS;
    const recent = log.filter((l) => Date.parse(l.sentAt) >= since);
    const sentSet = new Set(log.filter((l) => l.ok).map((l) => l.wo + '|' + l.code));
    const failedKeys = new Set(recent.filter((l) => !l.ok).map((l) => l.wo + '|' + l.code));
    const quota = Math.max(0, (cfg.maxPerDay == null ? 30 : cfg.maxPerDay) - recent.filter((l) => l.ok).length);

    const plan = CcSync.buildPlan(trips, { workOrders: r.workOrders, sent: sentSet, includeArrived: false });
    const pick = CcSync.autoSelect(plan, { delayMin: cfg.delayMin == null ? 10 : cfg.delayMin, failedKeys, max: quota });
    const light = (x) => ({ plate: x.plate, hawb: x.hawb, wo: x.wo, code: x.code, at: x.at });
    status.held = pick.held.slice(0, 30).map((h) => ({ ...light(h.row), reason: h.reason }));
    status.wouldSend = pick.selected.slice(0, 50).map(light);

    if (dry) {
      status.ok = true;
      status.message = `ทดลอง: จะส่ง ${pick.selected.length} รายการ · พักไว้ ${pick.held.length} · โควตาเหลือ ${quota} (ยังไม่ส่งจริง)`;
      return finish();
    }
    if (!pick.selected.length) { status.ok = true; status.message = `ไม่มีรายการที่ต้องส่ง · พักไว้ ${pick.held.length}`; badge(''); return finish(); }

    const results = await CcSync.send(pick.selected, s.transport, { remarks: (x) => (x.job ? 'TMS JOB ' + x.job : '') });
    const now = new Date().toISOString();
    const fresh = (await get('ccLog')) || [];
    for (const x of results) fresh.push({ sentAt: now, user: who.user, job: x.row.job, hawb: x.row.hawb, wo: x.row.wo, code: x.row.code, eventDateTime: x.row.utc, ok: x.ok, message: x.message, auto: true });
    await chrome.storage.local.set({ ccLog: fresh.slice(-5000) });
    status.sent = results.filter((x) => x.ok).length;
    status.failed = results.length - status.sent;

    // สถานะเที่ยว: ส่ง DELIVERED ครบ → "บันทึกเว็บลูกค้าแล้ว"
    const db2 = await Store.load();
    if (CcSync.applyDone(db2.trips, fresh, now)) await Store.save({ trips: db2.trips });

    if (results.some((x) => x.auth || x.network)) {
      return stopAll('เครือข่าย/session ผิดพลาดระหว่างส่ง (ไม่แน่ใจว่าบันทึกแล้วหรือยัง) — ปิดส่งอัตโนมัติแล้ว ตรวจในเว็บลูกค้าก่อนเปิดใหม่');
    }
    status.ok = status.failed === 0;
    status.message = `ส่งสำเร็จ ${status.sent} · ล้มเหลว ${status.failed} · พักไว้ ${pick.held.length}` + (status.failed ? ' (รายการที่ล้มเหลวจะไม่ถูกส่งซ้ำเอง ต้องตรวจมือ)' : '');
    badge(status.failed ? '!' : '');
    return finish();
  } catch (e) {
    status.message = 'ผิดพลาด: ' + e.message;
    return finish();
  }
}

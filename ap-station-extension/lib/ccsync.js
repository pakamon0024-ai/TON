// ส่งเวลาเข้า–ออกจาก GPS ไปบันทึกที่ Carrier Connect (Expeditors) ตาม spec-carrier-connect-extension
// ส่วนวางแผน (buildPlan) เป็นฟังก์ชันล้วน ทดสอบด้วย node ได้; ส่วนส่งจริง (send) ใช้ fetch + token ของผู้ใช้ที่ล็อกอินอยู่
(function (root) {
  const API_URL = 'https://serviceprovider-api.expeditors.com/graphql';
  const BATCH = 20;

  // เหตุการณ์ในเที่ยว → statusEventCode (ลำดับเวลาต้องเรียงตาม rank)
  const EVENTS = [
    { type: 'pick_in', code: 'ARRIVED_PICKUP_LOCATION', rank: 1, tested: false, label: 'เข้าจุดรับ' },
    { type: 'pick_out', code: 'PICKED_UP', rank: 2, tested: true, label: 'ออกจุดรับ' },
    { type: 'del_in', code: 'ARRIVED_DELIVERY_LOCATION', rank: 3, tested: false, label: 'เข้าจุดส่ง' },
    { type: 'del_out', code: 'DELIVERED', rank: 4, tested: true, label: 'ส่งเสร็จ' }
  ];

  const MUTATION = 'mutation workorderoperation($statusList: [StatusEventInput]) { updateStatusForMultipleWorkOrdersPortal(statusList: $statusList) { workOrderResponseList { workOrderNumber errorMessage workOrderStatus } completedWorkOrder failedWorkOrder } }';

  // BR1: ตัด /BKK และช่องว่างก่อนเทียบ
  const hawbKey = (s) => String(s || '').toUpperCase().replace(/\/BKK\b/g, '').replace(/\s+/g, '').trim();

  // เวลา ISO → yyyy-MM-ddTHH:mm:00Z (UTC, ปัดวินาทีเป็น 00)
  function toUtc(iso) {
    const t = Date.parse(iso);
    if (!(t > 0)) return null;
    const d = new Date(Math.floor(t / 60000) * 60000);
    return d.toISOString().slice(0, 19) + 'Z';
  }

  const WO_STATUSES = ['AVAILABLE', 'ACKNOWLEDGED', 'ACCEPTED', 'DECLINED', 'INTRANSIT', 'DELIVERED', 'REJECTED'];
  const EVENT_CODES = EVENTS.map((e) => e.code);

  // รับข้อความวาง 1 บรรทัดต่อ 1 WO จะคัดลอกทั้งแถวจากตารางเว็บลูกค้า (WORK ORDER, HOUSE BILL, GCI, ... ) หรือพิมพ์ "WO HAWB สถานะ" ก็ได้
  // หา WO = โทเค็นรูป F + ตัวเลข, HAWB = โทเค็นตัวเลขยาว (อาจมี /BKK), สถานะ/eventCode = โทเค็นที่รู้จัก ส่วนอื่น (GCI, ต้นทาง ฯลฯ) ข้าม
  function parseWoText(text) {
    const out = [];
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.replace(/IN[\s_-]+TRANSIT/gi, 'INTRANSIT');
      const parts = line.trim().split(/[\t,;\s]+/).filter(Boolean);
      if (parts.length < 2 || /^\s*work[\s_]*order/i.test(line)) continue; // ข้ามบรรทัดหัวตาราง
      const up = parts.map((x) => x.toUpperCase());
      // WO มีทั้งแบบ F842109682 และแบบตัวเลขล้วน 2840812310 → ใช้โทเค็นแรกที่เป็นรหัสยาว แล้ว House Bill คือเลขถัดไป (อาจมี /BKK)
      const wi = up.findIndex((x) => /^[A-Z]?\d{6,}$/.test(x));
      let wo = wi >= 0 ? up[wi] : undefined;
      let hb = wi >= 0 ? parts.slice(wi + 1).find((x) => /^\d{7,}(\/[A-Za-z]+)?$/.test(x)) : undefined;
      if (!wo || !hb) { wo = wo || parts[0]; hb = hb || parts[1]; } // รูปแบบอื่น: ตามตำแหน่งเดิม
      out.push({
        workOrderNumber: wo, houseBill: hb,
        status: up.find((x) => WO_STATUSES.includes(x)) || '',
        eventCodes: up.filter((x) => EVENT_CODES.includes(x))
      });
    }
    return out;
  }

  // สร้างแถวตรวจทาน 1 แถวต่อ (HAWB × event)
  // opts: { workOrders, sent:Set('WO|CODE'), now:ms, includeArrived:bool }
  function buildPlan(trips, opts) {
    const now = opts.now || Date.now();
    const sent = opts.sent || new Set();
    const byKey = new Map();
    for (const w of opts.workOrders || []) {
      const k = hawbKey(w.houseBill);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(w);
    }
    const rows = [];
    for (const t of trips) {
      const evOf = (type) => (t.events || []).find((e) => e.type === type);
      for (const h of t.hawbs || []) {
        const wos = byKey.get(hawbKey(h.hawb)) || [];
        const base = { tripKey: t.key, plate: t.plate, date: t.date, hawb: h.hawb, job: t.no || '' };
        if (wos.length === 0) { rows.push({ ...base, state: 'notfound', reason: 'ไม่พบในระบบลูกค้า' }); continue; }
        if (wos.length > 1) { rows.push({ ...base, state: 'dup', reason: 'HAWB ตรงหลาย WO: ' + wos.map((w) => w.workOrderNumber).join(', ') }); continue; }
        const wo = wos[0];
        const have = new Set([...(wo.eventCodes || [])]);
        // eventCode ที่เว็บเก็บ (เช่น PUO, DRA) ไม่ใช่ชื่อเดียวกับ statusEventCode ที่เราส่ง (PICKED_UP) → ใช้สถานะ WO เป็นตัวบอกว่ารับแล้ว (PICKED_UP ทำให้ WO เป็น INTRANSIT)
        if (wo.status === 'INTRANSIT') have.add('PICKED_UP');
        const info = { ...base, wo: wo.workOrderNumber, woStatus: wo.status };
        if (wo.status === 'DELIVERED' || wo.status === 'REJECTED') { rows.push({ ...info, state: 'sent', reason: 'WO สถานะ ' + wo.status + ' แล้ว' }); continue; }
        if (wo.status === 'ACKNOWLEDGED') { rows.push({ ...info, state: 'blocked', reason: 'WO ยังเป็น ACKNOWLEDGED — ต้อง Accept ในเว็บลูกค้าก่อน' }); continue; }
        if (wo.status === 'DECLINED') { rows.push({ ...info, state: 'blocked', reason: 'WO สถานะ DECLINED (ปฏิเสธแล้ว)' }); continue; }

        // BR7 + เรียงเวลา: เก็บเฉพาะ event ที่มีเวลา แล้วตรวจว่าเรียงกัน
        const cand = [];
        for (const e of EVENTS) {
          if (!opts.includeArrived && !e.tested) continue;
          const ev = evOf(e.type);
          cand.push({ e, at: ev && ev.at && Date.parse(ev.at) > 0 ? ev.at : null });
        }
        const allTimes = EVENTS.map((e) => { const ev = evOf(e.type); return ev && Date.parse(ev.at) > 0 ? Date.parse(ev.at) : null; });
        const filled = allTimes.filter((x) => x != null);
        const ordered = filled.every((v, i) => !i || v >= filled[i - 1]);
        let pickedUpKnown = have.has('PICKED_UP') || wo.status === 'INTRANSIT' || sent.has(wo.workOrderNumber + '|PICKED_UP');

        for (const { e, at } of cand) {
          const evObj = evOf(e.type);
          // เวลาที่คำนวณจากเส้นทางระหว่างรอบ GPS (ไม่ใช่จุดที่เห็นจริง) คลาดได้หลายนาที → ให้ผู้ใช้เลือกส่งเองทีละรายการ
          const r = { ...info, type: e.type, code: e.code, label: e.label, at, utc: at ? toUtc(at) : null, estimated: !!(evObj && evObj.source === 'gps-path') };
          if (!at) { rows.push({ ...r, state: 'nogps', reason: 'ไม่มีข้อมูล GPS' }); continue; }
          if (have.has(e.code) || sent.has(wo.workOrderNumber + '|' + e.code)) { rows.push({ ...r, state: 'sent', reason: 'ส่งแล้ว' }); continue; }
          if (!ordered) { rows.push({ ...r, state: 'blocked', reason: 'เวลาเรียงไม่ถูกต้อง (เข้ารับ ≤ ออกรับ ≤ เข้าส่ง ≤ ส่งเสร็จ)' }); continue; }
          if (Date.parse(at) > now) { rows.push({ ...r, state: 'blocked', reason: 'เวลาอยู่ในอนาคต' }); continue; }
          if (e.code === 'DELIVERED' && !pickedUpKnown && !(cand.some((c) => c.e.code === 'PICKED_UP' && c.at && !have.has('PICKED_UP')))) {
            rows.push({ ...r, state: 'blocked', reason: 'ยังไม่มี PICKED_UP (BR5)' }); continue;
          }
          rows.push({ ...r, state: 'ready', reason: r.estimated ? 'เวลาประมาณจากเส้นทาง (รถขับผ่านระหว่างรอบ GPS) ตรวจก่อนส่ง' : '', needsPickedUp: e.code === 'DELIVERED' && !pickedUpKnown });
        }
      }
    }
    return rows;
  }

  function statusInput(row, remarks) {
    return {
      workOrderNumber: row.wo, statusEventCode: row.code, eventDateTime: row.utc,
      remarks: remarks || '', carrierCode: '', count: '', proNumber: '', reference: '', documents: []
    };
  }

  // จัดเป็นชุดตามลำดับ event (rank) ชุดละไม่เกิน BATCH งาน; DELIVERED ของ WO ที่ PICKED_UP ไม่สำเร็จจะถูกข้ามใน send()
  function makeBatches(rows) {
    const rank = (c) => EVENTS.find((e) => e.code === c).rank;
    const groups = new Map();
    for (const r of rows) { const k = rank(r.code); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
    const batches = [];
    for (const k of [...groups.keys()].sort()) {
      const g = groups.get(k);
      for (let i = 0; i < g.length; i += BATCH) batches.push(g.slice(i, i + BATCH));
    }
    return batches;
  }

  // ส่งจริง: rows = แถวที่ผู้ใช้ติ๊ก; คืนผลต่อแถว { row, ok, message }
  // ไม่ retry อัตโนมัติ (กันส่งซ้ำ); network error → แถวทั้งชุดเป็น error ให้ผู้ใช้กดส่งซ้ำเอง
  async function send(rows, transport, hooks) {
    const results = [];
    const failedWo = new Set(); // WO ที่ PICKED_UP ล้มเหลว → ไม่ส่ง DELIVERED ต่อ
    for (const batch of makeBatches(rows)) {
      const todo = [];
      for (const r of batch) {
        if (r.code === 'DELIVERED' && failedWo.has(r.wo)) results.push({ row: r, ok: false, message: 'ข้าม: PICKED_UP ของงานนี้ไม่สำเร็จ' });
        else todo.push(r);
      }
      if (!todo.length) continue;
      let res;
      try {
        const resp = await transport({ operationName: null, variables: { statusList: todo.map((r) => statusInput(r, hooks && hooks.remarks && hooks.remarks(r))) }, query: MUTATION });
        if (resp.status === 401 || resp.status === 403) {
          for (const r of todo) results.push({ row: r, ok: false, message: 'session หมดอายุ/ไม่มีสิทธิ์ (HTTP ' + resp.status + ') — ล็อกอิน Carrier Connect ใหม่', auth: true });
          break; // หยุดทันที ไม่ส่งชุดถัดไป
        }
        if (!(resp.status >= 200 && resp.status < 300)) throw new Error('HTTP ' + resp.status);
        res = resp.json || {};
      } catch (err) {
        for (const r of todo) results.push({ row: r, ok: false, message: 'เครือข่ายผิดพลาด: ' + err.message + ' (ไม่แน่ใจว่าบันทึกแล้วหรือยัง — ตรวจในเว็บลูกค้าก่อนส่งซ้ำ)', network: true });
        continue;
      }
      if (res.errors && res.errors.length) {
        for (const r of todo) results.push({ row: r, ok: false, message: 'GraphQL: ' + res.errors.map((x) => x.message).join('; ') });
        todo.filter((r) => r.code === 'PICKED_UP').forEach((r) => failedWo.add(r.wo));
        continue;
      }
      const d = (res.data && res.data.updateStatusForMultipleWorkOrdersPortal) || {};
      const done = new Set(d.completedWorkOrder || []);
      const msgOf = new Map((d.workOrderResponseList || []).map((x) => [x.workOrderNumber, x]));
      for (const r of todo) {
        const m = msgOf.get(r.wo);
        const ok = done.has(r.wo) && !(m && m.errorMessage);
        if (!ok && r.code === 'PICKED_UP') failedWo.add(r.wo);
        results.push({ row: r, ok, message: ok ? (m && m.workOrderStatus) || 'สำเร็จ' : (m && m.errorMessage) || 'ล้มเหลว (ไม่มีข้อความจากระบบ)' });
      }
    }
    return results;
  }

  // ดึงรายการ WO (อ่านอย่างเดียว) ตามสถานะ ทีละหน้า: query getWorkOrdersForServiceProviderbyStatusPagination (ดักจากเว็บจริง)
  // คืน { workOrders:[{workOrderNumber, houseBill, status, eventCodes}], errors:[] }
  const FETCH_STATUSES = ['ACCEPTED', 'INTRANSIT', 'ACKNOWLEDGED'];
  const PAGE_SIZE = 50, MAX_PAGES = 20;
  const woQuery = (status, page, user, role) =>
    'query { getWorkOrdersForServiceProviderbyStatusPagination(status: ' + status + ', pageNumber: "' + page + '", numberRecords: "' + PAGE_SIZE +
    '", assignedUserName: ' + JSON.stringify(user) + ', userRole: ' + JSON.stringify(role) +
    ', searchKey: "", workOrderNumberFilter: "", portOriginFilter: "", portDestinFilter: "", houseBillFilter: "", assigneeFilter: "", sort: "") ' +
    '{ workOrderNumber status houseBill bookingStatusEvents { eventCode } } }';

  // ชื่อ enum ของสถานะ "IN TRANSIT" ที่หน้าเว็บแสดงมีช่องว่าง ไม่แน่ชัดว่าใน query เป็นแบบไหน → ลองตามลำดับจนกว่าจะไม่ error
  const STATUS_ALIASES = { INTRANSIT: ['INTRANSIT', 'IN_TRANSIT'] };

  async function fetchWorkOrders(transport, opts) {
    const statuses = (opts.statuses || FETCH_STATUSES).filter((x) => /^[A-Z_]+$/.test(x));
    const workOrders = [], errors = [];
    // ดึงทุกหน้าของสถานะหนึ่งด้วยชื่อ enum หนึ่งชื่อ → { rows } หรือ { error, auth }
    async function pages(name, label) {
      const rows = [];
      for (let page = 0; page < MAX_PAGES; page++) {
        let json;
        try {
          const resp = await transport({ operationName: null, variables: {}, query: woQuery(name, page, opts.user || '', opts.role || '') });
          if (resp.status === 401 || resp.status === 403) return { error: 'session หมดอายุ/ไม่มีสิทธิ์ (HTTP ' + resp.status + ')', auth: true };
          if (!(resp.status >= 200 && resp.status < 300)) throw new Error('HTTP ' + resp.status);
          json = resp.json || {};
        } catch (e) { return { error: name + ': ' + e.message, soft: true }; }
        if (json.errors && json.errors.length) return { error: name + ': ' + json.errors.map((x) => x.message).join('; ') };
        const list = (json.data && json.data.getWorkOrdersForServiceProviderbyStatusPagination) || [];
        for (const w of list) {
          rows.push({
            workOrderNumber: w.workOrderNumber, houseBill: w.houseBill,
            status: String(w.status || label).toUpperCase().replace(/[^A-Z]/g, ''),
            eventCodes: (w.bookingStatusEvents || []).map((e) => String(e.eventCode || '').toUpperCase()).filter(Boolean)
          });
        }
        if (list.length < PAGE_SIZE) break;
      }
      return { rows };
    }
    for (const st of statuses) {
      const names = STATUS_ALIASES[st] || [st];
      let lastErr = null, ok = false;
      for (const name of names) {
        const r = await pages(name, st);
        if (r.auth) { errors.push(r.error); return { workOrders, errors, auth: true }; }
        if (r.rows) { workOrders.push(...r.rows); ok = true; break; }
        lastErr = r.error;
        if (r.soft) break; // เครือข่าย/HTTP ผิดพลาด ไม่ใช่ปัญหาชื่อ enum
      }
      if (!ok) errors.push(lastErr);
    }
    return { workOrders, errors };
  }

  // เลือกแถวที่ "ปลอดภัยพอ" จะส่งอัตโนมัติ (ที่เหลือพักไว้ให้คนตรวจ) — ฟังก์ชันล้วน ทดสอบด้วย node ได้
  // opts: { now, delayMin, failedKeys:Set('WO|CODE'), max }
  function autoSelect(rows, opts) {
    const now = opts.now || Date.now();
    const delayMs = (opts.delayMin == null ? 10 : opts.delayMin) * 60000;
    const failed = opts.failedKeys || new Set();
    const pre = [], held = [];
    for (const r of rows) {
      if (r.state !== 'ready') continue;
      if (r.estimated) { held.push({ row: r, reason: 'เวลาประมาณ — ต้องตรวจเอง' }); continue; }
      if (failed.has(r.wo + '|' + r.code)) { held.push({ row: r, reason: 'เคยส่งไม่สำเร็จ — ตรวจเอง' }); continue; }
      if (now - Date.parse(r.at) < delayMs) { held.push({ row: r, reason: 'รอหน่วงเวลา' }); continue; }
      pre.push(r);
    }
    // DELIVERED ของ WO ที่ยังไม่รู้ว่ารับแล้ว ต้องมี PICKED_UP ของ WO เดียวกันอยู่ในชุดที่จะส่ง
    const rank = (r) => (r.code === 'PICKED_UP' ? 1 : 2);
    pre.sort((x, y) => rank(x) - rank(y));
    const max = opts.max == null ? Infinity : Math.max(0, opts.max);
    const picked = new Set();
    const selected = [];
    for (const r of pre) {
      if (selected.length >= max) { held.push({ row: r, reason: 'เกินโควตาวันนี้' }); continue; }
      if (r.code === 'DELIVERED' && r.needsPickedUp && !picked.has(r.wo)) { held.push({ row: r, reason: 'ยังไม่มี PICKED_UP' }); continue; }
      if (r.code === 'PICKED_UP') picked.add(r.wo);
      selected.push(r);
    }
    return { selected, held };
  }

  // ส่ง DELIVERED สำเร็จครบทุก HAWB ของเที่ยว → เที่ยวที่ "รอบันทึกเว็บลูกค้า" เป็น "บันทึกเว็บลูกค้าแล้ว" คืนจำนวนเที่ยวที่เปลี่ยน
  function applyDone(trips, log, nowIso) {
    const okDel = new Set((log || []).filter((l) => l.ok && l.code === 'DELIVERED').map((l) => hawbKey(l.hawb)));
    let n = 0;
    for (const t of trips) {
      if (t.status !== 'pending_delivery_entry' || !(t.hawbs || []).length) continue;
      if (!t.hawbs.every((h) => okDel.has(hawbKey(h.hawb)))) continue;
      t.events = (t.events || []).filter((e) => e.type !== 'del_filled').concat({ type: 'del_filled', at: nowIso || new Date().toISOString(), source: 'carrier-connect' });
      t.status = 'done';
      n++;
    }
    return n;
  }

  // ช่องทางส่งคำขอ GraphQL: transport(body) → { status, json }
  // ตัวตรง (ใช้ทดสอบ) ส่งด้วย fetch + token ที่ให้มา
  function directTransport(token, fetchFn) {
    const f = fetchFn || fetch;
    return async (body) => {
      const resp = await f(API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
      let json = null;
      try { json = await resp.json(); } catch (e) { /* ไม่ใช่ JSON */ }
      return { status: resp.status, json };
    };
  }

  // Carrier Connect เก็บ token ใน localStorage แบบเข้ารหัส (อ่านไปใช้ไม่ได้) และเว็บตรวจที่มาของคำขอ
  // จึงส่งคำขอ "จากภายในแท็บ Carrier Connect เอง" โดยดัก Authorization จากคำขอที่เว็บส่งเองอยู่แล้ว
  // token เก็บในหน่วยความจำของหน้าเว็บเท่านั้น ไม่ส่งออกมาที่ Extension และไม่บันทึกลงที่ใด
  async function readSession() {
    const tabs = await chrome.tabs.query({ url: 'https://carrierconnect.expeditors.com/*' });
    if (!tabs.length) return { error: 'ไม่พบแท็บ Carrier Connect — เปิดเว็บและล็อกอินก่อน' };
    const tabId = tabs[0].id;
    // ฝังตัวดัก (ไฟล์เดียวกับ content script; ฝังซ้ำได้) แล้วเช็คว่าจับ token ได้หรือยัง
    await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', files: ['cc-hook.js'] });
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN',
      func: () => ({ hasToken: !!(window.__apCc && window.__apCc.tok) })
    });
    if (!result || !result.hasToken) {
      return { error: 'ติดตั้งตัวดักแล้ว — ในเว็บลูกค้ากดสลับแท็บสถานะ 1 ครั้ง (เช่น ACCEPTED ↔ ACKNOWLEDGED) แล้วกด "ตรวจ session" อีกครั้ง (อย่ารีเฟรชหน้าเว็บลูกค้า)', needAction: true };
    }
    const transport = async (body) => {
      const [{ result: r }] = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN', args: [body, API_URL],
        func: (b, url) => {
          const c = window.__apCc;
          if (!c || !c.tok) return { status: 401, json: null, noToken: true };
          return c.f.call(window, url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: c.tok }, body: JSON.stringify(b) })
            .then((resp) => resp.json().catch(() => null).then((json) => ({ status: resp.status, json })))
            .catch((e) => ({ status: 0, json: null, netError: String(e) }));
        }
      });
      if (!r) throw new Error('ไม่มีผลตอบกลับจากแท็บ Carrier Connect');
      if (r.netError) throw new Error(r.netError);
      return r;
    };
    return { transport, tabId, diag: 'ใช้ token จากคำขอของเว็บ (อยู่ในหน้าเว็บเท่านั้น)' };
  }

  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  function logToCsv(log) {
    const head = ['วันเวลาที่ส่ง', 'user', 'JOB', 'HAWB', 'WO', 'event', 'eventDateTime', 'ผล', 'errorMessage'];
    return '﻿' + [head, ...log.map((l) => [l.sentAt, l.user, l.job, l.hawb, l.wo, l.code, l.eventDateTime, l.ok ? 'สำเร็จ' : 'ล้มเหลว', l.ok ? '' : l.message])]
      .map((r) => r.map(csvCell).join(',')).join('\r\n');
  }

  const api = { EVENTS, BATCH, hawbKey, toUtc, parseWoText, buildPlan, statusInput, makeBatches, send, readSession, directTransport, fetchWorkOrders, autoSelect, applyDone, logToCsv };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CcSync = api;
})(this);

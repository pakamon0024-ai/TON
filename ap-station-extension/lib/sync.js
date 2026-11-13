// ซิงก์ข้อมูลกับ Supabase (REST) ให้ทุกเครื่องเห็นเที่ยว/สถานี/เส้นทางชุดเดียวกัน
// ตารางเดียว docs(kind, id, data, rev, updated_at):
//   trip/station/route = เอกสารที่แก้ได้ทุกคน กันทับกันด้วย rev (optimistic: PATCH ... rev=eq.N)
//   pos                = ตำแหน่งล่าสุดของรถแต่ละคัน เขียนโดยเครื่องที่ดึง GPS เท่านั้น
// ขัดแย้ง = ฝั่งเซิร์ฟเวอร์ชนะ (เครื่องที่แพ้จะได้ค่าใหม่ตอนดึงรอบถัดไป)
(function (root) {
  const COLLECTION = { trip: 'trips', station: 'stations', route: 'routes' };
  const ID_OF = { trip: (d) => d.key, station: (d) => d.id, route: (d) => d.id };
  const LOCAL_ONLY = ['lastPos', 'pending', 'lastGpsAt']; // เฉพาะเครื่อง/แยกซิงก์ต่างหาก
  const EPOCH = '1970-01-01T00:00:00Z';

  const enabled = (s) => !!(s && s.syncUrl && s.syncKey);

  function strip(kind, d) {
    const o = { ...d };
    if (kind === 'trip') LOCAL_ONLY.forEach((k) => delete o[k]);
    return o;
  }
  const stable = (v) => JSON.stringify(v, (k, x) =>
    x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((a, kk) => { a[kk] = x[kk]; return a; }, {}) : x);

  // ใช้เฉพาะ origin ของ URL (ตัด /rest/v1 หรือพาธที่ติดมาตอนคัดลอก)
  const baseOf = (u) => { try { return new URL(u).origin; } catch (e) { return String(u).replace(/\/+$/, ''); } };

  async function api(s, path, init) {
    let res;
    try {
      res = await fetch(baseOf(s.syncUrl) + '/rest/v1/' + path, {
        ...init,
        headers: { apikey: s.syncKey, ...(s.syncKey.startsWith('eyJ') ? { Authorization: 'Bearer ' + s.syncKey } : {}), 'Content-Type': 'application/json', ...((init && init.headers) || {}) }
      });
    } catch (e) { throw new Error('เชื่อมต่อฐานข้อมูลกลางไม่ได้ (' + e.message + ')'); }
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* ไม่ใช่ JSON */ }
    return { status: res.status, ok: res.ok, json, text, path: path.split('?')[0] };
  }
  const fail = (r, what) => new Error(`${what} ไม่สำเร็จ (HTTP ${r.status}${r.json && r.json.message ? ': ' + r.json.message : ''}${r.json && r.json.hint ? ' · ' + r.json.hint : ''}) [/rest/v1/${r.path}]`);

  // สถานีหลักที่ยังไม่วาด / เส้นทางตั้งต้นที่ยังไม่แก้ = ค่าที่เครื่องใหม่สร้างเอง ไม่ใช่ข้อมูลจริง
  function isPristine(Store, kind, d) {
    if (kind === 'station') return !!d.fixed && !d.polygon;
    if (kind === 'route') return (Store.DEFAULT_ROUTES || []).some((r) => stable(r) === stable(d));
    return false;
  }

  // เครื่องแม่: ทำให้ข้อมูลกลางเหมือนเครื่องนี้ทุกประการ (เขียนทับ ไม่เช็ก rev) เอกสารที่เครื่องนี้ไม่มีจะถูกลบออกจากกลาง
  async function pushAll(Store) {
    const db = await Store.load();
    const s = db.settings;
    if (!enabled(s)) throw new Error('ยังไม่ได้ตั้งค่าซิงก์');
    const r = await api(s, 'docs?select=kind,id,rev,data&kind=in.(trip,station,route)&limit=100000');
    if (!r.ok || !Array.isArray(r.json)) throw fail(r, 'อ่านข้อมูลกลาง');
    const remote = new Map(r.json.map((x) => [x.kind + '|' + x.id, x]));
    const remoteLive = r.json.filter((x) => x.kind === 'trip' && !(x.data && x.data._deleted)).length;
    if (!db.trips.length && remoteLive) throw new Error(`เครื่องนี้ไม่มีเที่ยวเลย แต่ข้อมูลกลางมี ${remoteLive} เที่ยว จึงยกเลิกเพื่อไม่ให้ข้อมูลกลางถูกลบ — ถ้าเครื่องนี้ควรเป็นเครื่องที่รับข้อมูล ให้กด "ใช้ข้อมูลของกลาง" แทน`);
    const meta = { cursor: EPOCH, rev: {}, hash: {}, pos: (db.syncMeta && db.syncMeta.pos) || {} };
    const sum = { uploaded: 0, removed: 0 };
    const seen = new Set();

    for (const kind of Object.keys(COLLECTION)) {
      for (const d of db[COLLECTION[kind]]) {
        const id = ID_OF[kind](d), k = kind + '|' + id, data = strip(kind, d), rem = remote.get(k);
        seen.add(k);
        let res;
        if (rem) {
          res = await api(s, `docs?kind=eq.${kind}&id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ data, rev: rem.rev + 1 }) });
          meta.rev[k] = rem.rev + 1;
        } else {
          res = await api(s, 'docs', { method: 'POST', body: JSON.stringify({ kind, id, data, rev: 1 }) });
          meta.rev[k] = 1;
        }
        if (!res.ok) throw fail(res, 'อัปโหลดข้อมูล');
        meta.hash[k] = stable(data);
        sum.uploaded++;
      }
    }
    for (const [k, rem] of remote) {
      if (seen.has(k) || (rem.data && rem.data._deleted)) continue;
      const res = await api(s, `docs?kind=eq.${rem.kind}&id=eq.${encodeURIComponent(rem.id)}`, { method: 'PATCH', body: JSON.stringify({ data: { _deleted: true }, rev: rem.rev + 1 }) });
      if (!res.ok) throw fail(res, 'ลบข้อมูลส่วนเกินในกลาง');
      meta.rev[k] = rem.rev + 1;
      sum.removed++;
    }
    await Store.save({ syncMeta: meta });
    return { ok: true, message: `อัปโหลดเป็นต้นฉบับแล้ว · ${sum.uploaded} รายการ` + (sum.removed ? ` · ลบส่วนเกินในกลาง ${sum.removed}` : ''), ...sum };
  }

  // เครื่องที่เข้าร่วม: ทิ้งข้อมูลในเครื่อง แล้วใช้ของกลางแทน
  async function adoptRemote(Store) {
    const db = await Store.load();
    if (!enabled(db.settings)) throw new Error('ยังไม่ได้ตั้งค่าซิงก์');
    // ของกลางต้องมีข้อมูลก่อน ไม่งั้นการ "ใช้ของกลาง" จะล้างเครื่องนี้เป็นว่างเปล่า
    const probe = await api(db.settings, 'docs?select=kind&kind=in.(trip,station,route)&limit=1');
    if (!probe.ok || !Array.isArray(probe.json)) throw fail(probe, 'ตรวจข้อมูลกลาง');
    if (!probe.json.length) throw new Error('ฐานข้อมูลกลางยังว่าง จึงยกเลิกเพื่อไม่ให้ข้อมูลในเครื่องนี้หาย — ให้เครื่องแม่กด "ตั้งเครื่องนี้เป็นเครื่องแม่" ก่อน');
    await Store.save({ trips: [], stations: [], routes: [], syncMeta: { cursor: EPOCH, rev: {}, hash: {}, pos: {} } });
    const r = await syncNow(Store);
    return { ...r, message: 'ใช้ข้อมูลของกลางแล้ว · ' + r.message };
  }

  // opts.pos = { ทะเบียน: {lat,lng,speed,time} } ที่เครื่องนี้เพิ่งดึงได้ (เฉพาะเครื่อง poller)
  async function syncNow(Store, opts) {
    const db = await Store.load();
    const s = db.settings;
    if (!enabled(s)) return { ok: true, skipped: true, message: 'ยังไม่ได้เปิดซิงก์' };

    const meta = { cursor: EPOCH, rev: {}, hash: {}, pos: {}, ...(db.syncMeta || {}) };
    const sum = { pulled: 0, pushed: 0, conflicts: 0 };
    const coll = (kind) => db[COLLECTION[kind]];

    // 1) ดึงของใหม่จากเซิร์ฟเวอร์
    for (let page = 0; page < 5; page++) {
      const r = await api(s, `docs?select=kind,id,data,rev,updated_at&updated_at=gte.${encodeURIComponent(meta.cursor)}&order=updated_at.asc&limit=1000`);
      if (!r.ok || !Array.isArray(r.json)) throw fail(r, 'ดึงข้อมูลกลาง');
      let moved = false;
      for (const row of r.json) {
        if (row.updated_at > meta.cursor) { meta.cursor = row.updated_at; moved = true; }
        if (row.kind === 'pos') { meta.pos[row.id] = row.data; continue; }
        if (row.kind === 'status') { meta.status = row.data; continue; } // รายงานจากตัวดึง GPS บนคลาวด์
        if (!COLLECTION[row.kind]) continue;
        const k = row.kind + '|' + row.id;
        if (meta.rev[k] === row.rev) continue; // รู้แล้ว
        const list = coll(row.kind);
        const idx = list.findIndex((d) => ID_OF[row.kind](d) === row.id);
        if (idx >= 0 && meta.hash[k] !== undefined && stable(strip(row.kind, list[idx])) !== meta.hash[k]) sum.conflicts++; // แก้ในเครื่องแต่ยังไม่ส่ง → ทิ้ง ใช้ของกลาง
        if (row.data && row.data._deleted) {
          if (idx >= 0) list.splice(idx, 1);
          delete meta.hash[k];
        } else {
          const keep = {};
          if (idx >= 0 && row.kind === 'trip') LOCAL_ONLY.forEach((f) => { if (list[idx][f] !== undefined) keep[f] = list[idx][f]; });
          const doc = { ...row.data, ...keep };
          if (idx >= 0) list[idx] = doc; else list.push(doc);
          meta.hash[k] = stable(strip(row.kind, doc));
        }
        meta.rev[k] = row.rev;
        sum.pulled++;
      }
      if (r.json.length < 1000 || !moved) break;
    }

    // 2) ส่งสิ่งที่แก้ในเครื่อง
    for (const kind of Object.keys(COLLECTION)) {
      const seen = new Set();
      for (const d of coll(kind)) {
        const id = ID_OF[kind](d), k = kind + '|' + id;
        seen.add(k);
        const data = strip(kind, d), h = stable(data);
        if (meta.hash[k] === h) continue;
        const known = meta.rev[k];
        if (known === undefined && isPristine(Store, kind, d)) continue; // ค่าตั้งต้นที่ไม่เคยแก้: ไม่ส่งไปทับของเครื่องแม่
        let r;
        if (known === undefined) {
          r = await api(s, 'docs', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ kind, id, data, rev: 1 }) });
          if (r.status === 409) { sum.conflicts++; continue; } // มีคนสร้างไปก่อน รอบหน้าจะดึงมาแทน
          if (!r.ok) throw fail(r, 'ส่งข้อมูล');
          meta.rev[k] = 1;
        } else {
          r = await api(s, `docs?kind=eq.${kind}&id=eq.${encodeURIComponent(id)}&rev=eq.${known}`, {
            method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data, rev: known + 1 })
          });
          if (!r.ok) throw fail(r, 'ส่งข้อมูล');
          if (!Array.isArray(r.json) || !r.json.length) { sum.conflicts++; continue; } // มีคนแก้ก่อน
          meta.rev[k] = known + 1;
        }
        meta.hash[k] = h;
        sum.pushed++;
      }
      // ลบ: เอกสารที่เคยซิงก์แต่หายไปจากเครื่อง → ทำ tombstone
      for (const k of Object.keys(meta.hash)) {
        if (!k.startsWith(kind + '|') || seen.has(k)) continue;
        const id = k.slice(kind.length + 1), known = meta.rev[k];
        const r = await api(s, `docs?kind=eq.${kind}&id=eq.${encodeURIComponent(id)}&rev=eq.${known}`, {
          method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ data: { _deleted: true }, rev: known + 1 })
        });
        if (!r.ok) throw fail(r, 'ลบข้อมูล');
        if (Array.isArray(r.json) && r.json.length) { meta.rev[k] = known + 1; delete meta.hash[k]; sum.pushed++; }
        else { sum.conflicts++; delete meta.hash[k]; } // ถูกแก้โดยคนอื่นระหว่างนั้น ให้ดึงกลับมาใหม่
      }
    }

    // 3) ประกาศตำแหน่งรถ (เฉพาะเครื่องที่ดึง GPS)
    const rows = Object.entries((opts && opts.pos) || {}).map(([id, data]) => ({ kind: 'pos', id, data, rev: 0 }));
    if (rows.length) {
      const r = await api(s, 'docs?on_conflict=kind,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
      if (!r.ok) throw fail(r, 'ส่งตำแหน่งรถ');
      rows.forEach((x) => { meta.pos[x.id] = x.data; });
    }

    // 4) ตำแหน่งล่าสุดของรถ → เที่ยว (ให้ทุกเครื่องคำนวณ ETA ได้)
    for (const t of db.trips) {
      const p = meta.pos[t.plate];
      if (p && (!t.lastPos || Date.parse(p.time) >= Date.parse(t.lastPos.time))) t.lastPos = p;
    }

    meta.last = { at: new Date().toISOString(), ok: true, ...sum };
    await Store.save({ trips: db.trips, stations: db.stations, routes: db.routes, syncMeta: meta });
    return { ok: true, message: `ซิงก์แล้ว · รับ ${sum.pulled} ส่ง ${sum.pushed}` + (sum.conflicts ? ` · ชนกัน ${sum.conflicts}` : ''), ...sum };
  }

  const api2 = { syncNow, pushAll, adoptRemote, enabled, strip, stable };
  if (typeof module !== 'undefined' && module.exports) module.exports = api2;
  else root.Sync = api2;
})(this);

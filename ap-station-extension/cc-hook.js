// ทำงานในหน้า Carrier Connect (world: MAIN) ตั้งแต่เริ่มโหลดหน้า
// ดัก header Authorization จากคำขอที่เว็บส่งเองไปยัง API เก็บไว้ในหน่วยความจำของหน้าเท่านั้น (window.__apCc)
// ไม่ส่งออกที่ใด ไม่บันทึกลงดิสก์ — ใช้เฉพาะตอน Extension สั่งยิงคำขอ "จากในหน้านี้" (ดู lib/ccsync.js: readSession)
(function () {
  if (window.__apCc) return; // ติดตั้งแล้ว (ฝังซ้ำได้ ไม่ซ้อน)
  const st = { tok: null, f: window.fetch };
  window.__apCc = st;
  const isApi = (u) => String(u || '').indexOf('serviceprovider-api.expeditors.com') >= 0;

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (isApi(url)) {
        let a = null;
        const h = init && init.headers;
        if (h) {
          if (typeof h.get === 'function') a = h.get('authorization');
          else for (const k in h) { if (k.toLowerCase() === 'authorization') a = h[k]; }
        }
        if (!a && input && input.headers && typeof input.headers.get === 'function') a = input.headers.get('authorization');
        if (a) st.tok = a;
      }
    } catch (e) { /* ห้ามกระทบการทำงานของเว็บ */ }
    return origFetch.apply(this, arguments);
  };

  const xOpen = XMLHttpRequest.prototype.open, xSet = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (m, u) { this.__apUrl = u; return xOpen.apply(this, arguments); };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (isApi(this.__apUrl) && String(k).toLowerCase() === 'authorization') st.tok = v; } catch (e) { /* ไม่เป็นไร */ }
    return xSet.apply(this, arguments);
  };
})();

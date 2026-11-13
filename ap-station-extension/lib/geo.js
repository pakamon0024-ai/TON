// เครื่องมือพิกัด: จุดอยู่ใน polygon ไหม, พื้นที่โดยประมาณ, อ่านพิกัดที่วางมาจาก Google Maps
(function (root) {
  // polygon = [[lat, lng], ...] (ไม่ต้องปิดจุดท้าย)
  function pointInPolygon(lat, lng, polygon) {
    if (!polygon || polygon.length < 3) return false;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [yi, xi] = polygon[i];
      const [yj, xj] = polygon[j];
      const hit = (yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (hit) inside = !inside;
    }
    return inside;
  }

  // พื้นที่ (ตร.ม.) แบบประมาณบนพื้นผิวเรียบ เพียงพอสำหรับลานโรงงาน
  function areaSqm(polygon) {
    if (!polygon || polygon.length < 3) return 0;
    const lat0 = (polygon.reduce((s, p) => s + p[0], 0) / polygon.length) * Math.PI / 180;
    const mPerDegLat = 111320;
    const mPerDegLng = 111320 * Math.cos(lat0);
    let sum = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][1] * mPerDegLng, yi = polygon[i][0] * mPerDegLat;
      const xj = polygon[j][1] * mPerDegLng, yj = polygon[j][0] * mPerDegLat;
      sum += xj * yi - xi * yj;
    }
    return Math.abs(sum / 2);
  }

  // รับ "13.6900, 101.1200" หรือ "13.69 101.12" คืน [lat, lng] หรือ null
  function parseLatLng(text) {
    const m = String(text || '').match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return [lat, lng];
  }

  // ระยะทางตรงระหว่าง 2 พิกัด (เมตร) แบบ haversine
  function distanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  // จุดศูนย์กลางของ polygon (centroid ตามพื้นที่) คืน [lat, lng]
  function centroid(polygon) {
    if (!polygon || polygon.length < 3) return null;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [yi, xi] = polygon[i], [yj, xj] = polygon[j];
      const f = xj * yi - xi * yj;
      a += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
    }
    if (!a) return [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];
    return [cy / (3 * a), cx / (3 * a)];
  }

  // ระยะ (เมตร) จากจุดถึงขอบ polygon ที่ใกล้ที่สุด (คำนวณบนระนาบท้องถิ่น พอสำหรับระยะไม่ไกลมาก)
  function distToPolygonM(lat, lng, polygon) {
    if (!polygon || polygon.length < 3) return null;
    const kx = 111320 * Math.cos(lat * Math.PI / 180), ky = 111320;
    let best = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const ax = (polygon[j][1] - lng) * kx, ay = (polygon[j][0] - lat) * ky;
      const bx = (polygon[i][1] - lng) * kx, by = (polygon[i][0] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
    return best;
  }

  // เส้นตรงจากจุด 1 ไปจุด 2 ตัดผ่าน polygon ไหม คืน { tIn, tOut } (สัดส่วน 0–1 ตามแนวเส้น) หรือ null
  // ใช้ตรวจย้อนว่ารถขับผ่านสถานีระหว่างรอบ GPS สองรอบ โดยไม่มีจุดไหนตกอยู่ใน polygon
  function segmentPolygonSpan(lat1, lng1, lat2, lng2, polygon) {
    if (!polygon || polygon.length < 3) return null;
    const rx = lng2 - lng1, ry = lat2 - lat1; // x = lng, y = lat (สเกลแกนต่างกันไม่กระทบสัดส่วน t)
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

  const api = { pointInPolygon, areaSqm, parseLatLng, distanceM, centroid, distToPolygonM, segmentPolygonSpan };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(this);

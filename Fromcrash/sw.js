// Service worker ขั้นต่ำ — แค่มีไว้ให้ Chrome เห็นว่าแอปนี้ "ติดตั้งได้"
// (เงื่อนไขของ Chrome ต้องมี manifest + service worker ที่ตอบ fetch event)
// ไม่ได้ cache ไฟล์ล่วงหน้า เพื่อให้แอปอัปเดตเวอร์ชันใหม่ทุกครั้งที่โหลดตามปกติ

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

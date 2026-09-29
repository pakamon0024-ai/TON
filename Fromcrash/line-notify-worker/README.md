# LINE Notify Worker

ตัวกลาง (proxy) รับข้อความจาก QA APP แล้วยิงต่อไปยัง **LINE Messaging API**

## ทำไมต้องมีตัวนี้

QA APP เป็นเว็บ static ล้วนๆ (ไม่มี backend) ยิง `fetch` ตรงจากเบราว์เซอร์ไป Telegram ได้ปกติ
เพราะ Telegram Bot API อนุญาต CORS แต่ **LINE Messaging API (`api.line.me`) ไม่อนุญาต CORS**
ยิงตรงจากเว็บจะโดนเบราว์เซอร์บล็อกเสมอ ต้องมีตัวกลางฝั่งเซิร์ฟเวอร์แบบนี้คั่นกลาง

Cloudflare Worker คือทางเลือกที่ใช้ฟรีได้ (free tier รองรับหลักแสนคำขอ/วัน) ตั้งค่าเสร็จใน
ไม่กี่นาที ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง

## ขั้นตอนสร้าง LINE Official Account + Channel (ถ้ายังไม่มี)

1. เข้า https://developers.line.biz/console/ (ล็อกอินด้วยบัญชี LINE ปกติ)
2. สร้าง **Provider** ใหม่ (ถ้ายังไม่มี)
3. สร้าง **Channel** ชนิด **Messaging API**
4. ในหน้า Channel เปิดแท็บ **Messaging API** → เลื่อนลงไปหา **Channel access token** →
   กด **Issue** เพื่อออก token (ยาวๆ) → คัดลอกเก็บไว้ (นี่คือ `LINE_CHANNEL_ACCESS_TOKEN`)
5. หา **ปลายทาง (to)** ที่จะ push ข้อความไปหา — เลือกอย่างใดอย่างหนึ่ง:
   - **ส่งหาตัวเอง/คนเดียว**: ในแท็บ Messaging API จะมี QR Code ให้เพิ่มบัญชีเป็นเพื่อน
     สแกนเพิ่มเพื่อนด้วย LINE ส่วนตัว แล้วดู **your user ID** ได้จากหน้า Basic settings
     (Your user ID) — นี่คือ `LINE_TARGET_ID`
   - **ส่งเข้ากลุ่ม**: เชิญบัญชี Official Account เข้ากลุ่ม LINE ก่อน แล้วต้องดึง groupId
     ผ่าน Webhook (เปิด Webhook ชั่วคราว รับ event ครั้งแรกจากกลุ่มเพื่ออ่าน `source.groupId`)
     — ขั้นตอนนี้ยุ่งกว่า ถ้าไม่ถนัดแนะนำเริ่มจากส่งหาตัวเองก่อน

## ขั้นตอน Deploy Worker (ผ่านเว็บ Cloudflare ไม่ต้องลง CLI)

1. สมัคร/ล็อกอิน https://dash.cloudflare.com (ฟรี)
2. เมนูซ้าย **Workers & Pages** → **Create** → **Create Worker**
3. ตั้งชื่อ เช่น `qa-line-notify` → **Deploy** (จะได้ Worker เปล่าๆ ก่อน)
4. กด **Edit code** → ลบโค้ดตัวอย่างทั้งหมด → คัดลอกทั้งไฟล์ `worker.js` ในโฟลเดอร์นี้วางแทน →
   **Deploy** อีกครั้ง
5. กลับหน้า Worker → แท็บ **Settings** → **Variables and Secrets** → **Add**:
   - `LINE_CHANNEL_ACCESS_TOKEN` = token จากขั้นตอนก่อนหน้า → ติ๊ก **Encrypt** (เป็น secret)
   - `LINE_TARGET_ID` = userId/groupId ปลายทาง → ติ๊ก **Encrypt**
   - `SHARED_SECRET` = (ไม่บังคับ) ตั้งรหัสลับเองสักชุด เช่น สุ่มด้วย `openssl rand -hex 16`
     → ติ๊ก **Encrypt** — ถ้าตั้งไว้ ต้องเอาค่าเดียวกันไปกรอกในหน้าตั้งค่า LINE ของ QA APP ด้วย
   - Save
6. หน้า Worker จะมี URL แบบ `https://qa-line-notify.<your-subdomain>.workers.dev` —
   คัดลอก URL นี้ไปกรอกใน QA APP: เมนู **ฐานข้อมูลหลัก > แจ้งเตือน** → การ์ด **LINE** →
   ช่อง **Worker URL** (และ **Shared Secret** ถ้าตั้งไว้ในขั้นตอนที่ 5) → กด **บันทึก** →
   **ทดสอบส่งข้อความ**

## ทดสอบด้วยมือ (ไม่ผ่านแอป)

```bash
curl -X POST https://qa-line-notify.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: <SHARED_SECRET ถ้าตั้งไว้>" \
  -d '{"message":"ทดสอบจาก curl"}'
```

ถ้าสำเร็จจะได้ `{"ok":true}` กลับมา และมีข้อความเด้งใน LINE

## หมายเหตุด้านความปลอดภัย

- Channel Access Token และ Target ID ถูกเก็บเป็น **secret ฝั่ง Worker เท่านั้น** ไม่หลุดมาถึง
  เบราว์เซอร์ของผู้ใช้แอปเลย (ต่างจาก Telegram Bot Token ที่ตอนนี้แอปเรียกตรงจากเบราว์เซอร์
  จึงมองเห็นได้ผ่าน developer tools)
- `SHARED_SECRET` เป็นการป้องกันแบบเบาๆ กันคนภายนอกที่บังเอิญเจอ URL ของ Worker เผลอยิง
  เข้ามาเล่น ไม่ใช่การรักษาความปลอดภัยระดับสูง — ถ้าต้องการเข้มกว่านี้ให้จำกัด
  `Access-Control-Allow-Origin` ในโค้ด `worker.js` ให้เหลือแค่โดเมนจริงที่โฮสต์ QA APP แทน `*`

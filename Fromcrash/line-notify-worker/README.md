# LINE Notify Worker

Worker เดียวทำหน้าที่ 2 อย่าง:
- **(A) ส่งแจ้งเตือนออก** — QA APP บันทึก/แก้ไขเคส → ยิงข้อความเข้า LINE (ทางเดียว)
- **(B) ตอบคำถามจากไลน์** — พิมพ์คุยกับบอทใน LINE เพื่อถามข้อมูล (อ่านอย่างเดียว ไม่แก้ไขอะไร)
  เช่น "เป่าวันนี้", "อุบัติเหตุเดือนนี้" — ดูคำสั่งทั้งหมดที่โค้ด `HELP_TEXT` ใน `worker.js`

ทำ (A) อย่างเดียวก็ใช้งานได้ปกติ ส่วน (B) เป็นของเสริมที่ต้องตั้งค่าเพิ่มอีกนิด (หัวข้อ "ส่วนที่ 2")

## ทำไมต้องมีตัวนี้

QA APP เป็นเว็บ static ล้วนๆ (ไม่มี backend) ยิง `fetch` ตรงจากเบราว์เซอร์ไป Telegram ได้ปกติ
เพราะ Telegram Bot API อนุญาต CORS แต่ **LINE Messaging API (`api.line.me`) ไม่อนุญาต CORS**
ยิงตรงจากเว็บจะโดนเบราว์เซอร์บล็อกเสมอ ต้องมีตัวกลางฝั่งเซิร์ฟเวอร์แบบนี้คั่นกลาง

Cloudflare Worker คือทางเลือกที่ใช้ฟรีได้ (free tier รองรับหลักแสนคำขอ/วัน) ตั้งค่าเสร็จใน
ไม่กี่นาที ไม่ต้องมีเซิร์ฟเวอร์ของตัวเอง

---

## ส่วนที่ 1: (A) ส่งแจ้งเตือนออก — ขั้นตอนพื้นฐาน

### สร้าง LINE Official Account + Channel (ถ้ายังไม่มี)

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
     ผ่าน Webhook (ดูวิธีอ่าน groupId ในหัวข้อ "ส่วนที่ 2" ด้านล่าง จะได้จาก event ที่ส่งมา)

### Deploy Worker (ผ่านเว็บ Cloudflare ไม่ต้องลง CLI)

1. สมัคร/ล็อกอิน https://dash.cloudflare.com (ฟรี)
2. เมนูซ้าย **Workers & Pages** → **Create** → **Create Worker**
3. ตั้งชื่อ เช่น `qa-line-notify` → **Deploy** (จะได้ Worker เปล่าๆ ก่อน)
4. กด **Edit code** → ลบโค้ดตัวอย่างทั้งหมด → คัดลอกทั้งไฟล์ `worker.js` ในโฟลเดอร์นี้วางแทน →
   **Deploy** อีกครั้ง (ทุกครั้งที่แก้ `worker.js` ต้องทำซ้ำขั้นตอนนี้ วาง+Deploy ใหม่)
5. กลับหน้า Worker → แท็บ **Settings** → **Variables and Secrets** → **Add**:
   - `LINE_CHANNEL_ACCESS_TOKEN` = token จากขั้นตอนก่อนหน้า → ติ๊ก **Encrypt**
   - `LINE_TARGET_ID` = userId/groupId ปลายทาง → ติ๊ก **Encrypt**
   - `SHARED_SECRET` = (ไม่บังคับ) ตั้งรหัสลับเองสักชุด → ติ๊ก **Encrypt** — ถ้าตั้งไว้ ต้องเอา
     ค่าเดียวกันไปกรอกในหน้าตั้งค่า LINE ของ QA APP ด้วย
   - **Save** (ต้องกด Deploy ให้ Worker รับค่าใหม่ด้วย ถ้าเมนูมีปุ่มแยก)
6. หน้า Worker จะมี URL แบบ `https://qa-line-notify.<your-subdomain>.workers.dev` — คัดลอก
   URL นี้ไปกรอกใน QA APP: เมนู **ฐานข้อมูลหลัก > แจ้งเตือน** → การ์ด **LINE** → ช่อง
   **Worker URL** (และ **Shared Secret** ถ้าตั้งไว้) → กด **บันทึก** → **ทดสอบส่งข้อความ**

### ทดสอบด้วยมือ (ไม่ผ่านแอป)

```bash
curl -X POST https://qa-line-notify.<your-subdomain>.workers.dev \
  -H "Content-Type: application/json" \
  -H "X-Auth-Token: <SHARED_SECRET ถ้าตั้งไว้>" \
  -d '{"message":"ทดสอบจาก curl"}'
```

ถ้าสำเร็จจะได้ `{"ok":true}` กลับมา และมีข้อความเด้งใน LINE

---

## ส่วนที่ 2: (B) ตอบคำถามจากไลน์ — ของเสริม (ไม่ทำก็ได้ ใช้แค่ (A) ได้ปกติ)

ให้พิมพ์คุยกับบอทถามข้อมูล เช่น "เป่าวันนี้" "อุบัติเหตุเดือนนี้" ต้องตั้งเพิ่มอีก 2 อย่าง:
**Channel Secret** (ให้ Worker เช็คว่าคำขอมาจาก LINE จริง) และ **Firebase Service Account**
(ให้ Worker มีสิทธิ์อ่านข้อมูลจาก Firebase เพราะ Security Rules ปิดอ่านแบบไม่ล็อกอินไว้)

คำตอบของบอทเป็น **LINE Flex Message** (การ์ดสรุปสวยๆ มีหัวข้อ สี แถวตัวเลข) ไม่ใช่ภาพ PNG
จริงแบบที่ปุ่ม "บันทึกภาพรายงาน" ในแอปสร้าง เพราะ Worker ไม่มีเบราว์เซอร์/canvas ให้ใช้
html2canvas เหมือนแอป — แต่ให้ผลลัพธ์คล้ายกันคือการ์ดสวยงามอ่านง่ายในแชท

### 2.1 หา Channel Secret

1. หน้า Channel เดิม (อันเดียวกับส่วนที่ 1) → แท็บ **Basic settings**
2. หาแถว **Channel secret** → copy ค่า (สายอักษร/ตัวเลขผสม ไม่ใช่ตัวเดียวกับ access token)

### 2.2 สร้าง Firebase Service Account

1. เข้า https://console.firebase.google.com เลือกโปรเจกต์ที่ QA APP ใช้ (ชื่อ `apt-insuarance`
   ดูได้จาก `DEFAULT_FB_CFG` ใน `claims.js` ถ้าจำไม่ได้)
2. ⚙️ (มุมซ้ายบน ข้าง Project Overview) → **Project settings** → แท็บ **Service accounts**
3. กด **Generate new private key** → ยืนยัน → จะได้ไฟล์ `.json` ดาวน์โหลดลงเครื่อง (เก็บเป็น
   ความลับ ห้าม commit ขึ้น git เด็ดขาด)
4. เปิดไฟล์นั้นด้วย Notepad/text editor → **เลือกทั้งหมด (Ctrl+A) แล้ว copy เนื้อหาทั้งไฟล์**
   (เป็น JSON ก้อนใหญ่ก้อนเดียว ขึ้นต้นด้วย `{"type": "service_account", ...}`)

### 2.3 ตั้งค่าเพิ่มใน Worker

กลับไปหน้า Worker (`Settings > Variables and Secrets`) เพิ่มอีก 2 ตัว:
- `LINE_CHANNEL_SECRET` = ค่าจากข้อ 2.1 → ติ๊ก **Encrypt**
- `FIREBASE_SERVICE_ACCOUNT_JSON` = **วางเนื้อหาไฟล์ JSON ทั้งไฟล์** จากข้อ 2.2 ลงในช่องเดียว
  (มันยาวหลายบรรทัด วางได้เลยไม่ต้องบีบเป็นบรรทัดเดียว) → ติ๊ก **Encrypt**
- Save → Deploy ให้ Worker รับค่าใหม่

### 2.4 เปิด Webhook ที่ฝั่ง LINE

1. หน้า Channel → แท็บ **Messaging API**
2. หัวข้อ **Webhook settings** → ช่อง **Webhook URL** ใส่ URL เดียวกับที่ใช้ในส่วนที่ 1
   (`https://qa-line-notify.<your-subdomain>.workers.dev`) → **Update**
3. กด **Verify** ข้างๆ ช่อง URL — ถ้าขึ้น ✅ Success แปลว่า Worker ตอบ webhook ถูกต้อง (ตอนนี้
   ยังไม่มี event จริงให้ตอบ เลย verify จะผ่านแค่เช็คว่าคุยกันได้ ไม่ได้เทสคำสั่งจริง)
4. เปิดสวิตช์ **Use webhook** ให้เป็น **On**
5. (แนะนำ) ปิด **Auto-reply messages** และ **Greeting messages** ในแท็บ **Messaging API**
   ไม่งั้น LINE จะตอบข้อความอัตโนมัติของตัวเองซ้อนกับคำตอบจากบอทเรา

### 2.5 ทดสอบ

เปิดแชทกับ Official Account ที่แอดเพื่อนไว้แล้ว (จากส่วนที่ 1) พิมพ์:
- `เป่าวันนี้` — ควรได้สรุปผลเป่าแอลกอฮอล์วันนี้
- `อุบัติเหตุเดือนนี้` — ควรได้จำนวนอุบัติเหตุเดือนนี้
- พิมพ์อย่างอื่นที่ไม่ตรงคำสั่ง — บอทจะตอบวิธีใช้งาน (help)

ถ้าบอทไม่ตอบเลย เช็ก **Webhook settings** ว่า "Use webhook" เปิดอยู่จริง และลองกด
**Verify** อีกครั้งดู error message

### เพิ่มคำสั่งใหม่เอง

คำสั่งทั้งหมดกำหนดอยู่ในฟังก์ชัน `buildReplyText()` ของ `worker.js` เพิ่ม `if (t.includes(...))`
เงื่อนไขใหม่ แล้วเขียนฟังก์ชันอ่านข้อมูลจาก Firebase path ที่ต้องการ (ดูตัวอย่างจาก
`alcoholSummary()` / `incidentSummary()`) — path อื่นๆ ที่มีอยู่แล้วในระบบ เช่น `/gpsViolations`,
`/insurance_claims`, `/tickets`, `/probationRecords` ดูชื่อ path เต็มได้จากไฟล์ `.js` ของแต่ละ
เมนูในโปรเจกต์หลัก (ค้นคำว่า `ref(fbDb,`)

---

## หมายเหตุด้านความปลอดภัย

- Channel Access Token, Target ID, Channel Secret และ Service Account ถูกเก็บเป็น **secret
  ฝั่ง Worker เท่านั้น** ไม่หลุดมาถึงเบราว์เซอร์ของผู้ใช้แอปเลย (ต่างจาก Telegram Bot Token ที่
  ตอนนี้แอปเรียกตรงจากเบราว์เซอร์ จึงมองเห็นได้ผ่าน developer tools)
- Webhook (B) ตรวจลายเซ็นทุกคำขอด้วย `LINE_CHANNEL_SECRET` คนอื่นปลอมคำขอเข้ามาไม่ได้
- Service Account มีสิทธิ์**อ่านได้ทั้งฐานข้อมูล** (ตามสิทธิ์ project ที่ตั้งตอนสร้าง) ดังนั้น
  ห้ามทำให้ไฟล์ JSON หลุด และห้าม commit ขึ้น git เด็ดขาด — เก็บเป็น secret ใน Worker
  เพียงที่เดียว
- `SHARED_SECRET` ของ (A) เป็นการป้องกันแบบเบาๆ ไม่ใช่การรักษาความปลอดภัยระดับสูง —
  ถ้าต้องการเข้มกว่านี้ให้จำกัด `Access-Control-Allow-Origin` ในโค้ด `worker.js` ให้เหลือแค่
  โดเมนจริงที่โฮสต์ QA APP แทน `*`

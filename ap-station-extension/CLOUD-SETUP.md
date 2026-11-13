# ตั้งตัวดึง GPS บนคลาวด์ (ทำผ่านหน้าเว็บ Supabase ไม่ต้องติดตั้งโปรแกรม)

ต้องมีตาราง `docs` แล้ว (รัน `supabase-setup.sql` ไปแล้ว) และ **เครื่องแม่อัปโหลดข้อมูลแล้ว** (ตาราง docs ต้องมีสถานีที่ polygon ไม่ว่าง และมีเที่ยว)

## 1) สร้างฟังก์ชัน
1. Supabase → เมนู **Edge Functions** → **Deploy a new function** → **Via Editor**
2. ตั้งชื่อฟังก์ชัน: `gps-poll`
3. ลบโค้ดตัวอย่างทั้งหมด แล้ววางเนื้อหาไฟล์ `supabase/functions/gps-poll/index.ts` ทั้งไฟล์
4. **ปิด "Verify JWT"** (สวิตช์ในหน้าตั้งค่าฟังก์ชัน) เพราะฟังก์ชันตรวจรหัสลับเอง
5. กด **Deploy**

## 2) ตั้ง secret
Edge Functions → **Secrets** → Add new secret (เพิ่ม 2 ตัว)
- `EUP_TOKEN` = Token ของ Eup (ตัวเดียวกับที่ใส่ในช่อง Token ของ Extension)
- `CRON_SECRET` = ค่าเดียวกับในไฟล์ `supabase-cron.sql` (บรรทัด `x-cron-secret`)
(ถ้าเวลา GPS ไม่ใช่เวลาไทย เพิ่ม `GPS_TZ` เช่น `+08:00` ค่าเริ่มต้น `+07:00`)

## 3) ตั้งเวลา
SQL Editor → วางเนื้อหา `supabase-cron.sql` → Run (ใส่ project ref และรหัสลับให้แล้ว)

## 4) ตั้ง Extension ทุกเครื่อง
ตั้งค่า → ซิงก์ข้อมูลทีม → ติ๊ก **"GPS ถูกดึงโดยคลาวด์"** → บันทึก
(ถ้าคลาวด์เงียบเกิน 5 นาที เครื่องที่มี Token GPS และติ๊ก "เครื่องดึง GPS" จะดึงแทนชั่วคราวเอง)

## ตรวจว่าทำงาน (รอ 1–2 นาทีหลังตั้งเวลา)
- Table Editor → docs ต้องมีแถว `status` (id = poller) และ `pos` ของทะเบียนรถ
- ป้าย GPS ใน Extension ขึ้น "GPS · hh:mm" และชี้เมาส์เห็น "คลาวด์: พบพิกัด ..."
- ถ้าไม่ขึ้น: SQL `select * from cron.job_run_details order by start_time desc limit 5;` และดู Edge Functions → gps-poll → Logs

-- ตั้งเวลาให้ Supabase เรียกฟังก์ชัน gps-poll ทุก 1 นาที (ทำหลัง deploy ฟังก์ชันแล้ว)
-- ก่อนรัน: แทนที่ <CRON_SECRET> ด้านล่างด้วยค่าจริง (ห้าม commit ค่าจริงลง git) และตรวจ project ref ใน URL ว่าตรงกับโปรเจกต์
-- ค่า x-cron-secret ด้านล่างต้องเป็นค่าเดียวกับ secret ชื่อ CRON_SECRET ของ Edge Function (ดู CLOUD-SETUP.md ข้อ 2)

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ลบงานเดิมถ้ามี (รันซ้ำได้)
select cron.unschedule('ap-gps-poll') where exists (select 1 from cron.job where jobname = 'ap-gps-poll');

select cron.schedule(
  'ap-gps-poll',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://nclanomalemubvjasuar.supabase.co/functions/v1/gps-poll',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', '<CRON_SECRET>'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 50000
  );
  $$
);

-- ตรวจว่าทำงาน: select * from cron.job_run_details order by start_time desc limit 5;
-- หยุดชั่วคราว:  select cron.unschedule('ap-gps-poll');

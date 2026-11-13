-- วางใน Supabase → SQL Editor → Run (ครั้งเดียว)
-- ตารางเดียวเก็บทุกอย่างที่แชร์: เที่ยว (trip) สถานี (station) เส้นทาง (route) ตำแหน่งรถ (pos)

create table if not exists public.docs (
  kind        text        not null,
  id          text        not null,
  data        jsonb       not null,
  rev         integer     not null default 1,
  updated_at  timestamptz not null default now(),
  primary key (kind, id)
);

create index if not exists docs_updated_at_idx on public.docs (updated_at);

-- ตั้ง updated_at ฝั่งเซิร์ฟเวอร์เสมอ (ไม่พึ่งนาฬิกาของเครื่องลูก)
create or replace function public.docs_touch() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before insert or update on public.docs
  for each row execute function public.docs_touch();

-- ใครถือ anon key ของโปรเจกต์นี้ อ่าน/เขียนได้ทั้งหมด (ใช้ภายในทีมเท่านั้น)
-- ข้อมูลมีชื่อคนขับและทะเบียน อย่าเผยแพร่ URL/คีย์ออกนอกทีม
alter table public.docs enable row level security;

drop policy if exists "team all access" on public.docs;
create policy "team all access" on public.docs
  for all to anon using (true) with check (true);

-- ให้สิทธิ์ชัดเจน (จำเป็นถ้าตอนสร้างโปรเจกต์ปิด "Automatically expose new tables"; ถ้าเปิดอยู่ก็ไม่เสียหาย)
-- anon = Extension ของทีม, service_role = ฟังก์ชัน gps-poll บนคลาวด์
grant usage on schema public to anon, service_role;
grant select, insert, update, delete on public.docs to anon, service_role;

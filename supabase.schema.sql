create table if not exists public.app_config (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.post_queue (
  id bigint primary key,
  topic text not null,
  tone text not null,
  sched_time text not null,
  status text not null,
  created_at text not null
);

alter table public.app_config enable row level security;
alter table public.post_queue enable row level security;

-- The server uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS.
-- Do not expose the service role key in frontend code.

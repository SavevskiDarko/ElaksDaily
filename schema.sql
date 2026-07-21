-- ============================================================
-- Elaks Ops — Supabase schema
-- Run once: Supabase Dashboard → SQL Editor → paste → Run
-- ============================================================

-- ---------- TASKS (daily tracker) ----------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  context text not null check (context in ('work','elaks','personal')),
  due_date date,
  due_time time,
  recurrence text check (recurrence in ('daily','weekly','monthly')),
  recur_dow int,                 -- 0=Sunday..6=Saturday (weekly)
  recur_dom int,                 -- 1..31 (monthly)
  remind boolean default false,  -- push reminder at due_time
  reminded_on date,              -- last date a reminder was sent
  done boolean default false,
  last_done date,                -- for recurring tasks: last completed date
  notes text,
  created_at timestamptz default now()
);

-- ---------- INVENTORY ----------
create table articles (
  id uuid primary key default gen_random_uuid(),
  code text,
  name text not null,
  category text not null default 'CCTV',   -- CCTV, DVR, Аларм, Пристап, Кабли, Друго
  unit text not null default 'ком' check (unit in ('ком','m')),
  min_stock numeric default 0,
  purchase_price numeric default 0,
  sell_price numeric default 0,
  supplier text,
  specs text,                    -- "--" bullet lines that go into offers
  active boolean default true,
  low_alerted_on date,           -- last date a low-stock push was sent
  created_at timestamptz default now()
);

create table movements (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  type text not null check (type in ('in','out','corr')),
  qty numeric not null,          -- corr can be negative
  note text,
  ref text,                      -- e.g. offer number
  created_at timestamptz default now()
);

create view article_stock
with (security_invoker = true) as
select a.*,
  coalesce(sum(case m.type when 'in' then m.qty when 'out' then -m.qty else m.qty end), 0) as stock
from articles a
left join movements m on m.article_id = a.id
group by a.id;

-- ---------- CLIENTS & OFFERS ----------
create table clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text,
  note text,
  created_at timestamptz default now()
);

create table offers (
  id uuid primary key default gen_random_uuid(),
  number text not null,          -- 2026-001
  title text not null,
  system text,
  client_id uuid references clients(id),
  offer_date date default current_date,
  validity int default 7,
  status text not null default 'draft' check (status in ('draft','sent','accepted','rejected')),
  items jsonb not null default '[]',
  total_note text,
  grand_total numeric default 0,
  stock_deducted boolean default false,
  created_at timestamptz default now()
);

-- ---------- PUSH ----------
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  endpoint text unique not null,
  sub jsonb not null,
  created_at timestamptz default now()
);

create table app_settings (
  key text primary key,
  value jsonb not null
);
insert into app_settings values ('digest_hour', '"07:30"'), ('digest_sent_on', 'null');

-- ---------- SECURITY (single authenticated user) ----------
alter table tasks enable row level security;
alter table articles enable row level security;
alter table movements enable row level security;
alter table clients enable row level security;
alter table offers enable row level security;
alter table push_subscriptions enable row level security;
alter table app_settings enable row level security;

create policy "auth all" on tasks for all to authenticated using (true) with check (true);
create policy "auth all" on articles for all to authenticated using (true) with check (true);
create policy "auth all" on movements for all to authenticated using (true) with check (true);
create policy "auth all" on clients for all to authenticated using (true) with check (true);
create policy "auth all" on offers for all to authenticated using (true) with check (true);
create policy "auth all" on push_subscriptions for all to authenticated using (true) with check (true);
create policy "auth all" on app_settings for all to authenticated using (true) with check (true);

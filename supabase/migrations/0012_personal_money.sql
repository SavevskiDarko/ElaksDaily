-- ============================================================
--  Money: each person's own income, spending and budgets
--
--  The Money tab is private. Every row carries the user_id of the person who
--  wrote it, and the policies below let a signed-in person read and change
--  their own rows and nothing else — not the owner's, not a helper's. The
--  owner does not see a helper's money, and a helper does not see the
--  owner's. Nothing here is shared with Elaks, Apartments or Insurance.
--
--    money_categories   what money is for: Food, Fuel, Salary…, each
--                       income or expense; an expense one may carry a
--                       monthly budget
--    money_entries      one amount in or out, on a day, in a category
--    money_recurring    what comes every month (salary, rent, phone):
--                       offered each month, entered with one tap
--
--  Safe to run more than once.
-- ============================================================

create table if not exists public.money_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  name text not null,
  icon text,
  budget numeric check (budget is null or budget >= 0),
  sort integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.money_recurring (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  name text not null,
  amount numeric not null check (amount > 0),
  category_id uuid references public.money_categories(id) on delete set null,
  day integer not null default 1 check (day between 1 and 31),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.money_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  amount numeric not null check (amount > 0),
  category_id uuid references public.money_categories(id) on delete set null,
  on_date date not null default current_date,
  note text,
  recurring_id uuid references public.money_recurring(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists money_entries_user_date_idx on public.money_entries (user_id, on_date);
create index if not exists money_categories_user_idx on public.money_categories (user_id);
create index if not exists money_recurring_user_idx on public.money_recurring (user_id);

alter table public.money_categories enable row level security;
alter table public.money_recurring enable row level security;
alter table public.money_entries enable row level security;

drop policy if exists "own money categories" on public.money_categories;
create policy "own money categories" on public.money_categories
  as permissive for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own money recurring" on public.money_recurring;
create policy "own money recurring" on public.money_recurring
  as permissive for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own money entries" on public.money_entries;
create policy "own money entries" on public.money_entries
  as permissive for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

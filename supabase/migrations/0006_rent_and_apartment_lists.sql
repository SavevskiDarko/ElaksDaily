-- ============================================================
--  Monthly rent, and choosing which apartments each person sees
--
--  Two things the apartments side could not do:
--
--  1. Not every flat is let by the night. Some have a tenant on a monthly
--     rent. This adds
--
--       apartments.rent_mode           'short' (by the night) or 'monthly'
--       apartments.tenant_pays_bills   the tenant pays the utilities, so the
--                                      app stops asking for that flat's bills
--       leases                         who rents it, for how much, due which day
--       rent_payments                  each payment, and the month it pays for
--
--  2. Which flats a person sees was all or "only the ones they manage". This
--     adds
--
--       user_roles.apt_ids     the other flats a limited person may see
--       user_roles.hide_apts   the flats a person keeps out of their own view —
--                              the owner tidying their screen, not access
--
--  and teaches can_see_apt about apt_ids, so the database itself hands a
--  limited person exactly their flats and nothing else.
--
--  3. A limited person still saw every apartments task — a guest's check-in
--     at somebody else's flat included — because tasks went by area, not by
--     flat. A task tied to a flat or a booking is now theirs only if the flat
--     is. Everyone who is not limited sees tasks exactly as before.
--
--  It restates everything 0003 did, so it is correct whether or not 0003 was
--  ever run. Safe to run more than once.
-- ============================================================

-- ---------- 1. columns ----------

alter table public.apartments
  add column if not exists managed_by uuid references auth.users(id) default auth.uid();
update public.apartments
   set managed_by = (select user_id from public.user_roles where role = 'owner' order by user_id limit 1)
 where managed_by is null;
alter table public.apartments add column if not exists rent_mode text not null default 'short';
alter table public.apartments add column if not exists tenant_pays_bills boolean not null default false;

alter table public.user_roles add column if not exists apts_own_only boolean not null default false;
alter table public.user_roles add column if not exists apt_ids uuid[] not null default '{}';
alter table public.user_roles add column if not exists hide_apts uuid[] not null default '{}';

-- ---------- 2. tenants and their rent ----------

create table if not exists public.leases (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  tenant_name text not null,
  tenant_phone text,
  rent numeric not null default 0,
  due_day integer not null default 1 check (due_day between 1 and 31),
  deposit numeric not null default 0,
  start_date date not null default current_date,
  end_date date,
  account_id uuid references public.accounts(id),
  notes text,
  late_sent_month text,              -- 'YYYY-MM' the late-rent notice last went out for
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);
create index if not exists leases_apartment_idx on public.leases (apartment_id);

create table if not exists public.rent_payments (
  id uuid primary key default gen_random_uuid(),
  lease_id uuid not null references public.leases(id) on delete cascade,
  apartment_id uuid not null references public.apartments(id) on delete cascade,
  month date not null,               -- the first of the month it pays for
  amount numeric not null default 0,
  paid_on date not null default current_date,
  account_id uuid references public.accounts(id),
  note text,
  created_at timestamptz default now(),
  created_by uuid default auth.uid()
);
create index if not exists rent_payments_lease_idx on public.rent_payments (lease_id, month);

alter table public.leases enable row level security;
alter table public.rent_payments enable row level security;

-- ---------- 3. the helpers ----------
-- security definer so they can read user_roles and apartments without the
-- caller needing to, and so the apartments lookup does not recurse into the
-- very policy that uses it. search_path pinned, as the others are.

create or replace function public.apts_restricted()
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$ select coalesce((select apts_own_only from user_roles where user_id = auth.uid()), false) $$;

-- the flats beyond their own that a limited person has been given
create or replace function public.my_apt_ids()
  returns uuid[]
  language sql stable security definer
  set search_path to 'public'
as $$ select coalesce((select apt_ids from user_roles where user_id = auth.uid()), '{}'::uuid[]) $$;

-- may I see this flat, and everything hanging off it
create or replace function public.can_see_apt(p_apt uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$
  select my_role() = 'owner'
      or (can_apts()
          and (not apts_restricted()
               or p_apt = any(my_apt_ids())
               or exists (select 1 from apartments a
                           where a.id = p_apt and a.managed_by = auth.uid())));
$$;

create or replace function public.can_see_stay(p_stay uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$ select can_see_apt((select apartment_id from stays where id = p_stay)) $$;

-- ---------- 4. the policies ----------

drop policy if exists "apts by perm" on public.apartments;
create policy "apts by perm" on public.apartments
  as permissive for all to authenticated
  using (
    my_role() = 'owner'
    or (can_apts() and (not apts_restricted() or managed_by = auth.uid() or id = any(my_apt_ids())))
  )
  with check (
    my_role() = 'owner'
    or (can_apts() and (not apts_restricted() or managed_by = auth.uid() or id = any(my_apt_ids())))
  );

drop policy if exists "stays by perm" on public.stays;
create policy "stays by perm" on public.stays
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "bills by perm" on public.bills;
create policy "bills by perm" on public.bills
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "apt expenses by perm" on public.apt_expenses;
create policy "apt expenses by perm" on public.apt_expenses
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "feeds by perm" on public.ical_feeds;
create policy "feeds by perm" on public.ical_feeds
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "stay payments by perm" on public.stay_payments;
create policy "stay payments by perm" on public.stay_payments
  as permissive for all to authenticated
  using (can_see_stay(stay_id)) with check (can_see_stay(stay_id));

drop policy if exists "leases by perm" on public.leases;
create policy "leases by perm" on public.leases
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "rent payments by perm" on public.rent_payments;
create policy "rent payments by perm" on public.rent_payments
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

-- ---------- 4b. tasks tied to a flat ----------
-- the check-in reminders knew their booking but not their flat; say which
update public.tasks t set apartment_id = s.apartment_id
  from public.stays s
 where t.stay_id = s.id and t.apartment_id is null;

-- For a limited person only: a task about a flat, or about a booking in one,
-- must be about a flat they see. Nobody else is narrowed by this.
create or replace function public.task_apt_ok(p_apt uuid, p_stay uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$
  select not apts_restricted()
      or ((p_apt is null
           or p_apt = any(my_apt_ids())
           or exists (select 1 from apartments a where a.id = p_apt and a.managed_by = auth.uid()))
          and (p_stay is null
           or exists (select 1 from stays s join apartments a on a.id = s.apartment_id
                       where s.id = p_stay and (a.managed_by = auth.uid() or a.id = any(my_apt_ids())))));
$$;

drop policy if exists "tasks by perm" on public.tasks;
create policy "tasks by perm" on public.tasks
  as permissive for all to authenticated
  using (
    case
      when context = 'personal' then (owner_uid = auth.uid() or owner_uid = any(my_personal_access()))
      else (my_role() = 'owner' or (context = any(my_task_ctx()) and task_apt_ok(apartment_id, stay_id)))
    end)
  with check (
    case
      when context = 'personal' then (coalesce(owner_uid, auth.uid()) = auth.uid() or coalesce(owner_uid, auth.uid()) = any(my_personal_access()))
      else (my_role() = 'owner' or (context = any(my_task_ctx()) and task_apt_ok(apartment_id, stay_id)))
    end);

-- ---------- 5. self-registration ----------
-- Restated with the new columns: a new login still arrives with nothing — no
-- flats of anybody's named in apt_ids, ready for the day it is given the tab.

drop policy if exists "self register empty" on public.user_roles;
create policy "self register empty" on public.user_roles
  as permissive for insert to authenticated
  with check (
    user_id = auth.uid()
    and role = any (array['employee'::text, 'assistant'::text])
    and coalesce(task_contexts, '{}'::text[]) = '{}'::text[]
    and see_elaks = false
    and see_apts = false
    and see_insurance = false
    and coalesce(personal_access, '{}'::uuid[]) = '{}'::uuid[]
    and coalesce(hide_tabs, '{}'::text[]) = '{}'::text[]
    and coalesce(apt_ids, '{}'::uuid[]) = '{}'::uuid[]
  );

create index if not exists apartments_managed_idx on public.apartments (managed_by);

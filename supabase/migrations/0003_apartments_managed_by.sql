-- ============================================================
--  Give an apartment a manager, and let a person be limited to their own
--
--  Until now see_apts was all or nothing: anyone with the Apartments tab read
--  every flat, every booking, every guest name and every figure. This adds
--
--    apartments.managed_by     who looks after this flat
--    user_roles.apts_own_only  this person sees only the flats they manage
--
--  and rewrites the six apartment-side policies to respect them. The owner is
--  never restricted. Somebody whose apts_own_only is false behaves exactly as
--  before, so turning this on changes nothing until you tick the box.
--
--  Safe to run more than once.
-- ============================================================

-- ---------- 1. the columns ----------

alter table apartments
  add column if not exists managed_by uuid references auth.users(id) default auth.uid();

-- Existing flats predate the column, so nothing recorded who added them.
-- They go to the owner, which is who actually has them today.
update apartments
   set managed_by = (select user_id from user_roles where role = 'owner' order by user_id limit 1)
 where managed_by is null;

alter table user_roles
  add column if not exists apts_own_only boolean not null default false;

-- ---------- 2. the helpers ----------
-- security definer so they can read user_roles and apartments without the
-- caller needing to, and so the apartments lookup below does not recurse into
-- the very policy it is being used by. search_path pinned, as the others are.

create or replace function public.apts_restricted()
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$ select coalesce((select apts_own_only from user_roles where user_id = auth.uid()), false) $$;

-- may I see this flat, and everything hanging off it
create or replace function public.can_see_apt(p_apt uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$
  select my_role() = 'owner'
      or (can_apts()
          and (not apts_restricted()
               or exists (select 1 from apartments a
                           where a.id = p_apt and a.managed_by = auth.uid())));
$$;

-- stay_payments hangs off a stay rather than a flat, so it needs the hop
create or replace function public.can_see_stay(p_stay uuid)
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $$ select can_see_apt((select apartment_id from stays where id = p_stay)) $$;

-- ---------- 3. the policies ----------

drop policy if exists "apts by perm" on apartments;
create policy "apts by perm" on apartments
  as permissive for all to authenticated
  using (
    my_role() = 'owner'
    or (can_apts() and (not apts_restricted() or managed_by = auth.uid()))
  )
  with check (
    my_role() = 'owner'
    or (can_apts() and (not apts_restricted() or managed_by = auth.uid()))
  );

-- the with check is what stops a restricted person handing themselves someone
-- else's flat, or creating one in another person's name

drop policy if exists "stays by perm" on stays;
create policy "stays by perm" on stays
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "bills by perm" on bills;
create policy "bills by perm" on bills
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "apt expenses by perm" on apt_expenses;
create policy "apt expenses by perm" on apt_expenses
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "feeds by perm" on ical_feeds;
create policy "feeds by perm" on ical_feeds
  as permissive for all to authenticated
  using (can_see_apt(apartment_id)) with check (can_see_apt(apartment_id));

drop policy if exists "stay payments by perm" on stay_payments;
create policy "stay payments by perm" on stay_payments
  as permissive for all to authenticated
  using (can_see_stay(stay_id)) with check (can_see_stay(stay_id));

-- ---------- 4. self-registration ----------
-- Restated here in full, including the two columns 0002 added and the one this
-- migration adds, so it is correct whether or not 0002 was ever run. A new
-- login still arrives with nothing: no task contexts, no business access, no
-- claim on anybody's private tasks, and no say over its own apartment limit.

drop policy if exists "self register empty" on user_roles;
create policy "self register empty" on user_roles
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
  );

-- ---------- 5. an index for the lookup ----------
create index if not exists apartments_managed_idx on apartments (managed_by);

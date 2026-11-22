-- ============================================================
--  Camera plans: where each camera hangs, and what it covers
--
--  A plan is drawn in Elaks (from an offer, a job or a client's card): the
--  house, walls and areas in metres, the cameras with their lens and
--  resolution, and the places that matter (gate, doors). It belongs to the
--  client, so it is there years later; it also remembers the offer and job
--  it was drawn for, and the offer PDF can carry it as a page.
--
--    coverage_plans         one plan: the drawing as JSON (a few KB),
--                           how many cameras it has, whether the offer PDF
--                           includes it
--    coverage_plan_images   the photo or satellite picture drawn over,
--                           kept apart so lists stay light
--
--  Who may see and change them: the owner, and anyone given Elaks — the same
--  rule as clients, offers and jobs.
--
--  Safe to run more than once.
-- ============================================================

create table if not exists public.coverage_plans (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  offer_id uuid references public.offers(id) on delete set null,
  job_id uuid references public.jobs(id) on delete set null,
  title text,
  plan jsonb not null default '{}'::jsonb,
  cams integer not null default 0,
  in_offer boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.coverage_plan_images (
  plan_id uuid primary key references public.coverage_plans(id) on delete cascade,
  data text not null
);

create index if not exists coverage_plans_client_idx on public.coverage_plans (client_id);
create index if not exists coverage_plans_offer_idx on public.coverage_plans (offer_id);
create index if not exists coverage_plans_job_idx on public.coverage_plans (job_id);

alter table public.coverage_plans enable row level security;
alter table public.coverage_plan_images enable row level security;

drop policy if exists "plans by perm" on public.coverage_plans;
create policy "plans by perm" on public.coverage_plans
  as permissive for all to authenticated
  using (my_role() = 'owner' or can_elaks()) with check (my_role() = 'owner' or can_elaks());

drop policy if exists "plan images by perm" on public.coverage_plan_images;
create policy "plan images by perm" on public.coverage_plan_images
  as permissive for all to authenticated
  using (my_role() = 'owner' or can_elaks()) with check (my_role() = 'owner' or can_elaks());

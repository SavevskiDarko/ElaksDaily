-- 0014 — a photo for each camera on a camera plan
--
-- Taken from where the camera will hang, so the app can lay the lens's frame
-- and how far it sees (face, person, activity) over the real place. One photo
-- per camera; the overlay settings stay in the plan itself (coverage_plans.plan).
-- Same access as the plans: the owner and anyone who works in Elaks.
-- Safe to run more than once.

create table if not exists public.coverage_plan_photos (
  plan_id    uuid not null references public.coverage_plans(id) on delete cascade,
  cam_id     text not null,
  data       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_id, cam_id)
);

alter table public.coverage_plan_photos enable row level security;

drop policy if exists "plan photos by perm" on public.coverage_plan_photos;
create policy "plan photos by perm" on public.coverage_plan_photos for all
  using (my_role() = 'owner' or can_elaks())
  with check (my_role() = 'owner' or can_elaks());

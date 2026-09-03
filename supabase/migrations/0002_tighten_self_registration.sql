-- ============================================================
--  Close two gaps in the user_roles self-registration policy
--
--  The app inserts a zero-access row into user_roles the first time somebody
--  signs in, and the "self register empty" policy is what stops that insert
--  from being generous to itself. It pins user_id, role, task_contexts,
--  see_elaks and see_apts — but it says nothing about two other columns:
--
--    see_insurance    grants the whole insurance book: holders, plates,
--                     phone numbers, premiums, commissions, policy scans.
--                     can_insurance() reads it straight off the row.
--
--    personal_access  the list of whose private tasks you may open. The tasks
--                     policy trusts it through my_personal_access(), so a row
--                     that names the owner reads the owner's personal tasks.
--
--  A person can only take this path before their row exists — the app writes
--  it on first sign-in, there is no delete policy, and update is owner-only.
--  So the window is a newly added employee who calls the REST API before
--  opening the app. Narrow, and worth closing: nothing legitimate sets either
--  column at registration. The owner still grants both from the Team screen,
--  through the owner-only update policy, which is untouched here.
--
--  Safe to run more than once. Changes no existing row.
-- ============================================================

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

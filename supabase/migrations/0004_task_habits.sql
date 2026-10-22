-- ============================================================
--  Choose which repeating tasks are habits
--
--  The Habits view showed every repeating task, chores included — the monthly
--  invoicing sat beside the gym. This adds
--
--    tasks.habit   track this task as a habit: its streak and its record
--
--  and the task sheet gets a "Track as a habit" switch for it.
--
--  The repeating tasks that exist when this runs are marked as habits, so
--  nothing disappears from the view; switch off the ones that are not.
--  Tasks made afterwards start with it off.
--
--  Safe to run more than once: the marking happens only on the run that adds
--  the column, so it never undoes a switch you have since turned off.
--  Nothing else changes — the task policies already cover a new column.
-- ============================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'tasks' and column_name = 'habit') then
    alter table public.tasks add column habit boolean not null default false;
    update public.tasks set habit = true where recurrence is not null;
  end if;
end $$;

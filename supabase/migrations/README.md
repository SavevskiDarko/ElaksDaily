# The schema

`0001_captured_schema.sql` holds the schema as it stood on 2026-09-02: 37
tables, 5 views, 11 functions, 106 constraints, 88 indexes, and all 39 row-level
security policies. Every relation and function the app calls is in it — checked
against `EXPECTED.md`, which is generated from the code.

It was produced by a query run in the Supabase SQL Editor rather than by
`supabase db pull`, because no machine with the CLI was to hand. That makes it a
very good backup, not a byte-exact one. Its header lists what it does not
cover; the gaps worth closing are triggers, extension installs (`pg_net` and
`pg_cron`, which the push schedule needs), and **view options** — `article_stock`
carried `security_invoker = true` in the original 2025 schema and the capture
cannot show whether it, `team_members` or `entry_authors` still do. A view
without it runs with its owner's rights and ignores RLS.

So: replace this file with a real dump when you next have a terminal.

## Replacing it with a proper dump, on a machine with the Supabase CLI

```bash
npm install -g supabase              # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref inbxjztezjfrbnidzofy
supabase db pull                     # writes supabase/migrations/<timestamp>_remote_schema.sql
git rm supabase/migrations/0001_captured_schema.sql
git add supabase/migrations && git commit -m "Capture the live schema properly"
```

`db pull` asks for the database password — Supabase dashboard, Project Settings
→ Database. It is not the anon key and not your login password.

## Check the dump against what the app needs

`supabase/EXPECTED.md` lists every relation and function the code names. It is
generated from the code itself:

```bash
node scripts/schema-inventory.mjs > supabase/EXPECTED.md
```

Open the migration the pull wrote and confirm each relation in EXPECTED.md
appears in it. Anything missing means the dump did not capture everything —
usually a schema other than `public`.

## What the policies actually say

They are better than the app's own comments suggest. Every table has RLS on,
each one scoped through `my_role()`, `can_elaks()`, `can_apts()` or
`can_insurance()`, which are all `security definer` with a pinned
`search_path`. `secrets` has RLS on and no policy at all, so nothing signed in
can read the Anthropic key — only `read-doc`, as the service role. An employee
**cannot** make themselves an owner: `user_roles` has no update policy for
anyone but the owner, and the self-registration insert pins `role` to
`employee` or `assistant`.

Two gaps remain in that self-registration policy, both in
`0002_tighten_self_registration.sql` — read it before you run it:

- it constrains `see_elaks` and `see_apts` but not **`see_insurance`**, so a
  new login can grant itself the whole insurance book;
- it does not constrain **`personal_access`**, the list of whose private tasks
  you may read, so a new login can name the owner and read their personal
  tasks.

Both only apply before a person's row exists — the app writes it on first
sign-in — so the window is a newly added employee who calls the API before
opening the app. Narrow, but it is the difference between the policy meaning
what it says and not.

## From then on

Change the schema with a migration rather than in the dashboard:

```bash
supabase migration new add_whatever   # writes an empty .sql file to edit
supabase db push                      # applies it to the linked project
```

If a change does get made in the dashboard, `supabase db pull` again
afterwards so the repository does not fall behind a second time.

## Restoring into an empty project

```bash
supabase link --project-ref <the new ref>
supabase db push
```

Then follow SETUP.md from step 3 — the auth user, the VAPID keys, the secrets
and the schedule are configuration, not schema, and none of them are in here.

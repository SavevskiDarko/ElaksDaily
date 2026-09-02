# The schema lives in the database. Get it into git.

Nothing in this repository can rebuild the Centrala database. The app reads and
writes **40 tables and views**; the `schema.sql` that used to sit in the project
root defined 8 of them, from 2025, and following SETUP.md's instruction to run
it would have built an app that cannot start. It has been removed — `git log --
schema.sql` still has it if you want to look.

Until the command below has been run, the only copy of the schema — the tables,
the views, the row-level security policies, the functions — is inside the
Supabase project. If that project is lost, the app cannot be brought back.

## Once, on a machine with the Supabase CLI

```bash
npm install -g supabase              # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref inbxjztezjfrbnidzofy
supabase db pull                     # writes supabase/migrations/<timestamp>_remote_schema.sql
git add supabase/migrations && git commit -m "Capture the live schema"
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

Then read the policies. EXPECTED.md ends with the things no script can see, and
the first of them is the one that matters: **the app decides what each person
sees in the browser, and that is a convenience, not a boundary.** Everyone
signed in holds the anon key and can call the REST API directly. Check in
particular that an employee cannot update their own `user_roles` row to
`role = 'owner'`.

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

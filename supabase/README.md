# Cloud save backend

Cloud save (`docs/design.md` §11) needs one Supabase project. The server only
stores a save and a revision number; all game rules and validation stay in the
client. This folder holds the whole backend: one SQL migration and its tests.

## Set up (maintainer, once)

1. Create a project at <https://supabase.com> (the free tier is enough).
2. Authentication → Sign In / Providers → turn on **Allow anonymous sign-ins**.
   Players have no account: each browser is an anonymous user.
3. Apply the migration: SQL Editor → paste `migrations/20261010000000_cloud_save.sql`
   → Run. (Or `supabase link --project-ref <ref>` then `supabase db push`.)
4. Authentication → Rate limits: keep "anonymous sign-ins" limited (the default
   is 30 an hour per IP) so nobody can mass-create users.
5. Project Settings → API: copy the project URL (`https://<ref>.supabase.co`) and
   the **anon / publishable** key. Never use the `service_role` key anywhere in
   this repo.
6. Locally, copy `.env.example` to `.env` and fill in both values (`.env` is
   git-ignored). For the deployed site, add them as GitHub Actions **variables**
   (Settings → Secrets and variables → Actions → Variables):
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. They are public by design
   (they ship in the page), so variables, not secrets, are right; what protects
   the data is the migration's row-level security and function grants.

Without both values the build has no cloud save: the Menu section is hidden and
the page's Content-Security-Policy is unchanged.

## Verify

- Anonymous sign-ins work (pending a first run against a real project):
  `curl -s -X POST "$VITE_SUPABASE_URL/auth/v1/signup" -H "apikey: $VITE_SUPABASE_ANON_KEY" -H 'Content-Type: application/json' -d '{}'`
  returns an `access_token`.
- Run the SQL tests locally (needs Docker and the
  [Supabase CLI](https://supabase.com/docs/guides/local-development)):
  `supabase start && supabase test db`. They cover cross-player isolation,
  denied table and anon access, stale-revision conflicts, size and shape limits,
  link-code expiry and reuse, and cascade deletes. They are not part of CI.
- Two-browser check: turn on cloud save in browser A, get a link code, enter it
  in browser B, and confirm B shows A's cultivator.

## How access is limited

- Row-level security is on for all three tables and no role has table grants, so
  the REST API cannot read or write them directly.
- Every access is a `security definer` function with `set search_path = ''`, fully
  qualified names, and its own `auth.uid()` check. Only the `authenticated` role
  (which includes anonymous users) may execute them; `public` and `anon` may not.
- Inputs are function parameters, never strings built into queries.
- Link codes are 10 characters from a 32-letter alphabet (50 random bits), single
  use, and expire after 15 minutes.

Anonymous users that Supabase later purges leave their save behind without an
owner; those rows are small and can be deleted by hand.

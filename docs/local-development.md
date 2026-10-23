# Local development

`pnpm dev` talks to a local Supabase project, not staging or production —
`.env.local` carries its URL and anon key, and Vite's env precedence means it
overrides `.env` in every mode. Nothing in a development build can reach a
remote project: there is no browser flag or env var that switches the
Supabase client to a different URL at runtime, on purpose (issue #87).

**New machine (including switching between two machines you already work
from):**

```
pnpm install
cp .env.local.example .env.local     # then fill in STAGING_DB_URL, PROD_DB_URL,
                                      # VERCEL_OIDC_TOKEN from wherever the team
                                      # keeps them — everything else in the file
                                      # is already correct, see why below
supabase start                       # first time: pulls images, applies every
                                      # migration from empty
pnpm db:seed:fresh                   # pulls + sanitizes + loads a staging snapshot
pnpm dev
```

**Magic Local Login.** Set `VITE_MAGIC_LOGIN_EMAIL` and `VITE_MAGIC_LOGIN_PASSWORD` in
`.env.local` (`dev@local.com` / `password123`) and the login form pre-fills on load.
`supabase/seed.sql` and `scripts/create-magic-user.mjs` create that user, so it survives
`db reset` and `db:seed:fresh`. The pre-fill also covers the other mock logins, so a
browser run must retype the email and password boxes (see
`docs/stories/purchasing/README.md`, "Log in as another person").

`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local.example` are
committed as real, working values on purpose, not placeholders — they're
derived entirely from `supabase/config.toml`'s committed `project_id` and the
CLI's default local JWT secret, so they come out identical on every machine.
There's nothing to run `supabase status` and paste in.

**Day to day, once set up:**

```
supabase start                      # resumes with your data intact — see below
pnpm dev                            # talks to that local instance
supabase stop                       # pauses; local data survives to next `start`
pnpm db:reset                       # rebuilds from migrations AND restores cached seed data (~5s total)
supabase db reset                   # rebuilds from migrations only (clean, unseeded state for tests)
```

`supabase stop` alone preserves the local database's Docker volume — your
seeded data is still there next time you `supabase start`, on this machine.
Only `supabase stop --no-backup` deletes it, so save that for a deliberate
wipe, not routine shutdown. Data does not travel *between* machines either
way — `.env.local` isn't committed, and `supabase/.seed/`'s cached dump is
gitignored — so getting a second machine to the same working state means
running the bootstrap above on it, not copying volumes across.

Seeing staging requires typing a different command: `pnpm dev:staging` runs
Vite in `staging` mode against `.env.staging`, which is not overridden by
`.env.local` (a mode-specific env file outranks it). There is deliberately no
equivalent for production.

Local data is disposable by design and never committed:

- `pnpm db:reset` — runs `supabase db reset` and immediately restores local seed
  data via `pnpm db:seed:restore`. The fastest way to reset and test migrations locally.
- `pnpm db:seed:restore` — loads the local cached dump into the local database
  (restores ~12,500 rows in ~1s via batched inserts) and resets every account's
  password to `VITE_TEST_PASSWORD`, pairing with `VITE_ALLOW_TEST_LOGIN` so you
  can sign in locally as any role.
- `pnpm db:seed:dump` — pulls a sanitized snapshot of staging's data into a
  gitignored cache file (`supabase/.seed/`). Sanitization rules live in
  `src/lib/seedSanitize.js`, tested without a database; re-run this only when
  you deliberately want fresher data from the remote staging database.
- `pnpm db:seed:fresh` — `db:seed:dump` + `db:seed:restore` chained. Use this
  only on initial setup of a fresh machine or when intentionally refreshing
  the staging cache over the network. For routine resets, use `pnpm db:reset`.
- `pnpm db:refresh` — `supabase db reset` + `db:seed:fresh`. The one command
  to reproduce current staging state locally: replays every migration from
  empty, then pulls, sanitizes and loads a live staging snapshot. The leading
  reset is what lets the restore land when local migrations are behind.
- `pnpm db:seed:snapshot` — saves the local database's *current* data before
  a deliberate reset, if there's a working set worth keeping;
  restore it with `pnpm db:seed:restore -- <the file it printed>`.

**Edge functions run locally.** `edge_runtime` is enabled in `supabase/config.toml`, so
`supabase start` serves them, and `odoo-sor-lookup` returns sample data on this stack
when no Odoo credentials are set (`isLocalStack` in `_shared/odoo.ts`). To read
**real Odoo data** locally (the `odoo-*` reads, IPAS PO lookups, supplier search), put the
Odoo secrets in `supabase/functions/.env` (gitignored: `ODOO_URL`, `ODOO_DB`,
`ODOO_USERNAME`, `ODOO_API_KEY`, `ODOO_ADMIN_TOKEN`) and serve with them:

```
npx supabase functions serve --env-file supabase/functions/.env   # leave running
```

The secrets are read-only use: nothing local writes to Odoo. Run any browser story
that touches a PO with the function server up. If a PO lookup shows sample data or
fails, check the function server first.

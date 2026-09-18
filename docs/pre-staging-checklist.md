# Pre-staging checklist

Run this after finishing a feature or a bug fix, before `git push origin staging`.
Pushing to `staging` auto-applies pending migrations to the staging database
(`.github/workflows/migrate-staging.yml`) and deploys the staging site, so the
goal is that nothing about the push is a surprise.

## 1. `pnpm preflight`

Runs the mechanical gates in the same order CI will, stopping at the first
failure:

| Step | When | CI equivalent |
|---|---|---|
| `pnpm lint:tests` | always — **fails the run** | `ci.yml` (hard gate) |
| `pnpm lint` | always — advisory only | `ci.yml` (`continue-on-error`, pre-existing backlog) |
| Vitest — tests this branch can reach (`vitest --changed`) | always; the **full suite** when a migration, shared test infrastructure, a Vitest config, `package.json` or the lockfile changed, with no merge base, or with `--full` | `ci.yml` (always the full suite) |
| `pnpm build` | always (skip with `--quick`) | Vercel build |
| Migration schema check vs `supabase/schema/staging.sql` | only if `supabase/migrations/**` changed | `migration-gate.yml` |
| Changelog entry present | warns if `src/` changed without `src/data/changelog.json` (`--strict` fails) | — |

The migration check needs the local stack up (`supabase start`). It uses the
same comparator (`scripts/db-snapshot.mjs`) the PR gate does — a migration that
won't apply cleanly from empty, or that produces the wrong schema, fails here
instead of on the push.

The scoped test run is safe because CI runs every test on every push; preflight
only has to catch what this branch broke. The rule for when it widens to the
full suite lives in `scripts/lib/testSelection.mjs`, with its tests.

## 2. Smoke test on seeded data — every time

```
pnpm db:reset      # rebuild local schema from migrations, restore the CACHED staging snapshot
pnpm dev
```

Walk the actual change end to end. `db:reset` gives you staging-shaped,
sanitized data, so "works locally" means something.

To test against **current** staging data instead of the cache, use the other
bundled command — `pnpm db:refresh` (= `supabase db reset` + `db:seed:fresh`):
it replays migrations from empty, then pulls, sanitizes and loads a live
staging snapshot. Needs `STAGING_DB_URL` in `.env.local`; all restored
passwords become `VITE_TEST_PASSWORD` (sign in via `VITE_ALLOW_TEST_LOGIN`).

## 3. Dashboard config — when the change touches auth, login, email or redirects

`supabase/config.toml` only drives the **local** stack. Anything under `[auth]`
there has a twin in the staging Supabase dashboard that a deploy does **not**
update. Reconcile by hand, on the **staging** project (`fpjxdyowngpnovotbzqi`):

- **Auth ▸ URL Configuration**
  - Site URL: `https://t3ckgroup-erp-staging.vercel.app` (no trailing slash)
  - Redirect URLs: include `https://t3ckgroup-erp-staging.vercel.app/**`
  - `{{ .SiteURL }}` in email templates expands to Site URL, and GoTrue falls
    back to it for any `redirect_to` not covered above — a wrong value here
    (it was once `http://localhost:3000`) sends every auth email to a dead link.
- **Auth ▸ Email Templates** — each body matches the file in
  `supabase/templates/`. Reset Password:
  `{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery`
  - **Deploy the code before changing this template.** `pages/reset-password`
    reads both the `token_hash` form and the legacy `#access_token`/`?code`
    form, so new code serves old links fine. The reverse does not: a
    `token_hash` template pointed at an older deploy dead-ends every reset.

- **Auth ▸ Emails ▸ SMTP Settings** — Supabase's built-in email provider is
  demonstration-only. It refuses delivery to any address outside the project's
  Supabase organization, and caps every auth email endpoint at 2/hour
  project-wide with no way to raise it. `src/lib/seedSanitize.js` keeps
  employee emails as-is, so most staging accounts are addresses it will
  silently not mail — which makes an end-to-end reset test impossible on it.
  Staging runs custom SMTP through Resend instead:

  | Setting | Value |
  |---|---|
  | Host | `smtp.resend.com` |
  | Port | `587` (STARTTLS) |
  | Username | `resend` |
  | Password | Resend API key — sending access only, scoped to `t3cktrading.com` |
  | Sender email | `no-reply-staging@t3cktrading.com` |
  | Sender name | `T3ckgroup ERP (Staging)` |

  The key is a real secret: it lives in the same password manager as
  `STAGING_DB_URL`, never in a `.env*` file — anything `VITE_`-prefixed is
  bundled into the browser build. Custom SMTP also makes the auth email rate
  limit tunable, defaulting to 30/hour; staging leaves it there.

  Two settings on the Resend side (Domains ▸ `t3cktrading.com` ▸
  Configuration), neither of them the default:
  - **TLS: Enforced.** A reset email carries a single-use token that grants a
    password-change session. Opportunistic — the default — falls back to
    sending unencrypted to any receiver that won't negotiate TLS.
  - **Leave tracking metrics unconfigured.** Click tracking rewrites every
    link in the body, which would mangle the `token_hash` the reset link is
    built around.

Production (`epqmberwewztzbrkhhss`) has its own Site URL — the prod Vercel
domain — and needs the same template change when the feature ships there, plus
its own SMTP settings: the two projects do not share them. Until prod has custom
SMTP of its own, real password resets there are subject to the same
org-members-only and 2/hour limits described above.

## 4. Migrations — when `supabase/migrations/**` changed

- Filename is a UTC-timestamp prefix, not the next sequential number (ADR 0007).
- App-required rows (a category, a rate, a pipeline stage) go in an idempotent
  `insert` **inside the migration**, never a script.
- You proved it with `supabase db reset` (replays from empty) against the local
  stack, not a remote project. CI applies it on push; you never run
  `supabase db push` or a Supabase MCP `apply_migration` against staging.
- Production's ledger is not staging's. Run `pnpm db:ledger:check prod` before
  assuming a migration that ran on staging will apply the same way to prod —
  prod has historically drifted in both directions (AGENTS.md, "Database
  migrations").

## 5. Changelog

If behaviour or UI changed, add a plain-language entry to
`src/data/changelog.json` before pushing — users see it as a "What's Changed"
modal on next login.

## 6. Push

```
git log --oneline origin/staging..HEAD    # you are merging into staging, not main
git push origin staging
```

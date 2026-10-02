---
name: ship
description: Verify local commits, push them to staging, watch CI, then promote the same SHA to main.
disable-model-invocation: true
---

# Ship

Ship the local commits (`origin/staging..HEAD`) to staging, then the same SHA to main. Main deploys to prod on push, so every gate below exists to make that push boring.

**On any failure: stop, report, diagnose.** Never auto-fix, revert, force-push, stash, `git add`, or reset. The user edits this checkout live.

## Preconditions

Be on `staging`, ahead of `origin/staging`, not behind. Ignore dirty files whose content diff is empty (EOL noise). If real uncommitted work exists, run the local gate and browser check in a temp worktree at HEAD (copy `.env*` in), so you verify what gets pushed.

## Local gate

Run `pnpm preflight --strict`. Then fail if any existing migration was modified (`git diff --diff-filter=MR origin/staging -- supabase/migrations`): a direct push skips the PR-only migration gates, so this check stands in for them.

## Pick the order

Prod migrations are a manual dispatch, and main deploys UI instantly. Choose which goes first from the new migrations:

- **Migrations-first**: only additive changes (CREATE, nullable ADD COLUMN, GRANT, new policy). The old UI keeps working on the new schema.
- **UI-first**: contract changes (DROP, RENAME, ALTER TYPE, SET NOT NULL, REVOKE). The UI must stop using the old shape first.
- **Stop and show the user**: replaced or altered policies or functions, data DELETE or UPDATE, or a mix. RLS changes have blanked registers before, and prod data deletion is banned.

Note any `supabase/functions/**` change for the end.

## Verify locally

If there are migrations, run `supabase migration up` (never reset). Start preview `dev`, which uses local Supabase, and log in as the magic user. Turn each commit's diff into checks and screenshot each one.

## Staging

Push with `git push origin staging`. Watch every Actions run on the SHA (`gh run list --commit <sha>`) and the Vercel staging deploy; time out at 30 min. CI runs the full test suite here.

Then smoke the changed screens on `t3ckgroup-erp-staging.vercel.app` using the browser pane's existing session. **Never type a password**; if signed out, ask the user to sign in.

If migrations-first: ask the user to dispatch **Apply migrations — production** on ref `staging` with `confirm: apply`, and watch that run.

## Main

Tell the user what users will see, and **wait for an explicit yes**. Then `git push origin <sha>:main`, fast-forward only.

Watch CI on main and the Vercel prod deploy. Smoke the changed screens read-only: never create or edit prod records.

## Hand back

Ask the user to dispatch what's left:

- UI-first: **Apply migrations — production** on `main`.
- Edge functions changed: `deploy-edge-functions`, staging then prod.

# Branch Topology and Deploy Triggers

We need `main` and `staging` to have stated, stable roles instead of accumulating work by habit, because the two drifted 37 commits against 45 in opposite directions before anyone noticed — nothing prompted a check, so the fix became a large conflicted merge instead of a series of small ones.

`staging` is the permanent integration branch: everything accepted but not yet released. `main` is stable — what is deployed to production. Work lands on `staging` first and reaches `main` on release, never the reverse except a deliberate hotfix.

Two Vercel projects watch this one GitHub repository, and both auto-deploy on push with no gate in between: `t3ckgroup-erp` follows `main` and serves `www.t3ckgroup-erp.online`, `t3ckgroup-erp-staging` follows `staging`. This was not obvious from the repository alone — a push to `main` reached real users immediately, before anyone had reviewed the change on staging, because nothing in the repo said a push to `main` was a production deploy. It was rolled back from the Vercel dashboard and `main` was reverted to match.

The mitigations:

- **This document**, so "push to `main`" is never treated as a low-stakes action again.
- **`scripts/hooks/pre-push`** warns (never blocks) when `main` is ahead of `staging`, listing the commits — the moment drift is created is the cheapest moment to notice it.
- **Migrations move through the same topology**, enforced by CI rather than habit: pushing `staging` applies pending migrations to the staging database automatically; production only applies through a manually triggered workflow. See the "Database migrations" section of `AGENTS.md`.

What this does not solve: nothing here stops a push to `main` from deploying instantly. That is Vercel's git integration, not something this repository controls, and changing it is a deliberate choice for whoever owns the Vercel projects — not assumed here.

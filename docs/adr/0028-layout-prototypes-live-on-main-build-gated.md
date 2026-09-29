# ADR 0028 — Layout prototypes may live on `main`, build-gated

## Status

Accepted 2026-09-29, from the prod cutover grilling (#414). Review / sunset **2026-12-31**.

## Context

The SOR modal layout prototype (a switcher over alternative layouts) was
guarded by "the folder must not exist on `main`". The one-big-merge release
(#414) merges staging into `main`, and the team wants the switcher to stay on
staging after it.

## Decision

Prototypes may live on `main` only if **build-gated**:

- `VITE_APP_ENV` (`staging` / `local`) is the only switch, checked at build time. No runtime hostname sniffing.
- The prototype is loaded through a dynamic `import()` inside that static branch, so Vite strips it from a production bundle.
- The switcher defaults to the shipped layout (H).
- `scripts/check-no-prototypes.mjs` builds for production and fails if the output contains a prototype marker. CI runs it. On staging it also fails after 2026-12-31 while the folder exists.

## Consequences

- Prod ships one layout and none of the prototype code.
- The prototype folder is deleted by 2026-12-31, or the date in the script is bumped on purpose.
- Vercel staging must set `VITE_APP_ENV=staging`; prod must not.

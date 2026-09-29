# 2026-09 release — one big merge

Parent: #414 (supersedes the frozen-branch plan of #325).

## Flow

- Staging is the source. It keeps moving until the **freeze point**.
- **Freeze point:** cut a release branch from staging at the freeze commit. Note the SHA in the cutover ticket. From here the branch is only a carrier: PR the release branch → `main` in the window.
- Nothing is cherry-picked *onto* the release branch as routine work. Staging feeds it once, at the freeze.
- Rehearsal (#336) runs on a `rehearsal/**` branch cut from the freeze commit, so the rehearsal and the cutover run the same bytes.
- Anything not in the freeze waits for the next release.

## Fixes during the window

- **Code:** release branch → prod (merge to `main`) → merge back to staging.
- **DB:** a migration file, applied to both staging and prod. Never raw SQL.

## Gates

- Freeze + rehearsal green **before 7pm**, or the window moves to the next evening.
- **10pm go/no-go.** Red = restore the dump, promote the previous Vercel deploy, unlock.

The step order, checks and rollback are in [production-cutover-runbook.md](production-cutover-runbook.md).

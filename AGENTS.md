## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `seansoriano13/t3ckgroup-erp`, managed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root, created lazily as needed. See `docs/agents/domain.md`.

### Database migrations

Name new migrations with a UTC timestamp prefix — `20260831143022_name.sql` — never the
next sequential number. Sequential numbering collides silently across branches: git
merges the two files without a conflict because their names differ, and Supabase then
applies only one of them. Existing numbered migrations keep their names; do not
renumber anything a ledger has already recorded. See `docs/adr/0007-timestamped-migration-filenames.md`.

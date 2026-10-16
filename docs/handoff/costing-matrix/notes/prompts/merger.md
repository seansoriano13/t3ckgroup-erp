# Merger: merge one ticket branch into integrate/costing-matrix

scratchpad = <repo>/docs/handoff/costing-matrix

Work ONLY in D:\Sean\t3ckgroup-erp-costing (branch integrate/costing-matrix). Never touch
D:\Sean\t3ckgroup-erp. Do not push. Never `git stash`, never `git reset --hard`.

1. `git status` must be clean. `git merge --no-ff costing/NNN -m "Merge #NNN (<ticket title>) into integrate/costing-matrix"`.
2. Resolve conflicts by keeping BOTH sides' intent. Expected hot spots:
   - `src/services/costingMatrixService.js`, `src/utils/costingMath.js`, `src/constants/costing.js`, the grid components in `src/components/costing/`, `src/test/stubs/costingMatrixRpc.js`: union of both sides' additions.
   - `src/components/costing/settings/CostingMatrixSettings.jsx`: one list holding every section either side added.
   - `supabase/schema/staging.sql`: keep both sides' added blocks, in migration-timestamp order.
   - Changelog: keep both entries; give the incoming entry the next free version number above the newest.
   - SQL migrations never conflict textually (distinct files), but two may each `CREATE OR REPLACE` the same function. If so, check the later-timestamp version also keeps what the earlier one added; if it doesn't, write the combined body into a NEW migration `<later timestamp + 5 min>_costing_merge_NNN.sql` (and mirror it in staging.sql) — never edit a migration that is already on integrate/costing-matrix.
   Read scratchpad/notes/DESIGN.md and the built-*.md notes if you need to know what a name means.
3. Verify:
   - `pnpm vitest run src/utils src/services src/constants src/components src/test/pages src/test/db` (or the repo's equivalent) — all green.
   - Lint the files the merge touched.
   - DB: take the lock exactly as DESIGN.md says (TICKET=merge-NNN), `pnpm db:reset`, run every costing policy file (78 and up) plus any policy file the ticket's report says it affects, release the lock. Known pre-existing failures: 56 and 61 (ipas_format_number).
   - The staging.sql drift check the repo uses (see notes/conventions.md).
4. If tests fail because of the merge, fix them in a follow-up commit `fix(costing): reconcile #NNN with …` (trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`). If a failure is the ticket's own bug and not trivial, stop and report it instead of rewriting the feature.
5. Report briefly: merge commit, conflicts and how you resolved them, test results, anything left broken.

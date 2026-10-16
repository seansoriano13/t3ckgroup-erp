# Rules for every Costing Matrix implementer

scratchpad = <repo>/docs/handoff/costing-matrix

- Work ONLY in your worktree D:\Sean\t3ckgroup-erp-cNNN (branch costing/NNN, packages installed). First run `git log --oneline -1` and confirm the base commit your prompt names; stop and report if it differs. Never touch D:\Sean\t3ckgroup-erp (the user's live checkout). Do not push. Never `git stash`.
- If your worktree already has uncommitted files from an interrupted earlier run, read them; reuse what is sound, overwrite what isn't.
- Read, in order: scratchpad/notes/DESIGN.md (binding, incl. the DB lock rule and "Corrections to the spec"); every scratchpad/notes/built-*.md (what earlier tickets built — extend through the registries, don't re-create); your ticket scratchpad/issue-NNN.md including its comments (amendments win over the body); the parts of scratchpad/spec266.md your prompt names; scratchpad/notes/INDEX.md for code facts as needed.
- Other tickets are being built in parallel in sibling worktrees. Stay in your scope.
- Update supabase/schema/staging.sql for your migration the same way #267/#268 did (drift check must pass). Keep src/constants/costing.js in step with the registries (policy 79 asserts they match).
- Changelog entry: take the next version after the newest in your worktree; the merge renumbers if needed.
- DB: take the lock (DESIGN.md) for every `pnpm db:reset` and policy run; release immediately after. Run 78, 79, your own policy file, and any existing file your change might affect. Known pre-existing failures to ignore: 56-ipas-raise and 61-ipas-signoffs (ipas_format_number permission).
- Run the unit/service/page tests you touch; lint your files (NestedShell.jsx has 3 old lint errors — ignore).
- Commit on your branch as `feat(costing): … (#NNN)` with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit as you finish meaningful parts (not only at the very end) so an interruption loses little.
- Report briefly: commit(s), new names later tickets extend, test results, decisions the orchestrator should know.

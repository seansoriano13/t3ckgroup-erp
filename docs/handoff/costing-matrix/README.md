# Costing Matrix (#266) — handoff

**Delete this whole `docs/handoff/costing-matrix/` folder before PR #539 is marked ready.**
It holds the build notes that lived only on the first machine.

Branch `integrate/costing-matrix`, draft PR https://github.com/seansoriano13/t3ckgroup-erp/pull/539
(base `staging`, closes #266–#274, #319, #320, #462, #463). Built with the
`/implement-spec-sonnet 266` skill: Sonnet implementers, one ticket per branch `costing/NNN`
in its own worktree, merged into `integrate/costing-matrix` one at a time.

## Where it stands (2026-10-16)

| Ticket | State |
|---|---|
| #267 Tender Lines, PMS tab, tiered access model | merged |
| #268 Components, bundles, Inclusions, cost-only rows | merged |
| #273 Purchase Requests from the matrix | merged |
| #270 Summary, Final Acquire, rates | merged |
| #269 Markup and achieved markup | merged |
| #271 Evaluation of Specification | merged |
| #320 Bid Decision | merged |
| #462 Open Costing Matrix (Stage Action) | **merged (4b671d62) but the merge was NOT verified** — the merger stopped on a usage limit before running vitest, lint and the policy tier |
| #272 Costing settled condition | not started (stopped while reading) |
| #274 Printed Costing Matrix | not started |
| #319 Closed Book audit | not started |
| #463 Costing priced condition | not started — needs #272 and #462 |

Then: `/code-review` on the branch, one fix pass, delete this folder, mark the PR ready,
remove the `costing/*` worktrees.

## How to continue

1. Verify the #462 merge on `integrate/costing-matrix`: `pnpm vitest run src/utils src/services src/constants src/components src/test/pages src/test/db`, lint the files #462 touched, then `pnpm db:reset` and policy files 22, 30, 38, 42, 50, 51, 78–85. Known pre-existing local failures: 56-ipas-raise, 61-ipas-signoffs (`ipas_format_number` permission).
2. Cut `costing/272`, `costing/274`, `costing/319` from the branch tip (each in its own worktree, `pnpm install`) and run an implementer on each, pointing at `notes/prompts/common.md` + `notes/prompts/NNN.md`. Then #463 once #272 is merged.
3. Merge each finished ticket with a merger agent using `notes/prompts/merger.md`.

## Files here

- `notes/DESIGN.md` — the binding decisions: scope, task graph, reserved migration timestamps and policy test numbers, the DB lock rule, the access model (tiers, registries, band trigger), corrections to the spec.
- `notes/built-NNN.md` — what each merged ticket built (names later tickets extend).
- `notes/prompts/` — the instructions for each remaining ticket, the shared rules (`common.md`) and the merger.
- `notes/INDEX.md` and the topic notes — the code map from the exploration pass.
- `spec266.md`, `issue-NNN.md` — copies of the spec and tickets with their amendment comments.

Path notes: the prompts say `<repo>/docs/handoff/costing-matrix` where they once named a
scratchpad folder; ticket worktrees were `D:\Sean\t3ckgroup-erp-cNNN` and the branch worktree
`D:\Sean\t3ckgroup-erp-costing` — use your own paths. The DB lock now lives in the git common
dir (`costing-db.lock`), so every worktree of the repo shares it and it is never committed.
`pnpm db:reset` fails at its seed step in a fresh worktree (no staging dump); migrations still
apply and the policy tier seeds its own data.

## Decisions taken along the way (for the review)

- Scope: #462 and #463 added (user-approved), so a matrix exists only once "Open Costing Matrix" runs — no matrix at registration, no backfill. #319 and #320 built in, per the #316 amendments.
- Finance access alone has no read tier. Finance may write Marketing/OPEX in the database, but only Final Acquire list members see those fields on screen.
- The markup factor and presets belong to the Final Acquire list (management band). A Super Admin off the list sees the factor but cannot change it.
- Purchasing (cost tier) reads ABC but never Final Offer.
- The Purchase Request card now lives only on the PMS tab — someone on a request with no costing tier loses sight of it.
- An evaluation-task member can write Compliance, but reads the matrix only while their Stage Participant window is open.
- The "Open Costing Matrix" config modal's preset picker is empty for anyone not a Super Admin or on the Final Acquire list.
- The evaluation template is kept in its own table (`costing_evaluation_settings`), not on `costing_settings`.
- #271's commits carry a "Claude Sonnet 5.5" co-author trailer; the rest say "Claude Opus 5.5".

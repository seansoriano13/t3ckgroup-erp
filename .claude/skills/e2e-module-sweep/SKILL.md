---
name: e2e-module-sweep
description: Pick a random app module that has not been E2E-tested recently (checked from git history), test it end to end with playwright-cli on staging, log the bugs in a docs tracker, then file a GitHub spec with sub-issues. Use when the user asks to "run an e2e sweep", "test a random module", "find bugs in a module we have not checked", or "next module".
---

# E2E module sweep

One sweep = one module, tested end to end, bugs in a tracker, tracker turned into a GitHub spec and tickets. The first pass (Activity scheduling, spec #1083) is the model: `docs/activity-scheduling-e2e-tracker-2026-11-19.md`.

## 1. Pick the module

```bash
node .claude/skills/e2e-module-sweep/pick-module.mjs          # random pick, skips modules swept in the last 45 days
node .claude/skills/e2e-module-sweep/pick-module.mjs --list   # which are free / skipped, and why
```

Options: `--days N` (window), `--module <id>` (user chose one), `--seed N`, `--no-fetch`.

"Swept" means an `*e2e*tracker*` doc or an e2e/playwright commit subject in git history (all branches) that matches the module's keywords. Modules never swept are picked first. Tell the user the pick and what was skipped, in one or two lines. If they do not like it, run again or use `--module`. Add new modules to the `MODULES` list in the script when the app grows.

## 2. Learn the module

- Read the module's terms in `CONTEXT.md` (use its words in the tracker) and any ADR it touches.
- Read the picked `paths` for the rules: who may do what, status flow, validation. Write down the rules you will test, and the places the code looks wrong; the browser run proves or kills each one.

## 3. Test on staging with playwright-cli

Staging, logins and cleanup rules: memory notes `staging-e2e-playwright` and `playwright-cli-setup`. Logins are in `docs/mock-employees.md` (`<login>@staging` / `staging`). Skill: `playwright-cli`.

- One named session per person: `playwright-cli -s=<name> open <url>`. Pick people that cover each role the module has (employee, head, HR, Super Admin, a person with no access).
- Use `run-code --filename=x.js` for multi-step flows; keep reusable scripts in `scratch/<module>-e2e-<date>/` (git ignores `scratch/`).
- Cover, in this order: the happy path end to end; every status change; validation limits (empty, whitespace, very long, huge or past dates, bad formats); clash and duplicate rules; role gates; the same flow at phone width (390); console errors and failed requests (`playwright-cli console`, `requests`).
- Probe the API as each person: `localStorage['t3ckgroup-auth-session']` holds the token. Try to do what that person must not be allowed to do, and look for the server refusing it. A refusal is a pass; write it under "What held up".
- Test data is titled "E2E TEST ... safe to delete" and uses only "(staging)" mock people. Cancel or delete everything you made, revert any Settings change, run `playwright-cli close-all` at the end.
- Every claim in the tracker needs evidence: a screenshot, the text read from the page, a request count, or a status read back. If you only saw it in code, say "code" and do not call it confirmed.

## 4. Write the tracker

`docs/<module>-e2e-tracker-<YYYY-MM-DD>.md`, same shape as the earlier trackers: header (what was run, on which commit, how), "Not covered", environment notes, severity key, a summary table that adds up, tables per area with ID / Sev / Finding / Evidence / Suggested fix / Ticket, "What held up", watch list, "Decisions made for this spec". P1 fix before release, P2 next pass, P3 polish. Short sentences, everyday words (CLAUDE.md). The file name must contain `e2e` and `tracker`: the picker reads it next time.

## 5. File the spec and tickets

The user's request to sweep covers publishing the issues. Label `ready-for-agent`.

- Group findings into tickets that each deliver a working slice (see `to-tickets`), with blocking edges only where two tickets change the same code.
- Spec issue first (template in `to-spec`: Problem Statement, Solution, User Stories, Implementation Decisions with a Task graph table, Testing Decisions, Out of Scope, Further Notes). Then one issue per ticket with `## Parent`, `## What to build`, `Tracker: <path>`, `## Acceptance criteria`, `## Blocked by`. Then edit the spec to add the Task graph and put real issue numbers in the tracker's Ticket column.
- Write bodies to files and use `gh issue create --body-file` (heredocs with apostrophes break in this shell). A small `.mjs` that creates the tickets in order and writes `numbers.json` works well.

## 6. Commit and PR

New branch from `origin/staging`, commit the tracker only (plus any skill or `.gitignore` change), PR into `staging` with the `pr` skill template. No app code in a sweep PR. Never merge it yourself.

## Report

Say the module, the counts (P1/P2/P3), the worst three findings, the spec and PR links, and what was not covered. Keep it short.

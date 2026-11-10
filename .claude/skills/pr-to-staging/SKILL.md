---
name: pr-to-staging
description: Take one task from code to staging through a pull request. Implements the change on its own branch, tests it, opens a PR into staging, checks CI, merges when green, then pulls staging into the local checkout. Use this whenever the user asks to "ship this to staging", "do the PR flow", "implement, test, PR and merge", or pastes the same implement-test-PR-merge steps again. Stops and reports on any failure instead of guessing. Does not touch main or prod; use the ship skill for that.
disable-model-invocation: true
---

# PR to staging

Move one task from idea to staging with a pull request. Every step has a stop rule. When a stop rule hits, stop, say what happened, and ask. Never guess your way past a failure.

Why a branch and a PR: staging is shared, and CI runs on the PR before anything lands there. Skipping either one removes the safety net.

## Ground rules

- The user edits the main checkout (`D:\Sean\t3ckgroup-erp`) live. Never `git add` files you did not change for this task, never `git reset --hard`, never `git stash`, never `git checkout --` on that checkout.
- Do the work in a separate worktree branched from `origin/staging`, so the live checkout keeps its unsaved edits. Create it with `git worktree add <path> -b <branch> origin/staging` after `git fetch origin`. Name the branch `<short-task-name>`, lowercase with hyphens.
- Add `[skip ci]` to a commit message only when the user asks for it.
- Never enable auto-merge. Merge only when CI is green.

## 1. Implement

Confirm the task with the user if the request is vague. Then make the change inside the worktree. Keep the change to what the task needs. Commit with a clear message and end it with:

`Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`

Stage only the files you changed, by name.

## 2. Test

Run the repo's local gate inside the worktree: `pnpm preflight --strict`. Run any test file the task touched too. If a test fails, fix it only when the fix is part of the task. If it still fails, stop and report the output.

Stop rule: if the local gate fails for reasons outside this task, stop. Do not fix unrelated code.

## 3. Push and open the PR

Push the branch: `git push -u origin <branch>`.

Open the PR into staging:

`gh pr create --base staging --head <branch> --title "<title>" --body "<summary and test notes>"`

End the PR body with:

`🤖 Generated with [Claude Code](https://claude.com/claude-code)`

After the PR opens, use the PR tools to bind and watch it: call `get_status`, and if it does not report this PR, call `bind_pr`.

## 4. Check CI

Do not poll or loop on CI yourself. Check it once with `gh pr checks <pr-number> --watch` only if the user is waiting, or rely on the desktop app's CI events. When a CI event arrives, read the result again.

- **All green**: go to step 5.
- **Any red**: stop. Report which check failed and the key error lines. Do not auto-fix or re-run without the user's go-ahead.

## 5. Merge to staging

Only after CI is green and no merge conflict is shown:

`gh pr merge <pr-number> --squash --delete-branch`

Then confirm the merge with `gh pr view <pr-number> --json state,mergedAt`. It should say `MERGED`.

Stop rule: if the merge is blocked by a conflict, stop and report. Do not resolve it without the user.

## 6. Pull staging locally

Update the live checkout. Do this only after checking that it is safe:

1. Run `git status` and `git rev-list --left-right --count origin/staging...staging` in `D:\Sean\t3ckgroup-erp` after `git fetch origin`.
2. If the local `staging` branch has commits that `origin/staging` lacks (the second number is above zero), stop. Report that the local branch has diverged, and ask the user how to proceed. Never reset it.
3. If the live checkout has uncommitted changes to files the pull would touch, stop and tell the user. Do not stash or discard them.
4. Otherwise run `git pull --ff-only origin staging` in that checkout. If it is not a fast-forward, stop and report.

Then say what changed: the new commit and the files it touched.

## Final report

Use short full sentences. Say:

- the PR link,
- what CI showed,
- whether the merge happened,
- whether the local pull happened, or what stopped it,
- anything left for the user to check on staging.

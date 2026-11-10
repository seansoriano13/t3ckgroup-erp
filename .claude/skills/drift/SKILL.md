---
name: drift
description: Visualize branch drift - who is ahead/behind between main (prod), staging and the top few local branches/worktrees (unmerged first). Use when the user asks for drift, "status of branches", ahead/behind, or whether prod and staging diverged.
---

Run `bash .claude/skills/drift/drift.sh [N] [--no-fetch]` (N = branches shown, default 3). Fetches first unless `--no-fetch`.

Output: prod-only commits (main not on staging), then bars per ref vs `origin/staging` (`<` behind, `>` ahead), worktree path + dirty count, up to 3 unmerged commits per branch.

Report as-is, concisely: highlight (1) any prod-only commit, (2) local main/staging out of sync with origin, (3) dirty worktrees. Ahead counts can overstate when branches were squash-merged; say so if a branch looks merged by subject. Read-only: never merge/reset from this skill.

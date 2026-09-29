# Release notes template

For the agent writing the one curated prod `changelog.json` entry. What's New shows only the top entry, so prod users see just this one.

## Steps

1. **Source:** `git log --oneline <last-prod-deploy-sha>..HEAD` (last prod deploy = the `main` commit currently live). Skim PR/issue titles for detail.
2. **Skip** staging-only entries (`"env": "staging"`) and internal work (tests, refactors, tooling, docs).
3. **Audience:** end users (sales, procurement, HR staff), not developers.
4. **Write:** plain words, short sentences, what changed for them. No ticket numbers, file names, jargon.
5. **Group by area** (e.g. SORs, Tasks, Sales, Settings). One bullet per change; lead with the area name.
6. **Add** on top of `src/data/changelog.json` (no `env` field), via `node scripts/add-changelog.mjs`. Bump the version. Title: short, names the release theme.

## Shape

```json
{
  "date": "YYYY-MM-DD",
  "title": "Release theme",
  "version": "x.y.z",
  "changes": [
    "SORs: what users can now do.",
    "Tasks: what got fixed or easier."
  ]
}
```

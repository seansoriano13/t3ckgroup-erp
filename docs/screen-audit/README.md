# Screen-fit audit

`pnpm audit:screens` (`scripts/screen-audit.mjs`) opens every screen of the app at six screen sizes, saves a screenshot of each and measures how well it fits. It is the check for the screen-fit spec: each ticket pastes its `--compare` output in the PR.

| Size | CSS pixels | Stands for |
|---|---|---|
| phone | 390 × 844 | most phones in portrait |
| tablet | 820 × 1180 | iPad Air portrait |
| laptopS | 1280 × 600 | 1920×1080 at 150% scaling, or 1600×900 at 125%, after browser bars |
| laptopM | 1366 × 650 | 1366×768 at 100% |
| laptopL | 1536 × 730 | 1920×1080 at 125% |
| desktop | 1920 × 950 | the baseline the app was designed at |

## Run it

```
supabase start            # local stack, seeded (docs/local-development.md)
pnpm seed:mock:local      # the mock logins; the audit signs in as 101@local (Super Admin)
pnpm dev
pnpm audit:screens                                   # every screen, every size (slow: about an hour)
pnpm audit:screens --screens "^(ipas-list|ipas-record)$" --sizes "phone|laptopS"
pnpm audit:screens --compare docs/screen-audit/baseline-2026-11-12.json
```

It runs against the local app only and takes sample record ids from the local database. Screenshots and `metrics.json` go to `scratch/screen-audit/` (gitignored). It uses the installed Chrome, because the bundled Chromium crashes on the app's blurred dialog backdrops. If Chrome is missing it falls back to `pnpm exec playwright install chromium`.

## What it measures

- `pageBodyTop`: how far down the screen the page body starts. This is the space the header, tabs and toolbar take.
- `dialogs[].fitsH` / `fitsW`: every open dialog fits inside the screen.
- `docOverflowX`: sideways scroll of the whole page (must stay 0).
- `sideScrollers`: boxes that scroll sideways inside the page, usually tables.
- `smallTargets`: buttons and links under 24px in the visible area.
- `loading`: the page still said "Loading" after 45 seconds. Treat that shot as missing, not as a finding.

`baseline-2026-11-12.json` is the state of `staging` at `e7813949`, before the screen-fit work.

# ADR 0030 — Release Notes is a self-serve page for everyone, built only from Sample Data

## Status

Accepted 2026-09-30, from the release-notes grilling session. Supersedes
ADR 0022.

## Context

ADR 0022 built Release Notes as a Super-Admin deck for a TV: one presenter,
keyboard-driven, a generator merging `changelog.json`, a hand-written gap
file and a `gh` issue snapshot into `presentation.json`, a roadmap with
`done / total` counts, and (by amendment) two slides that opened a real
seeded demo SOR.

The deck was never presented. The next release goes to every employee after
a maintenance window, and they are told to go and look at Release Notes
themselves. That changes every premise:

- The reader is any employee, alone, on their own screen or phone, skimming
  for the screens they use — not a room following a presenter.
- The page is read on prod. A live demo SOR would mean seeding a demo flow,
  demo accounts and SORs into prod data, visible in registers and counts.
- Employees do not read ticket numbers or epic fractions; "what is coming"
  is a handful of plain-language items.
- The copy is written per screen, not reused from changelog entries, so the
  generator's merge has nothing left to do.

## Decision

- **Everyone can open it.** It lives at `/release-notes`, open to every
  signed-in employee. Every change is shown to everyone, with a chip saying
  who uses it; admin-only screens are grouped last rather than filtered out.
- **A page grouped by screen, not a deck.** One level-1 tab per section
  (SORs, Tasks, Approvals & Leaves, Retail, Commission, Everywhere, For
  admins, Coming next), scrolled top to bottom; `?tab=` links to one. Tabs
  rather than a side nav because no Page has a left sidebar (ADR 0029), and
  because only the open section's samples mount.
- **Only Sample Data.** Each change is the app's real component rendered in
  its own pre-filled query cache with saving switched off. Nothing on the
  page reads or writes a live record — the ADR 0022 amendment's demo SOR is
  gone, and `seed-release-demo.mjs` with it. Sample Data uses fictional
  people and obviously round figures, and every screen is tagged as sample
  data, so no one reads a sample figure as a colleague's real number.
- **One hand-written content module is the only source.** No generator, no
  `presentation.json`, no `gh`, no `--check`. `changelog.json` is still
  never written by this feature.
- **"Coming next" replaces the roadmap**: a few plain-language items, each
  with its prototype preview where one exists. No ticket numbers, no counts.
- **The What's new popup points here.** The release gets one changelog entry
  whose button opens Release Notes; the individual changes are not
  backfilled into `changelog.json`.

## Consequences

The page cannot fail or leak for a reason outside the repository, and
nothing on it touches prod data. The ADR 0022 rule of no measured impact
still holds.

Copy goes stale when a screen changes after the fact, and there is no
generator to notice: a real component fed Sample Data renders the *current*
screen, so a description written against an older one will contradict its
own sample. Checking the page in a browser is part of changing a screen that
has an entry.

A reader cannot click through a real Stage move. That is the price of
keeping prod clean.

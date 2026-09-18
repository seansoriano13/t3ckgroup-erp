# ADR 0022 — The Release Notes surface carries no runtime data of its own

## Status

Accepted 2026-09-16, from the presentation grilling session. Applies to
`/super-admin/release-notes`, the Super-Admin surface for walking someone
through what shipped in a date window.

## Context

The surface has to answer three questions on a TV, driven from a keyboard:
what shipped since a given date, what each change replaced, and what is left
on the roadmap before the ERP changes close.

Each of those has an obvious live source. The change list overlaps
`src/data/changelog.json`, which the `ChangelogModal` already reads. The
roadmap is 75 open GitHub issues, and `gh issue list` returns them in a
second. Scale and recognition would come from the database — 45 employees,
135 live SORs, 40 Stages across 4 Sale Types, all real work, since staging
stopped being a refreshable mirror (ADR 0010).

Wiring any of them in at runtime costs something. GitHub from the browser
needs a token in the client. Supabase queries add load to a project whose
budget is already watched, for a page that is opened a handful of times.
And a surface that reads live data fails live: a rate limit or a slow query
in front of an audience is unrecoverable, and a roadmap that shifts between
rehearsal and presentation is worse than a stale one.

Reading `changelog.json` directly was the cheaper option, and was the first
plan. It broke on a gap: eight capabilities shipped after v1.7.17 — Stage
Fields (#203), Stage Automation (#204), the CRM rename and board (#206), the
stock badges (#202), Group Task Tags (#205) — with no entry, and backfilling
them would fire a "what's new" popup at every employee for a presentation
that is not for them.

## Decision

**Everything the surface renders is baked at build time into one committed
file. The page makes no network call of its own.**

- `scripts/build-presentation.mjs` reads `changelog.json` from a `since`
  date, pulls the issue snapshot through `gh`, merges a hand-authored file
  covering the gaps and the before/after demos, and writes
  `src/data/presentation.json`. The page reads only that.
- The generator is the only writer. There is no second change list kept by
  hand: the hand-authored input covers what `changelog.json` does not, and
  its entries are deleted if those capabilities ever get real entries.
- `changelog.json` is never written by this feature. No version bump, no
  popup, no rewriting of entries employees have already seen. Where
  published copy breaks the glossary — v1.7.15 and #190 say "deals", which
  CONTEXT.md forbids for an SOR — the generator corrects it in its output
  and leaves the source alone.
- **No measured impact.** Nothing on the surface claims a percentage, a time
  saved, a rate, or any figure drawn from business data: the impact of a
  change is stated as who it helps and what it replaces. Counts of the deck's
  own contents are not impact claims and are allowed — the fixes card says how
  many fixes it lists, and an epic shows its own `done / total` — because a
  fraction the audience can falsify in thirty seconds is what makes the
  roadmap honest.
- The prototype HTML is served as static files and framed. The
  `.prototype.html` files are cherry-picked from the prototype branches, not
  merged, and depend on nothing in the app.

The only database read is the Super-Admin role check the router already
performs for every `/super-admin/*` route.

## Consequences

The page cannot go stale on its own, and it cannot fail in front of an
audience for a reason outside the repository. The snapshot is reproducible:
the presentation given on any date can be regenerated from that commit.

It does go stale between runs. A ticket closed after the last generation
still shows open, so the generator is re-run before presenting, and the
generated file carries its own timestamp so the gap is visible rather than
assumed.

A future reader finding a committed issues snapshot in `src/data` will
reasonably ask why it is not fetched. This is the answer.

Making the surface live later means reversing all of it — a client token,
query budget, and loading and failure states the deck does not currently
need. That is the cost being accepted.

# ADR 0020 — Flow Snapshot version numbers carry compatibility

## Status
Accepted

## Context

A Flow Snapshot's `version` has always been a bare, incrementing integer
(#83). v4 might be a typo fix to a Stage's label, or it might have removed
half the flow and stranded every SOR sitting on a dropped Stage. Nothing in
the number told anyone which. Issue #36's user stories and #185's problem
statement both name the consequence: a salesperson can't tell whether their
SOR's version could safely be moved onto a newer one, and an Operations
Manager publishing a routine tidy-up has no way to say so.

## Decision

**A version is `major.minor`.** `flow_snapshots.version` stays the major
number; a new `version_minor` column carries the minor. One SQL function,
`flow_snapshot_next_version`, holds the whole rule and is the only thing that
decides which part moves:

- **First publish** of a Sales Flow → `1.0`.
- **Any Stage id present in the latest version is missing from the new one, or
  the Won Stage changed** → next major, minor `0`.
- **Anything else** → same major, minor `+ 1`.

`lock_sales_flow` calls this function inside its own transaction (#181, ADR
0013) and writes both numbers with the snapshot, so a publish can never
disagree with itself. The canvas's Publish button calls the same function
through a read-only preview (`previewVersion`) before the click, so "Publish
v3.2" is never a guess the actual publish might contradict.

### Why a Won Stage change is major, on the same footing as a removed Stage

A removed Stage can strand a deal outright — its `flow_stage_id` foreign key
would have nothing to point at. Changing the Won Stage cannot strand a deal
that way, but it moves *when* a deal becomes Realized (reaching the Won Stage
is what stamps Contract Date). A deal already sitting past the old Won Stage
and short of the new one would silently change which side of "booked" it is
on if it were simply moved onto the new version. That is exactly the kind of
change #185's "every SOR on a 3.x version can safely be moved to any later
3.x" promise cannot cover, so it is treated as seriously as losing a Stage
outright: a new major.

### Why this stays honest: Restore keeps ids

The rule is entirely a comparison of Stage **ids** between two snapshots — not
names, not counts. That comparison is only meaningful because #187 made
Restore keep every id across a restore into the draft (updating rows in place
rather than deleting and rebuilding). Before #187, restoring a Snapshot handed
every Stage a new id, so the very next publish would have looked, to this
rule, exactly like every Stage being removed and a different set added —
always major, even when the restored shape was identical to a version that
had already shipped. Compatibility numbering and id-preserving Restore are one
decision: the second is what makes the first mean anything.

### Why the database, not the client

The same reasoning as `lock_sales_flow` (#181, ADR 0013): the canvas is one of
several places a version number is read (the SOR's badge, the version page,
the history dialog, per-deal history notes) and the one place it is decided
has to be a single, un-bypassable rule. A client-computed preview that could
drift from a client-computed publish would reintroduce the exact "which
number is trustworthy" problem this ADR exists to close.

## Consequences

- Existing rows, locked before this migration, read as `N.0` — `version_minor`
  defaults to `0`, so nothing already on the record needs to change and no
  history note needs rewriting.
- Two Stages swapping names in the same publish is still a minor change under
  this rule (ids unchanged, no Stage removed), which matches how #187's
  Restore treats the same case.
- A Stage removed and then re-added *with a new id* reads as major — id reuse
  is not name reuse. Re-adding it with its *original* id (e.g. via Restore)
  reads as minor, because the id, not the name, is what the rule and the
  foreign keys both key off.
- Uniqueness moves from `(flow_id, version)` to `(flow_id, version, version_minor)`,
  preserving the guarantee that two simultaneous publishes cannot collide —
  they now collide on the full pair instead of the major alone.

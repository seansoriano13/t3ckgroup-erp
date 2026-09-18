# Pipeline per Deal Type

## Status

**Superseded 2026-08-27 by [ADR 0006](./0006-sales-flow-as-a-graph.md).** Its container survives — a deal
carries a type and the type owns a flow — but the axis is renamed **Sale Type**,
its values are configured by Operations rather than fixed at Bidding/Outright,
and the flow is a graph rather than an ordered list. Read below as history.

Accepted 2026-08-24. **Challenged and re-affirmed 2026-08-25** with one
constraint added.

The re-rendered transcript has the boss saying plainly *"ayoko namang ihiwalay
yung private saka yung government"* — I don't want private and government
separated (C15). Resolved the same way D4 settled the SOR/CRM split: his
objection is to seeing two separate **registers**, not to the data model.

**Added constraint: two pipelines underneath, one unified register on top.**
The SOR register and board list deals from every pipeline together; nothing in
the UI presents Bidding and Outright as separate places to go. A deal's
pipeline governs which stages it can occupy, never which screen it appears on.

## Context

The SOR pipeline has always been a single ordered list: `PIPELINE_STAGE_SEED`
in `src/constants/sor.js`, seeded into `crm_pipeline_stages` by migration 0033.
Deal-shape variation was expressed as flags on that one list — most recently
`is_itb_gate` on `For Bidding` (0036) and the `itb_exempt` escape hatch on the
opportunity itself (0038), which lets a deal declare "outright, no bidding
required" and walk past the gate.

The 2026-08-24 operations-head meeting established that the business runs **two
different commercial processes**, not one process with an occasional exemption:

- **Bidding** — government projects. Invitation to Bid, Post-Qualification,
  Notice of Award, Performance Bond, Contract Agreement, Notice to Proceed.
- **Outright** — dealer purchases. A different process, **not yet documented**;
  the operations side could not describe it fully in that meeting.

`itb_exempt` was built on the premise that Outright is *Bidding minus a check*.
That premise is now known to be wrong, and it is the kind of wrong that
compounds: each newly discovered divergence becomes another boolean, until the
stage a deal is in tells you nothing without reading five flags alongside it.

## Decision

An SOR carries a **Deal Type**. Each Deal Type owns its own **Pipeline** — an
ordered stage list. `crm_pipeline_stages` gains a pipeline discriminator, and
every stage helper in `src/constants/sor.js` takes the deal's pipeline as its
stage list rather than the global seed.

The Bidding pipeline is seeded from today's list. **The Outright pipeline is
created empty** and populated as data once that process is actually known. The
deliverable is the container, not the content — building a guessed Outright
stage list would be inventing policy that nobody in the meeting could state.

Deal Type is orthogonal to **Project Type** (SSP / CP / Strategic). Project
Type selects a commission split; Deal Type selects a pipeline. Neither implies
the other.

Constraints that survive unchanged, per-pipeline:

- Each pipeline has exactly one Anchor Stage, and the locked region
  (`isOpenRegionStage`) is still everything from that anchor onward.
- Realized-vs-Projected is still derived from position relative to that
  pipeline's own anchor, never stored and never a per-stage toggle.

## Alternatives considered

**One list, divergence as flags** — the status quo. Cheapest today and
increasingly illegible: the exemption set grows monotonically, every flag
interacts with every other, and the Outright process is never actually
*visible* anywhere as a process. Rejected because the first flag is already in
production and the second was already being reached for.

**One list, stages marked as applicable to a subset of deal types** — a
`applies_to` array on each stage. Avoids a second list, but produces a stage
ordering that is only valid after filtering, which means `sort_order`
comparisons — the mechanism the anchor and the locked region are built on —
stop meaning anything on their own. Rejected: it breaks the load-bearing
invariant to save a join.

**Two separate opportunity tables** — full separation. Rejected for the same
reason the SOR/CRM split was rejected: one commercial reality should not have
two identities, and the commission engine would have to be written twice.

## Consequences

- Every consumer of the stage list becomes pipeline-scoped. The helpers in
  `src/constants/sor.js` already accept a `stages` argument for exactly this
  reason, so most call sites change what they pass, not what they do.
- `itb_exempt` retires into its true meaning: Outright is a pipeline with no
  ITB stage. Existing rows carrying the flag need a Deal Type backfill — see
  the redesign doc's open question on migration.
- Changing a deal's Deal Type mid-flight means moving it between stage lists,
  which may have no equivalent stage on the other side. This needs a rule and
  does not have one yet.
- Reversing this is expensive: collapsing back to a single list means
  reconciling two divergent orderings, and by then they will have diverged on
  purpose.

## References

- [docs/crm-pipeline-redesign.md](../crm-pipeline-redesign.md) — D1, and the
  contradiction C6 that produced it.
- `supabase/migrations/0033_crm_pipeline_stages.sql` — the single-list schema
  this supersedes.
- `supabase/migrations/0038_itb_outright_exemption.sql` — the flag this retires.

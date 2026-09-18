# Sales Flow as a Graph, and Realized Redefined

## Status

Accepted 2026-08-27. **Supersedes [ADR 0004](./0004-pipeline-per-deal-type.md).**

Also deprecates [docs/crm-pipeline-redesign.md](../crm-pipeline-redesign.md) as
an authority. That document is retained as history; its decision log (D1–D44)
records reasoning worth reading and no longer settles anything.

## Context

Every attempt to pin down the CRM process has produced prose and another round
of questions. The Operations Manager holds the real process — including the
edge cases nobody else knows — and no artefact has ever let her manipulate it
directly. The Flow Canvas (issue #36) is the response: she builds Sales Flows
as objects, watches them run against Scratch SORs, and the result is locked.

That decision forces a structural one. Two things about the current model
cannot survive contact with a flow she draws herself.

**The pipeline is a totally ordered list.** Stages carry `sort_order`, and
every load-bearing question is answered by comparing it: which Stages a move
crosses is the half-open interval `[from, to)`; whether a deal is booked money
is `sort_order >= anchor.sort_order`; which region a super admin may edit is
everything before the anchor. ADR 0004 rejected an alternative *specifically*
because it would have broken these comparisons.

**The process is not a line.** Deals are re-opened, fast-tracked, and routed
down side paths — this is what the Operations Manager means when she says the
edge cases are what is killing her. A tool that can only draw a line cannot
record the process it exists to record.

The positional definition is also already known to be wrong at the edges. A
deal that moves backward out of the booked region is currently a special case,
because its position stops answering a question its history already answered.

Commission is fenced this cycle by the Boss's explicit instruction, which makes
any change here expensive to justify rather than free.

## Decision

**A Sales Flow is a directed graph.** Permitted moves are explicit edges the
Operations Manager draws. Loops, skips and branches are all expressible.
Stages are private to their flow — two flows may each contain a Stage named
"Proposal Submitted" and they are unrelated objects.

Two consequences follow, and both are the point rather than side effects.

**A move traverses exactly one edge.** There is no canonical path between two
arbitrary Stages in a graph, so the crossed-Stages interval has no meaning. A
move evaluates the Stage being left and nothing else. This removes the reason
the interval existed rather than replacing it with something more complex.

**Realized is redefined from position to fact.** An SOR counts as booked money
once it **has a Contract Date** — already stamped the first time it reaches the
Won Stage, already never un-stamped. Every flow must designate exactly one Won
Stage, and cannot be locked without one.

**This single predicate is the only commission behaviour that changes.** Rate
selection, Commissionable Revenue, splits, the Pool, the Dashboard and Privacy
Masking are all untouched.

## Alternatives considered

**Ordered spine with optional Stages and forward skips.** Keeps `sort_order`
total, keeps every positional comparison, changes nothing in commission.
Rejected because it cannot express a loop, and re-opened deals are among the
cases the Operations Manager most needs to record. It also preserves the
backward-move special case rather than dissolving it.

**Graph for drawing, ordered list for execution.** Draw freely, flatten to a
line before it runs. Rejected: the flattening is lossy in exactly the places
the drawing was expressive, so the Operations Manager would sign off on a shape
the system does not implement — the "agreed on behaviour nobody observed"
failure this whole project exists to eliminate.

**Graph, with Realized left positional and computed over a topological sort.**
Avoids touching commission at all. Rejected: a graph with a cycle has no
topological order, so the rule is undefined precisely where the graph earns its
keep, and it would fail silently — a dashboard quietly short, with no error.

## Consequences

- **Cross-flow reporting needs an explicit mapping.** "All SORs at Proposal
  Submitted" spans two unrelated objects once two flows both have one. This is
  a real cost and it is the reason private Stages were chosen anyway: the
  alternative is a shared Stage library where editing one flow silently alters
  another, and every exception becomes a conditional on a shared object. A
  reporting problem is cheaper than a coupling problem.
- **The stage-list helpers become flow-scoped.** They already accept a stage
  list as an argument, so most call sites change what they pass rather than
  what they do — but the ones comparing `sort_order` need rewriting against
  edges instead.
- **The backward-move special case can be retired.** Its cause was the
  positional rule; the fact-based rule answers correctly without it.
- **`project_type` (SSP / CP / Strategic) must be renamed.** It means
  Commission Split, and beside a configurable Sale Type it will be misread
  within a month. A rename only — no behaviour changes.
- **Reversing this is expensive.** Collapsing a graph back to a line means
  discarding edges drawn deliberately, and by then the flows will encode
  branches the business actually runs.

## References

- [Issue #36](https://github.com/seansoriano13/t3ckgroup-erp/issues/36) — the
  Flow Canvas spec this decision serves.
- [ADR 0004](./0004-pipeline-per-deal-type.md) — superseded. Its container
  survives (a deal carries a type, the type owns a flow); its content does not.
- `CONTEXT.md` — Sale Type, Sales Flow, Won Stage, Realized.

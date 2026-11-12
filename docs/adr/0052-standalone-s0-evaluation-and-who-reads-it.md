# ADR 0052 — A standalone S0 Evaluation, and who reads it

## Status

Accepted 2026-12-03, from spec #955 (decision 7, ticket #966).

## Context

An S0 Evaluation had to belong to a SOR: `costing_matrices.opportunity_id` was not
null and unique, and who may read it was worked out from the SOR
(`costing_tier(p_opportunity_id)`). The sheet only ever needs an S0, and the team
wants to use the evaluation as a tool first and tie it to a SOR later, the way an
IPAS starts from a PO.

Nearly every costing policy and function reaches the tier the same way: row, then
its matrix, then `costing_matrix_opp(matrix)`, then `costing_tier(that id)`.

## Decision

- **An evaluation can start from just an S0 number, and stays one per S0.**
  `opportunity_id` may be null; the matrix then names its S0 in `s0_number`. A
  unique rule on the S0 holds one evaluation per S0, and starting one for an S0 that
  already has an evaluation (standalone, or on a SOR that carries the S0) opens that
  one instead of making a second.
- **The costing layer is keyed by a subject id: the SOR's id, or the matrix's own id
  while it stands alone.** `costing_matrix_opp(matrix)` returns that subject, so
  every policy and function that already goes matrix, subject, `costing_tier` keeps
  working without being rewritten. Functions that need the SOR's own data (landed
  cost, stage conditions, the SOR's summary) find nothing for a standalone subject
  and are skipped, not broken.
- **Readers of a standalone evaluation**, decided by `costing_standalone_tier`, first
  match wins (one person gets one tier):
  - Super Admin or the decider list: `closed_book`, everything.
  - The person who started it and the named Sales incharge: `price`.
  - The named PMS incharge and anyone with Purchasing access: `cost`.
  - The named Technical in-charge and the Evaluation list: `participant`. A Go waits
    for the Technical verdict and its approval, so they must be able to open the
    evaluation, as they can on a SOR.
  Anyone else gets nothing. The same column registries decide which figures each tier
  gets; nothing new is registered per reader.
- **Writing follows the same bands.** Sales band: the starter and the Sales incharge.
  Purchasing band: Purchasing access and the PMS incharge. The list bands are
  unchanged. The PMS incharge may be anyone (the SOR's Purchasing-access rule for the
  Purchasing incharge does not apply here), and so may the Sales incharge (no Deal
  Team to check).
- **Changing the incharges** is `costing_standalone_set_incharge`: the starter, the
  Sales incharge, the decider list and Super Admins. Both names are always set.
- **Linking to a SOR** is `costing_standalone_link`: only to a SOR with no evaluation
  and not on a different S0, by someone who can read the standalone on the price or
  closed-book side and may open that SOR's evaluation. It sets `opportunity_id`.
  From then on the matrix id is no longer a subject, the standalone readers stop
  applying, and the SOR's rules decide. The SOR's own products join the lines already
  there, matched by Odoo line then Odoo product, never by name.
- **Who may start one** is the people who reach the S0 Evaluation page: Super Admins,
  the decider list, Purchasing and any Deal Team member.

## Consequences

- Someone who is both the starter and has Purchasing access reads the price side
  only. To read both, they join the decider list.
- The SOR-bound read path is unchanged for every existing caller; the first branch of
  `costing_tier` is the only addition on that path.
- The S0 Evaluation page opens to anyone named on a standalone evaluation, listing
  only what they read; the SOR rows stay the Closed Book's.
- Bid decisions waiting on a standalone evaluation do not appear in the SOR-based
  pending list; the evaluation is decided inside its own window.

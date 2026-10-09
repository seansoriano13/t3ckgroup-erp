# Purchasing's one-per-SOR tools mount on Sales Flow stages

**Status:** accepted (2026-10-05)

Purchasing's tools that exist once per SOR, which are the **Purchase Request**,
the **Costing Matrix** and a **Packing List request**, mount on Sales Flow
stages as Stage Actions, the way group and individual tasks do. Operations
decides per flow where each opens, who it calls in and what it defaults.
Purchasing's per-PO and per-slip records (**IPAS**, **Transmittal**) and its
per-Component **Canvass** never mount. They reach the flow only through Stage
Conditions that read them: Costing priced, Costing settled, Purchasing settled,
Goods checked and Orders filed.

This amends ADR 0023's consequence that "purchasing gets no Stage Actions". The
rest of 0023 stands: purchasing has no flow of its own, and nothing stores a
"current purchasing stage".

## Why

Comparing the specs with the Government flow running on production
(2026-10-05) showed Operations had already put purchasing onto the Sales Flow
with the tools it had. It added a "PMS Sourcing GS" stage that required a
Google Sheet link, an Evaluation of Specification group task at SO Evaluation,
and a "PMS" group task at NTP. They want the same flexibility with the real
purchasing tools.

The line between "mounts" and "doesn't" is ADR 0023's cardinality argument
applied to actions. A Stage Action runs once per SOR when the SOR enters a
stage, so it can only create something there is exactly one of per SOR, and
only when the stage knows enough to fill it.

- **One per SOR, so it mounts.** The Purchase Request (#304 already made it an
  action), the Costing Matrix, and a Packing List request.
- **A Canvass is one per Component, so it doesn't mount.** A dozen run at once,
  and the stage can't know which Component to open one for.
- **An IPAS is one per Odoo purchase order, so it doesn't mount.** It needs a PO
  number before it can exist, it can name several SORs, and an Inventory
  purchase names none.
- **A Transmittal is one per slip, so it doesn't mount.** A slip follows the
  goods, not the deal.

## Consequences

- **The Costing Matrix exists only once its action has run.** This reverses
  #227 and #266, which said every SOR carries a matrix from registration and
  nothing opens it. The PMS page still exists from registration, holding the
  Purchase Request card, the IPAS summaries, the Transmittals and the Packing
  Lists. A flow that never mounts the matrix shows none.
- **A costing condition on an SOR with no matrix reads unmet.** The Flow Canvas
  warns at publish when "Costing priced" or "Costing settled" sits on a stage
  that no earlier stage mounts the matrix for.
- **Every mountable tool follows Open Purchase Request's pattern.** There is at
  most one per SOR. A later run of the same action only fills what is still
  empty and never replaces or removes anything. Its config names who it calls
  in and for how long, the way group-task members get a window.
- **SORs already past the mount point get a backfill, once.** Actions fire on
  entering a stage, and SORs stay on their own flow version. So at release, a
  one-off run of "Open Costing Matrix" covers every live SOR whose flow mounts
  it at a stage the SOR has reached or passed. It adds rows and never removes
  any. Open Purchase Request needs no backfill.
- **There is no Canvass gate.** An item may be bought without a Canvass (see
  **Canvass** in `CONTEXT.md`), so no condition forces one. An item ordered
  without a Canvass shows that on its row instead.
- **Government's first mounting**, settled in the same session:
  - **Open Costing Matrix:** automatic at SO Evaluation. Raquel names the
    Purchasing Incharge there.
  - **Costing priced:** on leaving PMS Sourcing GS.
  - **Costing settled:** on leaving For Bidding.
  - **Open Purchase Request:** an Optional Action at Lead, and automatic at NTP.
  - **Request Packing List:** at Project Delivery.
  - **Goods checked and Purchasing settled:** on leaving Project Delivery.
  - **Orders filed:** not mounted yet. Finance does not file in the ERP yet, and
    a gate on closing would stall deals and commission.

## Considered and rejected

- **Mount everything, IPAS and Transmittal included.** Rejected on
  cardinality: the action would have to invent a PO or a slip, or create one
  per SOR, which is the lie ADR 0023 refuses.
- **Keep the matrix from registration and mount only its call-in.** Rejected:
  every SOR on every Sale Type would carry an empty matrix. The flows that buy
  nothing, such as Legacy Pipeline, would show a tool nobody uses.

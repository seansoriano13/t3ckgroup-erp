# Buying outside a project is canvassed before its Purchase Request

**Status:** accepted (2026-10-20)

A Canvass used to need a subject from the moment it existed: one Costing Matrix
Component or one Requested Item, never neither. For buying outside a project
that meant opening a Direct Purchase Request first and canvassing inside it,
where picking a winner fills nothing, because a Direct request has no Costing
Matrix row. Purchasing's feedback (2026-10-20) was that canvassing inside the
request felt pointless and scattered. We decided that a Canvass for buying
outside a project may start **against nothing**, on a new **Canvasses** page,
and that a Purchase Request is **created from** one or more finished Canvasses.
Each Canvass then points at the Requested Item it became.

## Why

Purchasing usually finds the product and the supplier before anyone knows what
to request. Making them open a request first put the paperwork before the
research. Canvassing first, then requesting, matches the order the work really
happens in, and the request starts out already filled in with the winner.

## Consequences

- **The "never neither" rule is gone.** A Canvass with no subject is valid
  until a Purchase Request is made from it. Code and database checks that
  assume every Canvass has a subject must allow none.
- **Both directions are kept.** An employee can still open a Direct request
  first. Canvassing one of its Requested Items opens that item's Canvass on the
  Canvasses page instead of a panel inside the request.
- **Several Canvasses make one request**, one Requested Item each.
- **A winner is enough to create the request.** A Canvass not yet signed off
  only warns, so buying does not wait days for a signature. The missing
  sign-off still shows on the item and the printout.
- **Project canvassing does not move.** Canvasses on Costing Matrix Components
  stay where they are, because there the winner really fills the price. They
  are listed on the Canvasses page too, so every Canvass can be found in one
  place.

## Considered and rejected

- **Hide Canvass on Direct requests and change nothing else.** Less work, but
  it leaves no way to research a purchase before requesting it.
- **Keep canvassing inside the request.** That is the layout Purchasing said
  does not work.

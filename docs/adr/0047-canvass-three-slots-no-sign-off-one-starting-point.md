# ADR 0047 — A Canvass has three supplier slots, no sign-off, and one starting point

## Status
Accepted (2026-11-13), spec #718, ticket #721 (slots), with #728 (sign-off removal) and #729 (one starting point) building on it. Narrows ADR 0034, builds on ADR 0042.

## Context

The sheet's PMS 3 CANVASS MATRIX tab compares three suppliers side by side. The app asked for "three or more" Offers only as a warning, and let a winner be picked on one Offer. A Canvass then needed a purchasing approver's sign-off (the Approval Center queue, its notices, and a Check-by block on the print) before it counted, which Purchasing felt slowed buying without adding a check ADR 0034 had not already made soft (a request could be made from an unsigned Canvass, with a warning). And a Canvass could still be opened free-standing, outside any Purchase Request or project line, next to the product-line start of ADR 0042.

## Decision

Three changes, one model.

### 1. Three supplier slots (ticket #721)

- Every Canvass shows three supplier slots. Slot n holds Offer n.
- An empty slot 2 or 3 can be marked **No other supplier** with a reason, the person who said so and when. One reason can be used for both slots in one action. Slot 1 cannot be explained away: a Canvass needs at least one Offer.
- **A winner is refused unless Offers plus No other supplier slots number at least three.** `canvass_apply_winner` raises 22023. More than three Offers stay allowed and count in full.
- A mark counts only while its slot is still empty (slot n is empty while there are fewer than n Offers). Adding an Offer later never makes a mark count twice, and the old mark stays as history.
- Marking is refused on a locked Canvass (ADR on Locked Canvass, `canvass_is_locked`) and for a slot that already has an Offer. Rows live in `sor_canvass_no_other_supplier`, written only by `canvass_set_no_other_supplier` / `canvass_clear_no_other_supplier`, readable wherever the Canvass is.
- The screen and the print show the slots and the reasons. The "below the three-offer minimum" warning follows the same count, so it goes away when the slots are explained.

### 2. No sign-off (ticket #728)

- A Canvass is no longer signed off. The sign function, the Approval Center queue, its notices and the Check-by part of the print are removed.
- The sign-off columns and the history table stay as read-only history: old signed Canvasses still say who signed and when. Nothing new is written to them.
- What the sign-off was meant to protect is now the winner rule above, plus the reason that must accompany a winner, plus the existing lock once a Purchase Request is made.

### 3. One starting point (ticket #729)

- A Canvass starts from a product line (ADR 0042) or from a Direct request, never free-standing. Creating a free-standing Canvass, and "Create Purchase Request from Canvasses", are refused for new records. Existing ones stay readable and printable and keep their numbers.
- This ends the "Canvass first, then request" order of ADR 0034 for new work. The "several Canvasses make one request" and "winner is enough to create the request" consequences of ADR 0034 no longer apply to new records; they stay true for the old ones.

## Consequences

- Tickets #728 and #729 assume the slot rule is in place: with no sign-off, the slot rule is the only guard on how a winner is chosen, so it lives in the database, not in the screen.
- Tests that picked a winner on one Offer now explain the other slots first (policy test helper `coverSlots`).
- The Canvass sign-off notices, queue and routes are removed by #728, not by #721. Until then the sign-off still works beside the slots.
- Old Canvasses with a winner on fewer than three covered slots stay valid. The rule applies when a winner is picked or changed.

## Considered and rejected

- **A hard minimum of three Offers.** Some products have one dealer. Explaining the empty slot keeps the evidence without forcing invented quotes.
- **One "No other supplier" flag for the whole Canvass.** It cannot say which slot is explained, and it would let slot 1 be explained away.
- **Keeping the sign-off as well as the slots.** Two gates for one decision; the signature added a wait without showing more than the reason and the slots do.
- **Counting marks even after the slot gets an Offer.** A Canvass with an old mark and a late Offer would count the same slot twice.

# CNV · Canvass and Offers

Guide §8. Canvasses are not signed off (#728); old sign-offs show as history.

A Canvass opens in the record window over `/purchasing/canvasses`. The Offers stay side-by-side cards. Sign-off is a step in the Your move card (Offers in, Winner picked, Purchase Request, and History on an old signed Canvass). Print and Unlock are in More. Questions such as Unlock ask in a confirm dialog, not a toast.

### CNV-01 · Open a Canvass on a Component
- **Guide**: §8
- **Log in as**: purchaser
- **Needs**: CM-02 ("Pump 1HP" on S990002)
- **Steps**:
  1. Open a Canvass on "Pump 1HP".
  2. Try to open a second Canvass on the same Component.
  3. Try to open a Canvass on an Inclusion.
- **You should see**: the number looks like `CNV_0001` and up. The Canvasser defaults to the Component's Purchasing incharge, else the matrix's. Steps 2 and 3 are refused.

### CNV-02 · An item that names a Component is canvassed through the Component
- **Guide**: §8
- **Log in as**: purchaser
- **Needs**: PR-12 (an item made from a Component)
- **Steps**:
  1. Try to open a Canvass on that Requested Item itself.
- **You should see**: refused, or sent to the Component's Canvass.

### CNV-03 · Canvass on a bare item, then re-point to a Component
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Open a Canvass on a bare item (no Component). Add one Offer. Note the number.
  2. Add a Component for it on the matrix and link the item.
  3. Re-point the Canvass to that Component.
  4. Try to re-point another bare-item Canvass to "Pump 1HP" (which has CNV-01).
- **You should see**: step 3 keeps the number, the Offer and the reason. Step 4 is refused.

### CNV-04 · Offers in four currencies
- **Guide**: §8
- **Log in as**: purchaser
- **Needs**: CNV-01
- **Steps**:
  1. Add an Offer in PHP, 9,800.00, supplier from Odoo suggestions (type "Dee", wait for the list).
  2. Add an Offer in USD, 170.00. Note the pre-filled comparison rate. Change it to 57.50.
  3. Add an Offer in AUD, 260.00. Note the rate field.
  4. Add an Offer in EUR, 150.00, and clear the rate.
- **You should see**:
  - Supplier suggestions show after 2 characters, at most 10.
  - USD pre-fills from the Reference Rate. The stored rate is 57.50. PHP figure 9,775.00.
  - AUD has no pre-filled rate.
  - EUR with no rate has no PHP figure at all (blank, not 0).

### CNV-05 · Expired quotes
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Set one Offer's valid-until to today. Another to yesterday. Leave one blank.
- **You should see**: today and yesterday show as expired. The blank one never expires.

### CNV-06 · Fewer than three Offers warns, never blocks
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. On a Canvass with two Offers, mark a winner and write a reason.
- **You should see**: a warning about fewer than three Offers. The winner still saves.

### CNV-07 · The winner fills the Component
- **Guide**: §8
- **Log in as**: purchaser, then sales-exec
- **Needs**: CNV-04
- **Steps**:
  1. Mark the USD Offer the winner with reason "STORY CNV-07".
  2. Open the matrix as purchaser. Read Acquire, Offer Specification and the brochure.
  3. As sales-exec, look at Brand.
- **You should see**:
  - Acquire is 9,775.00 (170.00 × 57.50) and marked "from Canvass". Spec and brochure filled.
  - The Evaluation approval, if any, is cleared (spec changed).
  - Brand is only proposed. sales-exec can accept it. Until then Brand is unchanged.

### CNV-08 · Only one winner
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Mark the PHP Offer the winner.
- **You should see**: the USD Offer is no longer the winner. Acquire becomes 9,800.00.

### CNV-09 · A typed-over value is left alone
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Type Acquire `9,900.00` over the "from Canvass" value.
  2. Mark the USD Offer the winner again.
- **You should see**: Acquire stays 9,900.00. Spec, if still "from Canvass", updates.

### CNV-10 · A winner with no price keeps the old value
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. On a fresh Canvass, add an Offer with no price and no description. Mark it the winner.
- **You should see**: the Component keeps its value. The "from Canvass" mark is dropped.

### CNV-11 · A winner on a bare item fills nothing
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Mark a winner on a bare-item Canvass.
- **You should see**: the item itself does not change.

### CNV-12 · Offer projection
- **Guide**: §8
- **Log in as**: approver, then purchaser, then sales-exec
- **Steps**:
  1. Each person opens the Canvass and looks for the projection.
- **You should see**: approver sees the Acquire and Markup Price per Offer, and the factor. purchaser sees the peso Markup Price but no factor. sales-exec sees no projection and no prices.

### CNV-13 · Stage Participants never get prices
- **Guide**: §8
- **Log in as**: a person called in by a Stage Action window (FLOW-04), with no Purchasing, Finance or Super Admin
- **Steps**:
  1. Open the Canvass.
- **You should see**: no prices.

### CNV-14 · A Canvass is not signed off
- **Guide**: §8
- **Log in as**: ops-head (on the Check by list), then purchaser
- **Needs**: CNV-08 (winner and reason)
- **Steps**:
  1. As ops-head, open the Approval Center.
  2. As purchaser, open a Canvass that has a winner and a reason.
  3. Print it.
- **You should see**: step 1 has no Canvass sign-off queue. Step 2 has no Sign off button and the Your move card says "Ready. Nothing left to do." Step 3 prints only "Canvassed by".

### CNV-15 · An old signed Canvass keeps its sign-off
- **Guide**: §8
- **Log in as**: purchaser
- **Needs**: a Canvass signed off before #728
- **Steps**:
  1. Open it. Open the History step.
  2. Change an Offer's price and the reason. Print it.
- **You should see**: History says who signed. The edits do not clear the sign-off. The print still shows "Approved by" beside "Canvassed by", and no "Checked by".

### CNV-16 · Canvasser can change; the creator is kept
- **Guide**: §8
- **Log in as**: purchaser
- **Steps**:
  1. Change the Canvasser to purchaser-2.
- **You should see**: the Canvasser is purchaser-2. The trail still names who created it.

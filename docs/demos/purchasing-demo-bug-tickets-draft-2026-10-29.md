# Purchasing demo run: ticket drafts (2026-10-29)

Source: `docs/demos/purchasing-demo-run-bug-log-2026-10-29.txt` (numbers like A35 point to it).
Found on a local copy of staging, run sheet S03204. Nothing here is filed yet.
Order is worst first. Each ticket is one fix a person can finish.

---

## 1. "Costing settled" can never pass (A35, A6, A29)
**What happens.** At For Bidding, with the Go taken, the Evaluation approved, the offer under the ABC and every row costed, the stage still says "missing: Costing settled".
**Why.** The database says `settled_met: true`, but the screen reads `missing_cost: 12` (the old "Final Acquire" count). The client rule `costingSettled` in `src/utils/costingMath.js` fails on `incomplete_summary` whenever `missing_cost` is not 0.
**Also.** Old words stay on screen: "12 costs have no Final Acquire yet", "Incomplete: 12 rows have no cost" next to filled costs.
**Done when.** A fully costed, approved, Go deal passes the gate, and "Final Acquire" wording is gone.

## 2. Refusals that show nothing on screen (A36, A28, A1, A12c)
**What happens.**
- Attach P0 with a cancelled P0 (P01415) or an unknown one (P99999): the server refuses with a clear message, the dialog shows nothing.
- Unlock by a person who may not (Dani): `costing_unlock_bid` returns 403, the sheet just stays locked.
- Open Purchase Request "Create" fails once (database error): the run is saved as `failed`, the Create button stays and does nothing, no retry possible.
- IPAS section 3 refusal ("2 charge(s) are blank") only shows in the "Your move" panel.
**Done when.** Every refusal shows its message where the person clicked, and a failed action can be retried.

## 3. Warehouse cannot do the steps the sheet gives them (A23, A19, A14, A15)
- Aldrin (Warehouse) has no "Add a box" on the Packing List; the panel says "Waiting on the maker of the list or Purchasing".
- Aldrin's Item Location dropdown in IPAS section 6 is disabled.
- "Inspected by" for Warehouse checking offers only the signer himself (A15) until a second person is on the list.
**Done when.** Decide the intended rule, then make the screen and the sheet agree.

## 4. A part-ordered P0 marks a line Received (A4, A5)
**What happens.** 2.5" hose needs 10, P01423 orders 2, the line shows "Received 2 of 2" and counts as ready (11 of 12 instead of 10 of 12). The summary also names the wrong P0 ("1 is on P01046" when the open line is on P01047).
**Done when.** The line compares to the quantity needed (Purchased, 2 of 10), and the summary names the right P0.

## 5. Counts that do not match the data (A25, A27, A7, A3, A34, A32)
- Tracker: S03204 shows Purchased (not received) 4; the database has 1.
- S0 Evaluation list: "Items bought 0 of 12" with 11 lines Received (earlier "0 of 0").
- PMS tab says "Lines 0" with 12 lines.
- Stage header "Blocked: 4" vs "Can't move on until 2 things" vs 2 items in "Needs attention".
- "Blocked" banner stays stale after fields are saved until a reload; Judged count lags.
**Done when.** One source for each count; banners refresh after a save.

## 6. IPAS section 2 submits with blanks (A12b, A12c)
Section 2 (Purchasing & Finance) is accepted with 2 blank charges, 0 of 12 documents and no bank details. The blank-charge rule only fires at section 3. Decide the rule; then fix the screen or the sheet.

## 7. Deal Owner is not set when an SOR is registered (A2, A2b, A2c)
Registering leaves `deal_owner_id` empty. The SOR says "Unassigned: Deal Owner" and its "Go" link does nothing; the S0 Evaluation shows "Sales incharge: Not set" and does not refresh once an owner is set.

## 8. Local seed restore does not reset number counters (B1) (dev tooling)
`seed-restore.mjs` leaves `purchase_request_number_seq`, `sor_canvass_number_seq`, `packing_list_number_seq`, `transmittal_number_seq` at 1, so the first create fails on a duplicate PR_0001. Set each to the max number used. Small and safe.

## 9. Small screen problems (batch)
A9 Canvass slot stays "2 of 3" after saving; A10 PMS tab blank 10 to 15 s and slow panels; A24 stale refusal banner on the Packing List; A30 sheet header shows "SOR" not "SOR-253"; A22 Contract/PO labelled "Optional" but counted as owed; A39 ETA already past with no late flag; A37 a P0 can be attached after its IPAS is Filed (only a toast warns); A38 a duplicate Sales Reference registers with no warning; A8 retired demo requests PR_0171/0172 still listed as Open; A11 people picker keeps old search text; A13 section collapses after save and the next click lands elsewhere.

## 10. Fix the run sheet (docs only)
All the C items: step 0.2 wording (Decider, "Require confirmation"), 2.1 needs a Deal Owner step, 3.2/6.1 attach order, 4.5 costs already filled from Odoo, 5.1 and 5.6 other required fields and the price schedule attachment, 6.7/6.8 (charges, documents and PI live in section 2; payment kind is "Payment"), 7.2/7.3 (priority, two signers, "no pictures" reason, PDF cannot be a picture), 7.4 no Technical step by default, 8.3 button names, 8.4 who packs, 8.5 more blockers, total price (P1,370,535.74 not P1,452,768).

---

### Not run, so no ticket yet
Order early (A.1/A.2), C.2/C.3, D.2 to D.4, F.4, and the real Sales stage moves between Qualified and NOA (done by database jump).

### When filing
- One GitHub issue per section above, labelled by area.
- Link each as a native sub-issue under one parent ("Purchasing demo run 2026-10-29"), with blocked-by links where one fix needs another (1 before re-running the gate steps; 3 before re-running 7.3 to 8.4).

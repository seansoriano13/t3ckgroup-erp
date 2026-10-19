# CM · Costing Matrix

Guide §7. A matrix exists only after the "Open Costing Matrix" Stage Action has run (FLOW-02). CM-01 makes sure one exists on S990002.

### CM-01 · The matrix exists and has Incharges
- **Guide**: §4 step 1, §7 Shape
- **Log in as**: sales-exec
- **Needs**: FLOW-02 run on S990002 (or note BLOCKED)
- **Steps**:
  1. Open S990002, PMS tab.
  2. Try to set the Sales incharge to sales-exec-2 (not Deal Team).
  3. Try to set the Purchasing incharge to sales-exec-2 (no Purchasing access).
  4. Set the Purchasing incharge to purchaser.
- **You should see**: the Sales incharge defaults to the Deal Owner. Steps 2 and 3 are refused. Step 4 saves. Naming an Incharge sends nobody a notice.

### CM-02 · Build lines, Components, a bundle, Inclusions and a cost-only row
- **Guide**: §7 Shape, Who writes which column
- **Log in as**: purchaser
- **Needs**: CM-01
- **Steps**:
  1. Add Tender Line "STORY CM-02 Pump set", quantity 4.
  2. Under it add Component "Pump 1HP" with Acquire `10,000.00`.
  3. Add Component "Install kit" as a bundle. Under it add Inclusions "Hoses" and "Clamps".
  4. Try to add an Inclusion under "Pump 1HP" (not a bundle).
  5. Try to turn "Install kit" back into a non-bundle.
  6. Add a cost-only row "Delivery Charge" with Acquire `2,500.00`.
- **You should see**: steps 4 and 5 are refused. Everything else saves.

### CM-03 · Column bands refuse writes outside your band
- **Guide**: §7 Who writes which column
- **Log in as**: sales-exec, then purchaser, then approver, then finance
- **Needs**: CM-02
- **Steps**:
  1. As sales-exec: set Brand on "Pump 1HP". Try to set its Acquire. Set the Tender Line's Final Offer to `15,000.00`.
  2. As purchaser: set Source and availability. Try to set Brand. Try to set Final Acquire.
  3. As approver: set Final Acquire `10,500.00` and markup factor `1.25` on "Pump 1HP". Try to set Acquire.
  4. As finance: set Marketing and OPEX. Try to set Acquire.
- **You should see**: each "set" saves, each "try" is refused.

### CM-04 · Markup Price maths
- **Guide**: §7 Money maths
- **Log in as**: approver
- **Needs**: CM-03
- **Steps**:
  1. Read Markup Price on "Pump 1HP" (Acquire 10,000.00, factor 1.25).
  2. Clear the row factor. Set the matrix default factor to `1.333`.
  3. Read "Delivery Charge" (cost-only, no factor).
  4. Clear Acquire on "Install kit".
- **You should see**:
  - Step 1: 12,500.00.
  - Step 2: 13,330.00.
  - Step 3: 2,500.00 (×1.00).
  - Step 4: Markup Price is blank, not 0.

### CM-05 · Picking a preset copies its factor
- **Guide**: §7 Money maths
- **Log in as**: approver
- **Needs**: SET-10 (preset 1.30; activate it again if needed)
- **Steps**:
  1. Pick preset "STORY SET-10" on the matrix.
  2. Change the preset to 1.40 in settings.
  3. Reopen the matrix.
- **You should see**: the matrix still uses 1.30.

### CM-06 · Operational Expenses is not typed
- **Guide**: §7 Money maths
- **Log in as**: approver
- **Steps**:
  1. Look at the summary.
- **You should see**: Operational Expenses equals the Final Acquire total and cannot be typed. Only Marketing and OPEX are typed.

### CM-07 · Completeness of Inclusions
- **Guide**: §7 Shape
- **Log in as**: technical (via an Evaluation task) or purchaser
- **Needs**: CM-02
- **Steps**:
  1. Set "Hoses" Covered and "Clamps" Missing. Read the completeness.
  2. Set "Clamps" Not required. Read it again.
  3. Look at an SOR whose matrix has no Inclusions.
- **You should see**: 1 of 2, then 1 of 1 (Not required leaves both sides). The SOR with no Inclusions shows no completeness figure, not 0%.

### CM-08 · Compliance: deviates needs a note
- **Guide**: §7 Compliance
- **Log in as**: purchaser
- **Steps**:
  1. Set "Pump 1HP" to deviates with no note.
  2. Add the note "STORY CM-08 lower head".
  3. Set "Install kit" to complies.
- **You should see**: step 1 is refused. Steps 2 and 3 save.

### CM-09 · Technical through an Evaluation task
- **Guide**: §7 Compliance
- **Log in as**: super-admin, then technical
- **Steps**:
  1. As super-admin, set the Evaluation template in Costing Matrix settings (if not set).
  2. Make a group task from that template on S990002 with technical as a member.
  3. As technical, set a verdict on a Component.
  4. Remove technical from the task. Try again.
- **You should see**: step 3 saves. Step 4 is refused.

### CM-10 · Evaluation approval, and what clears it
- **Guide**: §7 Compliance
- **Log in as**: ops-head (Evaluation list), then purchaser
- **Needs**: every Component has a verdict
- **Steps**:
  1. As ops-head, approve the Evaluation.
  2. As purchaser, change "Pump 1HP"'s Offer Specification.
  3. As ops-head, look at the Evaluation. Approve again.
  4. As purchaser, add a new Component.
- **You should see**: the approval is cleared after step 2 and after step 4. The cleared rows stay as history.

### CM-11 · Evaluation needs a verdict on every Component
- **Guide**: §7 Compliance
- **Log in as**: ops-head
- **Steps**:
  1. Leave one Component with no verdict. Try to approve.
- **You should see**: refused.

### CM-12 · Four sign-offs and what clears each
- **Guide**: §7 Four sign-offs
- **Log in as**: sales-exec (Sales incharge), purchaser (Purchasing incharge), ops-head, approver
- **Steps**:
  1. Give all four: Prepared, Costed, Evaluation approved, Final approved.
  2. As sales-exec, change the Tender Line quantity to 5.
  3. Check which sign-offs are live.
  4. Sign them again. As purchaser, change an Acquire.
  5. Check again.
- **You should see**:
  - After step 2: Prepared and Final approved are cleared. Costed stays.
  - After step 4: Costed is cleared. Prepared stays.
  - Cleared rows stay as history.

### CM-13 · Sign-off checks who you are
- **Guide**: §7 Four sign-offs
- **Log in as**: sales-exec-2, then purchaser-2
- **Steps**:
  1. sales-exec-2 tries to give Prepared.
  2. purchaser-2 (not the Purchasing incharge) tries to give Costed.
- **You should see**: both refused.

### CM-14 · Signature snapshot and decline
- **Guide**: §7 Four sign-offs
- **Log in as**: sales-exec
- **Steps**:
  1. Upload a signature image on your profile. Give Prepared.
  2. Upload a different signature. Print the matrix.
  3. Give a sign-off and decline to apply the signature.
- **You should see**: the print shows the first signature. The declined one prints no image.

### CM-15 · Bid Decision: Go, No-go, Revise
- **Guide**: §7 Bid Decision
- **Log in as**: approver, then sales-exec
- **Needs**: a Final Offer on every Tender Line
- **Steps**:
  1. As approver, open `/approvals/bid-decisions`. The matrix is listed. Take Revise with no reason.
  2. Take Revise with reason "STORY CM-15".
  3. As sales-exec, check notifications and open the matrix.
  4. As approver, take Go.
- **You should see**:
  - Step 1 is refused.
  - sales-exec is told about Revise, sees the verdict and reason, and no totals.
  - The SOR's stage does not change at any step.
  - The decision stores the Final Offer total and ABC total (approver sees them).

### CM-16 · A Final Offer change clears the decision
- **Guide**: §7 Bid Decision
- **Log in as**: sales-exec, then approver
- **Needs**: CM-15 (live Go)
- **Steps**:
  1. Change a Final Offer.
  2. As approver, open the matrix and `/approvals/bid-decisions`.
- **You should see**: the Go is cleared with a reason, and the matrix is back in the queue.

### CM-17 · Super Admin can take a Bid Decision
- **Guide**: §7 Bid Decision
- **Log in as**: super-admin
- **Steps**:
  1. Take a Bid Decision on a matrix in the queue.
- **You should see**: it saves (Super Admin is allowed here, unlike sign-off lists).

### CM-18 · Delete guards
- **Guide**: §7 Edge cases
- **Log in as**: purchaser
- **Steps**:
  1. Try to delete a Component that has a Requested Item (PR-12).
  2. Try to delete its Tender Line.
  3. Detach the item from the Component. Delete the Component.
  4. Type a P.O./RFQ No. on another Component. Try to delete it.
- **You should see**: steps 1, 2 and 4 are refused. Step 3 works, and the unlink shows in history.

### CM-19 · No Canvass note and PO supplier note
- **Guide**: §7 Edge cases, §5 Edge cases
- **Log in as**: purchaser
- **Steps**:
  1. Order an item linked to a Component with no Canvass.
  2. Look at the matrix row and print the sheet.
  3. On a Component with a Canvass winner from supplier A, link a PO whose supplier is B (via a picked PO line).
- **You should see**: the row and the print say there is no Canvass. Step 3 shows "PO supplier differs from the winning Offer".

### CM-20 · Landed Cost beside Acquire
- **Guide**: §4 step 12, §9 Landed Cost
- **Log in as**: purchaser
- **Needs**: IPAS-10 (an IPAS with a picked PO line on a Component)
- **Steps**:
  1. Read the Component on the matrix.
  2. Move the IPAS to LC Odoo Done. Read again.
- **You should see**: Landed Cost shows beside Acquire, read only, marked provisional, then final.

### CM-21 · History is Closed Book only
- **Guide**: §7 Edge cases
- **Log in as**: approver, then purchaser
- **Steps**:
  1. Each person looks for the matrix history.
- **You should see**: approver can read it. purchaser cannot.

# IPAS

Guide §9. Raise only with the real POs in the README. Sections are numbered as the screen shows them: 1 and 2 are prepared and approved, 3 is Computation status (no sign-off), 4 is Filing. Sign-off lists: section 1 and 2 Approved = admin-head; section 4 Received = ops-head, Noted = sales-head, Checked and Approved = approver.

An IPAS opens in the record window at full size over the IPAS list (`/purchasing/ipas/:id`), like every other Purchasing record; it is no longer a page of its own, and Close returns to the list. The window shows one state badge (Open); the payment status (Paid) is a pill under the title. Sign-off moves (Prepare, Submit, Approve, Return) are green buttons in the Your move card, and only there. Each section keeps its own Edit section button. Lines, payments and documents are one-line rows that open in place with their chevron. More holds Print and Cancel. The bill check keeps its red Odoo PO amount and green P.I amount.

Keep these IPAS records alive, later stories use them:
- **IPAS-A**: P02401, Local, Project, S990001 (from IPAS-01).
- **IPAS-B**: P02400, Import, Project, S990002 (from IPAS-03).

### IPAS-01 · Raise a Local Project IPAS
- **Guide**: §9 Raising one
- **Log in as**: purchaser
- **Steps**:
  1. Open `/purchasing/ipas`, New IPAS.
  2. PO `P02401`, Priority High, Source Local, Purpose Project, SOR S990001, remarks "STORY IPAS-01".
  3. Save. Open it.
- **You should see**:
  - The number is `TGIPAS_` and at least three digits (049 or higher).
  - Part 1 shows the Odoo copy: supplier Dee Hwa Liong, the PO lines, currency Php.
  - The SOR picker shows reference, project and stage only. No customer name anywhere.
  - Document rows were made for every active document kind that matches Local.

### IPAS-02 · Refusals when raising
- **Guide**: §9 Raising one
- **Log in as**: purchaser, then finance
- **Steps**:
  1. PO `P9999999` → expect "not found" (the server asked Odoo itself; the refusal names the PO). If Odoo cannot be reached the IPAS is refused with a message that Odoo was unavailable, not "not found". Unlike an item set to Ordered, raising an IPAS is never saved as "not checked".
  2. PO `X123` → expect refused shape.
  3. PO `P02401` again (IPAS-A is live) → expect refused, one live IPAS per PO.
  4. PO `P02396`, Purpose Project, no SOR → expect refused.
  5. PO `P02396`, Purpose Supplies, with SOR S990003 → expect refused.
  6. PO `P02698` (an RFQ), Purpose Inventory, no SOR → expect accepted. Then cancel it with reason "STORY IPAS-02".
  7. As finance, look for New IPAS.
- **You should see**: as written in each step. finance has no New IPAS control (only Purchasing raises).

### IPAS-03 · Raise an Import IPAS and its documents
- **Guide**: §9 Raising one
- **Log in as**: purchaser
- **Needs**: SET-03
- **Steps**:
  1. Raise P02400, Priority Very High, Source Import, Purpose Project, SOR S990002.
  2. Open part 2, documents.
  3. Open IPAS-A's documents.
- **You should see**: "STORY SET-03 Doc" is on the Import IPAS and **not** on IPAS-A. Currency shows USD.

### IPAS-04 · Numbers are never reused
- **Guide**: §9 Raising one
- **Log in as**: purchaser
- **Steps**:
  1. Raise P02390, Inventory, no SOR. Note the number N.
  2. Cancel it with no reason → expect refused. Cancel with reason "STORY IPAS-04".
  3. Raise P02390 again.
  4. Try to cancel the cancelled one again.
- **You should see**: step 3 works (cancel freed the PO) and gets a number higher than N. The cancelled IPAS stays readable. Step 4 is refused.

### IPAS-05 · The PO number never changes
- **Guide**: §9 Raising one
- **Log in as**: purchaser
- **Steps**:
  1. On IPAS-A, look for a way to edit the PO number.
- **You should see**: none.

### IPAS-06 · One IPAS on two SORs
- **Guide**: §9 Raising one, §5 What the SOR shows back
- **Log in as**: purchaser, then sales-exec (or super-admin)
- **Needs**: two fresh SORs made through FLOW-00 by sales-exec (use those in place of S990001 and S990002). The seed SORs are owned by the Super Admin, so sales-exec cannot open them; if you must use them, open them as super-admin.
- **Steps**:
  1. Raise P02396, Local, Project, naming both SORs.
  2. As sales-exec, open both SORs' PMS tab (or as super-admin if the seed SORs were used).
- **You should see**: the IPAS appears on both SORs.

### IPAS-07 · Overrides and what cannot be changed
- **Guide**: §9 The Odoo copy
- **Log in as**: purchaser
- **Steps**:
  1. On IPAS-A, override Entity, Source Doc and Analytic Dist. Reset one.
  2. Look for a way to change Currency, Supplier, a line, or Brand.
  3. Type a supplier contact and P.I #. Reopen the IPAS (it refreshes).
  4. Open history.
- **You should see**: overrides and the reset are in history. Step 2 has no controls. The typed contact and P.I # stay after the refresh.

### IPAS-08 · Payments and charges
- **Guide**: §9 Payments, charges
- **Log in as**: purchaser, then finance, then plain
- **Steps**:
  1. As purchaser on IPAS-A (section 1 not approved), add a down payment ₱2,000.00 with proof, method from the list.
  2. As finance, add a payment ₱4,825.50 with a charge fee ₱25.00. Change its date. Remove it, then add it again.
  3. Add a charge "STORY IPAS-08" ₱150.00.
  4. Look for a "balance" anywhere.
  5. Open history.
- **You should see**:
  - The step 1 payment is flagged "paid before approval".
  - Both purchaser and finance can add, change and remove. The removal keeps a snapshot in history.
  - There is no balance shown anywhere. DP and FP in the header are shown, derived.
  - Adding payments clears no approval.

### IPAS-09 · Foreign payment needs PHP debited, and rate check
- **Guide**: §9 Payments
- **Log in as**: finance
- **Needs**: IPAS-B. Note today's USD Reference Rate R (SET-06).
- **Steps**:
  1. Add a payment USD 10,000.00 with no PHP debited.
  2. Add it with PHP debited close to 10,000 × R.
  3. Add another USD 1,000.00 with PHP debited 1,000 × R × 1.05 (5% off).
- **You should see**: step 1 refused. Step 2 saves with no flag. Step 3 saves and is flagged beside the payment. The Reference Rate never fills the payment by itself.

### IPAS-10 · Landed Cost marks
- **Guide**: §9 Landed Cost
- **Log in as**: purchaser
- **Steps**:
  1. Raise P02343 (USD), Import, Project, S990003. Before any payment, open part 3.
  2. On IPAS-A, open part 3. Pick the split (value, quantity, equal) in turn.
  3. Link one of P02401's lines to an item on a Component (PR-19 style).
- **You should see**:
  - Step 1: Landed Cost is "unavailable".
  - Step 2: "provisional". The split changes the spread. The total equals the pre-tax PO price plus charges and charge fees, to the centavo.
  - Step 3 makes it show on that Component (CM-20).

### IPAS-11 · Bank details
- **Guide**: §9 Bank details
- **Log in as**: finance, then purchaser
- **Steps**:
  1. As finance, try to type bank details on IPAS-A.
  2. As purchaser, type bank name and Account # `1234-5678 90`.
- **You should see**: finance cannot type them. purchaser can. finance can read them.

### IPAS-12 · Changed account flag
- **Guide**: §9 Bank details
- **Log in as**: purchaser, then admin-head
- **Steps**:
  1. Raise P02395 (Chase), Local, Inventory. Type Account # `111 222 333`. Note: no flag (first for this supplier).
  2. Raise P02369 (Chase), Local, Inventory. Prepare section 1 and 2. As admin-head, approve both.
  3. As purchaser, type Account # `111-222-333` on P02369.
  4. Change it to `999 888 777`.
  5. Change it back to `111222333`.
  6. Open history.
- **You should see**:
  - Step 3: no flag (spaces and dashes ignored).
  - Step 4: flagged, sections 1 and 2 approvals cleared, preparers told.
  - Step 5: flag cleared.
  - History never shows the account numbers.

### IPAS-13 · Documents: two ticks
- **Guide**: §9 Documents
- **Log in as**: purchaser, then finance
- **Steps**:
  1. As purchaser, tick "Purchasing has it" on a row. Try "Finance has it".
  2. As finance, tick "Finance has it". Try to untick Purchasing's.
  3. Add a hand row "STORY IPAS-13" with a file. Remove it. Try to remove a document-kind row.
- **You should see**: neither side can tick for the other. Hand rows can be removed; kind rows cannot.

### IPAS-14 · Import-only fields
- **Guide**: §9 Payments… Supplier Origin dates, buyer track
- **Log in as**: purchaser
- **Steps**:
  1. On IPAS-B, set Shipped Out, Onboard, Arrived in PH, Arrived in Whs., and Import Clearance.
  2. On IPAS-A, look for the same fields, or try to set them.
  3. Set Item Location from the list. Tick Googlesheet and Gantt Chart.
- **You should see**: step 1 saves. Step 2 is refused or not offered. Ticks clear no approval.

### IPAS-15 · Buyer track
- **Guide**: §9 The buyer track
- **Log in as**: purchaser
- **Steps**:
  1. Read part 7 on IPAS-A.
- **You should see**: Purchase Order ticked (confirmed in Odoo). With P.O.P ticked (a payment has proof). Received in Odoo and Create Bill follow Odoo. Delivered and Actual Checking are open until a Transmittal or a typed date.

### IPAS-16 · Section 1 and 2 sign-offs, no self-approval
- **Guide**: §9 Sign-offs
- **Log in as**: purchaser, admin-head, super-admin
- **Steps**:
  1. As purchaser, Prepare section 1 on IPAS-A.
  2. As super-admin, try to Approve section 1.
  3. As admin-head, open `/approvals/ipas`. Approve section 1 from there.
  4. Before section 2 is approved, as ops-head, try to give section 4 Received.
  5. As purchaser, Prepare section 2. As admin-head, Approve it.
- **You should see**: step 2 refused. Step 3 works and the IPAS is in the queue. Step 4 refused (section 4 opens only after 1 and 2). After step 5 ops-head is told section 4 is open.

### IPAS-17 · Section 4 order
- **Guide**: §9 Sign-offs
- **Log in as**: ops-head, sales-head, approver
- **Needs**: IPAS-16
- **Steps**:
  1. As approver, try to give Checked before Received.
  2. As ops-head, give Received.
  3. As approver give Checked, then as sales-head give Noted (other order is fine).
  4. As approver, try Approved while computation status is Encoding.
- **You should see**: step 1 refused. Step 4 refused (needs LC Odoo Done or Checked by). Each step tells the next list.

### IPAS-18 · Return on section 1 clears section 4
- **Guide**: §9 Sign-offs
- **Log in as**: admin-head
- **Needs**: IPAS-17 step 3 (Received, Noted, Checked live)
- **Steps**:
  1. Return section 1 with no reason → refused. Return with "STORY IPAS-18".
  2. Read sections 1 and 7.
- **You should see**: section 1 Prepared and Approved are cleared and kept as history. Section 4 Received, Noted and Checked are cleared, and those signers are told. The data is untouched.

### IPAS-19 · Undo approval
- **Guide**: §9 Sign-offs
- **Log in as**: admin-head
- **Steps**:
  1. Re-sign section 1 (purchaser prepares, admin-head approves). Give section 4 Received again.
  2. Undo section 1 Approved with reason "STORY IPAS-19".
- **You should see**: only Approved is taken back. Prepared stays. Section 4 Received is cleared.

### IPAS-20 · Section 4 send back
- **Guide**: §9 Sign-offs
- **Log in as**: sales-head
- **Steps**:
  1. With nothing live on section 4, send it back → refused.
  2. Get Received live, then send back.
- **You should see**: step 2 clears Received, Noted and Checked.

### IPAS-21 · Computation status and Checked by
- **Guide**: §9 Computation status
- **Log in as**: purchaser, then finance, then super-admin
- **Steps**:
  1. As purchaser, move Encoding → Encoded → LC GS Done → LC Odoo Done.
  2. As purchaser, try Checked by. Try to move the status away from Checked by once finance has given it (step 3).
  3. As finance, give Checked by. Take it back. Give it again.
  4. As super-admin (not in Purchasing), take Checked by back and give it again.
- **You should see**: step 2 refused (the Checked by step is hidden or locked for purchaser, and a direct attempt is refused). finance can give and take back Checked by, and so can a Super Admin who is not in Purchasing. The current status looks selected. Landed Cost turns final at LC Odoo Done.

### IPAS-22 · Filing freezes the IPAS
- **Guide**: §9 Filing
- **Log in as**: approver, then purchaser, then finance
- **Needs**: sections 1 and 2 approved, Received, Noted, Checked live, status LC Odoo Done or Checked by. Leave one required document unticked.
- **Steps**:
  1. Before filing, as purchaser, edit the IPAS's Remarks to "STORY IPAS-22 edited". Try to change the SOR list.
  2. As approver, give section 4 Approved.
  3. As purchaser, try to change remarks again, add a payment, tick a document, change bank details.
  4. As finance, try to add a charge.
  5. As purchaser, try to cancel it.
- **You should see**: step 1 saves the Remarks (and writes a history line). The SOR list cannot be changed after raising (to change it, cancel and raise again). Step 2 warns about the unticked document but files anyway. State is filed with a date. Every change in steps 3 to 5 is refused, Remarks included. **This is the filed IPAS SET-11 uses.**

### IPAS-23 · Reopen
- **Guide**: §9 Filing
- **Log in as**: purchaser, then super-admin
- **Steps**:
  1. As purchaser, look for Reopen.
  2. As super-admin, reopen with no reason → refused. Reopen with "STORY IPAS-23".
- **You should see**: purchaser has no Reopen. After step 2, section 4 sign-offs are cleared (kept as history), sections 1 and 2 stay approved, and the IPAS can be edited and cancelled again.

### IPAS-24 · Actual Checking stamp
- **Guide**: §9 The buyer track
- **Log in as**: purchaser
- **Steps**:
  1. On an IPAS with no Transmittal, stamp Actual Checking. Clear it.
  2. Submit a Transmittal carrying one of this IPAS's PO lines (TRN-02). Try to stamp again. Try to clear the Transmittal's stamp on the IPAS.
  3. Undo or cancel the slip (TRN stories). Look at Actual Checking on the IPAS again.
- **You should see**: step 1 works. In step 2 the stamp is refused, and the Transmittal's stamp cannot be cleared on the IPAS. In step 3, undoing the slip's signature or cancelling the slip is what clears it.

### IPAS-25 · Print
- **Guide**: §9 Printing
- **Log in as**: purchaser
- **Steps**:
  1. Print IPAS-A (More, then Print).
- **You should see**: all seven parts. Signature images only for sign-offs that carry them. A declined signature does not print.

### IPAS-26 · PO changed in Odoo (manual setup)
- **Guide**: §9 The Odoo copy
- **Log in as**: purchaser
- **Needs**: a human changes a test PO's lines in Odoo. The AI never writes to Odoo. If nobody did, mark BLOCKED with "manual setup".
- **Steps**:
  1. Open the IPAS for that PO with sections 1 and 2 approved.
- **You should see**: both approvals are cleared with "PO changed in Odoo", a change note says what changed, and the preparers are told. On a filed IPAS instead, nothing is stored and only the "Odoo changed since filing" mark shows.

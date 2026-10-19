# E2E · One purchase, start to finish

Guide §4. Run last, on a fresh SOR, after the area files pass. It joins the pieces. Use PO **P02396** (cancel any IPAS left on it first) and the FLOW-00 flow.

### E2E-01 · Government project, happy path
- **Log in as**: as each step says
- **Steps**:
  1. sales-exec: register SOR "Mock Client Story E2E" with two Product List lines. Move it into Costing.
  2. Check: one request (Buyer purchaser) and one matrix exist.
  3. sales-exec: add both SOR lines as Requested Items.
  4. purchaser: build the matrix: one Tender Line, two Components, Acquire on each. Link each item to its Component.
  5. purchaser: Canvass Component 1 with three Offers. Mark a winner with a reason. admin-head signs the Canvass.
  6. sales-exec gives Prepared, purchaser Costed, ops-head approves Evaluation (verdicts set first), approver sets Final Acquire and markup and gives Final approved.
  7. sales-exec: set Final Offers under the ABC. approver: Bid Decision Go.
  8. sales-exec: move the SOR from Costing to Bid to Award. Each move passes.
  9. purchaser: set both items to Ordered with PO P02396 and pick the lines.
  10. purchaser: raise the IPAS for P02396, Local, Project, this SOR. Add a payment with proof (finance), a charge, bank details, tick documents.
  11. Sections 1 and 3: purchaser prepares, admin-head approves.
  12. purchaser: raise and submit a Transmittal with both PO lines. plain checks (all GC), technical inspects, plain records Received in Odoo, ops-head and admin-head sign Check by.
  13. purchaser: set both items to Received. Computation status to LC Odoo Done.
  14. ops-head Received, sales-head Noted, approver Checked, approver Approved.
  15. plain: make and pack a Packing List for the SOR.
  16. sales-exec: leave Award.
- **You should see**:
  - Every step works with no refusal.
  - The Dashboard row for this SOR moves To source → To price → To order → On order → To check → gone.
  - Order Monitoring shows the IPAS waiting at each step, then under Filed.
  - Landed Cost on the Components turns final after step 13.
  - The IPAS is filed and frozen.
  - The SOR's PMS tab shows the matrix, the request, the IPAS summary, the slip and the Packing List.

### E2E-02 · Direct purchase
- **Steps**:
  1. plain: open a Direct request with one new product.
  2. purchaser: cancel any live IPAS on P02390 (IPAS-04 leaves one). Take the request, move the item To order → Ordered with PO P02390.
  3. purchaser: raise the IPAS for P02390 as Supplies, no SOR.
  4. Sign sections 1, 3 and 7 as in E2E-01 (Computation status LC Odoo Done first).
- **You should see**: the Dashboard shows the request as "Direct request" until Received. The IPAS files with no SOR.

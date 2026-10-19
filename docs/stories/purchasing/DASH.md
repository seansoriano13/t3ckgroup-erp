# DASH · Purchasing Dashboard

Guide §13. Five groups, worked out on the fly. One SOR can sit in several.

### DASH-01 · Readers
- **Guide**: §13
- **Log in as**: purchaser, finance, super-admin, sales-exec, plain
- **Steps**:
  1. Each opens `/purchasing/dashboard`.
- **You should see**: the first three see rows. sales-exec and plain get no rows. No money anywhere, for anyone.

### DASH-02 · To source
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. Find a request with items at Requested or To order.
  2. Find a Canvass with no winner.
- **You should see**: one row per request (not per item). The Canvass has its own row. "Since" is when the work began.

### DASH-03 · To price
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. On S990002, clear Acquire on one Component.
  2. Look at the matrix row when it has no Bid Decision, then with Revise (CM-15), then with No-go, then with Go.
- **You should see**: the Component shows in To price. The matrix itself shows with no decision and with Revise. With No-go, nothing from that matrix shows in To price or To order.

### DASH-04 · To order
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. With a live Go, find a priced Component with no PO/RFQ number and nothing Ordered.
  2. Type a P.O./RFQ No. on it.
- **You should see**: it is in To order, then leaves it after step 2.

### DASH-05 · On order
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. Find items Ordered on P02401 (IPAS-A), and an Ordered item with no PO.
  2. Click each row.
- **You should see**: one row per IPAS for the P02401 items, which opens the IPAS. One row per request for the no-PO item, which opens the request.

### DASH-06 · To check
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. Find a submitted, unclosed slip naming S990001.
  2. Set an item on IPAS-A's PO to Received while no live slip names IPAS-A (or before TRN-02).
  3. Set an item with no PO to Received.
- **You should see**: steps 1 and 2 show in To check. Step 3 does not (known gap).

### DASH-07 · Direct requests and excluded SORs
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. Find PR-01's request.
  2. Delete a test SOR you made in this run (or mark it scratch), then reload.
- **You should see**: PR-01 shows with project "Direct request". The deleted or scratch SOR's rows are gone.

### DASH-08 · Filters and ageing
- **Guide**: §13
- **Log in as**: purchaser
- **Steps**:
  1. Filter by Buyer purchaser, then by Canvasser purchaser-2 (CNV-16).
  2. Look for late marks.
- **You should see**: filters narrow the rows. Late marks follow Order Monitoring's ageing rules.

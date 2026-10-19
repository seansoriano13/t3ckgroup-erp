# ACC · Access and who sees what

Guide §2, §16 "Access and visibility". Most other files also check access inside their own stories. These are the cross-cutting ones.

### ACC-01 · Purchasing menu per role
- **Guide**: §3
- **Log in as**: purchaser, finance, approver, plain, sales-exec (one after another)
- **Steps**:
  1. For each person, open the side menu and note which Purchasing entries show.
  2. For each person, open `/purchasing/dashboard`, `/purchasing/order-monitoring` and `/purchasing/ipas` by address.
- **You should see**:
  | Person | Dashboard | Order Monitoring | IPAS |
  |---|---|---|---|
  | purchaser | yes | yes | yes |
  | finance | yes | yes | yes |
  | approver (on sign-off lists) | no | no | yes |
  | plain | no | no | no |
  | sales-exec | no | no | no |
  - "No" means the entry is hidden and the address shows nothing (no rows, no data).
  - Everyone sees Purchase Requests (`/purchasing`).

### ACC-02 · Plain employee sees only their own requests
- **Guide**: §3, §6
- **Log in as**: plain, then purchaser
- **Steps**:
  1. As plain, open `/purchasing`. Count the rows.
  2. Open a new Direct request "STORY ACC-02" with one new-product item.
  3. As purchaser, open `/purchasing`.
- **You should see**: plain sees only STORY ACC-02. purchaser sees every request, including the seed ones and STORY ACC-02.

### ACC-03 · Warehouse and Technical never see prices
- **Guide**: §10, §16
- **Log in as**: plain (Warehouse), then technical
- **Needs**: TRN-02 (a submitted slip with a PO line)
- **Steps**:
  1. Open the slip. Read every field.
  2. Try `/purchasing/ipas` and the IPAS id from the slip by address.
- **You should see**: the slip shows IPAS number, PO number, SOR reference and project title. No price, amount or currency figure anywhere. The IPAS itself does not open.

### ACC-04 · Section 7 Noted and Checked get no bank details
- **Guide**: §9 Bank details, §16
- **Log in as**: sales-head (Noted), then admin-head (section 1 list)
- **Needs**: IPAS-11 (bank details typed on IPAS-A)
- **Steps**:
  1. As sales-head, open the IPAS.
  2. As admin-head, open the same IPAS.
- **You should see**: sales-head reads the IPAS but sees no bank name or account number. admin-head sees them.

### ACC-05 · Deal Team sees the IPAS summary, never its money
- **Guide**: §5 What the SOR shows back
- **Log in as**: sales-exec
- **Needs**: IPAS-08 (IPAS-A on S990001 with a payment and a charge)
- **Steps**:
  1. Open SOR S990001, PMS tab, IPAS summaries.
- **You should see**: number, PO, supplier, state, buyer-track ticks, computation status and sign-off progress. No payments, charges, bank details or Landed Cost.

### ACC-06 · Super Admin off a list cannot sign
- **Guide**: §9 Sign-offs, §8, §16
- **Log in as**: super-admin
- **Needs**: IPAS-16 step 1 (section 1 Prepared, waiting for Approved)
- **Steps**:
  1. Open the IPAS. Try to give section 1 Approved.
- **You should see**: refused, or no Approve control. super-admin is on no list.

### ACC-07 · Costing tiers
- **Guide**: §2 Costing tiers
- **Log in as**: approver, purchaser, sales-exec, sales-exec-2 (one after another)
- **Needs**: CM-03 (a matrix on S990002 with Acquire, factor and Final Offer filled)
- **Steps**:
  1. Each person opens SOR S990002, PMS tab, Costing Matrix.
- **You should see**:
  | Person | Tier | Acquire | Markup factor | Final Acquire | Markup Price | Final Offer |
  |---|---|---|---|---|---|---|
  | approver | closed_book | yes | yes | yes | yes | yes |
  | purchaser | cost | yes | no | no | no (only via Canvass projection) | no |
  | sales-exec | price | no | no | no | yes | yes |
  | sales-exec-2 | none | no matrix | | | | |

### ACC-08 · A purchaser loses sight of a request once it has another Buyer
- **Guide**: §6 The request, §16
- **Log in as**: purchaser, then purchaser-2
- **Needs**: an unassigned Project request (PR-05)
- **Steps**:
  1. As purchaser-2, open `/purchasing`, filter Unassigned. Note the request is listed.
  2. As purchaser, Take the request.
  3. As purchaser-2, reload `/purchasing` and open the request's address directly.
- **You should see**: after step 2, purchaser-2 no longer sees the request in the list, and the direct address shows nothing.

# FLOW · Stage Actions, Stage Conditions, the SOR side

Guide §5. These need a Sales Flow with purchasing actions and conditions on its stages. FLOW-00 builds one if the local flows have none.

### FLOW-00 · A test flow (setup)
- **Guide**: §5
- **Log in as**: flow-editor
- **Steps**:
  1. Look for a published Sales Flow that already has "Open Costing Matrix" and "Open Purchase Request" actions. If one exists, write its name in the results and skip the rest.
  2. Otherwise make a flow "STORY FLOW-00" with four stages: Lead, Costing, Bid, Award.
  3. Costing: action "Open Costing Matrix" (Purchasing incharge purchaser, markup preset any) and action "Open Purchase Request" (Buyer purchaser, requesters sales-exec-2). Condition "Costing priced".
  4. Bid: condition "Costing settled".
  5. Award: condition "Purchasing settled".
  6. Publish. Register SOR "Mock Client Story FLOW" as sales-exec on this flow.
- **You should see**: publish works with no warning about the matrix (Costing opens it before Bid needs it).

### FLOW-01 · Entering a stage opens the request
- **Guide**: §5 Stage Actions
- **Log in as**: sales-exec, then purchaser
- **Needs**: FLOW-00
- **Steps**:
  1. Move the FLOW SOR into Costing.
  2. As purchaser, open `/purchasing`.
- **You should see**: one Project request for the SOR, with purchaser as Buyer. purchaser is told (Buyer already named).

### FLOW-02 · Entering a stage opens the matrix
- **Guide**: §5 Stage Actions, §4 step 1
- **Log in as**: sales-exec
- **Needs**: FLOW-01
- **Steps**:
  1. Open the SOR, PMS tab.
- **You should see**: a Costing Matrix exists. Sales incharge is sales-exec (Deal Owner). Purchasing incharge is purchaser. The default factor is the preset's.

### FLOW-03 · Running again only tops up
- **Guide**: §5 Stage Actions
- **Log in as**: sales-exec, purchaser
- **Steps**:
  1. As purchaser, name purchaser-2 as Buyer.
  2. As sales-exec, Revert the SOR to Lead, then move it into Costing again.
  3. Return it (a Return, not a fresh move) and check whether the actions ran.
- **You should see**: after step 2 there is still one request, Buyer still purchaser-2, no member removed. A Return does not re-run the actions.

### FLOW-04 · Stage Participant window
- **Guide**: §5 Stage Actions
- **Log in as**: purchaser-2 (called in), sales-exec-2 (requester, not purchasing)
- **Steps**:
  1. Read the SOR and the request as each.
- **You should see**: a purchasing member gets a participant window on that visit. Other members read only the request and the SOR's locked header.

### FLOW-05 · Only the Deal Team runs the actions
- **Guide**: §5 Stage Actions
- **Log in as**: sales-exec-2
- **Steps**:
  1. Try to move an SOR where sales-exec-2 has no edit access.
- **You should see**: refused, and no request or matrix appears.

### FLOW-06 · Costing priced blocks leaving Costing
- **Guide**: §5 Stage Conditions
- **Log in as**: sales-exec, purchaser
- **Steps**:
  1. Try to move the SOR from Costing to Bid with an empty matrix.
  2. As purchaser, add a Component without Acquire. Try again.
  3. Add Acquire to every Component and cost-only row. Try again.
- **You should see**: steps 1 and 2 blocked. Step 3 passes.

### FLOW-07 · Costing settled
- **Guide**: §5 Stage Conditions
- **Log in as**: sales-exec, approver, ops-head
- **Steps**:
  1. Try to leave Bid with a Final Offer missing.
  2. Fill everything but leave the Final Offer total above the ABC. Try again.
  3. Fix the total, approve Evaluation, take a Bid Decision of Revise. Try again.
  4. Take Go. Try again.
- **You should see**: steps 1 to 3 blocked. Step 4 passes and stamps the bid as submitted.

### FLOW-08 · After the bid, a Final Offer change writes a timeline entry
- **Guide**: §5 Edge cases
- **Log in as**: sales-exec
- **Needs**: FLOW-07
- **Steps**:
  1. Change a Final Offer. Open the SOR timeline.
- **You should see**: a timeline entry with no figures.

### FLOW-09 · Purchasing settled
- **Guide**: §5 Stage Conditions
- **Log in as**: sales-exec, purchaser
- **Steps**:
  1. With one item still Ordered, try to leave Award.
  2. Receive the item. Try again.
  3. On another SOR with no request at all, try to leave a stage with this condition.
- **You should see**: step 1 blocked. Steps 2 and 3 pass.

### FLOW-10 · No reasons for callers without a money tier
- **Guide**: §5 Edge cases
- **Log in as**: a Stage Participant with no price tier
- **Steps**:
  1. Look at why "Costing settled" is unmet.
- **You should see**: only met or unmet. No reasons, no figures.

### FLOW-11 · Revert and Return are never blocked
- **Guide**: §5 Edge cases
- **Log in as**: sales-exec
- **Steps**:
  1. With an unmet condition, Revert the SOR, then Return it.
- **You should see**: both work.

### FLOW-12 · Warning when no earlier stage opens the matrix
- **Guide**: §5 Edge cases
- **Log in as**: flow-editor
- **Steps**:
  1. Copy STORY FLOW-00 as "STORY FLOW-12". Remove "Open Costing Matrix" from Costing. Publish.
- **You should see**: a warning that "Costing settled" has no matrix to read. Do not use this flow afterwards.

### FLOW-13 · SOR tabs show the Buyer and item statuses
- **Guide**: §5 What the SOR shows back
- **Log in as**: sales-exec-2 (can read the SOR, not a request member)
- **Steps**:
  1. Open the FLOW SOR's Items tab and Journey.
- **You should see**: the Buyer and item statuses, even though sales-exec-2 is not a member.

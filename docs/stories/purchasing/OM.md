# OM · Order Monitoring

Guide §12. It shows every open IPAS with its one next thing, owner and wait. Ageing rules: SET-05 set `check_open`, `no_transmittal` and `ready_to_file` to 1 day.

### OM-01 · Four groups
- **Guide**: §12
- **Log in as**: purchaser
- **Steps**:
  1. Open `/purchasing/order-monitoring`.
- **You should see**: Needs chasing, Waiting on us, Waiting on someone else, and Filed (collapsed). Cancelled IPAS do not show.

### OM-02 · Nothing is late without a rule
- **Guide**: §12
- **Log in as**: purchaser
- **Steps**:
  1. Clear every ageing rule (note the old values). Reload.
  2. Put the SET-05 values back.
- **You should see**: after step 1, Needs chasing is empty.

### OM-03 · Decision order
- **Guide**: §12
- **Log in as**: purchaser
- **Steps**:
  1. For each IPAS below, read its next thing and owner.
- **You should see**:
  | Situation | Next thing | Owner |
  |---|---|---|
  | A line rated NA, not cleared (TRN-04) | resolve with supplier | Purchasing |
  | Slip still at checking | checking | Warehouse, then Technical |
  | Slip awaiting Check by | Check by | Check by signers |
  | Status LC Odoo Done, not filed | ready to file | section 7 signers |
  | Delivered typed, no Transmittal | raise a Transmittal | Purchasing |
  | Same, but a draft Transmittal exists | (not the Transmittal step) | |
  | Import IPAS-B, Import Clearance blank | Import Clearance | Others |
  | Payment with no proof | With P.O.P | Finance |
  | Everything ticked, costs not complete | Costs not complete | Purchasing |
  - When two apply, the higher row wins.

### OM-04 · Late and Waiting on someone else
- **Guide**: §12
- **Log in as**: purchaser
- **Steps**:
  1. Find an IPAS whose step has waited more than its rule (any seed IPAS more than 1 day old on `check_open`).
  2. Find IPAS-B waiting on Import Clearance with no rule on that step.
- **You should see**: step 1 is in Needs chasing. Step 2 is in Waiting on someone else.

### OM-05 · Import waits start at Arrived in PH
- **Guide**: §12
- **Log in as**: purchaser
- **Steps**:
  1. On IPAS-B, set Arrived in PH to today. Read the wait on later steps.
- **You should see**: 0 days, counted in Manila calendar days.

### OM-06 · The SOR agrees with Order Monitoring
- **Guide**: §5 What the SOR shows back
- **Log in as**: sales-exec, then purchaser
- **Steps**:
  1. Open S990001's "where orders stand".
  2. Compare with IPAS-A's row in Order Monitoring.
- **You should see**: the same next thing. The SOR shows dates and Transmittal facts only, no money.

### OM-07 · Readers
- **Guide**: §3
- **Log in as**: finance, approver, plain
- **You should see**: finance can open it. approver and plain cannot.

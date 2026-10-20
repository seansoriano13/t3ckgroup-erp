# TRN · Transmittals (TG03 slips)

Guide §10. Lists: Warehouse = plain, Technical = technical, Logistics = logistics, Check by = ops-head and admin-head.

### TRN-01 · Who can prepare
- **Guide**: §10 Raising and submitting
- **Log in as**: purchaser, plain, logistics, technical, sales-exec
- **Steps**:
  1. Each person opens `/purchasing/transmittals/new`.
- **You should see**: purchaser, plain and logistics can raise a draft. technical and sales-exec cannot.

### TRN-02 · Raise and submit a slip with a PO line
- **Guide**: §10 Raising and submitting
- **Log in as**: purchaser
- **Needs**: IPAS-A (P02401). SET-04.
- **Steps**:
  1. New Transmittal: origin Purchasing, priority High, Company the same as IPAS-A's entity, product "STORY SET-04 Product", reference "STORY SET-04 Ref", checks Warehouse and Technical.
  2. Submit with no lines.
  3. Add a PO line from IPAS-A and a typed line "STORY TRN-02 extra cable".
  4. Submit.
- **You should see**: step 2 refused. The number (`TG03-` plus a number) was already given when the draft was created, and does not change on submit. After step 4 the state is warehouse checking. The draft never showed on the SOR; the submitted slip now shows on S990001 without remarks or files. Prepared shows the real time, in Manila time (a slip made at 5 PM does not read 08:00 AM).

### TRN-03 · Different company warning
- **Guide**: §10 Raising and submitting
- **Log in as**: purchaser
- **Steps**:
  1. On a draft with an IPAS-A line, pick the Company that matches the IPAS entity. (The Company is a fixed list, so there is no odd-case or extra-spaces case to try.)
  2. Pick a different company.
- **You should see**: no warning in step 1. A warning in step 2, but it does not block.

### TRN-04 · Warehouse checking
- **Guide**: §10 Stages
- **Log in as**: plain, then purchaser
- **Needs**: TRN-02
- **Steps**:
  1. As plain, rate the PO line NA with no remark → refused. Add remark "STORY TRN-04 dented box".
  2. Rate the typed line GC. Record a received quantity only on the PO line (1 less).
  3. Try to sign with no picture and no "no pictures" reason → refused.
  4. Add a picture. Sign as first signatory. Pick plain as the second as well.
  5. As purchaser, check notifications. As ops-head, check notifications.
- **You should see**: the stage moves on as soon as it is signed. The co-signer's slot only waits for their confirmation (it is not needed for the slip to move on) and the stored signature prints once confirmed. Both purchaser (preparer) and the Check by list are told about the NA line.

### TRN-05 · Co-signer declines
- **Guide**: §10 Signing rules
- **Log in as**: super-admin, plain, logistics
- **Steps**:
  1. As super-admin, add logistics to the Warehouse list.
  2. On a new slip, as plain, sign Warehouse checking and name logistics as the second signatory.
  3. As logistics, decline.
  4. As super-admin, remove logistics from the Warehouse list.
- **You should see**: the completer is told. The declined signature never prints.

### TRN-06 · Technical inspection records a short delivery
- **Guide**: §10 Stages
- **Log in as**: technical
- **Steps**:
  1. Rate the Technical lines. Record a quantity on a Technical-only slip (raise one if needed).
  2. Sign both slots.
- **You should see**: the quantity saves. The slip moves on to awaiting Check by.

### TRN-06b · Warehouse releasing: optional alone, required before Technical
- **Guide**: §10 Stages
- **Log in as**: purchaser, plain, technical
- **Steps**:
  1. As purchaser, raise and submit a slip with a typed line, checks **Warehouse only**.
  2. As plain, sign Warehouse checking. Look at the slip's stages and at Check by.
  3. As purchaser, raise and submit a second slip with checks **Warehouse and Technical**.
  4. As plain, sign Warehouse checking. Then, as technical, try to sign Technical inspection.
  5. As plain, sign Warehouse releasing as Released by. Name a Technical list member as the other signatory.
  6. As technical, sign Technical inspection.
- **You should see**:
  - Step 2: on the Warehouse-only slip, Warehouse releasing is marked Optional. The slip goes straight to awaiting Check by, and releasing never blocks Check by.
  - Step 4: on the Warehouse and Technical slip, releasing is required. After Warehouse checking the slip waits on release, and Technical inspection cannot be signed yet (refused: it is not open).
  - Step 5: the other signatory must be on the Technical list.
  - Step 6 now works, and the slip moves to awaiting Check by.

### TRN-07 · Received in Odoo is needed before Check by on a PO slip
- **Guide**: §10 Stages
- **Log in as**: ops-head, then plain
- **Steps**:
  1. As ops-head, try Check by while "Received in Odoo by" is blank.
  2. As plain, record Received in Odoo by.
- **You should see**: step 1 refused. Step 2 saves.

### TRN-08 · Check by rules
- **Guide**: §10 Signing rules
- **Log in as**: super-admin, purchaser, ops-head, admin-head
- **Steps**:
  1. As super-admin, add purchaser to the Check by list. As purchaser (who prepared this slip), try to sign Check by → refused. As super-admin, remove purchaser from the list again.
  2. As ops-head, open `/approvals/transmittals`. Sign the first slot.
  3. As ops-head, try the second slot too → refused.
  4. As admin-head, sign the second slot.
- **You should see**: the slip closes after step 4 and the preparer is told.

### TRN-09 · Closed is frozen
- **Guide**: §10 Freezes and undo
- **Log in as**: purchaser, plain
- **Steps**:
  1. Try to edit remarks, ratings, pictures, lines.
  2. Try to cancel.
- **You should see**: every change refused. A Check by slot can still decline its stored signature.

### TRN-10 · Undo, latest first
- **Guide**: §10 Freezes and undo
- **Log in as**: admin-head, then plain
- **Steps**:
  1. As plain, try to undo the Warehouse signature on the closed slip → refused (later stages signed).
  2. As admin-head, undo the second Check by with reason "STORY TRN-10".
  3. As plain, try to undo Received in Odoo while one Check by is still signed → refused.
- **You should see**: step 2 reopens the slip to awaiting Check by. The old signature stays in history.

### TRN-11 · Cancel
- **Guide**: §10 Raising and submitting
- **Log in as**: purchaser
- **Steps**:
  1. Submit a new slip. Cancel with no reason → refused. Cancel with "STORY TRN-11".
  2. On another slip with one stage signed, try to cancel.
- **You should see**: step 1 works. Step 2 refused.

### TRN-12 · NA cleared by a later slip
- **Guide**: §10 What a Transmittal feeds, §12
- **Log in as**: purchaser, plain
- **Needs**: TRN-04 (NA on a P02401 line)
- **Steps**:
  1. Raise and submit a new slip with the same Odoo PO line.
  2. As plain, rate it GC at checking.
  3. Open Order Monitoring.
- **You should see**: IPAS-A's hand-off moves from na to na_replaced, then gc, and the "resolve with supplier" row goes away.

### TRN-13 · Evidence rules
- **Guide**: §10 Signing rules
- **Log in as**: plain, then technical
- **Steps**:
  1. During Warehouse checking, as plain, upload a video under 50 MB.
  2. As technical (another list), try to upload to the Warehouse stage.
  3. After the stage is signed, as plain, try to upload again.
- **You should see**: step 1 works. Steps 2 and 3 refused.

### TRN-14 · IPAS part 5 and derived ticks
- **Guide**: §9, §10
- **Log in as**: purchaser
- **Steps**:
  1. Open IPAS-A part 5 and part 7.
- **You should see**: the slips that name IPAS-A are listed. Delivered and Actual Checking are derived from them.

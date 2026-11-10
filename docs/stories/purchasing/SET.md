# SET · Settings

Guide §14. Run these first: later stories rely on SET-05 (ageing rules).

### SET-01 · Purchasing tab is for Purchasing and Super Admin only
- **Guide**: §3, §14
- **Log in as**: purchaser, then finance, then plain
- **Needs**: nothing
- **Steps**:
  1. As purchaser, open `/settings?tab=purchasing`.
  2. As finance, open the same address.
  3. As plain, open the same address.
  4. As plain, open `/purchasing/ipas/settings`.
- **You should see**:
  - purchaser sees the Purchasing tab with option lists, Transmittal lists, Ageing rules and Reference rates.
  - purchaser does **not** see Sign-off lists or the first Transmittal number (Super Admin only).
  - finance and plain do not get the Purchasing tab.
  - plain is sent to the home page from `/purchasing/ipas/settings`.

### SET-02 · Option lists: add, reorder, deactivate, never delete
- **Guide**: §14
- **Log in as**: purchaser
- **Needs**: nothing
- **Steps**:
  1. Open Settings, Purchasing tab, Payment methods.
  2. Add "STORY SET-02 Method".
  3. Try to add "story set-02 method" (same name, other case).
  4. Move "STORY SET-02 Method" up one place.
  5. Deactivate it.
  6. Look for a delete control on any option.
- **You should see**:
  - Step 2 saves.
  - Step 3 is refused as a duplicate.
  - The new order stays after a page reload.
  - The deactivated option is still listed as inactive.
  - There is no way to delete an option.

### SET-03 · Document kinds carry Source and use
- **Guide**: §14
- **Log in as**: purchaser
- **Steps**:
  1. Add a document kind "STORY SET-03 Doc" set to Import only, Filing.
  2. Reload.
- **You should see**: it shows Import and Filing after the reload. (IPAS-03 checks it appears only on an Import IPAS.)

### SET-04 · Transmittal option lists
- **Guide**: §14
- **Log in as**: purchaser
- **Steps**:
  1. In Transmittal lists, add "STORY SET-04 Product" to Product and "STORY SET-04 Ref" to Reference Checklist.
- **You should see**: both save and show as active.

### SET-05 · Ageing rules take only positive whole numbers
- **Guide**: §12, §14
- **Log in as**: purchaser, then plain
- **Steps**:
  1. Open Ageing rules. Note that every step starts blank (if a story run before set them, note the values).
  2. Type `0` on one step and save.
  3. Type `-3` and save.
  4. Type `2.5` and save.
  5. Type `1` on the steps `check_open`, `no_transmittal` and `ready_to_file`, and save.
  6. As plain, find any screen that shows the ageing rules, or confirm none is offered.
- **You should see**:
  - Steps 2 to 4 are refused.
  - Step 5 saves and stays after reload.
  - There is no delete control for a rule. Clearing a value back to blank is allowed.

### SET-06 · Reference rates are shown with their date
- **Guide**: §14
- **Log in as**: purchaser, then super-admin
- **Steps**:
  1. As purchaser, open Reference rates.
  2. As super-admin, override USD with `58.00` for today.
  3. As super-admin, override AUD with `38.00` for today.
- **You should see**:
  - Before step 3, only USD and EUR are listed (they are fetched by default). A fetch must have run first (README step 6).
  - Each rate shows its date. Nothing says "live".
  - purchaser cannot override. super-admin can, and the override is marked as an override.
  - Step 3 is allowed: a Super Admin can override any currency. AUD then appears in the list, and a new AUD Offer pre-fills its comparison rate from it.

### SET-07 · Sign-off lists are Super Admin only, and logged
- **Guide**: §9 Sign-offs, §14
- **Log in as**: super-admin, then purchaser
- **Steps**:
  1. As super-admin, open Sign-off lists. Add sales-exec-2 to section 1 Approved.
  2. Remove sales-exec-2 again.
  3. Open "Who changed the lists".
  4. As purchaser, look for Sign-off lists.
- **You should see**:
  - The list is named as the screen numbers it: "Section 1 Approved".
  - The history shows both changes, newest first, with super-admin as the one who made them, and shows each list's name (not a stored key such as `transmittal_check_by`).
  - purchaser has no Sign-off lists screen.

### SET-08 · First Transmittal number is set once, before any Transmittal
- **Guide**: §10, §14
- **Log in as**: super-admin
- **Needs**: run before TRN stories. If Transmittals already exist locally, only step 2 applies.
- **Steps**:
  1. If no Transmittal exists, set the first number to `5000`.
  2. After one Transmittal exists, try to change it to `6000`.
- **You should see**: step 1 saves. Step 2 is refused.

### SET-09 · Costing Matrix settings
- **Guide**: §7 Money maths, §14
- **Log in as**: finance, then purchaser
- **Steps**:
  1. As finance, open the Costing Matrix settings. Read the rates.
  2. As purchaser, try to edit the rates.
- **You should see**:
  - Defaults are VAT divisor 1.12, tax 6%, retention 1%, ITR 8%, ITR allowance ₱250,000 (unless someone changed them; note the values).
  - finance can edit. purchaser cannot.

### SET-10 · Markup presets
- **Guide**: §7 Money maths, §14
- **Log in as**: approver, then purchaser
- **Steps**:
  1. As approver, add a markup preset "STORY SET-10" with factor `1.30`.
  2. Deactivate it. Look for delete.
  3. As purchaser, look for the presets editor.
- **You should see**: approver can add and deactivate, never delete. purchaser cannot edit presets.

### SET-11 · Option label used by a filed IPAS cannot be renamed
- **Guide**: §9 Filing
- **Log in as**: super-admin
- **Needs**: IPAS-22 (a filed IPAS) that used a payment method.
- **Steps**:
  1. Try to rename that payment method.
  2. Deactivate it, then activate it again.
  3. Add a new option.
- **You should see**: the rename is refused, even for super-admin. Steps 2 and 3 work.

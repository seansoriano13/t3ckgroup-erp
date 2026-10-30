# Transmittals & Packing Lists (#251): browser test scenarios

Spec #251, tickets #252–#260. Local stack. Tick each box; write feedback under the scenario as `> note`.

## 0. Setup

1. `supabase start`, `pnpm dev`. Mock cast + lists: `node scripts/seed-mock-employees.mjs --local` (already run 2026-10-15).
2. Sign in with **email + password** (not magic login). Password for all: `MockStaging#2026`. Use a second browser / incognito for the other person in two-signer steps.
3. Cast (`@staging`, see docs/mock-employees.md):

| Login | Plays |
|---|---|
| super-admin | Super Admin (settings, first number) |
| purchaser | Purchasing access → preparer |
| finance | Finance access (read only) |
| plain | **Warehouse list** |
| technical | **Technical list** |
| logistics | **Logistics list** |
| ops-head | **Check by**, call sign 1001 |
| admin-head | **Check by**, call sign 102 |
| sales-exec | Deal Owner of SOR **S07761** |
| sales-exec-2 | other sales, can't read S07761 |
| hr / leave-manager | no access (negative checks) |

4. Test data: one IPAS **TGIPAS_049** (PO **P02692**, 1 PO line, SOR S07761). Need more PO lines / a 2nd IPAS → needs Odoo (`supabase functions serve odoo-po-ipas`).

## 1. Settings & first number (#252) — your feedback 2026-10-15, fixed

- [x] 1.1 Option lists. Fixed: adding to Transmittal products / references said "Pick a list." (service didn't know those lists). Fixed: tab strip overflowed; now scrolls with edge fades.
- [x] 1.2 Staff lists. Fixed: adding said "That isn't a sign-off list." (service + test stub didn't know the 4 keys).
- [x] 1.3 First number set.
- [x] 1.4 Fixed wording: once a slip exists the field is replaced by "Numbering started at TG03-N. It can't change now that a Transmittal has been raised."; a late refusal reads "TG03 numbering has already started, so the first number can't be changed." Every DB refusal now drops its function-name prefix (was only `ipas_*`).
- [x] General: field labels were 16px. `cn()` (tailwind-merge) dropped `text-label` as a colour clash, app-wide. Now 11px everywhere `text-label` meets a text colour — **review other screens too.**

## 2. Nav & access — browser-run 2026-10-15

- [x] 2.1 Nav matches spec for purchaser, finance, super-admin, plain, technical, logistics, ops-head.
- [x] 2.2 hr: no nav; `/purchasing/transmittals` returns no rows. Copy says "No Transmittals yet" (misleading — they exist, hr just can't see them).

## 3. Raise & submit (#252) — browser-run 2026-10-15

**A. Warehouse + Technical slip (main path)** — purchaser → TG03-2
- [x] 3.1 Header tick rows OK. *Local only:* Product/Reference options were missing (seed snapshot predates the migration); re-inserted.
- [x] 3.2 Neither ticked → "Tick Warehouse or TCA Technical to submit."
- [x] 3.3 PO line: name with code, 512 pc, SOR S07761 prefilled, Company → TG Enterprise.
- [x] 3.4 Company changed → warning toast "P02692 is on a different Company…", still saved.
- [x] 3.5 Typed line + SN# + Quantity of Box saved.
- [x] 3.6 Edit draft (company, +BM) persisted.
- [x] 3.7 Submit → "Waiting on Warehouse", Edit gone, plain notified.

**B. Others**
- [x] 3.8 plain → TG03-3. Origin defaults Warehouse. Picker: no prices/supplier/bank (checked response).
- [x] 3.9 logistics → TG03-4, Technical only, typed line → "Waiting on Technical".
- [x] 3.10 Cancel with reason → Cancelled, reason shown, readable. Sequence moves on (no reuse).
- [x] 3.11 logistics opens plain's draft → read only, no Edit/Submit/Cancel.

**Findings**
- **FIXED (migration 20261015400000):** Warehouse/Logistics preparers (no Purchasing) see **no Product, Reference Checklist or Item Location options**. `ipas_options_read` = `ipas_can_read()`, which excludes `transmittal_*` lists.
- Company is free text, not a pick of the 4 entities → typos possible.
- Quantity of Box / SN# inputs too narrow ("3 boxe" cut off).
- Notification copy: "TG03 TG03-2 was submitted and is waiting on warehouse." (doubled TG03, lowercase stage).
- Submit has no confirm; page shows "Draft" ~2 s after the "submitted" toast before it refreshes.
- Draft / cancelled pages still show stage cards ("…while checking is open", Received in Odoo "Not yet") — noise.
- Missing priority → only a toast "Pick a Priority."; field not highlighted.
- Unverified: a burst of repeated `employees` + `ipas_signer_lists` fetches around sign-in (none at idle).

## 4–14 — browser-run 2026-10-15 (TG03-2 end to end; TG03-33 typed Warehouse-only via RPC; PKL_007)

| # | Result |
|---|---|
| 4.2 NA needs remark | ✓ refused |
| 4.3 qty received | ✓ saved |
| 4.5 no file + no reason | ✓ blocked; 51 MB file refused |
| 4.6 sign checking | **was blocked** — see B1, fixed |
| 4.7 freeze + move to releasing | ✓ |
| 4.8 NA notifies preparer + Check by | ✓ |
| 4.9 co-signer confirm | ✓ |
| 5.1 Received by = Technical list only | ✓ |
| 5.2 → Technical inspection, technical notified | ✓ |
| 5.3 W-only: optional releasing w/ typed driver, never blocks | ✓ (RPC) |
| 6.1 Received in Odoo by purchaser + ref | ✓ |
| 6.2 technical/logistics can't | ✓ (no form) |
| 7.1–7.4 Technical rate/sign → Awaiting Check | ✓ |
| 8.1 no receipt → Check refused | ✓ (DB) — UI still offers the button |
| 8.2 preparer / Super Admin can't check | ✓ |
| 8.3 same person can't take slot 2 | ✓ |
| 8.4 second check closes, preparer notified | ✓ |
| 8.5 typed-only closes without receipt | ✓ (RPC) |
| 9.1 filters | ✓ Has NA works; see B6 |
| 10.1 IPAS lists TG03-1/2 (draft excluded), NA count | ✓ |
| 10.2 Delivered stamped from TG03 | ✓ |
| 10.3 Actual Checking "pending (1 of 2)" | ✓ |
| 11.1–11.3 PKL create/boxes/contents/pack, empty box refused | ✓ as purchaser; see B2–B4 |
| 11.4 technical/logistics/hr can't create | ✓ (RPC) |
| 12.1 Deal Owner sees slips + PKL, no remarks/files | ✓; see B7 |
| 12.2 non-reader gets nothing | ✓ (hr/plain); sales-exec-2 can read that SOR so sees it — correct |
| 13.1–13.3 TG03 print | ✓ layout; see B8 |
| 13.5–13.6 TSR print | see B5 |
| 13.7 Packing List print | ✓ "1 of 2 boxes weighed" |
| 14.1 release notes | in What's New popup; Release Notes page window still ends 30 Sep (bump at prod merge) |

### Bugs

- **B1 FIXED** Stage signing refused the same person as both signatories (DB + UI + test), contrary to spec #251. With one Warehouse member nobody could sign. Migration `20261015500000_transmittal_same_signatory.sql`, UI picker, stub, service + policy tests.
- **B2 FIXED** Warehouse member can't start a Packing List: SOR picker calls `ipas_find_sors` → 403, silently (no error, no results).
- **B3 FIXED** "Pick from the SOR's Product List" never appears for packers: `sales_opportunity_items` is deal-team only, so the list is empty for Purchasing/Warehouse.
- **B4 FIXED** Add-a-box dialog keeps the previous box's marks/seal/weight (box 2 inherited box 1's).
- **B5 FIXED** TSR "Noted by" prints the Technical inspector; spec says optional Purchasing block.
- **B6 FIXED** No sidebar entry for the Approval Center Transmittal Check by queue (`/approvals/transmittals`); Check by members reach it only via notification/URL. Queue row headline is the Company, not TG03-n.
- **B7 FIXED** SOR section lists a **draft** slip (TG03-3) to the Deal Owner, and omits the date (spec: number, date, priority, state, NA count).
- **B8 FIXED** Printed tick boxes misaligned (✕ glyph overflows `.box`); Check by call signs float top-right, not beneath the plates.

Fixes: migration `20261015600000_handoff_walkthrough_reads.sql` (B2, B3, B7: `ipas_find_sors` open to the Warehouse list, new `packing_list_sor_products`, drafts left out of `handoffs_for_sor`); box dialog remounts per open (B4); TSR Checked by = Inspected by, Noted by blank for Purchasing (B5); "Transmittal Check by" nav for the Check by list, queue rows lead with TG03-n (B6); SOR rows show the date (B7); print tick boxes and Check by plates/call signs (B8).

### Smaller issues (fixed unless marked)

- FIXED: Raw DB errors on the Transmittal page keep the prefix: "transmittal_rate: an NA needs a remark", "transmittal_check: TG03-2 is a PO slip; record Received in Odoo first", "packing list: PKL_007 has 2 box(es) with no contents". The page doesn't use `ipasErrorMessage`.
- FIXED: Check by buttons enabled before Received in Odoo; now disabled with a hint.
- FIXED: Line NA remarks and qty received weren't shown once the stage was signed; now under each line.
- FIXED: List filter dropdown clipped labels; added Priority filter and NA column.
- FIXED: "A file is 50 MB or less." → "Each file must be 50 MB or less."
- FIXED: Notification copy doubled the prefix ("TG03 TG03-2…") and lowercased stage names.
- FIXED: Signed stages still showed "Lines are rated … while checking is open."
- FIXED: Transmittal/TSR prints now say "name only, no signature on file" like the IPAS and Packing List prints.
- FIXED: Super Admin saw Cancel/Edit/Record receipt the DB refuses them; UI now follows the DB (preparer or Purchasing; Warehouse or Purchasing for the receipt).
- NOT FIXED: What's New popup announces Packing List printing to everyone. The changelog has no audience field; targeting is a feature, needs your call.
- Local only: policy-test runs leave fixture slips and burn TG03/PKL sequence numbers.
- FIXED (found while fixing): the new options-read policy ran its helpers per row (5.4 s for 10 rows); now evaluated once per query (~0.4 s). Root cost: `get_employee_id()` takes ~30 ms per call locally — affects every policy that calls it per row.
- FIXED: policy tier's cast teardown failed when `sor_stage_participants` held fixture rows; teardown now clears them.
- NOT FIXED (pre-existing): `67-ipas-sor-lookup-locked-summary` can't seed its SOR (`sales_opportunities_flow_pairing_chk`).

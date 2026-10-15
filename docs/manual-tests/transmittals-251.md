# Transmittals & Packing Lists (#251): browser test scenarios

Spec #251, tickets #252–#260. Local stack. Tick each box; write feedback under the scenario as `> note`.

## 0. Setup

1. `supabase start`, `pnpm dev`. Mock cast + lists: `node scripts/seed-mock-employees.mjs --local` (already run 2026-10-15).
2. Sign in with **email + password** (not magic login). Password for all: `MockStaging#2026`. Use a second browser / incognito for the other person in two-signer steps.
3. Cast (`@mock.t3ck.test`):

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

## 2. Nav & access (#251 access)

- [ ] 2.1 "Transmittals" nav shows for: purchaser, finance, super-admin, plain, technical, logistics, ops-head. "Packing Lists" shows for purchaser, finance, super-admin, plain — **not** technical/logistics.
- [ ] 2.2 hr: no nav entries; opening `/purchasing/transmittals` directly shows nothing / refused.

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

## 4. Warehouse checking (#253) — slip A, as plain

- [ ] 4.1 Rating columns editable only for Warehouse; TCA columns locked.
- [ ] 4.2 Rate a line **NA** with no remark → refused. Add remark → ok. Other line GC.
- [ ] 4.3 Record **quantity received** on one line (different from sent).
- [ ] 4.4 Try to sign with a line unrated → refused.
- [ ] 4.5 Sign with **no pictures and no reason** → refused. Upload a photo + a video (≤50 MB; try >50 MB → refused with message). "Provided Pictures & Videos" = Yes.
- [ ] 4.6 Sign as Received by, name the co-signer (Inspected by) — pick plain again (same person allowed). Date/time recorded.
- [ ] 4.7 After signing: ratings, remarks, files locked. Slip moves to **Warehouse releasing** (required because both ticked).
- [ ] 4.8 NA notification reached purchaser + ops-head + admin-head.
- [ ] 4.9 Co-signer confirm: if a different co-signer named, they see "confirm" and can confirm or decline stored signature.

## 5. Warehouse releasing (#253)

- [ ] 5.1 As plain: Released by = plain; Received by must be on **Technical list** (technical). Pick a non-Technical person → refused.
- [ ] 5.2 Sign → state **Technical inspection**; technical gets notification.
- [ ] 5.3 On a **Warehouse-only** slip: releasing is optional, can be opened and signed any time before close, Received by = any employee or **typed name** (driver). Never blocks Check by.

## 6. Received in Odoo (#253)

- [ ] 6.1 plain or purchaser signs "Received in Odoo by" with ref `WH/IN/01234`. Available from submission onward.
- [ ] 6.2 technical / logistics cannot sign it.

## 7. Technical inspection (#254) — as technical

- [ ] 7.1 TCA in-charge + GC/NA per line; NA needs remark; Warehouse ratings visible but locked.
- [ ] 7.2 Inspection Remarks & Recommendations, files or No-reason, sign Received by + Inspected by.
- [ ] 7.3 plain can NOT rate/sign Technical stage.
- [ ] 7.4 After sign → **Awaiting Check**.

## 8. Check by (#254)

- [ ] 8.1 ops-head: `/approvals/transmittals` lists the slip. Slip **without** Received in Odoo → Check refused (test before step 6 on another slip).
- [ ] 8.2 purchaser (preparer) can't Check. super-admin (not on list) can't Check.
- [ ] 8.3 ops-head signs slot 1; ops-head can't sign slot 2.
- [ ] 8.4 admin-head signs slot 2 → **Closed**; purchaser notified. Everything on the slip locked.
- [ ] 8.5 Typed-only slip (3.9) closes without Received in Odoo.

## 9. Lists & filters (#252)

- [ ] 9.1 `/purchasing/transmittals`: filters state, stage, waiting on Warehouse / Technical, awaiting my Check by (as ops-head), prepared by me, priority, has NA. Priority chips, NA marks, TG03 numbers.

## 10. IPAS reads (#256) — `/purchasing/ipas/<TGIPAS_049>` as purchaser/finance

- [ ] 10.1 Section 5 lists slips carrying its PO line, date order, number/date/priority/stage/NA count, links work.
- [ ] 10.2 **Delivered** stamped from first-stage signature, marked "stamped".
- [ ] 10.3 **Actual Checking**: "Pending (n of m)" while Technical not signed; stamped after; hand-stamp refused once a slip submitted.
- [ ] 10.4 **Item Location** follows latest slip past first stage; typed override wins.

## 11. Packing Lists (#255)

- [ ] 11.1 As plain: `/purchasing/packing-lists` → new, SOR S07761 → number `PKL_001`-style.
- [ ] 11.2 Add 2 boxes (no., marks, seal no., weight on one only). Contents typed + picked from SOR Product List.
- [ ] 11.3 Pack with zero boxes / empty box → refused. Pack → Packed by stamped, everything locked.
- [ ] 11.4 technical / logistics / hr can't create.

## 12. SOR section (#257)

- [ ] 12.1 sales-exec opens SOR S07761: Transmittals + Packing Lists section — number, date, priority, stage, NA count; PL number, state, box count, delivery ref. **No remarks, ratings remarks, files.**
- [ ] 12.2 sales-exec-2 (can't read the SOR): sees nothing.
- [ ] 12.3 SOR with no slips: section hidden.

## 13. Printing (#258, #259, #260)

- [ ] 13.1 Draft → no Print. Submitted → Print (TG03 A4): header, TN, "To be checked by Technical" box, tick rows, grid padded to paper length, legend GC/NA, 3 sections, Received in Odoo, Check by plates with **1001 / 102** under them.
- [ ] 13.2 Unrated / unsigned cells blank. Warehouse-only slip prints Technical section struck through.
- [ ] 13.3 Many lines → 2nd page, header repeated.
- [ ] 13.4 Signatures: stored sig prints as image; declined / unconfirmed co-signer → name only; waiting → blank.
- [ ] 13.5 **Print TSR** (Technical slips): one A4, units per serial with verdict/remark, evidence summary ("2 photographs, 1 video (00:42)"), failure footer.
- [ ] 13.6 **Print with photographs**: photos embedded, no video.
- [ ] 13.7 Packing List print: box by box, footer box count + "total … of N boxes weighed", Packed by.

## 14. Release notes

- [ ] 14.1 Release Notes page has entries for these features.

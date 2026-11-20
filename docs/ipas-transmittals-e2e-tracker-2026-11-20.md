# IPAS, Transmittals and Packing Lists E2E tracker (2026-11-20)

A Playwright pass over the **IPAS, Transmittals and Packing Lists** module (the IPAS list and record, Raise an IPAS, the IPAS approvals queue, Raise a Transmittal, the Transmittal record and its stages, Check by, Packing Lists) on the hosted staging site (commit `a22f306f`), driven with `playwright-cli` and small Node scripts that call the API with each person's own login.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1123** and its sub-issues (see the Ticket column).

**How it was checked**

- 13 mock logins on staging: Ayla and Micko (Purchasing), Jelai (Finance), Jen (head, section 1 and 2 approver, Check by, Filing approver), Gracean (Received, Check by), Maey (Noted), 201 (Checked, Filing approver), Alvin (Logistics), Jade (Warehouse list), Oliver (Technical list), Dani and Aldrin (Sales, no Purchasing access), 101 (Super Admin, on no list).
- The "(staging)" people are on no sign-off list on staging (only the "demo" cast is). For the pass, 101 added them to the lists the way the local seed does, and the lists were put back exactly as they were at the end (checked: same members as the saved copy).
- Raised TGIPAS_078 (P01048, Import, Inventory) in the browser and took it through sections 1, 2 and 3 with returns, an undo and refusals. Raised TGIPAS_079 (P01050, Local, Supplies) with four parallel raise calls, took it to filing, and Jen filed it from the Approval Center. Reopened it as the Super Admin.
- Raised Transmittal TG03-6 in the browser (Warehouse and Technical), rated NA with a remark, signed Warehouse checking, releasing, Technical inspection, Received in Odoo and both Check by, with undo steps. TG03-10 closed the same way for TGIPAS_079. TG03-7 tried 999 units of a 5-unit line.
- Made Packing List PKL_005 on SOR-155 in the browser, added boxes and contents, signed Packed by.
- Form and API checks: blank, whitespace, very long text, negative and huge numbers, dates in 1990 and 2099, bad links, wrong kinds, every refusal by role, direct `PATCH`, `POST` and `DELETE` on the tables, the actor-taking database functions, parallel raises for one PO.
- Screens at phone width (390): IPAS list, IPAS record, Raise an IPAS, Transmittal list, record and form, Packing List. Console errors and failed requests were recorded on that pass.
- Every finding was checked against the database tests in `src/test/policy/` before it went in. Two rules that look wrong on screen are deliberate and are in "What held up" and the watch list, not in the findings.
- Scripts, screenshots and raw results: `scratch/ipas-e2e-2026-11-20/` (not committed). `lib.mjs` signs a mock person in and calls the API; `out/*.txt` hold the raw answers.

**Not covered:** printing the IPAS, the Transmittal and the Packing List; Excel export; the IPAS chat; bank details screens; the Odoo refresh when the PO changes in Odoo; Supplier Origin dates; the Markup list; IPAS settings (signer lists by screen, next number, file rules); notifications sent at each step; Order Monitoring on the Purchasing Dashboard; Project IPAS with SORs (both test IPAS name no SOR); evidence uploads on a Transmittal stage; dark mode; tablet size.

**Environment notes (not app bugs):**

- Staging reads the live Odoo. Raising an IPAS only reads the PO (`odoo-po-ipas` uses `readPo`), so nothing was written to Odoo.
- Staging has no Reference Rate for USD, so an Import IPAS with a payment that has no forex rate shows Landed Cost "Not available yet" until one payment has a rate.
- One early run reported Jade being moved to the Profile page after about 20 seconds on a Transmittal. A fresh browser did not do it in 25 seconds. It came from the test session, not the app, and is not listed.
- Left on staging, because the app has no way to remove them: TGIPAS_078 and TGIPAS_079 (cancelled), TG03-6 and TG03-10 (closed), TG03-7 (cancelled), TG03-9 (a draft that cannot be cancelled, see B2), PKL_005 (packed). All carry "E2E TEST" in their remarks or lines.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. IPAS money and filing | 0 | 3 | 1 |
| B. Transmittals | 0 | 2 | 3 |
| C. Packing Lists | 0 | 0 | 2 |
| D. Across the module | 0 | 0 | 3 |
| E. Screens and wording | 0 | 0 | 8 |
| **Total (22)** | **0** | **5** | **17** |

No P1. The server held up well: every role gate, the whole sign-off order, the filing lock and the Super Admin reopen were enforced, and four parallel raises of one PO gave one IPAS. The problems are in money that is shown as settled or final when it is not, in slip quantities and drafts, and in what people see.

The worst findings:

- **An IPAS can be filed with a Landed Cost that is still an estimate**, and the screen says "Final" beside "(estimate)" (A1).
- **An IPAS paid $1,200 on a $320 order shows "Remaining balance $0.00, Settled"**; nothing warns when the payment is saved (A2).
- **A second Transmittal took 999 units of a 5-unit PO line** with no warning, and the line picker shows the PO quantity, not what is left (B1).
- **A draft Transmittal cannot be cancelled.** The menu offers Cancel and the database refuses it with raw text, so a mistaken draft stays in the Open list forever (B2).

---

## A. IPAS money and filing

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P2 | An IPAS can be filed while its Landed Cost is an estimate. LC Odoo Done no longer waits for "Pesos taken from the bank" (decided in the #595 feedback round, and tested), but Filing only checks LC Odoo Done, so the estimate is frozen. The record says "3 · Costs: Done · Final" next to "Landed Cost ₱21,571.40 (estimate)", and the filing question says "It freezes Landed Cost as final". | TGIPAS_078: two USD payments with "In pesos: Not in yet", `ipas_landed_cost` answered `status: provisional, estimate: true`, Computation status LC Odoo Done, section 3 approved by Jelai (`out/ipas-078-after-s3.png`, `out/ipas-probe5.txt`). Filing gate: `ipas_sign` section 7 checks only `computation_status`. Filing text: `out/jen-079-confirm.png`. | Decision 1: Filing waits until every foreign payment has its pesos (refused with the list of payments, like section 3's document check). LC Odoo Done keeps the #595 rule. The Costs card says "Estimate" (not "Final") while any payment is blank, and the filing question names the blank payments. | #1124 |
| A2 | P2 | Overpayment is hidden. $1,200 was recorded on a $320 order (a full payment of $900 plus down payments) with no warning. The record shows "Remaining balance $0.00, Settled" and Status Paid. The list shows a negative Remaining balance for two seeded IPAS (TGIPAS_062 -₱600.00, TGIPAS_060 -$88.00), so list and record disagree on how they show it. | `out/ipas-probe2.txt` (jelai full payment 900 on the $320 PO, 200). Record text read back: "Paid $1,200.00 … Remaining balance $0.00 Settled". List text read back on the IPAS page. | Warn in the payment form when the total paid passes the order total ("$880 more than the order"). Show "Overpaid by $880.00" in the money summary and the list instead of $0.00 or a minus figure. Saving stays allowed (shipping fees and bank charges can push it over). | #1125 |
| A3 | P2 | Dates have no limits. A payment dated 2099-01-01 and one dated 1990-01-01 were saved, a charge dated 2099-12-31, and Delivered 2099-01-01. The record lists the 2099 payment as "Jan 1, 2099 · PAID BEFORE APPROVAL". | `out/ipas-probe2.txt`, `out/ipas-probe7.txt`; record text read back after the save. Constraints on `ipas_payments` and `ipas_charges` have no date check. | A payment, a charge and the typed Delivered and Import Clearance dates cannot be after today, and not before 2015. Same check in the form and in `ipas_save_payment`, `ipas_add_charge`, `ipas_update_charge`, `ipas_fill_charge`, `ipas_set_typed_status`. | #1125 |
| A4 | P3 | Any web link is accepted as "the uploaded file". `https://example.com/not-our-file.pdf` was saved as the Freight Billing document and counted as attached for section 3. The same rule (`^https?://`) covers proof of payment and charge files. | `ipas-probe6` (attach Freight Billing, 200). `ipas_set_document_attachment`, `ipas_add_payment`, `ipas_update_payment`: `v_url !~* '^https?://'`. | Accept only links to the app's own file store (the Cloudinary folder and Supabase storage the upload uses). Old rows stay. | #1128 |

## B. Transmittals

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | A slip can claim more than the PO line. TG03-6 carried all 5 units of P01048's line; TG03-7 then took 999 units of the same line and was submitted, with `warnings: []`. The form lets you type 999 and Submit stays on. The line picker shows the PO quantity, not what is left: TGIPAS_079's line still shows "2 pc" after TG03-10 closed with both, and lines at "0 pc" are offered. | `out/tr-probe1.txt` (TG03-7, 999, 200). Form test: 999 kept, Submit on (`tr-qty2.js` result). `out/phone-tr-new.png` (2 pc still offered). | Decision 3: the picker shows "left" per line (PO quantity less what live slips carry, an NA line counting as not delivered). Over that, the form and the server warn ("3 more than this PO line has left") and ask for a remark; they do not refuse, since an NA replacement comes on a new slip. | #1126 |
| B2 | P2 | A draft cannot be cancelled. The record's More menu offers Cancel on a draft, and the server answers `new row for relation "transmittals" violates check constraint "transmittals_submitted_chk"` for anyone (Jade, the preparer; Micko, Purchasing). A slip is never deleted, so a mistaken draft stays in Open forever (TG03-9 on staging). | `out/cleanup` run and the follow-up call (400, the constraint text). `transmittalRecord.js:124` (`canCancel` allows a draft). Tests only cancel submitted slips (`68-transmittals-tracer.test.js:278`). | Let `transmittal_cancel` cancel a draft: the constraint allows `cancelled` with no `submitted_at`. Keep the reason rule. | #1127 |
| B3 | P3 | The quantity box says "Every line needs a quantity" for -3, which has a quantity. 2.5 Unit is accepted. | `tr-qty2.js` result: `-3` → "Every line needs a quantity", Submit off; `2.5` → Submit on. | Say "A quantity is more than 0." Allow decimals only for units that are measured (m, kg, L); whole numbers for pc, Unit, Set, Pair, Kit. | #1126 |
| B4 | P3 | Esc throws away a filled slip. With one line on the slip and a priority picked, one Esc closed the form, with no question, and nothing was saved. | `tr-esc.js`: before Esc "On the slip · 1", after Esc 0 dialogs, address `/purchasing/transmittals`. | If a line or a pill was set, ask "Discard this slip?" first. Same in Raise an IPAS and New Packing List. | #1130 |
| B5 | P3 | The Transmittal Check by queue sends anyone not on the Check by list to the Dashboard without a word. The IPAS queue shows "You don't have access to this page" in the same case, and `ProtectedRoute` says people should be told, not bounced. | Dani and Jade on `/approvals/transmittals` landed on `/` (Dashboard). `approvals/transmittals/index.jsx`: `<Navigate to="/approvals" replace />`. | Show the same "no access" message as the IPAS queue, naming the Check by list. | #1130 |

## C. Packing Lists

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| C1 | P3 | No limits on a box: a weight of 1,000,000,000 kg, marks of 5,000 characters and a contents quantity of 1,000,000,000 were all saved. The weight total prints as "1000000025.00 kg", with no separators. | `out/pkl-probe.txt`; `out/pkl-boxes.png`. | A box weighs at most 5,000 kg; marks and seal at most 200 characters; a contents quantity at most 100,000. Show weights with separators ("12.50 kg", "1,250.00 kg"). | #1128 |
| C2 | P3 | A Packing List made by mistake cannot be removed. There is no cancel, and "a Packing List is never deleted". A draft made on the wrong SOR stays on that SOR. | `packing_lists_guard`: "a Packing List is never deleted"; no cancel function exists. | Decision 4: a draft Packing List can be cancelled with a reason, like a draft Transmittal. A packed one keeps today's rule. | #1127 |

## D. Across the module

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| D1 | P3 | Text has no length limit where it should: P.I # took 5,000 characters, IPAS Remarks 20,000, the Odoo receipt reference on a slip 3,000. A Supplier contact of three spaces was saved as is. | `out/ipas-probe1.txt` (lengths read back: P.I # 5,000, remarks 20,000). `out/tr-probe4.txt` (receipt reference, length 3,000). | P.I # and the receipt reference at most 60 characters, Remarks at most 2,000, Supplier contact at most 200 and trimmed (blank becomes empty). In the form and the database functions. | #1128 |
| D2 | P3 | Raw database text reaches people in several places: "numeric field overflow" (P.I/QT Amount 10^15), "duplicate key value violates unique constraint ipas_live_po_number_key" (a raise that lost a race), "new row for relation … violates check constraint … Failing row contains (…)" (a negative box weight, a contents quantity of 0, a blank contents line, cancelling a draft slip). | `out/ipas-probe1.txt`, `race.mjs` output, `out/pkl-probe.txt`, B2. | Check these in the functions first and answer in words ("P.I/QT Amount is at most 9,999,999,999.99", "P01050 already has a live IPAS (TGIPAS_079)", "A box can't weigh less than 0 kg"). Map 23505 and 23514 to a plain message in `ipasErrorMessage` as a fallback. | #1128 |
| D3 | P3 | A refused save uses up a number in a numbered paper series. TG03-8 does not exist (a create refused after the number was drawn), and TGIPAS_080 was taken by the raise that lost the race, so the next IPAS is TGIPAS_081. | Transmittal numbers read back: TG03-7, TG03-9. `ipas_number_seq` last value 80 with TGIPAS_079 the newest. The number is the column default `nextval(...)`, taken before the line checks. | Decision 5: check everything before taking a number (Transmittal lines before the insert; the IPAS live-PO check under a lock before the insert). A gap from a crash is accepted and noted in the history. | #1129 |

## E. Screens and wording

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| E1 | P3 | Raise an IPAS: Priority, Source and Purpose are required but have no red asterisk, and Raise IPAS is grey with no reason. (Raise a Transmittal does both right.) | `out/raise-p01048.png`. | Red asterisk on the three pickers; one line above the buttons: "Pick a Priority, a Source and a Purpose to raise." | #1130 |
| E2 | P3 | Section numbers are mixed. The server says "section 4 opens once sections 1, 2, 3 and Logistics are signed". The approvals queue says "Section 6 · Sign-offs · Approved", the panel says "You are on the section 6 approved list", and the filing question says "Approving section 6 · Sign-offs". CONTEXT.md calls Filing section 4. The record's Sign-offs part says "2 of 4 signed" while three sections were approved and the rail shows five steps. | `out/jen-approvals-ipas.png`, `out/jen-079-panel.png`, `out/jen-079-confirm.png`, `out/ipas-078-signoffs.png`. | Name the sign-off by its section ("Section 4 · Filing") everywhere and keep "6 · Sign-offs" only as the record's part name. Count what the rail shows ("3 of 5 signed"). | #1130 |
| E3 | P3 | The approval panel says "Odoo PO total ₱7,600.00" for P01050; the record says "Odoo PO ₱8,436.00". ₱7,600 is the amount before tax. | `out/jen-079-panel.png`; `out/phone-ipas-079.png`; Odoo copy `amount_untaxed` 7600, `amount_total` 8436. | Show the total with tax, as the record and the bill check do, or label it "before tax". | #1130 |
| E4 | P3 | The record's button reads "Send back…". CONTEXT.md says the word is Return and lists "Send back" under Avoid. | `moves.js` (label `"Send back…"`). | Label it "Return…". | #1130 |
| E5 | P3 | A person with no IPAS access who opens `/purchasing/ipas` sees the page with "No IPAS yet", while 31 exist. The record link says "Not found, or not yours to see", which is right. | Dani and Jade, page text read back. | Show "You don't have access to IPAS" on the list for someone `ipas_can_read` refuses. | #1130 |
| E6 | P3 | At phone width the Raise a Transmittal footer squeezes "Add at least one line to submit." into a narrow column of five lines next to the buttons. | `out/phone-tr-new.png`. | Put the reason on its own line above the buttons on a phone. | #1130 |
| E7 | P3 | The record's bottom bar reads "Your move · Waiting on Grace demo, Gracean (staging), … : Check." to Ayla, whose move it is not. | `out/phone-ipas-079.png` (Ayla). | Say "Next move" when the viewer is not one of the people named. | #1130 |
| E8 | P3 | CONTEXT.md is behind the built rules in three places: "Pesos taken from the bank" says the Computation status "cannot reach LC Odoo Done" while a payment is blank; "Computation status" says it moves "one step either way" (the server accepts any jump, on purpose); "Transmittal" says a stage "is signed by two people" (one person may be both, spec #251). The header of `116-ipas-pesos-taken-from-the-bank.test.js` still states the old pesos rule. | Server: Encoding to LC Odoo Done in one call (`out/ipas-probe2.txt`); Jade as both signers (`out/tr-probe2.txt`). Tests: `116-…:148-165`, `69-transmittals-warehouse-checking.test.js` "one person may be both signatories"; commit `126fefb7`. | Update the three CONTEXT.md entries and the test header to the rules as built, with Decision 1 for Filing. | #1130 |

## What held up

- Access: Dani, Jade and Oliver read no IPAS and no payments; people only on a sign-off list read no bank details. Direct `PATCH` and `DELETE` on `ipas` changed nothing; direct writes to `transmittals` and `packing_lists` were refused. The functions that take an actor or an Odoo copy (`ipas_raise_from_odoo`, `ipas_refresh_from_odoo`, `ipas_record_odoo_copy`) cannot be called by a signed-in user, and `ipas_create` refuses everything.
- Raise: a second live IPAS for a PO is refused with its number; four parallel raises of P01050 gave one IPAS; a Project IPAS with no SOR, a non-Purchasing raise and a wrong PO number are refused.
- Sign-off order: only Purchasing prepares; the approver must be on the list and is never the preparer (a Super Admin off the list was refused); section 2 needs a proof on every payment; sections 1 and 3 need their required documents; section 3 waits for LC Odoo Done; section 4 waits for sections 1, 2, 3 and Logistics, takes Received first, and the person who gave the Check cannot file. Return and Undo approval need a reason of at most 500 characters.
- Filing lock: after Jen filed TGIPAS_079, payments, charges, documents, header, purpose, bank details, On-Hold, typed dates, cancel, Return and Undo were all refused with "a Super Admin reopens it first". Only 101 reopened it, with a reason, and that cleared section 4 only. The filing question explains what is frozen.
- Only a Super Admin changes a sign-off list (Ayla was refused).
- Transmittals: only Purchasing and the Warehouse or Logistics lists raise one; NA needs a remark; ratings follow the stage (Jade could not rate Technical, Oliver could not sign Warehouse); a slip with a signed stage cannot be cancelled; Check by waits for Received in Odoo, refuses a person off the list and the same person in both slots; undo goes in order (Check by before the receipt) and needs a reason; a future "prepared on" date is ignored.
- Packing Lists: only Purchasing or the Warehouse list makes one; it cannot be packed with no box or an empty box; after Packed by nothing changes.
- Phone width: no page scrolls sideways on the seven screens checked (the fact pills scroll inside their row on purpose). No console errors and no failed requests on that pass.

## Watch list (not ticketed)

- Anyone on any IPAS sign-off list (Received, Noted, Checked, Logistics, …) reads every IPAS with its payments, not only the ones they sign. That is `ipas_can_read` as built; CONTEXT.md says "the full IPAS opens only for its own readers". Ask Finance whether Received and Logistics signers need payments.
- The server lets a signer Return a section that is already approved (clears Prepared and Approved). It is tested on purpose (`61-ipas-signoffs.test.js:543`), and the screen offers only Undo approval once a section is approved, so people do not meet it.
- One person may sign both slots of a Transmittal stage and confirm the second themselves (spec #251, `126fefb7`). Fine for a one-person Warehouse; worth a second look if the two signatures are meant as a two-person check.
- When Technical rates a line, a "quantity received" sent with the rating is accepted and not stored. The form may never send it; check before building on it.
- A second signatory who has not confirmed does not stop a slip from closing (TG03-10 closed with Aldrin demo unconfirmed).

## Decisions made for this spec

None of these change who may raise, sign, approve, file, reopen or cancel.

1. Filing waits for the pesos. LC Odoo Done may still be reached with an estimate (the #595 feedback stays), but Section 4 Approved is refused while any foreign payment has no "Pesos taken from the bank", so filing freezes a final Landed Cost, as CONTEXT.md says (A1). The other way: allow it and label the IPAS "filed with an estimate"; that keeps Finance unblocked but makes "filed" mean two things.
2. Overpaying is allowed and shown, never refused (A2).
3. A slip may carry more than a PO line has left, with a warning and a remark, because an NA replacement comes on a new slip (B1).
4. A draft Transmittal and a draft Packing List can be cancelled with a reason. Submitted and packed ones keep today's rules (B2, C2).
5. A number in the IPAS or TG03 series is taken only after every check has passed (D3).

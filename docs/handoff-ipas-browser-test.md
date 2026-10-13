# IPAS v1: browser test checklist (fresh session)

Built on `staging` (not pushed), spec #241, tickets #242-#250 + review follow-ups. Latest IPAS commit: `d8faa9ad`.
Everything below was covered by jsdom/policy tests only. **Nothing was visually checked in a browser.**

## 0. Setup

1. Docker Desktop running, `supabase start`, `pnpm db:reset` (applies all IPAS migrations), `pnpm dev`.
2. Sign in with the magic local login (`.env.local`: `VITE_MAGIC_LOGIN_EMAIL`). Check what flags it has; you need Super Admin for steps 1-2.
3. **Odoo gotcha:** IPAS creation calls the edge function `odoo-po-ipas`. `edge_runtime` is not run locally, so locally it shows "could not check". Either:
   - serve it: `supabase functions serve odoo-po-ipas` with the Odoo creds from `.env.mirror`, or
   - test on staging after push + CI migrations + manual `deploy-edge-functions.yml` run (staging logins: `docs/mock-employees.md`).
4. Use a real PO number that exists in Odoo (an RFQ is fine). Also have one PHP PO and one foreign-currency PO.

## 1. Access and employees

- [x] Employee directory > edit employee: **Finance access** toggle sits next to Purchasing access; saves and reloads.
- [x] **Call sign** field on the employee form: saves; a duplicate is refused; blank saves as empty.
- [x] Non-HR/non-Super Admin cannot flip their own Purchasing/Finance flags (PATCH via devtools is silently reverted).
- [x] Create test people: purchaser (Purchasing), finance (Finance), approver (call sign 101), receiver (1203), a plain employee.
- [ ] Nav: "IPAS" shows for Purchasing, Finance, Super Admin and sign-off-list members; hidden for the plain employee. Plain employee opening `/purchasing/ipas` gets nothing.

## 2. Settings (unified)

- [x] `/settings` > **Purchasing** tab (Super Admin or Purchasing access). Option lists: payment methods, charge kinds, document kinds, freight services, item locations.
- [x] Add, reorder, deactivate an option. Deleting is not possible.
- [x] Super Admin sees a **Sign-off lists** sub-tab; Purchasing-only user does not.
- [ ] Add/remove people on lists: "Who changed the lists" history shows each change, newest first.
- [x] Old `/purchasing/ipas/settings` redirects to `/settings?tab=purchasing`.
- [ ] Seed values are guesses (payment methods, charge kinds, freight services, document kinds, locations): compare with the Google Sheet and fix in this tab.

## 3. Raise, list, cancel (#242)

- [ ] New IPAS: enter PO number. Unknown PO shows "not found"; Odoo down shows "could not check" (different wording).
- [ ] RFQ-state PO accepted. Number is `TGIPAS_` + zero-padded (first should be `TGIPAS_049`).
- [ ] Second live IPAS for the same PO refused; allowed after cancelling the first. Cancelled number is never reused.
- [ ] Purpose Project requires at least one SOR; Inventory/Supplies/Events refuse SORs.
- [ ] SOR suggestions appear (S numbers from the PO source document / analytic names).
- [ ] SOR picker shows reference, project and stage only. **No customer name anywhere** (picker, chips, print). Placeholder reads "Sales Reference or project".
- [ ] Change Purpose and SORs before filing. Cancel needs a reason; cancelled IPAS stays readable.
- [ ] List filters: open / filed / cancelled, entity, Purpose. Sorting and paging work.
- [ ] History panel lists every change.

## 4. Odoo copy (#243)

- [ ] Opening an IPAS shows the Odoo copy with its fetch time; page paints before the refresh finishes.
- [ ] After changing the PO in Odoo (add a line / change qty or price): change note lists additions, removals, qty/price changes.
- [ ] Override Entity / Source Doc. / Analytic Dist.: shows "Odoo: ..." beside it; reset button restores Odoo. Currency, Supplier, lines, Brand are not editable.
- [ ] Supplier contact and P.I # fill from Odoo only while blank, never overwrite typed values.
- [ ] Purchase Order / Received in Odoo ("Partly received") / Create Bill show "● stamped from Odoo" and cannot be ticked by hand.
- [ ] PO cancelled in Odoo shows the banner and the IPAS stays open.
- [ ] S-number mismatch shows a warning only.
- [ ] Odoo unreachable: last copy still shows with its fetch time.

## 5. Payments, charges, Landed Cost (#244)

- [ ] Add/edit/remove payments (kind, date, amount, charge fee, method, Check No. when check, proof). Foreign-currency payment refuses save without PHP debited.
- [ ] DP/FP header amounts come from payment rows; P.I/QT amount typed; no balance shown.
- [ ] Add/edit/remove charges. One freight service per IPAS.
- [ ] Landed Cost: PHP PO uses PO pre-tax unit price + spread charges/fees (not the amount paid). USD PO with no payment shows "not available". Value / quantity / equal split change the figures.
- [ ] Landed Cost badge reads **provisional** until computation status is Costs complete, then **final**.
- [x] Type half-finished numbers into amount fields: nothing crashes.
- [x] Payment added before section 1 approval shows "paid before approval".
- [ ] Finance user can add payments/charges; plain employee and signer-only member cannot.

## 6. Bank details (#245)

- [x] Purchasing types Bank Name / Account Name / Account #. Finance cannot edit (can read).
- [x] Same supplier, new IPAS with a different Account #: flagged prominently. Same number with different spacing/dashes: not flagged. First IPAS for a supplier: never flagged.
- [ ] A flagged account clears section 1/3 approvals and notifies the preparer.
- [ ] Section 7 Noted/Checked signer with no other access: IPAS opens but bank details are not shown. Section 1 approver sees them.

## 7. Documents, Supplier Origin, buyer track (#246)

- [x] Import IPAS lists Import + Both document kinds; Local lists Local + Both. Hand-add an extra row.
- [ ] Attach a file to a row. Purchasing and Finance ticks are separate; Finance can tick only "Finance has it".
- [x] **Remove** appears only on hand-added rows (not on suggested ones); refused if Finance has ticked.
- [x] Supplier Origin dates only on Import; hidden on Local.
- [ ] With P.O.P appears when a payment has proof and disappears when removed.
- [ ] Import Clearance (Import only), Delivered typed; Actual Checking stamped. Each shows source (Odoo / derived / typed) and who/when.
- [ ] Item Location from the list.
- [x] No Transmittal/TSR UI anywhere.

## 8. Sign-offs and Approval Center (#247, #248)

- [ ] Section 1 and 3: Prepare, then Approve by someone on the list. Preparer cannot approve; off-list user (incl. Super Admin) cannot.
- [ ] Send back needs a reason; clears the section; preparer is notified.
- [ ] PO lines changed in Odoo, or flagged Account #, clears approvals ("PO changed in Odoo" / "Account # flagged").
- [ ] Adding payments/charges/overrides/Purpose/SORs does NOT clear approvals.
- [ ] Notifications: Prepared notifies exactly that section's approvers; notification click opens the IPAS.
- [ ] `/approvals/ipas` queue lists IPAS awaiting the viewer; `/approvals` redirect works for a user whose only queue is IPAS; sidebar badge count.
- [x] Section 7 locked until 1 and 3 approved. Order: Received, then Noted and Checked (any order), then Approved.
- [ ] Approved refused before Costs complete (clear message). With unticked required documents the dialog lists them and files only on confirm.
- [ ] Section 7 **Send back** (Noted/Checked/Approved signer): clears Received/Noted/Checked, shows in history, notifies the cleared signers.
- [ ] Opening via the Approval Center refreshes the Odoo copy before filing.

## 9. Filed IPAS

- [ ] Filed IPAS is read-only: payments, charges, documents, bank details, SORs, Purpose, overrides all refuse edits.
- [ ] Odoo changes after filing: banner "Odoo has changed since filing", stored copy unchanged. Landed Cost shows final.
- [x] Cancel refused when filed. Super Admin Reopen (with reason) clears section 7 only; sections 1/3 stay approved; edits work again.
- [ ] Settings > option used by a filed IPAS: Rename (and document-kind Source/used-for) disabled with the hint; Deactivate and reorder still work.

## 10. SOR page

- [ ] SOR modal (Deal Team member without Purchasing/Finance): IPAS section lists each Project IPAS (number, Odoo PO, supplier, purpose, state, tracks, sign-off progress). No payments/charges/bank/Landed Cost.
- [ ] Section hidden when no IPAS names the SOR; Inventory IPAS never shows; IPAS naming two SORs shows on both.
- [ ] "Open IPAS" link appears only for people who can read IPAS.
- [ ] Release Notes page (sample data) still loads with no network calls.

## 11. Printing (#250)

- [ ] Print from the IPAS page: two A4 portrait pages (check the real print preview, pagination at `@media print`); section 4 absent. Long PO / many payments flow to a third page without clipping.
- [ ] Signatures: stored signature prints as image (test as Finance/Purchasing, not just the signer); no signature / declined prints name only; waiting box prints "Signature required".
- [ ] Landed Cost prints provisional/final correctly (filed always final).
- [ ] "● stamped from Odoo" mark + legend; Odoo read time in footer; times in Asia/Manila.
- [ ] Account number masked to last four. **Print filing copy** button appears only on a FILED IPAS and only for people who can read bank details; full number prints there.
- [ ] User without bank access: no bank section on any print.
- [ ] Supplier/remarks with `<` or `&` characters print escaped (no broken layout).
- [ ] HR forms printing (TG-11/12/13) still looks unchanged (shared `htmlPrinter.js` was refactored: `sigBlock` moved out).

## 12. Visual review (UI never seen by a human yet)

IPAS list, IPAS page (all sections), dialogs (new IPAS, payment, charge, bank, send back, filing/approve, reopen), Settings Purchasing tab, Approval Center IPAS queue + review sheet, SOR IPAS card. Check at desktop and 375px, light and dark. Known layout left as-is on purpose: IPAS page header has several buttons (badge, Print, Print filing copy, Purpose/SORs, Cancel, Back); DESIGN says one main action.

## Known open items

- `TGIPAS_` start 49 is unconfirmed with Purchasing (spec: confirm before merge).
- Option seed values are guessed.
- Sign-off lists start empty until call signs are set (Noted/Checked never auto-seeded); switch-over is #470.
- Odoo copy is supplied by the browser and not verified by the database (decided: leave).
- `odoo-po-ipas` has gateway-JWT-only caller check, same as `odoo-po-verify` (decided: leave).
- Stored history text "PO changed in Odoo" still says "PO" (committed migration text).
- Transmittals / PMS page are later build steps (not stubbed).
- AGENTS.md says purchasing work belongs on `integrate/purchasing`; this was committed on `staging` by instruction.

## Browser run 2026-10-13 (local, seeded mock data)

Ticked above = seen working in the browser. Seeded: dev user (Super Admin + Purchasing + Finance), `ipas-signer@policy.fixture` on all s1/s3/s7 lists (password123), 4 IPAS (TGIPAS_355-358), 2 SORs.

Seen working but not ticked (only part of the item covered):
- Raise: list + 4 rows, filters render; actual raise needs Odoo (not run).
- Odoo copy: "Odoo didn't answer" banner with last copy + fetch time; stamped-from-Odoo marks; Entity override button; Contact "Filled from Odoo".
- Payments: add check payment (Check No.), total debited line; edit/remove, foreign currency not run.
- Sign-offs: prepare s1 (dev) -> approve (signer) via Approval Center queue + review sheet; preparer reason text shown; s3 via RPC; s7 Received/Noted/Checked/Approved in UI; filing dialog lists 11 unticked documents and files on confirm.
- Filed: banner, only Print / Print filing copy / Reopen left, no Cancel.

Not run: sections 1 (employee form), 3 raise, 4 Odoo diff, 6, 7 attach/remove, 10 SOR modal, 11 print preview, 12 375px/dark.

Findings:
- Stale `node_modules/.vite` makes every IPAS route render blank (generouted route glob frozen in the prebundled dep). Fix: delete `node_modules/.vite` and restart dev.
- First IPAS number is TGIPAS_355 locally, not 049 (sequence advanced by earlier policy-test runs; check on a clean `db:reset`).

### Browser run, part 2 (same day)

Ticked: sections 6 (different Account # flagged, spacing-only change and first IPAS not flagged), 7 (Import/Local document lists, Remove only on typed rows, Supplier Origin hidden on Local, no Transmittal UI).
Also seen OK, left unticked: charge add (Brokerage Fee, total shown), bank details add, USD payment refused without PHP debited (button disabled + message), USD with no payment shows "Landed Cost is not available yet", SOR modal IPAS card (no money/bank; Inventory IPAS absent; per-section progress), 375px (no horizontal overflow, tables scroll inside), dark theme.

Not run: employee form (section 1), real Odoo raise/diff (3, 4), Finance read-only on bank details, send-back flows, reopen, print preview (11), HR form print regression, Release Notes no-network check.

Findings:
- Saving a changed Account # shows a red "Error" toast ("Account # differs ... flagged and approvals cleared") although the save succeeded and the page shows the CHANGED ACCOUNT flag. Probably should be a warning, not an error.
- A document added by picking a kind from the list (e.g. Proforma Invoice) has no Remove; only typed "Something else" rows do. Matches the code comment but is easy to trip over.

### Browser run, part 3

Ticked: section 1 (Finance toggle, call sign dup refused / saves / blank saves empty, self-flip reverted, test people), 6 (Finance can't edit bank details, can read them), 9 (Reopen with reason keeps s1/s3, clears s7, edits return; no Cancel on filed).
Also seen: Prepared notifies the section's only approver (IPAS_SIGNOFF_READY, reference = IPAS id); adding a charge does not clear a prepared section; s7 send-back records `sent_back` in history; ordinary employee sees 0 IPAS, Finance sees all.
Section 11 (printing): user reports "print works"; not re-verified by me (needs a real print preview), left unticked.
Finding: duplicate call sign shows the raw DB message `duplicate key value violates unique constraint "employees_call_sign_key"` in the toast; a plain "that call sign is taken" would be kinder.
Still not run: Odoo-backed items (3, 4, PO-changed clears), HR form print regression, Release Notes no-network, notification click-through.

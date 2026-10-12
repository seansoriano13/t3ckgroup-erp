# QA: Purchase Request follow-ups (#209)

Local stack only. Mock accounts (password = `CAST_PASSWORD` in `src/test/policy/support/cast.js`):
Bea Buyer (`bea.buyer@demo.local`, Purchasing), Paolo Purchaser (`paolo.purchaser@demo.local`, Purchasing),
Sal Sales (`sal.sales@demo.local`, Deal Owner), Nina Newhire (`nina.newhire@demo.local`, no Purchasing yet),
Local Solo Dev (`dev@local.com`, Super Admin). SORs are titled `[Demo] <letter> …`.

## SOR closes / reopens → Buyer told
- [x] 1. A: delete SOR (UI) → Bea gets "SOR was deleted", one notification
- [x] 2. B: delete SOR with every item closed → Bea gets nothing
- [x] 3. C: move SOR to Lost → Bea gets "SOR was lost"
- [x] 4. D: move SOR to Won → Bea gets nothing
- [x] 5. E: Lost, then delete → Bea gets exactly one notification
- [x] 6. F: delete, then restore from the Deleted view → Bea gets "was deleted" then "was restored"
- [x] 7. G (no Buyer): delete → Paolo (purchasing member) told; Sal (sales) not told
- [x] 8. Clicking the notification opens the Purchase Request

## Purchasing access follows the flag
- [x] 9. Grant Nina Purchasing access (UI, as Super Admin) → Nina in H (open items) and I (empty)
- [x] 10. Nina NOT in J (finished) or L (deleted SOR)
- [x] 11. K: Nina (was "other") now purchasing side → can change item status; SOR window open
- [x] 12. Remove Nina from M by hand, then edit an unrelated field on Nina → not re-added to M
- [x] 13. Revoke Nina's access → still a member of H/K, but no longer purchasing (can't set status); K window closed

## Refactor regressions
- [x] 14. Procurement Queue open counts correct (closed-item helper)
- [x] 15. A closed item can't change status; open item transitions still work

## Result (2026-10-08, browser, local stack): 15/15 pass

Notes found along the way (not caused by this change):
- Delete-SOR confirm dialog title reads "Delete null?".
- Restore dialog still mentions "procurement requests" (old purchasing wording).
- Queue shows requests on deleted/lost SORs as plain OPEN, no sign the SOR is gone.
- Nina (non-purchasing member) can't reach the queue/modal at all once access is revoked: `/purchasing` is gated by access, so a kept membership is only reachable from a notification or the SOR.

## Follow-up fixes (verified in browser)
- [x] Delete dialog reads "Delete SOR-224?" (was "Delete null?")
- [x] Restore dialog: "Its Purchase Request, if it has one, carries on where it stopped."
- [x] Queue: dead SORs show "SOR DELETED" / "SOR LOST"; reference falls back to SOR Code (was "No SOR")
- [x] Revoke drops "other" memberships; Buyer (H) kept as other; 0 open SOR windows

## Rerun (2026-10-08, after 3268ab1f): 15/15 + follow-ups pass
Extra: C lost → "Revert to last stage" → "was reopened" → lost again = 3 notifications.

Bugs found and fixed:
- [x] Dialogs inside the request *modal* (from an SOR or a notification) opened behind it (z-50 vs z-70): Add from the SOR, New product, Mark as Ordered, Pick PO lines, Cancel / Cannot source / Substituted confirm, Remove member confirm. Now z-[80].
- [x] Request modal subtitle always "Purchase Request" (read client_name/opportunity_no, which pr_queue doesn't return). Now "SOR-224 · Lead" / "SOR-217 · SOR deleted".
- [x] Chat said "Member added." / "Member removed." without who. Now "Added Paolo Purchaser." / "Removed Paolo Purchaser."

Noted, not fixed:
- Nested dialogs in the modal show without a dimmed backdrop (overlay sits under the modal).
- Buyer picker label truncates: "No Buyer (back to the q…".

## #499 review follow-ups — staging SQL checks

Run on staging after the migrations land (CI applies them on merge to `staging`).
Each check runs inside `BEGIN; … ROLLBACK;` unless it says otherwise, so no data is kept.

### #502 Chat notifies only the Buyer and requesters

### #503 Deal Team can always add Requested Items

### #504 Open Purchase Request top-up

### #505 Legacy task-closing notifications

### #506 RPC prefixes unified on `purchase_request_`

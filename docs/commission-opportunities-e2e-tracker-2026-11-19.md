# Commission, Opportunities and Bid Decisions E2E tracker (2026-11-19)

A Playwright pass over the **Commission Pool** (Commission Dashboard, Pool and Formula tabs), the **old opportunity and commission links**, and the **Bid Decisions** queue and bid panel.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as a spec and its sub-issues (see the Ticket column). The spec is [seansoriano13/t3ckgroup-erp#1104](https://github.com/seansoriano13/t3ckgroup-erp/issues/1104).

**How it was checked**

- Staging (`https://t3ckgroup-erp-staging.vercel.app`) at commit `1d813f3b` (`origin/staging` when the pass ran).
- 6 people, each signed in with their own mock login: Super Admin (`101`), Sales Director (`maey`), Sales Executive (`dani`), Finance (`jelai`), Purchaser (`ayla`) and plain staff (`jade`).
- Super Admin: read the Pool in both scopes (Realized and Projected), opened one SOR receipt, read the Formula tab, checked the rate and department forms, checked the Strategic split editor, read the bid queue and the bid panel.
- Other roles: read what the Pool, Formula, bid queue and bid panel show to them.
- Validation was tried on the forms and then cancelled. Nothing was saved.
- Write probes: the Sales Director and the Sales Executive each tried to write a rate, a department or a split, using the value already stored. The server refused every one, so nothing changed. One Sales Executive probe tried a "Go" on the bid. It was refused and nothing was written.
- Phone width 390: checked the Pool and Formula tabs for sideways overflow.
- Console errors and failed requests: checked on the Super Admin pass. None were found.
- Raw captures and scripts: `scratch/commission-opportunities-e2e-2026-11-19/` (not committed).

**Screens and rules covered:** Commission Pool (Realized and Projected, totals, departments, SOR table, SOR receipt), Formula (rates, rate form, department allocations, split rules, calculator), old links (`/opportunities/commission`, `/opportunities/commission-formula`, `/crm/commission`), Bid Decisions queue, costing matrix bid panel (checklist, Go, Revise and No-go buttons).

**Not covered:**

- Saving any rate, department, position or split. Staging config is shared with real users.
- Taking a Go, Revise or No-go. The one live bid is demo data. A verdict changes it and tells the Deal Team. Only the refusal path was checked.
- Unlocking a Go, and "Move to Closed Lost".
- Date presets, CSV export and the calculator's "Load a real SOR".
- Saving a split as a Sales Director.
- Phone width for the bid panel and the receipt window.
- Dark mode.

**Environment notes (not app bugs):**

- The one live bid (SOR-260, "Fire fighting Equipments") is demo data. It has been waiting since Nov 10, so the queue marks it OVERDUE.
- The Super Admin pool has demo rows with a ₱0 contract value and test names ("asd", "asadasd").
- Staging config is unchanged after the pass: departments Sales 50, Operations 25, Administration 15, Finance and Accounting 5, Human Resources 5. Rates VAT 12, Withholding 8, Pool 1.

**Severity key:** **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. Figures and who sees them | 0 | 4 | 0 |
| B. Forms and checks | 0 | 1 | 0 |
| C. Consistency | 0 | 0 | 2 |
| D. Layout and responsive | 0 | 0 | 0 |
| E. UX | 0 | 0 | 0 |
| **Total (7)** | **0** | **5** | **2** |

The worst three:

1. **A3:** A purchaser sees the bid's Final Offer and ABC on the Bid Decision panel. The code says Purchasing should see nothing there. The cause is not traced yet.
2. **A1:** The Projected pool includes deals that are already awarded. It overlaps the Realized pool, and the glossary says it should not.
3. **B1:** A Super Admin can save a negative department share, as long as the total still reaches 100%.

---

## A. Figures and who sees them

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P2 | The Projected pool counts deals that are already awarded. The glossary says Projected covers only the pipeline before Awarded. Demo Regional Hospital (AWARDED, pool ₱10,267.86) counts in both Realized and Projected. | Super Admin, Projected: Commission Pool ₱3,389,130.89 over 143 SORs. The table lists the AWARDED deal. Code: `src/utils/commission.js:255`. Only the Realized scope filters by Contract Date. Projected keeps every deal that is not lost. CONTEXT.md, "Projected Commission Pool". | Use the rule in Decisions 1. Filter Projected to open deals before Awarded, or change the glossary and the label. Add a test that a deal counts in one scope only. | [#1105](https://github.com/seansoriano13/t3ckgroup-erp/issues/1105) |
| A2 | P2 | The receipt shows the old status, not the stage. The same deal says AWARDED in the table and PROPOSAL SUBMITTED in its receipt. | Super Admin, Pool: Demo Regional Hospital. Table: AWARDED. Receipt header: PROPOSAL SUBMITTED. Code: `src/components/sor/commission/DealCommissionModal.jsx:` uses `StatusBadge status={deal.status}`. The table uses the flow stage (`PoolTab.jsx`, `stageBadgeOf`). The code comment says a SOR on a Sales Flow keeps a stale `status`. | Show the flow stage in the receipt, the same way the table does. | [#1106](https://github.com/seansoriano13/t3ckgroup-erp/issues/1106) |
| A3 | P2 | A purchaser sees the bid's Final Offer total and ABC on the Bid Decision panel. The panel code says Purchasing draws nothing there. The cause is not traced: either a flow "always sees" rule gives her the price tier, or the tier check is wrong. | Purchaser (`ayla`), costing matrix of SOR-260: panel shows "Offer ₱300,000.00", "ABC ₱4,000,000.00" and "The offer is 8% of the ABC". Code: `src/components/costing/BidDecisionPanel.jsx` (`showFigures`). `costing_tier` in `supabase/migrations/20261018100000_costing_matrix_tender_lines.sql` gives Purchasing the `cost` tier, which has no Final Offer. | Find which rule gives `ayla` the price tier. If it should not, fix it. If it should, change the panel comment and this item. Add a check that Purchasing does not read the Final Offer. | [#1107](https://github.com/seansoriano13/t3ckgroup-erp/issues/1107) |
| A4 | P2 | One bid shows two offer percentages. The SOR card says the offer is 7.5% of ABC. The bid warning says 8%. | Super Admin, SOR-260: PMS tab card "7.5% of the ABC". Costing matrix warning "The offer is 8% of the ABC". Code: `BidDecisionPanel.jsx` calls `offerVsAbc(tenderLines, matrix.abc)` with no offer setting. `DecisionCard.jsx` passes `matrix.offer`. The cause in the browser is not traced. | Pass the same offer setting in both places, so both show one total. | [#1108](https://github.com/seansoriano13/t3ckgroup-erp/issues/1108) |

## B. Forms and checks

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P2 | A department share can be negative and still save, if the total reaches 100%. | Super Admin, Formula, Edit allocations: Operations -5 and Administration 45 gives "Total 100.00%" and Save is enabled. Save was not clicked. Code: `assertPercentagesSumTo100` in `src/utils/commission.js` checks only the sum. The input has `min={0}`, which does not stop typing. No check constraint for the percent in the migrations for `commission_departments`. | Reject any value below 0 (and above 100) in the form, in `commissionService`, and in the database. Do the same for positions, splits and rates. | [#1109](https://github.com/seansoriano13/t3ckgroup-erp/issues/1109) |

## C. Consistency

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| C1 | P3 | The Sales fund is masked for a Sales Executive, but a Sales Director sees "₱0.00". The ₱0 is the true value for her two SORs, so no money leaks. The rule is still not the same for the two roles. | Sales Executive (`dani`): "Sales fund ••••••". Sales Director (`maey`): "Sales fund ₱0.00", and both of her SORs have ₱0 contract value. The code path was not traced. | Use one rule for when the Sales fund is shown, and mask it the same way the Pool is masked. | [#1110](https://github.com/seansoriano13/t3ckgroup-erp/issues/1110) |
| C2 | P3 | A person who cannot open the queue lands on different pages. | Browser: `dani` and `jade` go to `/`. `maey` goes to `/approvals/tasks`. Code: `src/pages/approvals/bid-decisions/index.jsx` sends everyone else to `/approvals`. | Send everyone who cannot see the queue to the same page. | [#1110](https://github.com/seansoriano13/t3ckgroup-erp/issues/1110) |

## D. Layout and responsive

No layout problems found. The Pool and Formula tabs have no sideways scroll at 390 px.

## E. UX

No UX problems found in this pass.

---

## What held up

- **Rate form:** Save stays disabled with an empty date, with 150%, and with -1%.
- **Department form:** Save stays disabled at a total of 105% and at 70%. Cancel discards the draft.
- **Strategic split editor:** Save stays disabled until a value changes.
- **Old links:** `/opportunities/commission`, `/opportunities/commission-formula` and `/crm/commission` all land on the current `/sors/commission` pages.
- **Pool math:** checked by hand. Demo Regional Hospital: ₱1,250,000 less VAT ₱133,928.57 gives ₱1,116,071.43. Less withholding ₱89,285.71 gives commissionable revenue ₱1,026,785.71. The pool at 1% is ₱10,267.86, and the Sales fund is ₱5,133.93. The calculator's ₱1,000,000 case gives a pool of ₱8,214.29. Both match ADR 0002.
- **Sales Director writes:** `maey` cannot write a rate or a department. The write returned no rows.
- **Sales Executive writes:** `dani` cannot write a split or a department. The write returned no rows.
- **Sales Executive decision:** `dani` cannot take a Go on the bid. The call was refused, nothing was written.
- **Masking:** the Pool shows "••••••" to the Sales Executive, the Finance user and the purchaser. The Super Admin sees the amounts.
- **Decision buttons:** Go, Revise and No-go stay disabled until a reason is typed.
- **Queue access:** people who are not deciders cannot open the Bid Decisions queue.
- **Console and network:** no console errors and no failed requests on the Super Admin pass.

## Watch list

- The Super Admin pool shows the deal owner of one SOR as a raw "101", while other rows show names. Check the employee record behind it.
- A plain staff member can open the Commission Dashboard. The figures are masked, but decide whether the page should be open to everyone.
- The Tagbilaran row shows "Geane Mateo (SUPER ADMIN)" as deal owner. Check that the name and the label are right.

## Decisions made for this spec

1. **Projected** means open deals before Awarded, as the glossary says. A deal with a Contract Date counts in Realized only. This is the default for A1. Change it if the team wants another rule.
2. **Receipt** shows the same stage label as the table (A2).
3. **Negative shares** are refused in the form, in the service and in the database (B1).
4. **Purchasing** should see no Final Offer or ABC on the bid panel. The panel comment is the rule until someone changes it. A3 first finds which rule gives the price tier.
5. **One offer total** per bid, used everywhere the bid shows an offer percentage (A4).

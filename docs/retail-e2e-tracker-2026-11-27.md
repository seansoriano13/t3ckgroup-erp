# Retail E2E tracker (2026-11-27)

A Playwright pass over the **Retail** screen (`/retail`: the Order Income headline, the monthly chart, the Marketplace breakdown, Orders by month, and the Missing / Suspect income list) on the hosted staging site (commit `132ed172`), driven with `playwright-cli`, a few `run-code` scripts, API calls with each person's own token, and read-only database reads on staging and prod.
Nothing was fixed. This file lists what was found and the fix for each item. The fixes are filed as spec **#1271** and its sub-issues (see the Ticket column).

Retail is a report: it reads `retail_orders`, which the `odoo-sor-sync` function fills from Odoo every 5 minutes. Nothing on the screen is approved or edited, so this pass is mostly about **whether the numbers are right** and **who can read them**.

**How it was checked**

- 3 mock logins on staging, each in its own browser session: Dani (Sales Executive, has the Retail right), Jade (Warehouse, no Retail right), 101 (Super Admin). API calls also as a signed-out caller.
- Every figure on screen was checked against the database: the five ranges (30 days, 3 months, This year, All time, Custom 1–31 Oct), "This month" and its last-month comparison, and the Marketplace breakdown.
- Custom range: empty, normal, backwards (From after To), year 0002 to 9999, a start date in 2030.
- Search: a real Marketplace Order ID, the same in lower case with spaces, a wrong value, `%`, `_`, a quote, 5,000 characters.
- Filters: Income status (Suspect), Marketplace, Storefront list after picking a Marketplace, the Filters badge, "Clear all".
- Phone width (390): range picker, month groups, the chase list, the "Open in Odoo" link.
- API as each person: read `retail_orders` and the parked queue (`odoo_retail_queue`), insert, update and delete on both, the approve function, the sync function and its trigger function, and giving yourself the Retail right.
- The sync's own runs: `cron.job_run_details` and the last replies from the function.
- Scripts, screenshots and raw results: `scratch/retail-e2e-2026-11-27/` (not committed).
- Cleanup: no test rows were made (inserts were refused). One no-op save went through on a parked queue row (S08011, status `pending` written back as `pending`): its status and reviewer are unchanged, only its `updated_at` moved, which the app cannot put back. All browsers closed.

**Not covered:** the "new order" flash when the sync writes a row (no new order arrived during the test, and the test cannot write to `retail_orders`); the screen's own "could not load" state (no way to make the read fail); the nightly full sync; Odoo itself (no direct Odoo access from this machine, so Odoo's order list was not compared with `retail_orders`); dark mode; tablet size.

**Environment notes (not app bugs):**

- The only console errors were Google sign-in messages on the login page ("FedCM get() rejects", "Provider's accounts list is empty"), from a browser with no Google account. None came from the Retail screen. No failed requests.
- Staging and prod read the same Odoo, so the order data is nearly the same on both. Where a finding is on prod too, the row says so.

Severity: **P1** fix before release, **P2** fix in the next pass, **P3** polish.

---

## Summary

| Area | P1 | P2 | P3 |
|---|---|---|---|
| A. The numbers | 0 | 1 | 3 |
| B. The screen | 0 | 0 | 2 |
| **Total (6)** | **0** | **1** | **5** |

The report held up well. Every total on screen matched the database to the centavo, people without the Retail right see nothing (screen, menu and API), the report table cannot be written by anyone through the API, and the sync refuses every caller but its own schedule. The worst findings: **four Shopee sales are each in Odoo twice, so their income is counted twice** in the all-time total, on prod too (A1); a **ghost row on staging counts one order twice** (A2); and the Income Note reader stored **"2", "Metro" and "Bulacan" as Marketplace Order IDs** (A3).

---

## A. The numbers

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| A1 | P2 | Four Marketplace Order IDs are each on two Odoo orders, and both orders are counted. Each pair has the same buyer, Order Amount, Marketplace Fee and Order Income, so it looks like one Shopee sale entered twice in Odoo (or one Income Note copied onto a second order). Both are OK, so nothing on the screen points at them. All time, the Order Income of four sales is counted twice. | Pairs: S07551 + S07552, S07684 + S07701, S08350 + S08364, S08531 + S08532. Same 4 pairs on prod (`pnpm db:query prod`, read-only). Searching one of the IDs on screen gives "2 orders" and twice the income. | Keep counting both (the report does not decide which Odoo order is wrong), but list each pair in the Missing / Suspect section with a plain line, "Same Marketplace Order ID as S0xxxx", and "Open in Odoo", so the salesperson can cancel the extra order or fix its Income Note. Count them in "to chase". | #1273 |
| A2 | P3 | Staging only. A row with the order number `false` is a second copy of S08420 (same Odoo id 8420, same Marketplace Order ID, same Order Income). It came from the old queue import, which stored Odoo's empty name as the text "false". The sync matches rows by order number, so it never merges or refreshes this one. Its Odoo state stays blank, and a blank state counts, so S08420 is counted twice. Nothing stops this happening again, because only the order number is unique. | Staging: `odoo_so_id` 8420 on rows `false` and `S08420`; 3 months shows 85 orders; the database without the ghost gives 84, and the Order Income drops by exactly S08420's. Searching its Marketplace Order ID shows two rows, "S08420" and "false", and twice S08420's Order Income. Prod has no such row. | Delete the `false` row on staging. Make `odoo_so_id` unique in `retail_orders` (check prod for clashes first; there are none today). In the sync, skip an order whose name is not a real Odoo name, and match on the Odoo id. | #1272 |
| A3 | P3 | Three orders carry a wrong Marketplace Order ID: "2" (S07546), "Metro" (S07611), "Bulacan" (S07615). Searching by the real ID will not find them, and the ID column shows the wrong text. Today's Income Note reader already refuses words (an ID must hold a digit), but it still takes "2". "Metro" and "Bulacan" are left over from an older reader: the sync only re-reads Missing and Suspect orders, and these are OK, so they are never corrected. | Staging `retail_orders.marketplace_order_id`; prod has "2" on S07546 only. Searching "Metro" on screen finds S07611. `incomeNote.ts:71` accepts any token with a digit. | Accept a Marketplace Order ID only when it looks like one (letters and digits, at least 8 characters, as every other stored ID is); otherwise leave it blank. Clear the bad values on staging and prod in the same change. | #1272 |
| A4 | P3 | Lazada's "Marketplace Fees" reads **zero**, which says Lazada charges nothing. In fact no Lazada Income Note carries a fee: all 46 counted Lazada orders have a blank fee. The Fee rate next to it already shows "—". | Marketplace breakdown, 3 months: the Lazada row shows a zero fee and "—" Fee rate. Staging: 46 counted Lazada orders, 0 with a fee. | Show "—" for Marketplace Fees when no OK order in that row has a fee, like the Fee rate does. | #1273 |

## B. The screen

| ID | Sev | Finding | Evidence | Suggested fix | Ticket |
|---|---|---|---|---|---|
| B1 | P3 | A Custom range with From after To shows zero income, 0 orders and "No retail orders in this range", with no word that the dates are the wrong way round. The date boxes set `min` and `max`, but a typed date gets past them. | From 2026-11-30, To 2026-10-01: headline zero income and 0 orders, both boxes kept their values. | Under the dates, say "From is after To. Swap the dates to see orders." and leave the report as it was until fixed. | #1273 |
| B2 | P3 | The Retail switch in the employee form still says "Review marketplace orders and see Retail totals". Nothing is reviewed on Retail any more: it is a report. | Text found in the live staging bundle (`index-Cwo9y0uX.js`); `EmployeeForm.jsx:471`. The database comment on `has_retail_access` was already changed to "shows the Retail screen". | "See the Retail report: marketplace orders and their income." | #1273 |

## What held up

- **Totals.** Every figure matched the database to the centavo (Order Income and order count): 30 days (6 orders), 3 months (85), This year (452), All time (1,454), Custom October (30), and This month against 1–27 October. Cancelled and draft orders are left out (65 cancelled and 17 drafts on staging).
- **No cut-off at 1,000 rows.** The screen reads `retail_orders` in two pages (offset 0 and 1,000) and shows all 1,454 counted orders.
- **Who can see it.** Jade (no Retail right) gets "You don't have access to Retail", has no Retail item in the menu, and their browser never asked for Retail data. Through the API they read 0 rows from `retail_orders` and the parked queue; a signed-out caller reads 0 rows too. Dani and 101 see the full report.
- **No writes.** Inserting into `retail_orders` is refused (`403`, row-level security) for Dani; updates and deletes change 0 rows, for Dani and for 101. Inserting into the parked queue is refused.
- **The sync is locked.** Calling `odoo-sor-sync` with Dani's token, with the public key, and with `?since=earliest` all get `401 Unauthorized`. `invoke_retail_sync` is refused (`permission denied`). The schedule runs every 5 minutes and the last replies were `200 Sync complete`.
- **No self-grant.** Jade setting their own `has_retail_access` is refused: "you can change only your avatar, banner, quote and signature."
- **Search.** Lower case and spaces around the ID still find it, and the line "Search ignores date range" appears. `%`, `_`, a quote and 5,000 characters find nothing and break nothing.
- **Filters.** Income status = Suspect gives 7 orders and the matching chase list; the Filters badge shows 1; "Clear all" puts everything back. A Marketplace pick limits the Storefront list to that Marketplace.
- **Phone (390).** No sideways scroll. The range is a dropdown, order rows stack into cards, and "Open in Odoo" opens the order in a new tab.

## Watch list (not ticketed)

- **No Shopee orders after 29 October.** `retail_orders` (staging and prod) has Lazada orders up to 24 November but no Shopee order after 29 October. The sync reads 37 changed orders on every run and finds nothing new to write, so Odoo probably has none. Worth asking Sales whether Shopee orders are still entered in Odoo.
- **Lazada Suspects.** 5 of the 7 Suspect orders in the last 3 months are Lazada orders whose Order Income is a little above the Order Amount, with no fee (for example S08891). If Lazada's payout includes the shipping the buyer paid, these are not wrong. Ask Sales before changing anything.
- **The parked queue still works through the API.** A Sales person with the Retail right can still save changes to a pending row in `odoo_retail_queue` and call `approve_retail_queue_item`, which creates a hidden Retail SOR. This is on purpose for now (the queue is parked so it can come back, and policy test `822-sales-reference-back-doors` checks that approve still works). If the queue is not coming back, remove both.
- **The whole table is read on every visit** (1,536 rows today, two requests). Fine now; worth a server-side summary if it reaches tens of thousands.
- **"30 days" starts 31 days back** (from 28 October on 27 November, today included). Probably fine; mention it if someone compares with Shopee's own 30-day figure.

## Decisions made for this spec

None of these changes who can do what.

1. The report keeps counting every confirmed Odoo order. It does not guess which of two orders sharing a Marketplace Order ID is the wrong one; it shows the pair so a person fixes Odoo (A1).
2. A pair sharing a Marketplace Order ID is not called "Suspect" (Suspect keeps its meaning in `CONTEXT.md`). It gets a plain line in the Missing / Suspect section. **To confirm with Sean** before building, since it adds something new to that section.
3. `retail_orders` holds one row per Odoo order: the Odoo id is unique, and the sync matches on it (A2).
4. A Marketplace Order ID that does not look like one is stored blank, not stored wrong (A3).

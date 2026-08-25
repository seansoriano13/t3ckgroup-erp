# CRM pipeline redesign — living source of truth

**Status:** in design. Opened 2026-08-24 after an operations-head meeting that
revealed the current SOR pipeline is one track where the business actually runs
two, and that the real government-bidding process has stages the system has
never modelled.

**How to use this document.** Nothing here is implemented unless the Decision
Log says so. The Raw Input section is verbatim and never edited — it is the
evidence. Everything below it is interpretation, and interpretation is allowed
to be wrong. When a later meeting contradicts something here, edit the
interpretation, add a line to the Revision Log, and leave the raw input alone.
The point of the document is that the next round of input can be *diffed*
against what was already settled rather than re-litigated from scratch.

---

## 1. Raw input — operations-head meeting, 2026-08-24

Verbatim, unstructured, as captured. Do not edit.

> so the current SOR process handles the Bidding (Govt projects), then a
> Outright purchases for dealer (this have different process also, which I
> DONT KNOW FULLY YET)
>
> ```
> ----------SOR------------
> Leads ->
> Proposal/SQ Submitted ->
>
> ---------CRM ------
> Qualified ->
> For Bidding ->
> Bid Submitted ->
> Post-Qualification ->
> Notice of Award ->
> Performance Bond ->
> Contract Agreement ->
> Notice To Proceed ->
> Project Delivery ->
> Collection ->
> Retention ->
> Closed Won
> ```
>
> In AWARDED, specify the final price (there's an edge case where the quotation
> is diff from the actual NOA (notice of award), now who's responsible on doing
> that? SALES, BUT! i have an idea!, in NOA, there's a visible text there, I
> want to automate it by using OCR to scan for values (it's formatted as word
> first then actual number after), then before I can move to awarded, it should
> have an attachment as a proof that it's really awarded, so 2 ways, either
> retain the current flow where we will just notify them to attach, OR!(most
> likely the preferred ones) in every stage, there's a checklists need to be
> done before moving on, (and this will come in future, and i'm in to it, so i
> wanna make this scalable so that when i go to meeting with department heads,
> i can literally change the config on the spot to specify their specific
> workflows)
>
> After AWARDED, PMS
>
> PMS - Purchasing will now do their thing (buy the products)
>
> NOA - NTP - Contract Agreement
>
> Divide the SOR and CRM
>   concept: SOR is Lead / Proposal Submitted, if Qualified, CRM
>     - my plan is to add like timeline indicator or small title indicator that
>       Lead-Proposal Submitted is SOR, then Qualified to end, CRM, Boss don't
>       want to divide them apart, but me, I want it to be divided, so grill me
>       with it
>
> in SOR, there's no way to know if there's a stock for that product line
> (either manual tagging, or automated through odoo). sales do it, when does
> checking happens? PROPOSAL SUBMITTED
>
> show cost item and markup price (for analyzation to know if company will
> proceed to bid or nah)
>
> in PMS -> thats when Purchasing will be go in to that SOR, so Purchasing head
> will be included always, then another purchasing for the ones that will work
> on it, so purchasing will just act as a monitor or just there just to be there
>
> Admin will also show at FOR BIDDING
>
> Operation will show on PMS (known as PO received)
>
> When changing stage, automatically create Group Task (formulate what's best
> for them)
>
> SOR should be visible to included persons only
>
> so this is a CRM that is very custom and with very specific task per stage,
> so odoo will just act as inventory/sales/purchasing
>
> and CRM will be in this freakin dtar

---

## 2. What the system does today

Grounded in code, not memory. File references are load-bearing — if one is
wrong, the claim next to it is suspect.

### 2.1 The pipeline is a single ordered list

`PIPELINE_STAGE_SEED` in [src/constants/sor.js:74](../src/constants/sor.js#L74)
seeds `crm_pipeline_stages` (migration
[0033](../supabase/migrations/0033_crm_pipeline_stages.sql)). Fourteen stages,
`sort_order` gapped by ten:

| # | Code | Label | Flags |
| --- | --- | --- | --- |
| 10 | `LEAD` | Lead | `is_default` |
| 20 | `PROPOSAL_SUBMITTED` | Proposal Submitted | |
| 30 | `QUALIFIED` | Qualified | |
| 35 | `FOR_BIDDING` | For Bidding | `is_itb_gate` |
| 40 | `BID_SUBMITTED` | Bid Submitted | |
| 50 | `NEGOTIATION` | Negotiation | |
| 60 | `AWARDED` | Awarded | **`is_anchor`** |
| 65 | `PAYMENT_VERIFICATION` | Payment Verification | |
| 70 | `PO_RECEIVED` | PO Received | |
| 80 | `PROJECT_DELIVERY` | Project Delivery | |
| 90 | `COLLECTION` | Collection | |
| 100 | `CLOSED_WON` | Closed Won | `is_won` |
| 110 | `RETENTION` | Retention | |
| 120 | `CLOSED_LOST` | Closed Lost | `is_lost` |

There is exactly one list. Deal type (`PROJECT_TYPES`: SSP / CP / Strategic)
selects a *commission split*, not a stage path.

### 2.2 The anchor is the money boundary

`AWARDED` carries `is_anchor`. Reaching it stamps `contract_date`, which fixes
which dated Commission Rate prices that deal forever. `isRealizedStage()`
derives Realized-vs-Projected purely from position relative to the anchor.

Two consequences that constrain everything below:

- **Everything from the anchor onward is a locked region.**
  `isOpenRegionStage()` lets a super admin add, reorder, and deactivate stages
  only *before* the anchor. Inserting a stage at or after `AWARDED` changes the
  Realized Commission Pool by side effect, so it is a migration and a policy
  decision — deliberately not something a settings screen can do.
- **Moving the anchor re-prices history.** Every deal's `contract_date` was
  stamped by whatever stage held the anchor when it crossed.

### 2.3 There is exactly one gate today, and it is bespoke

`is_itb_gate` on `FOR_BIDDING`. Crossing it requires an ITB Number **or**
`itb_exempt` ("marked outright — no bidding required"). Implemented as named
columns and hand-written branches in
[src/services/opportunityService.js:304](../src/services/opportunityService.js#L304),
not as an instance of any general mechanism. The gate is currently switched off
(migration
[0037](../supabase/migrations/0037_itb_gate_temporarily_disabled.sql)).

### 2.4 Every authenticated employee can read every SOR

`create policy sor_read ... for select to authenticated using (true)` —
[0002_sales_opportunities_rls_fix.sql:22](../supabase/migrations/0002_sales_opportunities_rls_fix.sql#L22).
Same for `sales_opportunity_logs`. There is no membership concept on an
opportunity at all; the closest thing is commission attribution (deal owner,
support sales, sales director), which drives *math*, not *access*.

### 2.5 Group tasks already have templates, but nothing fires them

`group_task_templates` + `group_task_template_members` (migration
[0024](../supabase/migrations/0024_group_task_templates.sql)) snapshot into the
create-modal's draft when a human picks one. No stage change creates anything.

### 2.6 Purchasing already has a foothold in the SOR

`sor_procurement_requests` (migrations 0017–0023, see
[docs/sor-procurement-flow-decisions.md](./sor-procurement-flow-decisions.md))
covers the *narrow* case: a client asks for a product the company does not
carry, sales names it, purchasing sources it and records a PO. It is not the
general "purchasing buys the awarded project's products" flow, and it is not
tied to a stage.

---

## 3. Contradictions the meeting notes create

These are the things that cannot all be true at once. Each is an open question
below; none is resolved yet.

**C1 — Retention and Closed Won are in opposite orders.**
Meeting says `Collection → Retention → Closed Won`. Code sorts `Closed Won`
(100) *before* `Retention` (110), and `Closed Won` is `is_won: true`, which
means terminal — "an opportunity here has stopped moving". Under the meeting's
order, a deal must pass *through* retention before it is won; under the code's,
retention is an after-the-fact stage a terminal deal somehow re-enters.

**C2 — The new stages land inside the locked region.**
`Post-Qualification` is pre-award, fine. But `Performance Bond`,
`Contract Agreement` and `Notice To Proceed` all sit *between* award and
delivery. That is the region §2.2 locks. Adding them is a migration + a
conscious change to what counts as Realized money.

**C3 — "Awarded" and "Notice of Award" may or may not be the same event.**
The meeting list names a `Notice of Award` stage and drops `Awarded`. The
prose says "In AWARDED, specify the final price". If NOA replaces Awarded, the
anchor moves onto NOA and nothing else changes. If NOA is *earlier* than the
real award (the award only becomes contractual at Contract Agreement or NTP),
the anchor moves later and the Realized pool shrinks.

**C4 — Three stages in the meeting list have no home: `Negotiation`,
`Payment Verification`, `PO Received`.**
They exist in code today and are absent from the meeting list. `PO Received` is
probably `PMS` renamed ("Operation will show on PMS (known as PO received)").
`Negotiation` and `Payment Verification` are simply unaccounted for — dropped,
or the ops head just did not mention them.

**C5 — "NOA - NTP - Contract Agreement" contradicts the stage list's order.**
The list says `Notice of Award → Performance Bond → Contract Agreement →
Notice To Proceed`. The one-liner later says `NOA - NTP - Contract Agreement`.
NTP and Contract Agreement swap places between the two.

**C6 — One pipeline cannot hold two processes.**
"the current SOR process handles the Bidding (Govt projects), then a Outright
purchases for dealer (this have different process also)". The system models
one. The `itb_exempt` flag shipped two days ago (commit 81db97c) is an
*exemption on the bidding pipeline* — a workaround that presumes outright deals
walk the bidding path and merely skip a check. If outright is genuinely a
different process, that flag is the wrong shape and will get worse the more the
two diverge.

**C7 — "PMS" is undefined.** *(resolved — Purchasing Monitoring System; it is
a stage, and §3b is what happens in it.)*
Used three times, never expanded. Read as a stage in "After AWARDED, PMS", as a
department activity in "PMS - Purchasing will now do their thing", and as an
alias in "PMS (known as PO received)".

**C8 — The Sales Offer Matrix cannot live only in a post-award stage.**
PMS is said to sit *after* Notice of Award, and PMS is said to be where "they
assess if the company can make profit out of it or nah." Those cannot both be
true: you cannot decide whether to bid after you have already won. The original
meeting note agrees — "show cost item and markup price (for analyzation to know
if company will proceed to bid or nah)" is plainly a **pre-bid** activity. Yet
the same sheet also carries `P.O. RFQ NO.`, `Status = Source Out` and
`Source = For Order`, which are unambiguously **post-award purchasing
execution**. The most likely reading is that one spreadsheet is being filled
progressively across the whole deal and has therefore accumulated two jobs.

**C9 — There are now two incompatible definitions of Revenue.**
The Commission engine defines **Commissionable Revenue** as contract value with
VAT divided out, then Withholding applied — see `CONTEXT.md` and
`src/utils/commission.js`. The Finance OPEX sheet defines **Revenue** as
contract amount less 12% tax, less (5% VAT & 1% EWT), less 1% Retention, less
Liquidated Damages, less Operational Expenses, less Marketing, less ITR. They
disagree on the tax stack, and they disagree on ITR specifically: the
commission engine treats ITR as a **dated percentage rate**, the OPEX sheet
carries it as a **flat −20,000.00**. Two things called revenue that compute
differently is how a company ends up paying commission on money it did not
make.

**C10 — Retention exists twice, meaning two different things.**
There is a `Retention` **stage** (D3, `sort_order` 95). There is also a **1%
Retention** line in the OPEX summary. One is a phase of a deal; the other is a
withheld percentage of contract value. Same word, unrelated concepts.

**C12 — 🐞 A deal that skips the Anchor Stage is Realized but has no Contract
Date. Outright deals skip it every time.**
This is a live defect, not a design question. Verified:

- `contract_date` is stamped **only** on the transition *into* the anchor —
  `if (isAnchorCode(nextStatus) && !existing.contract_date)`,
  [opportunityService.js:372](../src/services/opportunityService.js#L372). It
  is app-side; no database trigger backs it up
  ([0034](../supabase/migrations/0034_pipeline_fk_and_trigger.sql) only
  enforces Sales Reference).
- Realized membership is decided by *position*, not by Contract Date:
  `s.sort_order >= anchor.sort_order && !s.is_lost`. `CLOSED_WON` is 100, the
  anchor is 60 — so a deal that lands in Closed Won **is Realized**.
- Commission prices each deal at `opp.contract_date || currentDate`
  ([commission.js:253](../src/utils/commission.js#L253)).

Put together: a deal that jumps `Proposal Submitted → Closed Won` — precisely
what the observed outright flow does — lands in the **Realized Commission
Pool** while being priced off **today's rate**. Its commission therefore
*keeps moving* every time anyone edits a Commission Rate, forever, despite the
deal being closed and paid. The whole point of the anchor was that this cannot
happen.

There is a second, milder effect: date-filtered commission reports fall back to
`created_at` when `contract_date` is null
([commission.js:218](../src/utils/commission.js#L218)), so these deals are
filtered by *registration* date while every other deal is filtered by
*contract* date. Same filter, two different meanings, no indication which.

Outright deals trigger this **by construction**, because the outright process
has no award event to anchor on.

**Production check, 2026-08-24** (read-only query against
`epqmberwewztzbrkhhss`):

| | |
| --- | --- |
| SORs in production | **119** |
| …with a Contract Date | **0** |
| …with an ITB Number | **0** |
| …marked outright (`itb_exempt`) | **4** |

Broken down over the realized region:

| Stage | `sort_order` | Deals | Missing Contract Date | Unanchored value |
| --- | --- | --- | --- | --- |
| `AWARDED` | 60 | 2 | 2 | ₱2,935,650.00 |
| `PO_RECEIVED` | 70 | 6 | 6 | ₱1,004,994.00 |
| `CLOSED_WON` | 100 | 2 | 2 | ₱62,696.00 |
| `RETENTION` | 110 | 1 | 1 | ₱2,879.00 |
| **Total** | | **11** | **11** | **₱4,006,219.00** |

So the anchor mechanism has **never fired in production — not once**, including
for the two deals sitting in the anchor stage itself. The entire Realized
Commission Pool, ₱4.0M across 11 deals, is currently priced off *today's* rates
and silently re-prices every time anyone edits a Commission Rate. The guarantee
in `CONTEXT.md` — "a later change never moves an already-priced Opportunity's
figures" — is not in effect for a single deal.

Fairness about causes: the forward path is probably **not** broken. Stamping
fires only on a transition *into* the anchor via `updateStage`, and no deal
appears to have crossed that way since the code shipped; the 11 realized deals
predate it. The two real defects are (1) **no backfill was ever run** for deals
already past the anchor, and (2) the **skip-the-anchor hole**, which is live,
unexercised, and which outright deals will hit every time.

Incidental finding: `itb_number` has **never been populated on any deal**. The
ITB gate was designed, shipped, gated, disabled, and removed without a single
number ever being entered — which independently vindicates D12.

**C11 — Liquidated Damages have no representation anywhere.**
An OPEX summary line with no field, no stage, and no mention in any meeting
note. Penalties for late delivery reduce revenue and therefore reduce
commission, and nothing in the system knows they exist.

---

## 3b. The PMS artifacts — Sales Offer Matrix and Finance OPEX

Structure supplied 2026-08-24 (real column shape, sample figures, no live
data). This is what "the PMS thing" actually is.

### 3b.1 Sales Offer Matrix — one row per tender line, columns owned by three departments

Column groups, left to right: **CLIENT** (what the tender asks for) → *
*T3CKGROUP / Incharge** → **CLIENT (ABC TOTAL)** → **T3CKGROUP** (sourcing and
costing) → **ACQUIRE TOTAL** → **ODOO TOTAL** → **FINAL ACQUIRE TOTAL** →
**FINAL OFFER TOTAL** → **LANDED COST**.

Ownership is **per column, not per row** — the sheet has a dedicated owner
band under the header reading `SALES / PMS / SALES / PMS / … / PMS-Automatic /
SALES / MNGT / SALES`. That is the single most important structural fact about
it: the matrix is one shared grid that three departments write to in different
columns, not a document that changes hands.

The arithmetic in the sample, verified:

| | Line 1 — Meret Omni Pro | Line 2 — Meret Efatk Pro X |
| --- | --- | --- |
| Qty | 65 | 140 |
| Acquire unit | 17,480.90 | 2,228.90 |
| Acquire total | 1,136,258.50 | 312,046.00 |
| Markup Price (`PMS - Automatic`) | 52,442.70 | 6,686.70 |
| Odoo unit | 33,850.00 | 2,850.00 |
| Odoo total | 2,200,250.00 | 399,000.00 |

- **Markup Price = Acquire unit × 3.00**, exactly, on both lines. The bare
  `3.00` floating above that column is the markup factor, and `PMS -
  Automatic` means the sheet computes it. So there is already a **configurable
  markup multiplier** in this process, currently a magic number in a cell.
- **The 3.00 is a target nobody is hitting.** Line 1 is actually quoted at
  1.94×, line 2 at **1.28×**, blended **1.79×**. Gross margin on the sample is
  1,150,945.50 — 44.3% of the Odoo total. Whatever this screen becomes, the
  gap between target markup and quoted markup *per line* is the number that
  makes the bid/no-bid call, and the sheet currently makes a reader compute it
  by eye.
- **Four value columns per line, in a deliberate order**: PMS proposes
  `ACQUIRE`, Odoo holds the standing quote, **MNGT** sets `FINAL ACQUIRE`,
  **SALES** sets `FINAL OFFER`. That sequence is a price negotiation with named
  approvers — it looks a great deal like what the `Negotiation` stage was
  supposed to be for.
- **`ABC` is almost certainly Approved Budget for the Contract** — standard
  Philippine government procurement, the ceiling a bid may not exceed. If so,
  `CLIENT (ABC TOTAL)` is a hard constraint the system should be checking the
  offer against, not just a column. Needs confirming.
- Unresolved column meanings: **IPAS** (sample value "Applicable"), and the
  two numbers under **Incharge** (402 / 114).
- Purchasing-execution columns — `P.O. RFQ NO.` (`P02483`), `Status`
  (`Source Out`), `Source` (`For Order`, `Import`) — are *live procurement
  state*, which is a different lifetime from costing. See C8.

### 3b.3 Second matrix (fully populated, 2026-08-24) — the structure resolves

A real filled sheet, supplied after §3b.1. It reverses several readings above
and settles most of the vocabulary. Every total in it was reproduced from its
own line items; **one figure could not be** (see below).

**The matrix is two levels, not one.** Row `1` is a *tender line* — what the
client asked for ("ROAD ACCIDENT RESCUE EQUIPMENT", 65 pieces). Rows `1.1`–`1.5`
are the *offer components* T3CK fulfils it with (helmet, flashlight, clip,
headlamp, headlamp helmet). §3b.1 looked flat only because that sample had one
component per line.

The two levels own different columns, and this is the load-bearing rule:

| Level | Owns |
| --- | --- |
| **Tender line** (`1`, `2`, …) | the client's spec and qty, **ABC unit/total**, **FINAL OFFER unit/total** |
| **Offer component** (`1.1`, `1.2`, …) | brand, stock state, sourcing, **ACQUIRE**, **ODOO**, **FINAL ACQUIRE**, markup |

So the **price we offer is quoted per tender line; the cost we incur is
tracked per component.** Margin only exists at the tender line, by comparing a
parent number against the sum of its children.

**Verified arithmetic** (all exact):

| Figure | Reproduced as | Value |
| --- | --- | --- |
| ABC TOTAL | Σ tender-line ABC totals | 3,965,415.00 |
| ACQUIRE TOTAL | Σ component acquire totals | 12,920.00 |
| ODOO TOTAL | Σ component Odoo totals | 1,642,630.00 |
| FINAL ACQUIRE TOTAL | Σ component final-acquire totals | 1,156,780.00 |
| FINAL OFFER TOTAL | Σ **tender-line** final-offer totals | 3,930,715.00 |
| Markup Price | Acquire unit **× 1.35** | 15,876.00 / 783.00 |
| `TOTAL` + `70.83%` | **ABC − FINAL ACQUIRE**, and that over ABC | 2,808,635.00 |
| Less Vat 12% | FINAL OFFER ÷ 1.12 | 3,509,566.96 |
| Less Tax 6% | FINAL OFFER × 6% | 235,842.90 |
| Retention 1% | FINAL OFFER × 1% | 39,307.15 |
| Collected Amount | FINAL OFFER − tax − retention | 3,655,564.95 |
| Operational Expenses | **= FINAL ACQUIRE TOTAL** | 1,156,780.00 |
| Revenue | (FINAL OFFER − FINAL ACQUIRE) − ITR | 2,479,477.80 |

Findings that follow:

- **The markup factor is per-deal config, not a constant.** 3.00 in the first
  sheet, **1.35** in this one, verified against two lines each time.
- **The matrix feeds OPEX directly.** `Operational Expenses` in the OPEX block
  *is* `FINAL ACQUIRE TOTAL`. These are not two documents; the second consumes
  the first. C9 softens accordingly — they are one pipeline of numbers.
- **ABC is confirmed as a ceiling, and it is used as one.** The offer is
  3,930,715 against an ABC of 3,965,415 — **99.12%**, deliberately just under.
  A system that lets someone submit an offer above ABC is letting them submit a
  disqualified bid.
- **`ABC − FINAL ACQUIRE`, as a percentage of ABC, is the profitability
  headline** — 70.83% here. That is the bid/no-bid number, and it is computed
  against the *ceiling*, not against the offer.
- **The stock check already exists in this sheet.** Three separate columns:
  `Status` (Stockable / Source Out), an unnamed column (Available / For Order),
  and `Source` (Import / Local). This is what the meeting meant by "there's no
  way to know if there's a stock for that product line… checking happens at
  PROPOSAL SUBMITTED".
- **`Source Link`** records where the price came from — `Odoo`, or an external
  vendor name (`Fenix`, `Altama`, `Levin`).
- **`Incharge` is two people, per line** — codes `402` and `114`, and the user
  confirms "that code represents one person". Uniform down this sheet, but
  positioned per row. See Q28: this may contradict D10, which assumes
  assignment is per *deal*.
- **`IPAS` correlates exactly with brand** in this sample: every `Proteger`
  component is `Not Applicable`; every other brand (`Fenix`, `OEM`, `Gideaon`,
  `Kong Italy`) is `Applicable`. Proteger appears to be the house brand. The
  acronym is still unexpanded.

**✅ ITR = 294,457.20 — solved.** It is not a percentage of anything obvious
because it carries an allowance:

```
ITR = (FINAL OFFER − 250,000) × 8%
    = (3,930,715 − 250,000) × 0.08
    = 294,457.20            ← exact
```

That is the Philippine **8% gross-receipts income-tax option**, which applies
only to receipts **in excess of ₱250,000**. The sheet implements it correctly.
The first sheet's flat −20,000.00 was a manual placeholder, not a second rule.

**This sharpens C9 rather than closing it.** The Commission engine's
`WITHHOLDING` rate is *also* 8% — but it applies that 8% to the **whole
VAT-exclusive amount with no ₱250,000 allowance**, and prices from the
VAT-exclusive figure rather than the gross offer. Same name, same percentage,
two different bases. On this deal the engine's basis is 3,509,566.96 and the
sheet's is 3,680,715.00. The engine is not implementing the tax the finance
sheet is implementing.

### 3b.2 Finance OPEX — a per-project expense ledger with a revenue summary

Two ledgers (Operation Expenses, Marketing Expenses — each Date / description /
Cost) plus a summary block:

```
Contract Amount          Liquidated Damages
Collected Amount         Operational Expenses
less 12% tax             Marketing
(5% VAT & 1% EWT) less   OPEX
1% Retention             ITR            (-20,000.00 flat in the sample)
                         Revenue
```

This is post-award and per-project: it carries PO Date and PO No.

---

## 3c. Meeting transcripts, 2026-08-24

Two recordings. **Treat both as low-fidelity sources** — quote them, don't rely
on them alone.

| File | Quality |
| --- | --- |
| `Aug 24_ 2.01 PM MAAM GRACE.txt` | **Usable.** Correctly detected as Tagalog and *transcribed*. Degraded stretches at lines 232–262 (`hindi nga yun` ×30), 341–373 (`Okay.` ×33), 404–422. |
| `Aug 24_ 1.20 PM SOR CRM.txt` | **Broken — needs re-rendering.** Tagalog detected as Malay and machine-*translated* into it. ~45% is the `Terima kasih kerana menonton` silence hallucination. Domain terms were translated into nonsense: `sifar berkualiti` = **Qualified**, `Komite PAS` = **committee task**, `forbidding` = **For Bidding**, `disetujui` = qualified/approved. Re-run with language forced to Tagalog and task set to *transcribe*, never *translate*. |

Meaning survived the mistranslation well enough to extract the following. Every
claim below is paraphrase, not quotation, unless quoted.

### Confirms an existing decision

- **D3** — Grace independently reached `… → Retention → Closed Won`: *"dito na
  yung matatapos"* (this is where it ends). She also volunteered that the
  current order was nobody's decision — *"Wala pong nagsabi. Ako lang po
  nagpalagay"* (nobody said; I just put it there).
- **D6** — uploading the **NOA or the NTP is what unlocks purchasing**:
  "After NTP uploaded… you can purchase. After NOA uploaded, you can purchase."
  An attachment requirement, exactly the shape the gate engine wants.
- **D10** — purchasing always reports to the Purchasing head: *"Lagi pong kay
  Ma'am [Roc]… kasi po yun yung head ng Purchasing."*
- **L9** — group tasks fire on stage move, stated twice and unprompted:
  "When he has moved, he will make group task. **Automatic. Automatic.**" On
  the SOR side, submitting the proposal creates one.
- **§3b.3** — the `Incharge` numbers are people: *"They have codes in GS."*
- **D1** — see C14 below; the confusion is itself the argument.

### Adds something new

- **The PO is released at PO Received, not before.** Grace walked a full worked
  example (cotton gloves): sales requests a price → purchasing sources it →
  price returns → product is created in Odoo → Qualified → RFQ → **PO released
  at PO Received**. Explicitly: sourcing does not produce an RFQ ("Hindi pa"),
  and "sa PO receipt dun na sila mag-release ng PO".
- **…with one exception, and it is the outright path.** *"unless yung
  in-inquire ng sales na yun ay pu-purchase agad talaga… binayaran na ni
  client"* — client has already paid, so buy immediately. This is the best
  evidence yet for D19, and it comes from the person who does the work.
- **For Bidding is checklist-heavy** — a document checklist collected by a
  team, assembled in that stage. The first real customer for D6 after
  `po_date`.
- **Payment Verification is accounting's step** — "sa accounting po… i-verify".
  Consistent with D14 placing it in Outright.

### C13 — Purchasing's entry stage is disputed

Grace, asked directly whether she enters at Negotiation or Awarded, answered
**"At PO Receive, sir."** D20 says Proposal Submitted, on the user's later
statement that "we have a new flow for it".

The user's answer is more recent and supersedes for now, but the person who
does the work said something different in the room. **Confirm before building.**
Note the two are not necessarily in conflict: costing at Proposal Submitted
(D15) and *procurement execution* at PO Received could both be true, with
purchasing joining early to cost and returning later to buy — which would make
D20 and Grace both right, and the membership additive exactly as D5 says.

### C14 — Even the room could not tell the two pipelines apart

> "Ay, itong pipeline na to ay para sa outright at dealer, tama ba?" — "Opo,
> yun." — then immediately: "outright dealer, ah, government."

The pipeline being reviewed contains For Bidding, Bid Submitted and Awarded; it
is the government one. Two people looked at one stage list and could not agree
which process it described. That is the clearest possible argument for D1.

### Closed Lost sits in the wrong position

> "Kung nag-fail yung bidding, doon na siya mag-closed. Wala na siyang kasunod
> pa." — a failed bid ends at the award point.

`CLOSED_LOST` is `sort_order` 120, dead last, after Retention. Nothing breaks —
it is reachable from any stage by design — but on a board it renders at the far
right, which is the opposite of where a lost bid belongs. Cosmetic, cheap,
worth doing with the D3 reorder.

---

## 4. The design tree

Branches, in dependency order. A child cannot be settled before its parent.

```
1. Process topology
   ├── 1.1 One pipeline with branches, or one pipeline per deal type?
   │     └── 1.1.1 What is the outright/dealer stage list?
   │     └── 1.1.2 Does itb_exempt survive, or get replaced by deal type?
   └── 1.2 SOR / CRM — presentation band, or real boundary?
         └── 1.2.1 If real: separate record? separate register? handoff event?

2. The bidding stage list
   ├── 2.1 Canonical order (resolves C1, C4, C5)
   ├── 2.2 Where the anchor sits (resolves C3)
   │     └── 2.2.1 Migration plan for already-stamped contract_dates
   └── 2.3 Which new stages enter the locked region (resolves C2)

3. Stage gates
   ├── 3.1 Bespoke gates, or a general requirement engine?
   │     ├── 3.1.1 What kinds of requirement exist (attachment / field /
   │     │         approval / free checklist)?
   │     ├── 3.1.2 Hard block or soft warn? Who may override?
   │     ├── 3.1.3 Config versioning — what happens to in-flight deals?
   │     └── 3.1.4 Does the ITB gate become the first instance?
   └── 3.2 Award-price capture
         ├── 3.2.1 New field, or overwrite the quoted value?
         ├── 3.2.2 Commission consequence of a price that moves at award
         └── 3.2.3 OCR: advisory or authoritative? words-vs-numerals check?

4. Membership and visibility
   ├── 4.1 Who is "included" on an SOR?
   ├── 4.2 Static membership, or derived from stage?
   │     └── 4.2.1 Admin at For Bidding, Purchasing at PMS, Operations at PMS
   └── 4.3 RLS rewrite from using(true) — what breaks?

5. Stage-change side effects
   ├── 5.1 Auto-create a group task per stage — template per stage?
   ├── 5.2 Backward moves and re-entry — duplicate tasks?
   └── 5.3 Relationship between a stage's checklist (3.1) and its group task

6. Pre-bid analysis
   ├── 6.1 Stock availability at Proposal Submitted — manual tag or Odoo?
   └── 6.2 Cost + markup visibility — who sees it (vs Privacy Masking)?
```

---

## 5. Open questions

Tracked by round. `?` open, `✓` settled (moves to §6), `~` superseded.

| ID | Branch | Question | State |
| --- | --- | --- | --- |
| Q1 | 1.1 | One pipeline with branches, or one per deal type? | ✓ D1 |
| Q2 | 3.1 | Bespoke gates, or a general requirement engine? | ~ re-asked as Q8 |
| Q3 | 2.2 | What event is the anchor — NOA, Contract Agreement, or NTP? | ✓ D2 |
| Q4 | 2.1 | Retention before or after Closed Won (C1)? | ✓ D3 |
| Q5 | 1.2 | SOR/CRM — band, or boundary? | ✓ D4 |
| Q6 | 4.2 | Membership static, or derived from stage? | ✓ D5 (partial — see Q12) |
| Q7 | — | What does PMS stand for, and is it a stage (C7)? | ~ expanded; see Q9 |
| Q8 | 3.1 | Re-ask of Q2 — "bespoke" contradicts the meeting note | ✓ D6 |
| Q9 | 3.1 / 5 | PMS is a *system*, not a word. Stage, tracker, or module? | ✓ D7 |
| Q10 | 1.1.1 | When is Deal Type chosen, and may it change mid-flight? | ✓ D8 (partial) |
| Q11 | 3.2.1 | Award price — new field, or overwrite the quoted value? | ✓ D9 |
| Q12 | 4.2.1 | Which members auto-join, which are assigned by the deal owner? | ✓ D10 |
| Q13 | 3.2.3 | OCR — advisory or authoritative? | ✓ D11 — dropped |
| Q14 | 1.1.2 | What happens to existing rows and to `itb_exempt`? | ✓ D12 |
| Q15 | 2.3 | PB / CA / NTP — stages, or requirements on one stage? (C2, C5) | ✓ D13 |
| Q16 | 2.1 | Do `Negotiation` and `Payment Verification` survive? (C4) | ✓ D14 |
| Q17 | 6.1 | When is the Sales Offer Matrix filled — pre-bid or post-award? (C8) | ✓ D15 |
| Q18 | 6.2 | Which Revenue definition is authoritative? (C9) | ⏸ parked — needs Finance |
| Q19 | 4.2 | Does *every* stage have exactly one owning department? | ✓ D16 |
| Q20 | 3.1.2 | Can a gate be overridden, and by whom? | ~ agreed but not understood; re-asked as Q23 |
| Q21 | 3.1.3 | Config changes vs in-flight deals — snapshot or live? | ✓ D18 |
| Q22 | 1.1.1 | What is the Outright pipeline? (observed flow only) | ✓ D19 |
| Q23 | 3.1.2 | Re-ask of Q20, in plain terms | ~ "strict" chosen; consequence not yet understood — re-asked |
| Q24 | — | Demo mode on prod — what kind, and how isolated? | ? — factual sub-question answered |
| Q25 | C12 | How is the C12 anchor bug fixed, and are live rows affected? | ? — awaiting go/no-go on a dry run |
| Q27 | 6.1 | Confirm the two-level matrix and its column ownership | ~ "categorized" — re-asked, the parent carries money |
| Q28 | 4.2 | `Incharge` is per line — is assignment per line or per deal? | ✓ D20 |
| Q29 | C9 | How is ITR actually computed? | ✓ D24 — solved exactly |
| Q30 | 2.2 | Is Payment Verification the Outright anchor? | ✓ D22 |
| Q31 | 6.1 | Stock check = the matrix's Status/Available columns. Manual or Odoo? | ✓ D23 |
| Q32 | — | Stop tracking migrations? What replaces reproducible schema? | ✓ baseline + declarative, agreed |
| Q33 | — | Vercel branch previews holding real client data — protection? | ✓ already safe — see below |
| Q34 | 7e | "Purchase Date/Order" — rename or split? | ✓ D25, implemented |
| Q35 | 8 | What is `stage_checkpoints`? | ✓ user's own backlogged start; D6 reuses it |

**Q33, resolved by inspection rather than by asking.** Vercel project
`prj_fUJUIeWeEH3Qlqi55wUuElFvR7Qo` already has `ssoProtection.enabled: true`
scoped to `all_except_custom_domains` — every preview deployment requires
Vercel Authentication, and only the production custom domain is public. The
planned staging clone with real production data is therefore already behind an
auth wall. No action needed.

Deferred: matrix schema shape (needs Q22 — outright may not use it),
Retention-% and Liquidated Damages representation (needs Q18, C10, C11), the
stage→department mapping table (needs Q22), auto-created group tasks vs stage
checklists (needs Q21).

| Q36 | C13 | Does purchasing enter at Proposal Submitted, PO Received, or both? | ? — ask Grace |
| Q37 | 3.1 | Requirements per stage, or per (pipeline, stage)? | ✓ D27 |
| Q38 | 5.3 | A stage's gate checklist vs its group task checklist | ✓ D28 |
| Q39 | 4.3 | RLS rewrite from `using (true)` — what breaks? | ✓ D29 |
| Q40 | — | Build order | ✓ D30 |

**The frontier is empty.** Every design branch has been visited. What remains
is building (D30) and three facts owed by other people: C13/Q36 from Grace,
the IPAS acronym, and the ITR reconciliation from Finance (Q18, L6, L7).

**Transcripts received 2026-08-25** — see §3c. One usable, one needs
re-rendering (mistranslated into Malay). They confirmed D3, D6, D10, L9 and the
`Incharge` reading; they raised C13 and C14 and put `Closed Lost` in question.

---

## 6. Decision log

Each entry records what was decided, what it rules out, and what it costs to
reverse.

### D1 — Pipelines are per Deal Type *(2026-08-24, Q1)*

An SOR carries a **Deal Type**; each Deal Type owns its own ordered stage list.
`crm_pipeline_stages` gains a pipeline discriminator. Bidding is seeded from
today's list; **Outright is created empty and filled in when that process is
actually known** — the deliverable now is the container, not the content.

*Rules out:* modelling process divergence as exemption flags on a single
shared list. `itb_exempt` was the first of those and would not have been the
last.

*Reversal cost:* high once written. Every consumer of the stage list gains a
pipeline scope; collapsing back to one list later means reconciling two
divergent orderings onto one.

*Promoted to* [ADR 0004](./adr/0004-pipeline-per-deal-type.md).

### D2 — The Anchor Stage stays where it is; `Awarded` is renamed *(2026-08-24, Q3)*

`Notice of Award` is the anchor. It keeps code `AWARDED` and `sort_order` 60 —
only the **label** changes. Contract Date keeps being stamped at the same
real-world event it always was, so no historical `contract_date` is re-stamped
and no deal moves between the Realized and Projected pools.

*Rules out:* anchoring on Contract Agreement or NTP. Those are later, and
moving the anchor later would silently shrink the Realized Commission Pool and
re-price every deal currently sitting between NOA and NTP.

*Reversal cost:* very high — a later anchor move re-prices booked commission.
The rename itself is free.

### D3 — `Collection → Retention → Closed Won` *(2026-08-24, Q4)*

The meeting order wins over the code's. Retention moves from `sort_order` 110
to **95**; Closed Won stays at 100 as the only terminal success. A deal with
retention money outstanding is not done.

*Rules out:* Retention as a post-terminal stage a won deal re-enters — which is
what the code implies today and which `isTerminalStage()` says is impossible.

*Reversal cost:* low. A reorder migration; both stages already exist and both
already sit past the anchor, so the Realized set is unchanged either way.

*Note:* this is a reorder **inside the locked region** (§2.2). It is a
migration and a deliberate policy change, not a settings-screen action —
correctly so.

### D4 — SOR and CRM are one record, presented as two bands *(2026-08-24, Q5)*

No split. One `sales_opportunities` row for the whole life of a deal.
`Lead`/`Proposal Submitted` render under an **SOR** band; `Qualified` onward
render under a **CRM** band — a divider on the board, a caption on the detail
header. The two registers the split was really reaching for are **saved views
over one table**, not two tables.

*Rules out:* a second record, a handoff event that can fail halfway, and a
commission engine that has to join across a seam to find its own deal's origin.

*Reversal cost:* low in this direction (a band is easy to harden into a
boundary later); the reverse would have been expensive.

### D5 — Membership is additive and never revoked *(2026-08-24, Q6, partial)*

An SOR gains an explicit member list. Members are added — by rule or by a
person — and **once added, never removed by a stage change**. Leaving For
Bidding does not take Admin's access away from work they did.

*Still open:* which members arrive by rule and which are assigned by hand, and
who may do the assigning. See Q12. The user's clarification narrows it: at
least the purchasing officer is **assigned by the Deal Owner**, not derived.

*Rules out:* visibility computed live from the current stage, which would make
history vanish behind people as deals advance.

### D6 — Stage gates are a general requirement engine *(2026-08-24, Q8)*

Not bespoke. Three tables: `stage_requirements` (stage, kind, label,
required-or-optional), `sor_requirement_status` (which are satisfied on which
deal), and one check in the single place stage transitions already funnel
through. Requirement kinds, now **four** after D10:

1. **attachment** — a file of a named sort is on the record
2. **field** — a named field is non-empty
3. **tickbox** — a human self-certifies
4. **assignment** — a person from a named department is assigned (see D10)

Deliberately excluded: **role sign-off**. It looks like a fifth kind and isn't
— it is an inbox, not a checkbox, and the existing Approval Center should own
it rather than the gate engine.

*Rules out:* the ITB pattern — named columns plus hand-written branches plus a
migration, per gate. The ITB gate is one gate and it cost more than this engine
will.

*Reversal cost:* moderate. The engine can always be bypassed by a bespoke check
alongside it; it cannot easily be removed once departments are configuring
their own workflows in it.

*Why it matters:* the stated requirement is "when i go to meeting with
department heads, i can literally change the config on the spot." Bespoke gates
cannot deliver that sentence at all.

### D7 — PMS is a stage, and it is where the Sales Offer Matrix lives *(2026-08-24, Q9)*

**Purchasing Monitoring System.** A stage, per the meeting — not a separate
module. What happens inside it is §3b: unit cost, markup, the Sales Offer
Matrix, and Finance OPEX. Automating the profitability assessment is
explicitly a *later* phase; the near-term job is to hold the data.

*Open:* C8 — the matrix cannot only be post-award, because part of its job is
the bid/no-bid decision. See Q17.

### D8 — Deal Type is picked at registration *(2026-08-24, Q10, partial)*

Chosen when the SOR is created.

*Still open:* whether it may change later. Recommendation on the table and
unopposed: changeable only pre-anchor, and changing it moves the deal to the
new pipeline's default stage with a log entry — the only rule that cannot
strand a deal in a stage its pipeline does not contain.

### D9 — `awarded_value`, a new field, set at Notice of Award *(2026-08-24, Q11)*

Never an overwrite of `expected_value`. Commission moves to
`coalesce(awarded_value, expected_value)`, so pre-award deals are untouched and
awarded deals price off the real number. A proof-of-award **attachment** is
required alongside it.

*Rules out:* editing `expected_value` at award — which would silently move the
Commission Pool ([commission.js:253](../src/utils/commission.js#L253) prices
off that field) and destroy the quote-vs-award variance, which is the exact
figure the edge case was raised to catch.

### D10 — Every stage names a department; the deal owner assigns the person *(2026-08-24, Q12)*

Generalised from the purchasing case. On entering a stage:

- the stage's **department head is added automatically**, and
- an **assignment prompt opens**, and the **deal owner must assign a specific
  person from that department** before the deal can leave.

That last clause makes assignment the **fourth requirement kind** in D6 rather
than a separate feature. Membership stays additive and permanent (D5).

*Rules out:* per-stage hard-coded joiner lists. "Admin at For Bidding",
"Operations at PMS" and "Purchasing at PMS" are all the same rule with a
different department, not three rules.

### D11 — No OCR *(2026-08-24, Q13)*

Dropped on cost-versus-impact. The awarded value is typed by Sales and backed
by the required attachment from D9. Revisit only if manual entry proves
error-prone in practice.

*Rules out:* the words-vs-numerals cross-check design. Worth noting it was a
genuinely favourable case for OCR — the source document renders every amount
twice — so if OCR ever returns, that is the design to return to.

### D12 — Remove ITB entirely *(2026-08-24, Q14)*

Not retired-but-kept. `is_itb_gate`, `itb_number`, `itb_exempt`, the
`For Bidding` gate branches in `opportunityService`, and the helpers
`itbGateStage` / `requiresItbNumber` / `itbGateSatisfiedBy` all go.

*Context:* the outright exemption shipped 2026-08-22 (81db97c) and the gate was
switched off 2026-08-21 (cc4fb4b). The mechanism was correct for a premise —
one pipeline, exceptions as flags — that D1 replaced two days later. Removing
it is cheaper than carrying it.

*Reversal cost:* low. Nothing depends on ITB except ITB. If bidding needs an
invitation number recorded again, it comes back as a **field requirement** in
the D6 engine, which is what it should have been.

### D13 — Post-award milestones are three stages, in list order *(2026-08-24, Q15)*

`Notice of Award → Performance Bond → Contract Agreement → Notice To Proceed`.
C5 resolved in favour of the stage list: **Contract Agreement comes before
NTP**; the "NOA - NTP - Contract Agreement" one-liner was a mis-recollection.

Stages rather than requirements, because government procurement stalls at each
of these individually for weeks and "where is it stuck" is the question ops
asks most — a requirement cannot answer it, a stage can.

*Cost:* all three land in the **locked region** past the anchor, so this is a
migration and a deliberate widening of what counts as Realized money. Deals
sitting in Performance Bond are booked.

### D14 — Drop `Negotiation`. `Payment Verification` belongs to Outright *(2026-08-24, Q16)*

`Negotiation` is unused and goes. Cheap — it sits at `sort_order` 50, *before*
the anchor, so removing it changes nothing about the Realized set.

`Payment Verification` turns out not to be a bidding stage at all: it belongs
to the **Outright** pipeline, where the deal completes on payment rather than
on award. Under D1 it therefore moves out of the Bidding list entirely instead
of being deleted.

### D15 — The Sales Offer Matrix opens at Proposal Submitted *(2026-08-24, Q17)*

C8 resolved. The costing and profitability assessment happens at **Proposal
Submitted** — earlier than either previous guess. Purchasing assesses
feasibility *before* the company commits to bidding, "so that they know already
their chances and the feasibility."

The PMS *stage* keeps the procurement-execution half of the sheet (`P.O. RFQ
NO.`, `Status`, `Source`). One artifact, progressively filled, opening at
Proposal Submitted and still being written at PMS.

*Coherence gained:* this finally gives `Qualified` a meaning. Qualified is
"we costed it and it is worth pursuing" — the assessment is what qualifies the
deal. Previously the stage marked nothing in particular.

*Note:* Proposal Submitted sits in the **SOR band** (D4), so the profitability
assessment happens before the deal is CRM's at all. That is consistent with the
first meeting note — stock checking was also placed at Proposal Submitted.

### D16 — Zero or more departments per stage *(2026-08-24, Q19)*

Not exactly one. `Lead` and `Proposal Submitted` name none; `For Bidding` names
Admin; `PMS` names Purchasing **and** Operations **and** Management. Each named
department contributes one auto-added head plus one deal-owner-assigned person
(D10).

### D17 — The Outright pipeline is not yet knowable *(2026-08-24, Q16)*

One real trace was supplied, from production:

```
Registered — Rio Chico Marketing, ₱3,080.00   10:43
"SQ Sent na ba Ito?" / "Sent na po boss"      12:03 / 13:12
Stage moved: Lead → Qualified                 13:14
Stage moved: Qualified → Proposal Submitted   13:16
"paid" + image.png                            13:21
Marked outright — no bidding required         16:08
Stage moved: Proposal Submitted → Closed Won  16:08
```

What it establishes: outright deals are **small and fast** (₱3,080, registered
and closed inside six hours), their milestones are *registered → quotation sent
→ paid → done*, payment proof arrives as a chat attachment rather than a field,
and the operator reached for `itb_exempt` purely to escape a gate built for a
process this deal is not in — exactly the failure D1 predicted.

What it does **not** establish: the intended outright process. This is one
observed path through a pipeline designed for something else, and the
operations side is too busy to be asked right now. **Do not seed an Outright
pipeline from this trace.** Build the container (D1), leave it empty, and treat
this as evidence for the eventual conversation.

### D18 — Requirement config is live forward, never retroactive *(2026-08-24, Q21)*

Adding a requirement to a stage binds only deals that have **not yet crossed
that gate**. A deal already past it is never re-evaluated and never shows as
non-compliant. No snapshotting, no config versioning.

*Chosen explicitly against this company's habit of "changing business logic out
of nowhere"* — the retroactive alternative would mark dozens of closed deals
non-compliant every time someone edits a checklist in a meeting.

*Forecloses:* retroactive compliance auditing. You cannot ever ask "how many of
last year's deals had a signed bond?" against a checklist that did not exist
then.

### D19 — The Outright pipeline *(2026-08-24, Q26)*

`Lead → Proposal Submitted → Qualified → Payment Verification → Closed Won`,
plus `Closed Lost`.

*Note a discrepancy, deliberately resolved in favour of the user's answer:* the
observed production trace (D17) moved `Lead → Qualified → Proposal Submitted`,
i.e. Qualified *before* Proposal Submitted. The stated pipeline puts Proposal
Submitted first, matching Bidding. Read as an operator clicking around in a
pipeline that was not built for their deal, not as evidence of a different
order.

*Still open:* whether `Payment Verification` is this pipeline's anchor (Q30).
It must have exactly one, and payment is the only event here that resembles
booking revenue.

### D20 — Purchasing is assigned at Proposal Submitted, per deal *(2026-08-25, Q28)*

Not per line item. The `Incharge` codes appearing on every matrix row are
spreadsheet convenience; assignment is a property of the deal. It happens at
**Proposal Submitted** — the same stage the matrix opens at (D15) — because
purchasing has to be on the deal before it can be costed.

*Supersedes* the assumption in D10 that purchasing joins at PMS. The general
rule from D10 survives intact; only the stage changes. `Proposal Submitted`
therefore names Purchasing as one of its departments under D16.

### D21 — No per-deal override; config deletion is soft and logged *(2026-08-25, Q23)*

Strict, as asked: a required item must be satisfied, and there is no
force-through button on the record.

The escape route that "strict" would otherwise create is closed instead —
deleting a requirement from the settings screen **archives** rather than
deletes, is Super Admin only, and writes an audit entry. Without this, "no
override" is not strict; it merely moves the escape from a logged, single-deal
action to an unlogged, permanent, all-deals one.

### D22 — Payment Verification is the Outright anchor *(2026-08-25, Q30)*

Each pipeline has exactly one anchor. For Outright it is `Payment
Verification`, because payment is the event that books the revenue. This also
resolves C12 for outright deals, which currently have no anchor to stamp
against at all.

### D23 — Stock state is tagged by hand first *(2026-08-25, Q31)*

The three matrix columns (`Status`: Stockable/Source Out, availability:
Available/For Order, `Source`: Import/Local) are entered by purchasing.
Auto-filling availability from Odoo is deferred — see §8. Rationale: "Stockable
vs Source Out" is a *sourcing decision a buyer makes*, not a number Odoo can
answer.

### D24 — ITR is 8% of the offer above a ₱250,000 allowance *(2026-08-25, Q29)*

`ITR = (FINAL OFFER − 250,000) × 8%`, verified exactly against the live sheet.
Adopted as the rule for the OPEX side.

*Not yet decided:* whether the Commission engine's `WITHHOLDING` — also 8%, but
applied to the VAT-exclusive amount with no allowance — should be reconciled to
match. That is a money-policy call, still parked with Q18.

### D25 — Split "Purchase Date/Order"; never rename it *(2026-08-25, Q34)* — **implemented**

`expected_award_date` keeps its name and gets its honest label back,
**Expected Award Date**. A new nullable **`po_date`** holds the fact — the date
printed on the attached PO, not the day someone clicked PO Received.

*Rules out:* renaming the column to Contract Date or PO Date, which would have
silently reclassified **seven future-dated forecasts** sitting in Lead and
Proposal Submitted as booked facts (§7e).

*Shipped:* migration
[0039](../supabase/migrations/0039_opportunity_po_date.sql), applied; the field
in both modals; `po_date` written by create and update; both dates named
correctly in the change log. The three post-award values were **copied** into
`po_date`, not moved, so nothing is lost if the reading is wrong.

*Deferred to D6:* making `po_date` **required** on entering PO Received. That
is a *field* requirement for the gate engine, not a `NOT NULL` constraint —
128 of 129 existing rows would violate one.

### D26 — C12 backfill executed *(2026-08-25, Q25)* — **done**

Thirteen rows written, each from an actual recorded stage move in its own
history. Five already-stamped rows untouched. **No date was invented.**

`CPSDRRMO` (₱126,000) was deliberately **left null**: its history holds no
stage-move entry, and writing a guess into a financial field makes it look
authoritative and stops anyone rechecking it. It needs someone to open its PO
attachment and type the date. Drift exposure meanwhile: about ₱22.

Result — 18 of 19 booked deals now anchored:

| Stage | Deals | Anchored | Still null |
| --- | --- | --- | --- |
| Awarded | 7 | 7 | 0 |
| PO Received | 9 | 8 | **1** |
| Closed Won | 2 | 2 | 0 |
| Retention | 1 | 1 | 0 |

*No commission figure changed.* One rate era exists (VAT 12%, withholding 8%,
pool 1%, all effective 2026-01-01), so every August date resolves identically.
What changed is that a future rate edit can no longer silently rewrite these
deals — quantified: a withholding move from 8% to 10% would have shifted
₱2,477.02 across them, ₱1,483.80 of it on one deal.

**Still outstanding — the code half of C12 is NOT done.** Stamping still fires
only on entry to the anchor. The fix (stamp on first entry to *any* booked
stage, plus a database trigger backstop) has not been written, so the
skip-the-anchor hole is still open and outright deals will keep hitting it.

### D27 — A stage belongs to exactly one pipeline *(2026-08-25, Q37)*

Two rows, not one shared row. `Qualified` in Bidding and `Qualified` in
Outright are **different stages that share a label**, because they mean
different things — one precedes a bid, the other precedes a payment.
Requirements therefore attach to a (pipeline, stage) pair by construction.

*Rules out:* stages shared across pipelines. The cost is configuring the same
thing twice where two stages genuinely are alike; the benefit is that a
bidding-specific document can never silently gate a dealer sale.

### D28 — A stage's gate checklist and its group task are two objects *(2026-08-25, Q38)*

The distinguishing question is **"does it block the stage move."**

| | Gate checklist (D6) | Group task checklist (L9) |
| --- | --- | --- |
| Purpose | the few things without which you cannot advance | the work to be done in this stage |
| Length | short and hard | long, assigned, tracked |
| Blocks the move | **yes** | no |
| Lives in | `stage_requirements` | `committee_task_members.checklist` (0015) |

Both fire on entering the same stage. Merging them fails in both directions: a
gate with twenty items means nobody advances, and a work list with three means
nobody knows what to do. The transcript's "For Bidding is where a team collects
documents" is the **group task**; the two or three documents that must exist to
leave the stage are the **gate**.

### D29 — Membership gates the record; aggregates read past it *(2026-08-25, Q39)*

Row-level SOR reads become member-only, replacing `using (true)`. **Super
Admin bypasses membership and sees every record.**

But the aggregate screens must not silently shrink. The Commission Dashboard,
the register count and the Employee Opportunity Matrix read through a
`SECURITY DEFINER` view that aggregates over **all** deals; Privacy Masking
continues to decide what is *displayed*, exactly as it does today
(client-side, per ADR 0002).

*Why this split matters:* Privacy Masking is currently a presentation rule over
a table everyone can read. Replacing it with a database filter would turn it
into a data-integrity problem — a Finance user would see smaller company
totals with no error and no indication why, which is the worst failure mode a
money screen has.

*Note the Super Admin bypass does not remove the need for the view.*
`CONTEXT.md` grants full monetary visibility to **Super Admin, Management, and
Finance & Accounting**. The latter two are not super admins, so without the
aggregate view their dashboard totals would still silently shrink to the deals
they happen to be members of.

### D30 — Build order *(2026-08-25, Q40)*

1. **Baseline the migrations** (Q32) — kills the existing conflicts and is a
   prerequisite for the next step anyway.
2. **Staging clone** (Q24, Q33) — nothing after this should be tested against
   production, and right now there is nowhere else.
3. **D6 gate engine** — `po_date` required at PO Received, the C12 code fix,
   and every department-head checklist are all queued behind it.
4. **Everything else**, with the Sales Offer Matrix last: biggest build, least
   blocking.

---

## 7b. Deferred work — the "later" list

Explicitly agreed as future phases, recorded here so they are not silently
lost. None of these is in scope for the current build.

| # | Deferred item | Blocked on / trigger |
| --- | --- | --- |
| L1 | **Odoo-driven stock availability** — auto-fill the availability column from Odoo underneath the manual tag, as a hint rather than an override (D23) | manual tagging shipped and in use |
| L2 | **Automated profitability assessment** — compute `ABC − FINAL ACQUIRE` over ABC, per line and per deal, and surface target-vs-actual markup so the worst line is visible without arithmetic (D7, §3b.3) | the matrix exists as data |
| L3 | **OCR on the Notice of Award** — dropped on cost-versus-impact (D11). If it returns, the design to return to is the words-vs-numerals cross-check, since the source document renders every amount twice | manual entry proving error-prone |
| L4 | **The real Outright process** — D19 is a container built from one observed trace plus one sentence. Operations could not describe it (D17) | operations having time |
| L5 | **Role sign-off as a requirement kind** — deliberately excluded from D6; belongs to the existing Approval Center, not the gate engine | a department actually asking for it |
| L6 | **Reconciling the two 8% figures** — the OPEX ITR (D24) and the engine's WITHHOLDING apply the same rate to different bases (C9) | Finance answering Q18 |
| L7 | **Liquidated Damages and the 1% Retention amount** — both appear in OPEX, neither exists as a field, and both reduce revenue (C10, C11) | Q18 |
| L8 | **ABC as a validated ceiling** — the sample bids at 99.12% of ABC. A submitted offer above ABC is a disqualified bid, and nothing currently stops one | the matrix exists as data |
| L9 | **Auto-created group tasks on stage change** — templates already exist (§2.5); nothing fires them | the gate engine, so a stage's checklist and its task are not two competing objects |

---

## 7. Glossary delta — pending implementation

These terms are **decided but not yet built**, so they deliberately do not go
into `CONTEXT.md` yet — the glossary describes the shipped domain, and writing
`Notice of Award` into it while the code still says `Awarded` would make it
lie. Fold each line into `CONTEXT.md` as its migration lands.

**Deal Type**:
Which commercial process an SOR follows — Bidding (government) or Outright
(dealer). Selects the deal's Pipeline. Not the same thing as **Project Type**
(SSP / CP / Strategic), which selects a commission split and is orthogonal.
_Avoid_: Sales Type, Deal Category

**Pipeline**:
The ordered stage list belonging to one Deal Type. Was implicit and singular;
becomes named and plural.
_Avoid_: Workflow, Funnel

**Notice of Award**:
The new label for the Anchor Stage (code `AWARDED`). Notification that the deal
was won, at which the awarded value first exists as a hard number on paper.
_Avoid_: Awarded, NOA (in UI copy — spell it out)

**SOR band** / **CRM band**:
Presentation groupings over one pipeline, not separate records. SOR covers Lead
and Proposal Submitted; CRM covers Qualified onward.
_Avoid_: SOR module, CRM module (implies separate systems)

**SOR Member**:
Someone with access to an SOR. Additive and permanent — a stage change may add
members, never remove them.
_Avoid_: Participant, Watcher, Collaborator

---

## 7c. Where the matrix would actually land

Answering "where do we use this in the current flow" — the honest answer is
that **half of the matrix has no home at all today.**

`sales_opportunity_items` holds exactly five meaningful columns:

```
product_name · unit · quantity · unit_price · sort_order
```

The list is populated from the Odoo sales order (`odoo-sor-lookup` reads
`sale.order.line`), edited in `OpportunityItemsEditor.jsx`, and summed into
`expected_value`. That is the whole of it.

Map that onto §3b.3 and the gap is stark:

| Matrix concept | Today |
| --- | --- |
| Offer component (`1.1`, `1.2`, …) | ✅ this *is* the current item row |
| `Odoo unit` | ✅ `unit_price` |
| Tender line (`1`, `2`, …) | ❌ **does not exist** |
| `ABC unit / total` | ❌ |
| `FINAL OFFER unit / total` | ❌ |
| `ACQUIRE`, `FINAL ACQUIRE`, `Markup Price` | ❌ |
| `Brand`, `Status`, availability, `Source`, `IPAS`, `Source Link` | ❌ |

So the matrix is not a re-skin of an existing screen. The existing item list is
**one column of it** — the Odoo price — and everything the sheet exists to do
(cost, markup, sourcing, stock, the offer, the ceiling) has never been in the
system. That is why the spreadsheet is still the spreadsheet.

## 7d. Purchase Order date — the field nobody fills, because it isn't there

Reported behaviour: on reaching PO Received, ops attach the PO document and
write a log note; no date is recorded, and "they don't even notice it."

They don't notice it because **`sales_opportunities` has no PO date column.**
Verified against the live schema — the date fields are `registration_date`,
`expected_award_date`, and `contract_date`. There is no `po_date`,
`purchase_date`, or equivalent. (`sor_procurement_requests` carries a
`po_number` and `odoo_vendor`, but that belongs to the uncarried-product
sourcing flow, not to the deal.)

Consequence for C12: for a `PO Received` deal, the date that *should* anchor it
is the PO's own date, printed on the attached document. The stage-move date is
only a proxy for it — the day somebody got around to clicking, which can trail
the PO by days.

## 7e. "Purchase Date/Order" — one field, two meanings, both in use

The input does exist. It is **`expected_award_date` wearing the label
"Purchase Date/Order"** — `OpportunityFormModal.jsx:341`,
`OpportunityDetailsModal.jsx:1744`, and `opportunityService.js:213`. The column
name says *forecast*; the label says *fact about a purchase order*. Both
readings are live in production:

| Stage | Filled | Future-dated | Past-dated |
| --- | --- | --- | --- |
| `LEAD` | 6 | 1 | 5 |
| `PROPOSAL_SUBMITTED` | 8 | **6** | 2 |
| `BID_SUBMITTED` | 2 | 0 | 2 |
| `AWARDED` | 1 | 0 | 1 |
| `PO_RECEIVED` | 1 | 0 | 1 |
| `CLOSED_WON` | 1 | 0 | 1 |
| **Total** | **19 of 129** | **7** | **12** |

The split is clean and it follows the stage. Pre-award, people enter a **future
date** — a forecast of when the award is expected, which is what the column
name means. Post-award, every filled value is in the past — a **record of a PO
that happened**, which is what the label means.

**So renaming the column to Contract Date would be wrong.** It would silently
reclassify seven forecasts as booked contract dates, and those seven sit in
`Lead` and `Proposal Submitted`, nowhere near booked.

The fix is to split, not rename: `expected_award_date` keeps its name and gets
its honest label back (**Expected Award Date**, pre-award forecast), and a new
**`po_date`** holds the fact — read off the attached PO document, required on
entering PO Received as a *field* requirement under D6. The three post-award
rows migrate to `po_date`; the seven forecasts stay where they are.

## 8. Housekeeping found along the way

- **`sales_opportunities.stage_checkpoints` is an orphan column.** It exists on
  all 128 production rows, holds `[]` on every one of them, and **is referenced
  by nothing** — not one line of application code, not one migration file. It
  appears in the live schema but in no migration, which is the ledger drift
  this project already knows about, showing up again. Its name is suspiciously
  close to the per-stage checklist feature D6 describes. Either it was an
  earlier start on this same idea that was abandoned, or it is dead weight.
  Decide which before D6 invents a second concept beside it.
  **Resolved 2026-08-25:** the user confirms it was their own start on this
  feature, backlogged. D6 reuses the name rather than inventing a second one,
  and the column survives the Q32 baseline. It stays `[]` until D6 ships.

- `docs/adr/` has **two files numbered 0002** (`…commission-pool…` and
  `…web-speech-api…`), and **no 0003** — which migration
  [0033_crm_pipeline_stages.sql:29](../supabase/migrations/0033_crm_pipeline_stages.sql#L29)
  references as the rationale for the locked region. That rationale currently
  exists only as a comment in the migration. New ADRs start at 0004.

---

## 9. Revision log

| Date | Change |
| --- | --- |
| 2026-08-24 | Opened. Raw input captured, current behaviour grounded, seven contradictions named, round-1 questions posed. |
| 2026-08-24 | Round 1 answered. D1–D5 recorded; Q2 re-asked as Q8 (answer contradicted the meeting note); Q7 expanded — PMS is *Purchasing Monitoring System*, an existing spreadsheet, not a stage name. |
| 2026-08-24 | Round 2 answered. D6–D12. Sales Offer Matrix and Finance OPEX structure captured (§3b) and its arithmetic verified; C8–C11 raised. OCR dropped, ITB removed entirely. |
| 2026-08-24 | Round 3 answered. D13–D17. C12 raised and then confirmed against production: 119 SORs, **zero** Contract Dates, ₱4.0M of Realized pool unanchored. Q18 parked pending Finance. Q20 re-asked as Q23 — the user agreed without understanding it. |
| 2026-08-25 | Round 4 answered. D18–D19. A second, fully populated Sales Offer Matrix supplied — §3b.3 added, every total verified, the two-level tender-line/component structure established, ABC confirmed as a used ceiling. |
| 2026-08-25 | Round 9 answered — D27–D30. Frontier empty: stage-per-pipeline, gate vs group-task checklists separated, the RLS rewrite scoped so aggregates read past membership, and the build order fixed. |
| 2026-08-25 | Meeting transcripts received (§3c). One usable, one mistranslated into Malay and needing a re-render. Confirmed D3, D6, D10, L9 and the `Incharge` reading; raised C13 (purchasing's entry stage disputed) and C14 (the room could not tell the two pipelines apart); flagged `Closed Lost`'s position. |
| 2026-08-25 | Rounds 6–8 answered. D25–D26. "Purchase Date/Order" found to be `expected_award_date` mislabelled, with both meanings live in production (§7e) — split rather than renamed, and **implemented**. `stage_checkpoints` identified as the user's own backlogged start on D6. **C12 backfill executed**: 13 rows written, none invented, one deliberately left null. Vercel preview protection verified already on. |
| 2026-08-25 | Round 5 answered. D20–D24 and the deferred list (§7b). **ITR solved exactly** as `(offer − 250,000) × 8%`. C12 re-measured — the earlier 11-deal figure was stale; production now holds 19 booked deals, 5 correctly stamped today, 14 needing backfill. Dry run published as an artifact; no rows written. |

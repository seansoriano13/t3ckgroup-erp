# Purchasing: the whole life cycle

Written 2026-10-19 from the code, the migrations and the glossary (CONTEXT.md). It is a reading guide, not a spec. It says what the code does today. Where I could not confirm something, it says so in the last section.

Key words: **SOR** is a sales opportunity record, one deal. **PO** is T3CK's purchase order to a supplier, raised in Odoo. **IPAS** is the company's record of one PO. **PMS** is the SOR's purchasing tab.

---

## 1. The big picture

Purchasing is not a pipeline with stages. It is a set of records. Each record is created at a different time, and one SOR can have many of most of them.

| Record | How many per SOR | Created by |
|---|---|---|
| Purchase Request | one at most (Project kind) | A Stage Action, or a person (Direct kind has no SOR) |
| Requested Item | many | Sales, the Buyer, or Purchasing |
| Costing Matrix | one | A Stage Action |
| Canvass (and its Offers) | one per Component, or per Requested Item that names no Component | Purchasing |
| IPAS | many (one per PO). One IPAS can also name several SORs | Purchasing |
| Transmittal (TG03 slip) | many | Purchasing, Warehouse or Logistics |
| Packing List | many | Purchasing or Warehouse |

How they connect:

```
 SALES FLOW (stages on the SOR)
   Stage Action "Open Costing Matrix" ───────────► COSTING MATRIX
   Stage Action "Open Purchase Request" ─────────► PURCHASE REQUEST ──► REQUESTED ITEMS
                                                        │  (item may name a Component)
   COSTING MATRIX ◄──── Component ◄──────────────────────┘
        │  Component ◄── CANVASS + OFFERS (winner fills Acquire, spec, brochure)
        │
   Requested Item "Ordered" + PO number + PO lines ──► IPAS (one per Odoo PO)
                                                          │ payments, charges, bank, documents
                                                          │ sign-offs 1 and 3, then 7 = Filing
   IPAS PO lines ◄──── TRANSMITTAL (TG03) ───────────────┘ (Warehouse, Technical, Check by)
        │
        └─ Landed Cost flows back to the Component on the Costing Matrix (read only)

   ORDER MONITORING = every open IPAS, "what is it waiting on and who owes it"
   PURCHASING DASHBOARD = every SOR's buying, grouped by what is outstanding
   Stage Conditions on the Sales Flow read it all: Purchasing settled, Costing priced, Costing settled
```

Three rules that explain many surprises:
1. **Groups are derived, never stored.** There is no "current purchasing stage" for an SOR (ADR 0023).
2. **Nobody writes to Odoo.** The ERP only reads it. IPAS keeps a copy of the PO.
3. **Access is a flag per employee**, never the department text.

---

## 2. Who can do what

| Who | How they get it | What it gives |
|---|---|---|
| Purchasing access | `has_purchasing_flow` flag | Takes and buys requests. Raises and edits IPAS. Edits option lists and ageing rules. Cost-tier view of the Costing Matrix. Reads the Dashboard and Order Monitoring. |
| Finance access | `has_finance_flow` flag | Reads IPAS and the Dashboard. Records payments and charges. Sees bank details. Ticks "Finance has it". Edits costing rates and Marketing and OPEX. Gives "Checked by" on Computation status. |
| Super Admin | flag | Almost everything. Sets sign-off lists. Reopens a filed IPAS. Sets the first Transmittal number. Overrides reference rates. Closed Book view of costing. |
| IPAS sign-off lists | Super Admin fills `ipas_signer_lists` | Section 1 Approved, section 3 Approved, section 7 Received, Noted, Checked, Approved. Being on any list also lets you read every IPAS. |
| Transmittal staff lists | same table | Warehouse, Technical, Logistics, Check by. They read Transmittals, not IPAS (no prices). Check by also signs Canvasses. |
| Final Acquire list | `costing_signer_lists` | Closed Book view (sees all costing money). Sets Final Acquire and markup. Takes the Bid Decision. |
| Evaluation list | `costing_signer_lists` | Approves the Evaluation of Specification. |
| Deal Team | on the SOR | Price-tier view of the matrix. Adds Requested Items. Cancels items. |
| Any employee | none | Opens a Direct Purchase Request. Follows their own requests. |

Costing Matrix money is served by **tier**, and the database cuts each reader down to the columns they may see:

| Tier | Who | Sees |
|---|---|---|
| closed_book | Super Admin, Final Acquire list | Everything: Acquire, Final Acquire, markup factor, achieved markup, summary, Bid Decision totals |
| cost | Purchasing access | Acquire and Odoo unit cost. Not the markup factor, not Final Acquire. Sees Markup Price only through the Canvass projection. |
| price | Deal Team, "always sees" | Final Offer, Odoo unit, Markup Price. Never the Acquire or the factor. |
| participant | called in by a Stage Action | The matrix with no money |
| none | everyone else | Nothing |

---

## 3. Every page

| Page | Route | Who | What it does |
|---|---|---|---|
| Purchase Requests | `/purchasing` | Everyone | The list. Purchasing sees all, everyone else sees their own. Filters by kind and by unassigned, mine, open, closed. Take a request. Open the request view. New Direct request. |
| Purchasing Dashboard | `/purchasing/dashboard` | Purchasing, Finance, Super Admin | Five groups: To source, To price, To order, On order, To check. Filters by Buyer and Canvasser, with ageing applied from Order Monitoring's rules. |
| IPAS list | `/purchasing/ipas` | IPAS readers | Filter by state. Raise a new IPAS (PO number, priority, source, purpose, SORs, remarks). |
| IPAS | `/purchasing/ipas/:id` | IPAS readers | The full record, in seven parts (see section 7). Prints. |
| IPAS settings | `/purchasing/ipas/settings` | Purchasing, Super Admin | Redirects to Settings, Purchasing tab. Everyone else goes home. |
| Order Monitoring | `/purchasing/order-monitoring` | Purchasing, Finance, Super Admin | Every open IPAS in four groups: Needs chasing, Waiting on us, Waiting on someone else, Filed (collapsed). |
| Transmittals | `/purchasing/transmittals` | IPAS readers and the four staff lists | The list of TG03 slips. |
| New Transmittal | `/purchasing/transmittals/new` | Preparers | Raise a draft slip. |
| Transmittal | `/purchasing/transmittals/:id` | Slip readers | Lines, stages, ratings, pictures, signatures, Check by. |
| Packing Lists | `/purchasing/packing-lists` | IPAS readers and the Warehouse list | The list. |
| Packing List | `/purchasing/packing-lists/:id` | Readers | Boxes and contents. Pack. |
| Settings, Purchasing tab | `/settings?tab=purchasing` | Purchasing, Super Admin | Option lists, Transmittal lists, Ageing rules, Reference rates, Sign-off lists. |
| Costing Matrix settings | inside the matrix settings | Finance, Super Admin | Rates, markup presets, signer lists, the Evaluation template. |
| Approval Center: IPAS | `/approvals/ipas` | Sign-off list members | Sign-offs waiting for them. |
| Approval Center: Transmittals | `/approvals/transmittals` | Check by list | Slips waiting for Check by. |
| Approval Center: Canvass sign-offs | `/approvals/canvass-signoffs` | Check by list | Canvasses with a winner and a reason, not yet signed. |
| Approval Center: Bid Decisions | `/approvals/bid-decisions` | Final Acquire list, Super Admin | Matrices with a Final Offer on every line and no live decision. |
| SOR modal, PMS tab | inside the SOR | Anyone who can see the SOR | The Costing Matrix (if you have a tier), the Purchase Request card, IPAS summaries, Transmittals and Packing Lists. |
| SOR modal, Now / Items / Journey | inside the SOR | SOR readers | Show the Buyer, item statuses and where orders stand. |

The old "Procurement Queue", the SOR Purchasing panel and `sor_procurement_requests` are retired. The old table is read-only history.

---

## 4. One purchase, start to finish

This is the usual path for a government project. Many steps can overlap, and none of them is forced.

1. **The SOR enters a stage that has "Open Costing Matrix".** The Costing Matrix is created. The Sales incharge defaults to the Deal Owner. A Purchasing incharge may be named. If none is, the people in "assigners" are told.
2. **Sales or the Deal Team opens a Purchase Request** (stage action or optional action). They add Requested Items by picking SOR lines, or by describing a new product. A Buyer from Purchasing takes the request, or the action names one.
3. **Purchasing builds the Matrix.** It adds Tender Lines and Components, and an Acquire cost on each Component. Optionally it adds Requested Items from Components.
4. **Canvass.** Purchasing opens a Canvass on a Component, collects Offers, marks a winner and writes the reason. The winner fills the Component's Acquire, spec and brochure. A purchasing approver signs the Canvass.
5. **Costing sign-offs.** Prepared (Sales incharge), Costed (Purchasing incharge), Evaluation approved (evaluation list), Final approved (Final Acquire list). The Final Acquire list sets Final Acquire and markup. Then it takes the Bid Decision: Go, No-go or Revise.
6. **Stage Conditions** "Costing priced" and "Costing settled" can now pass, so the SOR can leave those stages.
7. **Ordering in Odoo.** The Requested Item is set to Ordered. A PO number is optional, but without one nothing downstream can link.
8. **Purchasing raises an IPAS** for that PO. It copies the Odoo PO. Payments, charges, bank details and documents are added.
9. **IPAS sign-offs.** Purchasing prepares sections 1 and 3, then the lists approve them. Then section 7: Received, Noted and Checked, then Approved. Approved files the IPAS and freezes it.
10. **Goods arrive.** Someone raises a Transmittal. Warehouse checks and rates every line. Technical inspects. Two Check by signers close the slip.
11. **Items become Received**, so "Purchasing settled" can pass when every item is closed.
12. **Landed Cost** appears beside Acquire on the Component. It is provisional until the IPAS reaches "LC Odoo Done", then final.
13. **Packing List** if goods go out to the client in boxes.

---

## 5. Linking Purchasing to the SOR (the Sales Flow side)

### Stage Actions (they run once when the SOR enters a stage)

| Action | What it does | Config |
|---|---|---|
| Open Purchase Request | Creates the SOR's one request, or tops up an existing one. Sets the Buyer only if none. Adds missing members. Never removes a member or replaces the Buyer. | Who may request items, Buyer option, who is called in, access window |
| Open Costing Matrix | Creates the matrix, or tops up. Fills only blanks: Incharges, default markup factor, members without an open window. | Sales incharge, Purchasing incharge, assigners, markup preset, extra people, window |
| Request Packing List | **Planned in ADR 0033 but not built.** No code or migration for it exists. | none |

Rules for both built actions:
- They run on entering the stage. A Return does not re-run them.
- The Deal Team runs them: the caller needs edit or full access to the SOR.
- A purchasing member gets a Stage Participant window on the visit where the request opened. Other members read only the request and the SOR's locked header.
- SORs already past the stage are covered by a one-off backfill. It adds rows and never removes any.

### Stage Conditions (they block leaving a stage)

| Condition | Met when |
|---|---|
| Purchasing settled | Every Requested Item is closed. **Also met when the SOR has no Purchase Request, or the request has no items.** |
| Costing priced | The matrix exists, has at least one Component, every Component and cost-only row has an Acquire, and a Purchasing incharge is named. |
| Costing settled | A Final Offer on every Tender Line, a complete summary (every costed row has a Final Acquire), the Evaluation approved, the Final Offer total not over the ABC, and a live Bid Decision of Go. |
| Goods checked, Orders filed | **Planned in ADR 0033 but not built.** No code or migration for them exists. |

Edge cases:
- No matrix means both costing conditions read **unmet**. The Flow Canvas warns at publish if no earlier stage opens the matrix.
- Purchasing settled can be asked "as of" when a visit closed. An item raised later does not count, and an item counts as closed only if it closed by then.
- Callers outside the price and Closed Book tiers get only the server's yes or no for "settled", with no reasons, so no money leaks.
- A Revert or a Return is never blocked by a condition.
- There is no Canvass gate. An item can be ordered with no Canvass. The matrix row and the printed sheet say so.
- Moving out of a stage whose "Costing settled" was met stamps `bid_submitted_at`. After that, a change to any Tender Line's Final Offer writes a timeline entry on the SOR, with no figures.

### What the SOR shows back
- **PMS tab**: matrix (tiered), Purchase Request card, IPAS summaries, Transmittals and Packing Lists.
- **IPAS summary on the SOR** (anyone with full SOR access): number, PO, supplier, state, buyer-track ticks, computation status and sign-off progress. Never payments, charges, bank details or Landed Cost. Money-tier readers also get a Landed Cost total and its mark. Only Project IPAS appear, and an IPAS naming two SORs appears on both.
- **Where orders stand on the SOR**: dates and Transmittal facts only, run through the same `orderStanding` function as Order Monitoring so the two always agree.
- **Transmittals and Packing Lists on the SOR**: only submitted slips, never remarks or files.
- **Items tab and Journey**: item statuses and the Buyer, even for readers who are not members of the request.
- **Lost or deleted SOR**: the request shows "SOR lost" or "SOR deleted".

---

## 6. Purchase Request and Requested Items

### The request
- **Kind is derived.** Project if it has an SOR, Direct if it has none. Never stored.
- **One Project request per SOR.** Deleting the SOR deletes its request, members, items and chat.
- **Nobody approves a request.** A Buyer just takes it.
- **Who reads it:** a member, a Super Admin, or anyone with Purchasing access while the request has no Buyer. Once there is a Buyer, a purchaser who is not a member stops seeing it. Direct requests make every Purchasing holder a member when they open, so those stay visible.
- **Buyer.** Anyone with Purchasing access can Take an unassigned request. A refusal comes if someone else has it. A purchasing member or Super Admin can name or clear the Buyer. Clearing sends the request back to the list. The Buyer cannot be removed as a member.
- **Members.** Only purchasing members and Super Admins add or remove members. A sales-side member cannot.
- **Chat.** Append-only. Nobody can edit or delete a message, the author included. Mentions are stored as ids. Only members can be mentioned. Status changes, member changes and the Buyer posting an event message are written by the system, never by hand.

### Who can add Requested Items
- The Deal Team always can (fixed in #503 after the requesters list had locked them out).
- Anyone on the action's "requesters" list can, on top of the Deal Team.
- The Buyer can.
- On a Direct request, the one who opened it can.
- Adding from Components is **Purchasing access only**. A Buyer without Purchasing access cannot.

### Where an item comes from
- **From an SOR line:** name, quantity, unit and Odoo product are copied, with a snapshot. Later SOR edits never change the item. The view can say "SOR line now says N" by comparing against the current line.
- **New product:** typed in. Direct requests allow only this kind.
- **From a Component:** copies name, quantity, unit and Odoo product. It keeps its own copy, so editing the Component later does not rewrite what was asked. A Component from another SOR is refused. It is all or nothing.
- **Substitute:** the Buyer adds a replacement item linked to the one it replaces. The original moves to Substituted.
- **Stock badge:** read from the SOR's stock snapshot, always shown with the time it was fetched. "Not checked" if never read. Never live.

### The item status path

```
Requested ─┬─► From stock (closed)
           └─► To order ─┬─► Canvassing ─► Ordered ─► Received (closed)
                         └─► Ordered            (skipping Canvassing is allowed)
Ways out from any open status (all closed): Substituted, Cannot source, Cancelled
```

| Actor | May do |
|---|---|
| Purchasing (Super Admin, or a member with Purchasing access now) | Walk the path and take any way out |
| Sales side, the Buyer without Purchasing access, a Direct request's Requester | Cancel only |
| Any other member, or a non-member | Nothing |

Edge cases:
- A closed status goes nowhere. There is no undo.
- **Ordered** takes an optional PO number. It is trimmed and upper-cased, and must look like "P" then digits. It is checked against Odoo first. Any other status takes no details.
- With a PO number, Ordered can record the Odoo PO line or lines the item is bought on. The lines are picked from that PO's IPAS copy, and a line not on that copy is refused. An Ordered item with a PO but no picked line reads **"PO line not picked"**. Landed Cost cannot find its way back until the line is picked.
- Opening a Canvass moves the item from To order to Canvassing, if it was at To order. An item at any other status is left alone.

### Who is notified (one trigger on every message)

| Event | Told |
|---|---|
| Request opened, no Buyer | Everyone with Purchasing access, once |
| Request opened, Buyer already named | The Buyer |
| Buyer set | The new Buyer (not if they set it themselves) |
| Item status changed | The Buyer and the item's requester |
| Item added | The Buyer |
| Plain message, once a Buyer exists | Only the Buyer and the requesters |
| Mention | The person mentioned, in place of the ordinary message notice |

Nobody is told about their own action. A deleted employee is never told.

---

## 7. The Costing Matrix

### Shape
- **Tender Line**: what the client asked for. Has quantity and a Final Offer. Compared with the ABC (Approved Budget for the Contract).
- **Component**: what T3CK supplies toward a line. Has Acquire, Odoo unit, Final Acquire, a markup factor override, Brand, Status, availability, Source, P.O./RFQ No., Offer Specification and documents. May be a **bundle**.
- **Inclusion**: an unpriced check row under a bundle Component only. Its Completeness is Covered, Missing, Substituted or Not required (which drops out of both sides of the fraction). An SOR with no Inclusions has no completeness figure, which is different from 0%.
- **Cost-only row**: a row below the lines, such as the Delivery Charge.
- **Incharges.** The Sales incharge must be on the Deal Team. The Purchasing incharge must have Purchasing access. Incharge is a name, not a call-in. It grants nothing and notifies nobody.

### Who writes which column (the "bands")
The database refuses a write outside a column's band, using the caller's own login.

| Band | Columns |
|---|---|
| Sales | Brand, Status, Odoo unit |
| Purchasing | P.O./RFQ No., availability, Source, Acquire, Offer Specification |
| Management (Final Acquire list) | Final Acquire, markup factor |
| Technical | Compliance, its note, recommended alternative, an Inclusion's Completeness |
| Finance + Management | Marketing, OPEX |
| Sales or Purchasing | Adding or removing rows |

### Money maths
- **Markup Price** = Acquire × the row's own factor, else the matrix default factor. Rounded half up to the centavo. A cost-only row with no factor is ×1.00. Blank while Acquire or the factor is blank.
- A preset's factor is **copied** when picked. Editing the preset later does not move a matrix that used it.
- Settings rates default to VAT divisor 1.12, tax 6%, retention 1%, ITR 8% and ITR allowance ₱250,000. The sheet's tax and ITR maths is copied on purpose (#213). Do not "fix" it.
- Operational Expenses is not typed. It is the Final Acquire total. Only Marketing and OPEX are typed.
- The summary is worked out in the browser from what the caller's tier received. Only Closed Book has enough to compute it.

### Compliance and Evaluation of Specification
- Each Component gets a verdict: complies or deviates. **Deviates requires a note** (database CHECK).
- Technical is Purchasing access, **or** a current member of a group task on that SOR made from the "Evaluation of Specification" template. A Super Admin sets the template in the Costing Matrix settings.
- The evaluation approval is **cleared automatically** when a Tender Specification, an Offer Specification, a verdict or its note changes, or when a Tender Line or Component is added or removed. A Canvass winner that fills the Offer Specification clears it too.
- To approve: the caller is on the evaluation list and every Component has a verdict.

### Four sign-offs (live one = the uncleared row; cleared rows stay as history)

| Role | Who signs | Cleared when |
|---|---|---|
| Prepared | The matrix's Sales incharge | A Final Offer or a Tender Line quantity changes |
| Costed | The matrix's Purchasing incharge | An Acquire or any markup factor changes |
| Evaluation approved | Evaluation list | Spec or verdict changes (above) |
| Final approved | Final Acquire list | A Final Acquire, Final Offer or quantity changes |

Each needs a read tier on the SOR. A signature image is snapshotted at signing, so a later upload never rewrites an old print. A signer may decline to apply it.

### Bid Decision
- Go, No-go or Revise, with a written reason.
- Taken by a Super Admin or a Final Acquire list member. There is no self-approval rule, and the list starts as one person.
- It stamps the Final Offer total and ABC total in SQL.
- It **moves nothing on the SOR.** PMS never moves the deal. No-go and Revise tell the Deal Team.
- A change to a Final Offer, a Final Acquire or a quantity **clears the live decision** with a reason. It then returns to the Approval Center queue.
- Sales sees the verdict and reason, never the numbers.

### Edge cases and guards
- A matrix exists only after its action has run. There is no registration trigger and no backfill.
- A Component with a Requested Item or a typed PO number cannot be deleted. Neither can a Tender Line holding one, until unlinked. Purchasing can detach an item from its Component, and the unlink is written to history. A cascade (the SOR going) is not refused.
- An Inclusion sits under a bundle only. A bundle that still has Inclusions cannot stop being a bundle.
- Old SOR Inclusions were moved under an "Unplaced inclusions" line once. The old table is read-only.
- The matrix history (`costing_events`) is written by triggers and is append-only. Only Closed Book reads it directly.
- The Component's grid can show what is being bought for it (item status and request id only) at every tier.
- The grid shows a "PO supplier differs from the winning Offer" note when they differ. It compares the Component's PO supplier (from the IPAS copy) with the winning Offer's supplier.

---

## 8. Canvass and Offers

- **Subject:** exactly one Component, or exactly one Requested Item. Never both, never neither, never an Inclusion. A Requested Item that names a Component is canvassed **through the Component**, and a database trigger refuses otherwise.
- **Number:** `CNV_0001` and up, assigned by trigger, never reused.
- **Re-point:** a Canvass started on a bare Requested Item can later move to the Component that appears. It keeps its number, Offers and reason. The move is refused if that Component already has a Canvass.
- **Canvasser** defaults to the Component's Purchasing incharge, else the matrix's, else the request's Buyer. Purchasing can change it. Ownership, not access.
- **Offer:** supplier (Odoo supplier suggestions, or typed), brand, description, source link, brochure, remarks, unit price in the currency quoted, a **comparison rate**, quote valid until, lead time and a quality note.
- **Currencies:** PHP, USD, EUR, AUD. The Reference Rate only exists for USD and EUR, so an AUD Offer gets no pre-filled rate.
- **Comparison rate** is never the rate actually paid. It pre-fills from the Reference Rate, and the typed value is what is stored. A foreign Offer with no rate has **no PHP figure** at all.
- **Prices are money.** A Stage Participant never receives them. On a Requested Item, prices need Purchasing, Finance or Super Admin on top of reading the request.
- **Expired quote:** on and after its valid-until date. No date means it never expires.
- **Winner:** at most one. Marking a new one clears the old.
  - On a **Component** the winner fills Acquire (price × comparison rate for foreign, to the centavo), Offer Specification and a brochure citation.
  - A field whose "from Canvass" mark was cleared because someone typed over it is left alone, unless it has no value yet.
  - If a new winner has no price or no description, the old "from Canvass" mark is dropped and the value is kept.
  - On a **Requested Item** a winner fills nothing.
  - The winner's **brand is only proposed.** Sales accepts it into Brand.
- **Offer Projection:** for each Offer, the Acquire it would fill and the Markup Price that follows. Served to Closed Book and Purchasing only. Purchasing sees the peso price but never the factor.
- **Sign-off:** the signer must be on the Check by list (the same list that approves Transmittals). They cannot sign a Canvass they opened. It needs a winner and a non-blank reason. A Super Admin who is off the list is refused. Fewer than three Offers is a **warning**, never a block. Editing a signed Canvass **clears the sign-off**: any Offer or price change, a winner change, or a reason change. Nothing locks.
- **Canvasser cannot be the signer** is the rule that is easy to trip on. The creator is kept in the trail even if the Canvasser changes.

---

## 9. IPAS

### Raising one
- **Only Purchasing** raises it. It needs a PO number in the "P" plus digits form, a Priority (Very High, High or Medium), a Source (Import or Local) and a Purpose (Project, Inventory, Supplies or Events).
- The PO is read from Odoo by **exact name only**, and the copy must be for that PO. If Odoo cannot be asked, the IPAS cannot be raised, and the error says Odoo was unavailable, not that the PO is missing.
- **One live IPAS per PO.** A cancelled one frees the PO. The PO number never changes after insert. A wrong PO means cancel and raise again.
- **Project needs at least one SOR.** The other three Purposes must name none (their note goes in Remarks). Deleted SORs are refused. An IPAS can name several SORs.
- **Number:** `TGIPAS_` plus the sequence, three digits minimum, one series across all four entities. It starts at 49 because the sheet ended at 048. It never goes back, and a cancelled number is never reused. (The padding bug at 1000 was fixed.)
- A document row is created for every active document kind that matches the Source.

### The seven parts (screen numbering; stored sign-off sections are still 1, 3 and 7)
| Part | Name | Notes |
|---|---|---|
| 1 | Purchasing | Odoo copy, header, overrides. Sign-off section 1 |
| 2 | Purchasing & Finance | Payments, charges, bank details, documents. Sign-off section 3 |
| 3 | Computation status & Landed Cost | |
| 4 | Filing | Sign-off section 7 |
| 5 | Sales & Operation | The Transmittals that name the IPAS |
| 6 | Logistics | |
| 7 | Status | The buyer track |

### The Odoo copy
- `odoo_copy` holds `{ po, supplier, lines, receipts, bills }`. Opening an IPAS refreshes it. Anyone who can read IPAS can trigger the refresh.
- **Overridable:** Entity, Source Doc and Analytic Dist. only. Each override and reset is written to history. **Not changeable by anyone:** Currency, Supplier, item lines, Brand. Fix those in Odoo.
- Supplier contact and P.I # are typed. Odoo fills them only while blank.
- **If lines or the total changed since the last copy, the live section 1 and 3 approvals are cleared** ("PO changed in Odoo") and the preparers are told. A change note records what changed.
- **On a filed IPAS** the refresh stores nothing. It only raises `odoo_changed_since_filing`, which can move both ways.

### Payments, charges, bank, documents
- **Payments** (any number): kind (down payment, payment, full payment, shipping fee), date, amount in the PO's currency, **PHP debited (required on a foreign-currency PO)**, charge fee in PHP, method, Check No., proof of payment. Purchasing **or** Finance may add, change or remove them, on an open IPAS only. Every change writes history, and a removal keeps a snapshot.
- A payment added while section 1 has no live Approved is flagged **paid before approval**. Payments and charges never clear an approval.
- **No balance is ever computed.** Withholding would leave a "balance" unpaid forever. The header DP and FP figures are derived by the client and never stored.
- A typed rate more than the currency's divergence (default 2%) from the Reference Rate is **flagged beside the payment**. The Reference Rate never fills a payment.
- **Charges:** kind (list), date, PHP amount. A charge that covers several purchases is entered as each one's share.
- **Bank details:** only Purchasing can type them. Finance cannot, so a changed account stays a check between two departments. Readers: Purchasing, Finance, Super Admin, and members of the section 1 or 3 approval lists. Section 7's Noted and Checked signers read the IPAS but get no bank details, and the database refuses them.
- **Changed account flag:** the Account # is compared (spaces and dashes stripped) with that supplier's most recent **other, non-cancelled IPAS with an Account # typed**, matched on the Odoo partner id. A difference raises the flag, clears the section 1 and 3 approvals and tells the preparers. Correcting the number clears the flag. The first IPAS for a supplier is never flagged, and neither is one whose supplier has no Odoo partner id. The account numbers are never written to history.
- **Documents:** one list per IPAS, two ticks per row: **Purchasing has it** and **Finance has it**. Neither side can tick for the other. Each row can carry a file. Hand-added rows can be removed. Rows from a document kind can only be ticked or left unticked. Unticked required documents **warn at Filing but never block**.
- **Supplier Origin dates** (Shipped Out, Onboard, Arrived in PH, Arrived in Whs.) are accepted on an **Import IPAS only**. A Local IPAS is refused twice over.
- **Item Location** is one typed value from a list.
- **Section 2 ticks:** Googlesheet and Gantt Chart. No sign-off, so ticking clears nothing.

### Landed Cost
- Worked out in **one place, the database**. The IPAS page, the SOR summary and the Costing Matrix all read the same result.
- It is the pre-tax PO price (at the rate **actually paid** on a foreign PO), plus every charge, charge fee and shipping fee, spread over the lines by value, quantity, or equally. Value falls back to equal when nothing is priced. It is spread in whole centavos by largest remainder, with ties to the earlier line.
- **Marks:** `unavailable` (a foreign PO with no payment), `provisional`, and `final` at LC Odoo Done, Checked by, or filed.
- It is **computed on read and stored nowhere.** It feeds no markup, Final Acquire, summary, revenue, "Costing settled" or sign-off.

### Computation status (set by Purchasing)
Encoding → Encoded → LC GS Done → LC Odoo Done → Checked by.
- Filing needs LC Odoo Done or Checked by.
- Finance, or a Super Admin who is not Purchasing, gives and takes back Checked by. Everything else is Purchasing's.
- Old history rows that say `costs_complete` display as LC Odoo Done.

### The buyer track (part 7, seven ticks)
| Tick | Where it comes from |
|---|---|
| Purchase Order | Odoo (PO confirmed) |
| With P.O.P | Derived: a payment carries proof |
| Import Clearance | Typed date, Import only |
| Delivered | Typed date, or derived from Transmittals |
| Received in Odoo | Odoo receipts |
| Create Bill | Odoo bills (not cancelled) |
| Actual Checking | Stamped by Purchasing, **or** derived from a closed Transmittal check. **Once a submitted, uncancelled Transmittal carries one of this IPAS's PO lines, a hand stamp is refused** (clearing is still allowed). |

### Sign-offs
| Section | Prepared | Approved |
|---|---|---|
| 1 Purchasing | Purchasing access | Section 1 list |
| 3 Finance | Purchasing access | Section 3 list |
| 7 Filing | none | Received, then Noted and Checked (either order), then Approved |

Rules:
- **No self-approval.** A Super Admin signs only if they are on the list.
- **Section 7 opens only once sections 1 and 3 are approved.**
- **Approved in section 7** needs Received, Noted and Checked, and computation status at LC Odoo Done or Checked. It sets `state = filed` and `filed_at` in one act, and notifies the next list at each step.
- **Return (send back)** on section 1 or 3: a signer on that list sends it to the preparer with a reason. Prepared and Approved are cleared and kept as history. The data is untouched. It **also clears section 7's live Received, Noted and Checked**, and tells those signers.
- **Undo approval** (sections 1 and 3): takes back only Approved, leaves Prepared, needs a reason, and has the same section 7 consequence.
- **Section 7 send back:** anyone on a section 7 list, while open (1 and 3 approved) and not filed. It clears Received, Noted and Checked. If there is nothing live to clear, it is refused.
- The only things that clear approvals **by themselves** are a changed Odoo PO and a flagged Account #.
- Every sign-off stores the signer's signature image as it was, and a declined signature never prints.
- The signer lists are changed only through one atomic function (Super Admin), and each change is logged.

### Filing and what it freezes
- **Filed = frozen.** Triggers refuse every insert, update and delete on the IPAS row, its SORs, payments, charges, documents and bank details. This holds for the service role too. The two exceptions are `ipas_reopen` and the Odoo-changed flag.
- Option labels used by any filed IPAS **cannot be renamed** by anyone, Super Admins included. Deactivating, reordering and adding stay allowed.
- **Reopen:** Super Admin only, with a reason. It clears section 7's live sign-offs (kept as history) and leaves sections 1 and 3 approved. The Odoo flag is dropped.
- **Cancel:** Purchasing, with a reason. A **filed IPAS cannot be cancelled** until it is reopened. An already cancelled one is refused.

### Printing
The IPAS prints, with signature images readable to IPAS readers only for the files an IPAS sign-off actually carries.

---

## 10. Transmittals (TG03 slips)

A Transmittal follows the **goods**, not the deal. One delivery can split across slips, and one slip can carry several orders.

### Raising and submitting
- **Number:** `TG03-` plus the number, never handed back. The first number continues the paper series. A Super Admin sets it **once, before any Transmittal exists**. After that, it is refused.
- **Who prepares:** Purchasing access, or the Warehouse or Logistics list. Only the preparer or Purchasing can submit or cancel.
- A slip has an origin (Purchasing, Logistics, Warehouse, Others), a priority (High, Medium, Low), a Company, products and references (ticked from the two editable option lists) and **lines**. A line is a **PO line** (tied to an IPAS and an SOR) or **typed**.
- **Submit needs at least one line.** It creates the stage rows.
- **Cancel** needs a reason and is refused once any stage has been signed.
- Warehouse and Technical read the slip but not the IPAS, so a function hands them only the reference text a slip prints (IPAS number, PO number, SOR reference, project title). **No prices.**
- A draft is not a slip. Drafts are not listed on an SOR.
- The Company is picked from the company register. The "different company" warning compares names ignoring case and repeated spaces.

### Stages and states
`draft` → `warehouse_checking` → `warehouse_releasing` → `technical_inspection` → `awaiting_check` → `closed`, or `cancelled`. Which stages a slip passes through depends on the checks the slip asks for (Warehouse, Technical). Releasing is optional on a Warehouse-only slip.

| Stage | Who | What |
|---|---|---|
| Warehouse checking | Warehouse list | Rate every line **GC** (Good Condition) or **NA** (Need Attention). NA needs a remark. A quantity received is recorded only where it differs. Needs a picture or video, or a "no pictures" reason. |
| Warehouse releasing | Warehouse list | Optional. Never blocks Check by. |
| Technical inspection | Technical list | Rate the Technical lines. It also records quantity, so a Technical-only slip can record a short delivery. |
| Received in Odoo by | Warehouse list or Purchasing | Allowed from submission until closed. **A PO slip needs it before Check by.** |
| Check by | Check by list | Two signers. |

### Signing rules
- Each stage has **two signatories**. The caller can be either slot. The other signatory confirms or **declines** (a decline tells the completer). The two **may be the same person**, so a Warehouse list of one can still sign.
- A co-signer's slot waits for their confirmation. The stored signature prints only once given.
- **Check by:** the preparer cannot sign, the same person cannot hold both slots, and it only opens at `awaiting_check`. The second signature closes the slip and notifies the preparer. Each slot can decline its stored signature, also after closing.
- **NA lines** notify the preparer and the Check by list.
- **Evidence** (pictures and videos, private bucket, 50 MB a file) is added only while the stage is open, by that stage's list. Readers are exactly the Transmittal's readers.

### Freezes and undo
- A signed stage's remarks, signatures, pictures, reason and ratings never change. Only a co-signer's confirm or decline flag moves. A closed or cancelled slip refuses every change, for every role.
- **Undo a signature:** anyone allowed to sign it, with a reason. The old signature is kept as history. **Latest first only**: a stage can be undone only while no later stage and no Check by is signed. Received in Odoo only while no Check by is signed. A Check by can be undone any time, and undoing one on a closed slip reopens it to Awaiting Check by.
- Storage files cannot be frozen from SQL. Someone with the service key could still delete a signed stage's file from the Storage API. The row is refused, but the file is not. This is noted in the ticket.

### What a Transmittal feeds
- **IPAS part 5** lists the slips naming the IPAS. **Delivered** and **Actual Checking** are derived from slips, not typed.
- **Order Monitoring** reads slips to decide the next thing.
- **Purchasing Dashboard "To check"** counts submitted, unclosed slips.
- **NA clearing:** an NA line is "cleared" only when a **later slip** rates the same Odoo PO line GC at its checking stage.

---

## 11. Packing Lists

- **What it is:** a record of what is in each box the Warehouse packs for **one SOR**. It moves no stock and writes nothing to Odoo.
- **Number:** `PKL_` plus three digits, never handed back.
- **Who makes one:** Purchasing access or the Warehouse list. The creator or Purchasing edits boxes and contents while it is a draft.
- Box contents are picked from the SOR's Product List. A narrow reader gives Purchasing and the Warehouse each line's name, quantity and unit, **never prices**. The Warehouse's SOR picker returns reference, project title and stage only.
- **Pack** needs at least one box, and **every box must have contents**. Packing freezes the list, its boxes and contents against every change and delete, service role included.
- It carries an `odoo_delivery_ref`.
- Readers: IPAS readers, the Warehouse list, the creator or packer, and anyone who can read the SOR.

---

## 12. Order Monitoring

It reads **every open IPAS** and answers: what is the one next thing, who owes it, and how long has it waited? It is a view and stores nothing.

The decision order is fixed. The first match wins:
1. A line rated **NA** at its slip's checking stage, with no later slip clearing it with GC. Owner is Purchasing ("resolve with supplier"). Rule step `check_open`.
2. A slip whose checking stage is not complete. Owner is Warehouse, then Technical. Rule step `check_open`.
3. A slip awaiting Check by. Owner is Check by signers.
4. Computation status at LC Odoo Done or Checked, and not filed: "ready to file". Owner is the section 7 signers. Rule step `ready_to_file`.
5. Delivered, with no Transmittal naming the IPAS. Owner is Purchasing. Rule step `no_transmittal`. **A draft Transmittal counts as raised**, so Purchasing is not nagged while someone has started the hand-off.
6. The first unticked buyer-track step. Owners: Purchasing, Finance (With P.O.P, Create Bill), Warehouse (Received in Odoo), and **Others** (Import Clearance, Delivered). Others = supplier, forwarder or port.
7. Everything ticked but costs not complete: "Costs not complete". Owner is Purchasing.

**Groups:** Filed (no wait), else **Needs chasing** if late, else **Waiting on someone else** if the owner is Others, else **Waiting on us**.

**Late** means the days waited exceed that step's ageing rule. A step with no rule never goes late. **Every rule starts blank, so nothing is late until Purchasing sets one.** Days are counted in Asia/Manila calendar days. For an Import, the wait on later steps starts from the Arrived in PH date.

The hand-off column on the register shows one of: open, na, na_replaced, gc, or nothing.

---

## 13. Purchasing Dashboard

Five groups, **derived and never stored**. One SOR can sit in several. Only SORs that are not deleted and not scratch are counted.

| Group | What is in it |
|---|---|
| To source | Requested Items at Requested or To order (one row per request), and each Canvass with no winning Offer |
| To price | Components with no Acquire, plus the matrix itself when it has no live Bid Decision or the live one is Revise. A **No-go** matrix has nothing left to price or order. |
| To order | Components priced on a matrix with a live **Go**, with no PO yet (no PO/RFQ number and nothing Ordered or Received against them) |
| On order | Requested Items Ordered and not yet Received. One row per IPAS when the item's PO has one, else per request. |
| To check | Submitted, unclosed Transmittals naming the SOR, and **Received items on an IPAS that no uncancelled Transmittal names yet** |

- Direct requests (no SOR) are counted, with the project shown as "Direct request".
- Readers: Purchasing, Finance, Super Admin. Anyone else gets no rows. It returns counts and ids only, never money.
- "Since" means when the outstanding work began. Ageing rules are applied in the page, from Order Monitoring.
- **Received items with no IPAS stay out of To check**, because nothing links them to a Transmittal.

---

## 14. Settings (what the business edits)

| Setting | Edited by | Notes |
|---|---|---|
| IPAS option lists: payment methods, charge kinds, freight services, document kinds, item locations | Purchasing, Super Admin | Deactivated, never deleted. Unique by name (case-insensitive) per list. An option never moves lists. Document kinds also carry Import / Local / Both and Documentation / Filing / Both. |
| Transmittal lists: Product, Reference Checklist | Purchasing, Super Admin | Same rules |
| Ageing rules (10 steps) | Purchasing, Super Admin | Blank = no rule. A positive whole number only. Never deleted. Any employee reads them. |
| Reference rates (USD, EUR) | Fetched daily. Super Admin overrides. | See below |
| IPAS sign-off lists (1, 3, 7) and Transmittal staff lists | Super Admin | Logged. Seeded from the sheet by call sign (101, 1203). The two section 7 Noted and Checked lists are **not seeded**. |
| First Transmittal number | Super Admin | Once only |
| Costing rates | Finance, Super Admin | Single row |
| Markup presets | Final Acquire list, Super Admin | Deactivated, never deleted |
| Costing signer lists (Final Acquire, Evaluation) | Super Admin | Final Acquire is seeded with call sign 101, Evaluation with 1001 |
| Evaluation template | Super Admin | Which group task template makes a member Technical |

**Reference rates:** one source, fetched once a day by the `currency-rates-fetch` function on a schedule. A failed fetch writes nothing, so the last good row stays under its own date. It is always shown with its date and never presented as live. A Super Admin override is never overwritten by the next fetch. It pre-fills a foreign Offer's comparison rate, and on an IPAS payment it is shown beside the typed rate and flags a wide gap. It does nothing else, and never reaches Landed Cost.

---

## 15. Where Odoo is touched

| Function | Reads | Used for |
|---|---|---|
| `odoo-po-ipas` | One PO: header, lines (pre-tax price, taxes, analytic, Brand), receipts, non-cancelled bills. Exact name only. | Raising and refreshing an IPAS |
| `odoo-po-verify` | PO exists, fuzzy match allowed | Checking a typed PO number when an item is set to Ordered |
| `odoo-po-rollup` | POs whose Source Document names the SOR, plus ones given by number | One project's total spend |
| `odoo-supplier-search` | Suppliers by name (2+ characters, up to 10 results) | Canvass Offer supplier suggestions |
| `odoo-product-stock` | Free, on-hand and forecast stock | Stock refresh on the SOR |
| `odoo-sor-lookup` / `odoo-sor-sync` | The sales order and its lines | The SOR's Product List and retail sync |
| `currency-rates-fetch` | A rate feed (not Odoo) | Reference Rates |

All are read only. The browser never talks to Odoo, and credentials live in function secrets. For "could not check" (Odoo down), the answer is never "not found". A miss and an outage are told apart on purpose.

---

## 16. Edge-case cheat sheet

**Access and visibility**
- A non-member purchaser stops seeing a request the moment it gets a Buyer.
- A Deal Team member can see an IPAS **summary** but never its money.
- Warehouse and Technical can read a slip but not the IPAS or prices.
- Section 7's Noted and Checked signers read the IPAS but get no bank details.
- A Super Admin off a sign-off list cannot sign.

**Things that undo themselves**
- A changed Odoo PO (lines or total) clears IPAS sections 1 and 3.
- A flagged Account # clears sections 1 and 3.
- A Final Offer or Final Acquire change clears the Bid Decision.
- Spec or verdict changes clear the Evaluation approval.
- Editing a signed Canvass unsigns it.
- Returning IPAS section 1 or 3 also clears section 7's Received, Noted and Checked.

**Things that can never be undone or are blocked**
- A closed Requested Item goes nowhere.
- A filed IPAS cannot be cancelled until a Super Admin reopens it.
- A packed Packing List, a signed Transmittal stage and a closed slip are frozen.
- An IPAS's PO number, a Transmittal number and a cancelled IPAS number never change or return.
- A filed IPAS's option labels cannot be renamed.
- Currency, Supplier, item lines and Brand on an IPAS cannot be overridden.

**Things that warn but do not block**
- Fewer than three Offers on a Canvass.
- Required documents not ticked at Filing.
- An open Purchase Request at a stage gate (the old rule; the new gate is "Purchasing settled").
- No Canvass on an ordered item (it says so on the matrix row and the printed sheet).
- A payment rate far from the Reference Rate.
- A Transmittal Company that differs from the IPAS entity.

**Money rules**
- Blank is never zero.
- A foreign Offer with no rate has no PHP figure. A foreign PO with no payment has no Landed Cost.
- The comparison rate is not the rate paid.
- Landed Cost never feeds markup, Final Acquire, the summary or any sign-off.

---

## 17. Not built, uncertain, or worth checking

**Planned but not in the code**
- **Request Packing List** Stage Action. ADR 0033 lists it. Nothing implements it, so Packing Lists are made by hand.
- **Goods checked** and **Orders filed** Stage Conditions. Same situation. ADR 0033 also says Orders filed was deliberately not to be mounted yet.
- No Flow Canvas for Purchasing, by design (ADR 0023).

**Things I could not confirm**
- Whether a **lost or deleted SOR blocks writes** to its Purchase Request. I only found the label ("SOR lost", "SOR deleted"). The old design noted that a lost SOR never auto-closes purchasing work.
- The exact set of Transmittal stage paths for each combination of Warehouse and Technical checks. I read the states and rules but not every branch.
- How **Packing Lists are cancelled**, if at all. I found no cancel rule.
- Whether the live staging and production data match this. In particular, the **ledger on prod is known to drift**, so check the live schema before trusting a migration name. The Purchasing Dashboard database change was, per the last session note, not yet on staging or live.

**Known gaps still stated in the code**
- Dashboard: Received items with no IPAS stay out of To check.
- Dashboard "On order" opens the IPAS when one exists, otherwise the request.
- Sign-off lists for IPAS section 7 Noted and Checked start empty, so a Super Admin must fill them before anything can be filed.
- "Fog" left open on the original map: option lists, switch-over, estimate vs actual, and inquiries that buy nothing.

**Do not re-open (decided on purpose)**
- The Costing Matrix's tax and ITR maths copies the sheet.
- Purchasing has no flow of its own.
- Landed Cost is computed on read and not stored.
- v1 follows the sheets faithfully, and the business corrects in use.

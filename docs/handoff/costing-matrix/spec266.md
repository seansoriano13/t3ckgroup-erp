## Depends on

- #202: Stock Availability (the Odoo product id and stock on SOR lines a Tender Line is picked from)
- #203: Stage rules (the condition-kind registry and Stage Visits)
- #204: Stage automation (the Stage Action that creates the Evaluation of Specification group task)
- #207: SOR modal (the tab the PMS page lives in)
- #208: Stage-scoped visibility (Deal Team, Stage Participants and their windows, Always sees)
- #209: Purchase Requests (Requested Items gain the Component they buy for)
- #241: IPAS v1 (`has_finance_flow`, and the signer-list pattern this copies), with #249, #257 and #265 (the SOR-side sections the PMS page absorbs)

Build step 5a of [Build order for Transmittals, TSRs, the Canvass and order monitoring](https://github.com/seansoriano13/t3ckgroup-erp/issues/240), on the map [IPAS and PMS move into the ERP](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Step 5b, Canvass and Offers (#235, #236), and step 6, landed cost back into the matrix (#228), are separate specs.

## Problem Statement

Every bid is costed in a Google Sheet — the PMS sheet — outside the ERP, and the ERP can't tell whether a deal is ready to bid.

- **One grid, three departments, no rules.** Sales, Purchasing and Management each write their own columns (the sheet's owner band says SALES, PMS, MNGT), but nothing stops anyone typing in anyone else's column.
- **The maths hides gaps.** A blank Final Acquire counts as zero: the current sheet shows Revenue of ₱2,761,600 on a deal carrying ₱2,260,500 of cost. The vehicle's Acquire total reads ₱0.00 because its price sat on a description row with no quantity.
- **The structure is flat where the work isn't.** A tender line, the bundle that answers it, the bundle's unpriced accessories, and the parts bought separately all sit in one list, so a separately bought part can hide its cost as an "accessory".
- **Markup is worked out by eye.** Four sheets used four factors (×3.00, ×1.35, ×2.40, ×2.0644); nobody sees target against achieved.
- **The Evaluation of Specification is a group task whose checklists nobody ticks** (none ever ticked in staging), while the real comparison happens in the sheet's Offer Specification column.
- **Anyone called into an SOR either sees all the money or none of the matrix.** Technical needs the specifications, not the costs.
- **Nothing stops a bid going out unfinished** — without Final Offers, with blank costs, unevaluated, or above the ABC, which disqualifies a government bid.
- **The printed sheet** that Management signs is a screenshot of a spreadsheet.

## Solution

### The PMS page and its Costing Matrix

- **Every SOR has a PMS page from registration,** for every Sale Type, holding one Costing Matrix, empty until someone costs. No Stage Action opens it. A Sale Type that buys nothing simply leaves it empty.
- **The PMS page also gathers the SOR's purchasing file:** the Purchase Request card, the IPAS summaries (#249, #265), and the Transmittals and Packing Lists section (#257), which move here from where they were built.

### Rows

- **Tender Line** (1, 2, …): what the client asked for — Tender Specification, unit, quantity, ABC, Final Offer.
  - **Typed, or picked from an SOR line.** Picking copies the name, quantity and unit, which the Tender Line keeps. If the SOR line later differs, the Tender Line shows "SOR line now says …", and shows that product's stock (#202).
  - **The quotation's price shows beside Final Offer** when the two differ. Final Offer is never copied from it.
- **Component** (1.1, 1.2, …): what T3CK supplies toward a Tender Line — Offer Specification, brand, status (Source Out / Stockable), availability (Available / For Order), source (Local / Import), P.O./RFQ No., Acquire, Odoo and Final Acquire unit costs, markup. Its totals are unit × quantity.
  - **A bundle** is a Component priced as a whole, like the vehicle at 1 × ₱2,160,500.
  - **Anything bought or taken from stock on its own is a Component,** even where a sheet lists it among a bundle's accessories.
- **Inclusion:** an unpriced check row under a bundle Component, optionally grouped under a heading ("Accessories", "With"), carrying Completeness (Covered, Missing, Substituted, Not required).
- **Cost-only row:** below the Tender Lines — like the Delivery Charge — with a description, quantity, Acquire, Odoo and Final Acquire costs and a markup, but no specification, ABC or Final Offer. It counts in the totals and the summary, not in any Tender Line's margin.

### Markup

- **A factor on a Component's Acquire unit cost** (×1.35), also shown as +35%. Never a fixed amount.
- **One default factor per matrix,** typed or picked from a preset ("Government ×1.35"). Any Component or cost-only row can override it; cost-only rows start at ×1.00.
- **Markup Price is a suggestion:** each Tender Line shows its Components' Markup Prices summed beside Final Offer. Sales types Final Offer; nothing fills it.
- **Achieved markup:** each Tender Line shows Final Offer ÷ its Components' Acquire, beside the target factor; the matrix shows the same overall, counting cost-only rows.
- **A blank Acquire leaves Markup Price and achieved markup blank,** never zero.

### The summary — copied from the sheet

| Figure | Formula |
|---|---|
| Less VAT 12% | Final Offer ÷ 1.12 |
| Less Tax 6% | Final Offer × 6% (on the gross offer) |
| Retention 1% | Final Offer × 1% |
| Collected Amount | Final Offer − Tax − Retention |
| Operational Expenses | Final Acquire total |
| Marketing, OPEX | typed |
| ITR | (Final Offer − ₱250,000) × 8% |
| Revenue | (Final Offer − Final Acquire total) − ITR |

- **The rates and the ₱250,000 allowance are settings** Finance edits.
- **A blank cost never counts as zero.** While any Component or cost-only row has no Final Acquire, the summary reads "Incomplete — N rows have no cost" where Revenue would be. While any Tender Line has no Final Offer, every offer-based figure reads "Incomplete — N tender lines have no Final Offer".
- **The ABC ceiling:** a Tender Line whose Final Offer total exceeds its ABC total is flagged, and so is the matrix total above the ABC total. The matrix shows Final Offer as a percentage of ABC. Typing is never blocked.

### Who writes what

| Band | Who | Writes |
|---|---|---|
| Sales | the SOR's Deal Team | No., Tender Specification, unit, quantity, ABC, Brand, Status, Odoo unit cost, Final Offer; adds and removes Tender Lines |
| Purchasing | Purchasing access | P.O./RFQ No., availability, Source, Acquire, Offer Specification, the default factor and row overrides |
| Management | the **Final Acquire list** | Final Acquire |
| Technical | members of the SOR's Evaluation of Specification group task, and Purchasing access | Compliance, its note and recommended alternative; an Inclusion's Completeness |
| Finance | Finance access or the Final Acquire list | Marketing and OPEX |

- **Sales or Purchasing** add and remove Components, Inclusions and cost-only rows.
- **Super Admins** may write Sales, Purchasing and Technical columns to fix a record. Final Acquire still needs the list.
- **The database refuses a write outside a column's band.**
- **Incharge:** the matrix names one Sales incharge from the Deal Team and one Purchasing incharge with Purchasing access; any row can override either. It names who answers for the row, and grants nothing and notifies nobody.

### Who sees what — enforced by the database

- **Everything, money included** — costs, markups, Final Offer, achieved markup, the quotation price beside Final Offer, the summary: Super Admins, the Deal Team, the flow's Always sees, and — on **every** SOR — Purchasing access, Finance access and the Final Acquire list (ADR 0021's 2026-09-15 amendment). Commission stays hidden from those three.
- **The matrix without money** — Tender Lines, Components, brands, sourcing, specifications, Compliance, Inclusions: Stage Participants inside their window who aren't in the tier above, such as Technical.
- **Nothing:** everyone else. The locked view shows no PMS.

### Evaluation of Specification

- **The matrix row is the evaluation.** No separate record.
- **Each Component carries a Compliance verdict:** Complies, Deviates, or nothing yet. **Deviates needs a note** and may name the compliant alternative recommended instead.
- **Roll-ups:** a Tender Line shows "2 of 5 deviate · 1 not evaluated"; the matrix header shows the same for the whole offer.
- **Inclusions keep their Completeness** — the bid-time check of what sits inside a bundle.
- **A gap records and never blocks.** The matrix stays editable and the summary is unaffected.
- **One sign-off, "Evaluation approved",** for the whole matrix, by someone on the evaluation list Super Admins edit (seeded with the purchasing reviewer, 1001). It locks nothing: changing a Tender Specification, an Offer Specification or a verdict, or adding or removing a Tender Line or Component, clears it back to unapproved.
- **The "Evaluation of Specification" group task stays,** still created on "SO Evaluation" — it is what calls Technical in and grants their write.

### "Costing settled" — a new verifiable Stage Condition kind

- **Operations places it** in the Flow Canvas like any condition — For Bidding on Government, Proposal Submitted on Standard Pipeline and Outright.
- **Met when all hold:**
  - the matrix has at least one Tender Line, and every Tender Line has a Final Offer
  - the summary isn't incomplete
  - the evaluation is approved
  - the Final Offer total doesn't exceed the ABC total
- **It re-evaluates live,** so an edit that clears "Evaluation approved" closes the gate again while the SOR is still on the Stage.
- **The bid is submitted** when an SOR leaves a Stage through a met "Costing settled". From then, a changed Final Offer lands on the SOR's timeline.

### Nothing in PMS locks

The matrix stays editable for the life of the deal. Every change is kept as history.

### Purchase Requests

- **"Add from the Costing Matrix"** on a Purchase Request: Purchasing picks Components, defaulting to those marked For Order. It copies name, quantity and unit; the Requested Item keeps its copy and names the Component.
- **A Component shows its Requested Items** and their statuses.

### The printed Costing Matrix

Landscape A4, through the existing HTML print pipeline (ADR 0014). A print shows only what the person printing may see.

- **Sheet 1 — money.** One row per Tender Line (ABC, Acquire, Final Acquire, Final Offer, achieved markup), cost-only rows beneath, the summary, and a margin strip: final offer, cost, achieved against target, and an ABC bar. Deviations read as a line of prose above the signatures, with what the compliant option would cost where known. A Landed Cost column reads "awaiting purchase" until step 6 fills it.
- **Sheet 2 — specification appendix.** The full Tender Specification against each Component's Offer Specification, its Compliance and note, then the Inclusions checklist with its covered count, under the owner-band header.
- **Four signature blocks:** Prepared by (the Sales incharge), Costed by (the Purchasing incharge), Evaluation approved (the evaluation list), Final Acquire and offer approved (the Final Acquire list). Unsigned prints "Signature required"; a signer with no stored signature prints their name.
- **An incomplete summary still prints,** with its "Incomplete — N rows have no cost".

### What it replaces

- **`sor_inclusions` rows move under a bundle.** Staging holds none. Any that exist are placed under one "Unplaced inclusions" bundle Component on an "Unplaced inclusions" Tender Line, for Sales to move.
- **The Inclusions panel** (hidden by #209) is replaced by Inclusions on the matrix. The Canvass panels stay hidden until step 5b.

## User Stories

### The PMS page

1. As a salesperson, I want every SOR to have a PMS page from the day it's registered, so that costing can start whichever Stage my flow costs at.
2. As a Deal Owner, I want the PMS page to hold the Costing Matrix, the Purchase Request, the IPAS summaries and the Transmittals, so that the SOR's whole purchasing file is in one place.
3. As a salesperson on a Recruitment SOR, I want an empty PMS page to cost nothing and block nothing, so that deals that buy nothing aren't slowed.
4. As a purchaser, I want to open any SOR's Costing Matrix without being called in, so that I can cost ahead of the Stage that needs it.

### Tender Lines

5. As a salesperson, I want to add a Tender Line by typing its specification, unit, quantity and ABC, so that I can cost before a quotation exists.
6. As a salesperson, I want to pick a Tender Line from an SOR line, so that I don't retype the quotation.
7. As a salesperson, I want a picked Tender Line to keep its own copy, so that re-saving the SOR doesn't rewrite what I'm costing.
8. As a salesperson, I want a Tender Line to say "SOR line now says …" when the SOR line changes, so that I notice the ask moved.
9. As a salesperson, I want a picked Tender Line to show its product's stock, so that I know straight away whether it has to be bought.
10. As a salesperson, I want a Tender Line's specification to hold many lines, so that a 13-line vehicle specification fits.
11. As a salesperson, I want to type each Tender Line's Final Offer, so that the bid is what I decide, not what the markup suggests.
12. As a salesperson, I want the quotation's price beside Final Offer when they differ, so that I see when the quotation is out of step.
13. As a salesperson, I want Tender Lines numbered 1, 2, … and their Components 1.1, 1.2, …, so that the matrix reads like the sheet.
14. As a salesperson, I want to reorder and remove Tender Lines, so that the matrix follows the tender document.

### Components, bundles, Inclusions and cost-only rows

15. As a purchaser, I want to add Components under a Tender Line, so that each thing we supply has its own cost.
16. As a purchaser, I want a bundle Component priced as a whole with its quantity on the same row, so that the vehicle's total is 1 × ₱2,160,500, never ₱0.00.
17. As a purchaser, I want to list a bundle's Inclusions without prices, under headings like "Accessories" and "With", so that someone can check each is included.
18. As a purchaser, I want a part bought on its own to be its own Component, so that its cost can't hide as an Inclusion.
19. As a purchaser, I want to record a Component's P.O./RFQ No., availability and source, so that the matrix shows how each thing is being bought.
20. As a salesperson, I want to record a Component's Brand, Status and Odoo unit cost, so that my columns sit beside Purchasing's.
21. As a purchaser, I want to add cost-only rows like the Delivery Charge, so that costs with no specification still count.
22. As a purchaser, I want cost-only rows kept out of each Tender Line's margin, so that one line's markup isn't distorted by delivery.
23. As a salesperson, I want to move an Inclusion from "Unplaced inclusions" to the bundle it belongs to, so that old inclusion lists find their home.

### Markup

24. As a purchaser, I want to set a matrix default markup factor, typed or from a preset, so that routine deals price consistently.
25. As a purchaser, I want to override the factor on any Component or cost-only row, so that the vehicle can sit at ×1.47 and delivery at ×1.00.
26. As a purchaser, I want cost-only rows to start at ×1.00, so that pass-through costs aren't marked up by accident.
27. As a purchaser, I want each factor shown also as a percentage, so that ×1.35 and +35% read the same.
28. As a salesperson, I want each Tender Line's Markup Price shown beside its Final Offer, so that I see the suggestion while I price.
29. As a salesperson, I want each Tender Line's achieved markup beside the target, so that I know how far under the target I'm bidding.
30. As a Sales Director, I want the matrix's overall achieved markup against its target, so that I can judge the whole bid at a glance.
31. As a purchaser, I want a blank Acquire to leave Markup Price blank, so that an unknown cost never looks like a free item.
32. As a purchaser or Super Admin, I want to edit the named markup presets, so that the business changes them without a developer.

### The summary and ABC

33. As Management, I want the summary to compute VAT, Tax, Retention, Collected, ITR and Revenue exactly as the sheet does, so that ERP figures match what the business already uses.
34. As Management, I want Operational Expenses to be the Final Acquire total, so that nobody retypes it.
35. As Finance, I want to type Marketing and OPEX, so that the summary carries the figures my OPEX sheet uses.
36. As Management, I want Revenue replaced by "Incomplete — N rows have no cost" while any cost is blank, so that a missing cost never inflates Revenue.
37. As Finance, I want the VAT, Tax, Retention and ITR rates and the ITR allowance to be settings I edit, so that a rate change needs no rebuild.
38. As a salesperson, I want a Tender Line above its ABC flagged, so that I see which line would disqualify the bid.
39. As a salesperson, I want the matrix total compared with the ABC total as a percentage, so that I know how close to the ceiling we are.
40. As a salesperson on a non-government deal, I want no ABC to mean no ceiling, so that the flag stays quiet where it doesn't apply.

### Bands and access

41. As Management, I want only people on the Final Acquire list to write Final Acquire, so that the figure that decides Revenue is set by named people.
42. As a Super Admin, I want to edit the Final Acquire list, so that the company decides who sits on it.
43. As a Super Admin not on the Final Acquire list, I want Final Acquire refused to me, so that my fix-it rights don't bypass Management.
44. As a purchaser, I want my Acquire column refused to Sales, so that the cost I propose is the cost that shows.
45. As a salesperson, I want Final Offer refused to Purchasing, so that the bid stays mine.
46. As a Super Admin, I want to correct Sales, Purchasing and Technical columns, so that a wrong record can be fixed.
47. As a developer, I want band rules held by the database, so that no API call can write outside a band.
48. As Finance, I want to read every SOR's Costing Matrix with its money, so that I can take Revenue without being called in.
49. As a Technical evaluator called into an SOR, I want to see the matrix without any money, so that I evaluate specifications without seeing the bid.
50. As a Deal Owner, I want commission never shown to Purchasing, Finance or the Final Acquire list, so that the ADR 0021 exception stays narrow.
51. As an employee with no part in an SOR, I want no PMS on the locked view, so that the matrix stays private.
52. As a developer, I want a participant's read of costs refused by the database, so that hiding money isn't a screen trick.
53. As a salesperson, I want to name the matrix's Sales and Purchasing incharge and override them per row, so that everyone knows who answers for each row.
54. As an incharge, I want being named to grant me nothing and notify me of nothing, so that Incharge stays a label.

### Evaluation of Specification

55. As a purchaser, I want to write each Component's Offer Specification from the supplier's quotation, so that the offer sits beside the ask.
56. As a Technical evaluator, I want to mark each Component Complies or Deviates, so that the comparison is recorded on the row people price against.
57. As a Technical evaluator, I want a deviation to require a note and optionally name the compliant alternative, so that the gap is explained.
58. As a salesperson, I want each Tender Line to roll up how many Components deviate or aren't evaluated, so that I see the gaps per line.
59. As a Sales Director, I want the matrix header to show the same counts for the whole offer, so that I know how compliant the bid is.
60. As a Technical evaluator, I want to set each Inclusion's Completeness, so that a bundle's contents are checked against the ask.
61. As a member of the SOR's Evaluation of Specification group task, I want that membership to let me write Compliance, so that nobody needs a new access flag.
62. As a Technical evaluator whose group task membership ended, I want my write to end with it, so that access follows the task.
63. As the purchasing reviewer, I want one "Evaluation approved" sign-off for the whole matrix, so that I approve the recommendation once.
64. As the purchasing reviewer, I want approval refused while any Component has no verdict, so that nothing is approved unevaluated.
65. As a Sales Director, I want a later change to a specification or verdict to clear the approval, so that the approval always matches what's on the matrix.
66. As a Super Admin, I want to edit the evaluation list, so that the company decides who approves.
67. As a salesperson, I want a deviation never to block editing or the summary, so that gaps are recorded, not punished.

### Costing settled

68. As an Operations Manager, I want a "Costing settled" condition kind in the Flow Canvas, so that I can gate the bid at whichever Stage my flow bids from.
69. As a Deal Owner, I want "Costing settled" to check Final Offers, a complete summary, an approved evaluation and the ABC ceiling, so that the system verifies what I'd otherwise certify by hand.
70. As a Deal Owner, I want the condition to tell me which of its checks fail, so that I know what to chase.
71. As a Deal Owner, I want an over-ABC total to keep the SOR on the Stage, so that a disqualified bid never goes out.
72. As a Deal Owner, I want an edit that clears the approval to close the gate again, so that a stale approval can't let the SOR through.
73. As a Sales Director, I want a Final Offer changed after the bid is submitted to land on the SOR's timeline, so that post-bid price changes are visible.
74. As an Operations Manager, I want the condition shown on published flow versions like other kinds, so that the rule is readable.

### History

75. As Management, I want every change to the matrix kept as history with who and when, so that a figure can be traced.
76. As a Deal Owner, I want the matrix to stay editable after award, so that Final Acquire and costs can be set when they're known.

### Purchase Requests

77. As a purchaser, I want to add Requested Items from the Costing Matrix, defaulting to Components marked For Order, so that I don't retype what's been costed.
78. As a purchaser, I want a Component to show its Requested Items and their statuses, so that costing and buying read together.
79. As a purchaser, I want one Component to have several Requested Items, so that split orders stay linked.

### Printing

80. As Management, I want a landscape money sheet with every Tender Line, the summary, the ABC bar and signatures on one page, so that I sign the whole offer at once.
81. As Management, I want deviations stated in a sentence with what the compliant option would cost, so that I decide on them on paper.
82. As a Technical evaluator, I want a specification appendix with the full ask against each offer, its verdict and the Inclusions checklist, so that the evidence is attached.
83. As a Sales incharge, I want to sign "Prepared by", so that the print shows who prepared it.
84. As a Purchasing incharge, I want to sign "Costed by", so that the print shows who costed it.
85. As someone on the Final Acquire list, I want to sign "Final Acquire and offer approved", so that the approval prints.
86. As an approver with no stored signature, I want my name printed, so that the form still records me.
87. As a salesperson, I want an incomplete matrix to still print, marked incomplete, so that working copies can be shared.
88. As a Technical evaluator, I want my print to carry no money, so that printing doesn't leak what the screen hides.
89. As Finance after award, I want the Landed Cost column on the print, so that one layout serves bid time and after.

### Replacement

90. As a salesperson, I want old SOR inclusion lists carried into the matrix under "Unplaced inclusions", so that nothing recorded is lost.

## Implementation Decisions

### Schema

Money and non-money columns sit in separate tables, so the money tier is a row policy, not a screen rule — the pattern `ipas_bank_details` set.

- **`costing_matrices`:** id, opportunity_id (unique), sales_incharge_id, purchasing_incharge_id, bid_submitted_at, created_at, updated_at. A trigger creates one per SOR at registration; the migration backfills every existing SOR.
- **`costing_matrix_money`:** matrix_id (primary key), default_factor (numeric, > 0), default_preset_id, marketing, opex.
- **`costing_tender_lines`:** id, matrix_id, position, tender_specification (text, multi-line), unit, quantity, source (`typed` or `sor_line`), sor_item_id (nullable), sor_line_snapshot (`{ name, quantity, unit }`), created_by, created_at.
- **`costing_tender_line_prices`:** tender_line_id (primary key), abc_unit, final_offer_unit.
- **`costing_components`:** id, tender_line_id, position, name, offer_specification, brand, status (`source_out` / `stockable`), availability (`available` / `for_order`), source (`local` / `import`), po_rfq_no, is_bundle, compliance (`complies` / `deviates` / null), compliance_note, recommended_alternative, sales_incharge_id, purchasing_incharge_id (both nullable = the matrix default), quantity, unit. A CHECK requires a note when compliance is `deviates`.
- **`costing_component_costs`:** component_id (primary key), acquire_unit, odoo_unit, final_acquire_unit, markup_factor (nullable = matrix default).
- **`costing_inclusions`:** id, component_id (must be a bundle), heading, position, description, quantity, unit, completeness (the four existing values).
- **`costing_cost_rows`:** id, matrix_id, position, description, quantity, acquire_unit, odoo_unit, final_acquire_unit, markup_factor (default 1.00). Money-tier table in full.
- **`costing_signoffs`:** matrix_id, role (`prepared`, `costed`, `evaluation_approved`, `final_approved`), signed_by, signed_at, signature_declined, cleared_at, cleared_reason. The live sign-off is the uncleared row.
- **`costing_signer_lists`:** list_key (`final_acquire` or `evaluation`) and employee_id, unique together. Seeded by employee code: 101 on `final_acquire`, 1001 on `evaluation`.
- **`costing_settings`:** a single row — vat_divisor (1.12), tax_rate (0.06), retention_rate (0.01), itr_rate (0.08), itr_allowance (250000), evaluation_template_id (the "Evaluation of Specification" group task template, seeded by name).
- **`costing_markup_presets`:** label, factor, sort, active. Deactivated, never deleted.
- **`costing_events`:** matrix_id, actor_id, kind, detail (jsonb: table, row, column, old, new), created_at. Written by triggers; append-only, no update or delete policy. Events on money tables are readable only at the money tier.
- **`purchase_request_items.component_id`:** nullable, references `costing_components`, added here (#209 left it out on purpose).
- **`sor_inclusions`:** rows are moved into `costing_inclusions` under an "Unplaced inclusions" Tender Line and bundle Component per SOR; `cost_amount` is recorded in the event detail. The old table is kept read-only.

### Access

**Helpers**, each security definer and each taking the SOR:
- **`costing_can_read_money(opp)`:** Super Admin, the Deal Team (under ADR 0021's rule, Restricted Stages included), the flow's Always sees, `has_purchasing_flow`, `has_finance_flow`, or the `final_acquire` list.
- **`costing_can_read(opp)`:** `costing_can_read_money`, or a Stage Participant with an open window on that SOR (#208).
- **`costing_is_technical(opp)`:** `has_purchasing_flow`, or a current member of a group task on that SOR created from `evaluation_template_id`.

**Reads:** the non-money tables need `costing_can_read`; `costing_matrix_money`, `costing_tender_line_prices`, `costing_component_costs`, `costing_cost_rows` and money events need `costing_can_read_money`. Commission tables are untouched.

**Band enforcement:** a BEFORE INSERT/UPDATE/DELETE trigger per table compares OLD and NEW column by column against the actor's bands, and raises naming the column and the band. It holds for every client path; the service role bypasses it for migrations only.
- Sales band: Deal Team. Purchasing band: `has_purchasing_flow`. Management: `final_acquire` list. Technical: `costing_is_technical`. Finance columns: `has_finance_flow` or `final_acquire` list.
- Super Admins pass Sales, Purchasing and Technical checks, never Management's.
- Adding and removing Tender Lines: Sales. Components, Inclusions, cost-only rows: Sales or Purchasing.
- Incharge columns: the Sales incharge by Sales, the Purchasing incharge by Purchasing. A trigger checks a Sales incharge is on the Deal Team and a Purchasing incharge has Purchasing access.
- `costing_settings`: rates by Finance access or Super Admin; `evaluation_template_id` by Super Admin. Presets: Purchasing access or Super Admin. Signer lists: Super Admin.

**Default decision:** who edits markup presets was left to the map's "Option lists" fog; this spec follows the IPAS option lists (Purchasing access or Super Admin).

### RPCs (ADR 0013)

- **`costing_sign(matrix_id, role)`:** `prepared` needs the effective Sales incharge; `costed` the Purchasing incharge; `evaluation_approved` the `evaluation` list and every Component carrying a verdict; `final_approved` the `final_acquire` list.
- **`costing_clear_signoffs`**, called from triggers:
  - `evaluation_approved` clears on a change to a Tender Specification, Offer Specification, compliance, compliance note, or on adding or removing a Tender Line or Component.
  - `prepared` clears on a change to Final Offer; `costed` on Acquire or a markup factor; `final_approved` on Final Acquire or Final Offer.
  - **Default decision:** the three print sign-offs clear the same way the evaluation does, which #229 implied but didn't state.
- **`costing_move_inclusion(inclusion_id, component_id)`:** refuses a non-bundle target.

### Maths: `costingMath` (pure)

One module, shared by the service, the screen and the print. Every figure is computed in exact decimals and rounded half-up to the centavo only when returned.

- `lineTotals(tenderLine, components)`: ABC total, Final Offer total, Acquire / Odoo / Final Acquire totals (null if any is blank), Markup Price sum, achieved markup, over-ABC flag.
- `markupPrice(acquireUnit, quantity, factor)`: null on a blank Acquire.
- `summary(matrix, settings)`: the table above; `{ incomplete: { missingCost: n, missingOffer: n } }` in place of each figure it can't compute.
- `complianceRollup(components)`: `{ deviates, notEvaluated, total }`.
- `costingSettled(matrix, settings)`: `{ met, failing: ['no_tender_lines' | 'missing_final_offer' | 'incomplete_summary' | 'evaluation_not_approved' | 'over_abc'] }`.
- **Default decision:** ITR follows the sheet's formula literally, so a Final Offer under the allowance gives a negative ITR. Correcting the sheet's tax maths is out of the map's scope.
- **Default decision:** the ABC ceiling checks the matrix total only when every Tender Line has an ABC; lines with an ABC are flagged individually either way.

### Service: `costingMatrixService`

- `get(opportunityId)`: the matrix shaped for the caller's tier — money keys absent, not null, for a participant — with `costingMath` results attached.
- `addTenderLine`, `addTenderLineFromSorLine`, `updateTenderLine`, `removeTenderLine`, `reorder`
- `addComponent`, `updateComponent`, `removeComponent`, `addInclusion`, `updateInclusion`, `moveInclusion`, `addCostRow`, `updateCostRow`, `removeCostRow`
- `setDefaultMarkup({ factor | presetId })`, `setIncharge`
- `setCompliance(componentId, { verdict, note, alternative })`
- `sign(role)`, `history(filters)`
- `getSettings`, `setSettings`, `listPresets`, `savePreset`, `getSignerLists`, `setSignerList`

A band refusal surfaces as a typed error naming the column, which the screen shows inline.

### Stage Condition

- The `stage_conditions` kind check gains `costing_settled`; it carries no config.
- The evaluator reads the matrix through a security definer path and calls `costingSettled`, reporting the failing checks as the condition's detail.
- `flowStageKinds` gains its label, icon and description, so the Flow Canvas picker (#203) and published versions show it.
- When a move leaves a Stage through a met `costing_settled`, `bid_submitted_at` is set if empty. After that, a Final Offer change writes a `sales_opportunity_logs` entry on the SOR's open visit.

### UI

- **The PMS tab** in the SOR modal (#207), visible when `costing_can_read`. It holds the Costing Matrix, the Purchase Request card, and the sections from #249, #257 and #265, moved without changing their content.
- **The Costing Matrix grid:** the owner-band header, Tender Lines with their Components nested and Inclusions collapsible under bundles, cost-only rows beneath, the summary and ABC gauge at the foot, the compliance counts in the header. A cell outside the viewer's band is read-only.
- **Costing Matrix settings** in the Purchasing Module: rates, presets, signer lists, the evaluation template.
- **Purchase Request:** "Add from the Costing Matrix" and the component name on each Requested Item.
- **Print:** a `costing_matrix` form type in the form registry and view model, following ADR 0014. The prototype on `prototype/printed-costing-matrix` (#229, variant C, with B's margin strip and A's band header) is the layout reference.

## Testing Decisions

A good test drives the public seam and checks what a user or another module can observe — figures, refusals, what's returned — never internal helpers or query shapes.

1. **Unit — `costingMath`.** The #213 worked examples are the tests, to the centavo:
   - **Current sheet:** Final Offer ₱2,980,000, Final Acquire blank → VAT-exclusive ₱2,660,714.29, Tax ₱178,800.00, Retention ₱29,800.00, Collected ₱2,771,400.00, ITR ₱218,400.00, Revenue incomplete.
   - **Earlier sheet:** Final Offer ₱3,930,715, Final Acquire ₱1,156,780 → Tax ₱235,842.90, Retention ₱39,307.15, Collected ₱3,655,564.95, ITR ₱294,457.20, Revenue ₱2,479,477.80.
   - **Prototype sample (#229):** Final Offer ₱2,980,000, Final Acquire ₱2,338,500 → ITR ₱218,400.00, Revenue ₱423,100.00, 93.1% of ABC ₱3,200,000.
   - Also: a bundle 1 × ₱2,160,500 totals ₱2,160,500; a blank Acquire leaves Markup Price and achieved markup null; cost-only rows count in the overall achieved markup but not a line's; changed settings change the figures; `costingSettled` reports each failing check alone and together; over-ABC by one centavo fails.
2. **Integration — `costingMatrixService`** on the fake PostgREST:
   - an SOR gets a matrix at registration
   - a Tender Line picked from an SOR line keeps its snapshot after `updateOpportunity` replaces the lines, and reports "SOR line now says"
   - `get` for a participant has no money keys
   - changing an Offer Specification clears "Evaluation approved"; approval with an unevaluated Component is refused
   - `costing_settled` blocks a move until the last check passes, re-closes after an edit clears approval, and a Final Offer change after `bid_submitted_at` writes a timeline entry
   - "Add from the Costing Matrix" defaults to For Order Components and links them
   - prior art: `purchasingService.test.js`, the IPAS service tests
3. **Policy tier** (local Postgres):
   - each band's columns refused to each other band, both directions, including Super Admin on Final Acquire
   - a participant reads Tender Lines and Components but is refused every money table and money event
   - Purchasing, Finance and the Final Acquire list read money on an SOR they have no part in; a plain employee reads nothing
   - Compliance write granted by current evaluation-task membership and refused once removed
   - a deviation without a note refused; an Inclusion under a non-bundle refused
   - events can't be updated or deleted
   - the `sor_inclusions` move matches literal fixtures
4. **Print:** the view model for a money reader and for a participant (no money keys, no Sheet 1 figures), the incomplete summary text, "Signature required", and name-only fallback — prior art: `formViewModel.test.js`.
5. **Page:** the PMS tab renders the matrix, a read-only cell outside the band, the summary's incomplete state, and the condition's failing checks in the Stage checklist.

## Out of Scope

- **Canvass and Offers** (#235, #236), including a winning Offer filling Acquire and Offer Specification: step 5b. Their panels stay hidden.
- **Landed Cost back into the matrix** (#228): step 6. The print's column reads "awaiting purchase" until then; no screen column is built here.
- **Correcting the sheet's tax and ITR maths** against BIR rules (#213).
- **Estimate vs actual** reporting, and **inquiries that buy nothing** — map fog.
- **The delivery-time Inclusion check** — #234 and #239.
- **Switch-over:** granting Purchasing and Finance access, filling the lists, trimming the group task templates' checklists, and what becomes of "PMS - Evaluation".
- Finance's per-project expense ledger.

## Further Notes

- **Decisions come from** the resolution comments on #213, #214, #223, #224, #225, #226, #227, #229 and #230. ADR 0021's 2026-09-15 amendment already records the money-read exception.
- **Default decisions made while writing,** each flagged above: preset editors; the print sign-offs' clearing rules; approval needs every Component evaluated; negative ITR below the allowance follows the sheet; the ABC total check needs every line to have an ABC; unplaced `sor_inclusions`; "Costing settled" is unmet with no Tender Lines; Finance-access writes to Marketing and OPEX sit beside the Final Acquire list.
- **Glossary:** `CONTEXT.md` already defines PMS, Costing Matrix, Tender Line, Component, Inclusion, Markup, Final Acquire, Incharge, Evaluation of Specification, Compliance and "costing settled".
- **The retired `project_evaluation` and `inclusions` condition kinds** stay evaluable for old versions and hidden from the picker (#203, #209).


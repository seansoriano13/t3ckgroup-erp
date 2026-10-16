# #461 [OPEN] Purchasing after the prod flow scan: mount the tools on the Sales Flow

## Destination

The purchasing specs match how Operations already runs purchasing on the Government Sales Flow in production, and purchasing's tools can be mounted on Sales Flow stages the way group and individual tasks are.

A side-by-side of the specs against prod's Government flow (published v5.2, read 2026-10-05) found three conflicts and seven gaps. One grilling session settled 23 decisions.

Done looks like:
- amendments landed on the open tickets listed below
- the new tickets below written and sliced
- ADR 0033 and the glossary changes committed

## What prod showed

Read-only queries against production on 2026-10-05; nothing was written.

- **Path:** Lead → SO Evaluation → **PMS Sourcing GS** → Proposal Submitted → Qualified → For Bidding → Bid Submitted → PQ → Negotiation → NOA → PB → NTP → CA / PO → Project Delivery → Collection → Retention → Closed Won / Closed Lost.
- **Where SORs are:** 31 live Government SORs, 27 at Lead and 4 at SO Evaluation. None further.
- **Purchasing is already on the Sales Flow, through group tasks and Drive links:**
  - **SO Evaluation:** an "Evaluation of Specification" group task (7 members, 46 checklist items, window until the stage is left) and a required "Brochure GDRIVE" field. Five were created on 1 Oct; **none has a single item ticked**.
  - **PMS Sourcing GS:** a purchasing stage Operations added. It has a group task (Sales plus three purchasing reps) and a required "GS 1 CRM GDrive" link to the costing sheet, and **no exit condition**.
  - **Qualified:** the TOR task carries Raquel's "Assigning purchasing assistant".
  - **For Bidding:** a required free-text field, "Purchasing Involved".
  - **NTP:** the "PMS" group task (54 checklist items) and a 15-day Delivery Deadline.
  - **CA / PO:** the "PO" attachment here is the client's purchase order.
- **Inquiries happen off the flow.** 18 hand-made "PMS" group tasks (7 Jul to 18 Aug), 17 still active, none linked to its SOR.
- **Legacy data:** 49 `sor_procurement_requests` on 35 SORs, none of them Government. The canvass, offer, inclusion and PO-link tables are all empty.
- **Access:** one employee holds Purchasing access (Ayla's re-created row). The Purchasing Manager doesn't. No Finance flag, Final Acquire list, evaluation list or TG03 staff lists exist yet.
- **Always sees on Government:** 101 plus the whole SALES department.

## Decisions

| # | Decision |
|---|---|
| Q1 | PMS Sourcing GS stays as a Sales Flow stage (one deal waiting on pricing). Its "GS 1 CRM GDrive" field retires when the Costing Matrix ships. |
| Q2 | The Evaluation of Specification task's window runs **until For Bidding is left**, so Technical keeps the SOR while Components exist. This is a Flow Canvas setting, no code. |
| Q3 | The Purchase Request opens **by award at the latest**. On Government it is an Optional Action at Lead (Deal Owner decides) for inquiries, and automatic at NTP. Amends #227. |
| Q4 | Raquel's "assign a purchasing assistant" is the matrix's **Purchasing Incharge**. A Canvass defaults its Canvasser to that row's Incharge, then to the Buyer. "Purchasing Involved" retires. |
| Q5 | Order Monitoring and the Dashboard show the client's delivery deadline next to the SOR's orders and mark orders not yet received as it nears. Blocks nothing. |
| Q6 | **Purchase Order** means T3CK's Odoo order to a supplier; the client's is a **Client PO**. Purchasing screens say "Odoo PO". |
| Q7 | "Purchasing settled" sits on leaving Project Delivery. |
| Q8 | Access is granted on the day the #209 block reaches prod, not before. Purchasing: Raquel, Cjay, Ayla. Final Acquire list: 101. Evaluation list: Raquel. Finance: Jelai. Check by: 1001 and 102. |
| Q9 | Always sees reads the Closed Book's **price side**, the same as the Deal Team. |
| Q10 | The 18 hand-made "PMS" tasks are not migrated. At switch-over Raquel closes each with a note and re-raises any live inquiry as a Requested Item. |
| Q11 | A new condition kind, **Costing priced**, on leaving PMS Sourcing GS. Purchasing tools become mountable like group and individual tasks. |
| Q12 | The Purchasing Incharge is named when the bid enters sourcing, before any Canvass opens. |
| Q13 | An Open Purchase Request run that finds a request already open tops it up: it sets the Buyer only if there is none and adds missing members, and never replaces or removes anyone. Its Buyer setting gains "the matrix's Purchasing Incharge". |
| Q14 | The Bid Decision has **no** no-self-approval rule. It is the boss's own judgement. |
| Q15 | "Deadline near" is one Purchasing-edited setting beside the ageing rules, 5 days by default. |
| Q16 | The tools that exist once per SOR mount on stages: Purchase Request (already), **Costing Matrix**, and a **Packing List request**. Canvass, IPAS and Transmittal do not. |
| Q17 | Two new condition kinds: **Goods checked** and **Orders filed**. No Canvass gate. |
| Q18 | The PMS page exists from registration, but its Costing Matrix appears only once "Open Costing Matrix" runs. Costing conditions read unmet with no matrix, and the Flow Canvas warns at publish. Amends #227 and #266. |
| Q19 | "Open Costing Matrix" mirrors Open Purchase Request. It sets the Incharges (or names who assigns the Purchasing one), a markup preset, and extra members with a window, and tops up on a later run. Costing priced needs a Purchasing Incharge. |
| Q20 | "Request Packing List" creates a draft for the SOR only if none is open, and notifies the Warehouse. |
| Q21 | On Government: Open Costing Matrix at **SO Evaluation**; Costing priced leaving PMS Sourcing GS; Request Packing List at Project Delivery; Goods checked and Purchasing settled leaving Project Delivery. Orders filed is not mounted yet. |
| Q22 | Recorded as ADR 0033, which amends ADR 0023. |
| Q23 | A one-off release backfill opens the Costing Matrix on live SORs already at or past its stage. |

## Recorded in

- `docs/adr/0033-purchasing-tools-mount-on-sales-flow-stages.md`, which amends ADR 0023's "purchasing gets no Stage Actions".
- `CONTEXT.md`:
  - **new terms:** Purchase Order and Client PO
  - **amended terms:** Purchase Request, Canvasser, Incharge, Closed Book and Bid Decision

## The work

### Amendments landed

#227 · #209 · #304 · #266 · #267 · #272 · #275 · #276 · #319 · #320 · #261 · #262 · #241 · #251 · #255 · #313

### New tickets

Ready for an agent:

| # | Ticket | Lands with |
|---|---|---|
| #462 | Open Costing Matrix: a Stage Action that mounts the matrix on a stage | the #266 block |
| #463 | Costing priced: a condition that Purchasing has costed every row | the #266 block, beside #272 |
| #464 | Request Packing List: a Stage Action that asks the Warehouse to pack | its own block under #461 (moved out of #251 on 2026-10-16), after #255 |
| #465 | Goods checked: a condition that every Transmittal naming the SOR is closed | its own block under #461 (moved out of #251 on 2026-10-16) |
| #466 | Orders filed: a condition that every IPAS naming the SOR is filed | the #241 block |
| #467 | Order Monitoring shows the client's delivery deadline | the #261 block |
| #468 | Release backfill: open the Costing Matrix on SORs already past its stage | the #266 release |

For a human:

- #469 Government flow: re-configure for the purchasing tools
- #470 Purchasing switch-over: access grants and the hand-made PMS tasks

## Parked bugs

Found while reading prod. Neither is a decision.

1. **Stage Actions assign a deleted employee.**
   - SO Evaluation's and PMS Sourcing GS's group-task actions name Ayla Cervantes's old employee row (`46970b3a…`), which is deleted.
   - Her live row (`a94cbed8…`) gets no tasks.
   - All five Evaluation tasks, and 13 of the hand-made PMS tasks, carry the deleted member.
   - **Fix:** re-pick her in both actions on the Flow Canvas and publish. This is folded into the Government re-config ticket.
2. **Prod group task templates still say "(staging)",** e.g. "PMS (staging)" and "Evaluation of Specification (staging)". They came across in the template transfer (#419). Cosmetic.

## Notes

- **Follows #316.** That map settled what purchasing *said*; this one settles what Operations already *built*.
- **ADR 0023 still holds.** Purchasing has no flow of its own, and nothing stores a "current purchasing stage". Only the one-per-SOR tools mount; per-PO and per-slip records reach the flow through conditions.
- **Draft vs published.** The Government draft carries five conditions not yet in v5.2 (Project Delivery ×2, Collection ×3), and five SORs are still on v5.1. That isn't purchasing work, but don't read the draft as live.



## Comments


# #316 [OPEN] Purchasing after the meeting: update the specs lineup

## Destination

The purchasing specs match what purchasing actually said. Most of the module was specced from the sheets and from inference; the meeting of **2026-09-17** was the first time the business described its own process out loud. Seven things changed, four of them overturning decisions that were already closed.

Done looks like: the four amendments landed (below), seven new specs written and sliced into `ready-for-agent` tickets, and fourteen open tickets amended in place.

## What the meeting settled

Recorded in `CONTEXT.md` (six new terms, three amended) and `docs/adr/0023-purchasing-is-not-a-sales-flow.md`.

- **Purchasing does not run on the Flow Canvas** — ADR 0023. The five "stages" purchasing named are not stages of one record: the Costing Matrix exists from registration, Canvasses are per Component and run in parallel, an IPAS is per PO, a Transmittal is per slip, and Order Monitoring is a view across every IPAS. On a real project all five are live at once. Generalising the engine was also costed (six runtime tables, four triggers on `sales_opportunities`, ~13 SECURITY DEFINER functions, ~8 RLS policies, the move path inside a 3,538-line service, no polymorphic seam anywhere) and rejected — but rejected primarily on cardinality, which no engineering removes.
- **The Costing Matrix becomes a Closed Book** — [#225 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/225#issuecomment-5712996744). The two sides never meet: Purchasing sees cost and never the Final Offer; Sales sees the peso Markup Price and never the cost. Only Super Admins and the Final Acquire list see both. Finance drops out of the summary. Enforced server-side by per-tier column lists, following #295 — not client-side masking.
- **The markup factor moves with it** — [#224 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/224#issuecomment-5712999138). Markup Price ÷ factor = Acquire, so leaving the factor visible to Sales would open the Closed Book by arithmetic.
- **The Bid Decision becomes a record** — [#227 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/227#issuecomment-5713001632). Go / No-go / Revise on a priced offer, by the Final Acquire list, against the Final Offer and ABC it was taken at. "Costing settled" gains the Go check. No-go records and notifies and moves nothing — PMS never moves the deal.
- **Five additions to the Canvass** — [#235 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/235#issuecomment-5713006280). Canvasser; re-point from a Requested Item to the Component that later appears; Reference Rate pre-filling the comparison rate; Offer Projection; "No canvass" made visible on an item ordered without one.
- **A Purchasing Dashboard above the existing lists** — groups by what is outstanding (To source, To price, To order, On order, To check), derived and never stored, one SOR in as many as apply. Sits above the Procurement Queue and Order Monitoring rather than replacing either.
- **Odoo product search belongs on the Requested Item**, not on an Offer — that is where "do we even need to canvass this" is decided, and it unlocks **From stock**.

### Confirmed unchanged

IPAS's P0-from-Odoo fill (#242, #243, #219) already does what was asked. Order Monitoring's four groupings stand. The Purchase Request (#209) is the channel for "sales asks about a product we don't carry" — it is not replaced by canvassing, and the two are different things. The Requested Item status path (#306) is the only genuine state machine in purchasing.

### Deliberately not built

- **Real-time currency.** A bid that revalued itself overnight could not be signed. A daily **Reference Rate** with its date on it instead.
- **AI picking the canvass winner.** Both canvass tables are empty in staging — there is nothing to tune against, and a required "why this supplier" field becomes a rubber stamp the moment a machine pre-fills it. A non-binding AI comparison note is a fast-follow once real canvasses exist.
- **A chat per Canvass.** The conversation purchasing described happens *before* a Canvass exists; it is the Purchase Request chat (#307). A Canvass links to it.
- **A mandatory reason for skipping a canvass.** Single-source purchases are routine; the field becomes "n/a" within a week. Make the absence visible instead.

## The work

### Amendments landed

#225 · #224 · #227 · #235

### New specs to write

| | Lands with |
|---|---|
| Odoo product search on a Requested Item | the #209 block, beside #306 |
| Reference Rate — daily fetch, Offer pre-fill, IPAS context, stale handling | standalone; before the Canvass needs it |
| Closed Book — the per-tier read RPCs | **with** #266; it shapes every Costing Matrix ticket |
| Bid Decision — record, decider, clearing rules, notification | with #270 and #272 |
| Offer Projection — tier-split, on the Canvass | with #275, after #268 and #270 |
| Purchasing Dashboard — the five derived groupings | after the records it reads exist |
| AI comparison note | blocked until real Canvasses exist |

### Open tickets to amend in place

#266 · #268 · #269 · #270 · #272 · #274 · #275 · #276 · #279 · #280 · #282 · #306 · #307 · #261

## Notes

- **Domain:** the Purchasing and Costing Matrix sections of `CONTEXT.md`; ADR 0023.
- **This map inverts #210's rule.** #210 said "no spec before its tickets close" — grill first, then spec. Here the grilling already happened, in one session against the meeting notes, so the decisions are settled and the specs can be written directly. What #210's rule protects against — speccing on assumption — is exactly what this map is correcting.
- **Odoo stays read-only,** through edge functions. No ad hoc queries against staging or production (`AGENTS.md`).
- **Printing** goes through the existing HTML print pipeline and its signature rule (ADR 0014).
- **Assumption to check:** the printed Costing Matrix (#274) is taken as splitting into a Closed-Book money sheet plus a specification appendix anyone who sees the matrix may print, and the Bid Decision's verdict and reason reaching Sales without its numbers. Confirmed in conversation but worth a second look when #274 is written.

## Not yet specified

- Whether ADR 0002's **client-side commission masking** should follow the Closed Book server-side. Out of scope here, but the codebase now holds two opposite answers to the same question.
- What the business wants on the Purchasing Dashboard beyond the five groupings — purchasing was not confident in its own vocabulary, so these names are ours. The shape matters more than the labels; take back any single word purchasing pushes on.


## Comments
### seansoriano13 2026-10-05T08:44:55Z
**Follow-up map: #461.** It compares these specs against prod's Government flow (read 2026-10-05) and records 23 decisions. Purchasing's one-per-SOR tools now mount on Sales Flow stages (ADR 0033, which amends ADR 0023).


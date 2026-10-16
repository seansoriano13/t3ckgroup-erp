# #319 [OPEN] Closed Book: the database serves each side its own columns

## Parent

#316

## Depends on

- #266 / #268 / #270 — the Costing Matrix, its Components and its summary must exist to be split
- Pattern: #295 (`sor_participant_record` — an explicit money-free column list from the database)

## Problem Statement

The business named the Costing Matrix **the most confidential thing in the CRM process**, because it is the one place the margin is visible. #225 originally gave costs, Final Offer and the summary to the Deal Team, Purchasing, Finance and Management — which means anyone on the deal can read the margin. [That decision is overturned](https://github.com/seansoriano13/t3ckgroup-erp/issues/225#issuecomment-5712996744).

The naive fix — hiding columns in the UI — puts the margin in a network response that any salesperson can read with devtools open. That is how commission Privacy Masking works today (ADR 0002), and it is not good enough for this.

## Solution

### The rule: the two sides never meet

| Who | Reads | Never reads |
|---|---|---|
| **Purchasing** | Acquire, Landed Cost, the cost side of an Offer Projection | Final Offer, the summary, Final Acquire, the markup factor |
| **Sales (Deal Team)** | ABC, the peso Markup Price, Final Offer, Compliance | Acquire, the markup factor, achieved markup, the summary |
| **Closed Book** — Super Admins + the Final Acquire list | everything, plus the Bid Decision and its numbers | — |
| **Technical / other Stage Participants** | the matrix without money | any figure |

Neither working side can derive the margin alone. That is the whole point, and it is why the markup factor moves too ([#224 amended](https://github.com/seansoriano13/t3ckgroup-erp/issues/224#issuecomment-5712999138)) — `Markup Price ÷ factor = Acquire`.

**Finance drops out of the summary.** They get Landed Cost and the IPAS, which is what they work with.

### How

**Server-side, one table underneath.** Separate `SECURITY DEFINER` reads returning an **explicit column list per tier**, following `sor_participant_record`. The caller's tier is resolved in the database, never passed in.

- The tier is: Super Admin or on the Final Acquire list → Closed Book; else Purchasing access → cost side; else Deal Team → price side; else participant → no money.
- A column a tier may not read is **absent from the response**, not nulled — absent and null are different statements and the UI must not have to tell them apart.
- **Write bands are unchanged.** #225's rule that the database refuses a write outside its band stands exactly as specced; this adds a read rule beside it.

### Rejected

- **Client-side masking** (ADR 0002's approach): the margin reaches the browser.
- **Splitting cost and offer into two tables:** the summary and every Offer Projection need both sides, so you rejoin on every read and gain a migration for nothing.

## Acceptance criteria

- [ ] A Purchasing-access employee reading a Costing Matrix receives no Final Offer, no summary, no Final Acquire and no markup factor — the keys are absent.
- [ ] A Deal Team member receives no Acquire, no markup factor, no achieved markup and no summary.
- [ ] A Super Admin and a member of the Final Acquire list receive every column.
- [ ] A Stage Participant without Purchasing access or a Deal Team role receives the matrix with no money at all.
- [ ] A Finance-access employee receives Landed Cost but not the summary.
- [ ] The tier is decided in the database; no client-supplied parameter changes what is returned.
- [ ] Write-band enforcement is unchanged and still refuses out-of-band writes.
- [ ] Tested on the live policy stack (per #210's two-seam rule), with one test per tier asserting the absent keys.

## Domain

**Closed Book**, **Final Acquire**, **Markup** in `CONTEXT.md`.

## Notes

Leaves ADR 0002's client-side commission masking as the codebase's odd one out — flagged in #316, not in scope here.


## Comments
### seansoriano13 2026-10-05T08:44:42Z
## Amended: prod flow scan, 2026-10-05 (#461)

**Always sees gets a tier: the price side**, the same columns as the Deal Team.

- **Why it needed one:** on prod's Government flow, Always sees is 101 plus the whole SALES department. The tier list above never named them, so they would have fallen to "no money", or to one side by accident.
- **Why the price side:** they already read the SOR's quoted prices, so ABC, Markup Price and Final Offer leak nothing new.
- **Resolution order:** Closed Book → Purchasing access → Deal Team or Always sees → participant (`CONTEXT.md` **Closed Book**).


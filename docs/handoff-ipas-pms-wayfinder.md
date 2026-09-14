# Handoff: IPAS and PMS Wayfinder map

Written 2026-09-14, so that work on [IPAS and PMS move into the ERP](https://github.com/seansoriano13/t3ckgroup-erp/issues/210) can continue on another device in the same way. The map issue is the source of truth; this file only explains how to pick it up and how the sessions have been run.

## Resume

1. Open a Claude Code session in this repo on `staging`, after pulling.
2. Run `/wayfinder 210 continue 232 until <ticket>`.
3. The first thing to do is answer the open round below. "Where purchasing progress is recorded" is already claimed.

## Where things are

- **The map:** [IPAS and PMS move into the ERP](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). It holds:
  - the Destination and Notes
  - Decisions so far, one line per closed ticket
  - Not yet specified, and Out of scope
- **Source material:** the map's two comments summarise the IPAS sheet, the Costing Matrix sheet, and the "PMS" and "Evaluation of Specification" group task templates.
- **Tickets:** child issues of the map. The detail of each decision lives in its resolution comment.
- **Glossary:** `CONTEXT.md`, Purchasing and Philippine Government Procurement sections. Terms added through this map:
  - PMS, Costing Matrix and Evaluation of Specification
  - IPAS, Filing and Finance access
  - Charge and Landed Cost
  - Tender Line, Component, Inclusion and Markup
- **Bugs found while grilling:** comments on [SOR fixes before release](https://github.com/seansoriano13/t3ckgroup-erp/issues/199).
- **Odoo field research:** `docs/research/odoo-17-purchase-order-fields-for-ipas.md` on the `research/odoo-po-fields-for-ipas` branch.

## State on 2026-09-14

**Closed in the 2026-09-14 session:**
- [Read the live Odoo instance: companies and a sample PO](https://github.com/seansoriano13/t3ckgroup-erp/issues/216)
- [What one IPAS is](https://github.com/seansoriano13/t3ckgroup-erp/issues/217)
- [IPAS payments, charges and landed cost](https://github.com/seansoriano13/t3ckgroup-erp/issues/218)
- [Which IPAS fields and statuses come from Odoo](https://github.com/seansoriano13/t3ckgroup-erp/issues/219)
- [IPAS sign-off chain and access](https://github.com/seansoriano13/t3ckgroup-erp/issues/221)
- [Costing Matrix structure: tender lines, bundles and inclusions](https://github.com/seansoriano13/t3ckgroup-erp/issues/223)
- [How markups are added in the Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/224)

**Created in that session:** [What becomes of the Warehouse's receiving form and packing lists](https://github.com/seansoriano13/t3ckgroup-erp/issues/239), blocked by the Transmittal ticket.

**Agreed order next.** IPAS is built first, and its spec waits on these:
1. [Where purchasing progress is recorded](https://github.com/seansoriano13/t3ckgroup-erp/issues/232). Claimed; round 1 is open below.
2. [What a Transmittal is and what it carries](https://github.com/seansoriano13/t3ckgroup-erp/issues/233)
3. [IPAS documents, milestones and filing](https://github.com/seansoriano13/t3ckgroup-erp/issues/220). Unblocked once 1 and 2 close.
4. [Printed IPAS](https://github.com/seansoriano13/t3ckgroup-erp/issues/222), a prototype ticket. Unblocked once 3 closes.
5. **Then write the IPAS spec** (see the map's Notes):
   - format of [Purchase Requests](https://github.com/seansoriano13/t3ckgroup-erp/issues/209), labelled `ready-for-agent`
   - tests at two seams: the IPAS service against the fake PostgREST with Odoo stubbed, and the database rules on the local policy stack
   - no spec is written before its tickets close

**Also open and unblocked:**
- [Costing Matrix column ownership and who sees the numbers](https://github.com/seansoriano13/t3ckgroup-erp/issues/225)
- [Evaluation of Specification inside the Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/226)
- [When each part of PMS opens and how it gates the Sales Flow](https://github.com/seansoriano13/t3ckgroup-erp/issues/227)
- [How Costing Matrix rows, Purchase Requests and IPAS connect](https://github.com/seansoriano13/t3ckgroup-erp/issues/228)
- [What a TSR records](https://github.com/seansoriano13/t3ckgroup-erp/issues/234)
- [Canvass and Offers inside PMS](https://github.com/seansoriano13/t3ckgroup-erp/issues/235)

Always check the frontier live, since another session may have moved it.

## Open round: Where purchasing progress is recorded, round 1

Facts gathered for it:
- **The "PMS" group task is created once per SOR,** by a Stage Action on "NTP - Notice to Proceed". Its checklist gives each person one tick per step, however many POs the SOR buys through.
- **The IPAS already has status tracks** that repeat checklist steps: Supplier Origin, Buyer status and Computation Status.
- **Each template step already maps to a record decided or under way elsewhere:**

  | Step | Recorded on |
  | --- | --- |
  | RFQ, PO | Odoo |
  | PI, mode of payment, payment, mode of shipping | the IPAS |
  | Transmittal | its own ticket |
  | Quality check | TSR |
  | Receiving, reservation | Odoo |
  | Forwarder and customs clearance | the IPAS's Import Clearance and Delivered statuses |

- **Staging seed dump, 2026-09-14:**
  - 2 "Evaluation of Specification" tasks exist, and no checklist item on either has ever been ticked.
  - 18 PMS-titled group tasks are all still Active.
  - There are two templates named "PMS"; one is an untouched duplicate.
  - "PMS - Evaluation" has no tasks.
- **Group task members carry a grade and grade remarks,** so these tasks also feed how people are rated.

❓ **Q1** - **Where an order's progress is recorded**: Options:
- (a) On the order's own records: its IPAS status tracks, Transmittals, TSRs and the Odoo milestones. Group task checklists stop tracking order steps, and PMS never reads or ticks them.
- (b) On the "PMS" group task's checklists.
- (c) Both.

➡️ **(a).** One checklist per SOR can't tell five POs apart, the same steps are already tracked twice, and staging shows checklists aren't ticked in practice. Linking PMS events to checklist text the business edits would break silently on the first rename.

❓ **Q2** - **What becomes of the "PMS" group task template**: Options:
- (a) It's kept as the per-SOR assignment of who does what, along with its grading. The business removes the checklist items that PMS now records, as part of switch-over, and the NTP Stage Action keeps creating it.
- (b) It's retired: the Stage Action stops creating it once PMS ships.
- (c) It's kept as it is.

➡️ **(a).** The assignment and the grading have no other home, but the duplicated steps would keep people ticking twice. Templates stay the business's to edit, so the ERP changes no template. When items get removed belongs to the map's Switch-over fog.

❓ **Q3** - **The "Evaluation of Specification" and "PMS - Evaluation" templates**:

➡️ **Leave them to [Evaluation of Specification inside the Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/226),** which already asks what happens to that group task. This ticket decides only the "PMS" template.

## How the sessions have been run

**Per ticket**
- **One ticket at a time.** Claim it first with `gh issue edit <n> --add-assignee @me`, then zoom into its body and the closed tickets it builds on.
- **Find facts yourself before asking** (details below).
- **Ask in rounds.** Number each question `❓ **Qn**`, give the options, then a `➡️` recommendation with the reason.
  - Lead with the recommendation and the facts. The user wants decisions, not question lists.
  - A question that depends on another question in the same round waits for the next round.
- **When the user answers** ("agree to all recommendation", or "1a 2b"):
  - Check the answers against earlier decisions and the glossary.
  - If nothing contradicts, say why in a line or two, then close. Don't re-present the resolution for confirmation.
  - If something contradicts, stop and raise it.
  - Consequences that follow from earlier decisions can be written in as derived. Anything genuinely new still needs the user's answer.
- **Closing a ticket:**
  1. Post the resolution comment, using the shape below.
  2. Close the issue.
  3. Fetch the map body fresh, insert one line under Decisions so far after the previous line, and write it back.
  4. Update `CONTEXT.md` for any term the ticket settled. It's a glossary only: no implementation detail.
  5. Graduate fog or create tickets as needed: create the issue, add it as a sub-issue of the map, then add its blockers by database id (`docs/agents/issue-tracker.md`).
- **Stop at the end of the range the user named,** and recommend the next ticket.

**The resolution comment's shape:**
1. A bold one-line decision, ending "Decided <date>."
2. Short sections for the decision itself.
3. **Why:** the facts behind it.
4. **Consistent with earlier decisions**, when that needs saying.
5. **Handed on:** the open ticket, named with its link, that owns each loose end.
6. **Glossary:** what changed in `CONTEXT.md`.

Refer to tickets by name with a link, never by bare number.

**Standing rules**
- **Bugs spotted while grilling** go as a comment on [SOR fixes before release](https://github.com/seansoriano13/t3ckgroup-erp/issues/199). Rounds stay about decisions.
- **The Costing Matrix copies the sheet's tax and ITR maths on purpose.** Don't reopen it; it's out of scope on the map.
- **v1 follows the sheets and templates faithfully,** and the business corrects things in use. Don't design for patterns nobody has confirmed.
- **Nobody writes to Odoo.** No ad hoc queries against the staging or production databases either (`AGENTS.md`).

**Finding facts**
- **Odoo, read-only:**
  - Credentials are in `.env.mirror` at the repo root. It's git-ignored and holds a live API key.
  - It is **not** in git, so copy it to the new device yourself over a private channel, and never commit it.
  - Without it, give the human a checklist of the reads instead.
  - Scratch scripts go in the session scratchpad. They authenticate like `supabase/functions/_shared/odoo.ts` and refuse any method other than `search_read`, `read`, `search_count` and `fields_get`.
  - Never print bank account numbers or TIN values, only whether they're set.
- **ERP data shape:** `supabase/.seed/staging-dump.json`, the local staging seed dump. Its employee ids are UUIDs, so the sheets' codes (101, 1001, 1203) can't be matched to them.
- **Schema:** `supabase/schema/staging.sql`.

**Notes**
- **The `to-spec` skill** is only a zip at `~/.claude/skills/to-spec.zip`, not installed. Its template matches the Purchase Requests spec.
- **Claude's auto-memory doesn't travel between devices.** The preferences above are the ones it held for this work.

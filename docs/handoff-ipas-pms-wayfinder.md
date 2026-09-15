# Handoff: IPAS and PMS Wayfinder map

Written 2026-09-14, so that work on [IPAS and PMS move into the ERP](https://github.com/seansoriano13/t3ckgroup-erp/issues/210) can continue on another device in the same way. The map issue is the source of truth; this file only explains how to pick it up and how the sessions have been run.

## Resume

1. Open a Claude Code session in this repo on `staging`, after pulling.
2. Run `/wayfinder 210 continue 233 until <ticket>`.
3. Start with [What a Transmittal is and what it carries](https://github.com/seansoriano13/t3ckgroup-erp/issues/233). Nobody has claimed it, and no round is open. It's the first of the three tickets the IPAS spec still waits on.

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
- [Where purchasing progress is recorded](https://github.com/seansoriano13/t3ckgroup-erp/issues/232)

**Created in that session:** [What becomes of the Warehouse's receiving form and packing lists](https://github.com/seansoriano13/t3ckgroup-erp/issues/239), blocked by the Transmittal ticket.

**Agreed order next.** IPAS is built first, and its spec waits on these:
1. [What a Transmittal is and what it carries](https://github.com/seansoriano13/t3ckgroup-erp/issues/233)
2. [IPAS documents, milestones and filing](https://github.com/seansoriano13/t3ckgroup-erp/issues/220). Unblocked once 1 closes.
3. [Printed IPAS](https://github.com/seansoriano13/t3ckgroup-erp/issues/222), a prototype ticket. Unblocked once 2 closes.
4. **Then write the IPAS spec** (see the map's Notes):
   - format of [Purchase Requests](https://github.com/seansoriano13/t3ckgroup-erp/issues/209), labelled `ready-for-agent`
   - tests at two seams: the IPAS service against the fake PostgREST with Odoo stubbed, and the database rules on the local policy stack
   - no spec is written before its tickets close

## State on 2026-09-15

**Closed in the 2026-09-15 session,** which ran the four Costing Matrix tickets end to end:
- [Costing Matrix column ownership and who sees the numbers](https://github.com/seansoriano13/t3ckgroup-erp/issues/225)
- [Evaluation of Specification inside the Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/226)
- [When each part of PMS opens and how it gates the Sales Flow](https://github.com/seansoriano13/t3ckgroup-erp/issues/227)
- [How Costing Matrix rows, Purchase Requests and IPAS connect](https://github.com/seansoriano13/t3ckgroup-erp/issues/228)

**What those four changed outside the map:**
- `docs/adr/0021-stage-scoped-sor-visibility.md` gains an **Amendments** section: Purchasing, Finance and the Final Acquire list read a Costing Matrix's Final Offer and summary, which the ADR otherwise keeps to the Deal Team.
- [Purchase Requests](https://github.com/seansoriano13/t3ckgroup-erp/issues/209), still `ready-for-agent` and unbuilt, gains two things, noted in a comment there: a Requested Item may name the component it buys for, and Ordered records the Odoo PO line.
- `CONTEXT.md` adds Final Acquire, Incharge and Compliance, extends Costing Matrix, Component, Requested Item, Evaluation of Specification and Stage Condition.

**The Costing Matrix now has every decision it needs**, so [Printed Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/229) is unblocked and can be prototyped.

**Open and unblocked:**
- [What a Transmittal is and what it carries](https://github.com/seansoriano13/t3ckgroup-erp/issues/233) — next, and the IPAS spec waits on it
- [What a TSR records](https://github.com/seansoriano13/t3ckgroup-erp/issues/234)
- [Canvass and Offers inside PMS](https://github.com/seansoriano13/t3ckgroup-erp/issues/235)
- [Printed Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/229), a prototype ticket
- [Order monitoring view](https://github.com/seansoriano13/t3ckgroup-erp/issues/237), a prototype ticket

Always check the frontier live, since another session may have moved it.

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

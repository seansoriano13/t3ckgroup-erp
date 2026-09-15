# Handoff: IPAS and PMS Wayfinder map

Written 2026-09-14, so that work on [IPAS and PMS move into the ERP](https://github.com/seansoriano13/t3ckgroup-erp/issues/210) can continue on another device in the same way. The map issue is the source of truth; this file only explains how to pick it up and how the sessions have been run.

## Resume

**Every ticket on the map is closed.** The frontier is empty, so there is no ticket to continue — the next work is writing the specs, in the build order below.

1. Open a Claude Code session in this repo on `staging`, after pulling.
2. Work through **[Extracting the specs](#extracting-the-specs)** below — one session per spec, each running `/to-spec` then `/to-tickets` in one window, then `/clear`. Start with session 1, the IPAS.
3. Four patches of fog remain on the map — option lists, switch-over, estimate vs actual, and inquiries that buy nothing. None blocks a spec; graduate them with `/wayfinder 210` when they sharpen.

`to-spec` is not installed: it is a zip at `~/.claude/skills/to-spec.zip`.

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
  - Tender Line, Component, Inclusion, Markup and Final Acquire
  - Incharge and Compliance
  - Transmittal, TSR and Packing List
- **Prototype branches,** each linked from its ticket's resolution comment:
  - `prototype/printed-costing-matrix` — the printed Costing Matrix (#229)
  - `prototype/order-monitoring` — the order monitoring view (#237)
  - `prototype/printed-forms` — the printed Canvass (#236), Transmittal and TSR (#238), and IPAS (#222)
- **Bugs found while grilling:** comments on [SOR fixes before release](https://github.com/seansoriano13/t3ckgroup-erp/issues/199).
- **Odoo field research:** `docs/research/odoo-17-purchase-order-fields-for-ipas.md` on the `research/odoo-po-fields-for-ipas` branch.

## Extracting the specs

Eight sessions turn the closed map into specs and `ready-for-agent` tickets. **One spec per session**, each running `/to-spec` then `/to-tickets` in one unbroken window, then `/clear` — everything a session needs is on the tracker, so they are independent and you can stop after any of them.

Each prompt below is meant to be pasted as-is.

### 1. IPAS v1 — build step 1

> `/to-spec` — Write the **IPAS v1** spec, step 1 of the build order on [the IPAS and PMS map](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the map for Destination and Notes, then the **resolution comment** on each of #217, #218, #219, #220, #221, #212 and #222 — the decisions live in those comments, not in the map's one-line gists. Odoo facts are in #215 (research file on branch `research/odoo-po-fields-for-ipas`) and #216. Vocabulary is in `CONTEXT.md`, Purchasing and Philippine Government Procurement.
>
> Format follows [Purchase Requests #209](https://github.com/seansoriano13/t3ckgroup-erp/issues/209). The map's Notes carry the two test seams: the IPAS service against the fake PostgREST with Odoo stubbed, and the database rules on the local policy stack.
>
> **Referenced, not specced:** #233 Transmittals and #234 TSRs arrive in build step 2. Section 5 and the Actual Checking status read them — say how, and mark them as arriving next, so nobody builds a stub.
>
> Then `/to-tickets`, labelled `ready-for-agent`, with blocking edges.

### 2. Transmittals, TSRs and the Packing List — build step 2

> `/to-spec` — Write the **Transmittals, TSRs and Packing List** spec, step 2 of the build order on [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the resolution comments on #233, #234, #239 and #238. Context: #231 (what stays in Odoo), #232 (progress lives on records, never on checklists), #216 (the live Odoo warehouse facts), and #220 for the two hooks back into the IPAS — section 5 lists the Transmittals naming it, and Actual Checking is stamped from closed TSRs.
>
> The **printed Packing List** has no ticket of its own; #239 says to specify it alongside the printed Transmittal, which #238 settled.
>
> Format follows #209. Prototype for the printed forms: branch `prototype/printed-forms`, linked from #238.
>
> Then `/to-tickets`, labelled `ready-for-agent`.

### 3. Order monitoring — build step 3

> `/to-spec` — Write the **order monitoring** spec, step 3 of the build order on [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the resolution comment on #237, plus #220 (the status tracks it draws), #233 and #234 (the hand-off and check states), #232 (why every state comes from a record) and #225 (who may see it: Purchasing access, Finance access and Super Admins across every SOR; an SOR's own people see only theirs).
>
> The per-step ageing thresholds are settings the business edits, not code.
>
> Format follows #209. Prototype: branch `prototype/order-monitoring`, linked from #237.
>
> Then `/to-tickets`, labelled `ready-for-agent`.

### 4. Fold the map's amendments into Purchase Requests — any time before step 4 is built

Not a spec: an edit pass, because #209 is already `ready-for-agent` and three decisions changed it.

> Open [Purchase Requests #209](https://github.com/seansoriano13/t3ckgroup-erp/issues/209). Three comments from the IPAS and PMS map amend it — from #228 (a Requested Item may name the Costing Matrix component it buys for; Ordered records the Odoo PO line, not just the number) and #235 (Canvassing means a Canvass on that component, or on the Requested Item where no matrix row exists; never on an Inclusion). Fold all three into the spec body so nobody building from it has to read the comments, and leave a note saying they came from the map.

### 5. Costing Matrix and Evaluation of Specification — build step 5a

> `/to-spec` — Write the **Costing Matrix** spec, including the Evaluation of Specification, step 5 of the build order on [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the resolution comments on #223, #214, #213, #224, #225, #226, #227, #229 and #230. It depends on #202 Stock Availability, #207 the SOR modal, #208 stage-scoped visibility and #209 Purchase Requests.
>
> Two things that reach outside the matrix: **#227 adds a new verifiable Stage Condition kind, "costing settled"**, which touches the Flow Canvas and stage rules (#203, #204); and **ADR 0021 carries an amendment** letting Purchasing, Finance and the Final Acquire list read a matrix's Final Offer and summary.
>
> The tax and ITR maths copies the sheet on purpose (#213) — the worked examples there are the tests. Prototype: branch `prototype/printed-costing-matrix`, linked from #229.
>
> Then `/to-tickets`, labelled `ready-for-agent`.

### 6. Canvass and Offers — build step 5b

> `/to-spec` — Write the **Canvass and Offers** spec, the second half of step 5 on [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the resolution comments on #235 and #236. It re-points the half-built `sor_canvasses` and `sor_canvass_offers` tables — both empty in staging — at Costing Matrix components, and brings back the Canvass and Inclusion panels that #209 hides.
>
> Note the fields added since the tables were built: supplier, currency, quote validity, the comparison rate for a foreign quote, and the Canvass's typed reason.
>
> Prototype: branch `prototype/printed-forms`, linked from #236.
>
> Then `/to-tickets`, labelled `ready-for-agent`.

### 7. Landed cost back into the Costing Matrix — build step 6

> `/to-spec` — Write the **landed cost flows back** spec, step 6 and last on [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210). Read the resolution comment on #228, with #218 (how Landed Cost is computed and spread), #220 (costs complete is what makes it final) and #225 (who may see costs).
>
> The join is the Odoo PO line picked when a Requested Item is marked Ordered. Landed Cost sits beside Acquire, Odoo and Final Acquire and replaces none of them, feeds neither markup nor the summary, and carries its provisional or final mark wherever it's read.
>
> Then `/to-tickets`, labelled `ready-for-agent`.

### 8. Close the map

> Every spec from [map #210](https://github.com/seansoriano13/t3ckgroup-erp/issues/210) is written and sliced into `ready-for-agent` tickets. Post a closing comment on the map listing each spec issue against its build step, then close it. Four patches of fog stay unresolved and in scope — option lists, switch-over, estimate vs actual, and inquiries that buy nothing. Say in the comment that they return as a fresh effort when they sharpen, and update `docs/handoff-ipas-pms-wayfinder.md` to match.

### Two side quests, neither blocking

- **Switch-over access.** Nobody on staging holds Purchasing access, not even the Purchasing Manager, and Finance access and the Final Acquire list are empty. That is `/wizard` territory, not a spec.
- **The fog.** Run `/wayfinder 210` again when switch-over or estimate-vs-actual sharpens enough to ticket.

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

**Closed in the 2026-09-15 session,** nine tickets: the four Costing Matrix ones, then the parts that come in after award.
- [Costing Matrix column ownership and who sees the numbers](https://github.com/seansoriano13/t3ckgroup-erp/issues/225)
- [Evaluation of Specification inside the Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/226)
- [When each part of PMS opens and how it gates the Sales Flow](https://github.com/seansoriano13/t3ckgroup-erp/issues/227)
- [How Costing Matrix rows, Purchase Requests and IPAS connect](https://github.com/seansoriano13/t3ckgroup-erp/issues/228)
- [Printed Costing Matrix](https://github.com/seansoriano13/t3ckgroup-erp/issues/229) — prototype
- [What a Transmittal is and what it carries](https://github.com/seansoriano13/t3ckgroup-erp/issues/233)
- [What a TSR records](https://github.com/seansoriano13/t3ckgroup-erp/issues/234)
- [Canvass and Offers inside PMS](https://github.com/seansoriano13/t3ckgroup-erp/issues/235)
- [Order monitoring view](https://github.com/seansoriano13/t3ckgroup-erp/issues/237) — prototype

**Prototypes live on throwaway branches, never on `staging`:**
- `prototype/printed-costing-matrix` — `src/lib/pdf/printed-costing-matrix.prototype.html`. Note: git attached this branch to the pre-existing worktree at `D:/Sean/t3ckgroup-erp-mention-main`.
- `prototype/order-monitoring` — `src/pages/purchasing/order-monitoring.prototype.html`.

**Created:** [Build order for Transmittals, TSRs, the Canvass and order monitoring](https://github.com/seansoriano13/t3ckgroup-erp/issues/240), graduated from the map's fog now that what each part is has closed. Blocked by the Warehouse ticket.

**What they changed outside the map:**
- `docs/adr/0021-stage-scoped-sor-visibility.md` gains an **Amendments** section: Purchasing, Finance and the Final Acquire list read a Costing Matrix's Final Offer and summary, which the ADR otherwise keeps to the Deal Team.
- [Purchase Requests](https://github.com/seansoriano13/t3ckgroup-erp/issues/209), still `ready-for-agent` and unbuilt, gains three things, noted in comments there: a Requested Item may name the component it buys for, Ordered records the Odoo PO line, and Canvassing means a Canvass on that component.
- `CONTEXT.md` adds Final Acquire, Incharge, Compliance, Transmittal and TSR, and extends Costing Matrix, Component, Requested Item, Evaluation of Specification, Stage Condition, Completeness, Canvass and Offer.

**Then, in the same session, the rest of the map:**
- [IPAS documents, milestones and filing](https://github.com/seansoriano13/t3ckgroup-erp/issues/220)
- [Printed Canvass](https://github.com/seansoriano13/t3ckgroup-erp/issues/236) — prototype
- [Printed Transmittal and TSR](https://github.com/seansoriano13/t3ckgroup-erp/issues/238) — prototype
- [What becomes of the Warehouse's receiving form and packing lists](https://github.com/seansoriano13/t3ckgroup-erp/issues/239)
- [Printed IPAS](https://github.com/seansoriano13/t3ckgroup-erp/issues/222) — prototype
- [Build order for Transmittals, TSRs, the Canvass and order monitoring](https://github.com/seansoriano13/t3ckgroup-erp/issues/240)

**The frontier is empty.** Sixteen tickets closed in all, and the map's remaining content is four patches of fog, none of which blocks a spec.

**Two corrections worth knowing about:**
- **Packing lists are no longer out of scope.** Odoo has never held a package, so PMS takes a light printed Packing List; the map's Out of scope section and [How much of the process after award PMS covers](https://github.com/seansoriano13/t3ckgroup-erp/issues/231) both say so now.
- **Operational Expenses is not typed.** It is the Final Acquire total; only Marketing and OPEX are typed.

**The build order the specs follow** ([#240](https://github.com/seansoriano13/t3ckgroup-erp/issues/240)):
1. IPAS v1, standalone, with its printed form
2. Transmittals, TSRs and the Packing List, with their printed forms
3. Order monitoring
4. The queued CRM specs, up to Purchase Requests
5. The Costing Matrix, the Evaluation of Specification and the Canvass, with their printed forms
6. Landed cost back into the Costing Matrix

**Prototype branches:** `prototype/printed-costing-matrix`, `prototype/order-monitoring`, and `prototype/printed-forms` (canvass, transmittal and TSR, IPAS). Each ticket's resolution comment links its artifact.

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

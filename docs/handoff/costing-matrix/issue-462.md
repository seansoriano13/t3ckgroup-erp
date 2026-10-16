# #462 [OPEN] Open Costing Matrix: a Stage Action that mounts the matrix on a stage

## Parent

#461 (Q16, Q18, Q19). ADR 0033.

## Depends on

- **#266 / #267 / #268:** the Costing Matrix tables and the PMS page.
- **#204:** Stage Actions, action runs and Optional Actions.
- **#304:** Open Purchase Request, the pattern this copies, including Q13's top-up.

## Problem Statement

#227 and #266 put a Costing Matrix on every SOR from registration, with nothing to open it. Operations wants purchasing's tools to mount on stages the way group and individual tasks do. Prod's Government flow already treats costing as stage-bound work: Sales encodes item specs and purchasing requests quotations inside SO Evaluation's group task. A matrix on every SOR of every Sale Type also shows an empty tool on flows that buy nothing.

## Solution

### The action

A new Stage Action kind, **Open Costing Matrix** (`open_costing_matrix`), placed on any stage. Like Open Purchase Request, it can run automatically or wait for a Decider as an Optional Action.

**Config:**

| Setting | Default |
|---|---|
| Sales Incharge | the Deal Owner role |
| Purchasing Incharge | a named person, **or** blank with "who assigns it" (people or groups), who are notified when it opens with none |
| Markup preset | the matrix default factor, from the business-edited presets |
| Extra members | people or groups called in as Stage Participants with an access window (the same window options group tasks have); they see the matrix without money |

### Rules

- **At most one Costing Matrix per SOR.** A later run, on the same stage or another, fills only what is still empty: a blank Incharge, missing members. It never replaces or removes anything.
- **The PMS page still exists from registration.** It holds the Purchase Request card, the IPAS summaries, the Transmittals and the Packing Lists. Its **Costing Matrix section appears only once this action has run.** Before that it shows nothing, not an empty grid.
- **Costing conditions read unmet on an SOR with no matrix.** That covers Costing settled (#272) and Costing priced (#463).

## Acceptance criteria

- [ ] `flow_stage_actions` accepts `open_costing_matrix` with the config above; the Flow Canvas edits it.
- [ ] Running it creates the SOR's Costing Matrix with the configured Incharges and markup default, and adds extra members with their window.
- [ ] With no Purchasing Incharge configured, the matrix opens without one and the "who assigns it" list is notified.
- [ ] A second run on an SOR that has a matrix creates none, fills only empty settings, and adds only missing members.
- [ ] An SOR whose flow never ran the action shows a PMS page with no Costing Matrix section.
- [ ] Costing settled reads unmet on an SOR with no matrix.
- [ ] Tested at the service seam (fake PostgREST) and the policy tier (who may read the new matrix stays #319's rule).

## Domain

**Costing Matrix**, **Incharge**, **PMS** in `CONTEXT.md`; ADR 0033.


## Comments


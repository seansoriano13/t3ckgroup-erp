# Notes index — Costing Matrix (#266)

Code facts gathered from `D:\Sean\t3ckgroup-erp-costing` at `integrate/costing-matrix`
(= staging 7c10ef8a + empty start commit). Facts only; decisions live in DESIGN.md.

- `DESIGN.md` — orchestrator's binding decisions (scope, amendments in force, task graph). Not written by the explorer.
- `conventions.md` — migration naming/rules, schema mirror, how the fake DB reads migrations, changelog format, commit style, lint/test commands, policy tier, CONTEXT.md glossary entries, relevant ADRs.
- `access-helpers.md` — SQL helpers (Super Admin, Deal Team, Always sees, access level, participants, Purchasing/Finance flags, group tasks/templates), the explicit-column read, the money-table pattern, append-only events, IPAS signer lists and sign-offs, OLD/NEW guard triggers.
- `stage-conditions-and-actions.md` — condition kind CHECK, the client-side evaluator and its five call sites, Purchasing settled end to end, Flow Canvas labels/picker/published versions, publish path (no warnings exist), Open Purchase Request action end to end, Stage Visits and timeline logs.
- `sor-modal-and-pms.md` — SOR modal views (NestedShell), where PR/IPAS/Handoffs sections render, locked view, hidden Inclusions/Canvass panels and `sor_inclusions`, SOR line items and replacement, Stock Availability, Purchase Request schema/service/UI, Purchasing settings tab, Approval Center queues.
- `services-and-tests.md` — service conventions and error surfacing, money arithmetic (no decimal lib), the fake PostgREST and stubs, factories, policy-tier support (cast, rows, access probes, teardown hazard), page/component test prior art.
- `print-pipeline.md` — ADR 0014 layers, adding a form type, landscape (none yet), signature blocks and fallbacks, money gating in a view model, the #229 prototype's three variants.

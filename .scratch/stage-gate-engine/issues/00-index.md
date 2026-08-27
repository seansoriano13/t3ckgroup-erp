# Stage Gate Engine — ticket breakdown

Source: [docs/stage-gate-engine-spec.md](../../../docs/stage-gate-engine-spec.md).
Scope is exactly the spec's scope — no Deal Type / per-Pipeline stages (out of
scope per the spec: "assumes one Pipeline today"), no ITB gate removal, no
Group Task auto-creation, no `awarded_value`. Those live in the wider
program's own tickets, not here.

Split along the spec's own seams (pure evaluation vs. services) plus the
write-path and UI work neither seam covers on its own.

| # | Ticket | Blocked by | What works after |
| --- | --- | --- | --- |
| 1 | [Schema + pure evaluation engine](01-schema-and-evaluation-engine.md) | — | The two tables exist, `stage_checkpoints` is gone, and a pure module can answer "which stages does this crossing cover" and "is this requirement satisfied" for every kind, unit-tested in isolation. Nothing is wired in yet. |
| 2 | [Gate enforcement in updateStage](02-gate-enforcement.md) | 1 | A stage move that skips a required, unsatisfied requirement is refused with the specific missing item named — including requirements on stages jumped over, not just the destination. The ITB gate still fires alongside it. |
| 3 | [stageRequirementService — configuration](03-requirement-config-service.md) | 1 | A Super Admin can add, reorder, and archive a Stage's requirements through a service API. Non-Super-Admins are refused. Every change is audit-logged. |
| 4 | [Config UI](04-config-ui.md) | 3 | The same, from a settings screen usable on a phone, next to the existing pipeline stage configuration. |
| 5 | [Per-kind satisfaction wiring](05-per-kind-satisfaction.md) | 2 | Attaching the named document, filling the named field, ticking a self-cert box, and assigning a member from the named department each satisfy their requirement — live for attachment/field/assignment, as an authored status row for tickbox. Satisfying or archiving a requirement narrates into the SOR timeline. |
| 6 | [Deal Owner visibility](06-deal-owner-visibility.md) | 2 | Before trying to move, a Deal Owner sees what a Stage owes and who satisfied what and when. Blocked Sales Directors can see which deals are blocked and on what. |
| 7 | [Deadline kind — countdown + notifications](07-deadline-kind.md) | 1 | A Stage carrying a `deadline` requirement shows a countdown on the card and notifies as it approaches and again once it passes. It never blocks a move. |

```
1 ──┬── 2 ──┬── 5
    │       └── 6
    ├── 3 ── 4
    └── 7
```

3, 4, and 7 can run fully in parallel with 2, 5, 6 once 1 lands — they touch
different files (`stageRequirementService`, a new settings screen, deadline
display/notify) and nothing in the funnel.

# #271 [OPEN] Costing Matrix: Evaluation of Specification

## Parent

#266 (Costing Matrix spec)

## What to build

Technical evaluates each Component against its Tender Line on the matrix itself, and the purchasing reviewer approves the evaluation once.

- **Columns:** `compliance` (`complies`, `deviates` or null), `compliance_note` (CHECK: required when `deviates`), `recommended_alternative` on Components; the Offer Specification shown beside the Tender Specification; Completeness on Inclusions.
- **Technical band:** `costing_is_technical(opp)` — Purchasing access, or a current member of a group task on that SOR created from `costing_settings.evaluation_template_id`. A migration adds the column and seeds it by the template name "Evaluation of Specification"; Super Admin changes it. The band writes Compliance, note, alternative and Completeness, while still reading the matrix without money.
- **Sign-off:** `costing_signoffs` (live row is the uncleared one). `costing_sign(matrix, 'evaluation_approved')` needs the `evaluation` list (seeded with 1001) and every Component carrying a verdict. Triggers clear it, with a reason, on a change to a Tender Specification, Offer Specification, compliance or note, or on adding or removing a Tender Line or Component.
- **`costingMath.complianceRollup`:** per Tender Line and for the matrix header ("2 of 5 deviate · 1 not evaluated").
- **Service:** `setCompliance(componentId, { verdict, note, alternative })`, `sign('evaluation_approved')`.
- **Grid:** verdicts with their notes, the roll-ups on lines and header, the approval state and its sign button. The settings page gains the evaluation template and the `evaluation` list.
- **Changelog entry.**

## Acceptance criteria

- [ ] A deviation without a note is refused by the database.
- [ ] **Policy tier:** a current evaluation-task member writes Compliance and is refused Acquire and every money table; once removed from the task, the write is refused; a Deal Team member not on the task is refused Compliance.
- [ ] Approval with an unevaluated Component is refused; someone off the `evaluation` list is refused.
- [ ] **Service test:** changing an Offer Specification after approval clears it, and history records the reason.
- [ ] A deviation leaves the summary unchanged.
- [ ] **Unit:** `complianceRollup` counts deviates and not evaluated.

## Blocked by

- #268 Costing Matrix: Components, bundles, Inclusions and cost-only rows


## Comments


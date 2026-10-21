# IPAS section 3 is a sign-off, and "Checked by" is gone

**Status:** accepted (2026-10-25), spec #584, ticket #586

The IPAS's third part (Computation status & Landed Cost) used to end in a
"Checked by" Computation status step. It looked like a sign-off and was not:
nobody signed it, it printed no signature, Filing did not wait for it, and only
Finance or a Super Admin outside Purchasing could set it. To everyone else the
step was just greyed out, and the current step was drawn without a tick, so a
"Checked by" IPAS looked unfinished.

We decided that part 3 becomes a **real sign-off section**, like sections 1 and
2, with **Submitted** and **Approved**, and that the Computation status now
**ends at LC Odoo Done**. "Checked" keeps one meaning only: section 4's Checked
step.

## Why

A check that nobody signs proves nothing. The Landed Cost is the number the
whole IPAS is filed on, so someone other than the preparer should vouch for it,
by name, with a signature on the print. Making it a sign-off reuses everything
sections 1 and 2 already have: a list of approvers, no self-approval, Return and
Undo approval, history, notices and a printed box.

## Decisions

- **Stored as sign-off section 6, shown as section 3.** The database stores
  sign-off sections by their paper-sheet numbers: 1 (Purchasing), 3 (Purchasing
  & Finance), 7 (Filing). The sheet called "Computation status & Landed Cost"
  section 6 (the print view model still does), so the new sign-off is stored as
  **6**. `_ipas_section_no` (SQL) and `ipasSectionNo` (`src/constants/ipas.js`)
  are the only mapping from stored to screen number (1, 3, 6, 7 show as 1, 2, 3,
  4); nothing else may hard-code it.
- **A new signer list, `s6_approved`**, shown in Settings as "Section 3 ·
  Approved", managed by the same atomic Super Admin function
  (`ipas_set_signer_list`) and change log as the other IPAS lists. The migration
  seeds it with every employee who has Finance access at migration time (the
  `has_finance_access()` test), so filing does not stop on release day while a
  Super Admin fills the list. The seed writes no change-log rows: the log needs
  an actor and a migration has none.
- **The rules are those of sections 1 and 2.** Submit needs Purchasing access
  and is refused unless the Computation status is LC Odoo Done; Approve needs
  list membership; nobody approves their own submission; a Super Admin approves
  only if listed.
- **The "Finance or a non-Purchasing Super Admin gives Checked by" rule and its
  UI lock are removed.** `ipas_set_header` is Purchasing's alone, the status
  list has four values, and the status check constraint drops `checked`.
  Landed Cost turns final at LC Odoo Done, or once filed, as before.
- **Section 4's gate and the clearing of section 3 are separate tickets.**
  #590 makes Filing wait for sections 1, 2 and 3; #591 clears section 3's
  approval when the Landed Cost total changes and adds Return and Undo approval
  for it. They add their parts to this record.

## Old data: how "Checked by" was converted

The migration (`20261025110000_586_ipas_section3_signoff.sql`) runs one
re-runnable function, `_ipas_convert_checked_by()`:

- For every non-cancelled IPAS at Checked by it writes a section 3 **Approved**
  (person and time of the latest header event that moved the status to
  `checked`) and a **Submitted** (the latest event that moved it to
  `lc_odoo_done`). Each gets a `signed` history event dated at the original time
  and flagged `migrated`, so history reads "section 3 · approved" by the same
  person at the same time.
- The signature stored with each is the signer's current stored signature, or
  none (the print then shows the name only).
- **Both or neither.** An Approved is written only when a Submitted event also
  exists, because an approval with nobody having submitted would break "someone
  else approves". With no history the section stays unsigned and the status
  still moves.
- Then every IPAS at Checked by moves to LC Odoo Done.

### Filed IPAS

Filed IPAS are frozen, and the spec allowed two ways: read them as approved from
history at display time, or write their rows in the migration. We **write
them**, because the freeze triggers stay intact either way and nothing needs a
display-time special case:

- `ipas_signoffs` and `ipas_events` carry no freeze trigger (only
  `ipas_signoffs_guard`, which blocks updates to a signature, and the append-only
  events trigger), so inserting the section 3 rows for a filed IPAS needs no
  exception.
- The one write that does hit `ipas_freeze_guard` is the status update. It runs
  under `ipas.reopening = on` for that single statement, the same exception
  `ipas_reopen` uses, and is switched off straight after. The guard itself is
  unchanged, and a filed IPAS still refuses every other write.

## Filing waits for section 3 (#590)

Section 4 (Filing, stored 7) opens only once sections 1, 2 and 3 (stored 1, 3
and 6) all have a live Approved. One helper, `_ipas_filing_open(ipas_id)`, is the
only place that knows this, and `ipas_sign` and `ipas_send_back` both ask it.

- The gate is checked for every section 4 role, so the final Approve waits for
  section 3 without a separate rule. For the same reason, an IPAS that is
  part-signed on release day cannot get its remaining Noted or Checked until
  section 3 is approved. Received, Noted and Checked already given **stay**: the
  migration clears nothing.
- The Received list is told when section 3 (or 1, or 2) is the last of the three
  to be approved and section 4 has nothing live.
- Order standing gains a step, "Section 3 waiting for approval", owed by the
  section 3 approval list and ageing under the rule key `section_3_approval`
  (blank by default). "Ready to file" now needs section 3 approved too.
- **Release order:** the section 3 migration above (list seeding and the Checked
  by conversion) must run before this gate reaches users, or no IPAS has a
  section 3 approval and Filing stops.

## Consequences

- A filed IPAS from before this change shows its old Checked by as a section 3
  approval, and stays filed and frozen.
- IPAS history written before this change still says "Checked by" in its
  Computation status lines; the label is kept for reading old history only.
- The SOR's IPAS summary gains section 3's progress (`ipas_summaries_for_sor`
  returns a `6` key).
- `_ipas_landed_cost` and a few other functions still list `checked` among the
  final statuses. It can no longer occur, so they are left alone.

# ADR 0050 — One S0 per SOR, locked after the first Stage

## Status

Accepted 2026-10-30, from the "One home for the S0" review (spec #800, ticket #815).

## Context

The S0 (the Sales Reference, Odoo's sale order number) was written from about six
places, each with its own checks. Only registration warned about duplicates, and
let you go ahead. On staging, 4 S0 numbers were each used by 2 live SORs. Nothing
checked that Odoo had the number. The S0 could change at any time, which left the
old S0's products as Removed from S0 with Requested Items and Tender Lines still
tied to them. Changes were not clearly recorded.

## Decision

- **One S0 per SOR that is not deleted.** This is the boss's rule: every project
  gets its own S0. Lost SORs count (a returning client's deal is reopened, not
  registered twice); deleted SORs do not (a mistake record must not hold an S0
  hostage). There is no bypass, for a Super Admin either.
- **The S0 locks after the first Stage.** Free to change or clear in the first
  Stage (Lead on the old pipeline). Past it, an empty S0 can be filled once, then
  it is locked. Existing deals past their first Stage lock as soon as this ships.
- **Only a Super Admin changes a Locked S0, with a reason.** Anyone who may edit
  the SOR today may change an open S0; no new permission.
- **Odoo must have the S0 when it is saved.** "Odoo has no S01237. Check the
  number." refuses it. If Odoo does not answer, the S0 is saved as Not checked.
- **One save step.** `set_sales_reference` is the only way the S0 changes after
  registration. The edge function reads Odoo and passes the facts in (ADR 0044
  pattern); the browser never sends them. Every set, change, clear and override
  is written to the deal's history with who, old S0, new S0 and reason.

## Consequences

- Existing duplicates are left as they are (prod is add and overwrite only). A
  later migration adds a unique rule on non-deleted SORs once none are left.
- A salesperson who typed the wrong S0 after the first Stage must ask a Super
  Admin. This is the point of the lock.
- Restoring a deleted SOR must run the same duplicate check (a later ticket).

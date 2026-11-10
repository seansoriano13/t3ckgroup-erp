# ADR 0041 — S0 lines keep Odoo's line id

## Status
Accepted (2026-11-04), spec #675, ticket #677.

## Context

Opening an SOR with a Sales Reference re-reads the S0 from Odoo. The save
deleted every product line and added them again, so every line got a new id on
every read. Anything that pointed at a line (a Tender Line, a Requested Item)
had to guess which new line was the old one: by Odoo product, else by name.
The guess is wrong when an SOR lists the same product twice, or after a
product is swapped in Odoo. "Refresh from the SOR" on the Costing Desk also
depends on the id: it adds a product only when no matrix line holds the SOR
line's id, so after any SOR save it would add every product again.

Odoo already has the stable thing: every sale order line has its own id.

## Decision

Each SOR product line stores the Odoo S0 line's id (`odoo_line_id`). The S0
lookup returns it. Every read of the S0 matches lines by that id:

- the same id updates the line in place (its id, and anything pointing at it,
  stays);
- a new id adds a line;
- a missing id marks the line `removed_from_s0` and keeps it. It shows as
  "Removed from S0" on the Product List and no longer counts toward Estimated
  Value.

An older line with no Odoo line id is matched once by Odoo product id, and
carries the line id from then on. A line typed by hand on an SOR with no S0
keeps the app's own id; if a save does not send it again, it is deleted, as
before. A line that is already as Odoo says is not written, so opening an SOR
that has not changed in Odoo writes nothing and logs nothing.

The database's separate "find the SOR line" rules (Tender Line, Requested
Item, and the Requested Item follow-the-SOR check; each by Odoo product, else
by name) become one: the fixed line id. A Tender Line's `sor_item_id` is a real
foreign key, and a Requested Item records the line it was picked from the same
way. A Component reaches its SOR line through its Tender Line.

`sor_replace_items` stays one SECURITY DEFINER call that locks the SOR first,
so two overlapping opens still never double the list.

## Consequences

- Links to a line stay true across SOR saves; the name and product-id guessing
  is gone from the database.
- A line the S0 dropped is never lost. A purchase that hangs off it stays
  visible, marked, until someone decides what it means.
- Existing links are backfilled once with the old rule when the migration runs.
  Lines with no Odoo product id (older SORs) cannot be matched to an Odoo line
  on their first read after this change; they are replaced once, and are stable
  from then on.

## Addendum (#727, spec #718)

A Tender Line now keeps the Odoo line id too (`costing_tender_lines.odoo_line_id`). "Refresh from the SOR" matches each S0 line to the line holding its Odoo line id, else an unlinked typed line with the same Odoo product, else adds a row. A similar name is only a suggestion that Sales confirms (`costing_s0_link_suggestions`, `costing_link_to_s0_line`); nothing links by name. Linking moves no money, so a Go lock lets it through; adding a new row does not pass the lock.

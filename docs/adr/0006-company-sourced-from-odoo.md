# Company is sourced from Odoo; Contact Person stays human

An SOR's **Company** and **Contact Person** were both free text, and about 9% of
live records (14 of 154) had them typed in backwards — the person in the Company
field, the agency in the Contact field. Since SOR already fetches an Odoo
quotation by Sales Reference to pull its product lines, that same lookup now
also returns the customer: `commercial_partner_id` (always the parent
organization) fills Company, and `partner_id` (the contact record) fills Contact
Person.

The two fields get **opposite trust rules**. Odoo overwrites Company
unconditionally — that is the field humans get wrong, and Odoo is the source of
truth for it. Odoo fills Contact Person **only when blank** — salespeople enrich
it with mobile numbers and working names ("Florence Junio- 09553829090", "Sir
Prado") that Odoo does not hold, and overwriting that would destroy information.

## Considered options

- **Renaming the `client_name` column to `company_name`.** Rejected. The column
  is read in ~30 places across services, exports, audit-log strings, and the
  commission dashboard. The confusion being fixed is a *label* confusion, so the
  rename is label-only: the UI says **Company** everywhere, the column stays
  `client_name`. A future reader seeing that divergence should not "fix" it.
- **Locking Company once Odoo resolves it.** Rejected. Roughly half of SORs are
  registered before any quotation exists (no Sales Reference at all), so Company
  must stay hand-typable. Verification is recorded instead: `odoo_partner_id`
  stores the Odoo partner behind the name, and is cleared the moment someone
  edits the name away from the fetched value — a stale verification flag is
  worse than none.

## Consequences

- A quotation that exists but has no product lines now returns `success: true`
  with an empty `items` array, so Company still autofills. Company verification
  and the product pull are separate jobs sharing one request.
- Autofill lives only in the SOR form modal (register and edit). The details
  modal's "refresh product list" actions deliberately do not touch Company —
  silently rewriting a saved record's customer is a surprise edit.

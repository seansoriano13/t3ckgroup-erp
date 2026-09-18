/**
 * Pure row-to-row PII scrubbing rules for the local seed dump (issue #87).
 *
 * Every function takes one row object (as read from Postgres) and returns a
 * new object with the sensitive fields replaced — no I/O, no database, so
 * these are tested without either. scripts/seed-dump.mjs and
 * scripts/seed-restore.mjs are the untested I/O shells around this module
 * and the Supabase CLI.
 *
 * `auth.users.encrypted_password` is deliberately NOT set here: it needs
 * pgcrypto's crypt(), which only exists inside a database. scripts/seed-restore.mjs
 * resets it with one SQL statement after inserting these rows, pairing every
 * local account with VITE_TEST_PASSWORD (see docs/adr/0011 and AGENTS.md).
 */

const SCRUBBED_REASON = "Sanitized for local development — see the staging record for the original."

// Employee emails are kept as-is (not client-facing PII in the sales tables'
// sense, and local Supabase auth email delivery routes to Mailpit, not real
// SMTP) so developers can log in locally with an employee's real email and
// VITE_TEST_PASSWORD.
export function sanitizeAuthUser(row) {
  return { ...row, phone: null }
}

export function sanitizeEmployee(row) {
  return { ...row }
}

/**
 * `sales_opportunities` carries exactly one personal-contact field —
 * `contact_person`, the client-side individual's name (`client_name` is the
 * client organization, not a person). The columns this rule scrubbed before
 * (`client_email`, `client_phone`, `contact_number`) don't exist on this
 * table; they were carried over from the removed scripts/sync-data.mjs
 * without checking them against the schema, which meant `contact_person` —
 * the real PII here — was never scrubbed.
 */
export function sanitizeSalesOpportunity(row) {
  return {
    ...row,
    contact_person: row.contact_person == null ? row.contact_person : "Sanitized Contact",
  }
}

/**
 * `odoo_retail_queue` names the client-side individual twice: the Odoo
 * order's person (`odoo_person_name`) and the Contact Person the queue
 * proposes for the SOR. Both get what `sales_opportunities.contact_person`
 * gets; the partner (company) name is an organization and stays.
 */
export function sanitizeRetailQueueRow(row) {
  return {
    ...row,
    odoo_person_name: row.odoo_person_name == null ? row.odoo_person_name : "Sanitized Contact",
    contact_person: row.contact_person == null ? row.contact_person : "Sanitized Contact",
  }
}

/**
 * Shared shape of `offset_leaves`, `sil_leaves`, `overtime_requests` and `undertime_requests`
 * (issue #87, resolved in the HR Document Center comment): the leave/overtime
 * record itself is what gets rendered to PDF at print time, so it — not a
 * separate documents table — is what carries the sensitive content.
 *
 * `verification_token` is deleted rather than nulled: the column has its own
 * random default, and some of these tables declare it NOT NULL, so an
 * explicit null would fail where a missing key (falling through to the
 * default) would not.
 *
 * `reasonRequired` matches `sil_leaves.reason NOT NULL` — pass it for that
 * table only. `offset_leaves.reason` and `overtime_requests.reason` are
 * nullable, but a previously non-null reason is still scrubbed to the same
 * placeholder rather than left in the clear.
 */
export function sanitizeLeaveRecord(row, { reasonRequired = false } = {}) {
  const out = {
    ...row,
    reason: reasonRequired || row.reason != null ? SCRUBBED_REASON : row.reason,
    hr_notes: row.hr_notes == null ? row.hr_notes : null,
    attachments: row.attachments == null ? row.attachments : [],
    application_hash: row.application_hash == null ? row.application_hash : null,
    approval_hash: row.approval_hash == null ? row.approval_hash : null,
    employee_signature_version: row.employee_signature_version == null ? row.employee_signature_version : null,
    hr_signature_version: row.hr_signature_version == null ? row.hr_signature_version : null,
  }
  delete out.verification_token
  return out
}

/** Table name -> sanitizer, for scripts/seed-dump.mjs to look up by name. */
export const SANITIZERS = {
  "auth.users": sanitizeAuthUser,
  employees: sanitizeEmployee,
  sales_opportunities: sanitizeSalesOpportunity,
  offset_leaves: (row) => sanitizeLeaveRecord(row, { reasonRequired: false }),
  sil_leaves: (row) => sanitizeLeaveRecord(row, { reasonRequired: true }),
  overtime_requests: (row) => sanitizeLeaveRecord(row, { reasonRequired: false }),
  undertime_requests: (row) => sanitizeLeaveRecord(row, { reasonRequired: false }),
  odoo_retail_queue: sanitizeRetailQueueRow,
}

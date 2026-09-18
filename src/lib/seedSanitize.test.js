import { describe, expect, it } from "vitest"
import {
  sanitizeAuthUser,
  sanitizeEmployee,
  sanitizeLeaveRecord,
  sanitizeRetailQueueRow,
  sanitizeSalesOpportunity,
  SANITIZERS,
} from "./seedSanitize"

describe("sanitizeAuthUser", () => {
  it("nulls phone but keeps the real email, so it can be used to log in locally", () => {
    const row = { id: "abc-123", email: "real.person@t3ckgroup.com", phone: "09171234567" }

    expect(sanitizeAuthUser(row)).toMatchObject({
      email: "real.person@t3ckgroup.com",
      phone: null,
    })
  })

  it("leaves every other column untouched", () => {
    const row = { id: "abc-123", email: "x@x.com", phone: null, raw_app_meta_data: { role: "admin" } }

    expect(sanitizeAuthUser(row).raw_app_meta_data).toEqual({ role: "admin" })
  })
})

describe("sanitizeEmployee", () => {
  it("keeps the real email address", () => {
    expect(sanitizeEmployee({ id: "e1", email: "real@t3ckgroup.com", name: "Real Person" })).toMatchObject({
      email: "real@t3ckgroup.com",
      name: "Real Person",
    })
  })
})

describe("sanitizeSalesOpportunity", () => {
  it("scrubs the client-side contact person, leaving the client organization's name alone", () => {
    const row = { id: "op1", contact_person: "Jane Buyer", client_name: "Some Agency" }

    expect(sanitizeSalesOpportunity(row)).toEqual({
      id: "op1",
      contact_person: "Sanitized Contact",
      client_name: "Some Agency",
    })
  })

  it("leaves an already-null contact person null", () => {
    const row = { id: "op2", contact_person: null }

    expect(sanitizeSalesOpportunity(row)).toEqual(row)
  })
})

describe("sanitizeLeaveRecord", () => {
  it("comes out content-free: reason, HR notes and attachments scrubbed, hashes and signature versions nulled", () => {
    const row = {
      id: "l1",
      reason: "Chemotherapy follow-up",
      hr_notes: "Approved verbally by HR head, see me before filing",
      attachments: [{ url: "https://cloudinary.example/medcert.pdf" }],
      application_hash: "abc123",
      approval_hash: "def456",
      employee_signature_version: 2,
      hr_signature_version: 1,
      verification_token: "tok_live_value",
      status: "APPROVED",
    }

    expect(sanitizeLeaveRecord(row)).toEqual({
      id: "l1",
      reason: "Sanitized for local development — see the staging record for the original.",
      hr_notes: null,
      attachments: [],
      application_hash: null,
      approval_hash: null,
      employee_signature_version: null,
      hr_signature_version: null,
      status: "APPROVED",
    })
  })

  it("deletes verification_token rather than nulling it, so the column's own default applies on insert", () => {
    const out = sanitizeLeaveRecord({ id: "l2", verification_token: "tok" })

    expect("verification_token" in out).toBe(false)
  })

  it("writes a placeholder into a NOT NULL reason column even when the source value happens to be null-ish", () => {
    const out = sanitizeLeaveRecord({ id: "l3", reason: null }, { reasonRequired: true })

    expect(out.reason).toBe("Sanitized for local development — see the staging record for the original.")
  })

  it("leaves a nullable reason null when it already was null", () => {
    const out = sanitizeLeaveRecord({ id: "l4", reason: null }, { reasonRequired: false })

    expect(out.reason).toBeNull()
  })

  it("leaves fields the rules don't cover untouched", () => {
    const out = sanitizeLeaveRecord({ id: "l5", start_date: "2026-01-01", days: 3 })

    expect(out).toMatchObject({ start_date: "2026-01-01", days: 3 })
  })
})

// Issue #199 — tables newly added to the seed get the same treatment as their
// existing counterparts.
describe("sanitizeRetailQueueRow", () => {
  it("scrubs the Odoo person name and the Contact Person, keeping the company", () => {
    const row = { id: "q1", odoo_partner_name: "Makati City Government", odoo_person_name: "Juan Dela Cruz", contact_person: "Juan Dela Cruz" }

    expect(sanitizeRetailQueueRow(row)).toEqual({
      id: "q1",
      odoo_partner_name: "Makati City Government",
      odoo_person_name: "Sanitized Contact",
      contact_person: "Sanitized Contact",
    })
  })

  it("leaves already-null names null", () => {
    const row = { id: "q2", odoo_person_name: null, contact_person: null }

    expect(sanitizeRetailQueueRow(row)).toEqual(row)
  })
})

describe("SANITIZERS for undertime requests", () => {
  it("scrubs an undertime request like an overtime request", () => {
    const row = { id: "u1", reason: "Doctor's appointment", hr_notes: "ok", attachments: ["x"], verification_token: "t" }

    const out = SANITIZERS.undertime_requests(row)

    expect(out).toEqual(SANITIZERS.overtime_requests(row))
    expect(out.reason).not.toBe("Doctor's appointment")
    expect(out).not.toHaveProperty("verification_token")
  })
})

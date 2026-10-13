import { describe, expect, it } from "vitest"
import { SIGNOFF_STATUS, sectionSignoffs, shapeSignoff, shapeSignoffs, signoffRights } from "./ipasSignoffs"

const row = (over = {}) => ({
  id: "s1",
  ipas_id: "i1",
  section: 1,
  role: "prepared",
  signed_by: "buyer",
  signer: { id: "buyer", name: "Buyer", avatar_path: null },
  signed_at: "2026-10-13T08:00:00Z",
  signature_declined: false,
  signature_version: null,
  cleared_at: null,
  cleared_by: null,
  cleared_reason: null,
  ...over,
})

describe("shaping sign-offs", () => {
  it("reads a row as the screens use it, tolerating a missing embed", () => {
    expect(shapeSignoff(row({ signature_version: "sig.png" }))).toMatchObject({
      section: 1,
      role: "prepared",
      signedBy: { id: "buyer", name: "Buyer" },
      signatureVersion: "sig.png",
      clearedAt: null,
    })
    expect(shapeSignoff(row({ signer: null })).signedBy).toEqual({ id: "buyer", name: null, avatarPath: null })
    expect(shapeSignoff(row({ signer: null, signed_by: null })).signedBy).toBeNull()
  })

  it("orders them oldest first", () => {
    const list = shapeSignoffs([row({ id: "b", signed_at: "2026-10-13T09:00:00Z" }), row({ id: "a" })])
    expect(list.map((s) => s.id)).toEqual(["a", "b"])
  })
})

describe("a section's state", () => {
  const signoffs = shapeSignoffs([
    row({ id: "p-old", signed_at: "2026-10-12T08:00:00Z", cleared_at: "2026-10-12T09:00:00Z", cleared_reason: "Sent back: x" }),
    row({ id: "p-new", signed_at: "2026-10-13T08:00:00Z" }),
    row({ id: "other", section: 3, signed_at: "2026-10-13T08:00:00Z" }),
  ])

  it("is not prepared, awaiting approval or approved from the live rows alone", () => {
    expect(sectionSignoffs([], 1).status).toBe(SIGNOFF_STATUS.NOT_PREPARED)
    expect(sectionSignoffs(signoffs, 1)).toMatchObject({ status: SIGNOFF_STATUS.AWAITING_APPROVAL, prepared: { id: "p-new" }, approved: null })
    const approved = shapeSignoffs([row(), row({ id: "a", role: "approved", signed_by: "boss", signer: null })])
    expect(sectionSignoffs(approved, 1).status).toBe(SIGNOFF_STATUS.APPROVED)
  })

  it("keeps the cleared rows as history, newest first, and never counts them as live", () => {
    const section = sectionSignoffs(signoffs, 1)
    expect(section.history.map((s) => s.id)).toEqual(["p-old"])
    const cleared = sectionSignoffs(shapeSignoffs([row({ cleared_at: "2026-10-13T09:00:00Z", cleared_reason: "PO changed in Odoo" })]), 1)
    expect(cleared.status).toBe(SIGNOFF_STATUS.NOT_PREPARED)
  })
})

describe("what the viewer is offered", () => {
  const lists = { s1_approved: [{ employeeId: "boss" }, { employeeId: "buyer" }], s3_approved: [{ employeeId: "boss" }] }
  const prepared = sectionSignoffs(shapeSignoffs([row()]), 1)
  const empty = sectionSignoffs([], 1)
  const approved = sectionSignoffs(shapeSignoffs([row(), row({ id: "a", role: "approved", signed_by: "boss", signer: null })]), 1)
  const rights = (over) => signoffRights({ section: 1, sectionState: empty, userId: "x", lists, ipasState: "open", ...over })

  it("offers Prepare to Purchasing access on an open, unprepared section only", () => {
    expect(rights({ hasPurchasingFlow: true }).canPrepare).toBe(true)
    expect(rights({ hasPurchasingFlow: false }).canPrepare).toBe(false)
    expect(rights({ hasPurchasingFlow: true, sectionState: prepared }).canPrepare).toBe(false)
    expect(rights({ hasPurchasingFlow: true, ipasState: "filed" }).canPrepare).toBe(false)
    expect(rights({ hasPurchasingFlow: true, ipasState: "cancelled" }).canPrepare).toBe(false)
  })

  it("offers Approve to a list member who isn't the preparer, after Prepared", () => {
    expect(rights({ userId: "boss", sectionState: prepared })).toMatchObject({ canApprove: true, whyNotApprove: null })
    expect(rights({ userId: "buyer", sectionState: prepared })).toMatchObject({ canApprove: false, whyNotApprove: "preparer" })
    expect(rights({ userId: "x", sectionState: prepared })).toMatchObject({ canApprove: false, whyNotApprove: "not_on_list" })
    expect(rights({ userId: "boss", sectionState: empty })).toMatchObject({ canApprove: false, whyNotApprove: "not_prepared" })
    expect(rights({ userId: "boss", sectionState: approved })).toMatchObject({ canApprove: false, whyNotApprove: "approved" })
    expect(rights({ userId: "boss", sectionState: prepared, ipasState: "filed" }).canApprove).toBe(false)
  })

  it("uses the section's own list", () => {
    const three = sectionSignoffs(shapeSignoffs([row({ section: 3 })]), 3)
    expect(rights({ section: 3, userId: "buyer", sectionState: three }).onList).toBe(false)
    expect(rights({ section: 3, userId: "boss", sectionState: three }).canApprove).toBe(true)
  })

  it("offers Send back to a list member when something is signed", () => {
    expect(rights({ userId: "boss", sectionState: prepared }).canSendBack).toBe(true)
    expect(rights({ userId: "boss", sectionState: approved }).canSendBack).toBe(true)
    expect(rights({ userId: "boss", sectionState: empty }).canSendBack).toBe(false)
    expect(rights({ userId: "x", sectionState: prepared }).canSendBack).toBe(false)
    expect(rights({ userId: "boss", sectionState: prepared, ipasState: "filed" }).canSendBack).toBe(false)
  })

  it("reads missing lists and a missing user as nobody", () => {
    expect(rights({ lists: undefined, userId: "boss", sectionState: prepared }).canApprove).toBe(false)
    expect(rights({ userId: null, sectionState: prepared }).onList).toBe(false)
  })
})

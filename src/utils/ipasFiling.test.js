import { describe, expect, it } from "vitest"
import { requiredDocuments, shapeDocuments, unfiledRequiredDocuments } from "./ipasDocuments"
import {
  FILING_STATUS,
  isLandedCostFinal,
  section7Rights,
  section7Signoffs,
  shapeSignoffs,
} from "./ipasSignoffs"

/**
 * Section 7 and Filing (#248), the pure parts: what Filing expects of the
 * documents, where section 7 stands from its sign-offs, and what each person is
 * offered. The database decides every one of these; these only spare people a
 * button that would fail and say why.
 */

const kind = (id, label, applies_to, used_for, over = {}) => ({
  id, list: "document_kind", label, applies_to, used_for, sort: 0, active: true, ...over,
})

const OPTIONS = [
  kind("k1", "Quotation (Local)", "local", "documentation", { sort: 10 }),
  kind("k2", "BL or Waybill", "import", "both", { sort: 20 }),
  kind("k3", "BIR 2307", "both", "filing", { sort: 30 }),
]

describe("what Filing expects of the documents", () => {
  const rows = [
    { id: "d1", kind_id: "k1", purchasing_has: false, finance_has: false },
    { id: "d2", kind_id: "k2", purchasing_has: false, finance_has: false },
    { id: "d3", kind_id: "k3", purchasing_has: false, finance_has: true },
    { id: "d4", kind_id: null, label: "Memo", purchasing_has: false, finance_has: false },
  ]
  const docs = shapeDocuments(rows, OPTIONS)

  it("is the kind rows matching the Source, whatever they are used for, hand-added ones left out", () => {
    expect(requiredDocuments(docs, "import").map((d) => d.label).sort()).toEqual(["BIR 2307", "BL or Waybill"])
    expect(requiredDocuments(docs, "local").map((d) => d.label).sort()).toEqual(["BIR 2307", "Quotation (Local)"])
  })

  it("warns about the unticked ones with a label and nothing else", () => {
    expect(unfiledRequiredDocuments(docs, "import")).toEqual([
      { id: "d2", label: "BL or Waybill", usedFor: "both", appliesTo: "import" },
    ])
    expect(unfiledRequiredDocuments(docs, "local")).toEqual([
      { id: "d1", label: "Quotation (Local)", usedFor: "documentation", appliesTo: "local" },
    ])
  })

  it("counts either department's tick, and reads no rows as nothing to warn about", () => {
    const ticked = shapeDocuments(rows.map((r) => ({ ...r, purchasing_has: true })), OPTIONS)
    expect(unfiledRequiredDocuments(ticked, "import")).toEqual([])
    expect(unfiledRequiredDocuments([], "import")).toEqual([])
    expect(unfiledRequiredDocuments(undefined, "import")).toEqual([])
  })
})

const row = (over = {}) => ({
  id: "s",
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

describe("section 7", () => {
  const at = (n) => `2026-10-13T0${n}:00:00Z`
  const give = (section, role, by, n, over = {}) =>
    row({
      id: `${section}${role}${by}${n}`,
      section,
      role,
      signed_by: by,
      signer: { id: by, name: by, avatar_path: null },
      signed_at: at(n),
      ...over,
    })
  const firstSections = [
    give(1, "prepared", "buyer", 1),
    give(1, "approved", "boss", 2),
    give(3, "prepared", "buyer", 1),
    give(3, "approved", "boss", 2),
    give(6, "prepared", "buyer", 1),
    give(6, "approved", "boss", 2),
    give(8, "approved", "grace", 2),
  ]
  const shaped = (...rows) => shapeSignoffs(rows)
  const LISTS = {
    s7_received: [{ employeeId: "rec" }],
    s7_noted: [{ employeeId: "note" }],
    s7_checked: [{ employeeId: "check" }],
    s7_approved: [{ employeeId: "boss" }],
  }

  it("waits for sections 1 and 3, then opens for Received", () => {
    expect(section7Signoffs(shaped())).toMatchObject({ status: FILING_STATUS.WAITING, opened: false, next: [] })
    expect(section7Signoffs(shaped(firstSections[0], firstSections[1]))).toMatchObject({ opened: false, next: [] })
    expect(section7Signoffs(shaped(...firstSections))).toMatchObject({
      status: FILING_STATUS.READY,
      opened: true,
      next: ["received"],
    })
  })

  it("stays closed until section 3 is approved too, even with sections 1 and 2 approved (#590)", () => {
    const withoutSection3 = firstSections.slice(0, 4)
    expect(section7Signoffs(shaped(...withoutSection3))).toMatchObject({
      status: FILING_STATUS.WAITING,
      opened: false,
      next: [],
    })
    // A section 3 that is only submitted does not open it either.
    expect(section7Signoffs(shaped(...withoutSection3, firstSections[4]))).toMatchObject({ opened: false, next: [] })
  })

  it("keeps sign-offs already given while it is closed, and offers nothing more (#590)", () => {
    const closed = section7Signoffs(shaped(...firstSections.slice(0, 4), give(7, "received", "rec", 3), give(7, "noted", "note", 4)))
    expect(closed.received).not.toBeNull()
    expect(closed.noted).not.toBeNull()
    expect(closed).toMatchObject({ opened: false, next: [], status: FILING_STATUS.WAITING })
  })

  it("takes Noted and Checked in either order, then Approved", () => {
    const state = (...more) => section7Signoffs(shaped(...firstSections, ...more))
    const received = give(7, "received", "rec", 3)
    expect(state(received)).toMatchObject({ status: FILING_STATUS.IN_PROGRESS, next: ["noted", "checked"] })
    expect(state(received, give(7, "checked", "check", 4)).next).toEqual(["noted"])
    expect(state(received, give(7, "noted", "note", 4)).next).toEqual(["checked"])
    const three = state(received, give(7, "noted", "note", 4), give(7, "checked", "check", 5))
    expect(three.next).toEqual(["approved"])
    const filed = state(
      received,
      give(7, "noted", "note", 4),
      give(7, "checked", "check", 5),
      give(7, "approved", "boss", 6),
    )
    expect(filed).toMatchObject({ status: FILING_STATUS.FILED, next: [] })
    expect(filed.approved.signedBy.id).toBe("boss")
  })

  it("closes again when an approval of section 1 or 3 is cleared, and keeps cleared ones as history", () => {
    const cleared = give(1, "approved", "boss", 2, { cleared_at: at(7), cleared_reason: "PO changed in Odoo" })
    const closed = section7Signoffs(
      shaped(firstSections[0], cleared, firstSections[2], firstSections[3], give(7, "received", "rec", 3)),
    )
    expect(closed).toMatchObject({ opened: false, next: [], status: FILING_STATUS.WAITING })
    expect(closed.received).not.toBeNull()

    // A reopening clears section 7: the cleared ones are history, newest first.
    const reopened = section7Signoffs(
      shaped(
        ...firstSections,
        give(7, "received", "rec", 3, { cleared_at: at(8), cleared_reason: "Reopened: x" }),
        give(7, "noted", "note", 4, { cleared_at: at(9), cleared_reason: "Reopened: x" }),
      ),
    )
    expect(reopened.received).toBeNull()
    expect(reopened.history.map((h) => h.role)).toEqual(["noted", "received"])
    expect(reopened.next).toEqual(["received"])
  })

  describe("rights", () => {
    const rights = (over = {}) =>
      section7Rights({
        state: section7Signoffs(shaped(...firstSections)),
        userId: "rec",
        lists: LISTS,
        ipasState: "open",
        costsComplete: true,
        ...over,
      })

    it("offers Received to its list once section 7 has opened, and nothing else yet", () => {
      expect(rights().received).toEqual({ canGive: true, why: null })
      expect(rights().noted).toEqual({ canGive: false, why: "needs_received" })
      expect(rights({ userId: "note" }).noted).toEqual({ canGive: false, why: "needs_received" })
      expect(rights({ userId: "boss" }).received).toEqual({ canGive: false, why: "not_on_list" })
    })

    it("says why before sections 1 and 3 are approved, and when the IPAS isn't open", () => {
      const closed = section7Signoffs(shaped())
      expect(rights({ state: closed }).received.why).toBe("sections_not_approved")
      expect(rights({ ipasState: "filed" }).received.why).toBe("not_open")
      expect(rights({ ipasState: "cancelled" }).received.canGive).toBe(false)
    })

    it("holds Approved for all three and for Costs complete", () => {
      const received = give(7, "received", "rec", 3)
      const noted = give(7, "noted", "note", 4)
      const checked = give(7, "checked", "check", 5)
      const two = section7Signoffs(shaped(...firstSections, received, noted))
      expect(rights({ state: two, userId: "boss" }).approved.why).toBe("needs_all_three")
      const three = section7Signoffs(shaped(...firstSections, received, noted, checked))
      expect(rights({ state: three, userId: "boss" }).approved).toEqual({ canGive: true, why: null })
      expect(rights({ state: three, userId: "boss", costsComplete: false }).approved.why).toBe("costs_incomplete")
      expect(rights({ state: three, userId: "rec" }).approved.why).toBe("not_on_list")
      expect(rights({ state: three, userId: "boss" }).received.why).toBe("given")
    })

    it("reads missing lists and a missing user as nobody", () => {
      expect(rights({ lists: undefined }).received.why).toBe("not_on_list")
      expect(rights({ userId: null }).received.canGive).toBe(false)
    })
  })

  it("knows LC Odoo Done, the last status", () => {
    expect(["encoding", "encoded", "lc_gs_done"].map(isLandedCostFinal)).toEqual([false, false, false])
    expect(isLandedCostFinal("lc_odoo_done")).toBe(true)
    expect(isLandedCostFinal(undefined)).toBe(false)
  })
})

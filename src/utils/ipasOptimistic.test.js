import { describe, expect, it } from "vitest"

import { shapeIpas } from "./ipas"
import { canSetComputationStatus, signoffRights } from "./ipasSignoffs"
import * as edit from "./ipasOptimistic"

const OPTION = { id: "m1", list: "payment_method", label: "Alipay", active: true, sort: 1 }
const DOC_KIND = { id: "k1", list: "document_kind", label: "Waybill", active: true, sort: 1, applies_to: "both", used_for: "filing" }

const row = {
  id: "i1",
  number: "TGIPAS_001",
  po_number: "P01",
  state: "open",
  source: "local",
  purpose: "inventory",
  priority: "normal",
  created_at: "2026-10-14T00:00:00Z",
  odoo_copy: { po: { currency: "Php" }, supplier: { name: "Scorpe" }, lines: [] },
  computation_status: "encoding",
}

function cached(over = {}) {
  const raw = edit.rawOf({
    row: { ...row, ...over.row },
    sors: [],
    payments: over.payments ?? [],
    charges: over.charges ?? [],
    documents: over.documents ?? [{ id: "d1", ipas_id: "i1", kind_id: "k1", label: null, purchasing_has: false, finance_has: false, attachment_url: null }],
    options: [OPTION, DOC_KIND],
    signoffs: over.signoffs ?? [],
  })
  return {
    ...shapeIpas(raw.row, raw.sors, raw),
    options: raw.options,
    events: [],
    bankDetails: null,
    raw,
  }
}

const by = { id: "u1", name: "Ana", avatarPath: null }

describe("reshapeIpas", () => {
  it("leaves a cache with no raw rows as it was", () => {
    const bare = { id: "i1" }
    expect(edit.reshapeIpas(bare, edit.setRow({ pi_number: "X" }))).toBe(bare)
    expect(edit.reshapeIpas(undefined, edit.setRow({}))).toBeUndefined()
  })

  it("shapes again, so a typed value reads exactly as the server's copy will", () => {
    const next = edit.reshapeIpas(cached(), edit.setRow(edit.headerColumns({ supplierContact: "  Ben  ", piNumber: "PI-9", piQtAmount: "1,250.50" })))
    expect(next.contact).toBe("Ben")
    expect(next.piNumber).toBe("PI-9")
    expect(next.piQtAmount).toBe(1250.5)
    expect(next.raw.row.supplier_contact).toBe("Ben")
  })

  it("moves the computation status and the Landed Cost mark with it", () => {
    const next = edit.reshapeIpas(cached(), edit.setRow({ computation_status: "lc_odoo_done" }))
    expect(next.computationStatus).toBe("lc_odoo_done")
  })
})

describe("documents", () => {
  it("ticks one side and the other stays", () => {
    const next = edit.reshapeIpas(cached(), edit.tickDocument("d1", "finance", true))
    expect(next.documents[0]).toMatchObject({ financeHas: true, purchasingHas: false, ticked: true })
  })

  it("attaches and removes a file, and removes a row", () => {
    const attached = edit.reshapeIpas(cached(), edit.attachDocument("d1", " https://x/y.pdf "))
    expect(attached.documents[0].attachmentUrl).toBe("https://x/y.pdf")
    expect(edit.reshapeIpas(attached, edit.attachDocument("d1", "")).documents[0].attachmentUrl).toBeNull()
    expect(edit.reshapeIpas(cached(), edit.removeDocument("d1")).documents).toEqual([])
  })

  it("adds a document by hand, with both ticks empty", () => {
    const next = edit.reshapeIpas(cached(), edit.addDocument({ label: " Warranty card ", ipasId: "i1" }))
    const added = next.documents.find((d) => d.byHand)
    expect(added).toMatchObject({ label: "Warranty card", purchasingHas: false, financeHas: false })
    expect(String(added.id)).toMatch(/^optimistic-/)
  })
})

describe("payments and charges", () => {
  const values = { kind: "payment", paidOn: "2026-10-14", amount: "1,000", phpDebited: "", chargeFeePhp: "", methodId: "m1", checkNo: "", proofUrl: "" }

  it("shows a new payment at once, and a changed one in place", () => {
    const added = edit.reshapeIpas(cached(), edit.savePayment({ values, isPhpPo: true, ipasId: "i1", by }))
    expect(added.payments).toHaveLength(1)
    expect(added.payments[0]).toMatchObject({ amount: 1000, method_id: "m1" })
    expect(added.paymentSummary.count).toBe(1)

    const id = added.payments[0].id
    const changed = edit.reshapeIpas(added, edit.savePayment({ paymentId: id, values: { ...values, amount: "250" }, isPhpPo: true, ipasId: "i1", by }))
    expect(changed.payments).toHaveLength(1)
    expect(changed.payments[0].amount).toBe(250)

    expect(edit.reshapeIpas(changed, edit.removePayment(id)).payments).toEqual([])
  })

  it("shows a new charge at once", () => {
    const next = edit.reshapeIpas(cached(), edit.saveCharge({ values: { kindId: "c1", chargedOn: "2026-10-14", amountPhp: "600" }, ipasId: "i1", by }))
    expect(next.charges).toHaveLength(1)
    expect(next.charges[0]).toMatchObject({ amount_php: 600, kind_id: "c1" })
  })
})

describe("sign-offs", () => {
  it("gives a sign-off as the viewer, live, and a Return clears Prepared and Approved with the reason", () => {
    let c = edit.reshapeIpas(cached(), edit.giveSignoff({ section: 1, role: "prepared", by, ipasId: "i1" }))
    expect(c.signoffSections[1]).toMatchObject({ status: "awaiting_approval", prepared: { signedBy: { name: "Ana" } } })

    c = edit.reshapeIpas(c, edit.giveSignoff({ section: 1, role: "approved", by: { id: "u2", name: "Ben" }, ipasId: "i1" }))
    expect(c.signoffSections[1].status).toBe("approved")

    const returned = edit.reshapeIpas(c, edit.returnSection({ section: 1, by, reason: "Wrong supplier" }))
    expect(returned.signoffSections[1].status).toBe("not_prepared")
    expect(returned.signoffSections[1].history.map((s) => s.clearedReason)).toEqual([
      "Returned: Wrong supplier",
      "Returned: Wrong supplier",
    ])
  })

  it("an Undo approval leaves Prepared", () => {
    let c = edit.reshapeIpas(cached(), edit.giveSignoff({ section: 3, role: "prepared", by, ipasId: "i1" }))
    c = edit.reshapeIpas(c, edit.giveSignoff({ section: 3, role: "approved", by: { id: "u2", name: "Ben" }, ipasId: "i1" }))
    const undone = edit.reshapeIpas(c, edit.returnSection({ section: 3, undo: true, by, reason: "Too fast" }))
    expect(undone.signoffSections[3]).toMatchObject({ status: "awaiting_approval", approved: null })
    expect(undone.signoffSections[3].history[0].clearedReason).toBe("Approval undone: Too fast")
  })

  it("a Return of section 1 or 3 clears section 4's open sign-offs too, but section 4's own Return leaves 1 and 3", () => {
    let c = cached()
    for (const [section, role] of [[1, "prepared"], [1, "approved"], [3, "prepared"], [3, "approved"], [7, "received"], [7, "noted"]]) {
      c = edit.reshapeIpas(c, edit.giveSignoff({ section, role, by, ipasId: "i1" }))
    }
    const fromOne = edit.reshapeIpas(c, edit.returnSection({ section: 1, by, reason: "x" }))
    expect(fromOne.signoffSections[7].received).toBeNull()
    expect(fromOne.signoffSections[7].noted).toBeNull()
    expect(fromOne.signoffSections[3].status).toBe("approved")

    const fromSeven = edit.reshapeIpas(c, edit.returnSection({ section: 7, by, reason: "y" }))
    expect(fromSeven.signoffSections[7].received).toBeNull()
    expect(fromSeven.signoffSections[1].status).toBe("approved")
    expect(fromSeven.signoffSections[3].status).toBe("approved")
  })
})

describe("typed dates, the stamp and bank details", () => {
  it("types and clears a buyer-track date, with who typed it", () => {
    const typed = edit.reshapeIpas(cached({ row: { source: "import" } }), edit.setTypedStatus({ status: "delivered", date: "2026-10-20", by }))
    const delivered = typed.buyerTrack.find((item) => item.key === "delivered")
    expect(delivered).toMatchObject({ ticked: true, on: "2026-10-20", by: { name: "Ana" } })
    const cleared = edit.reshapeIpas(typed, edit.setTypedStatus({ status: "delivered", date: "", by }))
    expect(cleared.buyerTrack.find((item) => item.key === "delivered").ticked).toBe(false)
  })

  it("stamps Actual Checking and clears it", () => {
    const stamped = edit.reshapeIpas(cached(), edit.stampActualChecking({ stamped: true, by }))
    expect(stamped.buyerTrack.find((item) => item.key === "actual_checking")).toMatchObject({ ticked: true, by: { name: "Ana" } })
    const cleared = edit.reshapeIpas(stamped, edit.stampActualChecking({ stamped: false, by }))
    expect(cleared.buyerTrack.find((item) => item.key === "actual_checking").ticked).toBe(false)
  })

  it("shows bank details typed, keeping the flag the database set", () => {
    const base = { ...cached(), bankDetails: { bankName: "BDO", accountName: "A", accountNumber: "1", flagged: true, updatedAt: "t" } }
    const next = edit.withBankDetails(base, { bankName: " BPI ", accountName: "", accountNumber: "22" })
    expect(next.bankDetails).toEqual({ bankName: "BPI", accountName: null, accountNumber: "22", flagged: true, updatedAt: "t" })
  })
})

describe("what the viewer may return, and who may check", () => {
  const section = (over = {}) => ({
    section: 1,
    sectionState: { prepared: { signedBy: { id: "buyer" } }, approved: null, ...over },
    userId: "boss",
    hasPurchasingFlow: false,
    lists: { s1_approved: [{ employeeId: "boss" }] },
    ipasState: "open",
  })

  it("is Return while prepared, Undo approval once approved, and nothing off the list", () => {
    expect(signoffRights(section()).returnMode).toBe("return")
    expect(signoffRights(section({ approved: { signedBy: { id: "other" } } })).returnMode).toBe("undo")
    expect(signoffRights({ ...section(), lists: {} }).returnMode).toBeNull()
    expect(signoffRights(section({ prepared: null })).returnMode).toBeNull()
    expect(signoffRights({ ...section(), ipasState: "filed" }).returnMode).toBeNull()
  })

  it("lets Purchasing step up to LC Odoo Done and Finance or a Super Admin only Checked by", () => {
    const base = { from: "lc_odoo_done", to: "checked" }
    expect(canSetComputationStatus({ ...base, hasPurchasingFlow: true })).toBe(false)
    expect(canSetComputationStatus({ from: "checked", to: "lc_odoo_done", hasPurchasingFlow: true })).toBe(false)
    expect(canSetComputationStatus({ ...base, hasPurchasingFlow: true, isSuperAdmin: true })).toBe(false)
    expect(canSetComputationStatus({ ...base, hasPurchasingFlow: true, hasFinanceFlow: true })).toBe(false)
    expect(canSetComputationStatus({ from: "lc_gs_done", to: "lc_odoo_done", hasPurchasingFlow: true })).toBe(true)
    expect(canSetComputationStatus({ from: "encoding", to: "encoded", hasPurchasingFlow: true })).toBe(true)
    expect(canSetComputationStatus({ ...base, hasFinanceFlow: true })).toBe(true)
    expect(canSetComputationStatus({ ...base, isSuperAdmin: true })).toBe(true)
    expect(canSetComputationStatus({ from: "checked", to: "lc_odoo_done", hasFinanceFlow: true })).toBe(true)
    expect(canSetComputationStatus({ from: "encoded", to: "lc_gs_done", hasFinanceFlow: true })).toBe(false)
    expect(canSetComputationStatus({ ...base })).toBe(false)
  })
})

import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db, updateRow } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_ERROR, IPAS_NOTIFICATION, IPAS_SIGNER_LISTS } from "@/constants/ipas"

/**
 * IPAS sections 1 and 3 sign-offs (#247) through the service, against the fake
 * database with the RPCs re-implemented on its store and Odoo stubbed. The
 * database's own rules (who may sign, the real lock and uniqueness) are the
 * policy tier's (61-ipas-signoffs); what is proven here is the wiring: what
 * `get` reads back, who is notified of each step, the Approval Center queue,
 * the signer lists, and that only an Odoo change or a flagged Account # undoes
 * an approval.
 */

const line = (id, quantity = 2, unitPrice = 100) => ({
  line_id: id,
  product_id: id * 10,
  name: `Item ${id}`,
  quantity,
  unit: "Unit",
  price_unit: unitPrice,
  price_subtotal: quantity * unitPrice,
  taxes: [],
  analytic: [],
  brand: null,
})

const odooPo = ({ name, supplierId = 553, lines = [line(1)] }) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: supplierId, name: "Scorpe Technologies", contact: null },
  lines,
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

describe("ipasService: sections 1 and 3 sign-offs", () => {
  let buyer, approver, otherApprover, bystander, superAdmin, options

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    approver = makeEmployee({ name: "Boss Lito" })
    otherApprover = makeEmployee({ name: "Co Approver" })
    bystander = makeEmployee({ name: "Bystander" })
    superAdmin = makeEmployee({ name: "Super Admin", is_super_admin: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    stubIpasRpcs({ actorId: buyer.id })
  })

  /** Calls the service as someone else (the stub's identity is the signed-in actor). */
  const as = (person, opts = {}) => stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts })

  const addToList = (listKey, ...people) => {
    for (const person of people) db.seed("ipas_signer_lists", { list_key: listKey, employee_id: person.id })
  }

  let poSeq = 0
  async function raise({ supplierId = 553, lines } = {}) {
    const poNumber = `P0${3000 + (poSeq += 1)}`
    stubEdgeFunction("odoo-po-ipas", odooPo({ name: poNumber, supplierId, lines }))
    return ipasService.create({ poNumber, priority: "high", source: "local", purpose: "inventory" })
  }

  const read = (id) => ipasService.get(id, { refresh: false })
  const live = () => db.rows("ipas_signoffs").filter((s) => !s.cleared_at).map((s) => `${s.section}/${s.role}`).sort()
  const sent = (type) => db.rows("notifications").filter((n) => n.type === type)
  const events = (...kinds) => db.rows("ipas_events").filter((e) => !kinds.length || kinds.includes(e.kind))

  describe("Prepared, then Approved", () => {
    it("works for sections 1 and 3, and get reads each section's state back", async () => {
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      const ipas = await raise()
      expect((await read(ipas.id)).signoffSections[1].status).toBe("not_prepared")

      const prepared = await ipasService.sign(ipas.id, 1, "prepared")
      expect(prepared.signoff).toMatchObject({ section: 1, role: "prepared", signedBy: { id: buyer.id } })
      expect((await read(ipas.id)).signoffSections[1].status).toBe("awaiting_approval")
      expect((await read(ipas.id)).signoffSections[3].status).toBe("not_prepared")

      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")

      const opened = await read(ipas.id)
      expect(opened.signoffSections[1]).toMatchObject({ status: "approved" })
      expect(opened.signoffSections[1].approved.signedBy).toMatchObject({ id: approver.id, name: "Boss Lito" })
      expect(opened.signoffSections[3].status).toBe("approved")
      expect(live()).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared"])
      expect(events("signed").map((e) => `${e.detail.section}/${e.detail.role}`)).toEqual([
        "1/prepared", "3/prepared", "1/approved", "3/approved",
      ])
    })

    it("refuses the preparer, even on the list", async () => {
      addToList("s1_approved", buyer)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")

      await expect(ipasService.sign(ipas.id, 1, "approved")).rejects.toMatchObject({ code: "42501" })

      expect(live()).toEqual(["1/prepared"])
    })

    it("refuses someone off the list, a Super Admin included, until they are put on it", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")

      as(superAdmin)
      await expect(ipasService.sign(ipas.id, 1, "approved")).rejects.toMatchObject({ code: "42501" })
      as(bystander)
      await expect(ipasService.sign(ipas.id, 1, "approved")).rejects.toMatchObject({ code: "42501" })
      expect(live()).toEqual(["1/prepared"])

      as(superAdmin, { superAdmin: true })
      await ipasService.setSignerList("s1_approved", [approver.id, superAdmin.id])
      await ipasService.sign(ipas.id, 1, "approved")
      expect(live()).toEqual(["1/approved", "1/prepared"])
    })

    it("refuses Prepared without Purchasing access, and Approved before Prepared", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()

      as(bystander)
      await expect(ipasService.sign(ipas.id, 1, "prepared")).rejects.toMatchObject({ code: "42501" })
      as(approver)
      await expect(ipasService.sign(ipas.id, 1, "approved")).rejects.toMatchObject({ code: "55000" })
      expect(live()).toEqual([])
    })

    it("can sign without the stored signature", async () => {
      const ipas = await raise()
      const out = await ipasService.sign(ipas.id, 1, "prepared", { declineSignature: true })
      expect(out.signoff).toMatchObject({ signatureDeclined: true, signatureVersion: null })
    })

    it("only takes the sections and roles of the sheet, before asking the database", async () => {
      const ipas = await raise()
      for (const [section, role] of [[2, "prepared"], [7, "prepared"], [1, "received"], [3, "noted"], [1, undefined], [7, undefined]]) {
        await expect(ipasService.sign(ipas.id, section, role), `${section}/${role}`).rejects.toMatchObject({
          code: IPAS_ERROR.INVALID,
        })
      }
      for (const section of [2, 4, undefined]) {
        await expect(ipasService.sendBack(ipas.id, section, "x"), `send back ${section}`).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      }
      expect(events("signed", "sent_back")).toEqual([])
    })
  })

  describe("notifications", () => {
    it("Prepared notifies exactly that section's approval list, and not the preparer", async () => {
      addToList("s1_approved", approver, otherApprover, buyer)
      addToList("s3_approved", otherApprover, bystander)
      const ipas = await raise()

      const one = await ipasService.sign(ipas.id, 1, "prepared")
      await waitForNetworkIdle()

      expect(one.notified).toBe(2)
      const first = sent(IPAS_NOTIFICATION.SIGNOFF_READY)
      expect(first.map((n) => n.recipient_id).sort()).toEqual([approver.id, otherApprover.id].sort())
      expect(first[0]).toMatchObject({ reference_id: ipas.id, sender_id: buyer.id })
      expect(first[0].message).toContain(ipas.number)
      expect(first[0].message).toContain("section 1")

      await ipasService.sign(ipas.id, 3, "prepared")
      await waitForNetworkIdle()
      const all = sent(IPAS_NOTIFICATION.SIGNOFF_READY)
      expect(all).toHaveLength(4)
      expect(all.slice(2).map((n) => n.recipient_id).sort()).toEqual([bystander.id, otherApprover.id].sort())
    })

    it("tells nobody when the section's list is empty, and doesn't tell anyone for an approval", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      const prepared = await ipasService.sign(ipas.id, 3, "prepared")
      await waitForNetworkIdle()
      expect(prepared.notified).toBe(0)
      expect(sent(IPAS_NOTIFICATION.SIGNOFF_READY)).toEqual([])

      await ipasService.sign(ipas.id, 1, "prepared")
      await waitForNetworkIdle()
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await waitForNetworkIdle()
      expect(sent(IPAS_NOTIFICATION.SIGNOFF_READY)).toHaveLength(1)
    })

    it("never writes money or bank details into a notification", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      await ipasService.setBankDetails(ipas.id, { bankName: "BDO", accountName: "Scorpe", accountNumber: "5550001111" })
      await ipasService.sign(ipas.id, 1, "prepared")
      await waitForNetworkIdle()
      expect(JSON.stringify(db.rows("notifications"))).not.toMatch(/5550001111|BDO|7,?500/)
    })
  })

  describe("sending back", () => {
    async function approvedSections() {
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      return ipas
    }

    it("needs a reason", async () => {
      const ipas = await approvedSections()
      for (const reason of ["", "   ", undefined]) {
        await expect(ipasService.sendBack(ipas.id, 1, reason)).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      }
      expect(live()).toHaveLength(4)
    })

    it("clears that section's Prepared and Approved, keeps them as history, and notifies the preparer with the reason", async () => {
      const ipas = await approvedSections()

      const out = await ipasService.sendBack(ipas.id, 1, "  Supplier is wrong ")
      await waitForNetworkIdle()

      expect(out).toMatchObject({ clearedRoles: ["approved", "prepared"], notified: 1 })
      expect(live()).toEqual(["3/approved", "3/prepared"])

      const opened = await read(ipas.id)
      expect(opened.signoffSections[1].status).toBe("not_prepared")
      expect(opened.signoffSections[1].history.map((s) => [s.role, s.clearedReason])).toEqual(
        expect.arrayContaining([
          ["prepared", "Returned: Supplier is wrong"],
          ["approved", "Returned: Supplier is wrong"],
        ]),
      )
      expect(opened.signoffSections[1].history[0].clearedBy).toMatchObject({ id: approver.id })
      expect(events("sent_back")[0].detail).toMatchObject({ section: 1, reason: "Supplier is wrong" })

      const notices = sent(IPAS_NOTIFICATION.SENT_BACK)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ recipient_id: buyer.id, reference_id: ipas.id, sender_id: approver.id })
      expect(notices[0].message).toContain("Supplier is wrong")
      expect(notices[0].message).toContain(ipas.number)
    })

    it("is for a signer of the section: a Super Admin off the list and the purchaser are refused", async () => {
      const ipas = await approvedSections()
      as(superAdmin)
      await expect(ipasService.sendBack(ipas.id, 1, "No")).rejects.toMatchObject({ code: "42501" })
      as(buyer)
      await expect(ipasService.sendBack(ipas.id, 1, "No")).rejects.toMatchObject({ code: "42501" })
      expect(live()).toHaveLength(4)
    })

    it("refuses a section with nothing signed, and lets the section be prepared again", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      as(approver)
      await expect(ipasService.sendBack(ipas.id, 1, "Nothing")).rejects.toMatchObject({ code: "55000" })

      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      as(approver)
      await ipasService.sendBack(ipas.id, 1, "Attach the quotation")
      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      expect(live()).toEqual(["1/prepared"])
    })

    it("doesn't tell a preparer who sent it back themselves", async () => {
      addToList("s1_approved", buyer)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")

      const out = await ipasService.sendBack(ipas.id, 1, "Changed my mind")
      await waitForNetworkIdle()

      expect(out.notified).toBe(0)
      expect(sent(IPAS_NOTIFICATION.SENT_BACK)).toEqual([])
    })
  })

  describe("undoing an approval", () => {
    async function approvedSections() {
      addToList("s1_approved", approver, otherApprover)
      addToList("s3_approved", approver)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      return ipas
    }

    it("takes back only the Approved, keeps Prepared, and keeps the history", async () => {
      const ipas = await approvedSections()

      const out = await ipasService.undoApproval(ipas.id, 3, "  Approved too fast ")
      await waitForNetworkIdle()

      expect(out).toMatchObject({ clearedSection7: [], notified: 0 })
      expect(live()).toEqual(["1/approved", "1/prepared", "3/prepared"])
      const section = (await read(ipas.id)).signoffSections[3]
      expect(section.status).toBe("awaiting_approval")
      expect(section.history[0]).toMatchObject({ role: "approved", clearedReason: "Approval undone: Approved too fast" })
      expect(events("approval_undone")[0].detail).toMatchObject({ section: 3, reason: "Approved too fast" })
    })

    it("tells the approver when someone else undoes it, with the reason", async () => {
      const ipas = await approvedSections()
      as(otherApprover)

      const out = await ipasService.undoApproval(ipas.id, 1, "Wrong PO")
      await waitForNetworkIdle()

      expect(out.notified).toBe(1)
      const notices = sent(IPAS_NOTIFICATION.APPROVAL_UNDONE)
      expect(notices).toHaveLength(1)
      expect(notices[0]).toMatchObject({ recipient_id: approver.id, sender_id: otherApprover.id, reference_id: ipas.id })
      expect(notices[0].title).toBe("IPAS approval undone")
      expect(notices[0].message).toContain("Wrong PO")
      expect(notices[0].message).toContain("1 · Purchasing")
    })

    it("needs a reason, a section 1 or 3, a live approval and a signer of the section", async () => {
      const ipas = await approvedSections()
      for (const reason of ["", "   ", undefined]) {
        await expect(ipasService.undoApproval(ipas.id, 1, reason)).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      }
      await expect(ipasService.undoApproval(ipas.id, 7, "No")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      await expect(ipasService.undoApproval(ipas.id, 5, "No")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })

      as(buyer)
      await expect(ipasService.undoApproval(ipas.id, 1, "No")).rejects.toMatchObject({ code: "42501" })
      as(superAdmin)
      await expect(ipasService.undoApproval(ipas.id, 1, "No")).rejects.toMatchObject({ code: "42501" })
      expect(live()).toHaveLength(4)

      as(approver)
      await ipasService.undoApproval(ipas.id, 1, "First")
      await expect(ipasService.undoApproval(ipas.id, 1, "Again")).rejects.toMatchObject({ code: "55000" })
    })
  })

  describe("returning a section after section 4 has begun", () => {
    it("clears Received and Noted with it and tells whoever gave them", async () => {
      const receiver = makeEmployee({ name: "Rita Receiver" })
      const noter = makeEmployee({ name: "Nina Noter" })
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      addToList("s7_received", receiver)
      addToList("s7_noted", noter)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")
      as(noter)
      await ipasService.sign(ipas.id, 7, "noted")
      await waitForNetworkIdle()
      const before = sent(IPAS_NOTIFICATION.SENT_BACK).length

      as(approver)
      const out = await ipasService.sendBack(ipas.id, 3, "Freight is missing")
      await waitForNetworkIdle()

      expect(out.clearedSection7).toEqual(["noted", "received"])
      expect(live()).toEqual(["1/approved", "1/prepared"])
      const seven = (await read(ipas.id)).signoffSections[7]
      expect(seven.received).toBeNull()
      expect(seven.history.map((entry) => entry.clearedReason)).toEqual(
        Array(2).fill("Section 3 returned: Freight is missing"),
      )
      // The preparer and each section 4 signer, once.
      const notices = sent(IPAS_NOTIFICATION.SENT_BACK).slice(before)
      expect(notices.map((n) => n.recipient_id).sort()).toEqual([buyer.id, receiver.id, noter.id].sort())
      expect(notices[0].message).toContain("4 · Filing")
      expect(notices[0].title).toBe("IPAS returned")
    })
  })

  describe("sending back section 7", () => {
    let receiver, noter, checker

    async function opened() {
      receiver = makeEmployee({ name: "Rita Receiver" })
      noter = makeEmployee({ name: "Nina Noter" })
      checker = makeEmployee({ name: "Carl Checker" })
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      addToList("s7_received", receiver)
      addToList("s7_noted", noter)
      addToList("s7_checked", checker)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")
      as(noter)
      await ipasService.sign(ipas.id, 7, "noted")
      return ipas
    }

    it("clears Received, Noted and Checked for any section 7 signer, and tells the others with the reason", async () => {
      const ipas = await opened()
      as(checker)
      await ipasService.sign(ipas.id, 7, "checked")
      await waitForNetworkIdle()
      const before = sent(IPAS_NOTIFICATION.SENT_BACK).length

      const out = await ipasService.sendBack(ipas.id, 7, "  Landed cost is off ")
      await waitForNetworkIdle()

      expect(out).toMatchObject({ clearedRoles: ["checked", "noted", "received"], notified: 2 })
      expect(live()).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared"])

      const seven = (await read(ipas.id)).signoffSections[7]
      expect(seven.received).toBeNull()
      expect(seven.history.map((s) => [s.role, s.clearedReason])).toEqual(
        expect.arrayContaining([
          ["received", "Returned: Landed cost is off"],
          ["noted", "Returned: Landed cost is off"],
          ["checked", "Returned: Landed cost is off"],
        ]),
      )
      expect(events("sent_back").at(-1).detail).toMatchObject({ section: 7, reason: "Landed cost is off" })

      const notices = sent(IPAS_NOTIFICATION.SENT_BACK).slice(before)
      expect(notices.map((n) => n.recipient_id).sort()).toEqual([receiver.id, noter.id].sort())
      expect(notices.every((n) => n.sender_id === checker.id && n.reference_id === ipas.id)).toBe(true)
      expect(notices[0].message).toContain("section 4 · Filing")
      expect(notices[0].message).toContain("Landed cost is off")
    })

    it("is for someone on a section 7 list: the purchaser, the section 1 approver and a Super Admin off the lists are refused", async () => {
      const ipas = await opened()
      for (const person of [buyer, approver, superAdmin]) {
        as(person)
        await expect(ipasService.sendBack(ipas.id, 7, "No")).rejects.toMatchObject({ code: "42501" })
      }
      expect(live()).toEqual(expect.arrayContaining(["7/noted", "7/received"]))
    })

    it("refuses when nothing in section 7 is signed, and a filed IPAS", async () => {
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      addToList("s7_received", approver)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      await expect(ipasService.sendBack(ipas.id, 7, "Nothing yet")).rejects.toMatchObject({ code: "55000" })

      await ipasService.sign(ipas.id, 7, "received")
      updateRow("ipas", db.internal.rowsOf("ipas").find((r) => r.id === ipas.id), { state: "filed", filed_at: new Date().toISOString() })
      await expect(ipasService.sendBack(ipas.id, 7, "Too late")).rejects.toMatchObject({ code: "55000" })
      expect(live()).toContain("7/received")
    })
  })

  describe("what undoes an approval", () => {
    async function approved(supplierId) {
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      const ipas = await raise({ supplierId })
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      await ipasService.sign(ipas.id, 3, "approved")
      as(buyer)
      return ipas
    }

    it("a changed PO clears both approvals with 'PO changed in Odoo', notifies the preparer, and can be approved again", async () => {
      const ipas = await approved()
      stubEdgeFunction("odoo-po-ipas", odooPo({ name: ipas.po_number, lines: [line(1), line(2)] }))

      const refreshed = await ipasService.refresh(ipas.id)
      await waitForNetworkIdle()

      expect(refreshed).toMatchObject({ ok: true, changed: true, approvalsCleared: [1, 3] })
      expect(live()).toEqual(["1/prepared", "3/prepared"])
      expect(db.rows("ipas_signoffs").filter((s) => s.cleared_at).map((s) => s.cleared_reason)).toEqual([
        "PO changed in Odoo",
        "PO changed in Odoo",
      ])
      const notices = sent(IPAS_NOTIFICATION.PO_CHANGED)
      expect(notices).toHaveLength(1)
      expect(notices[0].recipient_id).toBe(buyer.id)

      // Awaiting approval again: the queue shows it to the approver.
      expect((await ipasService.pendingSignoffsFor(approver.id)).map((p) => p.section).sort()).toEqual([1, 3])
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      expect(live()).toEqual(["1/approved", "1/prepared", "3/prepared"])
    })

    it("a flagged Account # clears both approvals with 'Account # flagged' and notifies the preparer", async () => {
      const first = await raise({ supplierId: 7001 })
      await ipasService.setBankDetails(first.id, { bankName: "BDO", accountName: "Scorpe", accountNumber: "1111" })
      const second = await approved(7001)

      const out = await ipasService.setBankDetails(second.id, { bankName: "BDO", accountName: "Scorpe", accountNumber: "9999" })
      await waitForNetworkIdle()

      expect(out).toMatchObject({ flagged: true, approvalsCleared: [1, 3] })
      expect(live()).toEqual(["1/prepared", "3/prepared"])
      expect(db.rows("ipas_signoffs").filter((s) => s.cleared_at).every((s) => s.cleared_reason === "Account # flagged")).toBe(true)
      expect(sent(IPAS_NOTIFICATION.ACCOUNT_FLAGGED).map((n) => n.recipient_id)).toEqual([buyer.id])
    })

    it("a payment, a charge, an override, Purpose and a header value leave every approval standing", async () => {
      const ipas = await approved()
      const before = live()
      expect(before).toHaveLength(4)

      await ipasService.addPayment(ipas.id, {
        kind: "down_payment", paidOn: "2026-10-01", amount: "500", chargeFeePhp: "", methodId: options.payment_method["Dated Check"].id,
      })
      await ipasService.addCharge(ipas.id, { kindId: options.charge_kind["Brokerage Fee"].id, chargedOn: "2026-10-05", amountPhp: "150" })
      await ipasService.overrideField(ipas.id, "entity", "T3CK Holdings")
      await ipasService.setHeader(ipas.id, { piNumber: "PI-77" })
      await ipasService.setPurposeAndSors(ipas.id, { purpose: "supplies", sorIds: [] })

      expect(live()).toEqual(before)
      expect(db.rows("ipas_signoffs").filter((s) => s.cleared_at)).toEqual([])
      expect(sent(IPAS_NOTIFICATION.PO_CHANGED)).toEqual([])
    })

    it("a refresh that changes nothing in the lines or total leaves them standing too", async () => {
      const ipas = await approved()
      stubEdgeFunction("odoo-po-ipas", { ...odooPo({ name: ipas.po_number }), receipts: { status: "full", done: 1, total: 1 } })

      const refreshed = await ipasService.refresh(ipas.id)

      expect(refreshed).toMatchObject({ ok: true, changed: false, approvalsCleared: [] })
      expect(live()).toHaveLength(4)
    })
  })

  describe("paid before approval", () => {
    const pay = (id) =>
      ipasService.addPayment(id, { kind: "payment", paidOn: "2026-10-01", amount: "500", chargeFeePhp: "", methodId: options.payment_method["Dated Check"].id })

    it("flags a payment recorded before section 1 is approved, and the payment row says so", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      const early = await pay(ipas.id)
      await ipasService.sign(ipas.id, 1, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      as(buyer)
      const late = await pay(ipas.id)

      expect(early.paid_before_approval).toBe(true)
      expect(late.paid_before_approval).toBe(false)
      const flags = (await read(ipas.id)).payments.map((p) => p.paid_before_approval)
      expect(flags).toEqual([true, false])
    })
  })

  describe("the Approval Center queue: pendingSignoffsFor", () => {
    it("lists what waits on this person's signature, oldest first, with what the row needs", async () => {
      addToList("s1_approved", approver)
      addToList("s3_approved", approver)
      const a = await raise({ lines: [line(1, 2, 100), line(2, 1, 50)] })
      const b = await raise()
      await ipasService.sign(b.id, 1, "prepared")
      await ipasService.sign(a.id, 3, "prepared")
      await ipasService.sign(a.id, 1, "prepared")

      const pending = await ipasService.pendingSignoffsFor(approver.id)

      expect(pending.map((p) => `${p.number}/${p.section}`)).toEqual([`${b.number}/1`, `${a.number}/3`, `${a.number}/1`])
      expect(pending[1]).toMatchObject({
        id: `${a.id}:3`,
        ipasId: a.id,
        poNumber: a.po_number,
        supplier: "Scorpe Technologies",
        total: 250,
        section: 3,
        role: "approved",
        preparedBy: { id: buyer.id, name: "Buyer" },
      })
    })

    it("shows nothing to someone not on a list, and only the section they approve", async () => {
      addToList("s1_approved", approver)
      addToList("s3_approved", otherApprover)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")

      expect((await ipasService.pendingSignoffsFor(bystander.id)).length).toBe(0)
      expect((await ipasService.pendingSignoffsFor(superAdmin.id)).length).toBe(0)
      expect((await ipasService.pendingSignoffsFor(approver.id)).map((p) => p.section)).toEqual([1])
      expect((await ipasService.pendingSignoffsFor(otherApprover.id)).map((p) => p.section)).toEqual([3])
      expect(await ipasService.pendingSignoffsFor(null)).toEqual([])
    })

    it("leaves out what they prepared themselves, what is approved, sent back, filed or cancelled", async () => {
      addToList("s1_approved", approver, buyer)
      const own = await raise()
      await ipasService.sign(own.id, 1, "prepared")
      expect((await ipasService.pendingSignoffsFor(buyer.id)).length).toBe(0)

      const done = await raise()
      await ipasService.sign(done.id, 1, "prepared")
      as(approver)
      await ipasService.sign(done.id, 1, "approved")

      as(buyer)
      const back = await raise()
      await ipasService.sign(back.id, 1, "prepared")
      as(approver)
      await ipasService.sendBack(back.id, 1, "Redo")

      as(buyer)
      const filed = await raise()
      await ipasService.sign(filed.id, 1, "prepared")
      db.internal.rowsOf("ipas").find((r) => r.id === filed.id).state = "filed"

      const cancelled = await raise()
      await ipasService.sign(cancelled.id, 1, "prepared")
      await ipasService.cancel(cancelled.id, "Wrong PO")

      expect((await ipasService.pendingSignoffsFor(approver.id)).map((p) => p.ipasId)).toEqual([own.id])
    })
  })

  describe("the signer lists", () => {
    it("has every list, empty when nobody is on it, with who is on each", async () => {
      addToList("s1_approved", approver, otherApprover)
      db.internal.rowsOf("employees").find((e) => e.id === approver.id).call_sign = "101"

      const lists = await ipasService.getSignerLists()

      expect(Object.keys(lists).sort()).toEqual([...IPAS_SIGNER_LISTS, "transmittal_check_by", "transmittal_logistics", "transmittal_technical", "transmittal_warehouse"].sort())
      expect(lists.s7_noted).toEqual([])
      expect(lists.s1_approved.map((m) => [m.employeeId, m.name, m.callSign])).toEqual([
        [approver.id, "Boss Lito", "101"],
        [otherApprover.id, "Co Approver", null],
      ])
    })

    const asAdmin = () => as(superAdmin, { superAdmin: true })

    it("sets a list to exactly the people given, adding and removing, and leaves the others alone", async () => {
      addToList("s1_approved", approver, otherApprover)
      addToList("s3_approved", approver)
      asAdmin()

      const after = await ipasService.setSignerList("s1_approved", [otherApprover.id, bystander.id])

      expect(after.map((m) => m.employeeId).sort()).toEqual([otherApprover.id, bystander.id].sort())
      expect((await ipasService.getSignerLists()).s3_approved.map((m) => m.employeeId)).toEqual([approver.id])

      expect(await ipasService.setSignerList("s1_approved", [])).toEqual([])
    })

    it("ignores duplicates and blanks, and refuses a list that doesn't exist", async () => {
      asAdmin()
      const after = await ipasService.setSignerList("s7_noted", [approver.id, approver.id, "", null])
      expect(after.map((m) => m.employeeId)).toEqual([approver.id])
      await expect(ipasService.setSignerList("s2_approved", [approver.id])).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
    })

    it("sets a Transmittal staff list", async () => {
      asAdmin()
      const after = await ipasService.setSignerList("transmittal_warehouse", [bystander.id])
      expect(after.map((m) => m.employeeId)).toEqual([bystander.id])
    })

    it("takes someone off a list without touching what they already signed", async () => {
      addToList("s1_approved", approver)
      const ipas = await raise()
      await ipasService.sign(ipas.id, 1, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")

      asAdmin()
      await ipasService.setSignerList("s1_approved", [])
      as(approver)

      expect(live()).toEqual(["1/approved", "1/prepared"])
      await expect(ipasService.sign(ipas.id, 3, "approved")).rejects.toMatchObject({ code: "42501" })
    })

    it("is for a Super Admin only: anyone else is refused and nothing changes", async () => {
      addToList("s1_approved", approver)
      as(buyer)
      await expect(ipasService.setSignerList("s1_approved", [bystander.id])).rejects.toMatchObject({ code: "42501" })
      as(approver)
      await expect(ipasService.setSignerList("s1_approved", [])).rejects.toMatchObject({ code: "42501" })

      expect((await ipasService.getSignerLists()).s1_approved.map((m) => m.employeeId)).toEqual([approver.id])
      expect(db.rows("ipas_signer_list_log")).toEqual([])
    })

    it("writes each person added and removed to the log, and reads it back newest first with names", async () => {
      addToList("s1_approved", approver)
      asAdmin()

      await ipasService.setSignerList("s1_approved", [otherApprover.id, bystander.id])
      await ipasService.setSignerList("s1_approved", [otherApprover.id, bystander.id])
      await ipasService.setSignerList("s7_noted", [approver.id])

      const log = await ipasService.getSignerListLog()
      expect(log).toHaveLength(4)
      expect(log.map((row) => [row.listKey, row.action, row.employeeName, row.actorName])).toEqual(
        expect.arrayContaining([
          ["s1_approved", "added", "Co Approver", "Super Admin"],
          ["s1_approved", "added", "Bystander", "Super Admin"],
          ["s1_approved", "removed", "Boss Lito", "Super Admin"],
          ["s7_noted", "added", "Boss Lito", "Super Admin"],
        ]),
      )
      expect(new Date(log[0].at) >= new Date(log[3].at)).toBe(true)
      expect(await ipasService.getSignerListLog({ limit: 2 })).toHaveLength(2)
    })

    it("writes nothing for a list left as it was", async () => {
      addToList("s1_approved", approver)
      asAdmin()

      await ipasService.setSignerList("s1_approved", [approver.id])

      expect(await ipasService.getSignerListLog()).toEqual([])
    })
  })
})

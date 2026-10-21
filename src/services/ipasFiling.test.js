import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { waitForNetworkIdle } from "@/test/network"
import { makeEmployee } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_ERROR, IPAS_NOTIFICATION, IPAS_WARNING } from "@/constants/ipas"

/**
 * IPAS section 7 and Filing (#248) through the service, against the fake
 * database with the RPCs re-implemented on its store and Odoo stubbed. The
 * database's own rules (the real ordering, the Costs complete refusal, the
 * freeze trigger holding for the service role, reopen for Super Admins only)
 * are the policy tier's (62-ipas-filing); what is proven here is the wiring:
 * the warnings and the confirm, what `get` reads back and shows once filed,
 * who is told of each step, the Approval Center queue, and that a filed IPAS
 * stays shut to every edit the service offers until it is reopened.
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

const odooPo = ({ name, lines = [line(1)] }) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 553, name: "Scorpe Technologies", contact: null },
  lines,
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

describe("ipasService: section 7 and Filing", () => {
  let buyer, approver, receiver, noter, checker, bystander, superAdmin, options

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    approver = makeEmployee({ name: "Boss Lito" })
    receiver = makeEmployee({ name: "Receiver" })
    noter = makeEmployee({ name: "Noter" })
    checker = makeEmployee({ name: "Checker" })
    bystander = makeEmployee({ name: "Bystander" })
    superAdmin = makeEmployee({ name: "Super Admin", is_super_admin: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    for (const [listKey, person] of [
      ["s1_approved", approver],
      ["s3_approved", approver],
      ["s6_approved", approver],
      ["s7_received", receiver],
      ["s7_noted", noter],
      ["s7_checked", checker],
      ["s7_approved", approver],
    ]) {
      db.seed("ipas_signer_lists", { list_key: listKey, employee_id: person.id })
    }
    stubIpasRpcs({ actorId: buyer.id })
  })

  /** Calls the service as someone else (the stub's identity is the signed-in actor). */
  const as = (person, opts = {}) =>
    stubIpasRpcs({ actorId: person.id, purchasing: Boolean(person.has_purchasing_flow), ...opts })

  let poSeq = 0
  async function raise({ source = "local", lines } = {}) {
    const poNumber = `P0${4000 + (poSeq += 1)}`
    stubEdgeFunction("odoo-po-ipas", odooPo({ name: poNumber, lines }))
    return ipasService.create({ poNumber, priority: "high", source, purpose: "inventory" })
  }

  const read = (id) => ipasService.get(id, { refresh: false })
  const live = (ipasId) =>
    db
      .rows("ipas_signoffs")
      .filter((s) => (!ipasId || s.ipas_id === ipasId) && !s.cleared_at)
      .map((s) => `${s.section}/${s.role}`)
      .sort()
  const sent = (type) => db.rows("notifications").filter((n) => n.type === type)
  const events = (...kinds) => db.rows("ipas_events").filter((e) => !kinds.length || kinds.includes(e.kind))
  const rowOf = (id) => db.rows("ipas").find((r) => r.id === id)

  /** Prepared by the buyer and approved by the approver, for each section. */
  async function approveFirstSections(ipas) {
    as(buyer)
    await ipasService.sign(ipas.id, 1, "prepared")
    await ipasService.sign(ipas.id, 3, "prepared")
    as(approver)
    await ipasService.sign(ipas.id, 1, "approved")
    await ipasService.sign(ipas.id, 3, "approved")
    approveSection3(ipas)
  }

  /** Section 3 (stored 6) approved without the Computation status dance: Filing opens only with it (#590). */
  function approveSection3(ipas) {
    db.seed("ipas_signoffs", { ipas_id: ipas.id, section: 6, role: "prepared", signed_by: buyer.id })
    db.seed("ipas_signoffs", { ipas_id: ipas.id, section: 6, role: "approved", signed_by: approver.id })
  }

  async function receivedNotedChecked(ipas) {
    as(receiver)
    await ipasService.sign(ipas.id, 7, "received")
    as(noter)
    await ipasService.sign(ipas.id, 7, "noted")
    as(checker)
    await ipasService.sign(ipas.id, 7, "checked")
  }

  /** Ticks every required document, so nothing warns. */
  const tickEverything = () => {
    for (const doc of db.internal.rowsOf("ipas_documents")) doc.purchasing_has = true
  }

  async function costsComplete(ipas) {
    as(buyer)
    await ipasService.setComputationStatus(ipas.id, "lc_odoo_done")
  }

  /** Every step done, nothing unticked: the IPAS is filed. */
  async function filed(opts) {
    const ipas = await raise(opts)
    await costsComplete(ipas)
    tickEverything()
    await approveFirstSections(ipas)
    await receivedNotedChecked(ipas)
    as(approver)
    await ipasService.sign(ipas.id, 7, "approved")
    return ipas
  }

  describe("the order", () => {
    it("doesn't open until sections 1, 2 and 3 are all approved", async () => {
      const ipas = await raise()
      as(receiver)
      await expect(ipasService.sign(ipas.id, 7, "received")).rejects.toMatchObject({ code: "55000" })

      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      as(receiver)
      await expect(ipasService.sign(ipas.id, 7, "received")).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/sections 1, 2 and 3/),
      })

      as(buyer)
      await ipasService.sign(ipas.id, 3, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 3, "approved")
      // Sections 1 and 2 are not enough: section 3 (the Landed Cost check) is still to be approved.
      as(receiver)
      await expect(ipasService.sign(ipas.id, 7, "received")).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/sections 1, 2 and 3/),
      })

      await costsComplete(ipas)
      as(buyer)
      await ipasService.sign(ipas.id, 6, "prepared")
      as(approver)
      await ipasService.sign(ipas.id, 6, "approved")
      as(receiver)
      const out = await ipasService.sign(ipas.id, 7, "received")
      expect(out.signoff).toMatchObject({ section: 7, role: "received", signedBy: { id: receiver.id } })
    })

    it("keeps what was already given when section 3 is not approved, and holds the final Approve (#590)", async () => {
      const ipas = await raise()
      await costsComplete(ipas)
      tickEverything()
      await approveFirstSections(ipas)
      await receivedNotedChecked(ipas)
      // Section 3 approval is taken back (an Odoo change would do the same); section 4 sign-offs stay.
      const section3 = db.internal.rowsOf("ipas_signoffs").find((s) => s.ipas_id === ipas.id && s.section === 6 && s.role === "approved")
      section3.cleared_at = new Date().toISOString()
      expect(live(ipas.id).filter((k) => k.startsWith("7/"))).toEqual(["7/checked", "7/noted", "7/received"])

      as(approver)
      await expect(ipasService.sign(ipas.id, 7, "approved")).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/sections 1, 2 and 3/),
      })
      expect(live(ipas.id).filter((k) => k.startsWith("7/"))).toEqual(["7/checked", "7/noted", "7/received"])

      section3.cleared_at = null
      const out = await ipasService.sign(ipas.id, 7, "approved")
      expect(out.filed).toBe(true)
    })

    it("keeps Noted and Checked behind Received, and takes them in either order", async () => {
      const ipas = await raise()
      await approveFirstSections(ipas)

      as(noter)
      await expect(ipasService.sign(ipas.id, 7, "noted")).rejects.toMatchObject({ code: "55000" })
      as(checker)
      await expect(ipasService.sign(ipas.id, 7, "checked")).rejects.toMatchObject({ code: "55000" })

      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")
      as(checker)
      await ipasService.sign(ipas.id, 7, "checked")
      as(noter)
      await ipasService.sign(ipas.id, 7, "noted")

      expect(live(ipas.id).filter((k) => k.startsWith("7/"))).toEqual(["7/checked", "7/noted", "7/received"])
      const opened = await read(ipas.id)
      expect(opened.signoffSections[7]).toMatchObject({ status: "in_progress", opened: true, next: ["approved"] })
    })

    it("refuses Approved until all three are given", async () => {
      const ipas = await raise()
      await costsComplete(ipas)
      await approveFirstSections(ipas)
      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")

      as(approver)
      await expect(ipasService.sign(ipas.id, 7, "approved")).rejects.toMatchObject({ code: "55000" })
      expect(rowOf(ipas.id).state).toBe("open")
    })

    it("belongs to each step's list, a Super Admin off the list included", async () => {
      const ipas = await raise()
      await approveFirstSections(ipas)
      for (const person of [bystander, superAdmin, buyer, approver]) {
        as(person)
        await expect(ipasService.sign(ipas.id, 7, "received"), person.name).rejects.toMatchObject({ code: "42501" })
      }
      expect(live(ipas.id)).not.toContain("7/received")
    })

    it("only takes section 7's four roles, and only sections 1, 3 and 7 are sent back", async () => {
      const ipas = await raise()
      await expect(ipasService.sign(ipas.id, 7, "prepared")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      await expect(ipasService.sign(ipas.id, 7, "bogus")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      await expect(ipasService.sign(ipas.id, 5, "received")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      await expect(ipasService.sendBack(ipas.id, 5, "No")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      expect(events("signed")).toEqual([])
    })
  })

  describe("Filing", () => {
    it("refuses Approved before LC Odoo Done, with the reason, and signs nothing", async () => {
      const ipas = await raise()
      tickEverything()
      await approveFirstSections(ipas)
      await receivedNotedChecked(ipas)

      for (const status of ["encoding", "encoded"]) {
        as(buyer)
        await ipasService.setComputationStatus(ipas.id, status)
        as(approver)
        await expect(ipasService.sign(ipas.id, 7, "approved", { confirm: true }), status).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/LC Odoo Done/),
        })
      }
      expect(rowOf(ipas.id)).toMatchObject({ state: "open", filed_at: null })
      expect(live(ipas.id)).not.toContain("7/approved")
    })

    it("answers the hard refusal rather than a warning when costs aren't complete", async () => {
      const ipas = await raise()
      await approveFirstSections(ipas)
      await receivedNotedChecked(ipas)
      // Documents are unticked, but LC Odoo Done comes first: no confirm will help.
      as(approver)
      await expect(ipasService.sign(ipas.id, 7, "approved")).rejects.toMatchObject({
        code: "55000",
        message: expect.stringMatching(/LC Odoo Done/),
      })
    })

    it("lists the unticked required documents and files only on confirm", async () => {
      const ipas = await raise({ source: "import" })
      await costsComplete(ipas)
      await approveFirstSections(ipas)
      await receivedNotedChecked(ipas)
      as(approver)

      const first = await ipasService.sign(ipas.id, 7, "approved")
      expect(first).toMatchObject({ signoff: null, filed: false, notified: 0, needsConfirm: true })
      const labels = first.warnings.map((w) => w.label)
      expect(labels).toEqual(expect.arrayContaining(["Commercial Invoice", "Packing List", "BL or Waybill"]))
      // Import's kinds only: a Local document isn't asked for.
      expect(labels).not.toContain("Quotation (Local)")
      for (const warning of first.warnings) {
        expect(Object.keys(warning).sort()).toEqual(["appliesTo", "id", "label", "usedFor"])
      }
      expect(rowOf(ipas.id).state).toBe("open")
      expect(live(ipas.id)).not.toContain("7/approved")
      expect(await ipasService.filingWarnings(ipas.id)).toEqual(first.warnings)

      const second = await ipasService.sign(ipas.id, 7, "approved", { confirm: true })
      expect(second).toMatchObject({ filed: true, warnings: [] })
      expect(second.signoff).toMatchObject({ section: 7, role: "approved", signedBy: { id: approver.id } })
      expect(rowOf(ipas.id)).toMatchObject({ state: "filed" })
      expect(rowOf(ipas.id).filed_at).toBeTruthy()
    })

    it("stops warning about a document once either department ticks it", async () => {
      const ipas = await raise({ source: "local" })
      const before = (await ipasService.filingWarnings(ipas.id)).map((w) => w.label)
      expect(before).toContain("Compliance (Local)")

      const row = db.internal.rowsOf("ipas_documents").find((d) => d.ipas_id === ipas.id && !d.purchasing_has)
      const kind = db.rows("ipas_options").find((o) => o.id === row.kind_id)
      row.finance_has = true
      const after = (await ipasService.filingWarnings(ipas.id)).map((w) => w.label)
      expect(after).not.toContain(kind.label)
      expect(after).toHaveLength(before.length - 1)
    })

    it("doesn't ask for documents the preparer took off, or ones added by hand", async () => {
      const ipas = await raise({ source: "local" })
      const dropped = db.internal.rowsOf("ipas_documents").find((d) => d.ipas_id === ipas.id)
      const label = db.rows("ipas_options").find((o) => o.id === dropped.kind_id).label
      db.internal.rowsOf("ipas_documents").splice(db.internal.rowsOf("ipas_documents").indexOf(dropped), 1)
      db.seed("ipas_documents", { ipas_id: ipas.id, kind_id: null, label: "Customer's approval" })

      const labels = (await ipasService.filingWarnings(ipas.id)).map((w) => w.label)
      expect(labels).not.toContain(label)
      expect(labels).not.toContain("Customer's approval")
    })

    it("files with nothing to confirm when every required document is ticked", async () => {
      const ipas = await filed()
      expect(rowOf(ipas.id).state).toBe("filed")
      expect(events("filed")).toHaveLength(1)
      const opened = await read(ipas.id)
      expect(opened).toMatchObject({ state: "filed" })
      expect(opened.signoffSections[7]).toMatchObject({ status: "filed" })
      expect(opened.signoffSections[7].approved.signedBy).toMatchObject({ id: approver.id })
      // Landed Cost reads final: it was frozen at Costs complete.
      expect(opened.landedCost.status).toBe("final")
    })

    describe("the Odoo copy it files", () => {
      /** Everything done but section 7's Approved. */
      async function readyToFile() {
        const ipas = await raise()
        await costsComplete(ipas)
        tickEverything()
        await approveFirstSections(ipas)
        await receivedNotedChecked(ipas)
        return ipas
      }

      it("is refreshed from Odoo first, so a copy that moved since it was last read is the one filed", async () => {
        const ipas = await readyToFile()
        const before = rowOf(ipas.id).odoo_fetched_at
        stubEdgeFunction("odoo-po-ipas", {
          ...odooPo({ name: ipas.po_number }),
          receipts: { status: "done", done: 1, total: 1 },
        })

        as(approver)
        const result = await ipasService.sign(ipas.id, 7, "approved")

        expect(result.filed).toBe(true)
        expect(rowOf(ipas.id).state).toBe("filed")
        expect(rowOf(ipas.id).odoo_copy.receipts).toEqual({ status: "done", done: 1, total: 1 })
        expect(rowOf(ipas.id).odoo_fetched_at >= before).toBe(true)
      })

      it("files nothing when the refresh shows the Odoo PO changed, and says why", async () => {
        const ipas = await readyToFile()
        stubEdgeFunction("odoo-po-ipas", odooPo({ name: ipas.po_number, lines: [line(1), line(2, 5, 40)] }))

        as(approver)
        await expect(ipasService.sign(ipas.id, 7, "approved")).rejects.toMatchObject({
          code: IPAS_ERROR.INVALID,
          message: expect.stringMatching(/nothing was filed/),
        })

        expect(rowOf(ipas.id).state).toBe("open")
        expect(live(ipas.id)).not.toContain("7/approved")
        expect(live(ipas.id)).not.toContain("1/approved")
      })

      it("is the stored copy when Odoo doesn't answer, and filing still goes ahead", async () => {
        const ipas = await readyToFile()
        const stored = structuredClone(rowOf(ipas.id).odoo_copy)
        stubEdgeFunction("odoo-po-ipas", { success: false, message: "Odoo is rate-limiting requests" })

        as(approver)
        const result = await ipasService.sign(ipas.id, 7, "approved")

        expect(result.filed).toBe(true)
        expect(rowOf(ipas.id).state).toBe("filed")
        expect(rowOf(ipas.id).odoo_copy).toEqual(stored)
      })
    })

    it("refuses another sign-off on a filed IPAS", async () => {
      const ipas = await filed()
      as(receiver)
      await expect(ipasService.sign(ipas.id, 7, "received")).rejects.toMatchObject({ code: "55000" })
    })
  })

  describe("notifications", () => {
    it("tells exactly the next list at each step, and nobody for the last", async () => {
      const ipas = await raise()
      await costsComplete(ipas)
      tickEverything()

      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")
      await waitForNetworkIdle()
      expect(sent("IPAS_SIGNOFF_READY").map((n) => n.recipient_id)).toEqual([approver.id, approver.id])
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY)).toEqual([])

      // One section approved: section 7 isn't ready yet.
      as(approver)
      expect((await ipasService.sign(ipas.id, 1, "approved")).notified).toBe(0)
      // Sections 1 and 2 approved: still not ready, section 3 is open (#590).
      expect((await ipasService.sign(ipas.id, 3, "approved")).notified).toBe(0)
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY)).toEqual([])
      // Section 3 is submitted, then approved last: the Received list is told.
      as(buyer)
      await ipasService.sign(ipas.id, 6, "prepared")
      as(approver)
      const bothApproved = await ipasService.sign(ipas.id, 6, "approved")
      await waitForNetworkIdle()
      expect(bothApproved.notified).toBe(1)
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY).map((n) => n.recipient_id)).toEqual([receiver.id])
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY)[0]).toMatchObject({ reference_id: ipas.id, sender_id: approver.id })
      // The notice names the sections the screen shows (#552): 1, 2 and 3 approved, 4 ready.
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY)[0]).toMatchObject({
        title: "IPAS ready to receive",
        message: expect.stringContaining("sections 1, 2 and 3 are approved. Section 4 is ready for Received."),
      })
      expect(sent("IPAS_SIGNOFF_READY").map((n) => n.message).join(" ")).toMatch(/section 2 \(Purchasing & Finance\)/)
      expect(sent("IPAS_SIGNOFF_READY").map((n) => n.message).join(" ")).not.toMatch(/section 7/)

      // Received: the Noted and Checked lists.
      as(receiver)
      const received = await ipasService.sign(ipas.id, 7, "received")
      await waitForNetworkIdle()
      expect(received.notified).toBe(2)
      expect(
        sent(IPAS_NOTIFICATION.SECTION_7_READY)
          .slice(1)
          .map((n) => n.recipient_id)
          .sort(),
      ).toEqual([noter.id, checker.id].sort())

      // The first of Noted and Checked tells nobody; both given tell the Approved list.
      as(noter)
      expect((await ipasService.sign(ipas.id, 7, "noted")).notified).toBe(0)
      as(checker)
      const checked = await ipasService.sign(ipas.id, 7, "checked")
      await waitForNetworkIdle()
      expect(checked.notified).toBe(1)
      expect(sent(IPAS_NOTIFICATION.SECTION_7_READY).at(-1)).toMatchObject({ recipient_id: approver.id })

      // Approved files and tells nobody.
      as(approver)
      const before = db.rows("notifications").length
      const done = await ipasService.sign(ipas.id, 7, "approved")
      await waitForNetworkIdle()
      expect(done).toMatchObject({ filed: true, notified: 0 })
      expect(db.rows("notifications")).toHaveLength(before)
    })

    it("never tells the person who just signed, and never puts money in a message", async () => {
      db.seed("ipas_signer_lists", { list_key: "s7_noted", employee_id: checker.id })
      const ipas = await raise()
      await approveFirstSections(ipas)
      await waitForNetworkIdle()
      const earlier = sent(IPAS_NOTIFICATION.SECTION_7_READY).length
      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")
      await waitForNetworkIdle()
      // Only what Received sent: the checker is on both Noted and Checked, told once.
      const now = sent(IPAS_NOTIFICATION.SECTION_7_READY).slice(earlier)
      expect(now.filter((n) => n.recipient_id === checker.id)).toHaveLength(1)
      expect(now.map((n) => n.recipient_id).sort()).toEqual([noter.id, checker.id].sort())
      for (const note of now) {
        expect(note.message).not.toMatch(/bank|account|PHP/i)
        expect(note.recipient_id).not.toBe(receiver.id)
      }
    })
  })

  describe("what a filed IPAS refuses", () => {
    it("refuses edits to Purpose, payments, charges, documents, bank details and overrides", async () => {
      const ipas = await filed()
      as(buyer)
      const [kind] = Object.values(options.charge_kind)
      const [method] = Object.values(options.payment_method)
      const attempts = [
        () => ipasService.setPurpose(ipas.id, "supplies"),
        () => ipasService.overrideField(ipas.id, "entity", "Other"),
        () => ipasService.setHeader(ipas.id, { piNumber: "PI-9" }),
        () =>
          ipasService.addPayment(ipas.id, {
            kind: "down_payment", paidOn: "2026-10-01", amount: "10", phpDebited: "10", chargeFeePhp: "0", methodId: method.id,
          }, { isPhpPo: true }),
        () => ipasService.addCharge(ipas.id, { kindId: kind.id, chargedOn: "2026-10-02", amountPhp: "10" }),
        () => ipasService.setBankDetails(ipas.id, { bankName: "BDO", accountName: "Scorpe", accountNumber: "1" }),
        () => ipasService.suggestDocuments(ipas.id),
        () => ipasService.cancel(ipas.id, "Changed our minds"),
      ]
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toMatchObject({ code: "55000" })
      }
      expect(rowOf(ipas.id).state).toBe("filed")
    })

    it("shows 'Odoo has changed since filing' and leaves the stored copy alone", async () => {
      const ipas = await filed()
      const stored = structuredClone(rowOf(ipas.id).odoo_copy)
      stubEdgeFunction(
        "odoo-po-ipas",
        odooPo({ name: ipas.po_number, lines: [line(1), line(2, 5, 40)] }),
      )

      const outcome = await ipasService.refresh(ipas.id)
      expect(outcome).toMatchObject({ ok: true, filed: true, changed: false, approvalsCleared: [] })

      const opened = await ipasService.get(ipas.id)
      expect(rowOf(ipas.id).odoo_copy).toEqual(stored)
      expect(opened.lines).toHaveLength(1)
      expect(opened.warnings.map((w) => w.code)).toContain(IPAS_WARNING.ODOO_CHANGED_SINCE_FILING)
      expect(opened.state).toBe("filed")
      expect(events("odoo_changed_since_filing")).toHaveLength(1)
      // The approvals stand: only the flag moved.
      expect(live(ipas.id)).toEqual(expect.arrayContaining(["1/approved", "3/approved", "7/approved"]))
    })

    it("stops saying so when the PO goes back to what was filed", async () => {
      const ipas = await filed()
      stubEdgeFunction("odoo-po-ipas", odooPo({ name: ipas.po_number, lines: [line(1), line(2)] }))
      await ipasService.refresh(ipas.id)
      expect((await read(ipas.id)).warnings.map((w) => w.code)).toContain(IPAS_WARNING.ODOO_CHANGED_SINCE_FILING)

      stubEdgeFunction("odoo-po-ipas", odooPo({ name: ipas.po_number }))
      await ipasService.refresh(ipas.id)
      expect((await read(ipas.id)).warnings.map((w) => w.code)).not.toContain(IPAS_WARNING.ODOO_CHANGED_SINCE_FILING)
    })
  })

  describe("reopening", () => {
    it("is a Super Admin's, with a reason, and clears section 7 only", async () => {
      const ipas = await filed()

      as(buyer)
      await expect(ipasService.reopen(ipas.id, "Wrong figures")).rejects.toMatchObject({ code: "42501" })
      as(approver)
      await expect(ipasService.reopen(ipas.id, "Wrong figures")).rejects.toMatchObject({ code: "42501" })

      as(superAdmin, { superAdmin: true })
      for (const reason of ["", "   ", undefined]) {
        await expect(ipasService.reopen(ipas.id, reason)).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      }
      expect(rowOf(ipas.id).state).toBe("filed")

      const out = await ipasService.reopen(ipas.id, "Charges were misread")
      expect(out.clearedRoles).toEqual(["approved", "checked", "noted", "received"])
      expect(rowOf(ipas.id)).toMatchObject({ state: "open", filed_at: null })
      expect(live(ipas.id)).toEqual(["1/approved", "1/prepared", "3/approved", "3/prepared", "6/approved", "6/prepared"])

      const opened = await read(ipas.id)
      expect(opened.signoffSections[7]).toMatchObject({ status: "ready", approved: null, received: null })
      expect(opened.signoffSections[7].history).toHaveLength(4)
      expect(opened.signoffSections[7].history[0].clearedReason).toBe("Reopened: Charges were misread")
      expect(opened.signoffSections[1].status).toBe("approved")
      expect(events("reopened")).toHaveLength(1)
    })

    it("makes edits work again, cancelling included, and can be filed once more", async () => {
      const ipas = await filed()
      as(buyer)
      await expect(ipasService.cancel(ipas.id, "Changed our minds")).rejects.toMatchObject({ code: "55000" })

      as(superAdmin, { superAdmin: true })
      await ipasService.reopen(ipas.id, "Fix the Purpose")

      as(buyer)
      await ipasService.setPurpose(ipas.id, "supplies")
      expect(rowOf(ipas.id).purpose).toBe("supplies")

      await receivedNotedChecked(ipas)
      as(approver)
      const again = await ipasService.sign(ipas.id, 7, "approved")
      expect(again.filed).toBe(true)
    })

    it("lets a reopened IPAS be cancelled", async () => {
      const ipas = await filed()
      as(superAdmin, { superAdmin: true })
      await ipasService.reopen(ipas.id, "Raised in error")
      as(buyer)
      await ipasService.cancel(ipas.id, "Raised in error")
      expect(rowOf(ipas.id).state).toBe("cancelled")
    })
  })

  describe("the Approval Center queue", () => {
    it("lists each section 7 step once it is that person's turn, and no sooner", async () => {
      const ipas = await raise()
      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      await ipasService.sign(ipas.id, 3, "prepared")

      expect(await ipasService.pendingSignoffsFor(receiver.id)).toEqual([])

      as(approver)
      await ipasService.sign(ipas.id, 1, "approved")
      expect(await ipasService.pendingSignoffsFor(receiver.id)).toEqual([])
      await ipasService.sign(ipas.id, 3, "approved")
      // Sections 1 and 2 are not enough: section 3 has to be approved too (#590).
      expect(await ipasService.pendingSignoffsFor(receiver.id)).toEqual([])
      approveSection3(ipas)

      const forReceiver = await ipasService.pendingSignoffsFor(receiver.id)
      expect(forReceiver).toHaveLength(1)
      expect(forReceiver[0]).toMatchObject({
        id: `${ipas.id}:7:received`,
        ipasId: ipas.id,
        section: 7,
        role: "received",
        number: ipas.number,
        preparedBy: { id: approver.id },
      })
      expect(forReceiver[0].steps.map((s) => s.role)).toEqual(["received", "noted", "checked", "approved"])
      // Noted and Checked wait for Received.
      expect(await ipasService.pendingSignoffsFor(noter.id)).toEqual([])
      expect(await ipasService.pendingSignoffsFor(checker.id)).toEqual([])

      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")
      expect(await ipasService.pendingSignoffsFor(receiver.id)).toEqual([])
      expect((await ipasService.pendingSignoffsFor(noter.id)).map((p) => p.role)).toEqual(["noted"])
      expect((await ipasService.pendingSignoffsFor(checker.id)).map((p) => p.role)).toEqual(["checked"])
      // The approver isn't asked for Approved until Noted and Checked are given.
      expect(await ipasService.pendingSignoffsFor(approver.id)).toEqual([])

      as(noter)
      await ipasService.sign(ipas.id, 7, "noted")
      expect(await ipasService.pendingSignoffsFor(noter.id)).toEqual([])
      as(checker)
      await ipasService.sign(ipas.id, 7, "checked")
      const forApprover = await ipasService.pendingSignoffsFor(approver.id)
      expect(forApprover.map((p) => `${p.section}/${p.role}`)).toEqual(["7/approved"])
      expect(forApprover[0].steps.filter((s) => s.signoff).map((s) => s.role)).toEqual(["received", "noted", "checked"])
    })

    it("gives a person on two section 7 lists a row for each, and drops filed and cancelled IPAS", async () => {
      db.seed("ipas_signer_lists", { list_key: "s7_checked", employee_id: noter.id })
      const ipas = await raise()
      await approveFirstSections(ipas)
      as(receiver)
      await ipasService.sign(ipas.id, 7, "received")

      const rows = await ipasService.pendingSignoffsFor(noter.id)
      expect(rows.map((r) => r.id).sort()).toEqual([`${ipas.id}:7:checked`, `${ipas.id}:7:noted`])

      // Cancelled and filed ones leave the queue.
      db.internal.rowsOf("ipas").find((r) => r.id === ipas.id).state = "cancelled"
      expect(await ipasService.pendingSignoffsFor(noter.id)).toEqual([])
    })

    it("keeps sections 1 and 3 in the same queue, with section 7 beside them", async () => {
      const ipas = await raise()
      as(buyer)
      await ipasService.sign(ipas.id, 1, "prepared")
      const other = await raise()
      await approveFirstSections(other)

      const rows = await ipasService.pendingSignoffsFor(approver.id)
      expect(rows.map((r) => `${r.number}/${r.section}`)).toEqual([`${ipas.number}/1`])
      db.seed("ipas_signer_lists", { list_key: "s7_received", employee_id: approver.id })
      const both = await ipasService.pendingSignoffsFor(approver.id)
      expect(both.map((r) => `${r.number}/${r.section}/${r.role}`).sort()).toEqual(
        [`${ipas.number}/1/approved`, `${other.number}/7/received`].sort(),
      )
    })
  })
})

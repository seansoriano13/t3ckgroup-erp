import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { http, HttpResponse } from "msw"
import { server, stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_STATUS_SOURCE } from "@/constants/ipas"
import { filingChecklist, unfiledDocuments } from "@/utils/ipasDocuments"

/**
 * IPAS documents, Supplier Origin and the buyer track (#246) through the
 * service, against the fake database with the RPCs re-implemented on its store
 * and Odoo stubbed. The database rules (who may write what, the CHECKs) are the
 * policy tier's (60-ipas-documents-statuses); what is proven here is the
 * wiring: the suggestions by Source, the two ticks and their history, With
 * P.O.P following proof of payment, Supplier Origin on Import only, and the
 * source each buyer-track status shows.
 */

const odooPo = (name) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 553, name: "Scorpe Technologies", contact: null },
  lines: [
    { line_id: 11400, product_id: 5350, name: "Cutter", quantity: 6, unit: "Unit", price_unit: 1250, price_subtotal: 7500, taxes: [], analytic: [], brand: null },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

const BASE_URL = import.meta.env.VITE_SUPABASE_URL

describe("ipasService: documents, Supplier Origin and the buyer track", () => {
  let buyer, finance, options

  const asBuyer = () => stubIpasRpcs({ actorId: buyer.id })
  const asFinance = () => stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true })

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    finance = makeEmployee({ name: "Fe", department: "FINANCE", has_finance_flow: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    asBuyer()
  })

  async function raise(source, poNumber) {
    stubEdgeFunction("odoo-po-ipas", odooPo(poNumber))
    return ipasService.create({ poNumber, priority: "high", source, purpose: "inventory" })
  }

  const read = (id) => ipasService.get(id, { refresh: false })
  const eventsOf = (...kinds) => db.rows("ipas_events").filter((e) => kinds.includes(e.kind))
  const labels = (documents) => documents.map((d) => d.label).sort()
  const doc = (opened, label) => opened.documents.find((d) => d.label === label)

  const kindsFor = (source) =>
    Object.values(options.document_kind)
      .filter((k) => k.active && [source, "both"].includes(k.applies_to))
      .map((k) => k.label)
      .sort()

  describe("documents follow the Source", () => {
    it("shows an Import IPAS the Import and Both kinds", async () => {
      const ipas = await raise("import", "P03001")

      const opened = await read(ipas.id)

      expect(labels(opened.documents)).toEqual(kindsFor("import"))
      expect(labels(opened.documents)).toContain("Bill of Lading (BL)")
      expect(labels(opened.documents)).toContain("BIR 2307")
      expect(labels(opened.documents)).not.toContain("Quotation")
      expect(opened.suggestedDocuments).toEqual([])
    })

    it("shows a Local IPAS the Local and Both kinds", async () => {
      const ipas = await raise("local", "P03002")

      const opened = await read(ipas.id)

      expect(labels(opened.documents)).toEqual(kindsFor("local"))
      expect(labels(opened.documents)).toContain("Quotation")
      expect(labels(opened.documents)).not.toContain("Bill of Lading (BL)")
    })

    it("marks each row with its kind's Source and use, and BIR 2307 as a filing item", async () => {
      const ipas = await raise("import", "P03003")

      const opened = await read(ipas.id)

      expect(doc(opened, "BIR 2307")).toMatchObject({ appliesTo: "both", usedFor: "filing", isFiling: true, byHand: false })
      expect(doc(opened, "Proforma Invoice")).toMatchObject({ usedFor: "documentation", isFiling: false })
      expect(doc(opened, "Waybill")).toMatchObject({ usedFor: "both", isFiling: true })
    })

    it("starts every row unticked and without an attachment", async () => {
      const ipas = await raise("import", "P03004")

      const opened = await read(ipas.id)

      for (const document of opened.documents) {
        expect(document).toMatchObject({ purchasingHas: false, financeHas: false, ticked: false, attachmentUrl: null })
      }
    })

    it("offers a kind added to the list later, and adds it only when asked", async () => {
      const ipas = await raise("import", "P03005")
      const added = db.seed("ipas_options", {
        list: "document_kind", label: "Insurance Certificate", sort: 500, active: true, applies_to: "import", used_for: "documentation",
      })
      const waybill = doc(await read(ipas.id), "Waybill")
      await ipasService.tickDocument(waybill.id, "purchasing", true)

      const before = await read(ipas.id)
      expect(before.suggestedDocuments.map((k) => k.label)).toEqual(["Insurance Certificate"])
      expect(labels(before.documents)).not.toContain("Insurance Certificate")

      expect(await ipasService.suggestDocuments(ipas.id)).toEqual(["Insurance Certificate"])

      const after = await read(ipas.id)
      expect(labels(after.documents)).toContain("Insurance Certificate")
      expect(after.suggestedDocuments).toEqual([])
      expect(doc(after, "Waybill").purchasingHas).toBe(true)
      expect(db.rows("ipas_documents").some((d) => d.kind_id === added.id)).toBe(true)
      expect(await ipasService.suggestDocuments(ipas.id)).toEqual([])
    })

    it("doesn't suggest a deactivated kind", async () => {
      const waybill = options.document_kind.Waybill
      db.internal.rowsOf("ipas_options").find((r) => r.id === waybill.id).active = false

      const ipas = await raise("import", "P03006")

      expect(labels((await read(ipas.id)).documents)).not.toContain("Waybill")
    })
  })

  describe("adding by hand", () => {
    it("adds a row with its own name, and an Import kind to a Local IPAS", async () => {
      const ipas = await raise("local", "P03010")

      await ipasService.addDocument(ipas.id, { label: "  Warranty card " })
      await ipasService.addDocument(ipas.id, { kindId: options.document_kind["Bill of Lading (BL)"].id })

      const opened = await read(ipas.id)
      expect(doc(opened, "Warranty card")).toMatchObject({ byHand: true, kind: null, isFiling: false })
      expect(doc(opened, "Bill of Lading (BL)")).toMatchObject({ byHand: false })
      expect(eventsOf("document_added").map((e) => [e.detail.label, e.detail.by_hand])).toEqual([
        ["Warranty card", true],
        ["Bill of Lading (BL)", false],
      ])
    })

    it("lists, as addable, the active kinds the IPAS doesn't have", async () => {
      const ipas = await raise("local", "P03011")
      const opened = await read(ipas.id)

      const { kindsToAdd } = await import("@/utils/ipasDocuments")
      const addable = kindsToAdd(opened.options, db.rows("ipas_documents").filter((d) => d.ipas_id === ipas.id)).map((k) => k.label)

      expect(addable).toContain("Bill of Lading (BL)")
      expect(addable).not.toContain("Quotation")
    })

    it("refuses a kind with a name, neither, a duplicate and a bad link", async () => {
      const ipas = await raise("import", "P03012")
      const bl = options.document_kind["Bill of Lading (BL)"]

      await expect(ipasService.addDocument(ipas.id, { kindId: bl.id, label: "x" })).rejects.toMatchObject({ code: "IPAS_INVALID" })
      await expect(ipasService.addDocument(ipas.id, {})).rejects.toMatchObject({ code: "IPAS_INVALID" })
      await expect(ipasService.addDocument(ipas.id, { kindId: bl.id })).rejects.toMatchObject({ code: "23505" })
      await ipasService.addDocument(ipas.id, { label: "Memo" })
      await expect(ipasService.addDocument(ipas.id, { label: " memo" })).rejects.toMatchObject({ code: "23505" })
      await expect(
        ipasService.addDocument(ipas.id, { label: "Photo", attachmentUrl: "javascript:alert(1)" }),
      ).rejects.toMatchObject({ code: "22023" })
    })

    it("refuses anyone without Purchasing access", async () => {
      const ipas = await raise("local", "P03013")
      asFinance()

      await expect(ipasService.addDocument(ipas.id, { label: "Memo" })).rejects.toMatchObject({ code: "42501" })
    })
  })

  describe("the two ticks", () => {
    it("lets Purchasing tick Purchasing has it and Finance tick Finance has it, each recorded with who", async () => {
      const ipas = await raise("import", "P03020")
      const waybill = doc(await read(ipas.id), "Waybill")

      await ipasService.tickDocument(waybill.id, "purchasing", true)
      asFinance()
      await ipasService.tickDocument(waybill.id, "finance", true)

      expect(doc(await read(ipas.id), "Waybill")).toMatchObject({ purchasingHas: true, financeHas: true, ticked: true })
      expect(eventsOf("document_ticked").map((e) => [e.actor_id, e.detail.side, e.detail.value, e.detail.label])).toEqual([
        [buyer.id, "purchasing", true, "Waybill"],
        [finance.id, "finance", true, "Waybill"],
      ])
    })

    it("refuses Purchasing ticking Finance has it for them, and Finance ticking Purchasing has it", async () => {
      const ipas = await raise("import", "P03021")
      const waybill = doc(await read(ipas.id), "Waybill")

      await expect(ipasService.tickDocument(waybill.id, "finance", true)).rejects.toMatchObject({ code: "42501" })
      asFinance()
      await expect(ipasService.tickDocument(waybill.id, "purchasing", true)).rejects.toMatchObject({ code: "42501" })

      expect(doc(await read(ipas.id), "Waybill")).toMatchObject({ purchasingHas: false, financeHas: false })
      expect(eventsOf("document_ticked")).toEqual([])
    })

    it("unticks, and records nothing when a tick doesn't change", async () => {
      const ipas = await raise("import", "P03022")
      const waybill = doc(await read(ipas.id), "Waybill")

      await ipasService.tickDocument(waybill.id, "purchasing")
      await ipasService.tickDocument(waybill.id, "purchasing")
      await ipasService.tickDocument(waybill.id, "purchasing", false)

      expect(eventsOf("document_ticked").map((e) => e.detail.value)).toEqual([true, false])
      expect(doc(await read(ipas.id), "Waybill").purchasingHas).toBe(false)
    })

    it("refuses a side that isn't one before asking the database", async () => {
      const ipas = await raise("import", "P03023")
      const waybill = doc(await read(ipas.id), "Waybill")

      await expect(ipasService.tickDocument(waybill.id, "warehouse", true)).rejects.toMatchObject({ code: "IPAS_INVALID" })
    })

    it("refuses a tick on a filed IPAS, Finance's included", async () => {
      const ipas = await raise("import", "P03024")
      const waybill = doc(await read(ipas.id), "Waybill")
      db.internal.rowsOf("ipas").find((r) => r.id === ipas.id).state = "filed"

      await expect(ipasService.tickDocument(waybill.id, "purchasing", true)).rejects.toMatchObject({ code: "55000" })
      asFinance()
      await expect(ipasService.tickDocument(waybill.id, "finance", true)).rejects.toMatchObject({ code: "55000" })
    })
  })

  describe("attachments, removal and the filing checklist", () => {
    it("attaches a file and removes it, keeping both in history", async () => {
      const ipas = await raise("import", "P03030")
      const bir = doc(await read(ipas.id), "BIR 2307")
      const url = "https://res.cloudinary.com/demo/raw/upload/2307.pdf"

      await ipasService.setDocument(bir.id, { attachmentUrl: ` ${url} ` })
      expect(doc(await read(ipas.id), "BIR 2307").attachmentUrl).toBe(url)

      await ipasService.setDocument(bir.id, { attachmentUrl: "" })
      expect(doc(await read(ipas.id), "BIR 2307").attachmentUrl).toBeNull()
      expect(eventsOf("document_attachment_set", "document_attachment_removed").map((e) => e.kind)).toEqual([
        "document_attachment_set",
        "document_attachment_removed",
      ])
    })

    it("removes a hand-added row, unless Finance has ticked it", async () => {
      const ipas = await raise("import", "P03031")
      const memo = await ipasService.addDocument(ipas.id, { label: "Memo" })
      const ticked = await ipasService.addDocument(ipas.id, { label: "Cover letter" })
      asFinance()
      await ipasService.tickDocument(ticked.id, "finance", true)
      asBuyer()

      await expect(ipasService.removeDocument(ticked.id)).rejects.toMatchObject({ code: "55000" })
      await ipasService.removeDocument(memo.id)

      const left = labels((await read(ipas.id)).documents)
      expect(left).not.toContain("Memo")
      expect(left).toContain("Cover letter")
      expect(eventsOf("document_removed")).toHaveLength(1)
    })

    it("refuses to remove a suggested row (one with a document kind)", async () => {
      const ipas = await raise("import", "P03033")
      const waybill = doc(await read(ipas.id), "Waybill")

      await expect(ipasService.removeDocument(waybill.id)).rejects.toMatchObject({ code: "55000" })

      expect(labels((await read(ipas.id)).documents)).toContain("Waybill")
      expect(eventsOf("document_removed")).toHaveLength(0)
    })

    it("reads the filing checklist off the same rows: a document ticked in section 3 is ticked at Filing", async () => {
      const ipas = await raise("import", "P03032")
      const waybill = doc(await read(ipas.id), "Waybill")
      const bir = doc(await read(ipas.id), "BIR 2307")
      const proforma = doc(await read(ipas.id), "Proforma Invoice")
      await ipasService.tickDocument(waybill.id, "purchasing", true)
      await ipasService.tickDocument(proforma.id, "purchasing", true)

      const opened = await read(ipas.id)
      const checklist = filingChecklist(opened.documents)

      // Filing items only: a documentation-only kind (Proforma) isn't on it.
      expect(checklist.map((d) => d.label)).not.toContain("Proforma Invoice")
      expect(checklist.find((d) => d.label === "Waybill").ticked).toBe(true)
      expect(checklist.find((d) => d.label === "BIR 2307").ticked).toBe(false)
      expect(unfiledDocuments(opened.documents).map((d) => d.label)).toContain("BIR 2307")
      expect(unfiledDocuments(opened.documents).map((d) => d.label)).not.toContain("Waybill")
      expect(bir.isFiling).toBe(true)
    })
  })

  describe("Supplier Origin", () => {
    const dates = { shippedOut: "2026-10-01", onboard: "2026-10-03", arrivedInPh: "2026-10-09", arrivedInWhs: "2026-10-11" }

    it("takes the four dates on an Import IPAS and shows them", async () => {
      const ipas = await raise("import", "P03040")

      await ipasService.setSupplierOrigin(ipas.id, dates)

      expect((await read(ipas.id)).supplierOrigin).toEqual(dates)
      expect(eventsOf("supplier_origin_changed")).toHaveLength(1)
    })

    it("changes only what is given and clears with a blank", async () => {
      const ipas = await raise("import", "P03041")
      await ipasService.setSupplierOrigin(ipas.id, dates)

      await ipasService.setSupplierOrigin(ipas.id, { onboard: "" })

      expect((await read(ipas.id)).supplierOrigin).toEqual({ ...dates, onboard: null })
    })

    it("is absent on a Local IPAS, and refused there", async () => {
      const ipas = await raise("local", "P03042")

      expect((await read(ipas.id)).supplierOrigin).toBeNull()
      await expect(ipasService.setSupplierOrigin(ipas.id, dates)).rejects.toMatchObject({ code: "22023" })
      expect(db.rows("ipas")[0].shipped_out_on ?? null).toBeNull()
      expect(eventsOf("supplier_origin_changed")).toEqual([])
    })

    it("refuses a half-typed date with a sentence, and nothing at all", async () => {
      const ipas = await raise("import", "P03043")

      await expect(ipasService.setSupplierOrigin(ipas.id, { shippedOut: "2026-10-" })).rejects.toMatchObject({
        code: "IPAS_INVALID",
        message: "Shipped Out must be a date.",
      })
      await expect(ipasService.setSupplierOrigin(ipas.id, {})).rejects.toMatchObject({ code: "IPAS_INVALID" })
    })
  })

  describe("the buyer track", () => {
    const track = async (id) => Object.fromEntries((await read(id)).buyerTrack.map((item) => [item.key, item]))
    const proofUrl = "https://res.cloudinary.com/demo/image/upload/pop.jpg"
    const payment = (over = {}) => ({
      kind: "payment",
      paidOn: "2026-10-01",
      amount: "1000",
      methodId: options.payment_method.Check.id,
      ...over,
    })

    it("lists the statuses in the sheet's order, with Import Clearance on an Import IPAS only", async () => {
      const importIpas = await raise("import", "P03050")
      const localIpas = await raise("local", "P03051")

      expect((await read(importIpas.id)).buyerTrack.map((i) => i.key)).toEqual([
        "purchase_order", "with_pop", "import_clearance", "delivered", "received_in_odoo", "create_bill", "actual_checking",
      ])
      expect((await read(localIpas.id)).buyerTrack.map((i) => i.key)).toEqual([
        "purchase_order", "with_pop", "delivered", "received_in_odoo", "create_bill", "actual_checking",
      ])
    })

    it("says where each status came from", async () => {
      const ipas = await raise("import", "P03052")

      const items = await track(ipas.id)

      expect(items.purchase_order.source).toBe(IPAS_STATUS_SOURCE.ODOO)
      expect(items.received_in_odoo.source).toBe(IPAS_STATUS_SOURCE.ODOO)
      expect(items.create_bill.source).toBe(IPAS_STATUS_SOURCE.ODOO)
      expect(items.with_pop.source).toBe(IPAS_STATUS_SOURCE.DERIVED)
      expect(items.import_clearance.source).toBe(IPAS_STATUS_SOURCE.TYPED)
      expect(items.delivered.source).toBe(IPAS_STATUS_SOURCE.TYPED)
      expect(items.actual_checking.source).toBe(IPAS_STATUS_SOURCE.STAMPED)
      expect(items.purchase_order.ticked).toBe(true)
    })

    it("stamps With P.O.P when a payment carries proof, and drops it when the proof goes", async () => {
      const ipas = await raise("local", "P03053")
      expect((await track(ipas.id)).with_pop.ticked).toBe(false)

      const bare = await ipasService.addPayment(ipas.id, payment())
      expect((await track(ipas.id)).with_pop.ticked).toBe(false)

      await ipasService.updatePayment(bare.id, payment({ proofUrl }))
      const stamped = (await track(ipas.id)).with_pop
      expect(stamped).toMatchObject({ ticked: true, source: "derived" })
      expect(stamped.detail).toMatch(/1 payment carries proof/)

      await ipasService.updatePayment(bare.id, payment({ proofUrl: "" }))
      expect((await track(ipas.id)).with_pop.ticked).toBe(false)
    })

    it("stamps With P.O.P from any one of several payments, and drops it with the payment", async () => {
      const ipas = await raise("local", "P03054")
      await ipasService.addPayment(ipas.id, payment())
      const proved = await ipasService.addPayment(ipas.id, payment({ proofUrl, amount: "500" }))
      expect((await track(ipas.id)).with_pop.ticked).toBe(true)

      await ipasService.removePayment(proved.id)

      expect((await track(ipas.id)).with_pop.ticked).toBe(false)
    })

    it("types Import Clearance and Delivered with who typed them and when", async () => {
      const ipas = await raise("import", "P03055")

      await ipasService.setTypedStatus(ipas.id, "import_clearance", "2026-10-05")
      await ipasService.setTypedStatus(ipas.id, "delivered", "2026-10-09")

      const items = await track(ipas.id)
      expect(items.import_clearance).toMatchObject({ ticked: true, on: "2026-10-05", by: { id: buyer.id, name: "Buyer" } })
      expect(items.import_clearance.at).toBeTruthy()
      expect(items.delivered).toMatchObject({ ticked: true, on: "2026-10-09", by: { id: buyer.id } })
      expect(eventsOf("status_typed").map((e) => [e.actor_id, e.detail.status, e.detail.to])).toEqual([
        [buyer.id, "import_clearance", "2026-10-05"],
        [buyer.id, "delivered", "2026-10-09"],
      ])
    })

    it("clears a typed status, who and when with it", async () => {
      const ipas = await raise("import", "P03056")
      await ipasService.setTypedStatus(ipas.id, "delivered", "2026-10-09")

      await ipasService.setTypedStatus(ipas.id, "delivered", "")

      expect((await track(ipas.id)).delivered).toMatchObject({ ticked: false, on: null, by: null, at: null })
      expect(eventsOf("status_cleared")).toHaveLength(1)
    })

    it("refuses Import Clearance on a Local IPAS, a status that isn't typed and a half-typed date", async () => {
      const ipas = await raise("local", "P03057")

      await expect(ipasService.setTypedStatus(ipas.id, "import_clearance", "2026-10-05")).rejects.toMatchObject({ code: "22023" })
      await expect(ipasService.setTypedStatus(ipas.id, "actual_checking", "2026-10-05")).rejects.toMatchObject({ code: "IPAS_INVALID" })
      await expect(ipasService.setTypedStatus(ipas.id, "delivered", "10/05")).rejects.toMatchObject({ code: "IPAS_INVALID" })
    })

    it("stamps Actual Checking by Purchasing, with who and when, and clears it", async () => {
      const ipas = await raise("local", "P03058")

      await ipasService.stampActualChecking(ipas.id)

      const stamped = (await track(ipas.id)).actual_checking
      expect(stamped).toMatchObject({ ticked: true, source: "stamped", by: { id: buyer.id, name: "Buyer" } })
      expect(stamped.at).toBeTruthy()
      expect(eventsOf("actual_checking_stamped")[0].actor_id).toBe(buyer.id)

      await ipasService.stampActualChecking(ipas.id, { stamped: false })
      expect((await track(ipas.id)).actual_checking).toMatchObject({ ticked: false, by: null })
    })

    it("refuses Actual Checking, Delivered and Import Clearance to Finance", async () => {
      const ipas = await raise("import", "P03059")
      asFinance()

      await expect(ipasService.stampActualChecking(ipas.id)).rejects.toMatchObject({ code: "42501" })
      await expect(ipasService.setTypedStatus(ipas.id, "delivered", "2026-10-09")).rejects.toMatchObject({ code: "42501" })
    })
  })

  describe("Item Location", () => {
    it("types an Item Location from the list and shows it, and clears it", async () => {
      const ipas = await raise("local", "P03060")
      const place = options.item_location["Main Warehouse"]

      await ipasService.setItemLocation(ipas.id, place.id)

      expect((await read(ipas.id)).itemLocation).toMatchObject({ id: place.id, label: "Main Warehouse" })
      expect(eventsOf("item_location_changed")[0].detail).toEqual({ from: null, to: "Main Warehouse" })

      await ipasService.setItemLocation(ipas.id, null)
      expect((await read(ipas.id)).itemLocation).toBeNull()
    })

    it("has no TG03 Location: nothing but the typed Item Location is offered", async () => {
      const ipas = await raise("local", "P03061")

      const opened = await read(ipas.id)

      expect(Object.keys(opened)).not.toContain("tg03Location")
      expect(Object.keys(opened).filter((key) => /tg03|transmittal|tsr/i.test(key))).toEqual([])
    })

    it("refuses an option of another list", async () => {
      const ipas = await raise("local", "P03062")

      await expect(ipasService.setItemLocation(ipas.id, options.payment_method.Cash.id)).rejects.toMatchObject({ code: "22023" })
    })
  })

  describe("document kinds in settings", () => {
    it("adds a document kind marked Import/Local/Both and documentation/filing/both, defaulting to both and documentation", async () => {
      const plain = await ipasService.saveOption({ list: "document_kind", label: "Inspection Report" })
      const marked = await ipasService.saveOption({ list: "document_kind", label: "Customs Permit", appliesTo: "import", usedFor: "filing" })

      expect(plain).toMatchObject({ applies_to: "both", used_for: "documentation" })
      expect(marked).toMatchObject({ applies_to: "import", used_for: "filing" })
    })

    it("re-marks a kind without losing its name, and refuses a mark that isn't one", async () => {
      const kind = options.document_kind.Quotation

      const changed = await ipasService.saveOption({ id: kind.id, list: "document_kind", label: "Quotation", appliesTo: "both", usedFor: "both" })

      expect(changed).toMatchObject({ id: kind.id, applies_to: "both", used_for: "both" })
      await expect(
        ipasService.saveOption({ id: kind.id, list: "document_kind", label: "Quotation", appliesTo: "everywhere" }),
      ).rejects.toMatchObject({ code: "IPAS_INVALID" })
    })

    it("says so in a sentence when the database refuses a change to an option a filed IPAS uses (55000)", async () => {
      const kind = options.document_kind.Quotation
      server.use(
        http.patch(`${BASE_URL}/rest/v1/ipas_options`, () =>
          HttpResponse.json(
            { code: "55000", message: 'ipas_options: "Quotation" is used on a filed IPAS. Deactivate it and add a new one instead.', details: null, hint: null },
            { status: 400 },
          ),
        ),
      )

      await expect(ipasService.saveOption({ id: kind.id, list: "document_kind", label: "Price Quote" })).rejects.toMatchObject({
        name: "IpasError",
        code: "IPAS_OPTION_ON_FILED",
        message: expect.stringMatching(/used on a filed IPAS.*Deactivate it and add a new one instead/),
      })
    })

    it("lists the option ids a filed IPAS uses, and only those", async () => {
      const filed = await raise("local", "P03070")
      const open = await raise("local", "P03071")
      const stillOpen = options.freight_service["DHL Express"]
      const used = options.freight_service.FedEx
      db.internal.rowsOf("ipas").find((r) => r.id === filed.id).state = "filed"
      db.internal.rowsOf("ipas").find((r) => r.id === filed.id).freight_service_id = used.id
      db.internal.rowsOf("ipas").find((r) => r.id === open.id).freight_service_id = stillOpen.id
      db.internal.rowsOf("ipas_documents").filter((d) => d.ipas_id === filed.id).forEach((d) => { d.kind_id = options.document_kind.Waybill.id })

      const ids = await ipasService.listFiledOptionIds()

      expect(ids).toContain(used.id)
      expect(ids).toContain(options.document_kind.Waybill.id)
      expect(ids).not.toContain(stillOpen.id)
    })

    it("lists none when the lookup isn't available", async () => {
      stubIpasRpcs({ actorId: buyer.id, reader: false })

      expect(await ipasService.listFiledOptionIds()).toEqual([])
    })

    it("marks no other list's options", async () => {
      const place = await ipasService.saveOption({ list: "item_location", label: "Back office", appliesTo: "import", usedFor: "filing" })

      expect(place.applies_to ?? null).toBeNull()
      expect(place.used_for ?? null).toBeNull()
    })
  })
})

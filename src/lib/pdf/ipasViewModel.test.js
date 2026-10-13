import { describe, expect, it } from "vitest"
import { buildIpasViewModel, maskAccountNumber, printAmount, printDate, printDateTime } from "./ipasViewModel"
import { BAUTISTA, CRUZ, RAMOS, makePrintableIpas, signoffRow } from "@/test/ipasPrint"

/**
 * The printed IPAS's view model (#250): what the paper says, from
 * `ipasService.get`'s result. The fixture goes through the real `shapeIpas`.
 */

const FILED = { state: "filed", filed_at: "2026-09-16T02:00:00.000Z" }

const vm = (ipasOptions, printOptions) => buildIpasViewModel(makePrintableIpas(ipasOptions), printOptions)

describe("formatting", () => {
  it("prints amounts with the currency code, and Odoo's Php as PHP", () => {
    expect(printAmount(640, "USD")).toBe("USD 640.00")
    expect(printAmount(36160, "Php")).toBe("PHP 36,160.00")
    expect(printAmount(null, "USD")).toBe("—")
    expect(printAmount("not a number", "USD")).toBe("—")
  })

  it("prints times in the company's timezone, wherever the browser is", () => {
    expect(printDateTime("2026-09-15T01:12:00.000Z")).toBe("Sep 15, 2026 09:12")
    expect(printDate("2026-09-15T17:00:00.000Z")).toBe("Sep 16, 2026")
    expect(printDateTime(null)).toBeNull()
    expect(printDateTime("garbage")).toBeNull()
  })
})

describe("maskAccountNumber", () => {
  it("shows the last four and nothing before them", () => {
    expect(maskAccountNumber("0012 3456 7890 4417")).toBe("•••• 4417")
    expect(maskAccountNumber("001-234-567-8")).toBe("•••• 5678")
    expect(maskAccountNumber("  123456789  ")).toBe("•••• 6789")
  })

  it("masks a number too short to have a last four of its own", () => {
    expect(maskAccountNumber("4417")).toBe("••••")
    expect(maskAccountNumber("12")).toBe("••••")
  })

  it("leaves a blank number blank", () => {
    expect(maskAccountNumber("")).toBeNull()
    expect(maskAccountNumber("  ")).toBeNull()
    expect(maskAccountNumber(null)).toBeNull()
  })
})

describe("bank details and account numbers", () => {
  it("masks the account number to the last four on an ordinary print", () => {
    const { bank } = vm().section3

    expect(bank).toMatchObject({ present: true, bankName: "BDO Unibank", accountNumber: "•••• 4417", masked: true })
    expect(JSON.stringify(vm())).not.toContain("0012 3456 7890")
  })

  it("prints the number in full only on the filing copy of a filed IPAS", () => {
    const model = vm({ row: FILED }, { filingCopy: true })

    expect(model.filingCopy).toBe(true)
    expect(model.section3.bank).toMatchObject({ accountNumber: "0012 3456 7890 4417", masked: false })
  })

  it("ignores a filing copy request on an open or cancelled IPAS and prints it masked", () => {
    for (const state of ["open", "cancelled"]) {
      const model = vm({ row: { state } }, { filingCopy: true })

      expect(model.filingCopy).toBe(false)
      expect(model.section3.bank).toMatchObject({ accountNumber: "•••• 4417", masked: true })
      expect(JSON.stringify(model)).not.toContain("0012 3456 7890")
    }
  })

  it("prints no bank details for someone who can't read them, filing copy included", () => {
    const ordinary = vm({ canReadBankDetails: false })
    const filing = vm({ canReadBankDetails: false, row: FILED }, { filingCopy: true })

    expect(ordinary.section3.bank).toBeNull()
    expect(filing.section3.bank).toBeNull()
    expect(JSON.stringify(filing)).not.toMatch(/BDO|4417|Redleaf Medical Supplies","accountNumber/)
  })

  it("drops bank details even if a caller hands over a row the person may not read", () => {
    const ipas = { ...makePrintableIpas({ canReadBankDetails: false, row: FILED }), bankDetails: { bankName: "BDO", accountName: "X", accountNumber: "9999 8888 7777", flagged: false } }

    expect(buildIpasViewModel(ipas, { filingCopy: true }).section3.bank).toBeNull()
  })

  it("says none were typed, for a reader with nothing on file", () => {
    expect(vm({ bank: null }).section3.bank).toMatchObject({ present: false, accountNumber: null })
  })

  it("carries the changed-account flag", () => {
    const bank = { bank_name: "BDO", account_name: "Redleaf", account_number: "11112222", account_flagged: true }

    expect(vm({ bank }).section3.bank.flagged).toBe(true)
  })
})

describe("Landed Cost mark", () => {
  it("is provisional on an unfiled IPAS before Costs complete", () => {
    const { landedCost } = vm({ row: { computation_status: "encoded" } }).section6

    expect(landedCost.status).toBe("provisional")
    expect(landedCost.label).toBe("Provisional")
  })

  it("turns final once Costs complete is reached", () => {
    expect(vm({ row: { computation_status: "costs_complete" } }).section6.landedCost.status).toBe("final")
    expect(vm({ row: { computation_status: "checked" } }).section6.landedCost.status).toBe("final")
  })

  it("is always final on a filed IPAS, whatever the computation status says", () => {
    const filed = vm({ row: { state: "filed", filed_at: "2026-09-20T02:00:00.000Z", computation_status: "encoding" } })
    expect(filed.section6.landedCost.status).toBe("final")
    expect(filed.footer.landedCost).toBe("Landed Cost final")

    // A stale provisional figure handed over with a filed IPAS still prints final.
    const stale = makePrintableIpas({ row: { state: "filed", filed_at: "2026-09-20T02:00:00.000Z" } })
    stale.landedCost = { ...stale.landedCost, status: "provisional" }
    expect(buildIpasViewModel(stale).section6.landedCost.status).toBe("final")
  })

  it("prints per unit and in total, converted at the rate paid", () => {
    const lc = vm().section6.landedCost

    // Paid PHP 42,960 for USD 760, a rate of 56.5263. Goods 2 x 640 x 56.5263 =
    // 72,353.68, plus 14,070 charges, 350 charge fee and 6,800 shipping.
    expect(lc.lines).toHaveLength(1)
    expect(lc.lines[0]).toMatchObject({
      name: "Ambulance Folding Stretcher",
      quantity: 2,
      perUnit: "PHP 46,786.84",
      total: "PHP 93,573.68",
    })
    expect(lc.total).toBe("PHP 93,573.68")
    expect(lc.note).toMatch(/56\.5263 PHP per USD/)
  })

  it("says Landed Cost isn't available, rather than printing a guess", () => {
    const lc = vm({ extras: { payments: [] } }).section6.landedCost

    expect(lc.status).toBe("unavailable")
    expect(lc.lines).toEqual([])
    expect(lc.total).toBeNull()
    expect(lc.note).toMatch(/needs a payment with the PHP debited/)
    expect(vm({ extras: { payments: [] } }).footer.landedCost).toBeNull()
  })
})

describe("Odoo marks and the read time", () => {
  it("marks the three statuses Odoo stamps, and no others", () => {
    const track = vm().section6.buyerTrack
    const stamped = track.filter((item) => item.stampedFromOdoo).map((item) => item.key)

    expect(stamped).toEqual(["purchase_order", "received_in_odoo", "create_bill"])
    expect(track.find((item) => item.key === "delivered").stampedFromOdoo).toBe(false)
    expect(track.find((item) => item.key === "with_pop").stampedFromOdoo).toBe(false)
    expect(vm().section6.hasOdooMarks).toBe(true)
  })

  it("says what Odoo says about each stamped status", () => {
    const byKey = Object.fromEntries(vm().section6.buyerTrack.map((item) => [item.key, item]))

    expect(byKey.purchase_order).toMatchObject({ ticked: true, detail: "Purchase order" })
    expect(byKey.received_in_odoo).toMatchObject({ ticked: false, partial: true, detail: "Partly received · 1 of 2 receipts" })
    expect(byKey.create_bill).toMatchObject({ ticked: true, detail: "1 draft bill" })
  })

  it("shows a typed status with its date and who typed it", () => {
    const delivered = vm().section6.buyerTrack.find((item) => item.key === "delivered")

    expect(delivered).toMatchObject({ ticked: true, detail: "Sep 14, 2026 · typed by J. Bautista" })
  })

  it("prints the Odoo read time in the footer", () => {
    expect(vm().footer.odooRead).toBe("Odoo copy read Sep 15, 2026 09:12")
    expect(vm({ row: { odoo_fetched_at: null } }).footer.odooRead).toBe("Odoo copy not read yet")
  })

  it("says when Odoo didn't answer at print, so a stale copy isn't passed off as fresh", () => {
    const stale = vm({ refresh: { ok: false, reason: "IPAS_ODOO_UNAVAILABLE", fetchedAt: "2026-09-15T01:12:00.000Z" } })
    const fresh = vm({ refresh: { ok: true, changed: false, fetchedAt: "2026-09-15T01:12:00.000Z" } })

    expect(stale.footer.odooNote).toMatch(/Odoo didn't answer/)
    expect(fresh.footer.odooNote).toBeNull()
  })

  it("says a filed IPAS's copy is frozen at filing", () => {
    expect(vm({ row: { state: "filed", filed_at: "2026-09-20T02:00:00.000Z" } }).footer.odooNote).toBe("frozen at filing")
  })
})

describe("sign-off boxes", () => {
  const boxes = (options) => {
    const model = vm(options)
    return { s1: model.section1.signoffs, s3: model.section3.signoffs, s7: model.section7.signoffs }
  }

  it("prints a stored signature as the signature, with the version the signer signed with", () => {
    const [prepared, approved] = boxes().s1

    expect(prepared).toMatchObject({
      role: "Prepared by",
      who: "J. Bautista",
      title: "Purchasing",
      state: "signed",
      signaturePath: "emp-bautista/signature.png",
      signatureDeclined: false,
    })
    expect(prepared.stamp).toBe("e-signed Sep 12, 2026 14:05")
    expect(approved).toMatchObject({ role: "Approved by", who: "M. Ramos", signaturePath: "emp-ramos/signature.png" })
  })

  it("prints the name only for a signer with no stored signature", () => {
    const { s1 } = boxes({
      signoffs: [
        signoffRow(1, "prepared", BAUTISTA),
        signoffRow(1, "approved", RAMOS, { signature_version: null }),
      ],
    })

    expect(s1[1]).toMatchObject({ who: "M. Ramos", state: "signed", signaturePath: null, signatureDeclined: false })
    expect(s1[1].stamp).toMatch(/name only/)
  })

  it("prints the name only for a signer who chose not to sign, even though a signature is on file", () => {
    const { s1 } = boxes({
      signoffs: [
        signoffRow(1, "prepared", BAUTISTA, { signature_declined: true, signature_version: null }),
        signoffRow(1, "approved", RAMOS, { signature_declined: true }),
      ],
    })

    expect(s1[0]).toMatchObject({ state: "signed", signaturePath: null, signatureDeclined: true })
    expect(s1[1]).toMatchObject({ state: "signed", signaturePath: null, signatureDeclined: true })
    expect(s1[1].stamp).toMatch(/signature not applied/)
  })

  it("prints 'Signature required' for a box still waiting for its signer", () => {
    const { s1, s3, s7 } = boxes()

    expect(s1.every((box) => box.state === "signed")).toBe(true)
    expect(s3[0].state).toBe("signed")
    expect(s3[1]).toMatchObject({ role: "Approved by", who: "", state: "awaiting", signaturePath: null })
    expect(s7.map((box) => box.state)).toEqual(["awaiting", "awaiting", "awaiting", "awaiting"])
  })

  it("treats a cleared sign-off as waiting again", () => {
    const { s1 } = boxes({
      signoffs: [
        signoffRow(1, "prepared", BAUTISTA, { cleared_at: "2026-09-13T01:00:00.000Z", cleared_reason: "PO changed" }),
        signoffRow(1, "approved", RAMOS, { cleared_at: "2026-09-13T01:00:00.000Z", cleared_reason: "PO changed" }),
      ],
    })

    expect(s1.map((box) => box.state)).toEqual(["awaiting", "awaiting"])
  })

  it("lays section 7 out as Received, Noted, Checked and Approved", () => {
    const { s7 } = boxes({
      signoffs: [
        signoffRow(1, "approved", RAMOS),
        signoffRow(3, "approved", RAMOS),
        signoffRow(7, "received", CRUZ),
        signoffRow(7, "noted", RAMOS, { signature_version: null }),
      ],
    })

    expect(s7.map((box) => box.role)).toEqual(["Received by", "Noted by", "Checked by", "Approved by"])
    expect(s7.map((box) => box.state)).toEqual(["signed", "signed", "awaiting", "awaiting"])
    expect(s7[1].signaturePath).toBeNull()
    expect(s7[0].title).toBe("Filing")
  })
})

describe("the page's content", () => {
  it("carries the header the ticket lists", () => {
    const { header } = vm()

    expect(header).toMatchObject({
      priority: "High",
      source: "Import",
      purpose: "Project",
      created: "Sep 2, 2026",
      createdBy: "J. Bautista",
    })
    expect(header.entity.value).toBe("TG Enterprise")
  })

  it("carries section 1: supplier, currency, PO, P.I #, items and the payments table", () => {
    const { section1 } = vm()

    expect(section1).toMatchObject({
      supplier: "Redleaf Medical Supplies",
      currency: "USD",
      poNumber: "P02445",
      piNumber: "PI-RL-2026-118",
    })
    expect(section1.items).toEqual([
      expect.objectContaining({ name: "Ambulance Folding Stretcher", brand: "Redleaf", quantity: "2 Unit", unitPrice: "USD 640.00", amount: "USD 1,280.00" }),
    ])
    expect(section1.payments).toEqual([
      expect.objectContaining({
        kind: "Down payment",
        amount: "USD 640.00",
        phpDebited: "PHP 36,160.00",
        chargeFee: "PHP 350.00",
        method: "Bank TT",
        proofOfPayment: true,
      }),
      expect.objectContaining({ kind: "Shipping fee", chargeFee: "—", proofOfPayment: false }),
    ])
    expect(section1.totalDebited).toBe("PHP 43,310.00")
  })

  it("prints a PHP PO's amount as the PHP debited", () => {
    const row = {
      odoo_copy: { ...makePrintableIpas().odoo_copy, po: { ...makePrintableIpas().odoo_copy.po, currency: "Php" } },
    }

    expect(vm({ row }).section1.payments[0]).toMatchObject({ amount: "PHP 640.00", phpDebited: "PHP 640.00" })
  })

  it("carries section 3: charges, both ticks on every document, and the total", () => {
    const { section3 } = vm()

    expect(section3.charges).toEqual([
      { kind: "Brokerage Fee", date: "Sep 12, 2026", amount: "PHP 4,200.00" },
      { kind: "Duties & Taxes", date: "Sep 12, 2026", amount: "PHP 9,870.00" },
    ])
    expect(section3.chargesTotal).toBe("PHP 14,070.00")
    expect(section3.documents).toEqual([
      { label: "Proforma Invoice", purchasing: true, finance: true },
      { label: "Waybill", purchasing: true, finance: false },
      { label: "BIR 2307", purchasing: false, finance: false },
    ])
  })

  it("carries section 2: SORs (no customer), Source Doc. and Analytic Dist.", () => {
    const { section2 } = vm()

    expect(section2.sors).toEqual([{ reference: "S07983", title: "Emergency Response Vehicle" }])
    expect(section2.customers).toBeUndefined()
    expect(section2.sourceDoc.value).toBe("S07983")
    expect(section2.analytic.value).toBe("S07983 Emergency Response Vehicle")
  })

  it("carries section 2's two ticks, off unless ticked", () => {
    expect(vm().section2).toMatchObject({ googleSheet: false, ganttChart: false })
    expect(vm({ row: { google_sheet: true } }).section2).toMatchObject({ googleSheet: true, ganttChart: false })
  })

  it("notes an override beside the value Odoo has", () => {
    const { header } = vm({ row: { entity_override: "T3ck Trading" } })

    expect(header.entity).toEqual({ value: "T3ck Trading", overridden: true, odoo: "TG Enterprise" })
  })

  it("carries section 5's Item Location", () => {
    expect(vm().section5).toEqual({ itemLocation: "BM Office" })
  })

  it("prints Supplier Origin on an Import IPAS and leaves it out of a Local one", () => {
    expect(vm().section6.origin).toEqual([
      { label: "Shipped Out", date: "Sep 5, 2026" },
      { label: "Onboard", date: "Sep 6, 2026" },
      { label: "Arrived in PH", date: "Sep 9, 2026" },
      { label: "Arrived in Whs.", date: null },
    ])
    expect(vm({ row: { source: "local" } }).section6.origin).toBeNull()
  })

  it("carries the computation ladder and section 7's checklist", () => {
    const model = vm({ row: { computation_status: "encoded" } })

    expect(model.section6.computation.map((c) => [c.label, c.reached, c.current])).toEqual([
      ["Encoding", true, false],
      ["Encoded", true, true],
      ["Costs complete", false, false],
      ["Checked by", false, false],
    ])
    expect(model.section7.checklist).toEqual([
      expect.objectContaining({ label: "Costs complete", ticked: false }),
      expect.objectContaining({ label: "Waybill", ticked: true, detail: "Purchasing" }),
      expect.objectContaining({ label: "BIR 2307", ticked: false }),
    ])
  })

  it("has no section 4 and no Transmittals stub", () => {
    const model = vm()

    expect(Object.keys(model)).not.toContain("section4")
    expect(JSON.stringify(model)).not.toMatch(/transmittal/i)
  })

  it("says where the IPAS stands: open, filed or cancelled", () => {
    expect(vm().stateLabel).toBe("Open · not yet filed")
    expect(vm({ row: { state: "filed", filed_at: "2026-09-20T02:00:00.000Z" } }).stateLabel).toBe("Filed Sep 20, 2026")
    expect(vm({ row: { state: "cancelled" } }).stateLabel).toBe("Cancelled")
  })

  it("puts who printed it and when in the footer, and the SOR reference in its reference", () => {
    const model = vm({}, { printedAt: "2026-09-15T02:30:00.000Z", printedBy: "R. Cruz" })

    expect(model.footer.printed).toBe("Printed Sep 15, 2026 10:30 by R. Cruz")
    expect(model.footer.reference).toBe("TGIPAS_050 · S07983")
  })

  it("refuses to print nothing", () => {
    expect(() => buildIpasViewModel(null)).toThrow(/IPAS is needed/)
  })
})

import { beforeEach, describe, expect, it } from "vitest"
import { ipasService } from "./ipasService"
import { db } from "@/test/db/store"
import { stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import {
  IPAS_ERROR,
  IPAS_LANDED_COST_REASON,
  IPAS_LANDED_COST_STATUS,
  IPAS_OPTION_LIST,
} from "@/constants/ipas"

/**
 * IPAS payments, charges and Landed Cost (#244) through the service, against
 * the fake database with the RPCs re-implemented on its store and Odoo stubbed.
 * The database rules are the policy tier's (58-ipas-payments-charges); what is
 * proven here is the wiring, the half-typed-input guards and what the screens
 * read back from `get`: header amounts, rows with their option labels, and
 * Landed Cost with its provisional or final mark.
 */

const line = (id, quantity, price_unit, over = {}) => ({
  line_id: id,
  product_id: id * 10,
  name: `Item ${id}`,
  quantity,
  unit: "Unit",
  price_unit,
  price_subtotal: quantity * price_unit,
  taxes: [],
  analytic: [],
  brand: null,
  ...over,
})

const odooPo = ({ name = "P02552", currency = "Php", lines }) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency, origin: null, partner_ref: null },
  supplier: { id: 553, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines,
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

describe("ipasService: payments, charges and Landed Cost", () => {
  let buyer, finance, options

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    finance = makeEmployee({ name: "Fe", department: "FINANCE", has_finance_flow: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    stubIpasRpcs({ actorId: buyer.id })
  })

  /** Raises an IPAS against a stubbed PO. */
  async function raise({ currency = "Php", lines = [line(11400, 6, 1250)], poNumber = "P02552" } = {}) {
    stubEdgeFunction("odoo-po-ipas", odooPo({ name: poNumber, currency, lines }))
    return ipasService.create({ poNumber, priority: "high", source: currency === "Php" ? "local" : "import", purpose: "inventory" })
  }

  const read = (id) => ipasService.get(id, { refresh: false })
  const kinds = () => db.rows("ipas_events").map((e) => e.kind)

  const peso = (over = {}) => ({
    kind: "payment",
    paidOn: "2026-10-01",
    amount: "8325",
    chargeFeePhp: "",
    methodId: options.payment_method["Dated Check"].id,
    ...over,
  })

  describe("payments", () => {
    it("records any number of payments and keeps each one in history", async () => {
      const ipas = await raise()

      await ipasService.addPayment(ipas.id, peso({ kind: "down_payment", amount: "3000", checkNo: " CHK-1 " }))
      await ipasService.addPayment(ipas.id, peso({ kind: "payment", amount: "2000" }))
      await ipasService.addPayment(ipas.id, peso({ kind: "full_payment", amount: "3325", paidOn: "2026-10-09" }))

      const rows = db.rows("ipas_payments")
      expect(rows).toHaveLength(3)
      expect(rows[0]).toMatchObject({ kind: "down_payment", amount: 3000, check_no: "CHK-1", created_by: buyer.id })
      expect(rows[0].php_debited).toBeNull()
      expect(kinds()).toEqual(["created", "payment_added", "payment_added", "payment_added"])

      const opened = await read(ipas.id)
      expect(opened.payments.map((p) => [p.kind, p.methodLabel])).toEqual([
        ["down_payment", "Dated Check"],
        ["payment", "Dated Check"],
        ["full_payment", "Dated Check"],
      ])
    })

    it("derives DP and FP from the rows, types P.I/QT Amount, and computes no balance", async () => {
      const ipas = await raise()
      await ipasService.addPayment(ipas.id, peso({ kind: "down_payment", amount: "3000" }))
      await ipasService.addPayment(ipas.id, peso({ kind: "full_payment", amount: "5325" }))
      await ipasService.setHeader(ipas.id, { piQtAmount: "8,400" })

      const opened = await read(ipas.id)

      expect(opened.piQtAmount).toBe(8400)
      expect(opened.paymentSummary).toMatchObject({ downPayment: 3000, fullPayment: 5325, paid: 8325 })
      expect(opened.paymentSummary).not.toHaveProperty("balance")
      expect(opened).not.toHaveProperty("balance")
    })

    it("refuses a foreign-currency payment with no PHP debited, and writes nothing", async () => {
      const ipas = await raise({ currency: "USD" })

      for (const phpDebited of ["", "0", undefined]) {
        await expect(
          ipasService.addPayment(ipas.id, peso({ amount: "640", phpDebited }), { isPhpPo: false }),
        ).rejects.toMatchObject({ code: IPAS_ERROR.INVALID, message: expect.stringMatching(/PHP actually debited/) })
      }
      expect(db.rows("ipas_payments")).toEqual([])
      expect(kinds()).toEqual(["created"])
    })

    it("refuses a foreign payment with no PHP debited at the database too, if the screen didn't ask", async () => {
      const ipas = await raise({ currency: "USD" })

      await expect(ipasService.addPayment(ipas.id, peso({ amount: "640" }), { isPhpPo: true })).rejects.toMatchObject({
        code: "22023",
        message: expect.stringMatching(/foreign-currency PO/),
      })
      expect(db.rows("ipas_payments")).toEqual([])
    })

    it("stores the PHP debited and the charge fee on a foreign payment", async () => {
      const ipas = await raise({ currency: "USD" })

      await ipasService.addPayment(
        ipas.id,
        peso({ kind: "down_payment", amount: "640", phpDebited: "36,160", chargeFeePhp: "350" }),
        { isPhpPo: false },
      )

      expect(db.rows("ipas_payments")[0]).toMatchObject({ amount: 640, php_debited: 36160, charge_fee_php: 350 })
    })

    it.each([
      ["a half-typed amount", { amount: "12abc" }],
      ["no amount", { amount: "" }],
      ["a zero amount", { amount: "0" }],
      ["a half-typed charge fee", { chargeFeePhp: "1.2.3" }],
      ["a half-typed date", { paidOn: "2026-10-" }],
      ["no method", { methodId: "" }],
      ["a kind that isn't one", { kind: "refund" }],
    ])("refuses %s with a sentence, and never calls the database", async (_, over) => {
      const ipas = await raise()
      const before = kinds().length

      const failure = await ipasService.addPayment(ipas.id, peso(over)).catch((error) => error)

      expect(failure.name).toBe("IpasError")
      expect(failure.code).toBe(IPAS_ERROR.INVALID)
      expect(failure.message).toMatch(/\w+ /)
      expect(db.rows("ipas_payments")).toEqual([])
      expect(kinds()).toHaveLength(before)
    })

    it("changes a payment, keeping what changed in history, and removes it keeping a snapshot", async () => {
      const ipas = await raise({ currency: "USD" })
      const payment = await ipasService.addPayment(
        ipas.id,
        peso({ kind: "down_payment", amount: "640", phpDebited: "36160" }),
        { isPhpPo: false },
      )

      await ipasService.updatePayment(
        payment.id,
        peso({ kind: "full_payment", amount: "640", phpDebited: "36240", chargeFeePhp: "350", methodId: options.payment_method.Alipay.id }),
        { isPhpPo: false },
      )

      expect(db.rows("ipas_payments")[0]).toMatchObject({ kind: "full_payment", php_debited: 36240, charge_fee_php: 350 })
      const changed = db.rows("ipas_events").find((e) => e.kind === "payment_changed")
      expect(changed.detail.changes).toMatchObject({
        kind: { from: "down_payment", to: "full_payment" },
        php_debited: { from: 36160, to: 36240 },
        method: { from: "Dated Check", to: "Alipay" },
      })

      await ipasService.removePayment(payment.id)

      expect(db.rows("ipas_payments")).toEqual([])
      const removed = db.rows("ipas_events").find((e) => e.kind === "payment_removed")
      expect(removed.detail).toMatchObject({ kind: "full_payment", php_debited: 36240, method: "Alipay", currency: "USD" })
    })

    it("stamps With P.O.P from proof of payment, and takes it off when the proof goes", async () => {
      const ipas = await raise()
      const payment = await ipasService.addPayment(ipas.id, peso({ proofUrl: "https://res.cloudinary.com/demo/pop.png" }))

      expect((await read(ipas.id)).paymentSummary.hasProof).toBe(true)

      await ipasService.updatePayment(payment.id, peso({ proofUrl: "" }))
      expect((await read(ipas.id)).paymentSummary.hasProof).toBe(false)
    })

    it("refuses a payment on a filed or cancelled IPAS", async () => {
      const filed = await raise()
      const payment = await ipasService.addPayment(filed.id, peso())
      db.internal.rowsOf("ipas").find((r) => r.id === filed.id).state = "filed"

      await expect(ipasService.addPayment(filed.id, peso())).rejects.toMatchObject({ code: "55000" })
      await expect(ipasService.updatePayment(payment.id, peso({ amount: "1" }))).rejects.toMatchObject({ code: "55000" })
      await expect(ipasService.removePayment(payment.id)).rejects.toMatchObject({ code: "55000" })
      expect(db.rows("ipas_payments")).toHaveLength(1)
    })

    it("is open to Finance access without Purchasing, and refused to anyone else", async () => {
      const ipas = await raise()

      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true })
      await expect(ipasService.addPayment(ipas.id, peso())).resolves.toMatchObject({ created_by: finance.id })
      await expect(ipasService.setHeader(ipas.id, { piQtAmount: "1" })).rejects.toMatchObject({ code: "42501" })

      stubIpasRpcs({ actorId: buyer.id, purchasing: false, money: false })
      await expect(ipasService.addPayment(ipas.id, peso())).rejects.toMatchObject({ code: "42501" })
      expect(db.rows("ipas_payments")).toHaveLength(1)
    })

    it("refuses a deactivated method for a new payment but keeps it on the payment that used it", async () => {
      const ipas = await raise()
      const used = await ipasService.addPayment(ipas.id, peso({ methodId: options.payment_method.Alipay.id }))
      await ipasService.deactivateOption(options.payment_method.Alipay.id)

      await expect(
        ipasService.addPayment(ipas.id, peso({ methodId: options.payment_method.Alipay.id })),
      ).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/deactivated/) })

      const opened = await read(ipas.id)
      expect(opened.payments[0]).toMatchObject({ id: used.id, methodLabel: "Alipay" })
      expect(opened.payments[0].method.active).toBe(false)

      await expect(
        ipasService.updatePayment(used.id, peso({ methodId: options.payment_method.Alipay.id, amount: "9000" })),
      ).resolves.toMatchObject({ amount: 9000 })
    })
  })

  describe("charges", () => {
    const charge = (over = {}) => ({
      kindId: options.charge_kind["Brokerage Fee"].id,
      chargedOn: "2026-10-12",
      amountPhp: "4,200",
      ...over,
    })

    it("adds, edits and removes charges, each kept in history, and reads them back with their kinds", async () => {
      const ipas = await raise()

      const first = await ipasService.addCharge(ipas.id, charge())
      await ipasService.addCharge(ipas.id, charge({ kindId: options.charge_kind["Duties & Taxes"].id, amountPhp: "9870" }))
      await ipasService.updateCharge(first.id, charge({ amountPhp: "4500" }))

      let opened = await read(ipas.id)
      expect(opened.charges.map((c) => [c.kindLabel, c.amount_php])).toEqual([
        ["Brokerage Fee", 4500],
        ["Duties & Taxes", 9870],
      ])
      expect(opened.paymentSummary.chargesPhp).toBe(14370)

      await ipasService.removeCharge(first.id)
      opened = await read(ipas.id)
      expect(opened.charges).toHaveLength(1)

      expect(kinds()).toEqual(["created", "charge_added", "charge_added", "charge_changed", "charge_removed"])
      expect(db.rows("ipas_events").find((e) => e.kind === "charge_changed").detail.changes).toMatchObject({
        amount_php: { from: 4200, to: 4500 },
      })
    })

    it.each([
      ["a half-typed amount", { amountPhp: "42,0O0" }],
      ["a zero amount", { amountPhp: "0" }],
      ["no kind", { kindId: "" }],
      ["no date", { chargedOn: "" }],
    ])("refuses %s before asking the database", async (_, over) => {
      const ipas = await raise()
      await expect(ipasService.addCharge(ipas.id, charge(over))).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
      expect(db.rows("ipas_charges")).toEqual([])
    })

    it("refuses a payment method as a charge kind", async () => {
      const ipas = await raise()
      await expect(
        ipasService.addCharge(ipas.id, charge({ kindId: options.payment_method["Dated Check"].id })),
      ).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/charge kind/) })
    })

    it("is open to Finance access", async () => {
      const ipas = await raise()
      stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true })
      await expect(ipasService.addCharge(ipas.id, charge())).resolves.toMatchObject({ created_by: finance.id })
    })
  })

  describe("Landed Cost, read through get", () => {
    it("gives the sample P02552 (6 x 1,250, pesos) a unit price of 1,250, not a figure from the 8,325 paid", async () => {
      const ipas = await raise()
      await ipasService.addPayment(ipas.id, peso({ kind: "full_payment", amount: "8325" }))

      const { landedCost } = await read(ipas.id)

      expect(landedCost.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
      expect(landedCost.lines).toEqual([
        expect.objectContaining({ lineId: 11400, quantity: 6, unitPricePhp: 1250, goodsPhp: 7500, landedPhp: 7500, landedPerUnitPhp: 1250 }),
      ])
    })

    it("converts a USD IPAS at the combined PHP / combined USD of its payments", async () => {
      const ipas = await raise({ currency: "USD", lines: [line(1, 10, 20), line(2, 5, 40)] })
      await ipasService.addPayment(
        ipas.id,
        peso({ kind: "down_payment", amount: "150", phpDebited: "8400", chargeFeePhp: "300" }),
        { isPhpPo: false },
      )
      await ipasService.addPayment(
        ipas.id,
        peso({ kind: "full_payment", amount: "250", phpDebited: "14350", chargeFeePhp: "200" }),
        { isPhpPo: false },
      )
      await ipasService.addCharge(ipas.id, { kindId: options.charge_kind["Brokerage Fee"].id, chargedOn: "2026-10-12", amountPhp: "1000" })
      await ipasService.addCharge(ipas.id, { kindId: options.charge_kind["Duties & Taxes"].id, chargedOn: "2026-10-12", amountPhp: "2000" })

      const { landedCost } = await read(ipas.id)

      expect(landedCost.rate).toMatchObject({ phpDebited: 22750, foreignPaid: 400, payments: 2 })
      expect(landedCost.rate.rate).toBeCloseTo(56.875, 10)
      expect(landedCost.lines.map((l) => [l.unitPricePhp, l.landedPhp, l.landedPerUnitPhp])).toEqual([
        [1137.5, 13125, 1312.5],
        [2275, 13125, 2625],
      ])
    })

    it("is not available on a USD IPAS with no payments, and says why", async () => {
      const ipas = await raise({ currency: "USD" })
      await ipasService.addCharge(ipas.id, { kindId: options.charge_kind["Brokerage Fee"].id, chargedOn: "2026-10-12", amountPhp: "1000" })

      const { landedCost } = await read(ipas.id)

      expect(landedCost.status).toBe(IPAS_LANDED_COST_STATUS.UNAVAILABLE)
      expect(landedCost.reason).toBe(IPAS_LANDED_COST_REASON.NO_PAYMENTS)
      expect(landedCost.lines).toEqual([])
    })

    describe("spread by value, by quantity and equally", () => {
      // 700 of goods; 700 of charges, charge fee and shipping fee to spread.
      const setup = async () => {
        const ipas = await raise({ lines: [line(1, 2, 100), line(2, 8, 50), line(3, 10, 10)] })
        await ipasService.addPayment(ipas.id, peso({ kind: "payment", amount: "1000", chargeFeePhp: "100" }))
        await ipasService.addPayment(ipas.id, peso({ kind: "shipping_fee", amount: "100" }))
        const kind = options.charge_kind["Brokerage Fee"].id
        await ipasService.addCharge(ipas.id, { kindId: kind, chargedOn: "2026-10-12", amountPhp: "300" })
        await ipasService.addCharge(ipas.id, { kindId: kind, chargedOn: "2026-10-12", amountPhp: "200" })
        return ipas
      }

      const figures = async (id) =>
        (await read(id)).landedCost.lines.map((l) => [l.spreadPhp, l.landedPhp, l.landedPerUnitPhp])

      it("defaults to by value", async () => {
        const ipas = await setup()
        const opened = await read(ipas.id)
        expect(opened.landedCostSplit).toBe("value")
        expect(await figures(ipas.id)).toEqual([
          [200, 400, 200],
          [400, 800, 100],
          [100, 200, 20],
        ])
      })

      it("spreads by quantity when Purchasing picks it", async () => {
        const ipas = await setup()
        await ipasService.setLandedCostSplit(ipas.id, "quantity")
        expect(await figures(ipas.id)).toEqual([
          [70, 270, 135],
          [280, 680, 85],
          [350, 450, 45],
        ])
      })

      it("spreads equally when Purchasing picks it", async () => {
        const ipas = await setup()
        await ipasService.setLandedCostSplit(ipas.id, "equal")
        expect(await figures(ipas.id)).toEqual([
          [233.34, 433.34, 216.67],
          [233.33, 633.33, 79.17],
          [233.33, 333.33, 33.33],
        ])
      })

      it("refuses a spread that isn't one, and keeps the choice in history", async () => {
        const ipas = await setup()
        await expect(ipasService.setLandedCostSplit(ipas.id, "weight")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })

        await ipasService.setLandedCostSplit(ipas.id, "equal")
        const event = db.rows("ipas_events").find((e) => e.kind === "header_changed")
        expect(event.detail.fields).toMatchObject({ landed_cost_split: { from: "value", to: "equal" } })
      })
    })

    describe("the computation status", () => {
      it("reads provisional until Costs complete, then final", async () => {
        const ipas = await raise()
        expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
        expect((await read(ipas.id)).computationStatus).toBe("encoding")

        await ipasService.setComputationStatus(ipas.id, "encoded")
        expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)

        await ipasService.setComputationStatus(ipas.id, "lc_odoo_done")
        expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.FINAL)

        await ipasService.setComputationStatus(ipas.id, "checked")
        expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.FINAL)

        await ipasService.setComputationStatus(ipas.id, "encoded")
        expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.PROVISIONAL)
      })

      it("is set by Purchasing only, and only to one of the four", async () => {
        const ipas = await raise()
        await expect(ipasService.setComputationStatus(ipas.id, "done")).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })

        stubIpasRpcs({ actorId: finance.id, purchasing: false, money: true })
        await expect(ipasService.setComputationStatus(ipas.id, "lc_odoo_done")).rejects.toMatchObject({ code: "42501" })
        expect((await read(ipas.id)).computationStatus).toBe("encoding")
      })

      it("keeps each move in history with what it was", async () => {
        const ipas = await raise()
        await ipasService.setComputationStatus(ipas.id, "encoded")
        await ipasService.setComputationStatus(ipas.id, "lc_odoo_done")

        const trail = db.rows("ipas_events").filter((e) => e.kind === "header_changed")
        expect(trail.map((e) => e.detail.fields.computation_status)).toEqual([
          { from: "encoding", to: "encoded" },
          { from: "encoded", to: "lc_odoo_done" },
        ])
      })
    })

    it("recalculates when the PO's lines change in Odoo, since the copy is what it reads", async () => {
      const ipas = await raise()
      await ipasService.addCharge(ipas.id, { kindId: options.charge_kind["Brokerage Fee"].id, chargedOn: "2026-10-12", amountPhp: "600" })
      stubEdgeFunction("odoo-po-ipas", odooPo({ lines: [line(11400, 6, 1250), line(11401, 2, 500)] }))

      const opened = await ipasService.get(ipas.id)

      expect(opened.landedCost.lines.map((l) => l.lineId)).toEqual([11400, 11401])
      expect(opened.landedCost.totals).toMatchObject({ goodsPhp: 8500, spreadPhp: 600, landedPhp: 9100 })
    })

    it("is final on a filed IPAS whatever its status", async () => {
      const ipas = await raise()
      db.internal.rowsOf("ipas").find((r) => r.id === ipas.id).state = "filed"
      expect((await read(ipas.id)).landedCost.status).toBe(IPAS_LANDED_COST_STATUS.FINAL)
    })
  })

  describe("the freight service", () => {
    it("is one per IPAS, an active option, and changeable until Filing", async () => {
      const ipas = await raise()
      const dhl = options.freight_service["DHL"].id
      const fedex = options.freight_service.FedEx.id

      await ipasService.setFreightService(ipas.id, dhl)
      expect((await read(ipas.id)).freightService).toMatchObject({ id: dhl, label: "DHL" })

      await ipasService.setFreightService(ipas.id, fedex)
      expect((await read(ipas.id)).freightService.label).toBe("FedEx")

      await ipasService.setFreightService(ipas.id, null)
      expect((await read(ipas.id)).freightService).toBeNull()

      const trail = db.rows("ipas_events").filter((e) => e.kind === "header_changed")
      expect(trail.map((e) => e.detail.fields.freight_service_id)).toEqual([
        { from: null, to: "DHL" },
        { from: "DHL", to: "FedEx" },
        { from: "FedEx", to: null },
      ])
    })

    it("refuses a charge kind as the freight service, and a deactivated one for a new pick", async () => {
      const ipas = await raise()
      await expect(
        ipasService.setFreightService(ipas.id, options.charge_kind["Brokerage Fee"].id),
      ).rejects.toMatchObject({ code: "22023" })

      await ipasService.deactivateOption(options.freight_service.FedEx.id)
      await expect(
        ipasService.setFreightService(ipas.id, options.freight_service.FedEx.id),
      ).rejects.toMatchObject({ code: "22023", message: expect.stringMatching(/deactivated/) })
    })

    it("keeps a deactivated freight service on the IPAS that picked it", async () => {
      const ipas = await raise()
      const fedex = options.freight_service.FedEx.id
      await ipasService.setFreightService(ipas.id, fedex)
      await ipasService.deactivateOption(fedex)

      const opened = await read(ipas.id)
      expect(opened.freightService).toMatchObject({ label: "FedEx", active: false })
      await expect(ipasService.setHeader(ipas.id, { freightServiceId: fedex, piQtAmount: "10" })).resolves.toBeTruthy()
    })
  })

  describe("P.I/QT Amount", () => {
    it("is typed, kept, cleared when blank, and refused when half-typed", async () => {
      const ipas = await raise()

      await ipasService.setHeader(ipas.id, { piQtAmount: "12,500.505" })
      expect(db.internal.rowsOf("ipas").find((r) => r.id === ipas.id).pi_qt_amount).toBe(12500.51)

      await expect(ipasService.setHeader(ipas.id, { piQtAmount: "12k" })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
        message: "P.I/QT Amount must be a number.",
      })

      await ipasService.setHeader(ipas.id, { piQtAmount: "" })
      expect((await read(ipas.id)).piQtAmount).toBeNull()
    })

    it("still types the contact and P.I # alone", async () => {
      const ipas = await raise()
      await ipasService.setHeader(ipas.id, { piNumber: "PI-77" })
      expect((await read(ipas.id)).piNumber).toBe("PI-77")
      await expect(ipasService.setHeader(ipas.id, {})).rejects.toMatchObject({ code: IPAS_ERROR.INVALID })
    })
  })

  describe("section 2 ticks (Googlesheet, Gantt Chart)", () => {
    it("are off until ticked, then set and cleared as plain booleans, one history entry each", async () => {
      const ipas = await raise()
      expect(await read(ipas.id)).toMatchObject({ googleSheet: false, ganttChart: false })

      await ipasService.setHeader(ipas.id, { googleSheet: true })
      await ipasService.setHeader(ipas.id, { ganttChart: true, googleSheet: true })
      const after = await read(ipas.id)
      expect(after).toMatchObject({ googleSheet: true, ganttChart: true })
      expect(db.internal.rowsOf("ipas").find((r) => r.id === ipas.id)).toMatchObject({ google_sheet: true, gantt_chart: true })

      const changes = db.rows("ipas_events").filter((e) => e.kind === "header_changed")
      expect(changes.map((e) => e.detail.fields)).toEqual([
        { google_sheet: { from: false, to: true } },
        { gantt_chart: { from: false, to: true } },
      ])
    })

    it("refuses anything but true or false, before the database is called", async () => {
      const ipas = await raise()
      await expect(ipasService.setHeader(ipas.id, { googleSheet: "yes" })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
        message: "Googlesheet is ticked or not.",
      })
      await expect(ipasService.setHeader(ipas.id, { ganttChart: null })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
        message: "Gantt Chart is ticked or not.",
      })
      expect(db.rows("ipas_events").filter((e) => e.kind === "header_changed")).toHaveLength(0)
    })

    it("keep each change in the history, with what it was", async () => {
      const ipas = await raise()
      await ipasService.setHeader(ipas.id, { googleSheet: true })
      await ipasService.setHeader(ipas.id, { googleSheet: false })
      const history = (await read(ipas.id)).events.filter((e) => e.kind === "header_changed")
      expect(history.map((e) => e.detail.fields.google_sheet)).toEqual([
        { from: false, to: true },
        { from: true, to: false },
      ])
    })
  })

  describe("the option lists", () => {
    it("lists a list in its order, inactive ones included unless asked not to", async () => {
      await ipasService.deactivateOption(options.payment_method["Credit Card"].id)

      const all = await ipasService.listOptions(IPAS_OPTION_LIST.PAYMENT_METHOD)
      const active = await ipasService.listOptions(IPAS_OPTION_LIST.PAYMENT_METHOD, { includeInactive: false })

      expect(all.map((o) => o.label)).toEqual([
        "Alipay",
        "Bank Deposit",
        "Bank TT",
        "Cash",
        "Credit Card",
        "Dated Check",
        "Petnet",
        "Western Union",
        "Alibaba",
        "Paypal",
        "Other",
      ])
      expect(active.map((o) => o.label)).not.toContain("Credit Card")
      expect((await ipasService.listOptions(IPAS_OPTION_LIST.CHARGE_KIND))).toHaveLength(7)
    })

    it("adds an option at the end, refuses a name already on the list, and renames", async () => {
      const added = await ipasService.saveOption({ list: IPAS_OPTION_LIST.PAYMENT_METHOD, label: "  Wise  " })
      expect(added).toMatchObject({ label: "Wise", list: "payment_method", active: true, sort: 120 })

      await expect(
        ipasService.saveOption({ list: IPAS_OPTION_LIST.PAYMENT_METHOD, label: "alipay" }),
      ).rejects.toMatchObject({ code: IPAS_ERROR.INVALID, message: expect.stringMatching(/already on the list/) })
      await expect(ipasService.saveOption({ list: IPAS_OPTION_LIST.PAYMENT_METHOD, label: "  " })).rejects.toMatchObject({
        code: IPAS_ERROR.INVALID,
      })

      const renamed = await ipasService.saveOption({ id: added.id, list: IPAS_OPTION_LIST.PAYMENT_METHOD, label: "Wise Transfer" })
      expect(renamed.label).toBe("Wise Transfer")
      // The same name on another list is a different option.
      await expect(
        ipasService.saveOption({ list: IPAS_OPTION_LIST.CHARGE_KIND, label: "Wise Transfer" }),
      ).resolves.toMatchObject({ list: "charge_kind" })
    })

    it("reorders a list, and leaves any option not named at the end", async () => {
      const list = IPAS_OPTION_LIST.FREIGHT_SERVICE
      const before = await ipasService.listOptions(list)
      const last = before.at(-1).id
      const first = before[0].id

      await ipasService.reorderOptions(list, [last, first])

      const after = await ipasService.listOptions(list)
      expect(after[0].id).toBe(last)
      expect(after[1].id).toBe(first)
      expect(after).toHaveLength(before.length)
      expect(after.map((o) => o.sort)).toEqual(after.map((_, i) => (i + 1) * 10))
    })

    it("deactivates and reactivates, never deletes", async () => {
      const id = options.charge_kind["Delivery Fee"].id
      await ipasService.deactivateOption(id)
      expect(db.rows("ipas_options").find((o) => o.id === id).active).toBe(false)

      await ipasService.setOptionActive(id, true)
      expect(db.rows("ipas_options").find((o) => o.id === id).active).toBe(true)
      expect(ipasService).not.toHaveProperty("deleteOption")
    })
  })
})

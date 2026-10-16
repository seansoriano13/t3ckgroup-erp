import { beforeEach, describe, expect, it } from "vitest"
import { ipasSorStandingService } from "./ipasSorStandingService"
import { orderMonitoringService } from "./orderMonitoringService"
import { ipasService } from "./ipasService"
import { db, updateRow } from "@/test/db/store"
import { supabase } from "@/lib/supabase"
import { stubEdgeFunction } from "@/test/msw/server"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { seedIpasOptions, stubIpasRpcs } from "@/test/stubs/ipasRpc"
import { IPAS_SUMMARY_KEYS } from "@/utils/ipasSummary"

/**
 * Where an SOR's own orders stand (#265, spec #261), through the service against
 * the fake database. The standing is the pure orderStanding of #263 with the
 * ageing rules, so the SOR and the Order Monitoring page cannot disagree; who
 * may read the SOR is the policy tier's (63, 77). `today` is passed in.
 */

const TODAY = "2026-10-16"

const odooPo = (name) => ({
  success: true,
  found: true,
  po: { id: 2552, name, state: "purchase", company: "T3ck Trading", company_id: 1, currency: "Php", origin: null, partner_ref: null },
  supplier: { id: 553, name: "Scorpe Technologies", contact: "Ms. K. Tan" },
  lines: [
    { line_id: 11400, product_id: 5350, name: "Item", quantity: 1, unit: "Unit", price_unit: 1000, price_subtotal: 1000, taxes: [], analytic: [], brand: null },
  ],
  receipts: { status: "pending", done: 0, total: 1 },
  bills: { count: 0, draft: 0 },
})

const NEW_FIELDS = ["daysWaiting", "late", "nextThing", "owner"]
const SHAPED_KEYS = [
  "buyerTrack", "computationLabel", "computationStatus", "id", "isCancelled", "isFiled", "number",
  "poNumber", "purpose", "signoffs", "state", "supplier", "trackDone", "trackTotal",
  ...NEW_FIELDS,
].sort()

describe("ipasSorStandingService.summariesForSor", () => {
  let buyer, sor, options

  beforeEach(() => {
    buyer = makeEmployee({ name: "Buyer", department: "OPERATIONS", has_purchasing_flow: true })
    options = seedIpasOptions((table, row) => db.seed(table, row))
    sor = makeOpportunity({ sales_reference: "S07001", project_title: "Capas Fire Station" })
  })

  async function raise({ poNumber = "P02552", source = "local" } = {}) {
    stubEdgeFunction("odoo-po-ipas", odooPo(poNumber))
    const ipas = await ipasService.create({ poNumber, priority: "high", source, purpose: "project", sorIds: [sor.id] })
    // Raised long enough ago for waits to be countable.
    updateRow("ipas", db.internal.rowsOf("ipas").find((r) => r.id === ipas.id), { created_at: "2026-10-01T04:00:00Z" })
    return ipas
  }

  const asDealTeam = (extra = {}) => stubIpasRpcs({ actorId: buyer.id, purchasing: false, reader: false, ...extra })

  it("gives a reader with no Purchasing or Finance access the next thing, owner and late mark", async () => {
    stubIpasRpcs({ actorId: buyer.id })
    const ipas = await raise()
    asDealTeam()

    const [row] = await ipasSorStandingService.summariesForSor(sor.id, { today: TODAY })

    expect(row.id).toBe(ipas.id)
    expect(row.nextThing).toBe("With P.O.P — no payment carries proof")
    expect(row.owner).toBe("finance")
    expect(row.daysWaiting).toBe(15)
    expect(row.late).toBe(false)
  })

  it("marks an order late once it has waited past its step's rule", async () => {
    stubIpasRpcs({ actorId: buyer.id })
    await raise()
    await orderMonitoringService.setRule("with_pop", 10)
    asDealTeam()

    const [row] = await ipasSorStandingService.summariesForSor(sor.id, { today: TODAY })

    expect(row.late).toBe(true)
    expect(row.daysWaiting).toBe(15)
  })

  it("gives the same standing as the Order Monitoring list for the same IPAS", async () => {
    stubIpasRpcs({ actorId: buyer.id })
    const ipas = await raise({ source: "import" })
    updateRow("ipas", db.internal.rowsOf("ipas").find((r) => r.id === ipas.id), { arrived_in_ph_on: "2026-10-10" })
    db.seed("ipas_payments", {
      ipas_id: ipas.id, kind: "payment", paid_on: "2026-10-01", amount: 1000,
      method_id: options.payment_method["Dated Check"].id, proof_url: "https://x.test/proof.png",
    })
    await orderMonitoringService.setRule("import_clearance", 3)

    const listed = (await orderMonitoringService.list({ today: TODAY })).find((r) => r.id === ipas.id)
    asDealTeam()
    const [onSor] = await ipasSorStandingService.summariesForSor(sor.id, { today: TODAY })

    expect(listed.late).toBe(true)
    expect(onSor).toMatchObject({
      nextThing: listed.next.label,
      owner: listed.next.owner,
      daysWaiting: listed.daysWaiting,
      late: listed.late,
    })
  })

  it("adds only the four fields to the summary's key set, with no money or bank column", async () => {
    stubIpasRpcs({ actorId: buyer.id })
    await raise()
    db.seed("ipas_payments", { ipas_id: db.rows("ipas")[0].id, kind: "payment", paid_on: "2026-10-01", amount: 987654.32, method_id: options.payment_method["Dated Check"].id, proof_url: "https://x.test/proof.png" })
    db.seed("ipas_bank_details", { ipas_id: db.rows("ipas")[0].id, bank_name: "BDO", account_name: "Scorpe", account_number: "0012 3456 7890" })
    asDealTeam()

    const rows = await ipasSorStandingService.summariesForSor(sor.id, { today: TODAY })

    expect(Object.keys(rows[0]).sort()).toEqual(SHAPED_KEYS)
    const raw = await supabase.rpc("ipas_summaries_for_sor", { p_opportunity_id: sor.id })
    expect(Object.keys(raw.data[0]).sort()).toEqual([...IPAS_SUMMARY_KEYS].sort())
    const shown = JSON.stringify(rows)
    for (const secret of ["987654", "0012 3456 7890", "BDO", "x.test"]) expect(shown).not.toContain(secret)
    const standing = await supabase.rpc("ipas_standing_for_sor", { p_opportunity_id: sor.id })
    expect(JSON.stringify(standing.data)).not.toMatch(/amount|bank|account|proof_url|price/)
  })

  it("returns nothing to someone who cannot read the SOR", async () => {
    stubIpasRpcs({ actorId: buyer.id })
    await raise()
    asDealTeam({ sorReader: false })

    expect(await ipasSorStandingService.summariesForSor(sor.id, { today: TODAY })).toEqual([])
  })
})

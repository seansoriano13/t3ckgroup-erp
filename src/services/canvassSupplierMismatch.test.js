import { beforeEach, describe, expect, it } from "vitest"

import { canvassService } from "./canvassService"
import { costingMatrixService } from "./costingMatrixService"
import { db, updateRow } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { explainEmptySlots, seedCanvass, stubCanvassMoneyRpc, stubCanvassWinnerRpcs } from "@/test/stubs/canvassRpc"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * A PO placed with a supplier other than the winning Offer's (#281): the Costing Matrix row carries
 * `supplierMismatch` when the Component's PO, read from its IPAS's stored Odoo copy, names someone else.
 * It only reports. The real lookup (the gate, cancelled IPAS) is the policy tier's.
 */
describe("a PO with another supplier than the Canvass winner", () => {
  let purchaser
  let opportunity
  let componentId
  let redleaf

  const component = async () => (await costingMatrixService.get(opportunity.id)).tenderLines[0].components[0]
  const rowsOf = (table) => db.internal.rowsOf(table)
  const setPo = (po) => updateRow("costing_components", rowsOf("costing_components").find((c) => c.id === componentId), { po_rfq_no: po })
  const ipasFor = (po, supplier, state = "open") =>
    db.seed("ipas", { number: "TGIPAS_901", po_number: po, state, priority: "high", source: "local", purpose: "supplies", odoo_copy: { po: { id: 1, name: po }, supplier } })

  beforeEach(async () => {
    stubCanvassMoneyRpc({ money: true })
    purchaser = makeEmployee({ name: "Marco Dizon", has_purchasing_flow: true })
    opportunity = makeOpportunity({ registered_by: purchaser.id, deal_owner_id: purchaser.id, sales_reference: "S07983" })
    const matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "technical"], actorId: purchaser.id })
    stubCanvassWinnerRpcs({ bands: ["purchasing"] })

    const lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Folding stretcher", quantity: 2, abcUnit: 90000, finalOfferUnit: 95000 })
    componentId = await costingMatrixService.addComponent(lineId, { name: "Ambulance Folding Stretcher", brand: "Generic" })
    const canvass = await seedCanvass({ componentId }, purchaser.id)
    redleaf = await canvassService.addOffer(canvass.id, { supplierName: "Redleaf Inc.", brand: "Redleaf", unitPrice: 78000, odooSupplierId: 553 }, purchaser.id)
    explainEmptySlots(canvass.id)
    await canvassService.markWinner(canvass.id, redleaf.id)
  })

  it("flags a PO whose IPAS copy names another supplier", async () => {
    setPo("P02445")
    ipasFor("P02445", { id: 700, name: "Flywheel Corp." })
    expect((await component()).supplierMismatch).toEqual({ po: "P02445", poSupplier: "Flywheel Corp.", winner: "Redleaf Inc." })
  })

  it("says nothing when the PO is with the winner, even if spelled differently", async () => {
    setPo("p02445")
    ipasFor("P02445", { id: 553, name: "REDLEAF INC" })
    expect((await component()).supplierMismatch).toBeNull()
  })

  it("says nothing for a PO with no IPAS, a cancelled IPAS, or no PO", async () => {
    setPo("P02445")
    expect((await component()).supplierMismatch).toBeNull()
    ipasFor("P02445", { id: 700, name: "Flywheel Corp." }, "cancelled")
    expect((await component()).supplierMismatch).toBeNull()
    setPo(null)
    expect((await component()).supplierMismatch).toBeNull()
  })

  it("says nothing when the Component has no winner", async () => {
    setPo("P02445")
    ipasFor("P02445", { id: 700, name: "Flywheel Corp." })
    rowsOf("sor_canvass_offers").forEach((o) => updateRow("sor_canvass_offers", o, { is_winner: false }))
    expect((await component()).supplierMismatch).toBeNull()
  })
})

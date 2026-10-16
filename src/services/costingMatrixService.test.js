import { beforeEach, describe, expect, it } from "vitest"
import { CostingBandError, CostingRuleError, costingMatrixService, toBandError, toRuleError } from "./costingMatrixService"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { COSTING_TIER } from "@/constants/costing"

/**
 * The Costing Matrix through the service (#267), against the fake database with
 * the matrix functions re-implemented on its store (stubCostingMatrixRpcs). What
 * the screen reads: Tender Lines numbered from 1, their totals, what the SOR line
 * now says, and no money key for a tier that never received it. Who may read or
 * write is the policy tier's (78-costing-tender-lines.test.js).
 */
describe("costingMatrixService", () => {
  let salesperson
  let opportunity
  let matrix

  const productList = [
    { product_name: "Full Body Harness", unit: "pc", quantity: 10, unit_price: 5998.1, odoo_product_id: 101 },
    { product_name: "Rope Access Kit", unit: "set", quantity: 2, unit_price: 30000, odoo_product_id: 202 },
  ]

  const lineNamed = async (name) => (await opportunityService.getItems(opportunity.id)).find((l) => l.product_name === name)

  beforeEach(async () => {
    salesperson = makeEmployee({ name: "Sales Person", department: "SALES" })
    opportunity = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    await opportunityService.updateOpportunity(opportunity.id, { items: productList }, salesperson.id)
    matrix = db.seed("costing_matrices", { opportunity_id: opportunity.id })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"] })
  })

  it("reads nothing before the SOR has a matrix", async () => {
    const other = makeOpportunity({ registered_by: salesperson.id, deal_owner_id: salesperson.id })
    expect(await costingMatrixService.get(other.id)).toBeNull()
  })

  it("adds typed Tender Lines in order, numbered from 1, with their totals", async () => {
    const first = await costingMatrixService.addTenderLine(matrix.id, {
      tenderSpecification: "Rescue tripod\nAluminium, 3 m",
      unit: "set",
      quantity: 2,
      abcUnit: 120000,
      finalOfferUnit: 99500.5,
    }, salesperson.id)
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Anchor plate", unit: "pc", quantity: 4 }, salesperson.id)

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tier).toBe("price")
    expect(read.matrixId).toBe(matrix.id)
    expect(read.tenderLines.map((l) => [l.number, l.tender_specification])).toEqual([
      [1, "Rescue tripod\nAluminium, 3 m"],
      [2, "Anchor plate"],
    ])
    expect(read.tenderLines[0]).toMatchObject({
      id: first,
      created_by: salesperson.id,
      totals: { abcTotal: 240000, finalOfferTotal: 199001, overAbc: false },
    })
    // The second line has no prices yet: nothing is zero.
    expect(read.tenderLines[1].totals).toEqual({
      abcTotal: null,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    })
    expect(read.totals).toMatchObject({ abcTotal: null, finalOfferTotal: null, missingOffer: 1, missingAbc: 1 })
  })

  it("flags a Tender Line over its ABC and shows Final Offer as a percentage of ABC", async () => {
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Over", quantity: 1, abcUnit: 1000, finalOfferUnit: 1000.01 })
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Under", quantity: 1, abcUnit: 2000, finalOfferUnit: 1000 })

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tenderLines.map((l) => l.totals.overAbc)).toEqual([true, false])
    expect(read.totals).toMatchObject({ abcTotal: 3000, finalOfferTotal: 2000.01, overAbc: false, percentOfAbc: 66.67 })
  })

  it("keeps the snapshot of a picked Tender Line after updateOpportunity replaces the lines, and says what the SOR line now says", async () => {
    const harness = await lineNamed("Full Body Harness")
    const id = await costingMatrixService.addTenderLineFromSorLine(matrix.id, harness, { abcUnit: 6500, finalOfferUnit: 6200 })

    await opportunityService.updateOpportunity(
      opportunity.id,
      { items: [{ ...productList[0], quantity: 12, unit_price: 6100 }, productList[1]] },
      salesperson.id,
    )

    const read = await costingMatrixService.get(opportunity.id)
    const [line] = read.tenderLines
    expect(line).toMatchObject({
      id,
      source: "sor_line",
      odoo_product_id: 101,
      tender_specification: "Full Body Harness",
      quantity: 10,
      unit: "pc",
      sor_line_snapshot: { name: "Full Body Harness", quantity: 10, unit: "pc" },
      sor_line_now: { found: true, quantity: 12, unit: "pc" },
      sorChange: { kind: "changed", label: "SOR line now says 12 pc" },
      // The quotation price is the SOR line's, beside Final Offer, never copied into it.
      quotation_price_unit: 6100,
      final_offer_unit: 6200,
    })
    // The totals still use the Tender Line's own quantity.
    expect(line.totals.finalOfferTotal).toBe(62000)
  })

  it("says the SOR line was removed when it is gone, and nothing for a typed line", async () => {
    const harness = await lineNamed("Full Body Harness")
    await costingMatrixService.addTenderLineFromSorLine(matrix.id, harness)
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Typed", quantity: 1 })

    await opportunityService.updateOpportunity(opportunity.id, { items: [productList[1]] }, salesperson.id)

    const [picked, typed] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(picked.sorChange).toEqual({ kind: "removed", label: "SOR line removed" })
    expect(picked.sor_line_snapshot.quantity).toBe(10)
    expect(typed.sorChange).toBeNull()
    expect(typed.sor_line_now).toBeNull()
  })

  it("updates a line and its prices, and clears a price with null", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "A", quantity: 1, finalOfferUnit: 5 })
    await costingMatrixService.updateTenderLine(id, { tenderSpecification: "A, revised", quantity: 3, abcUnit: 10, finalOfferUnit: null })

    const [line] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(line).toMatchObject({ tender_specification: "A, revised", quantity: 3, abc_unit: 10, final_offer_unit: null })
  })

  it("reorders and removes", async () => {
    const a = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "A" })
    const b = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "B" })
    const c = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "C" })

    await costingMatrixService.reorder(matrix.id, [c, a, b])
    expect((await costingMatrixService.get(opportunity.id)).tenderLines.map((l) => l.tender_specification)).toEqual(["C", "A", "B"])

    await costingMatrixService.removeTenderLine(a)
    const after = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(after.map((l) => [l.number, l.tender_specification])).toEqual([
      [1, "C"],
      [2, "B"],
    ])
  })

  it("gives a Stage Participant the Tender Lines with no money key at all", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 2, abcUnit: 100, finalOfferUnit: 90 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] })

    const read = await costingMatrixService.get(opportunity.id)
    expect(read.tier).toBe("participant")
    const [line] = read.tenderLines
    expect(line.id).toBe(id)
    for (const key of ["abc_unit", "final_offer_unit", "quotation_price_unit"]) {
      expect(Object.keys(line)).not.toContain(key)
    }
    // No figure is invented for what was never received.
    expect(line.totals).toEqual({
      abcTotal: null,
      finalOfferTotal: null,
      overAbc: false,
      percentOfAbc: null,
      acquireTotal: null,
      odooTotal: null,
    })
    expect(JSON.stringify(read)).not.toMatch(/abc_unit|final_offer_unit|quotation_price_unit/)
  })

  it("gives Purchasing the ABC but never the Final Offer", async () => {
    await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 2, abcUnit: 100, finalOfferUnit: 90 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] })

    const [line] = (await costingMatrixService.get(opportunity.id)).tenderLines
    expect(line.abc_unit).toBe(100)
    expect(Object.keys(line)).not.toContain("final_offer_unit")
    expect(line.totals).toMatchObject({ abcTotal: 200, finalOfferTotal: null })
  })

  it("reads no matrix for a caller with no tier", async () => {
    stubCostingMatrixRpcs({ tier: null, bands: [] })
    expect(await costingMatrixService.get(opportunity.id)).toBeNull()
    expect(await costingMatrixService.tier(opportunity.id)).toBeNull()
  })

  it("throws a typed band error naming the column when a write is outside the caller's band", async () => {
    const id = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Spec", quantity: 1 })
    stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] })

    const error = await costingMatrixService.updateTenderLine(id, { finalOfferUnit: 5 }).catch((e) => e)
    expect(error).toBeInstanceOf(CostingBandError)
    expect(error).toMatchObject({
      name: "CostingBandError",
      table: "costing_tender_line_prices",
      column: "final_offer_unit",
      bands: ["sales"],
      message: "Final Offer is written by Sales (the Deal Team).",
    })

    const reorder = await costingMatrixService.reorder(matrix.id, [id]).catch((e) => e)
    expect(reorder).toBeInstanceOf(CostingBandError)
    expect(reorder.column).toBe("position")
  })

  it("reads a band refusal off the database error, and nothing else", () => {
    const refusal = toBandError({ code: "42501", message: "costing_band:costing_tender_lines.*:sales" })
    expect(refusal).toMatchObject({ table: "costing_tender_lines", column: "*", bands: ["sales"] })
    expect(refusal.message).toBe("Adding or removing a Tender Line is written by Sales (the Deal Team).")
    expect(toBandError({ code: "42501", message: "costing_band:costing_x.y:sales,management" }).bands).toEqual(["sales", "management"])
    expect(toBandError({ code: "42501", message: "new row violates row-level security policy" })).toBeNull()
    expect(toBandError({ code: "23514", message: "costing_band:costing_tender_lines.*:sales" })).toBeNull()
    expect(toBandError(null)).toBeNull()
  })

  it("serves the history through the database", async () => {
    expect(await costingMatrixService.history(opportunity.id, { table: "costing_tender_lines", limit: 5 })).toEqual([])
  })

  describe("Components, bundles, Inclusions and cost-only rows (#268)", () => {
    let lineId;

    beforeEach(async () => {
      lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Rescue vehicle\n4x4 pick-up", quantity: 1, abcUnit: 2200000, finalOfferUnit: 2100000 });
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "management"] });
    });

    const lineOf = async () => (await costingMatrixService.get(opportunity.id)).tenderLines[0];

    it("numbers Components 1.1, 1.2 under their Tender Line and totals a bundle priced as a whole", async () => {
      const vehicle = await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, quantity: 1, acquireUnit: 2160500, odooUnit: 2200000, brand: "Toyota", status: "source_out" });
      await costingMatrixService.addComponent(lineId, { name: "Roll bar", quantity: 2, acquireUnit: 15000, odooUnit: 16000 });

      const line = await lineOf();
      expect(line.components.map((c) => [c.number, c.name, c.is_bundle])).toEqual([
        ["1.1", "Vehicle", true],
        ["1.2", "Roll bar", false],
      ]);
      expect(line.components[0]).toMatchObject({ id: vehicle, brand: "Toyota", status: "source_out", acquire_unit: 2160500, odoo_unit: 2200000 });
      // A bundle at 1 x 2,160,500 totals 2,160,500, never 0.00.
      expect(line.components[0].totals).toEqual({ acquireTotal: 2160500, odooTotal: 2200000 });
      expect(line.totals).toMatchObject({ acquireTotal: 2190500, odooTotal: 2232000, finalOfferTotal: 2100000 });
    });

    it("leaves the line's Acquire total null, never zero, while any Component has a blank Acquire", async () => {
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, acquireUnit: 2160500, odooUnit: 2200000 });
      await costingMatrixService.addComponent(lineId, { name: "Spare wheel", quantity: 1, odooUnit: 9000 });

      const line = await lineOf();
      expect(line.totals.acquireTotal).toBeNull();
      expect(line.totals.odooTotal).toBe(2209000);

      await costingMatrixService.updateComponent(line.components[1].id, { acquireUnit: 7500 });
      expect((await lineOf()).totals.acquireTotal).toBe(2168000);
      await costingMatrixService.updateComponent(line.components[1].id, { acquireUnit: null });
      expect((await lineOf()).totals.acquireTotal).toBeNull();
    });

    it("keeps a Component's own fields and its costs apart, and blank text as null", async () => {
      const id = await costingMatrixService.addComponent(lineId, { name: "Winch", quantity: 1 });
      await costingMatrixService.updateComponent(id, {
        offerSpecification: "12,000 lb, 24V",
        brand: "Warn",
        availability: "for_order",
        source: "import",
        poRfqNo: "RFQ-2231",
        odooProductId: 8123,
        unit: "",
        acquireUnit: 52000,
      });
      const [component] = (await lineOf()).components;
      expect(component).toMatchObject({
        offer_specification: "12,000 lb, 24V",
        brand: "Warn",
        availability: "for_order",
        source: "import",
        po_rfq_no: "RFQ-2231",
        odoo_product_id: 8123,
        unit: null,
        acquire_unit: 52000,
      });
      expect(db.rows("costing_component_costs")).toHaveLength(1);
    });

    it("removes a Component", async () => {
      const id = await costingMatrixService.addComponent(lineId, { name: "Gone" });
      await costingMatrixService.removeComponent(id);
      expect((await lineOf()).components).toEqual([]);
      await expect(costingMatrixService.removeComponent(id)).rejects.toThrow("That Component could not be removed.");
    });

    it("lists a bundle's Inclusions under their headings with the Completeness count", async () => {
      const bundle = await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true });
      await costingMatrixService.addInclusion(bundle, { heading: "Accessories", description: "Roll bar" });
      const bag = await costingMatrixService.addInclusion(bundle, { heading: "Accessories", description: "Carry bag", quantity: 2, unit: "pc" });
      await costingMatrixService.addInclusion(bundle, { heading: "With", description: "Spare key" });
      await costingMatrixService.addInclusion(bundle, { description: "Manual" });
      await costingMatrixService.updateInclusion(bag, { completeness: "COVERED" });

      const [component] = (await lineOf()).components;
      expect(component.inclusionGroups.map((g) => [g.heading, g.items.map((i) => i.description)])).toEqual([
        ["Accessories", ["Roll bar", "Carry bag"]],
        ["With", ["Spare key"]],
        [null, ["Manual"]],
      ]);
      expect(component.inclusions.find((i) => i.id === bag)).toMatchObject({ quantity: 2, unit: "pc", completeness: "COVERED" });
      expect(component.completeness).toMatchObject({ total: 4, covered: 1, outstanding: 3 });
    });

    it("refuses an Inclusion under a Component that is not a bundle, in words", async () => {
      const plain = await costingMatrixService.addComponent(lineId, { name: "Winch" });
      const error = await costingMatrixService.addInclusion(plain, { description: "Hook" }).catch((e) => e);
      expect(error).toBeInstanceOf(CostingRuleError);
      expect(error.message).toBe("An Inclusion can only sit under a bundle Component.");
    });

    it("moves an unplaced Inclusion under a bundle, and refuses a non-bundle target", async () => {
      const unplaced = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Unplaced inclusions" });
      const holder = await costingMatrixService.addComponent(unplaced, { name: "Unplaced inclusions", isBundle: true });
      const strap = await costingMatrixService.addInclusion(holder, { description: "Strap" });
      const bundle = await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true });
      await costingMatrixService.addInclusion(bundle, { description: "Roll bar" });
      const plain = await costingMatrixService.addComponent(lineId, { name: "Winch" });

      const refused = await costingMatrixService.moveInclusion(strap, plain).catch((e) => e);
      expect(refused).toBeInstanceOf(CostingRuleError);
      expect(refused.message).toBe("An Inclusion can only sit under a bundle Component.");

      await costingMatrixService.moveInclusion(strap, bundle);
      const read = await costingMatrixService.get(opportunity.id);
      const placed = read.tenderLines.find((l) => l.id === lineId).components.find((c) => c.id === bundle);
      expect(placed.inclusions.map((i) => [i.description, i.position])).toEqual([
        ["Roll bar", 1],
        ["Strap", 2],
      ]);
      expect(read.tenderLines.find((l) => l.id === unplaced).components[0].inclusions).toEqual([]);
    });

    it("removes an Inclusion", async () => {
      const bundle = await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true });
      const id = await costingMatrixService.addInclusion(bundle, { description: "Bag" });
      await costingMatrixService.removeInclusion(id);
      expect((await lineOf()).components[0].inclusions).toEqual([]);
    });

    it("adds, edits and removes a cost-only row, kept out of every Tender Line's totals", async () => {
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, acquireUnit: 2160500, odooUnit: 2200000 });
      const id = await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge", quantity: 1, acquireUnit: 100000, odooUnit: 110000 });

      let read = await costingMatrixService.get(opportunity.id);
      expect(read.costRows).toHaveLength(1);
      expect(read.costRows[0]).toMatchObject({ id, number: 1, description: "Delivery Charge", acquire_unit: 100000, odoo_unit: 110000, markup_factor: 1 });
      expect(read.costRows[0].totals).toEqual({ acquireTotal: 100000, odooTotal: 110000 });
      expect(read.costRowsTotals).toEqual({ acquireTotal: 100000, odooTotal: 110000 });
      // The line's totals count the Component only.
      expect(read.tenderLines[0].totals).toMatchObject({ acquireTotal: 2160500, odooTotal: 2200000 });

      await costingMatrixService.updateCostRow(id, { description: "Delivery Charge (Davao)", quantity: 2, acquireUnit: null });
      read = await costingMatrixService.get(opportunity.id);
      expect(read.costRows[0]).toMatchObject({ description: "Delivery Charge (Davao)", quantity: 2, acquire_unit: null });
      expect(read.costRows[0].totals.acquireTotal).toBeNull();

      await costingMatrixService.removeCostRow(id);
      expect((await costingMatrixService.get(opportunity.id)).costRows).toEqual([]);
    });

    it("gives each tier only the unit costs it may read, and a Stage Participant none", async () => {
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, acquireUnit: 2160500, odooUnit: 2200000, finalAcquireUnit: 2100000, markupFactor: 1.35 });
      await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge", acquireUnit: 100000, odooUnit: 110000, finalAcquireUnit: 90000 });

      const keysAt = async (tier) => {
        stubCostingMatrixRpcs({ tier, bands: [] });
        const read = await costingMatrixService.get(opportunity.id);
        const component = read.tenderLines[0].components[0];
        const money = (row) => Object.keys(row).filter((k) => /_unit$|markup_factor/.test(k)).sort();
        return [money(component), money(read.costRows[0])];
      };

      expect(await keysAt(COSTING_TIER.CLOSED_BOOK)).toEqual([
        ["acquire_unit", "final_acquire_unit", "markup_factor", "odoo_unit"],
        ["acquire_unit", "final_acquire_unit", "markup_factor", "odoo_unit"],
      ]);
      expect(await keysAt(COSTING_TIER.COST)).toEqual([
        ["acquire_unit", "odoo_unit"],
        ["acquire_unit", "odoo_unit"],
      ]);
      expect(await keysAt(COSTING_TIER.PRICE)).toEqual([["odoo_unit"], ["odoo_unit"]]);
      expect(await keysAt(COSTING_TIER.PARTICIPANT)).toEqual([[], []]);

      // The participant still reads what each row is, and no figure is invented.
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] });
      const read = await costingMatrixService.get(opportunity.id);
      expect(read.tenderLines[0].components[0]).toMatchObject({ name: "Vehicle", is_bundle: true });
      expect(read.tenderLines[0].components[0].totals).toEqual({ acquireTotal: null, odooTotal: null });
      expect(read.costRows[0]).toMatchObject({ description: "Delivery Charge", totals: { acquireTotal: null, odooTotal: null } });
      expect(JSON.stringify(read)).not.toMatch(/acquire_unit|odoo_unit|final_acquire_unit|markup_factor/);
    });

    it("throws a typed band error naming the cost column and who writes it", async () => {
      const id = await costingMatrixService.addComponent(lineId, { name: "Vehicle" });

      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"] });
      const acquire = await costingMatrixService.updateComponent(id, { acquireUnit: 5 }).catch((e) => e);
      expect(acquire).toBeInstanceOf(CostingBandError);
      expect(acquire).toMatchObject({ table: "costing_component_costs", column: "acquire_unit", bands: ["purchasing"], message: "Acquire is written by Purchasing." });
      await costingMatrixService.updateComponent(id, { odooUnit: 5 });

      stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] });
      const odoo = await costingMatrixService.updateComponent(id, { odooUnit: 6 }).catch((e) => e);
      expect(odoo.message).toBe("Odoo unit cost is written by Sales (the Deal Team).");
      const factor = await costingMatrixService.updateComponent(id, { markupFactor: 2 }).catch((e) => e);
      expect(factor).toMatchObject({ column: "markup_factor", bands: ["management"], message: "The markup factor is written by the Final Acquire list." });
      const rowId = await costingMatrixService.addCostRow(matrix.id, { description: "Permits" });
      const final = await costingMatrixService.updateCostRow(rowId, { finalAcquireUnit: 1 }).catch((e) => e);
      expect(final.message).toBe("Final Acquire is written by the Final Acquire list.");
    });

    it("refuses a participant adding or removing a cost-only row, naming the band", async () => {
      const id = await costingMatrixService.addCostRow(matrix.id, { description: "Permits" });
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] });
      const add = await costingMatrixService.addCostRow(matrix.id, { description: "Nope" }).catch((e) => e);
      expect(add).toBeInstanceOf(CostingBandError);
      expect(add.message).toBe("Adding or removing a cost-only row is written by Sales (the Deal Team) or Purchasing.");
      expect((await costingMatrixService.removeCostRow(id).catch((e) => e)).column).toBe("*");
    });

    it("names the Sales and Purchasing incharge for the matrix and for one Component", async () => {
      const purchaser = makeEmployee({ name: "Buyer", department: "PURCHASING" });
      const component = await costingMatrixService.addComponent(lineId, { name: "Vehicle" });

      await costingMatrixService.setIncharge({ matrixId: matrix.id }, { sales: salesperson.id, purchasing: purchaser.id });
      expect(db.rows("costing_matrices")[0]).toMatchObject({ sales_incharge_id: salesperson.id, purchasing_incharge_id: purchaser.id });

      await costingMatrixService.setIncharge({ componentId: component }, { purchasing: purchaser.id });
      expect((await lineOf()).components[0]).toMatchObject({ purchasing_incharge_id: purchaser.id, sales_incharge_id: null });

      await costingMatrixService.setIncharge({ componentId: component }, { purchasing: null });
      expect((await lineOf()).components[0].purchasing_incharge_id).toBeNull();
    });

    it("reads a rule refusal off the database error, and nothing else", () => {
      expect(toRuleError({ code: "23514", message: "costing_incharge: the Sales incharge must be on the SOR's Deal Team" }).message).toBe(
        "The Sales incharge must be on the SOR's Deal Team.",
      );
      expect(toRuleError({ code: "23514", message: "costing_move_inclusion: an Inclusion can only sit under a bundle Component" })).toBeInstanceOf(CostingRuleError);
      expect(toRuleError({ code: "23514", message: "new row violates check constraint" })).toBeNull();
      expect(toRuleError({ code: "42501", message: "costing_inclusion: x" })).toBeNull();
      expect(toRuleError(null)).toBeNull();
    });
  });
});

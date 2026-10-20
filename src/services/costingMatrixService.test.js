import { beforeEach, describe, expect, it } from "vitest"
import { CostingBandError, CostingRuleError, costingMatrixService, toBandError, toRuleError } from "./costingMatrixService"
import { opportunityService } from "./opportunityService"
import { db } from "@/test/db/store"
import { makeEmployee, makeOpportunity } from "@/test/factories"
import { stubCostingMatrixRpcs } from "@/test/stubs/costingMatrixRpc"
import { stubRpc } from "@/test/msw/server"
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
      landedCost: null,
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
        ["acquire_unit", "final_acquire_unit", "markup_factor", "markup_price_unit", "odoo_unit"],
        ["acquire_unit", "final_acquire_unit", "markup_factor", "markup_price_unit", "odoo_unit"],
      ]);
      expect(await keysAt(COSTING_TIER.COST)).toEqual([
        ["acquire_unit", "odoo_unit"],
        ["acquire_unit", "odoo_unit"],
      ]);
      // Sales reads the peso Markup Price and never the factor behind it (#316).
      // A cost-only row's Markup Price would be its Acquire (x1.00), so the price tier gets none there.
      expect(await keysAt(COSTING_TIER.PRICE)).toEqual([
        ["markup_price_unit", "odoo_unit"],
        ["odoo_unit"],
      ]);
      expect(await keysAt(COSTING_TIER.PARTICIPANT)).toEqual([[], []]);

      // The participant still reads what each row is, and no figure is invented.
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PARTICIPANT, bands: [] });
      const read = await costingMatrixService.get(opportunity.id);
      expect(read.tenderLines[0].components[0]).toMatchObject({ name: "Vehicle", is_bundle: true });
      expect(read.tenderLines[0].components[0].totals).toEqual({ acquireTotal: null, odooTotal: null });
      expect(read.costRows[0]).toMatchObject({ description: "Delivery Charge", totals: { acquireTotal: null, odooTotal: null } });
      expect(JSON.stringify(read)).not.toMatch(/acquire_unit|odoo_unit|final_acquire_unit|markup_factor|markup_price_unit|default_factor/);
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
      // #556: the matrix functions now refuse these with 22023
      expect(toRuleError({ code: "22023", message: "costing_incharge: the Sales incharge must be on the SOR's Deal Team" }).message).toBe(
        "The Sales incharge must be on the SOR's Deal Team.",
      );
      expect(toRuleError({ code: "22023", message: "costing_bid: write the reason for the decision" })).toBeInstanceOf(CostingRuleError);
      expect(toRuleError({ code: "22023", message: "costing_set_money: not a number" })).toBeNull();
      expect(toRuleError({ code: "42501", message: "costing_inclusion: x" })).toBeNull();
      expect(toRuleError(null)).toBeNull();
    });
  });

  describe("the summary, Final Acquire and the rates (#270)", () => {
    let lineId;

    beforeEach(async () => {
      lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Rescue vehicle", quantity: 1, abcUnit: 3200000, finalOfferUnit: 2980000 });
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "management", "finance"] });
    });

    const read = () => costingMatrixService.get(opportunity.id);

    it("works the summary for Closed Book from the rates, to the centavo (#229 sample)", async () => {
      db.seed("costing_settings", { id: 1 });
      const component = await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1 });
      await costingMatrixService.updateComponent(component, { finalAcquireUnit: 2338500 });

      const { summary, money } = await read();
      expect(money).toMatchObject({ matrix_id: matrix.id });
      expect(summary).toMatchObject({ finalOfferTotal: 2980000, operationalExpenses: 2338500, revenue: 423100, itr: 218400, tax: 178800 });
      expect(summary.percentOfAbc.toFixed(1)).toBe("93.1");
      expect(summary.incomplete).toMatchObject({ missingCost: 0, missingOffer: 0 });
    });

    it("says the summary is incomplete while a Component has no Final Acquire, never counting it as zero", async () => {
      db.seed("costing_settings", { id: 1 });
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1 });
      const { summary } = await read();
      expect(summary.incomplete.missingCost).toBe(1);
      expect(summary).toMatchObject({ operationalExpenses: null, revenue: null, collected: 2771400, vatExclusive: 2660714.29 });
    });

    it("counts a cost-only row's Final Acquire in Operational Expenses, and Marketing and OPEX as typed", async () => {
      db.seed("costing_settings", { id: 1 });
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1, finalAcquireUnit: 2000000 });
      const rowId = await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge", quantity: 1 });
      expect((await read()).summary.incomplete.missingCost).toBe(1);

      await costingMatrixService.updateCostRow(rowId, { finalAcquireUnit: 100000 });
      await costingMatrixService.updateMatrixMoney(matrix.id, { marketing: 12000.5, opex: 8000 });
      const { summary } = await read();
      // (2,980,000 - 2,100,000) - ITR of 218,400
      expect(summary).toMatchObject({ operationalExpenses: 2100000, marketing: 12000.5, opex: 8000, revenue: 661600 });

      await costingMatrixService.updateMatrixMoney(matrix.id, { marketing: null });
      expect((await read()).summary.marketing).toBeNull();
    });

    it("changes the figures when a rate changes", async () => {
      db.seed("costing_settings", { id: 1 });
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1, finalAcquireUnit: 2338500 });
      expect((await read()).summary.tax).toBe(178800);

      const changed = await costingMatrixService.setSettings({ taxRate: 0.05, itrAllowance: 0 });
      expect(changed).toMatchObject({ taxRate: 0.05, itrAllowance: 0, vatDivisor: 1.12, retentionRate: 0.01, itrRate: 0.08 });
      expect((await read()).summary).toMatchObject({ tax: 149000, itr: 238400, revenue: 403100 });
    });

    it("falls back to the sheet's rates when the row cannot be read", async () => {
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1, finalAcquireUnit: 2338500 });
      expect((await read()).summary.revenue).toBe(423100);
    });

    it("gives every other tier no summary and no Marketing or OPEX, the keys absent", async () => {
      db.seed("costing_settings", { id: 1 });
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", quantity: 1, finalAcquireUnit: 2338500 });
      await costingMatrixService.updateMatrixMoney(matrix.id, { marketing: 5 });

      for (const [tier, bands] of [
        [COSTING_TIER.COST, ["purchasing"]],
        [COSTING_TIER.PRICE, ["sales"]],
        [COSTING_TIER.PARTICIPANT, []],
      ]) {
        stubCostingMatrixRpcs({ tier, bands });
        const other = await read();
        expect(Object.keys(other), tier).not.toContain("summary");
        expect(Object.keys(other), tier).not.toContain("money");
        expect(JSON.stringify(other), tier).not.toMatch(/marketing|opex|final_acquire_unit/);
      }
    });

    it("writes Final Acquire through updateComponent and updateCostRow, and refuses a caller off the list", async () => {
      const component = await costingMatrixService.addComponent(lineId, { name: "Vehicle" });
      const rowId = await costingMatrixService.addCostRow(matrix.id, { description: "Permits" });
      await costingMatrixService.updateComponent(component, { finalAcquireUnit: 100 });
      await costingMatrixService.updateCostRow(rowId, { finalAcquireUnit: 7 });
      const shaped = await read();
      expect(shaped.tenderLines[0].components[0].final_acquire_unit).toBe(100);
      expect(shaped.costRows[0].final_acquire_unit).toBe(7);

      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing"] });
      const refused = await costingMatrixService.updateComponent(component, { finalAcquireUnit: 1 }).catch((e) => e);
      expect(refused).toBeInstanceOf(CostingBandError);
      expect(refused.message).toBe("Final Acquire is written by the Final Acquire list.");
      const marketing = await costingMatrixService.updateMatrixMoney(matrix.id, { marketing: 1 }).catch((e) => e);
      expect(marketing).toBeInstanceOf(CostingBandError);
      expect(marketing.message).toBe("Marketing is written by Finance or the Final Acquire list.");
    });

    it("reports a rate change that changed nothing (the database let no row through)", async () => {
      const refused = await costingMatrixService.setSettings({ taxRate: 0.07 }).catch((e) => e);
      expect(refused).toBeInstanceOf(CostingRuleError);
      expect(refused.message).toBe("Only Finance access or a Super Admin can change the rates.");
    });

    it("reads the rates as numbers", async () => {
      expect(await costingMatrixService.getSettings()).toBeNull();
      db.seed("costing_settings", { id: 1 });
      expect(await costingMatrixService.getSettings()).toMatchObject({ vatDivisor: 1.12, taxRate: 0.06, retentionRate: 0.01, itrRate: 0.08, itrAllowance: 250000 });
    });

    it("keeps each signer list as exactly the people given, adding and removing", async () => {
      const first = makeEmployee({ name: "Manager One" });
      const second = makeEmployee({ name: "Manager Two" });
      const third = makeEmployee({ name: "Evaluator" });

      expect(await costingMatrixService.getSignerLists()).toEqual({ final_acquire: [], evaluation: [] });
      const added = await costingMatrixService.setSignerList("final_acquire", [first.id, second.id, first.id]);
      expect(added.map((m) => m.employeeId).sort()).toEqual([first.id, second.id].sort());

      const changed = await costingMatrixService.setSignerList("final_acquire", [second.id, third.id]);
      expect(changed.map((m) => m.employeeId).sort()).toEqual([second.id, third.id].sort());
      expect((await costingMatrixService.getSignerLists()).evaluation).toEqual([]);

      expect(await costingMatrixService.setSignerList("final_acquire", [])).toEqual([]);
      const unknown = await costingMatrixService.setSignerList("everyone", [first.id]).catch((e) => e);
      expect(unknown).toBeInstanceOf(CostingRuleError);
    });
  });

  describe("Markup and achieved markup (#269)", () => {
    let lineId
    const CLOSED_BOOK = { tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "purchasing", "management"] }

    beforeEach(async () => {
      lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Rescue vehicle", quantity: 1, abcUnit: 4000000, finalOfferUnit: 3300000 })
      stubCostingMatrixRpcs(CLOSED_BOOK)
    })

    const read = () => costingMatrixService.get(opportunity.id)

    it("picking a preset sets the default factor and remembers the preset", async () => {
      const preset = await costingMatrixService.savePreset({ label: "Government", factor: 1.35 })
      await costingMatrixService.setDefaultMarkup(matrix.id, { presetId: preset.id })

      const matrixRead = await read()
      expect(matrixRead.defaultFactor).toBe(1.35)
      expect(matrixRead.defaultPresetId).toBe(preset.id)
    })

    it("typing a factor sets the default and forgets the preset; a bad factor is refused in words", async () => {
      const preset = await costingMatrixService.savePreset({ label: "Government", factor: 1.35 })
      await costingMatrixService.setDefaultMarkup(matrix.id, { presetId: preset.id })
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 2.4 })
      expect(await read()).toMatchObject({ defaultFactor: 2.4, defaultPresetId: null })

      await expect(costingMatrixService.setDefaultMarkup(matrix.id, { factor: 0 })).rejects.toThrow("The markup factor must be a number above zero.")
      await expect(costingMatrixService.setDefaultMarkup(matrix.id, { factor: "abc" })).rejects.toThrow("The markup factor must be a number above zero.")
      await expect(costingMatrixService.setDefaultMarkup(matrix.id, {})).rejects.toThrow("The markup factor must be a number above zero.")

      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: null })
      expect(await read()).toMatchObject({ defaultFactor: null, defaultPresetId: null })
    })

    it("copies the preset's factor, so editing the preset later does not move the matrix", async () => {
      const preset = await costingMatrixService.savePreset({ label: "Government", factor: 1.35 })
      await costingMatrixService.setDefaultMarkup(matrix.id, { presetId: preset.id })
      await costingMatrixService.savePreset({ id: preset.id, factor: 1.5 })
      expect((await read()).defaultFactor).toBe(1.35)
    })

    it("refuses a preset that is switched off or gone", async () => {
      const preset = await costingMatrixService.savePreset({ label: "Old", factor: 3 })
      await costingMatrixService.savePreset({ id: preset.id, active: false })
      await expect(costingMatrixService.setDefaultMarkup(matrix.id, { presetId: preset.id })).rejects.toThrow("That markup preset is switched off.")
      await expect(costingMatrixService.setDefaultMarkup(matrix.id, { presetId: "00000000-0000-4000-8000-000000000000" })).rejects.toThrow(
        "That markup preset could not be found.",
      )
    })

    it("a row override survives a default change, and a row with none follows the default", async () => {
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      const vehicle = await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, acquireUnit: 2160500, markupFactor: 1.47 })
      const roll = await costingMatrixService.addComponent(lineId, { name: "Roll bar", quantity: 2, acquireUnit: 1000 })

      let components = (await read()).tenderLines[0].components
      expect(components.map((c) => [c.markup.factor, c.markup.priceUnit, c.markup.priceTotal])).toEqual([
        [1.47, 3175935, 3175935],
        [1.35, 1350, 2700],
      ])

      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 2 })
      components = (await read()).tenderLines[0].components
      expect(components.map((c) => c.id)).toEqual([vehicle, roll])
      expect(components[0].markup_factor).toBe(1.47)
      expect(components.map((c) => [c.markup.factor, c.markup.priceTotal])).toEqual([
        [1.47, 3175935],
        [2, 4000],
      ])

      // clearing an override sends the row back to the default
      await costingMatrixService.updateComponent(vehicle, { markupFactor: null })
      expect((await read()).tenderLines[0].components[0].markup.factor).toBe(2)
    })

    it("leaves Final Offer where Sales typed it when the factor changes", async () => {
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", acquireUnit: 2160500 })
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      expect((await read()).tenderLines[0].final_offer_unit).toBe(3300000)
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.9 })
      const line = (await read()).tenderLines[0]
      expect(line.final_offer_unit).toBe(3300000)
      expect(line.totals.finalOfferTotal).toBe(3300000)
      expect(db.rows("costing_tender_line_prices")[0].final_offer_unit).toBe(3300000)
    })

    it("sums each line's Markup Price and shows the achieved markup against the target, with cost-only rows only in the overall figure", async () => {
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", isBundle: true, acquireUnit: 2160500, markupFactor: 1.47 })
      const delivery = await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge", acquireUnit: 100000 })

      let matrixRead = await read()
      expect(matrixRead.tenderLines[0].markup).toEqual({ priceTotal: 3175935, targetFactor: 1.47, achievedFactor: 1.5274 })
      // a cost-only row starts at x1.00 and ignores the matrix default
      expect(matrixRead.costRows[0].markup).toEqual({ factor: 1, priceUnit: 100000, priceTotal: 100000 })
      expect(matrixRead.markup).toEqual({ priceTotal: 3175935, targetFactor: 1.4492, achievedFactor: 1.4599 })

      // a cost-only row's own factor
      await costingMatrixService.updateCostRow(delivery, { markupFactor: 1.2 })
      matrixRead = await read()
      expect(matrixRead.costRows[0].markup).toMatchObject({ factor: 1.2, priceUnit: 120000 })
      expect(matrixRead.tenderLines[0].markup.achievedFactor).toBe(1.5274)
    })

    it("leaves Markup Price and achieved markup blank while an Acquire is blank, never zero", async () => {
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", acquireUnit: 2160500 })
      await costingMatrixService.addComponent(lineId, { name: "Spare wheel", quantity: 1 })

      const matrixRead = await read()
      expect(matrixRead.tenderLines[0].components[1].markup).toEqual({ factor: 1.35, priceUnit: null, priceTotal: null })
      expect(matrixRead.tenderLines[0].markup.priceTotal).toBeNull()
      expect(matrixRead.tenderLines[0].markup.achievedFactor).toBeNull()
      expect(matrixRead.markup.achievedFactor).toBeNull()
    })

    it("gives Sales the peso Markup Price and neither the factor, the Acquire nor an achieved markup", async () => {
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", acquireUnit: 2160500, markupFactor: 1.47, odooUnit: 2200000 })
      await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge", acquireUnit: 100000 })

      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"], manageMarkup: false })
      const matrixRead = await read()
      expect(matrixRead.tenderLines[0].components[0].markup_price_unit).toBe(3175935)
      expect(matrixRead.tenderLines[0].markup.priceTotal).toBe(3175935)
      expect(matrixRead.tenderLines[0].markup.achievedFactor).toBeNull()
      expect(matrixRead.markup.achievedFactor).toBeNull()
      expect(matrixRead.costRows[0].markup_price_unit).toBeUndefined()
      expect(matrixRead.defaultFactor).toBeUndefined()
      expect(JSON.stringify(matrixRead)).not.toMatch(/markup_factor|default_factor|acquire_unit/)
    })

    it("gives Purchasing the Acquire and no Markup Price or factor", async () => {
      await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 })
      await costingMatrixService.addComponent(lineId, { name: "Vehicle", acquireUnit: 2160500, markupFactor: 1.47 })

      stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"], manageMarkup: false })
      const matrixRead = await read()
      expect(matrixRead.tenderLines[0].components[0].acquire_unit).toBe(2160500)
      expect(matrixRead.tenderLines[0].markup.priceTotal).toBeNull()
      expect(JSON.stringify(matrixRead)).not.toMatch(/markup_factor|markup_price_unit|default_factor/)
    })

    it("refuses the default factor and a row override outside the management band, naming who writes it", async () => {
      const component = await costingMatrixService.addComponent(lineId, { name: "Vehicle", acquireUnit: 100 })
      const delivery = await costingMatrixService.addCostRow(matrix.id, { description: "Delivery Charge" })
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales", "purchasing"], manageMarkup: false })

      const factor = await costingMatrixService.setDefaultMarkup(matrix.id, { factor: 1.35 }).catch((e) => e)
      expect(factor).toBeInstanceOf(CostingBandError)
      expect(factor).toMatchObject({ table: "costing_matrix_money", column: "default_factor", bands: ["management"] })
      expect(factor.message).toBe("The default markup factor is written by the Final Acquire list.")

      const override = await costingMatrixService.updateComponent(component, { markupFactor: 2 }).catch((e) => e)
      expect(override).toBeInstanceOf(CostingBandError)
      expect(override.message).toBe("The markup factor is written by the Final Acquire list.")
      const rowOverride = await costingMatrixService.updateCostRow(delivery, { markupFactor: 2 }).catch((e) => e)
      expect(rowOverride).toBeInstanceOf(CostingBandError)
    })

    it("lists, adds, renames and switches off presets, keeping them in order and never deleting one", async () => {
      const gov = await costingMatrixService.savePreset({ label: " Government ", factor: 1.35 })
      const private_ = await costingMatrixService.savePreset({ label: "Private", factor: "2.4" })
      expect(gov).toMatchObject({ label: "Government", factor: 1.35, active: true })
      expect(private_.sort).toBeGreaterThan(gov.sort)

      await costingMatrixService.savePreset({ id: gov.id, label: "Government bids", factor: 1.4 })
      await costingMatrixService.savePreset({ id: private_.id, active: false })

      expect((await costingMatrixService.listPresets()).map((p) => [p.label, p.factor, p.active])).toEqual([
        ["Government bids", 1.4, true],
        ["Private", 2.4, false],
      ])
      expect((await costingMatrixService.listPresets({ includeInactive: false })).map((p) => p.label)).toEqual(["Government bids"])
      expect(costingMatrixService.deletePreset).toBeUndefined()
    })

    it("refuses a preset with no name or a factor that is not above zero, in words", async () => {
      await expect(costingMatrixService.savePreset({ label: "  ", factor: 1.35 })).rejects.toThrow("A markup preset needs a name.")
      await expect(costingMatrixService.savePreset({ factor: 1.35 })).rejects.toThrow("A markup preset needs a name.")
      await expect(costingMatrixService.savePreset({ label: "Zero", factor: 0 })).rejects.toThrow("The markup factor must be a number above zero.")
      await expect(costingMatrixService.savePreset({ label: "Blank", factor: "" })).rejects.toThrow("The markup factor must be a number above zero.")
      await expect(costingMatrixService.savePreset({ label: "No factor" })).rejects.toThrow("A markup preset needs a factor.")
    })

    it("asks the database whether the caller edits the presets", async () => {
      expect(await costingMatrixService.canManageMarkup()).toBe(true)
      stubCostingMatrixRpcs({ tier: COSTING_TIER.COST, bands: ["purchasing"] })
      expect(await costingMatrixService.canManageMarkup()).toBe(false)
    })
  })

  describe("the Bid Decision (#320)", () => {
    let lineId;
    const read = () => costingMatrixService.get(opportunity.id);

    beforeEach(async () => {
      // Quantity 2.5 at 1001.15 is 2502.875, rounded half-up to 2502.88; 3 x 480 is 1440.
      lineId = await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Rescue tripod", quantity: 2.5, abcUnit: 1100.1, finalOfferUnit: 1001.15 });
      await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "Harness set", quantity: 3, abcUnit: 500, finalOfferUnit: 480 });
    });

    it("takes a decision as Closed Book, stamped with the totals computed the way costingMath works them", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "management"] });
      expect((await read()).bidDecision).toBeNull();

      const id = await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "  Fits the ABC  " });
      const { bidDecision, totals } = await read();
      expect(bidDecision).toMatchObject({ id, verdict: "go", reason: "Fits the ABC", clearedAt: null, finalOfferTotal: 3942.88, abcTotal: 4250.25 });
      // The stamped figure and the screen's own total agree to the centavo.
      expect(bidDecision.finalOfferTotal).toBe(totals.finalOfferTotal);
      expect(bidDecision.abcTotal).toBe(totals.abcTotal);
    });

    it("gives the price tier the verdict and the reason and no figure, the keys absent", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales"] });
      await costingMatrixService.decideBid(matrix.id, { verdict: "no_go", reason: "Too far over the ABC" });

      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"] });
      const { bidDecision } = await read();
      expect(bidDecision).toMatchObject({ verdict: "no_go", reason: "Too far over the ABC", clearedAt: null });
      expect("finalOfferTotal" in bidDecision).toBe(false);
      expect("abcTotal" in bidDecision).toBe(false);
    });

    it("gives Purchasing and a Stage Participant neither key", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales"] });
      await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Go" });
      for (const tier of [COSTING_TIER.COST, COSTING_TIER.PARTICIPANT]) {
        stubCostingMatrixRpcs({ tier, bands: [] });
        const read_ = await read();
        expect("bidDecision" in read_, tier).toBe(false);
        expect("bidDecisionHistory" in read_, tier).toBe(false);
      }
    });

    it("clears the live decision when a Final Offer or a Final Acquire changes, and keeps it in the history", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: ["sales", "management"] });
      await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Go" });
      await costingMatrixService.updateTenderLine(lineId, { finalOfferUnit: 1002 });
      const afterOffer = await read();
      expect(afterOffer.bidDecision).toBeNull();
      expect(afterOffer.bidDecisionHistory).toHaveLength(1);
      expect(afterOffer.bidDecisionHistory[0]).toMatchObject({ verdict: "go", clearedReason: "The Final Offer changed" });

      await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Go again" });
      const component = await costingMatrixService.addComponent(lineId, { name: "Head", quantity: 1 });
      await costingMatrixService.updateComponent(component, { finalAcquireUnit: 900 });
      const afterAcquire = await read();
      expect(afterAcquire.bidDecision).toBeNull();
      expect(afterAcquire.bidDecisionHistory.map((d) => d.clearedReason)).toEqual(["A Final Acquire changed", "The Final Offer changed"]);
    });

    it("replaces a live decision with a new one", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: [] });
      await costingMatrixService.decideBid(matrix.id, { verdict: "revise", reason: "Reprice" });
      await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Repriced" });
      const { bidDecision, bidDecisionHistory } = await read();
      expect(bidDecision).toMatchObject({ verdict: "go", reason: "Repriced" });
      expect(bidDecisionHistory).toHaveLength(1);
      expect(bidDecisionHistory[0]).toMatchObject({ verdict: "revise", clearedReason: "Decided again" });
    });

    it("refuses anyone below Closed Book, in words", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.PRICE, bands: ["sales"] });
      const refused = await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Go" }).catch((e) => e);
      expect(refused).toBeInstanceOf(CostingRuleError);
      expect(refused.message).toBe("Only a Super Admin or the Final Acquire list can decide a bid.");
    });

    it("refuses an unknown verdict, a blank reason and a matrix with a Tender Line that has no Final Offer", async () => {
      stubCostingMatrixRpcs({ tier: COSTING_TIER.CLOSED_BOOK, bands: [] });
      const verdict = await costingMatrixService.decideBid(matrix.id, { verdict: "maybe", reason: "x" }).catch((e) => e);
      expect(verdict).toBeInstanceOf(CostingRuleError);
      const blank = await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "   " }).catch((e) => e);
      expect(blank).toBeInstanceOf(CostingRuleError);
      expect(blank.message).toBe("Write the reason for the decision.");

      await costingMatrixService.addTenderLine(matrix.id, { tenderSpecification: "No price yet", quantity: 1 });
      const unpriced = await costingMatrixService.decideBid(matrix.id, { verdict: "go", reason: "Go" }).catch((e) => e);
      expect(unpriced).toBeInstanceOf(CostingRuleError);
      expect(unpriced.message).toBe("Every Tender Line needs a Final Offer before the bid can be decided.");
      expect((await read()).bidDecision).toBeNull();
    });

    it("lists the pending decisions for the Approval Center", async () => {
      stubRpc("costing_pending_bid_decisions", () => [
        { matrix_id: matrix.id, opportunity_id: opportunity.id, project_title: "Fire truck", client_name: "BFP", deal_owner_id: "emp-1", deal_owner_name: "Dee Owner", final_offer_total: "3942.88", abc_total: null, waiting_since: "2026-10-16T01:00:00Z" },
      ]);
      expect(await costingMatrixService.pendingBidDecisions()).toEqual([
        { matrixId: matrix.id, opportunityId: opportunity.id, projectTitle: "Fire truck", clientName: "BFP", dealOwnerId: "emp-1", dealOwnerName: "Dee Owner", finalOfferTotal: 3942.88, abcTotal: null, waitingSince: "2026-10-16T01:00:00Z" },
      ]);
    });
  });
});

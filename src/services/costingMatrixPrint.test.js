/**
 * The printed Costing Matrix (#274, ADR 0014): the view model and the landscape document, built from
 * `costingMatrixService.shapeMatrix` over a read as each tier receives it. The money sheet prints for
 * Closed Book alone; every tier that can read the matrix gets the specification appendix, without a
 * figure. Lives with the services tests because the matrix is shaped by the service.
 */
import { describe, it, expect, vi } from "vitest";

import { shapeMatrix } from "./costingMatrixService";
import { COMPONENT_COST_TIERS, COSTING_TIER, DEFAULT_COSTING_SETTINGS, TENDER_PRICE_TIERS } from "../constants/costing";
import { buildCostingMatrixViewModel } from "../lib/pdf/costingMatrixViewModel";
import { buildCostingMatrixDocument } from "../lib/pdf/costingMatrixDocument";
import { hydrateCostingMatrixSignatures } from "../lib/pdf/costingMatrixPrinter";

const SPEC_13 = Array.from({ length: 13 }, (_, i) => `Specification line ${i + 1}: the vehicle shall meet requirement ${i + 1}`).join("\n");

const PEOPLE = {
  "u-sales": { name: "Rosa Mendoza" },
  "u-buyer": { name: "Jun Bautista" },
  "u-eval": { name: "Ana Dela Cruz" },
  "u-boss": { name: "Miguel Ramos" },
};
const OPPORTUNITY = { sales_reference: "S07983", project_title: "Supply of One Emergency Response Vehicle", client_name: "Palmer Asia Inc" };

/** The raw rows of one matrix: two Tender Lines' worth of structure, with every money column present. */
function rawTables({ finalAcquireOnSecond = 78000, acquireOnSecond = 78000 } = {}) {
  return {
    costing_matrices: [{ id: "m1", opportunity_id: "o1", sales_incharge_id: "u-sales", purchasing_incharge_id: "u-buyer" }],
    costing_matrix_money: [{ matrix_id: "m1", default_factor: 1.47, default_preset_id: null, marketing: 0, opex: 0 }],
    costing_tender_lines: [{ id: "l1", matrix_id: "m1", position: 1, tender_specification: SPEC_13, unit: "unit", quantity: 1 }],
    costing_tender_line_prices: [{ tender_line_id: "l1", abc_unit: 3200000, final_offer_unit: 2980000, quotation_price_unit: null }],
    costing_components: [
      { id: "c1", tender_line_id: "l1", position: 1, name: "Ambulance Commuter 3.0", offer_specification: "Toyota Hiace Commuter 3.0 MT, converted", brand: "Toyota", status: "source_out", availability: "available", source: "local", po_rfq_no: "P02574", is_bundle: true, quantity: 1, compliance: "complies", compliance_note: null, recommended_alternative: null },
      { id: "c2", tender_line_id: "l1", position: 2, name: "Folding Stretcher", offer_specification: "Redleaf RL-FS190, 1,900 mm", brand: "Redleaf", status: "stockable", availability: "for_order", source: "import", po_rfq_no: null, is_bundle: false, quantity: 1, compliance: "deviates", compliance_note: "Offered 1,900 mm against 2,000 mm required", recommended_alternative: "Redleaf RL-FS200 (2,000 mm model)" },
    ],
    costing_component_costs: [
      { component_id: "c1", acquire_unit: 2160500, odoo_unit: null, final_acquire_unit: 2160500, markup_factor: null, markup_price_unit: 3176000 },
      { component_id: "c2", acquire_unit: acquireOnSecond, odoo_unit: 71400, final_acquire_unit: finalAcquireOnSecond, markup_factor: 1.35, markup_price_unit: 105300 },
    ],
    costing_inclusions: [
      { id: "i1", component_id: "c1", heading: "Interior", position: 1, description: "Custom Cabinet", quantity: 1, completeness: "COVERED" },
      { id: "i2", component_id: "c1", heading: "Interior", position: 2, description: "Beacon Lights", quantity: 1, completeness: "MISSING" },
      { id: "i3", component_id: "c1", heading: null, position: 3, description: "LTO Registration", quantity: 1, completeness: "COVERED" },
    ],
    costing_cost_rows: [{ id: "r1", matrix_id: "m1", position: 1, description: "Delivery Charge", quantity: 1, acquire_unit: 100000, odoo_unit: null, final_acquire_unit: 100000, markup_factor: 1 }],
    costing_signoffs: [],
    costing_bid_decisions: [
      { id: "b1", matrix_id: "m1", verdict: "go", reason: "Fits the ABC and the margin", decided_by: "u-boss", decided_at: "2026-10-15T02:00:00Z", cleared_at: null, cleared_reason: null, final_offer_total: 2980000, abc_total: 3200000 },
    ],
  };
}

const signoff = (role, by, extra = {}) => ({ id: `s-${role}`, matrix_id: "m1", role, signed_by: by, signed_at: "2026-10-14T03:00:00Z", signature_declined: false, signature_version: null, cleared_at: null, cleared_reason: null, ...extra });

/** What a tier is sent of those rows: the registries' columns, nothing else. */
function readAs(tier, tables = rawTables()) {
  const keep = (row, allowed) => Object.fromEntries(Object.entries(row).filter(([key]) => allowed(key)));
  const out = { ...tables };
  if (tier !== COSTING_TIER.CLOSED_BOOK) delete out.costing_matrix_money;
  out.costing_tender_line_prices = tables.costing_tender_line_prices.map((row) =>
    keep(row, (key) => key === "tender_line_id" || (TENDER_PRICE_TIERS[key] ?? []).includes(tier)),
  );
  out.costing_component_costs = tables.costing_component_costs.map((row) =>
    keep(row, (key) => key === "component_id" || (COMPONENT_COST_TIERS[key] ?? []).includes(tier)),
  );
  out.costing_cost_rows = tables.costing_cost_rows.map((row) => keep(row, (key) => !["acquire_unit", "final_acquire_unit", "markup_factor", "odoo_unit"].includes(key) || (COMPONENT_COST_TIERS[key] ?? []).includes(tier)));
  if (![COSTING_TIER.PRICE, COSTING_TIER.CLOSED_BOOK].includes(tier)) delete out.costing_bid_decisions;
  else if (tier === COSTING_TIER.PRICE) out.costing_bid_decisions = tables.costing_bid_decisions.map(({ final_offer_total: _a, abc_total: _b, ...rest }) => rest);
  return { tier, matrix_id: "m1", bands: [], tables: out };
}

const build = (tier, { tables, signoffs = [], people = PEOPLE } = {}) => {
  const raw = tables ?? rawTables();
  raw.costing_signoffs = signoffs;
  const matrix = shapeMatrix(readAs(tier, raw), tier === COSTING_TIER.CLOSED_BOOK ? { ...DEFAULT_COSTING_SETTINGS } : null);
  return buildCostingMatrixViewModel({ matrix, opportunity: OPPORTUNITY, people }, { printedAt: "2026-10-16T04:00:00Z", printedBy: "Sean Soriano" });
};

describe("the printed S0 Evaluation, view model", () => {
  it("gives the Closed Book both sheets: the money sheet first, then the appendix", () => {
    const vm = build(COSTING_TIER.CLOSED_BOOK);
    expect(vm.formType).toBe("costing_matrix");
    expect(vm.sheets).toEqual(["money", "appendix"]);
    const { money } = vm;
    expect(money.lines).toHaveLength(1);
    expect(money.lines[0]).toMatchObject({
      number: "1",
      abc: "3,200,000.00",
      acquire: "2,238,500.00",
      finalAcquire: "2,238,500.00",
      finalOffer: "2,980,000.00",
      achieved: "×1.3312",
      landedCost: "awaiting purchase",
    });
    expect(money.costRows).toEqual([expect.objectContaining({ number: "C1", description: "Delivery Charge", acquire: "100,000.00", finalAcquire: "100,000.00", factor: "×1.00" })]);
    expect(money.strip).toMatchObject({ finalOffer: "PHP 2,980,000.00", cost: "PHP 2,338,500.00", abcPercent: "93.1%", landedCost: "awaiting purchase" });
    expect(money.strip.abcBar).toBeCloseTo(93.13, 1);
    expect(money.summary.find((r) => r.label === "Final Offer").value).toBe("PHP 2,980,000.00");
    expect(money.summary.find((r) => r.label === "Revenue").value).toMatch(/^PHP /);
    expect(money.incomplete).toEqual([]);
  });

  it("prints the Bid Decision with the figures it was taken against, and the deviation in prose", () => {
    const { money } = build(COSTING_TIER.CLOSED_BOOK);
    expect(money.bidDecision).toEqual({
      verdict: "Go",
      reason: "Fits the ABC and the margin",
      decidedBy: "Miguel Ramos",
      decidedOn: "Oct 15, 2026",
      finalOffer: "PHP 2,980,000.00",
      abc: "PHP 3,200,000.00",
    });
    expect(money.deviations).toEqual([
      { number: "1.2", text: "Component 1.2 (Folding Stretcher) deviates: Offered 1,900 mm against 2,000 mm required. Recommended instead: Redleaf RL-FS200 (2,000 mm model)." },
    ]);
  });

  it("says why the summary is incomplete instead of printing a zero", () => {
    const tables = rawTables({ finalAcquireOnSecond: null, acquireOnSecond: null });
    const { money } = build(COSTING_TIER.CLOSED_BOOK, { tables });
    expect(money.incomplete).toEqual(["Incomplete — 1 row has no cost"]);
    expect(money.summary.find((r) => r.label === "Operational Expenses").value).toBe("Incomplete — 1 row has no cost");
    expect(money.summary.find((r) => r.label === "Revenue").value).toBe("Incomplete — 1 row has no cost");
    expect(money.summary.find((r) => r.label === "Final Offer").value).toBe("PHP 2,980,000.00");
    expect(money.strip.cost).toBe("Incomplete — 1 row has no cost");
    expect(buildCostingMatrixDocument(build(COSTING_TIER.CLOSED_BOOK, { tables }))).toContain("Incomplete — 1 row has no cost");
  });

  it("prints only the Evaluation box as 'Signature required' on a new deal (#722)", () => {
    const vm = build(COSTING_TIER.CLOSED_BOOK);
    expect(vm.money.signoffs.map((s) => [s.role, s.state])).toEqual([["Evaluation approved", "awaiting"]]);
    const html = buildCostingMatrixDocument(vm);
    expect(html.match(/Signature required/g)).toHaveLength(1);
  });

  it("prints the signer's name only when they have no stored signature, and when they declined it", () => {
    const vm = build(COSTING_TIER.CLOSED_BOOK, {
      signoffs: [
        signoff("prepared", "u-sales", { signature_version: "sig/rosa.png" }),
        signoff("costed", "u-buyer"),
        signoff("evaluation_approved", "u-eval", { signature_declined: true, signature_version: "sig/ana.png" }),
      ],
    });
    // Old signatures still print; the unsigned Final approval box is gone (#722).
    const [prepared, costed, evaluation] = vm.money.signoffs;
    expect(vm.money.signoffs).toHaveLength(3);
    expect(prepared).toMatchObject({ state: "signed", who: "Rosa Mendoza", signaturePath: "sig/rosa.png" });
    expect(prepared.stamp).toMatch(/^e-signed /);
    expect(costed).toMatchObject({ state: "signed", who: "Jun Bautista", signaturePath: null });
    expect(costed.stamp).toMatch(/name only, no signature on file$/);
    expect(evaluation).toMatchObject({ state: "signed", signaturePath: null, signatureDeclined: true });
    expect(evaluation.stamp).toMatch(/signature not applied$/);

    const html = buildCostingMatrixDocument(vm);
    expect(html).toContain('class="printed-name">Jun Bautista');
    expect(html.match(/Signature required/g)).toBeNull();
  });

  it("fetches each stored signature once and falls back to the name when one is missing", async () => {
    const vm = build(COSTING_TIER.CLOSED_BOOK, { signoffs: [signoff("prepared", "u-sales", { signature_version: "sig/rosa.png" })] });
    const { signatureService } = await import("../services/signatureService");
    const download = vi.spyOn(signatureService, "downloadSignature").mockRejectedValue(new Error("gone"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await hydrateCostingMatrixSignatures(vm);
    expect(download).toHaveBeenCalledTimes(1);
    expect(vm.money.signoffs[0].signatureBase64).toBeUndefined();
    expect(vm.money.signoffs[0].stamp).toMatch(/signature image unavailable$/);
    download.mockRestore();
    warn.mockRestore();
  });

  it.each([COSTING_TIER.PRICE, COSTING_TIER.COST, COSTING_TIER.PARTICIPANT])("gives the %s tier the appendix only: no money sheet and no figure", (tier) => {
    const vm = build(tier, { signoffs: [signoff("prepared", "u-sales")] });
    expect(vm.sheets).toEqual(["appendix"]);
    expect("money" in vm).toBe(false);
    const json = JSON.stringify(vm);
    for (const figure of ["2,980,000", "3,200,000", "2,160,500", "78,000", "100,000", "2,238,500", "1.47", "×1.3", "PHP "]) {
      expect(json, `${tier}: ${figure}`).not.toContain(figure);
    }
    for (const key of ["abc", "finalOffer", "acquire", "finalAcquire", "summary", "strip", "bidDecision", "achieved", "landedCost"]) {
      expect(json, `${tier}: ${key}`).not.toContain(`"${key}"`);
    }
    const html = buildCostingMatrixDocument(vm);
    expect(html).not.toContain("Final offer");
    expect(html).not.toContain("Signature required");
    expect(html).toContain("specification appendix");
  });

  it("fills the Landed Cost column with its mark once it arrives, and prints none for a participant (#283)", () => {
    const withLanded = (tier, rollup) => {
      const matrix = shapeMatrix(readAs(tier), tier === COSTING_TIER.CLOSED_BOOK ? { ...DEFAULT_COSTING_SETTINGS } : null);
      // What costingMatrixService.get attaches for the money tier.
      matrix.tenderLines[0].totals = { ...matrix.tenderLines[0].totals, landedCost: rollup };
      matrix.totals = { ...matrix.totals, landedCost: rollup };
      return buildCostingMatrixViewModel({ matrix, opportunity: OPPORTUNITY, people: PEOPLE });
    };

    const provisional = withLanded(COSTING_TIER.CLOSED_BOOK, { total: 2251234.5, mark: "provisional" });
    expect(provisional.money.lines[0]).toMatchObject({ landedCost: "2,251,234.50", landedCostMark: "provisional" });
    expect(provisional.money.strip).toMatchObject({ landedCost: "PHP 2,251,234.50", landedCostMark: "provisional" });
    const html = buildCostingMatrixDocument(provisional);
    expect(html).toContain("2,251,234.50");
    expect(html).toContain("provisional");

    expect(withLanded(COSTING_TIER.CLOSED_BOOK, { total: 2251234.5, mark: "final" }).money.lines[0].landedCostMark).toBe("final");
    expect(withLanded(COSTING_TIER.CLOSED_BOOK, null).money.lines[0]).toMatchObject({ landedCost: "awaiting purchase", landedCostMark: null });

    const participant = withLanded(COSTING_TIER.PARTICIPANT, { total: 2251234.5, mark: "final" });
    expect("money" in participant).toBe(false);
    expect(JSON.stringify(participant)).not.toContain("2,251,234");
  });

  it("doesn't print the money sheet for a lower tier even when a caller hands over a Closed Book matrix", () => {
    const matrix = shapeMatrix(readAs(COSTING_TIER.CLOSED_BOOK), { ...DEFAULT_COSTING_SETTINGS });
    const vm = buildCostingMatrixViewModel({ matrix: { ...matrix, tier: COSTING_TIER.PRICE }, opportunity: OPPORTUNITY, people: PEOPLE });
    expect("money" in vm).toBe(false);
    expect(JSON.stringify(vm)).not.toContain("2,980,000");
  });

  it("prints a 13-line Tender Specification in full on the appendix", () => {
    const vm = build(COSTING_TIER.PARTICIPANT);
    const [line] = vm.appendix.lines;
    expect(line.specLines).toHaveLength(13);
    expect(line.specLines[12]).toBe("Specification line 13: the vehicle shall meet requirement 13");
    const html = buildCostingMatrixDocument(vm);
    // The ask is repeated beside each Component's offer, never cut (line 1 also heads the Tender Line).
    for (let i = 1; i <= 13; i += 1) expect(html.split(`Specification line ${i}:`).length - 1).toBe(i === 1 ? 3 : 2);
    expect(html).not.toMatch(/more specification lines/);
  });

  it("sets each Component's Offer Specification, Compliance, note and Inclusions covered count on the appendix", () => {
    const { appendix } = build(COSTING_TIER.CLOSED_BOOK);
    const [stretcher] = appendix.lines[0].components.slice(1);
    expect(appendix.lines[0].components[0]).toMatchObject({ number: "1.1", brand: "Toyota", complianceLabel: "Complies", sourcing: "Source Out · Available · Local", po: "PO / RFQ P02574" });
    expect(stretcher).toMatchObject({ number: "1.2", complianceLabel: "Deviates", note: "Offered 1,900 mm against 2,000 mm required", alternative: "Redleaf RL-FS200 (2,000 mm model)" });
    expect(appendix.lines[0].inclusions).toEqual([
      expect.objectContaining({ owner: "1.1", covered: "2 of 3 covered", outstanding: 1 }),
    ]);
  });
});

describe("the printed S0 Evaluation, document", () => {
  it("is landscape A4 in the IPAS paper set, with the owner-band header and the margin column", () => {
    const html = buildCostingMatrixDocument(build(COSTING_TIER.CLOSED_BOOK));
    expect(html).toContain("@page { size: A4 landscape; margin: 0; }");
    expect(html).toContain("width: 297mm");
    expect(html).toContain('<div class="rail">');
    expect(html).toContain('<tr class="band owner">');
    expect(html).toContain("Management");
    expect(html).toContain('<div class="k">Margin</div>');
    expect(html).toContain('<div class="big">₱');
    expect(html).toContain("awaiting purchase");
    expect(html).toContain("sheet 1 of 2 · money");
    expect(html).toContain("sheet 2 of 2 · specifications");
    expect(html.match(/class="sheet /g)).toHaveLength(2);
  });

  it("escapes what was typed", () => {
    const tables = rawTables();
    tables.costing_tender_lines[0].tender_specification = "<script>alert(1)</script> & more";
    const html = buildCostingMatrixDocument(build(COSTING_TIER.PRICE, { tables }));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt; &amp; more");
  });

  it("prints a sheet for a matrix with nothing in it yet", () => {
    const tables = rawTables();
    for (const key of ["costing_tender_lines", "costing_tender_line_prices", "costing_components", "costing_component_costs", "costing_inclusions", "costing_cost_rows"]) tables[key] = [];
    const vm = build(COSTING_TIER.CLOSED_BOOK, { tables });
    const html = buildCostingMatrixDocument(vm);
    expect(html).toContain("No Tender Lines yet.");
    expect(vm.money.incomplete.length).toBeGreaterThan(0);
  });
});

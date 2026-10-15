import { describe, expect, it } from "vitest";
import { checkingStageOf, firstStageOf, pickedLineLabel, shapeTransmittal, stagesOf, tsrOf } from "./transmittals";

describe("which stages a Transmittal has", () => {
  it("opens Warehouse checking first, with releasing and Technical when both are ticked", () => {
    const both = { checkWarehouse: true, checkTechnical: true };
    expect(firstStageOf(both)).toBe("warehouse_checking");
    expect(stagesOf(both)).toEqual(["warehouse_checking", "warehouse_releasing", "technical_inspection"]);
  });

  it("opens Technical inspection on a Technical-only slip, with no releasing", () => {
    const technical = { checkWarehouse: false, checkTechnical: true };
    expect(firstStageOf(technical)).toBe("technical_inspection");
    expect(stagesOf(technical)).toEqual(["technical_inspection"]);
  });

  it("has no stages before it is read", () => {
    expect(firstStageOf(null)).toBeNull();
    expect(stagesOf(null)).toEqual([]);
  });
});

describe("stages read from a shaped slip", () => {
  const shapedSlip = (overrides) =>
    shapeTransmittal({
      id: "t2",
      number: "TG03-527",
      origin: "purchasing",
      priority: "low",
      entity: "T3ck Trading",
      state: "submitted",
      check_warehouse: true,
      check_technical: true,
      preparer: null,
      products: [],
      references: [],
      stages: [],
      lines: [],
      ...overrides,
    });

  it("lists the Technical inspection stage on a shaped slip that has it", () => {
    const slip = shapedSlip({});
    expect(stagesOf(slip)).toEqual(["warehouse_checking", "warehouse_releasing", "technical_inspection"]);
    expect(firstStageOf(slip)).toBe("warehouse_checking");
    expect(checkingStageOf(slip)).toBe("technical_inspection");
  });

  it("opens Technical on a shaped Technical-only slip", () => {
    const slip = shapedSlip({ check_warehouse: false, check_technical: true });
    expect(stagesOf(slip)).toEqual(["technical_inspection"]);
    expect(firstStageOf(slip)).toBe("technical_inspection");
  });
});

describe("shaping a Transmittal row", () => {
  it("orders lines by position and collects the IPAS numbers and SORs they name", () => {
    const row = {
      id: "t1",
      number: "TG03-526",
      origin: "purchasing",
      priority: "high",
      entity: "T3ck Trading",
      state: "draft",
      check_warehouse: true,
      check_technical: false,
      preparer: { id: "e1", name: "Buyer" },
      products: [{ option: { id: "p1", label: "Marwa" } }],
      references: [],
      stages: [],
      lines: [
        {
          id: "l2",
          position: 2,
          kind: "typed",
          description: "Sample",
          quantity: "1",
          unit: "Unit",
        },
        {
          id: "l1",
          position: 1,
          kind: "po_line",
          ipas_id: "i1",
          odoo_po_line_id: 11400,
          description: "Cutter",
          quantity: "6",
          unit: "Unit",
          ipas: { id: "i1", number: "TGIPAS_049", po_number: "P02552" },
          sor: { id: "s1", sales_reference: "S07920", project_title: "Capas LGU" },
        },
      ],
    };

    const shaped = shapeTransmittal(row);

    expect(shaped.lines.map((l) => l.id)).toEqual(["l1", "l2"]);
    expect(shaped.lines[0]).toMatchObject({ poNumber: "P02552", ipasNumber: "TGIPAS_049", quantity: 6 });
    expect(shaped.ipasNumbers).toEqual(["TGIPAS_049"]);
    expect(shaped.sors).toEqual([{ id: "s1", salesReference: "S07920", projectTitle: "Capas LGU" }]);
    expect(shaped.products).toEqual([{ id: "p1", label: "Marwa" }]);
    expect(shaped.checkWarehouse).toBe(true);
    expect(shaped.checkTechnical).toBe(false);
  });
});

describe("the TSR a Technical inspection gives", () => {
  it("derives units from the rated lines, with NA as a fail, Checked by from Inspected by", () => {
    const slip = shapeTransmittal({
      id: "t3",
      number: "TG03-528",
      state: "awaiting_check",
      check_warehouse: false,
      check_technical: true,
      products: [],
      references: [],
      stages: [
        {
          id: "s1",
          stage: "technical_inspection",
          remarks: "Scratch on housing",
          first_signer: { id: "e0", name: "Receiver" },
          first_signed_at: "2026-10-15T01:00:00Z",
          second_signer: { id: "e1", name: "Inspector" },
          second_signed_at: "2026-10-15T01:00:00Z",
        },
      ],
      evidence: [{ id: "v1", record_id: "s1", kind: "picture", storage_path: "p/1.jpg", file_name: "1.jpg" }],
      lines: [
        { id: "l1", position: 1, description: "Cutter", serial_numbers: "SN1", tech_rating: "gc", tech_remark: "" },
        { id: "l2", position: 2, description: "Drill", serial_numbers: "SN2", tech_rating: "na", tech_remark: "Cracked" },
        { id: "l3", position: 3, description: "Bit", tech_rating: null },
      ],
    });

    const tsr = tsrOf(slip);

    expect(tsr.units).toEqual([
      { serial: "SN1", verdict: "pass", remark: "" },
      { serial: "SN2", verdict: "fail", remark: "Cracked" },
    ]);
    expect(tsr.checkedBy).toEqual({ name: "Inspector", at: "2026-10-15T01:00:00Z" });
    // Purchasing's Noted by isn't on the slip: a blank plate, signed by hand.
    expect(tsr.notedBy).toEqual({ name: null, at: null });
    expect(tsr.remarks).toBe("Scratch on housing");
    expect(tsr.evidence).toEqual([{ kind: "picture", storagePath: "p/1.jpg", fileName: "1.jpg" }]);
  });

  it("gives one unit row per serial on a line, and one row for a line with no serial", () => {
    const slip = shapeTransmittal({
      id: "t5",
      number: "TG03-529",
      state: "awaiting_check",
      check_warehouse: false,
      check_technical: true,
      products: [],
      references: [],
      stages: [{ id: "s5", stage: "technical_inspection", first_signer: null, first_signed_at: null }],
      evidence: [],
      lines: [
        { id: "a", position: 1, description: "Cutter", serial_numbers: "SN1, SN2\nSN3;", tech_rating: "gc" },
        { id: "b", position: 2, description: "Drill", serial_numbers: " ", tech_rating: "na", tech_remark: "Cracked" },
        { id: "c", position: 3, description: "Bit", serial_numbers: null, tech_rating: "gc" },
        { id: "d", position: 4, description: "Unrated", serial_numbers: "SN9", tech_rating: null },
      ],
    });

    const tsr = tsrOf(slip);

    expect(tsr.units).toEqual([
      { serial: "SN1", verdict: "pass", remark: "" },
      { serial: "SN2", verdict: "pass", remark: "" },
      { serial: "SN3", verdict: "pass", remark: "" },
      { serial: "Drill", verdict: "fail", remark: "Cracked" },
      { serial: "Bit", verdict: "pass", remark: "" },
    ]);
  });

  it("lists the distinct items, SORs and POs across every rated line, not the first only", () => {
    const slip = shapeTransmittal({
      id: "t6",
      number: "TG03-530",
      state: "awaiting_check",
      check_warehouse: false,
      check_technical: true,
      products: [],
      references: [],
      stages: [{ id: "s6", stage: "technical_inspection", first_signer: null, first_signed_at: null }],
      evidence: [],
      lines: [
        { id: "a", position: 1, description: "Cutter", serial_numbers: "", tech_rating: "gc", ipas: { po_number: "P1" }, sor: { id: "s1", sales_reference: "S1" } },
        { id: "b", position: 2, description: "Drill", serial_numbers: "", tech_rating: "gc", ipas: { po_number: "P2" }, sor: { id: "s2", sales_reference: "S2" } },
        { id: "c", position: 3, description: "Bit", serial_numbers: "", tech_rating: "gc", ipas: { po_number: "P1" }, sor: { id: "s1", sales_reference: "S1" } },
      ],
    });

    const tsr = tsrOf(slip);

    expect(tsr.item).toBe("Cutter, Drill, Bit");
    expect(tsr.sor).toBe("S1, S2");
    expect(tsr.po).toBe("P1, P2");
  });

  it("is null on a slip with no Technical inspection", () => {
    expect(tsrOf(shapeTransmittal({ id: "t4", number: "x", check_warehouse: true, check_technical: false, stages: [], lines: [] }))).toBeNull();
  });
});

describe("a picked PO line's label", () => {
  it("shows the product, with its quantity and unit", () => {
    expect(pickedLineLabel({ productName: "Cutter", quantity: 6, unit: "Unit" })).toBe("Cutter · 6 Unit");
    expect(pickedLineLabel({ productName: null, quantity: null, unit: null })).toBe("PO line");
  });
});

import { describe, expect, it } from "vitest";
import { firstStageOf, pickedLineLabel, shapeTransmittal, stagesOf } from "./transmittals";

describe("which stages a Transmittal has", () => {
  it("opens Warehouse checking first, with releasing and Technical when both are ticked", () => {
    const both = { check_warehouse: true, check_technical: true };
    expect(firstStageOf(both)).toBe("warehouse_checking");
    expect(stagesOf(both)).toEqual(["warehouse_checking", "warehouse_releasing", "technical_inspection"]);
  });

  it("opens Technical inspection on a Technical-only slip, with no releasing", () => {
    const technical = { check_warehouse: false, check_technical: true };
    expect(firstStageOf(technical)).toBe("technical_inspection");
    expect(stagesOf(technical)).toEqual(["technical_inspection"]);
  });

  it("has no stages before it is read", () => {
    expect(firstStageOf(null)).toBeNull();
    expect(stagesOf(null)).toEqual([]);
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

describe("a picked PO line's label", () => {
  it("shows the product, with its quantity and unit", () => {
    expect(pickedLineLabel({ productName: "Cutter", quantity: 6, unit: "Unit" })).toBe("Cutter · 6 Unit");
    expect(pickedLineLabel({ productName: null, quantity: null, unit: null })).toBe("PO line");
  });
});

import { describe, expect, it } from "vitest";
import { buildPackingListViewModel, packingListTotals } from "./packingListViewModel";

const box = (boxNo, grossWeightKg = null, contents = []) => ({
  id: `b${boxNo}`,
  boxNo,
  marks: `MARK ${boxNo}`,
  sealNo: `SEAL-${boxNo}`,
  grossWeightKg,
  contents,
});

const list = (over = {}) => ({
  id: "pl1",
  number: "PKL_001",
  state: "draft",
  odooDeliveryRef: "TG En/OUT/03390",
  sorId: "sor1",
  sorReference: "S07920",
  projectTitle: "Plant upgrade",
  customerName: "Acme Corp",
  creatorName: "Warehouse One",
  createdById: "e1",
  packerName: null,
  packedAt: null,
  signatureDeclined: false,
  boxes: [],
  ...over,
});

describe("packingListTotals", () => {
  it("sums known weights and counts boxes", () => {
    const t = packingListTotals([box(1, 12.5), box(2, 7.25)]);
    expect(t.boxCount).toBe(2);
    expect(t.weighedCount).toBe(2);
    expect(t.totalKg).toBe("19.75");
    expect(t.partial).toBe(false);
    expect(t.weightLine).toBe("19.75 kg total gross weight");
    expect(t.boxesLine).toBe("2 boxes");
  });

  it("says how many boxes were weighed when some have no weight", () => {
    const t = packingListTotals([box(1, 12.5), box(2, null), box(3, null)]);
    expect(t.partial).toBe(true);
    expect(t.weighedCount).toBe(1);
    expect(t.totalKg).toBe("12.5");
    expect(t.weightLine).toBe("12.5 kg known · 1 of 3 boxes weighed");
  });

  it("handles no boxes and a single box", () => {
    expect(packingListTotals([]).weightLine).toBe("No boxes");
    expect(packingListTotals([box(1)]).boxesLine).toBe("1 box");
    expect(packingListTotals([box(1)]).weightLine).toBe("0 kg known · 0 of 1 boxes weighed");
  });
});

describe("buildPackingListViewModel", () => {
  it("prints each box with its marks, seal, weight and contents", () => {
    const vm = buildPackingListViewModel(
      list({
        boxes: [box(1, 4, [{ id: "c1", description: "Valve", quantity: 3, unit: "pcs" }]), box(2, null)],
      }),
    );
    expect(vm.boxes[0]).toEqual({
      boxNo: 1,
      marks: "MARK 1",
      sealNo: "SEAL-1",
      weight: "4 kg",
      contents: [{ description: "Valve", quantity: "3 pcs" }],
    });
    expect(vm.boxes[1].weight).toBe("—");
    expect(vm.customer).toBe("Acme Corp");
    expect(vm.sorReference).toBe("S07920");
  });

  it("shows Packed by as awaiting while the list is a draft", () => {
    const vm = buildPackingListViewModel(list());
    expect(vm.signature).toMatchObject({ role: "Packed by", state: "awaiting", who: "" });
    expect(vm.stateLabel).toBe("Draft");
  });

  it("shows Packed by as name only once packed", () => {
    const vm = buildPackingListViewModel(
      list({ state: "packed", packerName: "Juan", packedAt: "2026-10-15T06:00:00Z" }),
    );
    expect(vm.signature.state).toBe("signed");
    expect(vm.signature.who).toBe("Juan");
    expect(vm.signature.stamp).toContain("name only, no signature on file");
    expect(vm.stateLabel).toBe("Packed");
  });

  it("shows Packed by as signature not applied when the packer declined", () => {
    const vm = buildPackingListViewModel(
      list({ state: "packed", packerName: "Juan", packedAt: "2026-10-15T06:00:00Z", signatureDeclined: true }),
    );
    expect(vm.signature.state).toBe("signed");
    expect(vm.signature.stamp).toContain("signature not applied");
  });
});

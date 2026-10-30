import { describe, it, expect } from "vitest";
import { componentRoad, lineRoad } from "./itemRoad";

const part = (requests = [], extra = {}) => ({
  purchases: { requests, ipas: extra.ipas ?? [], poNumbers: extra.poNumbers ?? [] },
  landed_cost: extra.landed_cost,
});
const item = (status, poNumber = null) => ({ status, poNumber });

describe("componentRoad", () => {
  it("is Planned with nothing asked for, and Go once the sheet is locked", () => {
    expect(componentRoad(part()).step).toBe("planned");
    expect(componentRoad(part(), { locked: true }).step).toBe("go");
  });

  it("is Requested while an item has no P0", () => {
    expect(componentRoad(part([item("not_checked")])).step).toBe("requested");
    expect(componentRoad(part([item("to_purchase")])).label).toBe("Requested");
  });

  it("is Ordered once an item is Purchased or carries a PO number", () => {
    expect(componentRoad(part([item("purchased")])).step).toBe("ordered");
    expect(componentRoad(part([item("to_purchase", "P01999")])).step).toBe("ordered");
  });

  it("is Paying once its P0 has an IPAS, and Cost final once the Landed Cost is final", () => {
    const ipas = [{ poNumber: "P01999", ipasId: "x", number: "TGIPAS_473", state: "open" }];
    expect(componentRoad(part([item("purchased", "P01999")], { ipas, poNumbers: ["P01999"] })).step).toBe("paying");
    expect(componentRoad(part([item("purchased", "P01999")], { ipas, poNumbers: ["P01999"], landed_cost: { mark: "provisional" } })).step).toBe("paying");
    expect(componentRoad(part([item("purchased", "P01999")], { ipas, poNumbers: ["P01999"], landed_cost: { mark: "final" } })).step).toBe("costed");
  });

  it("is Received only when every live item is", () => {
    expect(componentRoad(part([item("received", "P1"), item("purchased", "P2")])).step).toBe("ordered");
    expect(componentRoad(part([item("received", "P1"), item("cancelled")])).step).toBe("received");
  });

  it("calls a Component the warehouse holds From stock", () => {
    const road = componentRoad(part([item("available")]));
    expect(road).toMatchObject({ step: "received", label: "From stock", fromStock: true });
  });

  it("flags one whose only items cannot be sourced, and leaves it where it was", () => {
    const road = componentRoad(part([item("cannot_source")]), { locked: true });
    expect(road).toMatchObject({ step: "go", stuck: true });
  });
});

describe("lineRoad", () => {
  it("is as far along as its slowest part", () => {
    const line = { components: [part([item("received", "P1")]), part([item("not_checked")])] };
    expect(lineRoad(line)).toMatchObject({ step: "requested", parts: 2 });
  });

  it("is Planned with no part, Go once locked", () => {
    expect(lineRoad({ components: [] }).step).toBe("planned");
    expect(lineRoad({ components: [] }, { locked: true }).step).toBe("go");
  });
});

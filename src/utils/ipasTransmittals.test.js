import { describe, it, expect } from "vitest";
import {
  deriveTransmittalTrack,
  derivedActualChecking,
  derivedDelivered,
  derivedItemLocationId,
  section5Rows,
} from "./ipasTransmittals";
import { buildBuyerTrack } from "./ipasDocuments";

const WH_ONLY = { check_warehouse: true, check_technical: false };
const BOTH = { check_warehouse: true, check_technical: true };
const TECH_ONLY = { check_warehouse: false, check_technical: true };

const slip = (id, extra = {}) => ({
  id,
  number: `TG03-${id}`,
  prepared_on: "2026-10-10",
  created_at: "2026-10-10T08:00:00Z",
  priority: "high",
  state: "warehouse_checking",
  item_location_id: null,
  stages: [],
  lines: [],
  ...WH_ONLY,
  ...extra,
});

const stage = (name, completed_at) => ({ stage: name, completed_at });
const WH = "warehouse_checking";
const WR = "warehouse_releasing";
const TI = "technical_inspection";

describe("section 5", () => {
  it("lists slips in date order with the NA count", () => {
    const rows = section5Rows([
      slip("b", { prepared_on: "2026-10-12", state: "closed", lines: [{ wh_rating: "na" }, { tech_rating: "gc" }] }),
      slip("a", { prepared_on: "2026-10-09", state: "awaiting_check", lines: [{ tech_rating: "na" }, { wh_rating: "gc" }] }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(rows[0]).toMatchObject({ number: "TG03-a", naCount: 1, stateLabel: "Awaiting Check by" });
    expect(rows[1]).toMatchObject({ naCount: 1, stateLabel: "Closed" });
  });
});

describe("Item Location", () => {
  it("follows the latest slip whose first stage is completed", () => {
    const slips = [
      slip("old", { prepared_on: "2026-10-01", item_location_id: "loc-old", stages: [stage(WH, "2026-10-01T09:00:00Z")] }),
      slip("new", { prepared_on: "2026-10-05", item_location_id: "loc-new", stages: [stage(WH, "2026-10-05T09:00:00Z")] }),
      slip("unstarted", { prepared_on: "2026-10-09", item_location_id: "loc-x", stages: [] }),
    ];
    expect(derivedItemLocationId(slips)).toBe("loc-new");
  });

  it("is null while no first stage is complete", () => {
    expect(derivedItemLocationId([slip("a", { item_location_id: "loc" })])).toBeNull();
  });

  it("a typed override wins over the slips", () => {
    const track = deriveTransmittalTrack(
      [slip("a", { item_location_id: "loc-slip", stages: [stage(WH, "2026-10-10T09:00:00Z")] })],
      { itemLocationId: "loc-typed" },
    );
    expect(track.itemLocation).toEqual({ id: "loc-typed", source: "typed" });
  });

  it("is the slip's when nothing is typed", () => {
    const track = deriveTransmittalTrack(
      [slip("a", { item_location_id: "loc-slip", stages: [stage(WH, "2026-10-10T09:00:00Z")] })],
      {},
    );
    expect(track.itemLocation).toEqual({ id: "loc-slip", source: "transmittals" });
  });
});

describe("Delivered", () => {
  it("is stamped from the earliest first-stage completion", () => {
    const slips = [
      slip("a", { stages: [stage(WH, "2026-10-12T10:00:00Z")] }),
      slip("b", { stages: [stage(WH, "2026-10-11T10:00:00Z")] }),
      slip("c", { stages: [] }),
    ];
    expect(derivedDelivered(slips)).toEqual({ on: "2026-10-11T10:00:00Z", stamped: true });
  });

  it("uses the first stage of a Technical-only slip", () => {
    const slips = [slip("t", { ...TECH_ONLY, state: "technical_inspection", stages: [stage(TI, "2026-10-11T10:00:00Z")] })];
    expect(derivedDelivered(slips)?.on).toBe("2026-10-11T10:00:00Z");
  });

  it("shows the typed date when there is no completion", () => {
    const track = deriveTransmittalTrack([], { deliveredOn: "2026-10-03" });
    expect(track.delivered).toEqual({ on: "2026-10-03", stamped: false, source: "typed" });
  });

  it("the typed date wins over the stamp", () => {
    const track = deriveTransmittalTrack([slip("a", { stages: [stage(WH, "2026-10-11T10:00:00Z")] })], {
      deliveredOn: "2026-10-03",
    });
    expect(track.delivered).toEqual({ on: "2026-10-03", stamped: false, source: "typed" });
  });
});

describe("Actual Checking", () => {
  it("with no slip is the hand stamp", () => {
    expect(derivedActualChecking([])).toEqual({ status: "none" });
  });

  it("is pending for a Warehouse-and-Technical slip past Warehouse checking but not inspected", () => {
    const checking = derivedActualChecking([slip("a", { ...BOTH, state: "technical_inspection", stages: [stage(WH, "2026-10-10T09:00:00Z"), stage(WR, "2026-10-10T10:00:00Z")] })]);
    expect(checking).toEqual({ status: "pending", done: 0, total: 1 });
  });

  it("is stamped for a Warehouse-only slip past checking", () => {
    const checking = derivedActualChecking([slip("a", { stages: [stage(WH, "2026-10-10T09:00:00Z")] })]);
    expect(checking).toEqual({ status: "stamped", done: 1, total: 1, at: "2026-10-10T09:00:00Z" });
  });

  it("counts n of m and stamps at the latest completion once all are done", () => {
    const slips = [
      slip("a", { ...BOTH, stages: [stage(WH, "2026-10-10T09:00:00Z"), stage(TI, "2026-10-11T09:00:00Z")] }),
      slip("b", { stages: [stage(WH, "2026-10-12T09:00:00Z")] }),
    ];
    expect(derivedActualChecking(slips)).toEqual({ status: "stamped", done: 2, total: 2, at: "2026-10-12T09:00:00Z" });
    expect(derivedActualChecking([slips[0], slip("c", { ...BOTH, stages: [stage(WH, "x")] })])).toMatchObject({
      status: "pending",
      done: 1,
      total: 2,
    });
  });
});

describe("the buyer track reads the Transmittals", () => {
  const row = { source: "local", delivered_on: null, actual_checking_by: null };
  const odoo = {
    purchaseOrder: { ticked: true },
    receivedInOdoo: { ticked: false, partial: false },
    createBill: { ticked: false },
  };

  it("keeps the hand stamp when no Transmittal governs", () => {
    const track = buildBuyerTrack(row, odoo, { transmittal: null });
    expect(track.find((i) => i.key === "actual_checking").source).toBe("stamped");
  });

  it("marks Actual Checking pending with n of m and no stamp to hand-set", () => {
    const transmittal = deriveTransmittalTrack([slip("a", { ...BOTH, stages: [stage(WH, "2026-10-10T09:00:00Z")] })], {});
    const item = buildBuyerTrack(row, odoo, { transmittal }).find((i) => i.key === "actual_checking");
    expect(item).toMatchObject({ source: "derived", partial: true, ticked: false, detail: "pending (0 of 1)" });
  });

  it("marks Delivered stamped from the slips", () => {
    const transmittal = deriveTransmittalTrack([slip("a", { stages: [stage(WH, "2026-10-11T10:00:00Z")] })], {});
    const item = buildBuyerTrack(row, odoo, { transmittal }).find((i) => i.key === "delivered");
    expect(item).toMatchObject({ source: "derived", via: "transmittals", ticked: true, on: "2026-10-11T10:00:00Z" });
  });
});

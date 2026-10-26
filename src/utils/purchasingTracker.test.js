import { describe, expect, it } from "vitest";
import {
  MOVE_BAND,
  NEXT_FILTER,
  buildTracker,
  nextMoveOf,
  stageStates,
  valueOpenByCurrency,
} from "./purchasingTracker";
import { ORDER_GROUP, ORDER_OWNER } from "../constants/orderMonitoring";

const TODAY = new Date("2026-10-21T04:00:00Z");
const daysAgo = (n) => new Date(TODAY.getTime() - n * 86_400_000).toISOString();

const row = (over) => ({
  opportunity_id: "sor-1",
  sales_reference: "S1",
  project_title: "Alpha",
  grp: "to_source",
  target_kind: "purchase_request",
  target_id: "pr-1",
  target_label: "PR one",
  item_count: 2,
  no_canvass_count: 0,
  buyer_id: null,
  canvasser_id: null,
  request_id: "pr-1",
  since: daysAgo(3),
  ...over,
});

const order = (over) => ({
  id: "ip-1",
  number: "TGIPAS_1",
  poNumber: "P01",
  source: "import",
  state: "open",
  entity: "TG",
  supplier: "Acme",
  sors: [{ id: "sor-1", salesReference: "S1", projectTitle: "Alpha" }],
  currency: "USD",
  value: 100,
  createdAt: daysAgo(10),
  ageDays: 10,
  item: { name: "Cutter", more: 0 },
  group: ORDER_GROUP.WAITING_ON_OTHERS,
  next: { label: "Delivered", owner: ORDER_OWNER.OTHERS },
  daysWaiting: 4,
  late: false,
  ...over,
});

const ipasRow = (over) => row({ grp: "on_order", target_kind: "ipas", target_id: "ip-1", target_label: "TGIPAS_1", item_count: 1, ...over });

describe("stages", () => {
  it("counts a SOR's outstanding work per stage, and ticks the stages it is past", () => {
    const { sors } = buildTracker({
      rows: [row({ grp: "to_purchase", item_count: 3 }), ipasRow()],
      orders: [order()],
      today: TODAY,
    });
    const states = stageStates(sors[0]);
    expect(states.map((s) => [s.key, s.n, s.tone])).toEqual([
      ["to_source", 0, "done"],
      ["to_price", 0, "done"],
      ["to_purchase", 3, "open"],
      ["on_order", 1, "open"],
      ["to_check", 0, "none"],
      ["filed", 0, "none"],
    ]);
  });

  it("marks On order late when one of the SOR's orders is late", () => {
    const { sors } = buildTracker({ rows: [ipasRow()], orders: [order({ late: true, group: ORDER_GROUP.NEEDS_CHASING })], today: TODAY });
    expect(stageStates(sors[0]).find((s) => s.key === "on_order").tone).toBe("late");
  });

  it("puts an order whose IPAS the dashboard rows place in To check under To check", () => {
    const { sors } = buildTracker({ rows: [ipasRow({ grp: "to_check" })], orders: [order()], today: TODAY });
    expect(sors[0].byStage).toMatchObject({ on_order: 0, to_check: 1 });
  });

  it("counts filed orders in the Filed stage and shows them only when asked", () => {
    const filed = order({ group: ORDER_GROUP.FILED, state: "filed" });
    expect(buildTracker({ rows: [], orders: [filed], today: TODAY }).sors).toHaveLength(0);
    const { sors, stages } = buildTracker({ rows: [], orders: [filed], filters: { showFiled: true }, today: TODAY });
    expect(sors).toHaveLength(1);
    expect(stages.find((s) => s.key === "filed")).toMatchObject({ count: 1, sorCount: 1 });
  });

  it("counts an open order the dashboard rows do not know as one item where it stands", () => {
    const { sors } = buildTracker({ rows: [], orders: [order()], today: TODAY });
    expect(sors[0].byStage.on_order).toBe(1);
  });

  it("keeps an order with no SOR together on one row", () => {
    const { sors } = buildTracker({ rows: [], orders: [order({ sors: [] }), order({ id: "ip-2", sors: [] })], today: TODAY });
    expect(sors).toHaveLength(1);
    expect(sors[0]).toMatchObject({ noSor: true, short: "No SOR" });
  });

  it("gives a Direct request its own row", () => {
    const { sors } = buildTracker({
      rows: [row({ opportunity_id: null, sales_reference: null, project_title: null, request_id: "pr-9", target_id: "pr-9" })],
      today: TODAY,
    });
    expect(sors[0]).toMatchObject({ direct: true, short: "Direct request" });
  });
});

describe("next move", () => {
  it("is the late order first, whatever else is waiting", () => {
    const next = nextMoveOf(
      [row({ grp: "to_purchase", since: daysAgo(30) })],
      [order({ late: true, daysWaiting: 2, group: ORDER_GROUP.NEEDS_CHASING })],
      { today: TODAY },
    );
    expect(next.move).toMatchObject({ ref: "TGIPAS_1", late: true });
    expect(next.band).toBe(MOVE_BAND.NOW);
    expect(next.more).toBe(1);
  });

  it("prefers a step on our side to one we only wait on", () => {
    const next = nextMoveOf([row({ grp: "to_price", target_kind: "costing_matrix", since: daysAgo(1) })], [order({ daysWaiting: 20 })], { today: TODAY });
    expect(next.move.label).toBe("Finish the Bid Decision");
    expect(next.band).toBe(MOVE_BAND.NOW);
  });

  it("sits in Waiting when only someone else owes a step", () => {
    const next = nextMoveOf([], [order()], { today: TODAY });
    expect(next.band).toBe(MOVE_BAND.WAITING);
    expect(next.move).toMatchObject({ ours: false, ownerLabel: "Supplier, forwarder or port" });
  });

  it("words an order's standing through labelOf", () => {
    const next = nextMoveOf([], [order()], { today: TODAY, labelOf: (n) => `${n.label}, for you` });
    expect(next.move.label).toBe("Delivered, for you");
  });

  it("is clear with nothing open", () => {
    expect(nextMoveOf([], [], { today: TODAY })).toEqual({ band: MOVE_BAND.CLEAR, more: 0, move: null });
  });
});

describe("filters", () => {
  const data = {
    rows: [
      row(),
      row({ opportunity_id: "sor-2", sales_reference: "S2", project_title: "Beta", target_id: "pr-2", buyer_id: "buyer-a", since: daysAgo(20) }),
      ipasRow({ opportunity_id: "sor-3", sales_reference: "S3", project_title: "Gamma", target_id: "ip-3" }),
    ],
    orders: [order({ id: "ip-3", number: "TGIPAS_3", poNumber: "P03", supplier: "Zeta", entity: "TT", sors: [{ id: "sor-3", salesReference: "S3", projectTitle: "Gamma" }] })],
    today: TODAY,
  };
  const ids = (filters) => buildTracker({ ...data, filters }).sors.map((s) => s.salesReference).sort();

  it("searches the S number, the title, and an order's IPAS number, PO number or supplier", () => {
    expect(ids({ search: "beta" })).toEqual(["S2"]);
    expect(ids({ search: "tgipas_3" })).toEqual(["S3"]);
    expect(ids({ search: "p03" })).toEqual(["S3"]);
    expect(ids({ search: "zeta" })).toEqual(["S3"]);
  });

  it("narrows to a stage and leaves the stage totals whole", () => {
    const built = buildTracker({ ...data, filters: { stage: "on_order" } });
    expect(built.sors.map((s) => s.salesReference)).toEqual(["S3"]);
    expect(built.stages.find((s) => s.key === "to_source").count).toBe(4);
  });

  it("narrows project records by buyer and by age", () => {
    expect(ids({ buyerId: "buyer-a" })).toEqual(["S2"]);
    expect(ids({ minAgeDays: 14 })).toEqual(["S2"]);
  });

  it("keeps only the SORs of matching orders when an order filter is set", () => {
    expect(ids({ supplier: "Zeta" })).toEqual(["S3"]);
    expect(ids({ entity: "TT" })).toEqual(["S3"]);
    expect(ids({ source: "local" })).toEqual([]);
  });

  it("splits ours to move from waiting on others, and finds late", () => {
    expect(ids({ next: NEXT_FILTER.OURS })).toEqual(["S1", "S2"]);
    expect(ids({ next: NEXT_FILTER.WAITING })).toEqual(["S3"]);
    expect(ids({ next: NEXT_FILTER.LATE })).toEqual([]);
  });

  it("puts the late, then the oldest, first", () => {
    const built = buildTracker({
      rows: [...data.rows, ipasRow({ opportunity_id: "sor-4", sales_reference: "S4", project_title: "Delta", target_id: "ip-4" })],
      orders: [...data.orders, order({ id: "ip-4", late: true, group: ORDER_GROUP.NEEDS_CHASING, sors: [{ id: "sor-4", salesReference: "S4", projectTitle: "Delta" }] })],
      today: TODAY,
    });
    expect(built.sors.map((s) => s.salesReference)).toEqual(["S4", "S2", "S3", "S1"]);
  });
});

describe("client deadline", () => {
  it("marks a SOR against its delivery deadline", () => {
    const due = new Date(TODAY.getTime() + 2 * 86_400_000).toISOString();
    const { sors } = buildTracker({ rows: [row()], deadlines: new Map([["sor-1", { dueAt: due }]]), nearDays: 5, today: TODAY });
    expect(sors[0].deadline).toMatchObject({ mark: "near", daysLeft: 2 });
  });

  it("has none for a SOR without one", () => {
    expect(buildTracker({ rows: [row()], today: TODAY }).sors[0].deadline).toBeNull();
  });
});

describe("value open", () => {
  it("adds the open orders per currency and leaves filed ones out", () => {
    const total = valueOpenByCurrency([
      order({ value: 100, currency: "USD" }),
      order({ id: "b", value: 50, currency: "USD" }),
      order({ id: "c", value: 900, currency: "PHP" }),
      order({ id: "d", value: 7, currency: "USD", group: ORDER_GROUP.FILED }),
    ]);
    expect(total).toEqual([
      { currency: "PHP", total: 900 },
      { currency: "USD", total: 150 },
    ]);
  });
});

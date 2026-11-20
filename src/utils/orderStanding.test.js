import { describe, it, expect } from "vitest";
import { orderStanding, standingLabel } from "./orderStanding";
import { TRANSMITTAL_STAFF_LIST } from "../constants/transmittals";
import { ORDER_OWNER_LABELS } from "../constants/orderMonitoring";

const TODAY = "2026-10-20";

const slip = (id, number, extra = {}) => ({
  id,
  number,
  state: "warehouse_checking",
  created_at: "2026-10-10T08:00:00Z",
  submitted_at: "2026-10-10T08:00:00Z",
  check_warehouse: true,
  check_technical: false,
  stages: [],
  lines: [],
  ...extra,
});

const order = (slips) => ({
  id: "ipas-1",
  state: "approved",
  source: "local",
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  computationStatus: null,
  buyerTrack: [],
  slips,
});

const nextOf = (slips) => orderStanding(order(slips), [], TODAY).next;

describe("Transmittal rows name the slip and the action (#588)", () => {
  it("names the slip waiting on the Warehouse", () => {
    const next = nextOf([slip("s1", "TG03-0012")]);
    expect(next.label).toBe("TG03-0012 needs Warehouse checking");
    expect(next.slip).toEqual({ id: "s1", number: "TG03-0012" });
    expect(next.list).toBe(TRANSMITTAL_STAFF_LIST.WAREHOUSE);
  });

  it("names the slip waiting on Technical checking", () => {
    const next = nextOf([slip("s1", "TG03-0013", { state: "technical_inspection", check_warehouse: false, check_technical: true })]);
    expect(next.label).toBe("TG03-0013 needs Technical checking");
    expect(next.list).toBe(TRANSMITTAL_STAFF_LIST.TECHNICAL);
  });

  it("names the oldest slip and counts the rest", () => {
    const next = nextOf([
      slip("s2", "TG03-0020", { submitted_at: "2026-10-12T08:00:00Z" }),
      slip("s1", "TG03-0019", { submitted_at: "2026-10-11T08:00:00Z" }),
    ]);
    expect(next.label).toBe("TG03-0019 needs Warehouse checking (+1 more)");
    expect(next.slip.id).toBe("s1");
  });

  it("names the slip awaiting Check by", () => {
    const done = { stage: "warehouse_checking", completed_at: "2026-10-15T08:00:00Z" };
    const next = nextOf([slip("s1", "TG03-0012", { state: "awaiting_check", stages: [done] })]);
    expect(next.label).toBe("TG03-0012 needs Check by");
    expect(next.slip).toEqual({ id: "s1", number: "TG03-0012" });
    expect(next.list).toBe(TRANSMITTAL_STAFF_LIST.CHECK_BY);
  });
});

describe("standingLabel", () => {
  const next = { label: "TG03-0012 needs Check by", list: TRANSMITTAL_STAFF_LIST.CHECK_BY };

  it("leaves the label alone for a viewer on the list", () => {
    expect(standingLabel(next, [TRANSMITTAL_STAFF_LIST.CHECK_BY])).toBe("TG03-0012 needs Check by");
  });

  it("ends 'waiting on <list name>' for a viewer who cannot act", () => {
    expect(standingLabel(next, [TRANSMITTAL_STAFF_LIST.WAREHOUSE])).toBe(
      "TG03-0012 needs Check by, waiting on Transmittal · Check by",
    );
    expect(standingLabel(next, null)).toBe("TG03-0012 needs Check by, waiting on Transmittal · Check by");
  });

  it("does the same for Warehouse and Technical checking", () => {
    const warehouse = { label: "TG03-0012 needs Warehouse checking", list: TRANSMITTAL_STAFF_LIST.WAREHOUSE };
    const technical = { label: "TG03-0013 needs Technical checking", list: TRANSMITTAL_STAFF_LIST.TECHNICAL };
    expect(standingLabel(warehouse, [])).toBe("TG03-0012 needs Warehouse checking, waiting on Transmittal · Warehouse");
    expect(standingLabel(technical, [])).toBe("TG03-0013 needs Technical checking, waiting on Transmittal · Technical");
  });

  it("leaves rows with no list as they are", () => {
    expect(standingLabel({ label: "With P.O.P — no payment carries proof", list: null }, [])).toBe(
      "With P.O.P — no payment carries proof",
    );
  });
});

describe("Filing waits for section 3 (#590)", () => {
  const costsDone = (extra = {}) => ({
    ...order([]),
    computationStatus: "lc_odoo_done",
    costsCompletedAt: "2026-10-10T00:00:00Z",
    ...extra,
  });
  const RULES = [{ step: "section_3_approval", days: 3 }];

  it("is waiting on the section 3 list once section 3 is submitted but not approved", () => {
    const standing = orderStanding(costsDone({ section3Submitted: true, section3Approved: false }), [], TODAY);
    expect(standing.next).toMatchObject({
      label: "Section 3 waiting for approval",
      owner: "section_3_approvers",
      step: "section_3_approval",
    });
    expect(ORDER_OWNER_LABELS[standing.next.owner]).toBe("Approve · 3 Costs");
  });

  it("is owed by Purchasing until section 3 is submitted", () => {
    const standing = orderStanding(costsDone({ section3Submitted: false, section3Approved: false }), [], TODAY);
    expect(standing.next).toMatchObject({
      label: "Section 3 waiting for submit",
      owner: "purchasing",
      step: "section_3_approval",
    });
  });

  it("is ready to file once section 3 is approved", () => {
    const next = orderStanding(costsDone({ section3Approved: true }), [], TODAY).next;
    expect(next).toMatchObject({ label: "Costs complete — ready to file", owner: "signers", step: "ready_to_file" });
  });

  it("treats a missing section 3 approval as not approved", () => {
    expect(orderStanding(costsDone(), [], TODAY).next.step).toBe("section_3_approval");
  });

  it("ages under its own rule key, blank by default", () => {
    const blank = orderStanding(costsDone(), [], TODAY);
    expect(blank.ruleDays).toBeNull();
    expect(blank.late).toBe(false);
    const ruled = orderStanding(costsDone(), RULES, TODAY);
    expect(ruled.ruleDays).toBe(3);
    expect(ruled.late).toBe(true);
    expect(ruled.group).toBe("needs_chasing");
  });

  it("does not use the ready to file rule for the section 3 wait", () => {
    const standing = orderStanding(costsDone(), [{ step: "ready_to_file", days: 1 }], TODAY);
    expect(standing.ruleDays).toBeNull();
  });
});

describe("On-Hold (#597)", () => {
  const rules = [{ step: "in_transit", days: 1 }];
  const held = (extra = {}) => ({
    ...order([]),
    onHold: true,
    updatedAt: "2026-10-10T00:00:00Z",
    status: "in_transit",
    statusSteps: [{ step: "in_transit", on: "2026-10-10" }],
    ...extra,
  });

  it("waits on someone else, whatever step it was at", () => {
    const standing = orderStanding(held(), rules, TODAY);
    expect(standing.group).toBe("waiting_on_others");
    expect(standing.next.label).toBe("On-Hold");
    expect(standing.next.step).toBe("on_hold");
  });

  it("never counts as late, even past an ageing rule it would otherwise break", () => {
    const standing = orderStanding(held(), rules, TODAY);
    expect(standing.late).toBe(false);
    expect(standing.ruleDays).toBeNull();
    expect(standing.daysPastRule).toBeNull();
    const free = orderStanding(held({ onHold: false }), rules, TODAY);
    expect(free.late).toBe(true);
    expect(free.group).toBe("needs_chasing");
  });

  it("counts how long it has been held from the last change", () => {
    expect(orderStanding(held(), rules, TODAY).daysWaiting).toBe(10);
  });

  it("a filed order is Filed even if the flag were stale", () => {
    expect(orderStanding(held({ state: "filed" }), rules, TODAY).group).toBe("filed");
  });
});

describe("The IPAS Status steps (#1156)", () => {
  const at = (status, on, extra = {}) => ({
    ...order([]),
    status,
    statusSteps: [{ step: status, on }],
    ...extra,
  });

  it("Order-Draft is waiting on us, owed by Purchasing", () => {
    const standing = orderStanding(at("order_draft", "2026-10-18"), [], TODAY);
    expect(standing.group).toBe("waiting_on_us");
    expect(standing.next).toMatchObject({ label: "Order-Draft", owner: "purchasing", step: "order_draft" });
    expect(standing.daysWaiting).toBe(2);
  });

  it("Payment Approval is waiting on us, owed by the order approvers", () => {
    const standing = orderStanding(at("payment_approval", "2026-10-18"), [], TODAY);
    expect(standing.group).toBe("waiting_on_us");
    expect(standing.next.owner).toBe("order_approvers");
    expect(ORDER_OWNER_LABELS[standing.next.owner]).toBe("Order approvers");
  });

  it.each(["ordered", "processing", "shipped", "in_transit", "customs", "local_hub", "out_for_delivery"])(
    "%s is waiting on someone else",
    (step) => {
      const standing = orderStanding(at(step, "2026-10-18"), [], TODAY);
      expect(standing.group).toBe("waiting_on_others");
      expect(standing.next).toMatchObject({ owner: "others", step });
    },
  );

  it("counts the wait from the step's own day, and goes late past its rule", () => {
    const standing = orderStanding(at("in_transit", "2026-10-10"), [{ step: "in_transit", days: 3 }], TODAY);
    expect(standing.daysWaiting).toBe(10);
    expect(standing.ruleDays).toBe(3);
    expect(standing.late).toBe(true);
    expect(standing.group).toBe("needs_chasing");
    expect(standing.daysPastRule).toBe(7);
  });

  it("an order with no stored status reads as Order-Draft", () => {
    expect(orderStanding(order([]), [], TODAY).next.step).toBe("order_draft");
  });

  it("Delivered with no Transmittal says so, counted from the Delivered day", () => {
    const standing = orderStanding(at("delivered", "2026-10-15"), [], TODAY);
    expect(standing.next).toMatchObject({ label: "Delivered — no Transmittal raised", owner: "purchasing", step: "no_transmittal" });
    expect(standing.daysWaiting).toBe(5);
  });

  it("a Direct delivery never chases the Transmittal or Actual Checking (#1158)", () => {
    const direct = { ...at("delivered", "2026-10-15"), directDelivery: true };
    expect(orderStanding(direct, [], TODAY).next.step).not.toBe("no_transmittal");
    const track = [
      { key: "received_in_odoo", ticked: true },
      { key: "create_bill", ticked: true },
      { key: "actual_checking", ticked: false },
    ];
    expect(orderStanding({ ...direct, buyerTrack: track }, [], TODAY).next.step).not.toBe("actual_checking");
    expect(orderStanding({ ...direct, directDelivery: false, buyerTrack: track }, [], TODAY).next.step).toBe("no_transmittal");
  });

  it("after Delivered and a Transmittal, asks for Received in Odoo, then Create Bill, then Actual Checking", () => {
    const track = (ticked) => ["received_in_odoo", "create_bill", "actual_checking"].map((key) => ({ key, ticked: ticked.includes(key) }));
    const done = { stage: "warehouse_checking", completed_at: "2026-10-16T08:00:00Z" };
    const withSlip = [slip("s1", "TG03-0001", { state: "closed", stages: [done] })];
    const base = (ticked) => ({ ...at("delivered", "2026-10-15"), slips: withSlip, buyerTrack: track(ticked) });

    expect(orderStanding(base([]), [], TODAY).next).toMatchObject({ step: "received_in_odoo", owner: "warehouse" });
    expect(orderStanding(base(["received_in_odoo"]), [], TODAY).next).toMatchObject({ step: "create_bill", owner: "finance" });
    expect(orderStanding(base(["received_in_odoo", "create_bill"]), [], TODAY).next).toMatchObject({ step: "actual_checking" });
    expect(orderStanding(base(["received_in_odoo", "create_bill", "actual_checking"]), [], TODAY).next).toMatchObject({
      label: "Costs not complete",
    });
  });

  it("the facts after Delivered have no rule, so they never go late", () => {
    const done = { stage: "warehouse_checking", completed_at: "2026-10-16T08:00:00Z" };
    const input = {
      ...at("delivered", "2026-09-01"),
      slips: [slip("s1", "TG03-0001", { state: "closed", stages: [done] })],
      buyerTrack: [{ key: "received_in_odoo", ticked: false }],
    };
    const standing = orderStanding(input, [{ step: "received_in_odoo", days: 1 }], TODAY);
    expect(standing.ruleDays).toBeNull();
    expect(standing.late).toBe(false);
  });
});

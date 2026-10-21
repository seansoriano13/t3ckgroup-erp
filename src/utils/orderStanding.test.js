import { describe, it, expect } from "vitest";
import { orderStanding, standingLabel } from "./orderStanding";
import { TRANSMITTAL_STAFF_LIST } from "../constants/transmittals";

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

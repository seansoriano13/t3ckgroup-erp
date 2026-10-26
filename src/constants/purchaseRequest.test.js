import { describe, it, expect } from "vitest";
import {
  ITEM_STATUS,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  CLOSED_STATUSES,
  MEMBER_SIDE,
  allowedTransitions,
  stockWarning,
  isClosedStatus,
  isSettled,
  legacyOutcomeToStatus,
  requestStageLabel,
  REQUEST_KIND,
  requestIdentity,
  requestKind,
} from "./purchaseRequest";

const S = ITEM_STATUS;
const OPEN = [S.NOT_CHECKED, S.TO_PURCHASE, S.STILL_CANVASSING, S.PURCHASED];

describe("the status vocabulary", () => {
  it("has the eight statuses, each labelled", () => {
    expect(ITEM_STATUSES).toHaveLength(8);
    expect(new Set(ITEM_STATUSES).size).toBe(8);
    for (const status of ITEM_STATUSES) expect(ITEM_STATUS_LABELS[status]).toBeTruthy();
  });

  it("closes Available, Received and the two ways out, and nothing else", () => {
    expect([...CLOSED_STATUSES].sort()).toEqual(
      [S.AVAILABLE, S.RECEIVED, S.CANNOT_SOURCE, S.CANCELLED].sort(),
    );
    for (const status of OPEN) expect(isClosedStatus(status)).toBe(false);
  });
});

describe("allowedTransitions — purchasing side", () => {
  const p = (status) => allowedTransitions(status, MEMBER_SIDE.PURCHASING);
  const waysOut = [S.CANNOT_SOURCE, S.CANCELLED];

  it("takes Requested to From stock or To order, or out", () => {
    expect(p(S.NOT_CHECKED).sort()).toEqual([S.AVAILABLE, S.TO_PURCHASE, ...waysOut].sort());
    expect(p(S.NOT_CHECKED)).toContain(S.CANNOT_SOURCE);
  });

  it("takes To purchase to Available or Still canvassing, or out", () => {
    expect(p(S.TO_PURCHASE).sort()).toEqual([S.AVAILABLE, S.STILL_CANVASSING, ...waysOut].sort());
  });

  it("takes Still canvassing and Purchased only out: a P0 moves them on (#684)", () => {
    expect(p(S.STILL_CANVASSING).sort()).toEqual([...waysOut].sort());
    expect(p(S.PURCHASED).sort()).toEqual([...waysOut].sort());
  });

  it("never offers Purchased or Received by hand", () => {
    for (const status of [S.NOT_CHECKED, S.TO_PURCHASE, S.STILL_CANVASSING, S.PURCHASED]) {
      expect(p(status)).not.toContain(S.PURCHASED);
      expect(p(status)).not.toContain(S.RECEIVED);
    }
  });

  it("never skips ahead or steps back on the path", () => {
    expect(p(S.NOT_CHECKED)).not.toContain(S.STILL_CANVASSING);
    expect(p(S.NOT_CHECKED)).not.toContain(S.PURCHASED);
    expect(p(S.TO_PURCHASE)).not.toContain(S.RECEIVED);
    expect(p(S.STILL_CANVASSING)).not.toContain(S.TO_PURCHASE);
    expect(p(S.PURCHASED)).not.toContain(S.STILL_CANVASSING);
  });

  it("moves a closed item nowhere, except Available, which can be chosen again", () => {
    for (const status of CLOSED_STATUSES.filter((c) => c !== S.AVAILABLE)) expect(p(status)).toEqual([]);
    expect(p(S.AVAILABLE).sort()).toEqual([S.AVAILABLE, S.TO_PURCHASE].sort());
  });
});

describe("allowedTransitions — sales side", () => {
  it("may cancel from any open status, and choose Available or To purchase", () => {
    for (const status of OPEN) {
      expect(allowedTransitions(status, MEMBER_SIDE.SALES)).toContain(S.CANCELLED);
      expect(allowedTransitions(status, MEMBER_SIDE.SALES)).not.toContain(S.CANNOT_SOURCE);
    }
    expect(allowedTransitions(S.NOT_CHECKED, MEMBER_SIDE.SALES).sort()).toEqual(
      [S.AVAILABLE, S.TO_PURCHASE, S.CANCELLED].sort(),
    );
  });

  it("cannot choose Still canvassing, Purchased or Received", () => {
    for (const status of OPEN) {
      for (const to of [S.STILL_CANVASSING, S.PURCHASED, S.RECEIVED]) {
        expect(allowedTransitions(status, MEMBER_SIDE.SALES)).not.toContain(to);
      }
    }
  });

  it("cannot set Ordered or any other step", () => {
    expect(allowedTransitions(S.TO_PURCHASE, MEMBER_SIDE.SALES)).not.toContain(S.PURCHASED);
  });

  it("cannot reopen or cancel a closed item", () => {
    for (const status of CLOSED_STATUSES.filter((c) => c !== S.AVAILABLE)) {
      expect(allowedTransitions(status, MEMBER_SIDE.SALES)).toEqual([]);
    }
    expect(allowedTransitions(S.AVAILABLE, MEMBER_SIDE.SALES)).not.toContain(S.CANCELLED);
  });
});

describe("allowedTransitions — any other side", () => {
  it("lets a deal member choose Available or To purchase, and nothing else", () => {
    expect(allowedTransitions(S.NOT_CHECKED, MEMBER_SIDE.OTHER).sort()).toEqual([S.AVAILABLE, S.TO_PURCHASE].sort());
    expect(allowedTransitions(S.PURCHASED, MEMBER_SIDE.OTHER)).toEqual([]);
  });

  it("changes nothing for someone who is not on the request", () => {
    for (const status of ITEM_STATUSES) expect(allowedTransitions(status, undefined)).toEqual([]);
  });

  it("treats an unknown status as going nowhere", () => {
    expect(allowedTransitions("lost_in_transit", MEMBER_SIDE.PURCHASING)).toEqual([]);
  });
});

describe("isSettled", () => {
  it("is settled with no items", () => {
    expect(isSettled([])).toBe(true);
  });

  it("is settled with no request at all", () => {
    expect(isSettled(null)).toBe(true);
    expect(isSettled(undefined)).toBe(true);
  });

  it("is settled when every item is closed", () => {
    expect(isSettled(CLOSED_STATUSES.map((status) => ({ status })))).toBe(true);
  });

  it("is not settled while one item is open", () => {
    for (const open of OPEN) {
      expect(isSettled([{ status: S.RECEIVED }, { status: open }, { status: S.CANCELLED }])).toBe(false);
    }
  });

  describe("as of a past moment", () => {
    const asOf = "2026-10-05T00:00:00Z";
    const before = "2026-10-01T00:00:00Z";
    const after = "2026-10-06T00:00:00Z";

    it("counts an item closed by then as closed", () => {
      expect(isSettled([{ status: S.RECEIVED, created_at: before, status_changed_at: before }], { asOf })).toBe(true);
    });

    it("counts an item closed only afterwards as still open then", () => {
      expect(isSettled([{ status: S.RECEIVED, created_at: before, status_changed_at: after }], { asOf })).toBe(false);
    });

    it("ignores an item raised afterwards", () => {
      expect(isSettled([{ status: S.NOT_CHECKED, created_at: after, status_changed_at: null }], { asOf })).toBe(true);
    });

    it("counts an item open now and raised by then as open", () => {
      expect(isSettled([{ status: S.PURCHASED, created_at: before, status_changed_at: before }], { asOf })).toBe(false);
    });
  });
});

describe("legacyOutcomeToStatus", () => {
  it.each([
    ["IN_PROGRESS", S.STILL_CANVASSING],
    ["PURCHASED", S.PURCHASED],
    ["ON_ORDER", S.PURCHASED],
    ["DELIVERED", S.RECEIVED],
    ["ALREADY_EXISTS", S.AVAILABLE],
    ["SUBSTITUTED", S.CANCELLED],
    ["UNAVAILABLE", S.CANNOT_SOURCE],
    [null, S.NOT_CHECKED],
  ])("maps %s to %s", (outcome, status) => {
    expect(legacyOutcomeToStatus(outcome)).toBe(status);
  });

  it("maps a missing outcome to Requested", () => {
    expect(legacyOutcomeToStatus(undefined)).toBe(S.NOT_CHECKED);
  });

  it("refuses a value the legacy table never allowed", () => {
    expect(() => legacyOutcomeToStatus("SHIPPED")).toThrow(/SHIPPED/);
  });
});

describe("requestStageLabel", () => {
  it("reads the Flow Stage when the SOR has one", () => {
    expect(requestStageLabel({ stage_name: "Bid Submitted", sor_status: "LEAD" })).toBe("Bid Submitted");
  });

  it("labels the legacy status of an SOR registered before Sales Flows", () => {
    expect(requestStageLabel({ stage_name: null, sor_status: "PROPOSAL_SUBMITTED" })).toBe("Proposal Submitted");
  });

  it("is null with neither, or with a status it doesn't know", () => {
    expect(requestStageLabel({ stage_name: null, sor_status: null })).toBeNull();
    expect(requestStageLabel({ sor_status: "NOT_A_STATUS" })).toBeNull();
    expect(requestStageLabel(null)).toBeNull();
  });
});

describe("a request's kind (#179)", () => {
  it("is Project with an SOR and Direct without one", () => {
    expect(requestKind({ opportunity_id: "o1" })).toBe(REQUEST_KIND.PROJECT);
    expect(requestKind({ opportunity_id: null })).toBe(REQUEST_KIND.DIRECT);
  });

  it("names a Project request by its SOR and a Direct one by its title", () => {
    expect(requestIdentity({ opportunity_id: "o1", sales_reference: "S0001", project_title: "Fit-out" })).toEqual({
      reference: "S0001",
      title: "Fit-out",
    });
    expect(requestIdentity({ opportunity_id: null, title: "Printer toner" })).toEqual({
      reference: "Direct",
      title: "Printer toner",
    });
  });

  it("lets the Requester only cancel, like the sales side", () => {
    expect(allowedTransitions(S.NOT_CHECKED, MEMBER_SIDE.REQUESTER)).toEqual([S.CANCELLED]);
    expect(allowedTransitions(S.RECEIVED, MEMBER_SIDE.REQUESTER)).toEqual([]);
  });
});

describe("stockWarning (#681)", () => {
  const warned = { status: S.AVAILABLE, stock_short_free: "1.00", stock_short_needed: "4.00" };

  it('says "Now x free of y" on an Available line a fresh stock check found short', () => {
    expect(stockWarning(warned)).toMatchObject({ free: 1, needed: 4, label: "Now 1 free of 4" });
  });

  it("says nothing once the line is no longer Available, or when no check flagged it", () => {
    expect(stockWarning({ ...warned, status: S.TO_PURCHASE })).toBeNull();
    expect(stockWarning({ status: S.AVAILABLE, stock_short_free: null, stock_short_needed: null })).toBeNull();
  });
});

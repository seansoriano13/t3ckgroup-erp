import { describe, it, expect } from "vitest";
import {
  ITEM_STATUS,
  ITEM_STATUSES,
  ITEM_STATUS_LABELS,
  CLOSED_STATUSES,
  MEMBER_SIDE,
  allowedTransitions,
  isClosedStatus,
  isSettled,
  legacyOutcomeToStatus,
} from "./purchaseRequest";

const S = ITEM_STATUS;
const OPEN = [S.REQUESTED, S.TO_ORDER, S.CANVASSING, S.ORDERED];

describe("the status vocabulary", () => {
  it("has the nine statuses, each labelled", () => {
    expect(ITEM_STATUSES).toHaveLength(9);
    expect(new Set(ITEM_STATUSES).size).toBe(9);
    for (const status of ITEM_STATUSES) expect(ITEM_STATUS_LABELS[status]).toBeTruthy();
  });

  it("closes From stock, Received and the three ways out, and nothing else", () => {
    expect([...CLOSED_STATUSES].sort()).toEqual(
      [S.FROM_STOCK, S.RECEIVED, S.SUBSTITUTED, S.CANNOT_SOURCE, S.CANCELLED].sort(),
    );
    for (const status of OPEN) expect(isClosedStatus(status)).toBe(false);
  });
});

describe("allowedTransitions — purchasing side", () => {
  const p = (status) => allowedTransitions(status, MEMBER_SIDE.PURCHASING);
  const waysOut = [S.SUBSTITUTED, S.CANNOT_SOURCE, S.CANCELLED];

  it("takes Requested to From stock or To order, or out", () => {
    expect(p(S.REQUESTED).sort()).toEqual([S.FROM_STOCK, S.TO_ORDER, ...waysOut].sort());
  });

  it("takes To order to Canvassing, or straight to Ordered without a Canvass", () => {
    expect(p(S.TO_ORDER).sort()).toEqual([S.CANVASSING, S.ORDERED, ...waysOut].sort());
  });

  it("takes Canvassing to Ordered, or out", () => {
    expect(p(S.CANVASSING).sort()).toEqual([S.ORDERED, ...waysOut].sort());
  });

  it("takes Ordered to Received, or out", () => {
    expect(p(S.ORDERED).sort()).toEqual([S.RECEIVED, ...waysOut].sort());
  });

  it("never skips ahead or steps back on the path", () => {
    expect(p(S.REQUESTED)).not.toContain(S.CANVASSING);
    expect(p(S.REQUESTED)).not.toContain(S.ORDERED);
    expect(p(S.TO_ORDER)).not.toContain(S.RECEIVED);
    expect(p(S.CANVASSING)).not.toContain(S.TO_ORDER);
    expect(p(S.ORDERED)).not.toContain(S.CANVASSING);
  });

  it("moves a closed item nowhere", () => {
    for (const status of CLOSED_STATUSES) expect(p(status)).toEqual([]);
  });
});

describe("allowedTransitions — sales side", () => {
  it("may only cancel, from any open status", () => {
    for (const status of OPEN) {
      expect(allowedTransitions(status, MEMBER_SIDE.SALES)).toEqual([S.CANCELLED]);
    }
  });

  it("cannot set Ordered or any other step", () => {
    expect(allowedTransitions(S.TO_ORDER, MEMBER_SIDE.SALES)).not.toContain(S.ORDERED);
  });

  it("cannot reopen or cancel a closed item", () => {
    for (const status of CLOSED_STATUSES) {
      expect(allowedTransitions(status, MEMBER_SIDE.SALES)).toEqual([]);
    }
  });
});

describe("allowedTransitions — any other side", () => {
  it("changes nothing", () => {
    for (const status of ITEM_STATUSES) {
      expect(allowedTransitions(status, MEMBER_SIDE.OTHER)).toEqual([]);
      expect(allowedTransitions(status, undefined)).toEqual([]);
    }
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
      expect(isSettled([{ status: S.REQUESTED, created_at: after, status_changed_at: null }], { asOf })).toBe(true);
    });

    it("counts an item open now and raised by then as open", () => {
      expect(isSettled([{ status: S.ORDERED, created_at: before, status_changed_at: before }], { asOf })).toBe(false);
    });
  });
});

describe("legacyOutcomeToStatus", () => {
  it.each([
    ["IN_PROGRESS", S.CANVASSING],
    ["PURCHASED", S.ORDERED],
    ["ON_ORDER", S.ORDERED],
    ["DELIVERED", S.RECEIVED],
    ["ALREADY_EXISTS", S.FROM_STOCK],
    ["SUBSTITUTED", S.SUBSTITUTED],
    ["UNAVAILABLE", S.CANNOT_SOURCE],
    [null, S.REQUESTED],
  ])("maps %s to %s", (outcome, status) => {
    expect(legacyOutcomeToStatus(outcome)).toBe(status);
  });

  it("maps a missing outcome to Requested", () => {
    expect(legacyOutcomeToStatus(undefined)).toBe(S.REQUESTED);
  });

  it("refuses a value the legacy table never allowed", () => {
    expect(() => legacyOutcomeToStatus("SHIPPED")).toThrow(/SHIPPED/);
  });
});

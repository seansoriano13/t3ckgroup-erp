import { describe, expect, it } from "vitest";

import {
  ANY,
  CANVASS_STATUS,
  canvassExportRows,
  canvassHref,
  canvassLocked,
  canvassProjectLabel,
  canvassStatusOf,
  canvassWinnersLabel,
  filterCanvasses,
} from "./canvassList";

const row = (over = {}) => ({
  id: "c1",
  number: "CNV_0001",
  requestId: "r1",
  requestLabel: "PR-0001 Gloves",
  salesReference: null,
  projectTitle: null,
  canvasserId: "e1",
  canvasserName: "Ana",
  supplierCount: 3,
  lineCount: 2,
  winnerCount: 0,
  openLineCount: 2,
  openWinnerCount: 0,
  lockedLineCount: 0,
  noOtherSupplier: false,
  supplierNames: ["Acme", "Bolt"],
  productNames: ["Nitrile gloves", "Face mask"],
  updatedAt: "2026-11-10T00:00:00Z",
  ...over,
});

describe("canvassStatusOf", () => {
  it("needs suppliers with fewer than three and no note", () => {
    expect(canvassStatusOf(row({ supplierCount: 2 })).key).toBe(CANVASS_STATUS.NEEDS_SUPPLIERS);
    expect(canvassStatusOf(row({ supplierCount: 2 })).label).toBe("Needs suppliers");
  });

  it("a No other supplier note stands in for the third supplier", () => {
    expect(canvassStatusOf(row({ supplierCount: 1, noOtherSupplier: true })).key).toBe(CANVASS_STATUS.NEEDS_WINNERS);
  });

  it("needs winners until every open line has one", () => {
    expect(canvassStatusOf(row({ openWinnerCount: 1 })).label).toBe("Needs winners");
  });

  it("winners picked when every open line has one", () => {
    expect(canvassStatusOf(row({ openWinnerCount: 2, winnerCount: 2 })).label).toBe("Winners picked");
  });

  it("winners picked when the only lines left open have winners and the rest are locked", () => {
    expect(canvassStatusOf(row({ openLineCount: 1, openWinnerCount: 1, lockedLineCount: 1 })).key).toBe(CANVASS_STATUS.WINNERS_PICKED);
  });
});

describe("canvassLocked", () => {
  it("is locked only when every line is locked", () => {
    expect(canvassLocked(row({ lockedLineCount: 1 }))).toBe(false);
    expect(canvassLocked(row({ lockedLineCount: 2 }))).toBe(true);
    expect(canvassLocked(row({ lineCount: 0, lockedLineCount: 0 }))).toBe(false);
  });
});

describe("row labels", () => {
  it("names the project, or Direct request", () => {
    expect(canvassProjectLabel(row())).toBe("Direct request");
    expect(canvassProjectLabel(row({ salesReference: "S07983", projectTitle: "Hospital beds" }))).toBe("S07983 · Hospital beds");
  });

  it("counts lines with a winner out of all lines", () => {
    expect(canvassWinnersLabel(row({ winnerCount: 1 }))).toBe("1 of 2");
  });

  it("exports the rows as shown", () => {
    expect(canvassExportRows([row()])).toEqual([
      ["CNV_0001", "PR-0001 Gloves", "Direct request", "Ana", 3, "0 of 2", "Needs winners", "2026-11-10T00:00:00Z"],
    ]);
  });
});

describe("filterCanvasses", () => {
  const rows = [row(), row({ id: "c2", number: "CNV_0002", requestLabel: "PR-0002 Tools", supplierNames: ["Delta"], productNames: ["Hammer"], canvasserId: "e2", supplierCount: 1 })];

  it("searches number, request, supplier and product", () => {
    expect(filterCanvasses(rows, { search: "cnv_0002" }).map((r) => r.id)).toEqual(["c2"]);
    expect(filterCanvasses(rows, { search: "gloves" }).map((r) => r.id)).toEqual(["c1"]);
    expect(filterCanvasses(rows, { search: "delta" }).map((r) => r.id)).toEqual(["c2"]);
    expect(filterCanvasses(rows, { search: "hammer" }).map((r) => r.id)).toEqual(["c2"]);
  });

  it("narrows by Canvasser and status", () => {
    expect(filterCanvasses(rows, { canvasserId: "e2" }).map((r) => r.id)).toEqual(["c2"]);
    expect(filterCanvasses(rows, { status: CANVASS_STATUS.NEEDS_SUPPLIERS }).map((r) => r.id)).toEqual(["c2"]);
    expect(filterCanvasses(rows, { status: ANY })).toHaveLength(2);
  });
});

describe("canvassHref", () => {
  it("opens the request with its Canvass, at a line when given", () => {
    expect(canvassHref({ requestId: "r1" })).toBe("/purchasing?request=r1&canvass=1");
    expect(canvassHref({ requestId: "r1", itemId: "i9" })).toBe("/purchasing?request=r1&canvass=1&line=i9");
  });
});

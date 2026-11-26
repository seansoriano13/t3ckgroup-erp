import { describe, expect, it } from "vitest";
import {
  OPEX_HEALTH,
  OPEX_READ_FILTER,
  OPEX_STATE_FILTER,
  filterOpexRows,
  inOpexState,
  lineBadge,
  opexHealth,
  opexIssues,
  opexListRow,
  opexTotals,
  p0Groups,
} from "./opexList";

/** The OPEX list's and window's small rules. Made-up figures only. */

const row = (over = {}) => ({ id: "r1", s0_number: "S00001", snapshot: { project_name: "Made-up", contract_price: 1000, revenue: 300, revenue_percent: 30, read_at: "2026-11-20T00:00:00Z" }, ...over });

describe("opexHealth", () => {
  it("is on target at the go line, below under it, a loss under zero, not read without a figure", () => {
    expect(opexHealth(200, 20, 20)).toBe(OPEX_HEALTH.ON_TARGET);
    expect(opexHealth(100, 19.99, 20)).toBe(OPEX_HEALTH.BELOW);
    expect(opexHealth(-5, -0.5, 20)).toBe(OPEX_HEALTH.LOSS);
    expect(opexHealth(null, null, 20)).toBe(OPEX_HEALTH.UNREAD);
  });
});

describe("opexListRow", () => {
  it("reads the saved snapshot, numbers as numbers", () => {
    const r = opexListRow(row({ snapshot: { contract_price: "1000.50", revenue: "100", revenue_percent: "10", project_name: "P" } }));
    expect(r).toMatchObject({ s0: "S00001", project: "P", contract: 1000.5, revenue: 100, pct: 10, health: OPEX_HEALTH.BELOW });
  });

  it("is not read yet without a snapshot", () => {
    expect(opexListRow(row({ snapshot: null })).health).toBe(OPEX_HEALTH.UNREAD);
  });
});

describe("filters and totals", () => {
  const now = new Date("2026-11-26T00:00:00Z");
  const rows = [
    opexListRow(row()),
    opexListRow(row({ id: "r2", s0_number: "S00002", snapshot: { project_name: "Bridge", contract_price: 500, revenue: 50, revenue_percent: 10, read_at: "2026-09-01T00:00:00Z" } })),
    opexListRow(row({ id: "r3", s0_number: "S00003", snapshot: { project_name: "Loss", contract_price: 100, revenue: -10, revenue_percent: -10, read_at: "2026-11-25T00:00:00Z" } })),
  ];

  it("searches S0 and project", () => {
    expect(filterOpexRows(rows, { search: "bridge" }).map((r) => r.s0)).toEqual(["S00002"]);
    expect(filterOpexRows(rows, { search: "s00003" }).map((r) => r.s0)).toEqual(["S00003"]);
  });

  it("filters by when it was last read", () => {
    expect(filterOpexRows(rows, { readWhen: OPEX_READ_FILTER.WEEK }, now).map((r) => r.s0)).toEqual(["S00001", "S00003"]);
    expect(filterOpexRows(rows, { readWhen: OPEX_READ_FILTER.STALE }, now).map((r) => r.s0)).toEqual(["S00002"]);
  });

  it("puts losses under Below go line", () => {
    expect(rows.filter((r) => inOpexState(r, OPEX_STATE_FILTER.BELOW)).map((r) => r.s0)).toEqual(["S00002", "S00003"]);
    expect(rows.filter((r) => inOpexState(r, OPEX_STATE_FILTER.ON_TARGET)).map((r) => r.s0)).toEqual(["S00001"]);
  });

  it("adds up to the centavo and works Revenue as a share of the contract prices", () => {
    expect(opexTotals(rows)).toMatchObject({ count: 3, contract: 1600, revenue: 340, pct: 21.25 });
    expect(opexTotals([])).toMatchObject({ contract: null, pct: null });
  });
});

describe("the window's rules", () => {
  const line = (over) => ({ lineId: 1, p0: "P00001", supplier: "S", p0State: "purchase", marks: [], ...over });

  it("groups lines by P0 in read order", () => {
    const groups = p0Groups([line({ lineId: 1 }), line({ lineId: 2, p0: "P00002" }), line({ lineId: 3 })]);
    expect(groups.map((g) => [g.p0, g.lines.length])).toEqual([
      ["P00001", 2],
      ["P00002", 1],
    ]);
  });

  it("shows the mark that matters most", () => {
    expect(lineBadge(line({ marks: ["typed"] })).label).toBe("Typed price");
    expect(lineBadge(line({ marks: ["no tag", "zero price"] })).label).toBe("Zero price");
    expect(lineBadge(line({ marks: ["draft/cancelled"] })).label).toBe("Not counted");
    expect(lineBadge(line({ marks: [] }))).toBeNull();
  });

  it("counts what needs a look", () => {
    const view = {
      lines: [line({ marks: ["zero price"] }), line({ lineId: 2, p0: "P00002", marks: ["no tag"] }), line({ lineId: 3, p0: "P00002", marks: ["no tag"] })],
      handP0s: [{ id: "h1", p0_number: "P09999", missing: true }],
      orphans: { linePrices: [{ id: "x" }], leftOut: [] },
    };
    expect(opexIssues(view)).toMatchObject({ total: 4, noTag: ["P00002"], orphans: 1 });
    expect(opexIssues(null).total).toBe(0);
  });
});

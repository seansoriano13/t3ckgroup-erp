import { describe, expect, it } from "vitest";
import { DASHBOARD_GROUP, dashboardView, linkFor, rowLabel, sorSummary } from "./purchasingDashboard";

const NOW = new Date("2026-10-21T00:00:00Z");
const daysAgo = (days) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const row = (over = {}) => ({
  opportunity_id: "sor-1",
  sales_reference: "S07983",
  project_title: "Ambulance",
  grp: DASHBOARD_GROUP.NOT_CHECKED,
  target_kind: "purchase_request",
  target_id: "pr-1",
  target_label: null,
  item_count: 1,
  no_canvass_count: 0,
  buyer_id: null,
  canvasser_id: null,
  since: daysAgo(1),
  request_id: "pr-1",
  ...over,
});

const ROWS = [
  row({ item_count: 3 }),
  row({ target_kind: "canvass", target_id: "cv-1", item_count: 1, canvasser_id: "emp-c" }),
  row({ grp: DASHBOARD_GROUP.PURCHASED, item_count: 2, no_canvass_count: 1, buyer_id: "emp-b", since: daysAgo(30) }),
  row({ grp: DASHBOARD_GROUP.STILL_CANVASSING, target_kind: "costing_matrix", target_id: "sor-1", request_id: null }),
  row({ opportunity_id: "sor-2", sales_reference: "S08000", project_title: "Radios", target_id: "pr-2", request_id: "pr-2" }),
];

const groupOf = (view, grp) => view.groups.find((group) => group.key === grp);

describe("dashboardView", () => {
  it("shows exactly four groups, in order, with item and SOR counts across every SOR", () => {
    const view = dashboardView(ROWS, {}, NOW);
    expect(view.groups.map((group) => group.key)).toEqual([
      DASHBOARD_GROUP.NOT_CHECKED,
      DASHBOARD_GROUP.TO_PURCHASE,
      DASHBOARD_GROUP.STILL_CANVASSING,
      DASHBOARD_GROUP.PURCHASED,
    ]);
    expect(groupOf(view, DASHBOARD_GROUP.NOT_CHECKED)).toMatchObject({ itemCount: 5, sorCount: 2 });
    expect(groupOf(view, DASHBOARD_GROUP.TO_PURCHASE)).toMatchObject({ itemCount: 0, sorCount: 0 });
  });

  it("puts one SOR in every group that applies, with that group's item count", () => {
    const view = dashboardView(ROWS, {}, NOW);
    const sor1 = (grp) => groupOf(view, grp).sors.find((sor) => sor.id === "sor-1");
    expect(sor1(DASHBOARD_GROUP.NOT_CHECKED).itemCount).toBe(4);
    expect(sor1(DASHBOARD_GROUP.PURCHASED).itemCount).toBe(2);
    expect(sor1(DASHBOARD_GROUP.STILL_CANVASSING).itemCount).toBe(1);
  });

  it("filters by SOR, matching the S number or the project title in any case", () => {
    const view = dashboardView(ROWS, { sor: "s08" }, NOW);
    expect(groupOf(view, DASHBOARD_GROUP.NOT_CHECKED).sors.map((sor) => sor.id)).toEqual(["sor-2"]);
    expect(dashboardView(ROWS, { sor: "radio" }, NOW).groups[0].sorCount).toBe(1);
  });

  it("filters by Buyer, by Canvasser and by ageing", () => {
    expect(dashboardView(ROWS, { buyerId: "emp-b" }, NOW).groups.map((group) => group.itemCount)).toEqual([0, 0, 0, 2]);
    expect(dashboardView(ROWS, { canvasserId: "emp-c" }, NOW).groups[0].itemCount).toBe(1);
    expect(dashboardView(ROWS, { minAgeDays: 14 }, NOW).groups.map((group) => group.itemCount)).toEqual([0, 0, 0, 2]);
  });

  it("filters to items ordered with no canvass, counting only those", () => {
    const view = dashboardView(ROWS, { noCanvass: true }, NOW);
    expect(view.groups.map((group) => group.itemCount)).toEqual([0, 0, 0, 1]);
  });
});

describe("sorSummary", () => {
  it("reads every group an SOR is in, never one primary group", () => {
    expect(sorSummary(ROWS, "sor-1")).toBe("4 not checked, 1 still canvassing, 2 purchased (not received)");
  });
});

describe("linkFor", () => {
  it("opens the record that owns the work", () => {
    expect(linkFor(row())).toEqual({ to: "/purchasing?request=pr-1" });
    expect(linkFor(row({ target_kind: "canvass", target_id: "cv-1" }))).toEqual({ to: "/purchasing?request=pr-1" });
    expect(linkFor(row({ target_kind: "canvass", request_id: null }))).toEqual({ to: "/sors", state: { openOpportunityId: "sor-1" } });
    expect(linkFor(row({ target_kind: "costing_matrix", request_id: null }))).toEqual({ to: "/sors", state: { openOpportunityId: "sor-1" } });
    expect(linkFor(row({ target_kind: "transmittal", target_id: "tr-1" }))).toEqual({ to: "/purchasing/transmittals/tr-1" });
    expect(linkFor(row({ target_kind: "ipas", target_id: "ip-1" }))).toEqual({ to: "/purchasing/ipas/ip-1" });
    expect(rowLabel(row({ target_kind: "ipas", target_label: "TGIPAS_9" }))).toBe("IPAS TGIPAS_9");
  });
});

describe("Direct requests and the ageing rules", () => {
  const direct = row({ opportunity_id: null, sales_reference: null, project_title: "Direct request", target_id: "pr-9", request_id: "pr-9", item_count: 2 });

  it("lists a Direct request on its own, keyed by the request", () => {
    const view = dashboardView([...ROWS, direct], {}, NOW);
    const entry = groupOf(view, DASHBOARD_GROUP.NOT_CHECKED).sors.find((sor) => sor.direct);
    expect(entry).toMatchObject({ id: "request:pr-9", itemCount: 2 });
    expect(sorSummary([direct], "request:pr-9")).toBe("2 not checked");
  });

  it("keeps only IPAS that Order Monitoring marks late", () => {
    const rows = [
      row({ grp: DASHBOARD_GROUP.PURCHASED, target_kind: "ipas", target_id: "ip-late", item_count: 3 }),
      row({ grp: DASHBOARD_GROUP.PURCHASED, target_kind: "ipas", target_id: "ip-fine", item_count: 5 }),
      row({ item_count: 7 }),
    ];
    const view = dashboardView(rows, { lateIpasIds: new Set(["ip-late"]) }, NOW);
    expect(view.groups.map((group) => group.itemCount)).toEqual([0, 0, 0, 3]);
  });
});

import { describe, it, expect } from "vitest";
import { flowBoardColumns, legacyBoardColumns } from "./board";

describe("flowBoardColumns", () => {
  const stages = [
    { id: "lead", name: "Lead", pos_x: 0, pos_y: 0, bracket_label: null },
    { id: "qualified", name: "Qualified", pos_x: 1, pos_y: 0, bracket_label: "Pre-Award" },
    { id: "negotiation", name: "Negotiation", pos_x: 2, pos_y: 0, bracket_label: "Pre-Award" },
    { id: "won", name: "Won", pos_x: 3, pos_y: 0, bracket_label: null },
  ];

  const flowDeal = (overrides) => ({
    sale_type_id: "st-1",
    flow_snapshot_id: "snap-1",
    expected_value: 100,
    contract_date: null,
    ...overrides,
  });

  it("only groups deals sitting on this flow's own Stages", () => {
    const opportunities = [
      flowDeal({ id: "a", flow_stage_id: "lead" }),
      flowDeal({ id: "b", flow_stage_id: "qualified" }),
      // A deal on some other flow's Stage id never matches any column here.
      flowDeal({ id: "c", flow_stage_id: "other-flow-stage" }),
    ];

    const columns = flowBoardColumns({ stages, opportunities });

    expect(columns.map((c) => c.key)).toEqual(["lead", "qualified", "negotiation", "won"]);
    expect(columns.find((c) => c.key === "lead").items.map((o) => o.id)).toEqual(["a"]);
    expect(columns.find((c) => c.key === "qualified").items.map((o) => o.id)).toEqual(["b"]);
    expect(columns.find((c) => c.key === "negotiation").items).toEqual([]);
  });

  it("orders columns in bracket/canvas order, and carries the bracket label", () => {
    const columns = flowBoardColumns({ stages, opportunities: [] });

    expect(columns.map((c) => ({ key: c.key, bracketLabel: c.bracketLabel }))).toEqual([
      { key: "lead", bracketLabel: null },
      { key: "qualified", bracketLabel: "Pre-Award" },
      { key: "negotiation", bracketLabel: "Pre-Award" },
      { key: "won", bracketLabel: null },
    ]);
  });

  it("computes per-column count, Open pipeline and Won totals from literal amounts", () => {
    const snapshot = {
      id: "snap-1",
      snapshot_data: {
        wonStageId: "won",
        stages: [
          { id: "lead", is_terminal: false },
          { id: "won", is_terminal: false },
        ],
        edges: [{ from_stage_id: "lead", to_stage_id: "won" }],
      },
    };
    const opportunities = [
      flowDeal({ id: "a", flow_stage_id: "lead", expected_value: 1000 }),
      flowDeal({ id: "b", flow_stage_id: "won", expected_value: 2500 }),
    ];

    const columns = flowBoardColumns({
      stages,
      opportunities,
      snapshotsById: { "snap-1": snapshot },
    });
    const lead = columns.find((c) => c.key === "lead");
    const wonCol = columns.find((c) => c.key === "won");

    expect(lead.count).toBe(1);
    expect(lead.openValue).toBe(1000);
    expect(lead.wonValue).toBe(0);

    expect(wonCol.count).toBe(1);
    expect(wonCol.openValue).toBe(0);
    expect(wonCol.wonValue).toBe(2500);
  });

  it("returns an empty list for an empty flow", () => {
    expect(flowBoardColumns({ stages: [], opportunities: [] })).toEqual([]);
  });
});

describe("legacyBoardColumns", () => {
  const stages = [
    { code: "LEAD", label: "Lead", sort_order: 10, is_default: true },
    { code: "QUALIFIED", label: "Qualified", sort_order: 20 },
    { code: "CLOSED_WON", label: "Closed Won", sort_order: 30, is_won: true },
  ];

  it("groups by status, in the given pipeline order", () => {
    const opportunities = [
      { id: "a", status: "LEAD", expected_value: 500, contract_date: null },
      { id: "b", status: "QUALIFIED", expected_value: 700, contract_date: null },
    ];

    const columns = legacyBoardColumns({ stages, opportunities });

    expect(columns.map((c) => c.key)).toEqual(["LEAD", "QUALIFIED", "CLOSED_WON"]);
    expect(columns[0].items.map((o) => o.id)).toEqual(["a"]);
    expect(columns[0].bracketLabel).toBeNull();
  });

  it("computes per-column count, Open pipeline and Won totals", () => {
    const opportunities = [
      { id: "a", status: "LEAD", expected_value: 500, contract_date: null },
      { id: "b", status: "CLOSED_WON", expected_value: 300, contract_date: "2026-01-01" },
    ];

    const columns = legacyBoardColumns({ stages, opportunities });
    const lead = columns.find((c) => c.key === "LEAD");
    const closedWon = columns.find((c) => c.key === "CLOSED_WON");

    expect(lead.count).toBe(1);
    expect(lead.openValue).toBe(500);
    expect(lead.wonValue).toBe(0);

    expect(closedWon.count).toBe(1);
    expect(closedWon.openValue).toBe(0);
    expect(closedWon.wonValue).toBe(300);
  });
});

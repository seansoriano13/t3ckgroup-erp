import { describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { renderHookWithQuery } from "../../../../test/support";
import { technicalInchargeAttention, useDigest } from "./useDigest";

const matrixGet = vi.hoisted(() => vi.fn());

vi.mock("../../../../services/costingMatrixService", () => ({
  costingMatrixService: { get: matrixGet, tier: vi.fn(), canManageMarkup: vi.fn() },
}));
vi.mock("../../../../services/opportunityService", () => ({
  opportunityService: {
    getCurrentStageVisit: async () => null,
    getFollowUpStatus: async () => null,
  },
}));

const matrix = (overrides = {}, bands = ["sales"]) => ({
  matrix: { id: "m1", technical_incharge_id: null, ...overrides },
  bands,
});

describe("technicalInchargeAttention (#910)", () => {
  it("asks a Sales caller to name a Technical in-charge when the S0 Evaluation has none", () => {
    expect(technicalInchargeAttention(matrix())).toEqual({
      key: "technical",
      tone: "amber",
      text: "Name a Technical in-charge for the S0 Evaluation.",
      go: "pms",
    });
  });

  it("asks a Purchasing caller too", () => {
    expect(technicalInchargeAttention(matrix({}, ["purchasing"]))?.key).toBe("technical");
  });

  it("stays quiet once an in-charge is named", () => {
    expect(technicalInchargeAttention(matrix({ technical_incharge_id: "e1" }))).toBeNull();
  });

  it("stays quiet for a caller who cannot name one", () => {
    expect(technicalInchargeAttention(matrix({}, ["technical"]))).toBeNull();
    expect(technicalInchargeAttention(matrix({}, []))).toBeNull();
  });

  it("stays quiet when there is no matrix or no tier", () => {
    expect(technicalInchargeAttention(null)).toBeNull();
    expect(technicalInchargeAttention({ matrix: null, bands: ["sales"] })).toBeNull();
  });
});

describe("useDigest attention list (#910)", () => {
  const sorProps = (overrides = {}) => ({
    id: "opp-1",
    opportunity: { id: "opp-1", status: "LEAD", flow_stage_id: "stage-1", sales_reference: "SR-1", project_type: "NORMAL" },
    ctx: { items: [{ id: "i1" }], itemsLoading: false, pendingStage: null, stageLabel: (s) => s },
    checklist: [],
    missingRequiredStageFields: [],
    notes: [],
    isRestricted: false,
    isFlowDeal: false,
    stageMutation: { isPending: false },
    pipelineStages: [{ code: "LEAD", label: "Lead" }],
    ...overrides,
  });
  const textsOf = (result) => result.current.attention.map((a) => a.text);

  it("lists the in-charge item for a Sales caller when no in-charge is named", async () => {
    matrixGet.mockResolvedValue(matrix());
    const { result } = renderHookWithQuery(() => useDigest(sorProps()));
    await waitFor(() => expect(textsOf(result)).toContain("Name a Technical in-charge for the S0 Evaluation."));
  });

  it("leaves the item off once the in-charge is named", async () => {
    matrixGet.mockResolvedValue(matrix({ technical_incharge_id: "e1" }));
    const { result } = renderHookWithQuery(() => useDigest(sorProps()));
    await waitFor(() => expect(matrixGet).toHaveBeenCalled());
    expect(textsOf(result).some((t) => t.startsWith("Name a Technical"))).toBe(false);
  });
});

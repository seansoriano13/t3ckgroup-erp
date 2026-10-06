import { describe, it, expect } from "vitest";
import {
  BUYER_COSTING_INCHARGE,
  purchaseRequestPayload,
  purchaseRequestSummary,
} from "./purchaseRequestAction";

describe("purchaseRequestPayload", () => {
  it("sends no Buyer, no extras and the default window for an empty config", () => {
    expect(purchaseRequestPayload({}, { extraMemberIds: [] })).toEqual({
      buyer_id: null,
      extra_member_ids: [],
      left_out_roles: [],
      access_until: "stage_left",
      access_until_stage_id: null,
    });
  });

  it("names a configured Buyer, the left-out roles and the window", () => {
    const payload = purchaseRequestPayload(
      {
        buyer: { type: "employee", id: "e1" },
        leaveOutRoles: ["support_sales"],
        access: { until: "later_stage_left", stageId: "s9" },
      },
      { extraMemberIds: ["e2", "e3"] },
    );
    expect(payload).toMatchObject({
      buyer_id: "e1",
      left_out_roles: ["support_sales"],
      extra_member_ids: ["e2", "e3"],
      access_until: "later_stage_left",
      access_until_stage_id: "s9",
    });
  });

  it("uses the Costing Matrix's Purchasing Incharge when it resolves", () => {
    const config = { buyer: { type: BUYER_COSTING_INCHARGE } };
    expect(purchaseRequestPayload(config, { costingInchargeId: "e7" }).buyer_id).toBe("e7");
  });

  it("leaves the request unassigned when there is no matrix or Incharge", () => {
    const config = { buyer: { type: BUYER_COSTING_INCHARGE } };
    expect(purchaseRequestPayload(config, {}).buyer_id).toBeNull();
  });

  it("drops the window's Stage unless the rule needs one", () => {
    const payload = purchaseRequestPayload({ access: { until: "stage_left", stageId: "s9" } }, {});
    expect(payload.access_until_stage_id).toBeNull();
  });
});

describe("purchaseRequestSummary", () => {
  it("reads as one line", () => {
    expect(purchaseRequestSummary({})).toBe("No default Buyer");
    expect(purchaseRequestSummary({ buyer: { type: BUYER_COSTING_INCHARGE } })).toBe(
      "Buyer: the Costing Matrix's Purchasing Incharge",
    );
  });
});

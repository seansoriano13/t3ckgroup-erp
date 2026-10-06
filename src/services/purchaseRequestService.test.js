import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...args) => rpc(...args) } }));

import { purchaseRequestService } from "./purchaseRequestService";

describe("purchaseRequestService", () => {
  beforeEach(() => rpc.mockReset());

  it("adds a member through the RPC", async () => {
    rpc.mockResolvedValue({ error: null });
    await purchaseRequestService.addMember("r1", "e1");
    expect(rpc).toHaveBeenCalledWith("purchase_request_add_member", { p_request_id: "r1", p_employee_id: "e1" });
  });

  it("removes a member through the RPC", async () => {
    rpc.mockResolvedValue({ error: null });
    await purchaseRequestService.removeMember("r1", "e1");
    expect(rpc).toHaveBeenCalledWith("purchase_request_remove_member", { p_request_id: "r1", p_employee_id: "e1" });
  });

  it("throws what the database refused with", async () => {
    rpc.mockResolvedValue({ error: new Error("not allowed") });
    await expect(purchaseRequestService.addMember("r1", "e1")).rejects.toThrow("not allowed");
  });
});

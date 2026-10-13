import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithQuery } from "../test/support";
import { useNavBadges } from "./useNavBadges";
import { taskService } from "../services/taskService";
import { ipasService } from "../services/ipasService";

vi.mock("../services/taskService", () => ({
  taskService: {
    getAllTasks: vi.fn(),
  },
}));

vi.mock("../services/headApprovalService", () => ({
  headApprovalService: {
    getPendingForHead: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../services/ipasService", () => ({
  ipasService: {
    pendingSignoffsFor: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

describe("useNavBadges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 for all badges when user is standard employee", () => {
    const user = {
      id: "u1",
      isSuperAdmin: false,
      isHead: false,
      isHr: false,
    };

    const { result } = renderHookWithQuery(() => useNavBadges(user));

    // My SORs is not role-gated — anyone can be called into a deal (ADR 0021)
    // — so it is present for a standard employee and zero until one is.
    expect(result.current).toEqual({
      taskApprovals: 0,
      hrVerifications: 0,
      leaveApprovals: 0,
      ipasSignoffs: 0,
      mySors: 0,
    });
  });

  it("counts the IPAS sections waiting on an approver, and doesn't ask anyone else", async () => {
    ipasService.pendingSignoffsFor.mockResolvedValue([{ id: "i1:1" }, { id: "i2:3" }]);

    const approver = renderHookWithQuery(() => useNavBadges({ id: "boss", isIpasApprover: true }));
    await vi.waitFor(() => {
      expect(approver.result.current.ipasSignoffs).toBe(2);
    });
    expect(ipasService.pendingSignoffsFor).toHaveBeenCalledWith("boss");

    ipasService.pendingSignoffsFor.mockClear();
    const other = renderHookWithQuery(() => useNavBadges({ id: "plain", isSuperAdmin: true }));
    await vi.waitFor(() => {
      expect(other.result.current.ipasSignoffs).toBe(0);
    });
    expect(ipasService.pendingSignoffsFor).not.toHaveBeenCalled();
  });

  it("computes taskApprovals for department head based on pending tasks", async () => {
    const user = {
      id: "head-1",
      isHead: true,
      subDepartment: "Engineering",
    };

    taskService.getAllTasks.mockResolvedValue([
      { id: "t1", status: "PENDING", sub_department: "Engineering" },
      { id: "t2", status: "PENDING", sub_department: "Marketing" },
      { id: "t3", status: "GRADED", sub_department: "Engineering" },
    ]);

    const { result } = renderHookWithQuery(() => useNavBadges(user));

    await vi.waitFor(() => {
      expect(result.current.taskApprovals).toBe(1);
    });
  });
});

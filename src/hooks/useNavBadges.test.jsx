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
    list: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("./useMeetingRealtime", () => ({
  useMeetingRealtime: vi.fn(),
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
      leaveApprovals: 0,
      meetingApprovals: 0,
      ipasSignoffs: 0,
      ipasForPayment: 0,
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

  it("counts the IPAS that are For payment, for someone who can read IPAS, and doesn't ask anyone else", async () => {
    ipasService.list.mockResolvedValue([
      { id: "a", payment_ask: { amount: 10 } },
      { id: "b", payment_ask: null },
      { id: "c", payment_ask: { amount: 5 } },
    ]);
    const gm = renderHookWithQuery(() => useNavBadges({ id: "gm", isIpasApprover: true }));
    await vi.waitFor(() => expect(gm.result.current.ipasForPayment).toBe(2));

    ipasService.list.mockClear();
    const other = renderHookWithQuery(() => useNavBadges({ id: "plain" }));
    expect(other.result.current.ipasForPayment).toBe(0);
    expect(ipasService.list).not.toHaveBeenCalled();
  });

  it("counts Task Approvals like the page's My team view for a head", async () => {
    const user = { id: "head-1", isHead: true, subDepartment: "Engineering" };
    taskService.getAllTasks.mockResolvedValue([
      { id: "t1", status: "AWAITING APPROVAL", subDepartment: "Engineering", loggedById: "e1" },
      { id: "t2", status: "AWAITING APPROVAL", subDepartment: "Marketing", loggedById: "e2" },
      { id: "t3", status: "COMPLETED", subDepartment: "Engineering", loggedById: "e1", evaluatedById: "head-1" },
    ]);
    const { result } = renderHookWithQuery(() => useNavBadges(user));
    await vi.waitFor(() => expect(result.current.taskApprovals).toBe(1));
  });

  it("gives a Super Admin only My team, not every pending task in the company", async () => {
    const user = { id: "sa", isSuperAdmin: true };
    taskService.getAllTasks.mockResolvedValue([
      { id: "t1", status: "AWAITING APPROVAL", reportedTo: "sa", loggedById: "e1" },
      { id: "t2", status: "AWAITING APPROVAL", reportedTo: "other", loggedById: "e2" },
      { id: "t3", status: "INCOMPLETE", reportedTo: "other", loggedById: "e3" },
    ]);
    const { result } = renderHookWithQuery(() => useNavBadges(user));
    await vi.waitFor(() => expect(result.current.taskApprovals).toBe(1));
  });

  it("counts HR verification as the graded, unverified tasks the HR view lists", async () => {
    const user = { id: "hr", isHr: true };
    taskService.getAllTasks.mockResolvedValue([
      { id: "t1", status: "COMPLETED", hrVerified: false, evaluatedById: "h", loggedById: "e1" },
      { id: "t2", status: "COMPLETED", hrVerified: true, evaluatedById: "h", loggedById: "e1" },
      { id: "t3", status: "COMPLETED", hrVerified: false, evaluatedById: null, loggedById: "e1" },
      { id: "t4", status: "COMPLETED", hrVerified: false, evaluatedById: "h", loggedById: "hr" },
    ]);
    const { result } = renderHookWithQuery(() => useNavBadges(user));
    await vi.waitFor(() => expect(result.current.taskApprovals).toBe(1));
  });

  it("counts a task once when a Super Admin is both grader and verifier", async () => {
    const user = { id: "sa", isSuperAdmin: true, isHr: true };
    taskService.getAllTasks.mockResolvedValue([
      { id: "t1", status: "COMPLETED", hrVerified: false, evaluatedById: "h", loggedById: "e1" },
      { id: "t2", status: "AWAITING APPROVAL", reportedTo: "sa", loggedById: "e2" },
    ]);
    const { result } = renderHookWithQuery(() => useNavBadges(user));
    await vi.waitFor(() => expect(result.current.taskApprovals).toBe(2));
  });
});

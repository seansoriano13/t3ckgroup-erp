import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHookWithQuery } from "../test/support";
import { useNavBadges } from "./useNavBadges";
import { taskService } from "../services/taskService";
import { supabase } from "../lib/supabase";

vi.mock("../services/taskService", () => ({
  taskService: {
    getAllTasks: vi.fn(),
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

    expect(result.current).toEqual({
      taskApprovals: 0,
      hrVerifications: 0,
      leaveApprovals: 0,
    });
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

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { taskService } from "../../services/taskService.js";
import { selectHrPending, selectHrVerified } from "../../utils/approvalQueue.js";
import { dashboardTasksKey } from "../approvals/_components/useApprovalQueues";
import { HIDDEN_TASK_STATUS_FILTER, TASK_STATUS } from "../../constants/status";

const count = async (build) => (await build(supabase.from("tasks").select("*", { count: "exact", head: true }))).count || 0;

/** The two numbers on the profile page, by role. Super Admin has none. */
export function useProfileStats(user) {
  const isHrUser = !user?.isSuperAdmin && !!(user?.isHr || user?.is_hr);

  // HR's two numbers use the Approval Center's own queue and the same cached query, so they cannot drift.
  const hrQuery = useQuery({
    queryKey: dashboardTasksKey(user?.id),
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id && isHrUser,
    select: (tasks) => ({
      primary: selectHrPending(tasks || [], user?.id).length,
      primaryLabel: "Pending HR Verifications",
      secondary: selectHrVerified(tasks || [], user?.id).length,
      secondaryLabel: "Total Verified",
    }),
  });

  const otherQuery = useQuery({
    queryKey: ["profileStats", user?.id],
    queryFn: async () => {
      if (user?.isSuperAdmin) return null;
      if (user?.isHead || user?.is_head) {
        const dept = user?.department || "";
        return {
          primary: await count((q) => q.eq("department", dept).eq("status", TASK_STATUS.AWAITING_APPROVAL)),
          primaryLabel: "Awaiting Your Approval",
          secondary: await count((q) =>
            q.eq("department", dept).in("status", [TASK_STATUS.COMPLETE, TASK_STATUS.NOT_APPROVED]),
          ),
          secondaryLabel: "Your Evaluated Tasks",
        };
      }
      return {
        primary: await count((q) => q.eq("logged_by", user.id).not("status", "in", HIDDEN_TASK_STATUS_FILTER)),
        primaryLabel: "Total Tasks Logged",
        secondary: await count((q) => q.eq("logged_by", user.id).eq("status", TASK_STATUS.COMPLETE)),
        secondaryLabel: "Tasks completed",
      };
    },
    enabled: !!user?.id && !isHrUser,
  });

  const active = isHrUser ? hrQuery : otherQuery;
  return { stats: active.data, isStatsLoading: active.isLoading, isStatsError: active.isError };
}

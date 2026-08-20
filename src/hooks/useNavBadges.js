import { useQuery } from "@tanstack/react-query";
import { taskService } from "../services/taskService";
import { supabase } from "../lib/supabase";

/**
 * Custom hook that fetches live pending badge counts for navigation links.
 */
export function useNavBadges(user) {
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isHr = !!(user?.is_hr || user?.isHr);
  const userSubDept = user?.subDepartment || user?.sub_department;
  const isMasterHead = isHead && !userSubDept;

  const canSeeTaskApprovals = isSuperAdmin || isHead;
  const canSeeHr = isSuperAdmin || isHr;

  // 1. Pending Tasks Query for Head & HR
  const { data: allTasks = [] } = useQuery({
    queryKey: ["navPendingTasks", user?.id],
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id && (canSeeTaskApprovals || canSeeHr),
    staleTime: 30000,
  });

  // 2. Pending Leaves Query for HR
  const { data: pendingLeavesCount = 0 } = useQuery({
    queryKey: ["navPendingLeaves", user?.id],
    queryFn: async () => {
      const [otRes, offsetRes, silRes] = await Promise.all([
        supabase.from("overtime_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
        supabase.from("offset_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
        supabase.from("sil_requests").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
      ]);

      const otCount = otRes?.count || 0;
      const offsetCount = offsetRes?.count || 0;
      const silCount = silRes?.count || 0;
      return otCount + offsetCount + silCount;
    },
    enabled: !!user?.id && canSeeHr,
    staleTime: 30000,
  });

  // Compute Task Approvals count
  let taskApprovals = 0;
  if (canSeeTaskApprovals) {
    taskApprovals = allTasks.filter((t) => {
      const isPending = t.status === "PENDING";
      if (!isPending) return false;
      if (isSuperAdmin || isMasterHead) return true;
      const taskSubDept = t.sub_department || t.subDepartment || t.employee?.sub_department;
      return taskSubDept === userSubDept;
    }).length;
  }

  // Compute HR Verifications count
  let hrVerifications = 0;
  if (canSeeHr) {
    hrVerifications = allTasks.filter((t) => {
      const isPendingVerification =
        t.status === "VERIFICATION_PENDING" ||
        (t.status === "COMPLETED" && !t.hr_verified && !t.hrVerified);
      return isPendingVerification;
    }).length;
  }

  return {
    taskApprovals,
    hrVerifications,
    leaveApprovals: pendingLeavesCount,
  };
}

import { useQuery } from "@tanstack/react-query";
import { taskService } from "../services/taskService";
import { headApprovalService } from "../services/headApprovalService";


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

  // 2. Pending leave/overtime requests routed to this head, awaiting decision.
  const { data: pendingHeadApprovals = [] } = useQuery({
    queryKey: ["navHeadPendingApprovals", user?.id],
    queryFn: () => headApprovalService.getPendingForHead(user.id),
    enabled: !!user?.id && (isSuperAdmin || isHead),
    staleTime: 30000,
  });
  const leaveApprovals = isSuperAdmin || isHead ? pendingHeadApprovals.length : 0;

  return {
    taskApprovals,
    hrVerifications,
    leaveApprovals,
  };
}

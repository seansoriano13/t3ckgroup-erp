import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ClipboardCheck, ShieldCheck } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useAppSettings } from "@/hooks/useAppSettings";
import { taskService } from "../../../services/taskService.js";
import { headApprovalService } from "../../../services/headApprovalService";
import {
  selectHrPending,
  selectHrVerified,
  selectManagerDecided,
  selectManagerPending,
} from "../../../utils/approvalQueue.js";

/**
 * The three Approval Center queues. One page per queue, one design for all of
 * them; the tab strip at the top of each page is built from this list.
 */
export const APPROVAL_QUEUES = [
  {
    key: "tasks",
    path: "/approvals/tasks",
    label: "Task Approvals",
    icon: ClipboardCheck,
    can: (r) => r.isSuperAdmin || r.isHead,
  },
  {
    key: "hr",
    path: "/approvals/hr-verification",
    label: "HR Verifications",
    icon: ShieldCheck,
    can: (r) => r.isSuperAdmin || r.isHr,
  },
  {
    key: "leaves",
    path: "/approvals/leaves",
    label: "Leave & Overtime",
    icon: CalendarClock,
    can: (r) => r.isSuperAdmin || r.isHead,
  },
];

export function useApprovalRoles() {
  const { user } = useAuth();
  return {
    user,
    isSuperAdmin: user?.is_super_admin === true || user?.isSuperAdmin === true,
    isHead: user?.is_head === true || user?.isHead === true,
    // DB-driven only: super admins do not inherit HR.
    isHr: user?.is_hr === true || user?.isHr === true,
  };
}

/**
 * Every queue the signed-in reviewer can act on, from the same two queries the
 * rest of the app already caches (`dashboardTasks`, `headPendingApprovals`),
 * so each page and the tab counts agree.
 *
 * `reportedToMeOnly` is the manager queue's scope toggle (My team /
 * System-wide); it only changes the tasks queue.
 */
export function useApprovalQueues({ reportedToMeOnly = true } = {}) {
  const roles = useApprovalRoles();
  const { user, isSuperAdmin, isHead } = roles;
  const { settings: appSettings } = useAppSettings();

  const tasksQuery = useQuery({
    queryKey: ["dashboardTasks", user?.id, "all"],
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id,
  });

  const leavesQuery = useQuery({
    queryKey: ["headPendingApprovals", user?.id],
    queryFn: () => headApprovalService.getPendingForHead(user.id),
    enabled: !!user?.id && (isHead || isSuperAdmin),
  });

  const rawTasks = tasksQuery.data;
  const queues = useMemo(() => {
    const tasks = rawTasks || [];
    const ctx = {
      userId: user?.id,
      userDept: user?.department,
      userSubDept: user?.sub_department || user?.subDepartment,
      isHead,
      isSuperAdmin,
      appSettings,
      reportedToMeOnly,
    };
    return {
      managerPending: selectManagerPending(tasks, ctx),
      managerDecided: selectManagerDecided(tasks, ctx),
      hrPending: selectHrPending(tasks, user?.id),
      hrVerified: selectHrVerified(tasks, user?.id),
    };
  }, [rawTasks, user, isHead, isSuperAdmin, appSettings, reportedToMeOnly]);

  const leavesPending = leavesQuery.data;
  const counts = {
    tasks: queues.managerPending.length,
    hr: queues.hrPending.length,
    leaves: (leavesPending || []).length,
  };

  return {
    roles,
    appSettings,
    rawTasks: rawTasks || [],
    ...queues,
    leavesPending: leavesPending || [],
    counts,
    isLoadingTasks: tasksQuery.isLoading,
    isLoadingLeaves: leavesQuery.isLoading,
  };
}

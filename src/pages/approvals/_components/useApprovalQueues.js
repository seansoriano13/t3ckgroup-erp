import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, ClipboardCheck, Gavel, PackageCheck, ReceiptText, Scale, ShieldCheck } from "lucide-react";
import { useAuth } from "../../../context/AuthContext";
import { useAppSettings } from "@/hooks/useAppSettings";
import { taskService } from "../../../services/taskService.js";
import { headApprovalService } from "../../../services/headApprovalService";
import { transmittalService } from "../../../services/transmittalService";
import { meetingRequestService } from "../../../services/meetingRequestService";
import { TRANSMITTAL_STAFF_LIST } from "../../../constants/transmittals";
import {
  selectHrPending,
  selectHrVerified,
  selectManagerDecided,
  selectManagerPending,
} from "../../../utils/approvalQueue.js";

/**
 * The Approval Center queues. One page per queue, one design for all of them;
 * the tab strip at the top of each page is built from this list. IPAS sign-offs
 * (#247) belong to the people on a section 1 or 3 approval list, not to a role.
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
    label: "Time Off & Overtime",
    icon: CalendarClock,
    can: (r) => r.isSuperAdmin || r.isHead,
  },
  {
    // Meeting Requests (#624): a head approves the ones routed to them, HR gives the final say.
    key: "meetings",
    path: "/approvals/meetings",
    label: "Meeting Requests",
    icon: CalendarDays,
    can: (r) => r.isSuperAdmin || r.isHead || r.isHr,
  },
  {
    key: "ipas",
    path: "/approvals/ipas",
    label: "IPAS Sign-offs",
    icon: ReceiptText,
    can: (r) => r.isIpasApprover,
  },
  {
    key: "transmittals",
    path: "/approvals/transmittals",
    label: "Transmittal Check by",
    icon: PackageCheck,
    can: (r) => r.isTransmittalCheckBy,
  },
  {
    // Costing Matrix Bid Decisions (#320): Super Admins and the Final Acquire list.
    key: "bidDecisions",
    path: "/approvals/bid-decisions",
    label: "Bid Decisions",
    icon: Gavel,
    can: (r) => r.isBidDecider,
  },
  {
    // Canvass sign-offs (#279): the purchasing approver list, the one that approves Transmittals.
    key: "canvass",
    path: "/approvals/canvass-signoffs",
    label: "Canvass Sign-offs",
    icon: Scale,
    can: (r) => r.isCanvassApprover,
  },
];

export function useApprovalRoles() {
  const { user } = useAuth();
  // The Transmittal staff lists the signed-in person is on (own rows only).
  const listsQuery = useQuery({
    queryKey: ["transmittalStaffLists", user?.id],
    queryFn: () => transmittalService.myStaffLists(user.id),
    enabled: !!user?.id,
    staleTime: 5 * 60 * 1000,
  });
  return {
    user,
    isSuperAdmin: user?.is_super_admin === true || user?.isSuperAdmin === true,
    isHead: user?.is_head === true || user?.isHead === true,
    // DB-driven only: super admins do not inherit HR.
    isHr: user?.is_hr === true || user?.isHr === true,
    // On the section 1 or 3 approval list; a Super Admin only when on one.
    isIpasApprover: user?.is_ipas_approver === true || user?.isIpasApprover === true,
    // On the Transmittal Check by list (#254); only a list member sees the queue.
    isTransmittalCheckBy: (listsQuery.data ?? []).includes(TRANSMITTAL_STAFF_LIST.CHECK_BY),
    isTransmittalListsLoading: !!user?.id && listsQuery.isLoading,
    // The same list signs Canvasses (#279): the purchasing approver. A Super Admin only when on it.
    isCanvassApprover: (listsQuery.data ?? []).includes(TRANSMITTAL_STAFF_LIST.CHECK_BY),
    // A Super Admin, on the Final Acquire list (#320), or open on a Costing Matrix: decides Bid Decisions.
    isBidDecider:
      user?.is_super_admin === true || user?.isSuperAdmin === true || user?.is_final_acquire === true || user?.isFinalAcquire === true ||
      user?.is_costing_open === true || user?.isCostingOpen === true,
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
    queryFn: () => headApprovalService.getPendingForHead(user.id, { all: isSuperAdmin }),
    enabled: !!user?.id && (isHead || isSuperAdmin),
  });

  const isHr = roles.isHr;
  const meetingsQuery = useQuery({
    queryKey: ["meeting-requests", "approval-queue", user?.id, isHr, isSuperAdmin],
    queryFn: () => meetingRequestService.listPendingForApprover({ employeeId: user.id, isHr, isSuperAdmin }),
    enabled: !!user?.id && (isHead || isSuperAdmin || isHr),
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
    meetings: (meetingsQuery.data || []).length,
  };

  return {
    roles,
    appSettings,
    rawTasks: rawTasks || [],
    ...queues,
    leavesPending: leavesPending || [],
    meetingsPending: meetingsQuery.data || [],
    counts,
    isLoadingTasks: tasksQuery.isLoading,
    isLoadingLeaves: leavesQuery.isLoading,
    isLoadingMeetings: meetingsQuery.isLoading,
    isErrorTasks: tasksQuery.isError,
    isErrorLeaves: leavesQuery.isError,
    isErrorMeetings: meetingsQuery.isError,
    refetchTasks: tasksQuery.refetch,
    refetchLeaves: leavesQuery.refetch,
    refetchMeetings: meetingsQuery.refetch,
  };
}

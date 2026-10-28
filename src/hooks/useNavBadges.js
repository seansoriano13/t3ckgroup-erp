import { useQuery } from "@tanstack/react-query";
import { taskService } from "../services/taskService";
import { headApprovalService } from "../services/headApprovalService";
import { opportunityService } from "../services/opportunityService";
import { meetingRequestService } from "../services/meetingRequestService";
import { ipasService } from "../services/ipasService";
import { ipasPendingKey } from "../components/ipas/ipasKeys";


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
    queryFn: () => headApprovalService.getPendingForHead(user.id, { all: isSuperAdmin || isHr }),
    enabled: !!user?.id && (isSuperAdmin || isHead || isHr),
    staleTime: 30000,
  });
  const leaveApprovals = isSuperAdmin || isHead || isHr ? pendingHeadApprovals.length : 0;

  // 2b. Meeting Requests waiting on HR (#748): only HR / Super Admin decide them.
  const canSeeMeetings = isSuperAdmin || isHr;
  const { data: pendingMeetings = [] } = useQuery({
    queryKey: ["meeting-requests", "nav-badge", user?.id, isHr, isSuperAdmin],
    queryFn: () => meetingRequestService.listPendingForApprover({ employeeId: user.id, isHr, isSuperAdmin }),
    enabled: !!user?.id && canSeeMeetings,
    staleTime: 30000,
  });
  const meetingApprovals = canSeeMeetings ? pendingMeetings.length : 0;

  // 3. My SORs — deals this person was called into and still has an open
  // window on. Every employee can hold one, so this is not gated on a role.
  const { data: mySors = 0 } = useQuery({
    queryKey: ["navMySors", user?.id],
    queryFn: () => opportunityService.countMyOpenSors(user.id),
    enabled: !!user?.id,
    staleTime: 30000,
  });

  // 4. IPAS sections 1 and 3 waiting on this person's signature (#247). Only
  // asked for someone on an approval list.
  const isIpasApprover = !!(user?.is_ipas_approver || user?.isIpasApprover);
  const { data: pendingIpas = [] } = useQuery({
    queryKey: ipasPendingKey(user?.id),
    queryFn: () => ipasService.pendingSignoffsFor(user.id),
    enabled: !!user?.id && isIpasApprover,
    staleTime: 30000,
  });
  const ipasSignoffs = isIpasApprover ? pendingIpas.length : 0;

  return {
    taskApprovals,
    hrVerifications,
    leaveApprovals,
    meetingApprovals,
    ipasSignoffs,
    mySors,
  };
}

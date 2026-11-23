import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { selectHrPending, selectManagerPending } from "../utils/approvalQueue.js";
import { dashboardTasksKey } from "../pages/approvals/_components/useApprovalQueues";
import { taskService } from "../services/taskService";
import { headApprovalService } from "../services/headApprovalService";
import { opportunityService } from "../services/opportunityService";
import { meetingRequestService } from "../services/meetingRequestService";
import { useMeetingRealtime } from "./useMeetingRealtime";
import { ipasService } from "../services/ipasService";
import { ipasPendingKey, ipasListKey } from "../components/ipas/ipasKeys";
import { ipasFigures } from "../utils/ipasFigures";
import { IPAS_VIEW, inIpasView } from "../utils/ipasListViews";
import { canReadIpas, getPermissionContext } from "../utils/permissions";


/**
 * Custom hook that fetches live pending badge counts for navigation links.
 */
export function useNavBadges(user) {
  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isHr = !!(user?.is_hr || user?.isHr);
  const userSubDept = user?.subDepartment || user?.sub_department;

  const canSeeTaskApprovals = isSuperAdmin || isHead;
  const canSeeHr = isSuperAdmin || isHr;

  // 1. Task Approvals: the page's own default view (My team), built from the same
  // cached task list and the same selectors, so the badge equals All Pending on open.
  const { data: allTasks = [] } = useQuery({
    queryKey: dashboardTasksKey(user?.id),
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id && (canSeeTaskApprovals || canSeeHr),
  });

  const taskApprovals = useMemo(() => {
    const ctx = {
      userId: user?.id,
      userDept: user?.department,
      userSubDept,
      isHead,
      isSuperAdmin,
      reportedToMeOnly: true,
    };
    const ids = new Set();
    if (canSeeTaskApprovals) for (const t of selectManagerPending(allTasks, ctx)) ids.add(t.id);
    if (canSeeHr) for (const t of selectHrPending(allTasks, user?.id)) ids.add(t.id);
    return ids.size;
  }, [allTasks, user?.id, user?.department, userSubDept, isHead, isSuperAdmin, canSeeTaskApprovals, canSeeHr]);

  // 2. Pending leave/overtime requests routed to this head, awaiting decision.
  const { data: pendingHeadApprovals = [] } = useQuery({
    queryKey: ["navHeadPendingApprovals", user?.id],
    queryFn: () => headApprovalService.getPendingForHead(user.id, { all: isSuperAdmin || isHr }),
    enabled: !!user?.id && (isSuperAdmin || isHead || isHr),
    staleTime: 30000,
  });
  const leaveApprovals = isSuperAdmin || isHead || isHr ? pendingHeadApprovals.length : 0;

  // 2b. Activities waiting on HR (#748): only HR / Super Admin decide them.
  const canSeeMeetings = isSuperAdmin || isHr;
  // Live like the Calendar (#1063): another approver's decision or a new filing moves the count at once.
  useMeetingRealtime({ enabled: !!user?.id && canSeeMeetings });
  const { data: pendingMeetings = 0 } = useQuery({
    queryKey: ["meeting-requests", "nav-badge", isHr, isSuperAdmin],
    queryFn: () => meetingRequestService.countPendingForApprover({ isHr, isSuperAdmin }),
    enabled: !!user?.id && canSeeMeetings,
    staleTime: 0,
  });
  const meetingApprovals = canSeeMeetings ? pendingMeetings : 0;

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

  // 5. IPAS For payment (#1190): the Payment Forecast view's rows, counted from the same cached
  // list and the same view rule, so the number equals the rows on open.
  const mayReadIpas = canReadIpas(getPermissionContext(user));
  const { data: ipasList = [] } = useQuery({
    queryKey: ipasListKey,
    queryFn: () => ipasService.list(),
    enabled: !!user?.id && mayReadIpas,
    staleTime: 30000,
  });
  const ipasForPayment = useMemo(
    () =>
      mayReadIpas
        ? ipasList.filter((row) => inIpasView({ ...row, figures: ipasFigures(row) }, IPAS_VIEW.PAYMENT_FORECAST, user?.id)).length
        : 0,
    [ipasList, mayReadIpas, user?.id],
  );

  return {
    taskApprovals,
    leaveApprovals,
    meetingApprovals,
    ipasSignoffs,
    ipasForPayment,
    mySors,
  };
}

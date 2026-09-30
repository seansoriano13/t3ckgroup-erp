import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../context/AuthContext.jsx";
import { taskService } from "../services/taskService.js";
import { TASK_STATUS } from "../constants/status.js";
import { useNavigate } from "react-router";
import ReportFigure from "./ui/ReportFigure.jsx";

export default function DashboardStats({ selectedRange }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const isHr = user?.is_hr || user?.isHr;
  const isHead = user?.is_head || user?.isHead;
  const isManagement = isHr || isHead;
  const userSubDept = user?.sub_department || user?.subDepartment;
  const userDept = user?.department;

  // Used cached data
  const { data: rawTasks = [], isLoading: isTasksLoading } = useQuery({
    queryKey: ["dashboardTasks", user?.id, isManagement ? "all" : "personal"],
    queryFn: () =>
      isManagement
        ? taskService.getAllTasks()
        : taskService.getMyTasks(user?.id),
    enabled: !!user?.id,
  });

  const isLoading = isTasksLoading;

  const stats = useMemo(() => {
    // 1. Filter tasks for ONLY this date range, EXCLUDING Super Admin
    const rangeStart = selectedRange?.startDate
      ? new Date(`${selectedRange.startDate}T00:00:00`)
      : new Date(0);
    const rangeEnd = selectedRange?.endDate
      ? new Date(`${selectedRange.endDate}T00:00:00`)
      : new Date();

    const thisMonthTasks = rawTasks.filter((t) => {
      const taskDate = new Date(t.createdAt);

      const roleStr = (t.creator?.role || "").toLowerCase();
      const deptStr = (t.creator?.department || "").toLowerCase();
      if (
        t.status === TASK_STATUS.DELETED ||
        t.creator?.isSuperAdmin ||
        roleStr.includes("admin") ||
        deptStr.includes("super admin") ||
        deptStr.includes("management")
      ) {
        return false;
      }

      return taskDate >= rangeStart && taskDate < rangeEnd;
    });

    // 2. Calculate Personal Stats
    const myTasks = thisMonthTasks.filter((t) => t.loggedById === user?.id);
    const myPending = myTasks.filter(
      (t) => t.status === TASK_STATUS.INCOMPLETE && !t.endAt,
    ).length;
    const myPendingApproval = myTasks.filter(
      (t) =>
        (t.status === TASK_STATUS.INCOMPLETE && !!t.endAt) ||
        t.status === TASK_STATUS.AWAITING_APPROVAL,
    ).length;
    const myPendingHr = myTasks.filter(
      (t) => t.status === TASK_STATUS.COMPLETE && !t.hrVerified,
    ).length;
    // For My Completed, it's tasks that are FULLY completed and verified
    const myCompleted = myTasks.filter(
      (t) => t.status === TASK_STATUS.COMPLETE && t.hrVerified,
    ).length;

    // 3. Calculate Management Stats (Only if Head or HR)
    let teamInProgress = 0;
    let teamCompleted = 0;
    let teamPendingHr = 0;
    let teamRejected = 0;
    let teamAwaitingApproval = 0;
    let teamAllTasks = 0;

    let hrInProgress = 0;
    let hrOverdueUnsubmitted = 0;
    let hrAwaitingHead = 0;
    let hrPendingVerification = 0;
    let hrRejected = 0;
    let hrAllTasks = 0;

    const now = new Date();

    if (isHr) {
      // INCOMPLETE + no end_at → actively being logged, nothing to act on
      hrInProgress = thisMonthTasks.filter(
        (t) => t.status === TASK_STATUS.INCOMPLETE && !t.endAt,
      ).length;
      // INCOMPLETE + end_at in the past → employee hasn't submitted yet
      hrOverdueUnsubmitted = thisMonthTasks.filter(
        (t) =>
          t.status === TASK_STATUS.INCOMPLETE &&
          t.endAt &&
          new Date(t.endAt) < now,
      ).length;
      // AWAITING APPROVAL → employee submitted, Head hasn't reviewed
      hrAwaitingHead = thisMonthTasks.filter(
        (t) => t.status === TASK_STATUS.AWAITING_APPROVAL,
      ).length;
      hrPendingVerification = thisMonthTasks.filter(
        (t) => t.status === TASK_STATUS.COMPLETE && !t.hrVerified,
      ).length;
      hrRejected = thisMonthTasks.filter(
        (t) => t.status === TASK_STATUS.NOT_APPROVED,
      ).length;
      hrAllTasks = thisMonthTasks.length;
    } else if (isHead) {
      let teamTasks = thisMonthTasks.filter((t) => t.loggedById !== user?.id);

      // Head only tracks their sub-department, or entire department if no sub-dept
      teamTasks = teamTasks.filter((t) => {
        const taskSubDept =
          t.sub_department ||
          t.creator?.sub_department ||
          t.employees?.sub_department;
        const taskDept = t.creator?.department || t.employees?.department;
        if (userSubDept) {
          return taskSubDept === userSubDept;
        } else {
          return taskDept === userDept;
        }
      });

      teamInProgress = teamTasks.filter(
        (t) => t.status === TASK_STATUS.INCOMPLETE,
      ).length;
      // Mirror approvals/tasks/index.jsx: reportedTo takes priority over dept matching
      teamAwaitingApproval = teamTasks.filter((t) => {
        if (t.status !== TASK_STATUS.AWAITING_APPROVAL) return false;
        if (t.reportedTo) return t.reportedTo === user?.id;
        // Legacy fallback: dept/sub-dept match (already filtered above via teamTasks)
        return true;
      }).length;
      teamCompleted = teamTasks.filter(
        (t) => t.status === TASK_STATUS.COMPLETE,
      ).length;
      teamRejected = teamTasks.filter(
        (t) => t.status === TASK_STATUS.NOT_APPROVED,
      ).length;
      teamPendingHr = teamTasks.filter(
        (t) => t.status === TASK_STATUS.COMPLETE && !t.hrVerified,
      ).length;
      teamAllTasks = teamTasks.length;
    }

    return {
      myPending,
      myPendingApproval,
      myPendingHr,
      myCompleted,
      teamInProgress,
      teamAwaitingApproval,
      teamCompleted,
      teamRejected,
      teamPendingHr,
      teamAllTasks,
      hrInProgress,
      hrOverdueUnsubmitted,
      hrAwaitingHead,
      hrPendingVerification,
      hrRejected,
      hrAllTasks,
    };
  }, [
    rawTasks,
    user?.id,
    isHead,
    isHr,
    userSubDept,
    userDept,
    selectedRange,
  ]);

  if (isLoading) {
    return (
      <div className="h-24 bg-muted rounded-xl border border-border animate-pulse"></div>
    );
  }

  const toTasks = (status) => () =>
    navigate("/tasks", { state: { presetFilter: { status } } });

  let items;
  if (isHr) {
    items = [
      { label: "Incomplete", value: stats.hrInProgress, sub: "Still being logged", onClick: toTasks(TASK_STATUS.INCOMPLETE) },
      { label: "Overdue", value: stats.hrOverdueUnsubmitted, sub: "Not submitted", tone: "attention", onClick: toTasks(TASK_STATUS.INCOMPLETE) },
      { label: "Awaiting approval", value: stats.hrAwaitingHead, sub: "Waiting on Heads", onClick: toTasks(TASK_STATUS.AWAITING_APPROVAL) },
      { label: "Completed", value: stats.hrPendingVerification, sub: "Pending HR", onClick: toTasks(TASK_STATUS.COMPLETE) },
      { label: "Returned", value: stats.hrRejected, sub: "Needs fixing", onClick: toTasks(TASK_STATUS.NOT_APPROVED) },
      { label: "All tasks", value: stats.hrAllTasks, sub: "Org output this month", onClick: () => navigate("/tasks") },
    ];
  } else if (isHead) {
    items = [
      { label: "Incomplete", value: stats.teamInProgress, sub: "Still being logged", onClick: toTasks(TASK_STATUS.INCOMPLETE) },
      { label: "Awaiting approval", value: stats.teamAwaitingApproval, sub: "Needs your review", tone: "attention", onClick: () => navigate("/approvals/tasks") },
      { label: "Returned", value: stats.teamRejected, sub: "Needs fixing", onClick: toTasks(TASK_STATUS.NOT_APPROVED) },
      { label: "Completed", value: stats.teamPendingHr, sub: "Pending HR", onClick: toTasks(TASK_STATUS.COMPLETE) },
      { label: "HR verified", value: stats.teamCompleted, sub: "HR approved", onClick: toTasks(TASK_STATUS.COMPLETE) },
      { label: "All tasks", value: stats.teamAllTasks, sub: "Dept output this month", onClick: () => navigate("/tasks") },
    ];
  } else {
    items = [
      { label: "Incomplete", value: stats.myPending, sub: "Still being logged" },
      { label: "Awaiting approval", value: stats.myPendingApproval, sub: "Waiting on review", onClick: toTasks(TASK_STATUS.AWAITING_APPROVAL) },
      { label: "Completed", value: stats.myPendingHr, sub: "Pending HR", onClick: toTasks(TASK_STATUS.COMPLETE) },
      { label: "HR verified", value: stats.myCompleted, sub: "HR approved", onClick: toTasks(TASK_STATUS.COMPLETE) },
    ];
  }

  return <ReportFigure stats={items} />;
}

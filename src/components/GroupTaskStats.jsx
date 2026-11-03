import { useMemo } from "react";
import { useNavigate } from "react-router";
import ReportFigure from "./ui/ReportFigure.jsx";
import { GROUP_TASK_STATUS } from "../constants/status.js";

/**
 * The Group tasks counts for the dashboard range, in the same ReportFigure row
 * the task counts use. It takes the tasks the section already loaded, so it adds
 * no request of its own.
 */
export default function GroupTaskStats({ groupTasks, selectedRange }) {
  const navigate = useNavigate();

  const stats = useMemo(() => {
    const rangeStart = selectedRange?.startDate
      ? new Date(`${selectedRange.startDate}T00:00:00`)
      : new Date(0);
    const rangeEnd = selectedRange?.endDate
      ? new Date(`${selectedRange.endDate}T00:00:00`)
      : new Date();

    const inRange = groupTasks.filter((t) => {
      const created = new Date(t.created_at);
      return created >= rangeStart && created < rangeEnd;
    });
    const count = (status) => inRange.filter((t) => t.status === status).length;

    return {
      active: count(GROUP_TASK_STATUS.ACTIVE),
      awaitingEvaluation: count(GROUP_TASK_STATUS.AWAITING_EVALUATION),
      hrPending: count(GROUP_TASK_STATUS.HR_PENDING),
      hrVerified: count(GROUP_TASK_STATUS.HR_VERIFIED),
      all: inRange.length,
    };
  }, [groupTasks, selectedRange]);

  const toGroupTasks = () => navigate("/group-tasks");

  return (
    <ReportFigure
      stats={[
        { label: "Active", value: stats.active, sub: "Members still working", onClick: toGroupTasks },
        { label: "Awaiting evaluation", value: stats.awaitingEvaluation, sub: "Needs the Evaluator", tone: "attention", onClick: toGroupTasks },
        { label: "Completed", value: stats.hrPending, sub: "Pending HR", onClick: toGroupTasks },
        { label: "HR verified", value: stats.hrVerified, sub: "HR approved", onClick: toGroupTasks },
        { label: "All group tasks", value: stats.all, sub: "Started in this range", onClick: toGroupTasks },
      ]}
    />
  );
}

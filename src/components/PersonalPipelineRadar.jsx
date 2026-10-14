import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { taskService } from "../services/taskService.js";
import { Activity, TrendingUp, Star } from "lucide-react";
import { TASK_STATUS } from "../constants/status";
import Avatar from "./Avatar";
import ReportFigure from "./ui/ReportFigure";
import EmptyState from "./ui/EmptyState";
import { Card } from "@/components/ui/card";
import { useNavigate } from "react-router";

export default function PersonalPipelineRadar({ selectedRange }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Fetch the user's tasks (reusing dashboard query)
  const { data: rawTasks = [], isLoading: loadingTasks } = useQuery({
    queryKey: ["dashboardTasks", user?.id, "personal"],
    queryFn: () => taskService.getMyTasks(user?.id),
    enabled: !!user?.id,
  });

  const isLoading = loadingTasks;

  const stats = useMemo(() => {
    if (!rawTasks.length) return null;

    const rangeStart = selectedRange?.startDate
      ? new Date(`${selectedRange.startDate}T00:00:00`)
      : new Date(0);
    const rangeEnd = selectedRange?.endDate
      ? new Date(`${selectedRange.endDate}T00:00:00`)
      : new Date();

    let total = 0, draft = 0, rejected = 0, pendingHead = 0, pendingHr = 0, verified = 0;
    let totalGrade = 0, gradedCount = 0;

    rawTasks.forEach((task) => {
      const taskDate = new Date(task.createdAt);
      if (taskDate < rangeStart || taskDate >= rangeEnd) return;
      if (task.status === TASK_STATUS.DELETED) return;

      let matched = false;
      if (task.status === TASK_STATUS.INCOMPLETE) {
        draft++; matched = true;
      } else if (task.status === TASK_STATUS.AWAITING_APPROVAL) {
        pendingHead++; matched = true;
      } else if (task.status === TASK_STATUS.NOT_APPROVED) {
        rejected++; matched = true;
      } else if (task.status === TASK_STATUS.COMPLETE) {
        if (task.hrVerified) verified++; else pendingHr++;
        matched = true;
      }

      if (matched) total++;
      if (task.status === TASK_STATUS.COMPLETE && task.grade > 0) {
        totalGrade += task.grade;
        gradedCount++;
      }
    });

    return {
      total, draft, rejected, pendingHead, pendingHr, verified,
      avgGrade: gradedCount > 0 ? (totalGrade / gradedCount).toFixed(1) : "N/A",
      completionRate: Math.round(((pendingHead + pendingHr + verified) / total) * 100) || 0,
    };
  }, [rawTasks, selectedRange]);

  if (isLoading) {
    return (
      <div className="h-48 bg-card border border-border rounded-3xl animate-pulse" />
    );
  }

  if (!stats || stats.total === 0) {
    return (
      <EmptyState icon={Activity} title="No tasks recorded for this period" />
    );
  }

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden relative">
      <div className="p-6 sm:p-8 relative z-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3">
              <Avatar
                name={user?.name}
                src={user?.picture ?? undefined}
                size="lg"
                className="ring-2 ring-primary/20 shadow-lg shrink-0"
              />
              <div>
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <Activity className="text-muted-foreground" size={18} /> My pipeline radar
                </h2>
                <p className="text-sm text-muted-foreground mt-1 font-medium italic">
                  Visual performance tracking for{" "}
                  {selectedRange?.label || "this period"}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-right">
              <p className="text-label font-black text-muted-foreground uppercase tracking-widest mb-1">
                Avg Grade
              </p>
              <div className="flex items-center justify-end gap-1.5 text-blue-9">
                <Star size={16} className="fill-current" />
                <span className="text-lg font-black">{stats.avgGrade}</span>
              </div>
            </div>
            
            <div className="w-px h-8 bg-border"></div>

            <div>
              <p className="text-label font-black text-muted-foreground uppercase tracking-widest mb-1">
                Execution
              </p>
              <div className="flex items-center gap-1.5 text-green-9">
                <TrendingUp size={16} />
                <span className="text-lg font-black">
                  {stats.completionRate}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 mb-6">
          <div className="flex justify-between items-end">
            <span className="text-sm font-semibold text-foreground">
              Task distribution
            </span>
            <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
              {stats.total} Total Tasks
            </span>
          </div>

          <div className="h-6 w-full bg-muted/50 rounded-full overflow-hidden flex shadow-inner border border-border">
              <>
                {stats.draft > 0 && <div style={{ width: `${(stats.draft / stats.total) * 100}%` }} className="bg-orange-a7 flex items-center justify-center text-[10px] font-bold text-foreground" title="Incomplete">{stats.draft}</div>}
                {stats.rejected > 0 && <div style={{ width: `${(stats.rejected / stats.total) * 100}%` }} className="bg-red-a7 flex items-center justify-center text-[10px] font-bold text-foreground" title="Returned">{stats.rejected}</div>}
                {stats.pendingHead > 0 && <div style={{ width: `${(stats.pendingHead / stats.total) * 100}%` }} className="bg-violet-a7 flex items-center justify-center text-[10px] font-bold text-foreground" title="Awaiting Approval">{stats.pendingHead}</div>}
                {stats.pendingHr > 0 && <div style={{ width: `${(stats.pendingHr / stats.total) * 100}%` }} className="bg-blue-a7 flex items-center justify-center text-[10px] font-bold text-foreground" title="Completed">{stats.pendingHr}</div>}
                {stats.verified > 0 && <div style={{ width: `${(stats.verified / stats.total) * 100}%` }} className="bg-green-a7 flex items-center justify-center text-[10px] font-bold text-foreground" title="HR Verified">{stats.verified}</div>}
              </>
          </div>
        </div>

        <div className="mt-8 border-t border-border pt-8">
          <ReportFigure
            stats={[
              { label: "Incomplete", value: stats.draft, sub: "In progress", onClick: () => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.INCOMPLETE } } }) },
              { label: "Returned", value: stats.rejected, sub: "Needs fixing", onClick: () => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.NOT_APPROVED } } }) },
              { label: "Awaiting approval", value: stats.pendingHead, sub: "Needs approval", onClick: () => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.AWAITING_APPROVAL } } }) },
              { label: "Completed", value: stats.pendingHr, sub: "Pending HR", onClick: () => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.COMPLETE } } }) },
              { label: "HR verified", value: stats.verified, sub: "HR approved", onClick: () => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.COMPLETE } } }) },
            ]}
          />
        </div>
      </div>
    </div>
  );
}

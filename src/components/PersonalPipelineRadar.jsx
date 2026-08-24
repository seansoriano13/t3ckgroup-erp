import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useAuth } from "../context/AuthContext";
import { taskService } from "../services/taskService.js";
import {
  Activity,
  TrendingUp,
  Star,
  Clock,
  CheckCircle2,
  ShieldAlert,
  XCircle,
  Briefcase,
  AlertCircle
} from "lucide-react";
import { TASK_STATUS } from "../constants/status";
import Avatar from "./Avatar";
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
      <div className="bg-card border border-border rounded-3xl p-8 text-center">
        <Activity className="mx-auto text-mauve-5 mb-3" size={32} />
        <p className="text-muted-foreground font-bold uppercase tracking-widest text-xs">
          No tasks recorded for this period
        </p>
      </div>
    );
  }

  return (
    <div className="bg-card border border-mauve-6 rounded-3xl shadow-xl overflow-hidden relative">
      {/* Visual background glow */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 blur-3xl -mr-32 -mt-32 rounded-full pointer-events-none" />

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
                <h2 className="text-xl font-black text-foreground uppercase tracking-tight flex items-center gap-2">
                  <Activity className="text-primary" size={20} /> My Pipeline
                  Radar
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
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">
                Avg Grade
              </p>
              <div className="flex items-center justify-end gap-1.5 text-blue-9">
                <Star size={16} className="fill-current" />
                <span className="text-lg font-black">{stats.avgGrade}</span>
              </div>
            </div>
            
            <div className="w-px h-8 bg-border"></div>

            <div>
              <p className="text-[10px] font-black text-muted-foreground uppercase tracking-widest mb-1">
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
            <span className="text-xs font-black text-mauve-10 uppercase tracking-widest">
              Task Distribution
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

        {/* Internal Grid of StatCards replacing external ones */}
        <div className="grid gap-4 md:gap-6 grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 mt-8 border-t border-border pt-8">
            <>
              <InnerStatCard title="Incomplete" value={stats.draft} subtitle="In Progress" icon={<Clock size={20} className="text-orange-500" />} color="orange" onClick={() => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.INCOMPLETE } } })} />
              <InnerStatCard title="Returned" value={stats.rejected} subtitle="Needs Fixing" icon={<XCircle size={20} className="text-red-500" />} color="destructive" onClick={() => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.NOT_APPROVED } } })} />
              <InnerStatCard title="Awaiting Approval" value={stats.pendingHead} subtitle="Needs Approval" icon={<Clock size={20} className="text-violet-500" />} color="violet" onClick={() => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.AWAITING_APPROVAL } } })} />
              <InnerStatCard title="Completed" value={stats.pendingHr} subtitle="Pending HR" icon={<ShieldAlert size={20} className="text-blue-500" />} color="blue" onClick={() => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.COMPLETE } } })} />
              <InnerStatCard title="HR Verified" value={stats.verified} subtitle="HR Approved" icon={<CheckCircle2 size={20} className="text-green-500" />} color="emerald" onClick={() => navigate("/tasks", { state: { presetFilter: { status: TASK_STATUS.COMPLETE } } })} />
            </>
        </div>
      </div>
    </div>
  );
}

// Reusable internal component that doesn't use the external <Card> wrapper
function InnerStatCard({ title, value, subtitle, icon, color, onClick }) {
  const colorMap = {
    mauve: "from-mauve-9/15 to-transparent",
    amber: "from-amber-500/15 to-transparent",
    destructive: "from-red-500/15 to-transparent",
    emerald: "from-green-500/15 to-transparent",
    slate: "from-slate-500/15 to-transparent",
    blue: "from-blue-500/15 to-transparent",
    orange: "from-orange-500/15 to-transparent",
    violet: "from-violet-500/15 to-transparent",
  };

  return (
    <div
      onClick={onClick}
      className={`p-5 relative overflow-hidden transition-all rounded-2xl group border border-border/50 bg-muted/20 hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] ${
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 active:scale-[0.98] hover:bg-muted/40"
          : ""
      }`}
    >
      <div
        className={`absolute top-0 right-0 w-24 h-24 bg-linear-to-br ${colorMap[color] || "from-slate-500/10 to-transparent"} -mr-6 -mt-6 rounded-full blur-xl group-hover:scale-125 transition-transform duration-500`}
      />

      <div className="flex justify-between items-start mb-4 relative z-10">
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.15em] mb-1">
            {title}
          </p>
          <h3 className="text-3xl font-extrabold tracking-tight text-foreground">
            {value}
          </h3>
        </div>
        <div className="p-2 rounded-xl bg-muted border border-border/50 group-hover:bg-muted transition-colors">
          {icon}
        </div>
      </div>
      <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest relative z-10">
        {subtitle}
      </p>
      {onClick && (
        <span className="absolute bottom-3 right-4 text-[9px] font-bold text-muted-foreground/40 uppercase tracking-widest group-hover:text-muted-foreground/70 transition-colors">
          View →
        </span>
      )}
    </div>
  );
}

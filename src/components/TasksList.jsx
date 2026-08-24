import { useState } from "react";
import TaskCard from "./TaskCard";
import Avatar from "./Avatar";
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap";
import TaskDetails from "./TaskDetails";
import { useAuth } from "../context/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../services/taskService.js";
import { TASK_STATUS, getStatusDotColor, getStatusColorAlpha, getStatusTheme } from "../constants/status.js";
import { useMemo, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import {
  Clock,
  TrendingUp,
  CheckCircle2,
  User,
  Activity,
  Plus,
} from "lucide-react";
import { formatTaskPreview } from "../utils/taskFormatters";
import LogTaskModal from "./LogTaskModal";
import { Button } from "@/components/ui/button";
import SectionHeader from "./ui/SectionHeader";
import Dot from "./ui/Dot";

function InsightBar({ label, count, total, color }) {
  const percentage = total === 0 ? 0 : Math.round((count / total) * 100);

  return (
    <div className="group">
      <div className="flex justify-between text-[11px] mb-1.5 px-0.5">
        <span className="text-muted-foreground font-bold uppercase tracking-wider">
          {label}
        </span>
        <span className="text-foreground font-black">
          {count}{" "}
          <span className="text-muted-foreground font-medium ml-1">
            ({percentage}%)
          </span>
        </span>
      </div>
      <div className="w-full bg-muted/60 rounded-full h-2 overflow-hidden border border-border/5">
        <div
          className={`h-full ${color} rounded-full transition-all duration-1000 shadow-[0_0_10px_rgba(0,0,0,0.05)]`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default function TasksList({ selectedRange }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isHr = user?.is_hr || user?.isHr;
  const isHead = user?.is_head || user?.isHead;
  const isManagement = isHr || isHead;
  const avatarMap = useEmployeeAvatarMap();
  const userSubDept = user?.sub_department || user?.subDepartment;
  const userDept = user?.department;

  const [selectedTask, setSelectedTask] = useState(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isLogTaskOpen, setIsLogTaskOpen] = useState(false);

  const { data: rawTasks = [], isLoading } = useQuery({
    queryKey: ["dashboardTasks", user?.id, isManagement ? "all" : "personal"],
    queryFn: () =>
      isManagement
        ? taskService.getAllTasks()
        : taskService.getMyTasks(user?.id),
    enabled: !!user?.id,
  });

  const location = useLocation();
  const navigate = useNavigate();

  // 🔥 DEEP LINKING NOTIFICATION HOOK
  useEffect(() => {
    if (!location.state?.openTaskId) return;
    const openId = location.state.openTaskId;
    if (rawTasks.length > 0) {
      const targetTask = rawTasks.find((t) => t.id === openId);
      if (targetTask) {
        queueMicrotask(() => {
          setSelectedTask(targetTask);
          setIsDrawerOpen(true);
          navigate(location.pathname, { replace: true, state: {} });
        });
      } else {
        // Task may be soft-deleted — fetch it directly
        import("../services/tasks/taskQueryService.js").then(
          ({ taskQueryService }) => {
            taskQueryService.getTaskById(openId)
              .then((task) => {
                if (task) {
                  setSelectedTask(task);
                  setIsDrawerOpen(true);
                }
              })
              .catch(() => {});
          }
        );
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, rawTasks, navigate, location.pathname]);

  // 🔥 FIX: Keep drawer task in sync with latest data to prevent stale state after mutations
  useEffect(() => {
    if (selectedTask && rawTasks.length > 0) {
      const fresh = rawTasks.find((t) => t.id === selectedTask.id);
      if (fresh && JSON.stringify(fresh) !== JSON.stringify(selectedTask)) {
        queueMicrotask(() => setSelectedTask(fresh));
      }
    }
  }, [rawTasks, selectedTask]);

  const { myTasks, teamTasks } = useMemo(() => {
    const rangeStart = selectedRange?.startDate
      ? new Date(`${selectedRange.startDate}T00:00:00`)
      : new Date(0);
    const rangeEnd = selectedRange?.endDate
      ? new Date(`${selectedRange.endDate}T00:00:00`)
      : new Date();

    // 🔥 NEW: Instantly scrub all deleted tasks and filter by range boundaries
    const activeTasks = rawTasks.filter((t) => {
      if (t.status === TASK_STATUS.DELETED) return false;
      const taskDate = new Date(t.createdAt);
      return taskDate >= rangeStart && taskDate < rangeEnd;
    });

    // SECTION A: My Private Queue (using activeTasks)
    const my = activeTasks.filter((t) => t.loggedById === user?.id);

    // SECTION B: Management/Team Feed
    let team = [];

    if (isHr) {
      // HR sees every task in the company EXCEPT their own personal ones
      team = activeTasks.filter((t) => t.loggedById !== user?.id);
    } else if (isHead) {
      // Head sees tasks in their sub-dept EXCEPT their own personal ones
      team = activeTasks.filter((t) => {
        const isNotMe = t.loggedById !== user?.id;

        // 🛠️ THE FIX: Bulletproof sub-department lookup
        // Checks every possible way your backend might map this field
        const taskSubDept =
          t.sub_department ||
          t.subDepartment ||
          t.creator?.sub_department ||
          t.employees?.sub_department ||
          t.employees?.subDepartment ||
          "";

        const taskDept = t.creator?.department || t.employees?.department || "";

        let inMyDept = false;
        if (userSubDept) {
          inMyDept = taskSubDept === userSubDept;
        } else {
          inMyDept = taskDept === userDept;
        }

        return isNotMe && inMyDept;
      });
    }

    return {
      myTasks: my,
      teamTasks: team,
    };
  }, [rawTasks, user?.id, isHr, isHead, userSubDept, userDept, selectedRange]);

  const editTaskMutation = useMutation({
    mutationFn: (updatedData) =>
      taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handleOpenDrawer = (task) => {
    setSelectedTask(task);
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    setIsDrawerOpen(false);
    setTimeout(() => setSelectedTask(null), 300);
  };

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
    },
  });

  if (isLoading) return <div className="py-20 flex-center">...</div>; // Keep your existing loader here

  return (
    <div className="space-y-10">
      {/* SECTION 1: MY PERSONAL TASKS (Visible to Everyone) */}
      <section className="space-y-6">
        <SectionHeader
          icon={User}
          title="Personal Pipeline"
          description="Your Private Task Queue"
          rangeLabel={selectedRange?.label}
        >
          <Button
            variant="ghost"
            className="text-muted-foreground font-bold uppercase tracking-widest text-[10px]"
            asChild
          >
            <Link to="/tasks">View All</Link>
          </Button>
        </SectionHeader>

        {myTasks.length > 0 ? (
          <div className="space-y-8">
            {/* Categorized Containers */}
            {[
              "INCOMPLETE",
              "AWAITING APPROVAL",
              "COMPLETE_UNVERIFIED",
              "COMPLETE_VERIFIED",
              "NOT APPROVED",
            ].map((statusKey) => {
              const filtered = myTasks.filter((t) => {
                if (statusKey === "COMPLETE_UNVERIFIED")
                  return t.status === TASK_STATUS.COMPLETE && !t.hrVerified;
                if (statusKey === "COMPLETE_VERIFIED")
                  return t.status === TASK_STATUS.COMPLETE && t.hrVerified;
                if (statusKey === "INCOMPLETE")
                  return t.status === TASK_STATUS.INCOMPLETE;
                if (statusKey === "AWAITING APPROVAL")
                  return t.status === TASK_STATUS.AWAITING_APPROVAL;
                if (statusKey === "NOT APPROVED")
                  return t.status === TASK_STATUS.NOT_APPROVED;
                return false;
              });

              if (filtered.length === 0) return null;

              return (
                <div key={statusKey} className="space-y-4">
                  <div className="flex items-center gap-2.5 px-1 py-1">
                    <Dot
                      className="shadow-sm"
                      size="w-2 h-2"
                      color={
                        statusKey === "COMPLETE_VERIFIED" || statusKey === "COMPLETE_UNVERIFIED"
                          ? getStatusColorAlpha(getStatusTheme(TASK_STATUS.COMPLETE))
                          : statusKey === "AWAITING APPROVAL"
                            ? getStatusColorAlpha(getStatusTheme(TASK_STATUS.AWAITING_APPROVAL))
                            : statusKey === "NOT APPROVED"
                              ? getStatusColorAlpha(getStatusTheme(TASK_STATUS.NOT_APPROVED))
                              : getStatusColorAlpha(getStatusTheme(TASK_STATUS.INCOMPLETE))
                      }
                    />
                    <h3 className="text-[11px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                      {statusKey === "COMPLETE_VERIFIED"
                        ? "HR Verified"
                        : statusKey === "COMPLETE_UNVERIFIED"
                          ? "Completed (Unverified)"
                          : statusKey === "AWAITING APPROVAL"
                            ? "Awaiting Manager"
                            : statusKey === "NOT APPROVED"
                              ? "Return Required"
                              : "Active Priority"}
                      <span className="ml-2 px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground text-[9px] border border-border/50">
                        {filtered.length}
                      </span>
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-stretch">
                    {filtered.slice(0, 3).map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        onView={() => handleOpenDrawer(task)}
                        onSilentUpdate={(payload) =>
                          editTaskMutation.mutateAsync(payload)
                        }
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-16 text-center bg-card border border-border border-dashed rounded-[2rem] text-muted-foreground flex flex-col items-center gap-4 shadow-sm">
            <div className="w-16 h-16 rounded-full bg-mauve-3 flex items-center justify-center text-mauve-9">
              <Plus size={32} />
            </div>
            <p className="font-bold text-lg text-foreground">Clean Slate</p>
            <p className="text-sm max-w-xs text-muted-foreground">
              You haven't logged any personal tasks for this month yet. Start
              building your timeline.
            </p>
            <Button
              onClick={() => setIsLogTaskOpen(true)}
              className="mt-2 h-11 px-8 rounded-xl bg-primary hover:bg-primary-hover font-bold shadow-lg shadow-primary/20"
            >
              Create New Task
            </Button>
          </div>
        )}
      </section>

      {/* SECTION 2: MANAGEMENT COMMAND CENTER (HR/HEAD ONLY) */}
      {isManagement && (
        <section className="mt-8 border-t border-border pt-8">
          <SectionHeader
            icon={Activity}
            title={isHr ? "Organization Hub" : "Team Performance"}
            description={
              isHr ? "Full Spectrum Oversight" : `${userSubDept} Radar`
            }
            rangeLabel={selectedRange?.label}
            className="mb-8"
          >
            <Button
              variant="ghost"
              className="text-muted-foreground font-bold uppercase tracking-widest text-[10px]"
              asChild
            >
              <Link to="/tasks">Task Directory</Link>
            </Button>
          </SectionHeader>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* LEFT: LIVE ACTIVITY TICKER (Takes up 2/3 of the space) */}
            <div className="lg:col-span-2 bg-card border border-border rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="bg-muted/30 border-b border-border p-5">
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2">
                  <Clock size={14} className="text-mauve-9" />
                  <p className="text-mauve-9">Executive Feed</p>
                </h3>
              </div>
              <div className="divide-y divide-border/50">
                {teamTasks.length > 0 ? (
                  teamTasks.slice(0, 5).map((task) => {
                    const categoryDisplay = (task.categoryId || "")
                      .toLowerCase()
                      .replace(/\b\w/g, (c) => c.toUpperCase());
                    return (
                      <div
                        key={task.id}
                        onClick={() => handleOpenDrawer(task)}
                        className="px-5 py-4 hover:bg-muted/30 transition-all cursor-pointer flex items-center gap-4 group"
                      >
                        {/* Compact 24px avatar */}
                        <Avatar
                          name={task.loggedByName}
                          size="md"
                          src={avatarMap.get(task.loggedById) ?? undefined}
                          className="group-hover:bg-card group-hover:shadow-sm group-hover:text-green-11"
                        />
                        {/* Main text block */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-foreground font-medium truncate">
                            <span className="font-extrabold text-foreground">
                              {task.loggedByName}
                            </span>{" "}
                            logged in{" "}
                            <span className="font-bold text-green-11">
                              {categoryDisplay}
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-1">
                            {formatTaskPreview(task.taskDescription, task.checklist)}
                          </p>
                        </div>
                        {/* Inline: status dot(s) + date */}
                        <div className="shrink-0 flex items-center gap-2">
                          {task.status === TASK_STATUS.COMPLETE &&
                            task.hrVerified && (
                              <CheckCircle2
                                className="text-green-9"
                                size={14}
                              />
                            )}
                          <Dot
                            size="w-2 h-2"
                            color={getStatusDotColor(task.status)}
                          />
                          <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest ml-1 bg-muted px-2 py-0.5 rounded-md border border-border/50">
                            {new Date(task.createdAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-10 text-center text-muted-foreground text-sm font-medium">
                    No recent tasks found.
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: MINI ANALYTICS / QUICK INSIGHTS */}
            <div className="bg-card border border-border rounded-2xl shadow-sm p-6 flex flex-col gap-8">
              <div>
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em] flex items-center gap-2 mb-6">
                  <TrendingUp size={14} className="text-mauve-8" />
                  <p>Pipeline Analytics</p>
                </h3>

                {/* Pre-calculate the buckets so the JSX stays perfectly clean */}
                {(() => {
                  const total = teamTasks.length || 1; // Fallback to 1 to prevent division by zero errors
                  const draftCount = teamTasks.filter(
                    (t) => t.status === TASK_STATUS.INCOMPLETE,
                  ).length;
                  const awaitingApprovalCount = teamTasks.filter(
                    (t) => t.status === TASK_STATUS.AWAITING_APPROVAL,
                  ).length;
                  const rejectedCount = teamTasks.filter(
                    (t) => t.status === TASK_STATUS.NOT_APPROVED,
                  ).length;
                  const pendingHrCount = teamTasks.filter(
                    (t) => t.status === TASK_STATUS.COMPLETE && !t.hrVerified,
                  ).length;
                  const verifiedCount = teamTasks.filter(
                    (t) => t.hrVerified,
                  ).length;

                  const isEmployee = !isHead && !isHr;
                  const isStrictlyHead = isHead && !isHr;

                  return (
                    <div className="space-y-4">
                      {/* ========================================== */}
                      {/* 1. EMPLOYEE VIEW                             */}
                      {/* ========================================== */}
                      {isEmployee && (
                        <>
                          <InsightBar
                            label="Action Required (Rejected)"
                            count={rejectedCount}
                            total={total}
                            color="bg-red-a7"
                          />
                          <InsightBar
                            label="Drafts (Working)"
                            count={draftCount}
                            total={total}
                            color="bg-orange-a7"
                          />
                          <InsightBar
                            label="Awaiting Mgt Approval"
                            count={awaitingApprovalCount}
                            total={total}
                            color="bg-violet-a7"
                          />
                          <InsightBar
                            label="Approved (Pending HR)"
                            count={pendingHrCount}
                            total={total}
                            color="bg-blue-a7"
                          />
                          <InsightBar
                            label="HR Verified & Finalized"
                            count={verifiedCount}
                            total={total}
                            color="bg-green-a7"
                          />
                        </>
                      )}

                      {/* ========================================== */}
                      {/* 2. HEAD / MANAGER VIEW                       */}
                      {/* ========================================== */}
                      {isStrictlyHead && (
                        <>
                          <InsightBar
                            label="Needs My Review (New)"
                            count={awaitingApprovalCount}
                            total={total}
                            color="bg-violet-a7"
                          />
                          <InsightBar
                            label="Rejected by Me"
                            count={rejectedCount}
                            total={total}
                            color="bg-red-a7"
                          />
                          <InsightBar
                            label="Subordinates Drafting"
                            count={draftCount}
                            total={total}
                            color="bg-orange-a7"
                          />
                          <InsightBar
                            label="Approved (Pending HR)"
                            count={pendingHrCount}
                            total={total}
                            color="bg-blue-a7"
                          />
                          <InsightBar
                            label="Verified by HR"
                            count={verifiedCount}
                            total={total}
                            color="bg-green-a7"
                          />
                        </>
                      )}

                      {/* ========================================== */}
                      {/* 3. HR ADMIN VIEW                             */}
                      {/* ========================================== */}
                      {isHr && (
                        <>
                          <InsightBar
                            label="Needs My Audit"
                            count={pendingHrCount}
                            total={total}
                            color="bg-blue-a7"
                          />
                          <InsightBar
                            label="Awaiting Manager Review"
                            count={awaitingApprovalCount}
                            total={total}
                            color="bg-violet-a7"
                          />
                          <InsightBar
                            label="Employees Working"
                            count={draftCount}
                            total={total}
                            color="bg-orange-a7"
                          />
                          <InsightBar
                            label="Manager Rejections"
                            count={rejectedCount}
                            total={total}
                            color="bg-red-a7"
                          />
                          <InsightBar
                            label="Verified"
                            count={verifiedCount}
                            total={total}
                            color="bg-green-a7"
                          />
                        </>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Dynamic Action Box based on Role */}
              <div className="mt-auto rounded-2xl p-5 bg-amber-1 border border-amber-4 shadow-sm">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-mauve-9 mb-2">
                  System Context
                </p>
                <p className="text-[13px] font-bold leading-relaxed text-foreground">
                  {!isHead &&
                    !isHr &&
                    "Tasks marked 'Return Required' need immediate revision to proceed."}
                  {isHead &&
                    !isHr &&
                    "Keep your pipeline clear by reviewing 'Needs My Review' tasks daily."}
                  {isHr &&
                    "Focus on 'Needs My Audit' tasks to finalize the company timesheets."}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      <TaskDetails
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        task={selectedTask}
        onUpdateTask={(updatedData) =>
          editTaskMutation.mutateAsync(updatedData)
        }
        onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
      />

      <LogTaskModal
        isOpen={isLogTaskOpen}
        onClose={() => setIsLogTaskOpen(false)}
      />
    </div>
  );
}

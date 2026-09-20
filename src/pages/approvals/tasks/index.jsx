import { useState, useMemo, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useAuth } from "../../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../../../services/taskService.js";
import { taskQueryService } from "../../../services/tasks/taskQueryService.js";
import { supabase } from "../../../lib/supabase.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import {
  Search,
  CheckCircle2,
  History,
  Users2,
  Clock,
  AlertTriangle,
  ListFilter,
  Layers,
  CheckSquare,
  XSquare,
  Sparkles,
  UserCheck
} from "lucide-react";
import toast from "react-hot-toast";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import Spinner from "@/components/ui/Spinner";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";

import {
  filterAndSortTasks,
  partitionByStaleness,
  summariseQueueEmployees,
  toggleSelectedId,
} from "../../../utils/approvalQueue.js";
import { sameDepartment } from "../../../utils/compareDepartment.js";
import { ApprovalHeader } from "../_components/ApprovalHeader";
import { ApprovalSplitView } from "../_components/ApprovalSplitView";
import BulkGradeModal from "../_components/BulkGradeModal";
import BulkDeclineModal from "../_components/BulkDeclineModal";
import { Button } from "@/components/ui/button";
import PageContainer from "../../../components/ui/PageContainer";
import TabGroup from "../../../components/ui/TabGroup";

export default function TaskApprovalsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // HEAD/MANAGER roles only — super-admin bypass is intentional here
  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  // isHr is intentionally DB-driven only — no super-admin bypass
  const isHr = user?.is_hr === true || user?.isHr === true;
  const userSubDept = user?.sub_department || user?.subDepartment;
  const userDept = user?.department;

  const { data: rawTasks = [], isLoading } = useQuery({
    queryKey: ["dashboardTasks", user?.id, "all"],
    queryFn: () => taskService.getAllTasks(),
    enabled: !!user?.id,
  });

  const { data: appSettings } = useQuery({
    queryKey: ["appSettings"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("*").single();
      return data;
    },
  });

  const location = useLocation();
  const navigate = useNavigate();
  const [viewTask, setViewTask] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);

  // Smart Tabs: "ALL" | "ACTIVE" | "STALE" | "VERIFIED"
  const [activeTab, setActiveTab] = useState("ALL");

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("OLDEST");
  const [timeframe, setTimeframe] = useState("MONTHLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [isBulkGradeModalOpen, setIsBulkGradeModalOpen] = useState(false);
  const [isBulkDeclineModalOpen, setIsBulkDeclineModalOpen] = useState(false);

  // Super-admin scope toggle: default to "my queue only" so they don't see all tasks on load
  const [reportedToMeOnly, setReportedToMeOnly] = useState(true);

  useEffect(() => {
    setSelectedTaskIds([]);
  }, [
    searchQuery,
    priorityFilter,
    sortBy,
    timeframe,
    selectedDateFilter,
    statusFilter,
    deptFilter,
    subDeptFilter,
    employeeFilter,
    activeTab,
    reportedToMeOnly,
  ]);

  useEffect(() => {
    if (activeTab === "VERIFIED") setStatusFilter(TASK_STATUS.COMPLETE);
    else setStatusFilter("ALL");
  }, [activeTab]);

  useEffect(() => {
    if (!isHead && !isSuperAdmin) return;
    const fetchTopology = async () => {
      const { employeeService } =
        await import("../../../services/employeeService.js");
      const employees = await employeeService.getAllEmployees();
      if (employees) setAllEmployees(employees);
      const categories = await employeeService.getAllCategories();
      if (categories) setAllCategories(categories);
    };
    fetchTopology();
  }, [isHead, isSuperAdmin]);

  const uniqueDepts = useMemo(() => {
    return [
      ...new Set(allCategories.map((c) => c.department).filter(Boolean)),
    ].sort();
  }, [allCategories]);

  const uniqueSubDepts = useMemo(() => {
    const filteredCats =
      deptFilter === "ALL"
        ? allCategories
        : allCategories.filter((c) => sameDepartment(c.department, deptFilter));
    return [
      ...new Set(filteredCats.map((c) => c.subDepartment).filter(Boolean)),
    ].sort();
  }, [allCategories, deptFilter]);

  const uniqueEmployees = useMemo(() => {
    let pool = allEmployees.filter((e) => !e.is_super_admin);
    if (deptFilter !== "ALL")
      pool = pool.filter((e) => sameDepartment(e.department, deptFilter));
    if (subDeptFilter !== "ALL")
      pool = pool.filter((e) => sameDepartment(e.subDepartment, subDeptFilter));
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  // DEEP LINK HOOK
  useEffect(() => {
    if (!location.state?.openTaskId) return;
    const openId = location.state.openTaskId;
    if (rawTasks.length > 0) {
      const targetTask = rawTasks.find((t) => t.id === openId);
      queueMicrotask(() => {
        setActiveTaskId(openId);
        if (targetTask) {
          setViewTask(targetTask);
        } else {
          taskQueryService
            .getTaskById(openId)
            .then((task) => {
              if (task) {
                setViewTask(task);
                setActiveTaskId(task.id);
              }
            })
            .catch((err) => toast.error(err.message || "Something went wrong"));
        }
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, rawTasks, navigate, location.pathname]);

  // HEAD QUEUE — pending tasks for grading (INCOMPLETE / AWAITING_APPROVAL)
  const pendingTasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        const isNotMe = t.loggedById !== user?.id;
        if (!isNotMe) return false;
        if (!isHead && !isSuperAdmin) return false;

        if (t.reportedTo) {
          if ((isSuperAdmin || isHead) && !reportedToMeOnly) {
            return (
              t.status === TASK_STATUS.INCOMPLETE ||
              t.status === TASK_STATUS.AWAITING_APPROVAL
            );
          }
          return (
            t.reportedTo === user?.id &&
            (t.status === TASK_STATUS.INCOMPLETE ||
              t.status === TASK_STATUS.AWAITING_APPROVAL)
          );
        }

        // Fallback: dept-matching for legacy tasks without reported_to
        const taskSubDept =
          t.sub_department ||
          t.subDepartment ||
          t.creator?.sub_department ||
          t.employees?.sub_department ||
          "";
        const taskDept = t.creator?.department || t.employees?.department || "";

        let isMyDept = false;
        if (userSubDept) {
          isMyDept = taskSubDept === userSubDept;
        } else {
          isMyDept = taskDept === userDept;
        }

        const isMarketing =
          taskSubDept === "MARKETING" || taskDept === "MARKETING";
        let matches = false;

        if (t.status === TASK_STATUS.INCOMPLETE) {
          if ((isSuperAdmin || isHead) && !reportedToMeOnly) matches = isNotMe;
          else matches = isNotMe && isMyDept;
        } else if (t.status === TASK_STATUS.AWAITING_APPROVAL) {
          const canOpsManagerApprove =
            appSettings?.marketing_approval_by_ops_manager && isMyDept;
          if ((isSuperAdmin || isHead) && !reportedToMeOnly) {
            matches = isNotMe;
          } else if (isMarketing && canOpsManagerApprove) {
            matches = isNotMe;
          } else if (
            !isMarketing &&
            appSettings?.universal_task_submission &&
            isMyDept
          ) {
            matches = isNotMe;
          }
        }

        return matches;
      })
      .sort((a, b) => {
        if (a.priority === "HIGH" && b.priority !== "HIGH") return -1;
        if (b.priority === "HIGH" && a.priority !== "HIGH") return 1;
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
  }, [
    rawTasks,
    user?.id,
    userDept,
    userSubDept,
    isHead,
    isSuperAdmin,
    appSettings,
    reportedToMeOnly,
  ]);

  // Split pending into Active and Stale/Backlog around the staleness threshold
  const { active: activePendingTasks, stale: stalePendingTasks } = useMemo(
    () => partitionByStaleness(pendingTasks),
    [pendingTasks],
  );

  // Verified / Recently Approved tasks
  const verifiedTasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        const isNotMe = t.loggedById !== user?.id;
        if (!isNotMe) return false;
        if (isSuperAdmin && !reportedToMeOnly)
          return t.status === TASK_STATUS.COMPLETE && t.evaluatedById != null;
        return (
          t.status === TASK_STATUS.COMPLETE && t.evaluatedById === user?.id
        );
      })
      .sort(
        (a, b) =>
          new Date(b.evaluatedAt || b.createdAt) -
          new Date(a.evaluatedAt || a.createdAt),
      );
  }, [rawTasks, user?.id, isSuperAdmin, reportedToMeOnly]);

  // IDs of all tasks in pending queue for replies query
  const pendingTaskIds = useMemo(
    () => pendingTasks.map((t) => t.id),
    [pendingTasks],
  );

  const { data: repliedTaskIds = new Set() } = useQuery({
    queryKey: ["managerReplies", user?.id, pendingTaskIds],
    queryFn: () =>
      taskQueryService.getManagerRepliesForTasks(pendingTaskIds, user.id),
    enabled: !!user?.id && pendingTaskIds.length > 0,
    staleTime: 30_000,
  });

  // Base dataset depending on active smart tab
  const activeRawData = useMemo(() => {
    if (activeTab === "VERIFIED") return verifiedTasks;
    if (activeTab === "ACTIVE") return activePendingTasks;
    if (activeTab === "STALE") return stalePendingTasks;
    return pendingTasks;
  }, [activeTab, verifiedTasks, activePendingTasks, stalePendingTasks, pendingTasks]);

  // Unique employees with pending task counts for the quick-filter chips
  const queueEmployees = useMemo(
    () => summariseQueueEmployees(activeRawData),
    [activeRawData],
  );

  // Filtered dataset — every control on the filter bar is applied here, in one
  // shared helper, so the HR queue cannot answer the same controls differently.
  const filteredTasks = useMemo(
    () =>
      filterAndSortTasks(activeRawData, {
        searchQuery,
        priorityFilter,
        statusFilter,
        timeframe,
        selectedDateFilter,
        deptFilter,
        subDeptFilter,
        employeeFilter,
        sortBy,
        employees: allEmployees,
      }),
    [
      activeRawData,
      searchQuery,
      priorityFilter,
      statusFilter,
      timeframe,
      selectedDateFilter,
      deptFilter,
      subDeptFilter,
      employeeFilter,
      sortBy,
      allEmployees,
    ],
  );

  const editTaskMutation = useMutation({
    mutationFn: (updatedData) =>
      taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["managerReplies"] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handleSelectAllFiltered = () =>
    setSelectedTaskIds(filteredTasks.map((t) => t.id));
  const handleDeselectAll = () => setSelectedTaskIds([]);
  const toggleTaskSelection = (taskId) =>
    setSelectedTaskIds((prev) => toggleSelectedId(prev, taskId));

  const handleUndoBulk = async (taskIds) => {
    try {
      await taskService.undoBulkApproval(taskIds, user.id);
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["managerReplies"] });
      toast.success("Bulk approval reverted successfully.");
    } catch (err) {
      toast.error(err.message || "Failed to revert bulk approval.");
    }
  };

  const handleBulkApprove = async ({ grade, remarks }) => {
    if (!selectedTaskIds.length) return;
    setIsBulkGradeModalOpen(false);
    try {
      const idsToUndo = [...selectedTaskIds];
      await taskService.bulkApproveTasks(
        selectedTaskIds,
        user.id,
        grade,
        remarks,
      );
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelectedTaskIds([]);
      undoableSuccessToast(
        `Success! ${idsToUndo.length} tasks approved.`,
        "Undo",
        () => handleUndoBulk(idsToUndo),
        6000,
      );
    } catch (err) {
      toast.error(err.message || "Bulk approval failed.");
    }
  };

  const handleBulkDecline = async ({ remarks }) => {
    if (!selectedTaskIds.length) return;
    setIsBulkDeclineModalOpen(false);
    try {
      const idsToUndo = [...selectedTaskIds];
      await taskService.bulkDeclineTasks(selectedTaskIds, user.id, remarks);
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelectedTaskIds([]);
      undoableSuccessToast(
        `Success! ${idsToUndo.length} tasks declined.`,
        "Undo",
        () => handleUndoBulk(idsToUndo),
        6000,
      );
    } catch (err) {
      toast.error(err.message || "Bulk decline failed.");
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-muted-foreground h-[60vh]">
        <Spinner size="md" />
        <p className="font-bold animate-pulse tracking-wider uppercase text-sm mt-3">
          Loading Task Approvals...
        </p>
      </div>
    );
  }

  // HR-only users (not also heads/super-admins) redirect note
  if (isHr && !isHead && !isSuperAdmin) {
    return (
      <ProtectedRoute requireHead={false}>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-foreground font-bold text-xl">Manager Queue</p>
          <p className="text-muted-foreground mt-2">
            Looking for HR verification? Go to{" "}
            <Link
              to="/approvals/hr-verification"
              className="text-primary underline font-semibold"
            >
              /approvals/hr-verification
            </Link>
          </p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <PageContainer className="pt-3 pb-8 space-y-4">
        {/* HEADER & TOP METRICS */}
        <ApprovalHeader
          isHr={false}
          isSuperAdmin={isSuperAdmin}
          appSettings={appSettings}
          pendingTasksCount={activeRawData.length}
          filteredTasksCount={filteredTasks.length}
          selectedCount={selectedTaskIds.length}
          onSelectAllPending={handleSelectAllFiltered}
          onDeselectAll={handleDeselectAll}
          handleBulkApprove={() => setIsBulkGradeModalOpen(true)}
          handleBulkDecline={() => setIsBulkDeclineModalOpen(true)}
          handleUndoBulk={() => handleUndoBulk(selectedTaskIds)}
          isVerifiedTab={activeTab === "VERIFIED"}
          pageTitle={isSuperAdmin ? "Task Approval Queue" : "Manager Evaluation Queue"}
          pageDescription={
            isSuperAdmin
              ? "Triage, evaluate, and clear task approvals system-wide."
              : "Review and evaluate pending tasks from your team."
          }
        />

        {/* SMART QUEUE TABS & SCOPE TOGGLE */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-border/60 pb-3">
          <TabGroup
            tabs={[
              {
                value: "ALL",
                label: "All Pending",
                icon: Layers,
                badge: pendingTasks.length || undefined,
              },
              {
                value: "ACTIVE",
                label: "Active (<48h)",
                icon: Clock,
                badge: activePendingTasks.length || undefined,
              },
              {
                value: "STALE",
                label: "Stale Backlog (>48h)",
                icon: AlertTriangle,
                badge: stalePendingTasks.length || undefined,
                activeClass: stalePendingTasks.length > 0 ? "bg-amber-500/10 text-amber-600 font-bold" : undefined,
              },
              {
                value: "VERIFIED",
                label: "Recently Approved",
                icon: History,
                badge: verifiedTasks.length || undefined,
              },
            ]}
            activeTab={activeTab}
            onChange={(val) => {
              setActiveTab(val);
              setEmployeeFilter("ALL");
            }}
            size="md"
          />

          <div className="flex items-center gap-2">
            {(isSuperAdmin || isHead) && (
              <TabGroup
                tabs={[
                  { value: "ME", label: "My Team", icon: Users2 },
                  {
                    value: "ALL",
                    label: "System-wide",
                    icon: Users2,
                    activeClass: "bg-amber-500/10 text-amber-600 shadow-xs rounded-lg font-bold",
                  },
                ]}
                activeTab={reportedToMeOnly ? "ME" : "ALL"}
                onChange={(v) => setReportedToMeOnly(v === "ME")}
                size="sm"
              />
            )}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
              className={`h-8 text-xs font-semibold rounded-lg gap-1.5 ${showAdvancedFilters ? "bg-muted text-foreground" : "text-muted-foreground"
                }`}
            >
              <ListFilter className="w-3.5 h-3.5" />
              <span>Filters</span>
            </Button>
          </div>
        </div>

        {/* QUICK TEAM MEMBER FILTER CHIPS (Visible if > 1 employee has tasks in queue) */}
        {queueEmployees.length > 1 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-4 text-xs">
            <span className="text-muted-foreground font-bold text-[10px] uppercase tracking-wider shrink-0 flex items-center gap-1">
              <UserCheck className="w-3 h-3" /> Quick Filter:
            </span>
            <Button
              onClick={() => setEmployeeFilter("ALL")}
              variant="ghost" className={`h-auto px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all border ${employeeFilter === "ALL"
                  ? "bg-foreground text-background border-foreground shadow-xs"
                  : "bg-card hover:bg-muted text-muted-foreground border-border"
                }`}
            >
              All ({activeRawData.length})
            </Button>
            {queueEmployees.map((emp) => (
              <Button
                key={emp.id}
                onClick={() => setEmployeeFilter(emp.id === employeeFilter ? "ALL" : emp.id)}
                variant="ghost" className={`h-auto flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all border ${emp.id === employeeFilter
                    ? "bg-foreground text-background border-foreground shadow-xs font-bold"
                    : "bg-card hover:bg-muted text-foreground border-border"
                  }`}
              >
                <span>{emp.name}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${emp.id === employeeFilter
                    ? "bg-background/20 text-background"
                    : "bg-muted text-muted-foreground"
                  }`}>
                  {emp.count}
                </span>
              </Button>
            ))}
          </div>
        )}

        {/* EXPANDABLE ADVANCED FILTER BAR */}
        {showAdvancedFilters && (
          <div className="bg-card border border-border/80 rounded-xl p-3 shadow-xs">
            <TaskFilters
              searchTerm={searchQuery}
              setSearchTerm={setSearchQuery}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              timeframe={timeframe}
              setTimeframe={setTimeframe}
              selectedDateFilter={selectedDateFilter}
              setSelectedDateFilter={setSelectedDateFilter}
              deptFilter={deptFilter}
              setDeptFilter={setDeptFilter}
              subDeptFilter={subDeptFilter}
              setSubDeptFilter={setSubDeptFilter}
              employeeFilter={employeeFilter}
              setEmployeeFilter={setEmployeeFilter}
              isManagement={true}
              isHr={false}
              hrViewMode="ALL"
              disableDeptFilter={false}
              uniqueDepts={uniqueDepts}
              uniqueSubDepts={uniqueSubDepts}
              uniqueEmployees={uniqueEmployees}
              showStatusFilter={true}
              disableStatusFilter={activeTab === "VERIFIED"}
              sortBy={sortBy}
              setSortBy={setSortBy}
            />
          </div>
        )}

        {/* MASTER-DETAIL SPLIT VIEW */}
        <ApprovalSplitView
          tasks={filteredTasks}
          isHr={false}
          isVerifiedTab={activeTab === "VERIFIED"}
          currentUserId={user?.id}
          activeTaskId={activeTaskId}
          onSelectTaskId={setActiveTaskId}
          onProcessTask={(payload) =>
            editTaskMutation.mutateAsync({
              ...payload,
              editedBy: user.id,
            })
          }
          isSubmitting={editTaskMutation.isPending}
          onViewFullDetails={setViewTask}
          selectedTaskIds={selectedTaskIds}
          onToggleTaskSelection={
            appSettings?.enable_bulk_approval ? toggleTaskSelection : undefined
          }
          enableBulkApproval={appSettings?.enable_bulk_approval}
          searchTerm={searchQuery}
          repliedTaskIds={repliedTaskIds}
          emptyMessage={{
            title:
              activeTab === "STALE"
                ? "No Stale Backlog!"
                : activeTab === "VERIFIED"
                  ? "No Approved Tasks"
                  : "Queue is Clear!",
            description:
              activeTab === "STALE"
                ? "All tasks older than 48 hours have been evaluated."
                : activeTab === "VERIFIED"
                  ? "Tasks you evaluate will appear here."
                  : "You're all caught up on approvals.",
          }}
        />
      </PageContainer>

      {/* FULL DETAILS MODAL */}
      <TaskDetails
        isOpen={!!viewTask}
        onClose={() => setViewTask(null)}
        task={viewTask}
        onUpdateTask={(updatedTask) =>
          editTaskMutation.mutateAsync(updatedTask)
        }
        onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
      />

      {/* BULK GRADE MODAL */}
      <BulkGradeModal
        isOpen={isBulkGradeModalOpen}
        onClose={() => setIsBulkGradeModalOpen(false)}
        selectedCount={selectedTaskIds.length}
        onConfirm={handleBulkApprove}
        isSubmitting={editTaskMutation.isPending}
      />

      {/* BULK DECLINE MODAL */}
      <BulkDeclineModal
        isOpen={isBulkDeclineModalOpen}
        onClose={() => setIsBulkDeclineModalOpen(false)}
        selectedCount={selectedTaskIds.length}
        onConfirm={handleBulkDecline}
        isSubmitting={editTaskMutation.isPending}
      />
    </ProtectedRoute>
  );
}

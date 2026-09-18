import { useState, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../../../services/taskService.js";
import { employeeService } from "../../../services/employeeService.js";
import { supabase } from "../../../lib/supabase.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import {
  ShieldCheck,
  History,
  Search,
  Users,
  Clock,
  AlertTriangle,
  Layers,
  ListFilter,
  UserCheck
} from "lucide-react";
import toast from "react-hot-toast";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import Spinner from "@/components/ui/Spinner";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";
import GroupTaskApprovalSection from "../_components/GroupTaskApprovalSection.jsx";
import { ApprovalHeader } from "../_components/ApprovalHeader";
import { ApprovalSplitView } from "../_components/ApprovalSplitView";
import BulkVerifyModal from "./_components/BulkVerifyModal";
import { Button } from "@/components/ui/button";
import { sameDepartment } from "../../../utils/compareDepartment.js";
import PageContainer from "../../../components/ui/PageContainer";
import TabGroup from "../../../components/ui/TabGroup";

export default function HrVerificationPage() {
  return (
    <ProtectedRoute requireHr={true}>
      <HrVerificationQueueContent />
    </ProtectedRoute>
  );
}

function HrVerificationQueueContent() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const isHr = user?.is_hr === true || user?.isHr === true;
  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isManagement = isHr || isSuperAdmin;

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

  const [viewTask, setViewTask] = useState(null);
  const [activeTaskId, setActiveTaskId] = useState(null);

  // Smart Tabs: "ALL" | "ACTIVE" | "STALE" | "VERIFIED" | "GROUP"
  const [activeTab, setActiveTab] = useState("ALL");

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("OLDEST");
  const [timeframe, setTimeframe] = useState("MONTHLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  const [isBulkVerifyModalOpen, setIsBulkVerifyModalOpen] = useState(false);

  const { data: allEmployees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: allCategories = [] } = useQuery({
    queryKey: ["allCategories"],
    queryFn: () => employeeService.getAllCategories(),
  });

  const location = useLocation();
  const navigate = useNavigate();

  // DEEP-LINK HOOK
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
          import("../../../services/tasks/taskQueryService.js").then(
            ({ taskQueryService }) => {
              taskQueryService
                .getTaskById(openId)
                .then((task) => {
                  if (task) {
                    setViewTask(task);
                    setActiveTaskId(task.id);
                  }
                })
                .catch((err) => toast.error(err.message || "Something went wrong"));
            },
          );
        }
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, rawTasks, navigate, location.pathname]);

  useEffect(() => {
    setSelectedTaskIds([]);
  }, [
    searchQuery,
    priorityFilter,
    sortBy,
    timeframe,
    selectedDateFilter,
    deptFilter,
    subDeptFilter,
    employeeFilter,
    activeTab,
  ]);



  const uniqueDepts = useMemo(
    () =>
      [
        ...new Set(allCategories.map((c) => c.department).filter(Boolean)),
      ].sort(),
    [allCategories],
  );

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
    let pool = allEmployees.filter((e) => !e.isSuperAdmin);
    if (deptFilter !== "ALL")
      pool = pool.filter((e) => sameDepartment(e.department, deptFilter));
    if (subDeptFilter !== "ALL")
      pool = pool.filter((e) => sameDepartment(e.subDepartment, subDeptFilter));
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  // HR PENDING QUEUE:
  // Tasks that are COMPLETE, graded by a Head (evaluated_by != null), and NOT yet hr_verified
  const pendingTasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        const isNotMe = t.loggedById !== user?.id;
        return (
          isNotMe &&
          t.status === TASK_STATUS.COMPLETE &&
          !t.hrVerified &&
          t.evaluatedById != null
        );
      })
      .sort(
        (a, b) =>
          new Date(a.evaluatedAt || a.createdAt) -
          new Date(b.evaluatedAt || b.createdAt),
      );
  }, [rawTasks, user?.id]);

  // Split HR pending into Active (<48h since graded) and Stale/Backlog (>=48h since graded).
  // The clock measures how long HR has been sitting on the work, not how long the employee
  // took to get graded — so we use evaluatedAt, the moment the Head's decision landed.
  const activePendingTasks = useMemo(() => {
    return pendingTasks.filter((t) => {
      const clock = t.evaluatedAt || t.createdAt;
      if (!clock) return true;
      const hrs = (new Date() - new Date(clock)) / (1000 * 60 * 60);
      return hrs < 48;
    });
  }, [pendingTasks]);

  const stalePendingTasks = useMemo(() => {
    return pendingTasks.filter((t) => {
      const clock = t.evaluatedAt || t.createdAt;
      if (!clock) return false;
      const hrs = (new Date() - new Date(clock)) / (1000 * 60 * 60);
      return hrs >= 48;
    });
  }, [pendingTasks]);

  // HR VERIFIED QUEUE
  const verifiedTasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        const isNotMe = t.loggedById !== user?.id;
        return isNotMe && t.status === TASK_STATUS.COMPLETE && t.hrVerified;
      })
      .sort(
        (a, b) =>
          new Date(b.hrVerifiedAt || b.createdAt) -
          new Date(a.hrVerifiedAt || a.createdAt),
      );
  }, [rawTasks, user?.id]);

  const activeRawData = useMemo(() => {
    if (activeTab === "VERIFIED") return verifiedTasks;
    if (activeTab === "ACTIVE") return activePendingTasks;
    if (activeTab === "STALE") return stalePendingTasks;
    return pendingTasks;
  }, [activeTab, verifiedTasks, activePendingTasks, stalePendingTasks, pendingTasks]);

  // Quick Employee Filter Pills
  const queueEmployees = useMemo(() => {
    const map = new Map();
    for (const t of activeRawData) {
      if (!t.loggedById) continue;
      const existing = map.get(t.loggedById) || {
        id: t.loggedById,
        name: t.loggedByName || "Unknown",
        avatar: t.loggedByAvatar,
        count: 0,
      };
      existing.count += 1;
      map.set(t.loggedById, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [activeRawData]);

  const filteredTasks = useMemo(() => {
    let result = [...activeRawData];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          (t.loggedByName || "").toLowerCase().includes(q) ||
          (t.categoryId || "").toLowerCase().includes(q) ||
          (t.taskDescription || "").toLowerCase().includes(q),
      );
    }
    if (priorityFilter !== "ALL") {
      result = result.filter((t) => t.priority === priorityFilter);
    }
    if (employeeFilter !== "ALL") {
      result = result.filter((t) => t.loggedById === employeeFilter);
    }
    if (deptFilter !== "ALL" || subDeptFilter !== "ALL") {
      const empMap = new Map();
      for (const emp of allEmployees) empMap.set(emp.id, emp);
      result = result.filter((task) => {
        let matchesDept = true,
          matchesSubDept = true;
        const taskOwner = empMap.get(task.loggedById);
        if (deptFilter !== "ALL")
          matchesDept = sameDepartment(taskOwner?.department, deptFilter);
        if (subDeptFilter !== "ALL")
          matchesSubDept = sameDepartment(taskOwner?.subDepartment, subDeptFilter);
        return matchesDept && matchesSubDept;
      });
    }
    if (sortBy === "NEWEST")
      result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    else if (sortBy === "OLDEST")
      result.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    else if (sortBy === "NAME")
      result.sort((a, b) =>
        (a.loggedByName || "").localeCompare(b.loggedByName || ""),
      );
    return result;
  }, [
    activeRawData,
    searchQuery,
    priorityFilter,
    sortBy,
    deptFilter,
    subDeptFilter,
    employeeFilter,
    allEmployees,
  ]);

  const editTaskMutation = useMutation({
    mutationFn: (updatedData) =>
      taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const handleSelectAll = () =>
    setSelectedTaskIds(filteredTasks.map((t) => t.id));
  const handleDeselectAll = () => setSelectedTaskIds([]);
  const toggleTaskSelection = (taskId) =>
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );

  const handleBulkVerify = async ({ notes }) => {
    if (!selectedTaskIds.length) return;
    setIsBulkVerifyModalOpen(false);
    try {
      const idsToUndo = [...selectedTaskIds];
      await taskService.bulkVerifyTasks(selectedTaskIds, user.id, notes);
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelectedTaskIds([]);
      undoableSuccessToast(
        `${idsToUndo.length} tasks verified successfully.`,
        "Undo",
        async () => {
          try {
            await taskService.bulkUnverifyTasks(idsToUndo, user.id);
            queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
            queryClient.invalidateQueries({ queryKey: ["tasks"] });
            toast.success("Verification undone.");
          } catch (e) {
            toast.error(e.message || "Failed to undo.");
          }
        },
        6000,
      );
    } catch (err) {
      toast.error(err.message || "Bulk verification failed.");
    }
  };

  const handleBulkUnverify = async () => {
    if (!selectedTaskIds.length) return;
    try {
      await taskService.bulkUnverifyTasks(selectedTaskIds, user.id);
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setSelectedTaskIds([]);
      toast.success("Verification undone successfully.");
    } catch (err) {
      toast.error(err.message || "Failed to unverify tasks.");
    }
  };

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-muted-foreground h-[60vh]">
        <Spinner size="md" />
        <p className="font-bold animate-pulse tracking-wider uppercase text-sm mt-3">
          Loading Verification Queue...
        </p>
      </div>
    );
  }

  return (
    <>
      <PageContainer className="pt-3 pb-8 space-y-4">
        <ApprovalHeader
          isHr={true}
          isSuperAdmin={isSuperAdmin}
          appSettings={appSettings}
          pendingTasksCount={activeRawData.length}
          filteredTasksCount={filteredTasks.length}
          selectedCount={selectedTaskIds.length}
          onSelectAllPending={handleSelectAll}
          onDeselectAll={handleDeselectAll}
          handleBulkApprove={() => setIsBulkVerifyModalOpen(true)}
          handleUndoBulk={handleBulkUnverify}
          isVerifiedTab={activeTab === "VERIFIED"}
          pageTitle="HR Verification Queue"
          pageDescription="Audit and sign off evaluated tasks for payroll accuracy."
        />

        {/* TAB TOGGLE */}
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
                label: "Active (<48h graded)",
                icon: Clock,
                badge: activePendingTasks.length || undefined,
              },
              {
                value: "STALE",
                label: "Stale Backlog (≥48h graded)",
                icon: AlertTriangle,
                badge: stalePendingTasks.length || undefined,
                activeClass: stalePendingTasks.length > 0 ? "bg-amber-500/10 text-amber-600 font-bold" : undefined,
              },
              {
                value: "VERIFIED",
                label: "Recently Verified",
                icon: History,
                badge: verifiedTasks.length || undefined,
              },
              {
                value: "GROUP",
                label: "Group Tasks",
                icon: Users,
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
            {activeTab !== "GROUP" && (
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
            )}
          </div>
        </div>

        {/* GROUP TAB */}
        {activeTab === "GROUP" ? (
          <GroupTaskApprovalSection />
        ) : (
          <>
            {/* QUICK TEAM MEMBER FILTER CHIPS */}
            {queueEmployees.length > 1 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-4 text-xs">
                <span className="text-muted-foreground font-bold text-[10px] uppercase tracking-wider shrink-0 flex items-center gap-1">
                  <UserCheck className="w-3 h-3" /> Quick Filter:
                </span>
                <button
                  onClick={() => setEmployeeFilter("ALL")}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold shrink-0 transition-all border ${employeeFilter === "ALL"
                    ? "bg-foreground text-background border-foreground shadow-xs"
                    : "bg-card hover:bg-muted text-muted-foreground border-border"
                    }`}
                >
                  All ({activeRawData.length})
                </button>
                {queueEmployees.map((emp) => (
                  <button
                    key={emp.id}
                    onClick={() => setEmployeeFilter(emp.id === employeeFilter ? "ALL" : emp.id)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 transition-all border ${emp.id === employeeFilter
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
                  </button>
                ))}
              </div>
            )}

            {/* ADVANCED FILTERS */}
            {showAdvancedFilters && (
              <div className="bg-card border border-border/80 rounded-xl p-3 shadow-xs">
                <TaskFilters
                  searchTerm={searchQuery}
                  setSearchTerm={setSearchQuery}
                  statusFilter={TASK_STATUS.COMPLETE}
                  setStatusFilter={() => { }}
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
                  isManagement={isManagement}
                  isHr={isHr}
                  hrViewMode="ALL"
                  disableDeptFilter={false}
                  uniqueDepts={uniqueDepts}
                  uniqueSubDepts={uniqueSubDepts}
                  uniqueEmployees={uniqueEmployees}
                  showStatusFilter={true}
                  disableStatusFilter={true}
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                />
              </div>
            )}

            {/* MASTER-DETAIL SPLIT VIEW */}
            <ApprovalSplitView
              tasks={filteredTasks}
              isHr={true}
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
              emptyMessage={{
                title:
                  activeTab === "STALE"
                    ? "No Stale Backlog!"
                    : activeTab === "VERIFIED"
                      ? "No Verified Tasks"
                      : "HR Queue is Clear!",
                description:
                  activeTab === "STALE"
                    ? "All tasks older than 48 hours have been verified."
                    : activeTab === "VERIFIED"
                      ? "Tasks you sign and audit will appear here."
                      : "No tasks are awaiting HR verification right now.",
              }}
            />
          </>
        )}
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

      {/* BULK VERIFY MODAL */}
      <BulkVerifyModal
        isOpen={isBulkVerifyModalOpen}
        onClose={() => setIsBulkVerifyModalOpen(false)}
        selectedCount={selectedTaskIds.length}
        onConfirm={handleBulkVerify}
        isSubmitting={editTaskMutation.isPending}
      />
    </>
  );
}

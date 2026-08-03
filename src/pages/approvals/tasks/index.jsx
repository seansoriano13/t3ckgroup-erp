import { useState, useMemo, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuth } from "../../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../../../services/taskService.js";
import { taskQueryService } from "../../../services/tasks/taskQueryService.js";
import { supabase } from "../../../lib/supabase.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import { Search, CheckCircle2, History, Users2 } from "lucide-react";
import toast from "react-hot-toast";
import Spinner from "@/components/ui/Spinner";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";

import { ApprovalHeader } from "../components/ApprovalHeader";
import { ApprovalRow } from "../components/ApprovalRow";
import BulkGradeModal from "../components/BulkGradeModal";
import BulkDeclineModal from "../components/BulkDeclineModal";
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
  const [autoOpenId, setAutoOpenId] = useState(null);
  const [viewTask, setViewTask] = useState(null);
  const [activeTab, setActiveTab] = useState("PENDING");

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("OLDEST");
  const [timeframe, setTimeframe] = useState("MONTHLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  });
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");
  const [selectedTaskIds, setSelectedTaskIds] = useState([]);
  const [allEmployees, setAllEmployees] = useState([]);
  const [allCategories, setAllCategories] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 50;
  const [isBulkGradeModalOpen, setIsBulkGradeModalOpen] = useState(false);
  const [isBulkDeclineModalOpen, setIsBulkDeclineModalOpen] = useState(false);

  // Super-admin scope toggle: default to "my queue only" so they don't see all tasks on load
  const [reportedToMeOnly, setReportedToMeOnly] = useState(true);

  useEffect(() => {
    setCurrentPage(1);
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
    if (activeTab === "VERIFIED") {
      setStatusFilter(TASK_STATUS.COMPLETE);
    }
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
        : allCategories.filter((c) => c.department === deptFilter);
    return [
      ...new Set(filteredCats.map((c) => c.subDepartment).filter(Boolean)),
    ].sort();
  }, [allCategories, deptFilter]);

  const uniqueEmployees = useMemo(() => {
    let pool = allEmployees.filter((e) => !e.is_super_admin);
    if (deptFilter !== "ALL")
      pool = pool.filter((e) => e.department === deptFilter);
    if (subDeptFilter !== "ALL")
      pool = pool.filter((e) => e.subDepartment === subDeptFilter);
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  // DEEP LINK HOOK
  useEffect(() => {
    if (!location.state?.openTaskId) return;
    const openId = location.state.openTaskId;
    if (rawTasks.length > 0) {
      const targetTask = rawTasks.find((t) => t.id === openId);
      queueMicrotask(() => {
        setAutoOpenId(openId);
        if (targetTask) {
          setViewTask(targetTask);
        } else {
          // Task may be soft-deleted — fetch it directly
          taskQueryService
            .getTaskById(openId)
            .then((task) => {
              if (task) setViewTask(task);
            })
            .catch(() => {});
        }
      });
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, rawTasks, navigate, location.pathname]);

  // HEAD QUEUE — pending tasks for grading (INCOMPLETE / AWAITING_APPROVAL)
  // HR users (who are not also Heads/SuperAdmins) are excluded from this queue intentionally.
  const pendingTasks = useMemo(() => {
    return rawTasks
      .filter((t) => {
        const isNotMe = t.loggedById !== user?.id;
        if (!isNotMe) return false;
        if (!isHead && !isSuperAdmin) return false;

        if (t.reportedTo) {
          // Super admin / Head with scope toggle: when "reported to me only" is off, show all
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

  // IDs of all tasks currently in the pending queue — used to scope the replies query
  const pendingTaskIds = useMemo(
    () => pendingTasks.map((t) => t.id),
    [pendingTasks],
  );

  // Secondary query: which pending tasks has the current user already replied to?
  const { data: repliedTaskIds = new Set() } = useQuery({
    queryKey: ["managerReplies", user?.id, pendingTaskIds],
    queryFn: () =>
      taskQueryService.getManagerRepliesForTasks(pendingTaskIds, user.id),
    enabled: !!user?.id && pendingTaskIds.length > 0,
    staleTime: 30_000,
  });

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

  const activeRawData = activeTab === "PENDING" ? pendingTasks : verifiedTasks;

  const filteredTasks = useMemo(() => {
    let result = [...activeRawData];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (t) =>
          (t.loggedByName || "").toLowerCase().includes(q) ||
          (t.categoryId || "").toLowerCase().includes(q) ||
          (t.taskDescription || "").toLowerCase().includes(q) ||
          (t.paymentVoucher || "").toLowerCase().includes(q),
      );
    }
    if (priorityFilter !== "ALL") {
      result = result.filter((t) => t.priority === priorityFilter);
    }
    if (statusFilter !== "ALL") {
      if (statusFilter === TASK_STATUS.INCOMPLETE)
        result = result.filter((t) => t.status === TASK_STATUS.INCOMPLETE);
      else if (statusFilter === TASK_STATUS.COMPLETE)
        result = result.filter((t) => t.status === TASK_STATUS.COMPLETE);
      else if (statusFilter === TASK_STATUS.AWAITING_APPROVAL)
        result = result.filter(
          (t) => t.status === TASK_STATUS.AWAITING_APPROVAL,
        );
      else if (statusFilter === "NOT APPROVED")
        result = result.filter((t) => t.status === TASK_STATUS.NOT_APPROVED);
      else if (statusFilter === "DELAYED")
        result = result.filter((t) => {
          const isPending =
            t.status === TASK_STATUS.INCOMPLETE ||
            t.status === TASK_STATUS.AWAITING_APPROVAL;
          if (!isPending || !t.createdAt) return false;
          const hrs = (new Date() - new Date(t.createdAt)) / (1000 * 60 * 60);
          return hrs >= 48;
        });
    }
    if (selectedDateFilter) {
      result = result.filter((t) => {
        const taskDate = new Date(t.createdAt);
        const taskDateStr = taskDate.toISOString().split("T")[0]; // YYYY-MM-DD

        if (timeframe === "DAILY") {
          return taskDateStr === selectedDateFilter;
        } else if (timeframe === "MONTHLY" || timeframe === "YEARLY") {
          return taskDateStr.startsWith(selectedDateFilter);
        } else if (timeframe === "WEEKLY") {
          const [y, m, d] = selectedDateFilter.split("-").map(Number);
          const selectedD = new Date(y, m - 1, d);
          const day = selectedD.getDay();
          const diff = selectedD.getDate() - day + (day === 0 ? -6 : 1);
          const startOfWeek = new Date(selectedD);
          startOfWeek.setDate(diff);
          startOfWeek.setHours(0, 0, 0, 0);
          const endOfWeek = new Date(startOfWeek);
          endOfWeek.setDate(startOfWeek.getDate() + 6);
          endOfWeek.setHours(23, 59, 59, 999);

          return taskDate >= startOfWeek && taskDate <= endOfWeek;
        }
        return true;
      });
    }
    if (
      deptFilter !== "ALL" ||
      subDeptFilter !== "ALL" ||
      employeeFilter !== "ALL"
    ) {
      const empMap = new Map();
      for (const emp of allEmployees) empMap.set(emp.id, emp);
      result = result.filter((task) => {
        let matchesDept = true,
          matchesSubDept = true,
          matchesEmp = true;
        const taskOwner = empMap.get(task.loggedById);
        if (deptFilter !== "ALL")
          matchesDept = taskOwner?.department === deptFilter;
        if (subDeptFilter !== "ALL")
          matchesSubDept = taskOwner?.subDepartment === subDeptFilter;
        if (employeeFilter !== "ALL")
          matchesEmp = task.loggedById === employeeFilter;
        return matchesDept && matchesSubDept && matchesEmp;
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
    statusFilter,
    timeframe,
    selectedDateFilter,
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

  const handleSelectAllPending = () =>
    setSelectedTaskIds(filteredTasks.map((t) => t.id));
  const handleDeselectAll = () => setSelectedTaskIds([]);
  const toggleTaskSelection = (taskId) =>
    setSelectedTaskIds((prev) =>
      prev.includes(taskId)
        ? prev.filter((id) => id !== taskId)
        : [...prev, taskId],
    );

  const handleUndoBulkDirect = async () => {
    if (!selectedTaskIds.length) return;
    try {
      await taskService.undoBulkApproval(selectedTaskIds, user.id);
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["managerReplies"] });
      setSelectedTaskIds([]);
      toast.success("Action reverted successfully.");
    } catch (err) {
      toast.error(err.message || "Failed to revert action.");
    }
  };

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
      toast.success(`Success! ${idsToUndo.length} tasks approved.`, {
        action: { label: "Undo", onClick: () => handleUndoBulk(idsToUndo) },
        duration: 6000,
      });
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
      toast.success(`Success! ${idsToUndo.length} tasks declined.`, {
        action: { label: "Undo", onClick: () => handleUndoBulk(idsToUndo) },
        duration: 6000,
      });
    } catch (err) {
      toast.error(err.message || "Bulk decline failed.");
    }
  };

  const paginatedTasks = useMemo(
    () =>
      filteredTasks.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage,
      ),
    [filteredTasks, currentPage, itemsPerPage],
  );
  const totalPages = Math.ceil(filteredTasks.length / itemsPerPage);

  if (isLoading)
    return (
      <div className="py-20 flex flex-col items-center justify-center text-muted-foreground h-[60vh]">
        <Spinner size="md" />
        <p className="font-bold animate-pulse tracking-wider uppercase text-sm mt-3">
          Loading Approval Queue...
        </p>
      </div>
    );

  // HR-only users (not also heads/super-admins) have no business here
  if (isHr && !isHead && !isSuperAdmin) {
    return (
      <ProtectedRoute requireHead={false}>
        <div className="flex flex-col items-center justify-center py-32 text-center">
          <p className="text-foreground font-bold text-xl">Wrong queue</p>
          <p className="text-muted-foreground mt-2">
            HR verification is at{" "}
            <a
              href="/approvals/hr-verification"
              className="text-primary underline font-semibold"
            >
              /approvals/hr-verification
            </a>
          </p>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <PageContainer className="pt-4">
        <ApprovalHeader
          isHr={false}
          isSuperAdmin={isSuperAdmin}
          appSettings={appSettings}
          pendingTasksCount={activeRawData.length}
          filteredTasksCount={filteredTasks.length}
          selectedCount={selectedTaskIds.length}
          onSelectAllPending={handleSelectAllPending}
          onDeselectAll={handleDeselectAll}
          handleBulkApprove={() => setIsBulkGradeModalOpen(true)}
          handleBulkDecline={() => setIsBulkDeclineModalOpen(true)}
          handleUndoBulk={handleUndoBulkDirect}
          isVerifiedTab={activeTab === "VERIFIED"}
          pageTitle={isSuperAdmin ? "Task Approval" : "Manager Queue"}
          pageDescription={
            isSuperAdmin
              ? "Review and grade pending tasks system-wide."
              : "Review and grade pending tasks from your team."
          }
        />

        {/* TAB TOGGLE */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border/50 pb-4 mt-2">
          <TabGroup
            tabs={[
              {
                value: "PENDING",
                label: "Pending",
                icon: CheckCircle2,
                badge: pendingTasks.length || undefined,
              },
              {
                value: "VERIFIED",
                label: "Recently Approved",
                icon: History,
                badge: verifiedTasks.length || undefined,
              },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            size="md"
          />

          {(isSuperAdmin || isHead || isHr) && (
            <TabGroup
              tabs={[
                { value: "ME", label: "My Queue", icon: Users2 },
                {
                  value: "ALL",
                  label: "System-wide",
                  icon: Users2,
                  activeClass:
                    "bg-amber-500/10 text-amber-600 shadow-sm rounded-lg",
                },
              ]}
              activeTab={reportedToMeOnly ? "ME" : "ALL"}
              onChange={(v) => setReportedToMeOnly(v === "ME")}
            />
          )}
        </div>

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

        <>
          {filteredTasks.length > 0 ? (
            <div className="flex flex-col gap-4">
              {(searchQuery || priorityFilter !== "ALL") && (
                <p className="text-xs font-bold text-muted-foreground px-1">
                  Showing {filteredTasks.length} of {activeRawData.length} tasks
                </p>
              )}
              {paginatedTasks.map((task) => (
                <ApprovalRow
                  key={task.id}
                  task={task}
                  isHr={false}
                  currentUserId={user?.id}
                  defaultExpanded={task.id === autoOpenId}
                  onViewDetails={setViewTask}
                  onProcess={(payload) =>
                    editTaskMutation.mutateAsync({
                      ...payload,
                      editedBy: user.id,
                    })
                  }
                  appSettings={appSettings}
                  isSelected={selectedTaskIds.includes(task.id)}
                  onToggleSelection={
                    appSettings?.enable_bulk_approval
                      ? toggleTaskSelection
                      : undefined
                  }
                  isVerifiedTab={activeTab === "VERIFIED"}
                  searchTerm={searchQuery}
                  isReplied={
                    activeTab === "PENDING" && repliedTaskIds.has(task.id)
                  }
                />
              ))}

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border pt-6 mt-4">
                  <span className="text-sm font-semibold text-muted-foreground">
                    Page {currentPage} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === 1}
                      onClick={() => {
                        setCurrentPage((prev) => Math.max(1, prev - 1));
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={currentPage === totalPages}
                      onClick={() => {
                        setCurrentPage((prev) =>
                          Math.min(totalPages, prev + 1),
                        );
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : pendingTasks.length > 0 ? (
            <div className="flex flex-col items-center justify-center py-20 bg-card border border-border border-dashed rounded-xl shadow-sm text-center">
              <div className="p-4 bg-muted rounded-full mb-4 ring-4 ring-muted/50">
                <Search size={28} className="text-muted-foreground" />
              </div>
              <p className="text-foreground font-semibold text-lg tracking-tight">
                No tasks match your filter
              </p>
              <p className="text-muted-foreground mt-1.5 text-sm max-w-sm mx-auto">
                Try adjusting your search or filter criteria.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setPriorityFilter("ALL");
                }}
                className="mt-6 font-semibold"
              >
                Clear filters
              </Button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-24 bg-card border border-border rounded-xl shadow-[0_4px_20px_-2px_rgba(79,70,229,0.1)] text-center relative overflow-hidden group">
              <div className="absolute -top-12 -right-12 w-64 h-64 bg-primary/5 rounded-full blur-3xl group-hover:bg-primary/10 transition-all duration-[3000ms]" />
              <div
                className={`relative inline-flex items-center justify-center w-16 h-16 rounded-full mb-6 shadow-sm ring-4 ${
                  activeTab === "PENDING"
                    ? "bg-green-3/50 text-green-10 ring-green-2"
                    : "bg-muted text-muted-foreground ring-muted/50"
                }`}
              >
                {activeTab === "PENDING" ? (
                  <CheckCircle2 size={32} />
                ) : (
                  <History size={32} />
                )}
              </div>
              <p className="text-foreground font-bold text-2xl tracking-tight relative">
                {activeTab === "PENDING" ? "Inbox Zero!" : "No Approved Tasks"}
              </p>
              <p className="text-muted-foreground mt-2 relative font-medium">
                {activeTab === "PENDING"
                  ? "You're all caught up. No pending approvals require your attention."
                  : "Tasks you've approved will appear here."}
              </p>
            </div>
          )}
        </>
      </PageContainer>

      <TaskDetails
        isOpen={!!viewTask}
        onClose={() => setViewTask(null)}
        task={viewTask}
        onUpdateTask={(updatedTask) =>
          editTaskMutation.mutateAsync(updatedTask)
        }
        onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
      />

      <BulkGradeModal
        isOpen={isBulkGradeModalOpen}
        onClose={() => setIsBulkGradeModalOpen(false)}
        selectedCount={selectedTaskIds.length}
        onConfirm={handleBulkApprove}
        isSubmitting={editTaskMutation.isPending}
      />

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

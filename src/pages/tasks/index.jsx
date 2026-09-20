import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { LayoutGrid, Table as TableIcon } from "lucide-react";
import { TASK_STATUS } from "../../constants/status.js";
import TaskDetails from "../../components/TaskDetails.jsx";
import TaskCard from "../../components/TaskCard";
import TaskTableView from "../../components/TaskTableView.jsx";
import TaskFilters from "../../components/TaskFilters.jsx";
import { useAuth } from "../../context/AuthContext";
import { taskService } from "../../services/taskService.js";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";

// --- DATE PICKER IMPORTS ---
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useTaskFilters } from "../../hooks/useTaskFilters.jsx";
import { useSavedFilters } from "../../hooks/useSavedFilters.js";
import { useTableRealtime } from "../../hooks/useTableRealtime.js";
import { employeeService } from "../../services/employeeService.js";
import PageHeader from "../../components/ui/PageHeader";
import PageContainer from "../../components/ui/PageContainer";
import TabGroup from "../../components/ui/TabGroup";
import Spinner from "@/components/ui/Spinner";
import Dot from "../../components/ui/Dot";
import { Button } from "@/components/ui/button";

// Every mutation and the realtime hook below need the page's own list and the
// dashboard's shared task list to agree on freshness after any change.
const TASK_QUERY_KEYS = [["tasks"], ["dashboardTasks"]];

export default function TasksPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // --- ROLE CHECKS ---
  const isSA = user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHr = user?.is_hr === true || user?.isHr === true || isSA;
  const isHead = user?.is_head === true || user?.isHead === true;
  const isManagement = isHr || isHead;
  const userDept = user?.department;
  const userSubDept = user?.sub_department || user?.subDepartment;

  const isDeptWideHead = isHead && (!userSubDept || userSubDept.trim() === "");

  // Pagination
  const ITEMS_PER_GROUP = 6; // tasks shown per status group per page
  const [groupPages, setGroupPages] = useState({});

  const setGroupPage = (key, page) =>
    setGroupPages((prev) => ({ ...prev, [key]: page }));

  // HR Specific Toggle
  const [hrViewMode, setHrViewMode] = useState("ALL"); // "ALL" or "PERSONAL"

  // View Switcher Mode (Grid vs Table)
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("tasks_view_mode") || "grid";
    } catch {
      return "grid";
    }
  });

  const handleViewModeChange = (nextMode) => {
    setViewMode(nextMode);
    try {
      localStorage.setItem("tasks_view_mode", nextMode);
    } catch {
      /* ignore */
    }
  };

  // 1. Filter State (Standard)
  const [searchTerm, setSearchTerm] = useState("");
  // Read preset filter from nav state (e.g. from DashboardStats card click)
  const [statusFilter, setStatusFilter] = useState(
    location.state?.presetFilter?.status || "ALL",
  );
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("NEWEST");
  // Track if advanced filter panel should be open (auto-open when preset active)
  const [advancedOpen, setAdvancedOpen] = useState(
    !!location.state?.presetFilter,
  );

  // Date Filter State
  const [timeframe, setTimeframe] = useState("YEARLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}`;
  });

  // 2. Filter State (Management Cascading)
  // Pre-fill with user's dept/subdept if they are a HEAD, otherwise default to "ALL"
  const [deptFilter, setDeptFilter] = useState(
    location.state?.filterEmployeeId ? "ALL" : isHr ? "ALL" : userDept || "ALL",
  );
  const [subDeptFilter, setSubDeptFilter] = useState(
    location.state?.filterEmployeeId
      ? "ALL"
      : isHr
        ? "ALL"
        : userSubDept || "ALL",
  );
  const [employeeFilter, setEmployeeFilter] = useState(
    location.state?.filterEmployeeId || (!isManagement ? user?.id : "ALL"),
  );
  const [reportedToFilter, setReportedToFilter] = useState("ALL");

  const { initial: savedTaskFilters, hasSavedDefault, saveDefault, clearDefault } = useSavedFilters(
    "tasks",
    user?.id,
    { crmOnly: false },
  );
  const [crmOnly, setCrmOnly] = useState(savedTaskFilters.crmOnly);

  // Clear nav state so back-nav doesn't re-apply deep-link filters
  useEffect(() => {
    if (location.state?.filterEmployeeId) {
      const newState = { ...location.state };
      delete newState.filterEmployeeId;
      navigate(location.pathname, { replace: true, state: newState });
    }
    if (location.state?.presetFilter) {
      const newState = { ...location.state };
      delete newState.presetFilter;
      navigate(location.pathname, { replace: true, state: newState });
    }
  }, [location.state, navigate, location.pathname]);

  // For non-management users, lock filters to their own account once user is loaded.
  // This effect intentionally only reacts to user?.id becoming available — it does
  // NOT include isManagement so management users are never affected.
  useEffect(() => {
    if (!user?.id) return; // wait until auth resolves
    if (!isManagement) {
      setDeptFilter(userDept || "ALL");
      setSubDeptFilter(userSubDept || "ALL");
      setEmployeeFilter(user.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // deliberately exclude isManagement — roles don't change mid-session

  // Explicit handler for HR tab toggle — this is the ONLY place management
  // filters should be auto-reset; avoids any effect-based race condition.
  const handleHrViewModeChange = (newMode) => {
    setHrViewMode(newMode);
    if (newMode === "PERSONAL") {
      setDeptFilter(userDept || "ALL");
      setSubDeptFilter(userSubDept || "ALL");
      setEmployeeFilter(user?.id || "ALL");
      setReportedToFilter("ALL");
    } else {
      setDeptFilter("ALL");
      setSubDeptFilter("ALL");
      setEmployeeFilter("ALL");
      setReportedToFilter("ALL");
    }
  };

  // --- DB DATA STATES FOR DROPDOWNS ---
  const [allEmployees, setAllEmployees] = useState([]);
  const [allCategories, setAllCategories] = useState([]);

  // 3. UI State (Pop-ups)
  const [viewTask, setViewTask] = useState(null);

  useTableRealtime("tasks", { invalidateKeys: TASK_QUERY_KEYS });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: () => {
      TASK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
  });

  // Fetch all employees and categories
  useEffect(() => {
    const fetchTopology = async () => {
      if (isManagement) {
        const employees = await employeeService.getAllEmployees();
        if (employees) setAllEmployees(employees);
      }

      const categories = await employeeService.getAllCategories();
      if (categories) setAllCategories(categories);
    };

    fetchTopology();
  }, [isManagement]);

  // Fetch all tasks
  const fetchStrategy = isHr
    ? hrViewMode === "ALL"
      ? "all"
      : "personal"
    : isManagement
      ? "all"
      : "personal";

  const {
    data: rawTasks = [],
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["tasks", user?.id, fetchStrategy],
    queryFn: () =>
      fetchStrategy === "all"
        ? taskService.getAllTasks()
        : taskService.getMyTasks(user?.id),
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (!location.state?.openTaskId) return;
    const openId = location.state.openTaskId;
    if (rawTasks.length > 0) {
      const targetTask = rawTasks.find((t) => t.id === openId);
      if (targetTask) {
        queueMicrotask(() => {
          setViewTask(targetTask);
          navigate(location.pathname, { replace: true, state: {} });
        });
      } else {
        // Task may be soft-deleted — fetch it directly
        import("../../services/tasks/taskQueryService.js").then(
          ({ taskQueryService }) => {
            taskQueryService
              .getTaskById(openId)
              .then((task) => {
                if (task) setViewTask(task);
              })
              .catch((err) => toast.error(err.message || "Something went wrong"));
          },
        );
        navigate(location.pathname, { replace: true, state: {} });
      }
    }
  }, [location.state, rawTasks, navigate, location.pathname]);

  const editTaskMutation = useMutation({
    mutationFn: (updatedData) =>
      taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      TASK_QUERY_KEYS.forEach((queryKey) => queryClient.invalidateQueries({ queryKey }));
    },
    onError: (error) => {
      console.error("Failed to update task:", error);
      toast.error("Database error: Could not update task.");
    },
  });

  // --- BUILD DYNAMIC DROPDOWNS ---
  const uniqueDepts = useMemo(() => {
    const fromCats = allCategories.map((c) => c.department);
    const fromEmps = allEmployees.map((e) => e.department);
    return [...new Set([...fromCats, ...fromEmps].filter(Boolean))].sort();
  }, [allCategories, allEmployees]);

  const uniqueSubDepts = useMemo(() => {
    const filteredCats =
      deptFilter === "ALL"
        ? allCategories
        : allCategories.filter((c) => c.department === deptFilter);
    const filteredEmps =
      deptFilter === "ALL"
        ? allEmployees
        : allEmployees.filter((e) => e.department === deptFilter);

    const fromCats = filteredCats.map((c) => c.subDepartment);
    const fromEmps = filteredEmps.map(
      (e) => e.subDepartment || e.sub_department,
    );

    return [...new Set([...fromCats, ...fromEmps].filter(Boolean))].sort();
  }, [allCategories, allEmployees, deptFilter]);

  const uniqueEmployees = useMemo(() => {
    if (!isManagement) {
      return user ? [{ id: user.id, name: user.name }] : [];
    }
    let pool = allEmployees.filter((e) => !e.is_super_admin);
    if (deptFilter !== "ALL")
      pool = pool.filter((e) => e.department === deptFilter);
    if (subDeptFilter !== "ALL")
      pool = pool.filter((e) => e.subDepartment === subDeptFilter);
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter, isManagement, user]);

  // --- THE MASTER FILTER ENGINE ---
  const filteredEmployeesForFilters =
    isHr && hrViewMode === "PERSONAL" ? [] : allEmployees;

  const { filteredTasks: sortedAndFilteredTasks } = useTaskFilters(
    rawTasks,
    {
      searchTerm,
      statusFilter,
      priorityFilter,
      hrFilter: "ALL", // Default to ALL since standard tasks view doesn't use it yet
      timeframe,
      selectedDateFilter,
      deptFilter,
      subDeptFilter,
      employeeFilter,
      reportedToFilter,
      sortBy,
      crmOnly,
    },
    {
      isManagement: isHr && hrViewMode === "PERSONAL" ? false : isManagement,
      allEmployees: filteredEmployeesForFilters,
    },
  );

  // --- HANDLERS TO RESET PAGINATION ---
  const wrapFilter = (setter) => (val) => {
    setter(val);
    setGroupPages({});
  };

  const handleDateFilterChange = (val) => {
    setSelectedDateFilter(val);
    setGroupPages({});
  };

  const handleTimeframeChange = (val) => {
    setTimeframe(val);
    setGroupPages({});
  };

  // --- LOADING / ERROR STATES ---
  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-muted-foreground h-[60vh]">
        <Spinner size="md" />
        <p className="font-bold animate-pulse tracking-wider uppercase text-sm">
          Fetching Directory...
        </p>
      </div>
    );
  }

  if (isError)
    return (
      <div className="py-10 text-center bg-red-a2 border border-red-a5 rounded-xl">
        <p className="text-red-11 font-bold">
          Connection Error: Failed to load task directory.
        </p>
      </div>
    );

  return (
    <PageContainer maxWidth="7xl" className="pt-4">
      <PageHeader
        title={
          isHr
            ? hrViewMode === "ALL"
              ? `All Tasks`
              : "My Tasks"
            : isManagement
              ? "Team tasks"
              : "My Tasks"
        }
        description={
          isHr
            ? hrViewMode === "ALL"
              ? "Monitor and filter all task logs."
              : "Manage and filter your own personal tasks."
            : isManagement
              ? "Monitor and filter employee task logs."
              : "Manage and filter your logged tasks."
        }
      >
        {isHr && (
          <TabGroup
            variant="pill"
            tabs={[
              { value: "ALL", label: "Company" },
              { value: "PERSONAL", label: "My Tasks" },
            ]}
            activeTab={hrViewMode}
            onChange={handleHrViewModeChange}
          />
        )}
      </PageHeader>

      {/* FILTER CONTROL BARS */}
      <TaskFilters
        searchTerm={searchTerm}
        setSearchTerm={wrapFilter(setSearchTerm)}
        statusFilter={statusFilter}
        setStatusFilter={wrapFilter(setStatusFilter)}
        priorityFilter={priorityFilter}
        setPriorityFilter={wrapFilter(setPriorityFilter)}
        timeframe={timeframe}
        setTimeframe={handleTimeframeChange}
        selectedDateFilter={selectedDateFilter}
        setSelectedDateFilter={handleDateFilterChange}
        deptFilter={deptFilter}
        setDeptFilter={wrapFilter(setDeptFilter)}
        subDeptFilter={subDeptFilter}
        setSubDeptFilter={wrapFilter(setSubDeptFilter)}
        employeeFilter={employeeFilter}
        setEmployeeFilter={wrapFilter(setEmployeeFilter)}
        reportedToFilter={reportedToFilter}
        setReportedToFilter={wrapFilter(setReportedToFilter)}
        isManagement={isManagement}
        isHr={isHr}
        hrViewMode={hrViewMode}
        disableDeptFilter={isHr ? hrViewMode === "PERSONAL" : !isDeptWideHead}
        uniqueDepts={uniqueDepts}
        uniqueSubDepts={uniqueSubDepts}
        uniqueEmployees={uniqueEmployees}
        sortBy={sortBy}
        setSortBy={wrapFilter(setSortBy)}
        forceAdvancedOpen={advancedOpen}
        onAdvancedOpenChange={setAdvancedOpen}
        crmOnly={crmOnly}
        setCrmOnly={wrapFilter(setCrmOnly)}
        actions={
          <TabGroup
            variant="pill"
            size="sm"
            tabs={[
              { value: "grid", label: "Grid", icon: LayoutGrid },
              { value: "table", label: "Table", icon: TableIcon },
            ]}
            activeTab={viewMode}
            onChange={handleViewModeChange}
            className="shrink-0"
          />
        }
      />

      <div className="flex justify-end -mt-2 mb-2">
        {hasSavedDefault ? (
          <Button
            type="button"
            onClick={clearDefault}
            variant="ghost" className="h-auto"
          >
            Clear saved default
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => saveDefault({ crmOnly })}
            variant="ghost" className="h-auto"
          >
            Save as my default
          </Button>
        )}
      </div>

      {viewMode === "table" ? (
        <div className="pb-10">
          <TaskTableView
            tasks={sortedAndFilteredTasks}
            searchTerm={searchTerm}
            onView={(task) => setViewTask(task)}
            onSilentUpdate={(payload) => editTaskMutation.mutateAsync(payload)}
          />
        </div>
      ) : (
        /* THE CATEGORIZED GRID — each group has its own pagination */
        <div className="space-y-12 pb-10">
        {[
          "INCOMPLETE",
          "AWAITING_APPROVAL",
          "COMPLETE_UNVERIFIED",
          "COMPLETE_VERIFIED",
          "NOT APPROVED",
        ].map((statusKey) => {
          // All tasks that belong to this group
          const allGroupTasks = sortedAndFilteredTasks.filter((t) => {
            if (statusKey === "COMPLETE_UNVERIFIED")
              return t.status === TASK_STATUS.COMPLETE && !t.hrVerified;
            if (statusKey === "COMPLETE_VERIFIED")
              return t.status === TASK_STATUS.COMPLETE && t.hrVerified;
            if (statusKey === "AWAITING_APPROVAL")
              return t.status === TASK_STATUS.AWAITING_APPROVAL;
            if (statusKey === "INCOMPLETE")
              return t.status === TASK_STATUS.INCOMPLETE;
            if (statusKey === "NOT APPROVED")
              return t.status === TASK_STATUS.NOT_APPROVED;

            return t.status === statusKey;
          });
          if (allGroupTasks.length === 0) return null;

          const currentGroupPage = groupPages[statusKey] || 1;
          const totalGroupPages = Math.ceil(
            allGroupTasks.length / ITEMS_PER_GROUP,
          );
          const groupTasks = allGroupTasks.slice(
            (currentGroupPage - 1) * ITEMS_PER_GROUP,
            currentGroupPage * ITEMS_PER_GROUP,
          );

          return (
            <div
              key={statusKey}
              className="space-y-4 group-container scroll-mt-24"
            >
              {/* Group Header */}
              <div className="flex items-center gap-3 border-b border-border pb-2 px-1">
                <Dot
                  size="w-2 h-2"
                  className="shadow-[0_0_8px_rgba(0,0,0,0.2)]"
                  color={
                    statusKey === "COMPLETE_VERIFIED"
                      ? "bg-green-9"
                      : statusKey === "COMPLETE_UNVERIFIED"
                        ? "bg-green-8"
                        : statusKey === "AWAITING_APPROVAL"
                          ? "bg-blue-9"
                          : statusKey === "NOT APPROVED"
                            ? "bg-destructive"
                            : "bg-amber-9"
                  }
                />
                <h3 className="text-[10px] font-black text-muted-foreground uppercase tracking-[0.2em]">
                  {statusKey === "COMPLETE_VERIFIED"
                    ? "Verified"
                    : statusKey === "COMPLETE_UNVERIFIED"
                      ? "Completed (Unverified)"
                      : statusKey === "AWAITING_APPROVAL"
                        ? "Awaiting Approval"
                        : statusKey === "NOT APPROVED"
                          ? "Not Approved"
                          : "Pending / In Progress"}
                </h3>
                <span className="text-[10px] font-bold text-muted-foreground bg-card px-2 py-0.5 rounded-full border border-border ml-auto">
                  {allGroupTasks.length} Total
                </span>
              </div>

              {/* Task Cards */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 md:gap-5 items-stretch transition-all"
                style={{ minHeight: totalGroupPages > 1 ? "420px" : "auto" }}
              >
                {groupTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    searchTerm={searchTerm}
                    onView={() => setViewTask(task)}
                    onSilentUpdate={(payload) =>
                      editTaskMutation.mutateAsync(payload)
                    }
                  />
                ))}
              </div>

              {/* Per-Group Mini Pagination */}
              {totalGroupPages > 1 && (
                <div className="flex items-center justify-end gap-3 pt-1">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">
                    Page {currentGroupPage} / {totalGroupPages}
                  </span>
                  <div className="flex gap-1">
                    <Button
                      disabled={currentGroupPage === 1}
                      onClick={(e) => {
                        setGroupPage(statusKey, currentGroupPage - 1);
                        e.target
                          .closest(".group-container")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "nearest",
                          });
                      }}
                      variant="outline"
                    >
                      ←
                    </Button>
                    {/* Page number pills */}
                    {(() => {
                      let startPage = Math.max(1, currentGroupPage - 2);
                      let endPage = Math.min(
                        totalGroupPages,
                        currentGroupPage + 2,
                      );

                      if (currentGroupPage <= 3) {
                        endPage = Math.min(totalGroupPages, 5);
                      } else if (currentGroupPage >= totalGroupPages - 2) {
                        startPage = Math.max(1, totalGroupPages - 4);
                      }

                      const pages = [];
                      if (startPage > 1) {
                        pages.push(1);
                        if (startPage > 2) pages.push("...");
                      }

                      for (let i = startPage; i <= endPage; i++) {
                        pages.push(i);
                      }

                      if (endPage < totalGroupPages) {
                        if (endPage < totalGroupPages - 1) pages.push("...");
                        pages.push(totalGroupPages);
                      }

                      return pages.map((p, idx) => (
                        <Button
                          key={idx}
                          disabled={p === "..."}
                          onClick={(e) => {
                            if (p !== "...") {
                              setGroupPage(statusKey, p);
                              e.target
                                .closest(".group-container")
                                ?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "nearest",
                                });
                            }
                          }}
                          variant="ghost" className={`w-7 h-7 rounded text-xs font-bold flex items-center justify-center transition-all border ${p === currentGroupPage
                            ? "bg-primary text-primary-foreground border-primary"
                            : p === "..."
                              ? "bg-transparent text-muted-foreground/80 border-transparent cursor-default"
                              : "bg-muted/50 text-muted-foreground/80 border-border hover:border-mauve-5"
                            }`}
                        >
                          {p}
                        </Button>
                      ));
                    })()}
                    <Button
                      disabled={currentGroupPage === totalGroupPages}
                      onClick={(e) => {
                        setGroupPage(statusKey, currentGroupPage + 1);
                        e.target
                          .closest(".group-container")
                          ?.scrollIntoView({
                            behavior: "smooth",
                            block: "nearest",
                          });
                      }}
                      variant="outline"
                    >
                      →
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {sortedAndFilteredTasks.length === 0 && (
          <div className="text-center py-12 md:py-20 bg-card border border-border border-dashed rounded-xl mt-4 mx-1">
            <p className="text-muted-foreground/80 font-bold text-base md:text-lg">
              No tasks found.
            </p>
            <p className="text-muted-foreground text-xs md:text-sm mt-1 px-4">
              Try adjusting your filters or search term.
            </p>
          </div>
        )}
      </div>
      )}

      <TaskDetails
        isOpen={!!viewTask}
        onClose={() => setViewTask(null)}
        task={viewTask}
        onUpdateTask={(updatedTask) =>
          editTaskMutation.mutateAsync(updatedTask)
        }
        onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
        searchTerm={searchTerm}
      />
    </PageContainer>
  );
}

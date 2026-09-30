import { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { LayoutGrid, ListChecks, Table as TableIcon } from "lucide-react";
import { TASK_STATUS } from "../../constants/status.js";
import TaskDetails from "../../components/TaskDetails.jsx";
import TaskCard from "../../components/TaskCard";
import TaskTableView from "../../components/TaskTableView.jsx";
import TaskFilterBar from "../../components/TaskFilterBar.jsx";
import { useAuth } from "../../context/AuthContext";
import { taskService } from "../../services/taskService.js";
import { useInfiniteQuery, keepPreviousData, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";

// --- DATE PICKER IMPORTS ---
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useTaskFilters } from "../../hooks/useTaskFilters.jsx";
import { useSavedFilters } from "../../hooks/useSavedFilters.js";
import { useTableRealtime } from "../../hooks/useTableRealtime.js";
import { employeeService } from "../../services/employeeService.js";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import TabGroup from "../../components/ui/TabGroup";
import Spinner from "@/components/ui/Spinner";
import Dot from "../../components/ui/Dot";

// Every mutation and the realtime hook below need the page's own list and the
// dashboard's shared task list to agree on freshness after any change.
const TASK_QUERY_KEYS = [["tasks"], ["dashboardTasks"]];

const TASKS_PAGE_SIZE = 100;

/**
 * The created_at window a timeframe filter covers, as ISO bounds, so the
 * server only sends that period. Mirrors useTaskFilters' client-side match;
 * an empty or unparseable filter means no window.
 */
function createdWindow(timeframe, value) {
  if (!value) return {};
  const parts = value.split("-").map(Number);
  if (parts.some(Number.isNaN)) return {};
  const [y, m = 1, d = 1] = parts;
  let start;
  let end;
  if (timeframe === "YEARLY") {
    start = new Date(y, 0, 1);
    end = new Date(y + 1, 0, 1);
  } else if (timeframe === "MONTHLY") {
    start = new Date(y, m - 1, 1);
    end = new Date(y, m, 1);
  } else if (timeframe === "DAILY") {
    start = new Date(y, m - 1, d);
    end = new Date(y, m - 1, d + 1);
  } else if (timeframe === "WEEKLY") {
    const picked = new Date(y, m - 1, d);
    const day = picked.getDay();
    start = new Date(y, m - 1, d - day + (day === 0 ? -6 : 1));
    end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
  } else {
    return {};
  }
  return {
    createdFrom: start.toISOString(),
    createdTo: new Date(end.getTime() - 1).toISOString(),
  };
}

/** Whose tasks a person sees when looking at only their own. */
const ownScope = (user) => ({
  deptFilter: user?.department || "ALL",
  subDeptFilter: user?.sub_department || user?.subDepartment || "ALL",
  employeeFilter: user?.id,
});

const COMPANY_SCOPE = { deptFilter: "ALL", subDeptFilter: "ALL", employeeFilter: "ALL" };

/**
 * The Tasks page's saved-default filter set: its keys and where each starts.
 * Whose tasks to show starts on real values, never a null placeholder: HR
 * company-wide, heads their own department, staff only themselves.
 */
function taskFilterDefaults(user, { isHr, isManagement }) {
  const own = ownScope(user);
  return {
    statusFilter: "ALL",
    priorityFilter: "ALL",
    sortBy: "NEWEST",
    timeframe: "YEARLY",
    selectedDateFilter: `${new Date().getFullYear()}`,
    ...(isHr ? COMPANY_SCOPE : own),
    ...(isManagement && !isHr && { employeeFilter: "ALL" }),
    reportedToFilter: "ALL",
    crmOnly: false,
  };
}

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
  const userSubDept = user?.sub_department || user?.subDepartment;

  const isDeptWideHead = isHead && (!userSubDept || userSubDept.trim() === "");

  // Pagination
  const ITEMS_PER_GROUP = 6; // tasks shown per status group per page
  const [groupPages, setGroupPages] = useState({});

  const setGroupPage = (key, page) =>
    setGroupPages((prev) => ({ ...prev, [key]: page }));

  // HR Specific Toggle
  const [hrViewMode, setHrViewMode] = useState("ALL"); // "ALL" or "PERSONAL"

  // View Switcher Mode (Table vs Grid). Table is the Register default; the grid
  // stays as a display toggle because a card carries progress a row cannot.
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("tasks_view_mode") || "table";
    } catch {
      return "table";
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

  // 1. Filter State — the saved-default filter set lives in one object, so its
  // defaults, first render and "current filters" can never disagree.
  const filterDefaults = taskFilterDefaults(user, { isHr, isManagement });
  const { initial: saved, hasSavedDefault, saveDefault, clearDefault, isDirty } =
    useSavedFilters("tasks", user?.id, filterDefaults);
  const [filters, setFilters] = useState(() => {
    const deepLinkEmployee = location.state?.filterEmployeeId;
    return {
      ...saved,
      // Staff are locked to their own tasks whatever was saved.
      ...(!isManagement && ownScope(user)),
      // A deep link to one person opens company-wide on them.
      ...(deepLinkEmployee && { ...COMPANY_SCOPE, employeeFilter: deepLinkEmployee }),
      // Read preset filter from nav state (e.g. from DashboardStats card click)
      statusFilter: location.state?.presetFilter?.status || saved.statusFilter,
    };
  });
  const { deptFilter, subDeptFilter } = filters;
  const [searchTerm, setSearchTerm] = useState("");
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
      setFilters((prev) => ({ ...prev, ...ownScope(user) }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]); // deliberately exclude isManagement — roles don't change mid-session

  // Explicit handler for HR tab toggle — this is the ONLY place management
  // filters should be auto-reset; avoids any effect-based race condition.
  const handleHrViewModeChange = (newMode) => {
    setHrViewMode(newMode);
    const scope = newMode === "PERSONAL" ? ownScope(user) : COMPANY_SCOPE;
    setFilters((prev) => ({ ...prev, ...scope, reportedToFilter: "ALL" }));
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

  // Only the selected period is fetched, and in pages, so a wide filter (a
  // whole year) doesn't pull every task up front. Older pages load on demand.
  const range = createdWindow(filters.timeframe, filters.selectedDateFilter);
  const {
    data,
    isLoading,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ["tasks", user?.id, fetchStrategy, range.createdFrom, range.createdTo],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const page = {
        ...range,
        from: pageParam,
        to: pageParam + TASKS_PAGE_SIZE - 1,
      };
      return fetchStrategy === "all"
        ? taskService.getAllTasks(page)
        : taskService.getMyTasks(user?.id, page);
    },
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === TASKS_PAGE_SIZE ? pages.length * TASKS_PAGE_SIZE : undefined,
    enabled: !!user?.id,
    placeholderData: keepPreviousData,
  });
  const rawTasks = useMemo(() => data?.pages.flat() ?? [], [data]);

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
      ...filters,
      searchTerm,
      hrFilter: "ALL", // Default to ALL since standard tasks view doesn't use it yet
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

  const changeFilter = (key) => (val) => {
    setFilters((prev) => ({ ...prev, [key]: val }));
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

  const isPersonalView = isHr && hrViewMode === "PERSONAL";
  // A staff member, or HR looking at their own tasks, is locked to their own
  // tasks; only a wider view lets the people/department filters move.
  const canPickPeople = isManagement && !isPersonalView;
  const canPickDepartment = isHr ? !isPersonalView : isDeptWideHead;

  const clearAllFilters = () => {
    setSearchTerm("");
    setGroupPages({});
    setFilters((prev) => ({
      ...prev,
      statusFilter: "ALL",
      priorityFilter: "ALL",
      selectedDateFilter: "",
      reportedToFilter: "ALL",
      crmOnly: false,
      ...(canPickPeople && {
        ...(canPickDepartment && { deptFilter: "ALL" }),
        subDeptFilter: "ALL",
        employeeFilter: "ALL",
      }),
    }));
  };

  const title = isHr
    ? hrViewMode === "ALL"
      ? "All Tasks"
      : "My Tasks"
    : isManagement
      ? "Team Tasks"
      : "My Tasks";

  const description = isHr
    ? hrViewMode === "ALL"
      ? "Monitor and filter all task logs."
      : "Manage and filter your own personal tasks."
    : isManagement
      ? "Monitor and filter employee task logs."
      : "Manage and filter your logged tasks.";

  return (
    <PageShell
      title={title}
      description={description}
      action={
        <TabGroup
          variant="pill"
          size="sm"
          tabs={[
            { value: "table", label: "Table", icon: TableIcon },
            { value: "grid", label: "Grid", icon: LayoutGrid },
          ]}
          activeTab={viewMode}
          onChange={handleViewModeChange}
          className="shrink-0"
        />
      }
      toolbar={
        <>
          {isHr && (
            <TabGroup
              variant="pill"
              size="sm"
              tabs={[
                { value: "ALL", label: "Company" },
                { value: "PERSONAL", label: "My Tasks" },
              ]}
              activeTab={hrViewMode}
              onChange={handleHrViewModeChange}
            />
          )}
          <TaskFilterBar
            searchTerm={searchTerm}
            onSearchChange={wrapFilter(setSearchTerm)}
            filters={filters}
            onChange={(key, value) => changeFilter(key)(value)}
            onClearAll={clearAllFilters}
            saveDefault={{
              hasSavedDefault,
              isDirty: isDirty(filters),
              onSave: () => saveDefault(filters),
              onClear: clearDefault,
            }}
            scope={{ canPickPeople, canPickDepartment }}
            departments={uniqueDepts}
            subDepartments={uniqueSubDepts}
            people={uniqueEmployees}
          />
        </>
      }
    >
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
                      variant="outline"
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
                      className="h-auto rounded bg-muted/50 px-3 py-1 text-xs font-bold disabled:opacity-30 active:scale-95"
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
                          variant="outline"
                          size="icon"
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
                          className={`h-7 w-7 text-xs font-bold ${p === currentGroupPage
                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary"
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
                      variant="outline"
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
                      className="h-auto rounded bg-muted/50 px-3 py-1 text-xs font-bold disabled:opacity-30 active:scale-95"
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
          <EmptyState
            icon={ListChecks}
            title="No tasks found"
            description="Try adjusting your filters or search term."
          />
        )}
      </div>
      )}

      {hasNextPage && (
        <div className="flex justify-center pb-10">
          <Button
            variant="outline"
            disabled={isFetchingNextPage}
            onClick={() => fetchNextPage()}
          >
            {isFetchingNextPage ? "Loading…" : "Load older tasks"}
          </Button>
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
    </PageShell>
  );
}

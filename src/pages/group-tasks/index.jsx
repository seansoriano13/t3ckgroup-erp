import { useState, useEffect } from "react";
import { canManageGroupTasks, getPermissionContext } from "../../utils/permissions";
import QueryError from "@/components/ui/QueryError";
import { useAuth } from "../../context/AuthContext";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { groupTaskService } from "../../services/groupTaskService";
import PageShell from "../../components/ui/PageShell";
import EmptyState from "../../components/ui/EmptyState";
import { employeeService } from "../../services/employeeService";
import toast from "react-hot-toast";
import { Users, Plus, LayoutGrid, Table as TableIcon } from "lucide-react";
import TabGroup from "../../components/ui/TabGroup";
import { Button } from "@/components/ui/button";
import PageLoading from "@/components/ui/PageLoading";

import GroupTaskCard from "./_components/GroupTaskCard";
import GroupTaskTableView from "./_components/GroupTaskTableView";
import CreateGroupTaskModal from "./_components/CreateGroupTaskModal";
import EvaluationTabs from "./_components/EvaluationTabs";
import GroupTaskFilterBar from "../../components/GroupTaskFilterBar";
import { useGroupTaskFilters } from "../../hooks/useGroupTaskFilters";
import { useSavedFilters } from "../../hooks/useSavedFilters";
import { useMemo } from "react";
import { usePaging } from "@/hooks/usePaging";
import { TablePager } from "@/components/ui/TablePager";
import { isGroupTaskEvaluator } from "../../utils/groupTaskEvaluator";
import { openRecordWindow } from "@/utils/recordLink";

// One way to open a task: the global manager reads `?open=group-task:<id>`.
const openGroupTask = (id, searchTerm) => openRecordWindow({ id, type: "GROUP_TASK", searchTerm: searchTerm || undefined });

const GROUP_TASK_FILTER_DEFAULTS = {
  statusFilter: "ALL",
  creatorFilter: "ALL",
  memberFilter: "ALL",
  deptFilter: "ALL",
  subDeptFilter: "ALL",
  timeframe: "DAILY",
  selectedDateFilter: "",
  crmOnly: false,
};

export default function GroupTasksPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // --- Demo: animate first card's progress bar 0→100 for showcase ---
  // const [demoProgress, setDemoProgress] = useState(0);
  // useEffect(() => {
  //   let val = 0;
  //   let pausing = false;
  //   let pauseTimeout = null;

  //   const tick = setInterval(() => {
  //     if (pausing) return;
  //     val += 1;
  //     if (val >= 100) {
  //       val = 100;
  //       setDemoProgress(100);
  //       pausing = true;
  //       pauseTimeout = setTimeout(() => {
  //         val = 0;
  //         pausing = false;
  //         setDemoProgress(0);
  //       }, 1200); // pause at full green for 1.2s
  //       return;
  //     }
  //     setDemoProgress(val);
  //   }, 80); // ~8s to fill, slow enough for transition to keep up

  //   return () => {
  //     clearInterval(tick);
  //     if (pauseTimeout) clearTimeout(pauseTimeout);
  //   };
  // }, []);

  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const canManage = canManageGroupTasks(getPermissionContext(user));

  // --- Data Fetching ---
  const { data: groupTasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["groupTasks", user?.id],
    queryFn: () =>
      groupTaskService.getGroupTasks(user?.id, isHead, isSuperAdmin, user?.department),
    enabled: !!user?.id,
  });

  // Everyone needs the roster, not just managers: the detail modal feeds it to
  // the mention picker, and gating it on `canManage` left a normal employee
  // with an empty list and an `@` that silently matched nobody.
  const [employees, setEmployees] = useState([]);
  useEffect(() => {
    employeeService.getAllEmployees().then(setEmployees);
  }, []);

  // --- UI State --- (table is the Register default; grid stays as a toggle)
  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem("group_tasks_view_mode") || "table";
    } catch {
      return "table";
    }
  });

  const handleViewModeChange = (nextMode) => {
    setViewMode(nextMode);
    try {
      localStorage.setItem("group_tasks_view_mode", nextMode);
    } catch {
      /* ignore */
    }
  };

  const { initial: savedFilters, hasSavedDefault, saveDefault, clearDefault, isDirty } = useSavedFilters(
    "group_tasks",
    user?.id,
    GROUP_TASK_FILTER_DEFAULTS,
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState(savedFilters.statusFilter); // ALL, ACTIVE, COMPLETED
  const [creatorFilter, setCreatorFilter] = useState(savedFilters.creatorFilter);
  const [memberFilter, setMemberFilter] = useState(savedFilters.memberFilter);
  const [deptFilter, setDeptFilter] = useState(savedFilters.deptFilter);
  const [subDeptFilter, setSubDeptFilter] = useState(savedFilters.subDeptFilter);
  const [timeframe, setTimeframe] = useState(savedFilters.timeframe);
  const [selectedDateFilter, setSelectedDateFilter] = useState(savedFilters.selectedDateFilter);
  const [dueDate, setDueDate] = useState(null);
  const [crmOnly, setCrmOnly] = useState(savedFilters.crmOnly);

  const [isCreateOpen, setIsCreateOpen] = useState(false);


  // --- Filtering ---
  const { filteredTasks, uniqueCreators, uniqueMembers } = useGroupTaskFilters(
    groupTasks,
    {
      searchTerm,
      statusFilter,
      creatorFilter,
      memberFilter,
      deptFilter,
      subDeptFilter,
      timeframe,
      selectedDateFilter,
      dueDate,
      crmOnly,
    },
  );
  const gridPaging = usePaging(filteredTasks);

  const currentFilters = {
    statusFilter,
    creatorFilter,
    memberFilter,
    deptFilter,
    subDeptFilter,
    timeframe,
    selectedDateFilter,
    crmOnly,
  };

  const filters = { ...currentFilters, dueDate };
  const setFilter = {
    statusFilter: setStatusFilter,
    creatorFilter: setCreatorFilter,
    memberFilter: setMemberFilter,
    deptFilter: setDeptFilter,
    subDeptFilter: setSubDeptFilter,
    timeframe: setTimeframe,
    selectedDateFilter: setSelectedDateFilter,
    dueDate: setDueDate,
    crmOnly: setCrmOnly,
  };

  // Tasks waiting on this person to rate them; the tab shows how many.
  const awaitingMyRating = useMemo(
    () =>
      groupTasks.filter(
        (t) => t.status === "AWAITING_EVALUATION" && isGroupTaskEvaluator(t, user?.id),
      ).length,
    [groupTasks, user?.id],
  );

  const onHoldCount = useMemo(
    () => groupTasks.filter((t) => t.status === "ON_HOLD").length,
    [groupTasks],
  );

  const clearAllFilters = () => {
    setSearchTerm("");
    setStatusFilter("ALL");
    setCreatorFilter("ALL");
    setMemberFilter("ALL");
    setDeptFilter("ALL");
    setSubDeptFilter("ALL");
    setSelectedDateFilter("");
    setDueDate(null);
    setCrmOnly(false);
  };

  const uniqueDepts = useMemo(() => {
    const fromEmps = employees.map((e) => e.department);
    const fromTasks = groupTasks.flatMap(t => [
      t.creator?.department,
      ...t.members.map(m => m.employee?.department)
    ]);
    return [...new Set([...fromEmps, ...fromTasks].filter(Boolean))].sort();
  }, [employees, groupTasks]);

  const uniqueSubDepts = useMemo(() => {
    const filteredEmps = deptFilter === "ALL" 
      ? employees 
      : employees.filter(e => e.department === deptFilter);
      
    const fromEmps = filteredEmps.map(e => e.subDepartment || e.sub_department);
    return [...new Set(fromEmps.filter(Boolean))].sort();
  }, [employees, deptFilter]);


  // --- Mutations ---

  const createGroupMutation = useMutation({
    mutationFn: (payload) => groupTaskService.createGroupTask(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task created.");
      setIsCreateOpen(false);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  if (isError) return <QueryError className="m-6" title="Group tasks could not be loaded." onRetry={refetch} />;

  if (isLoading) {
    return (
      <PageLoading label="group tasks" className="h-[60vh]" />
    );
  }

  return (
    <PageShell
      title="Group Tasks"
      description={
        canManage
          ? "Create and manage group task assignments."
          : "View your group task assignments and update progress."
      }
      action={
        <>
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
          {canManage && (
            <Button onClick={() => setIsCreateOpen(true)} aria-label="Create Group Task">
              <Plus size={16} className="md:mr-1.5" />
              <span className="max-md:hidden">Create Group Task</span>
            </Button>
          )}
        </>
      }
      tabs={
        <EvaluationTabs
          statusFilter={statusFilter}
          count={awaitingMyRating}
          holdCount={onHoldCount}
          onChange={setStatusFilter}
        />
      }
      toolbar={
        <GroupTaskFilterBar
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          filters={filters}
          onChange={(key, value) => setFilter[key](value)}
          onClearAll={clearAllFilters}
          saveDefault={{
            hasSavedDefault,
            isDirty: isDirty(currentFilters),
            onSave: () => saveDefault(currentFilters),
            onClear: clearDefault,
          }}
          creators={uniqueCreators}
          members={uniqueMembers}
          departments={uniqueDepts}
          subDepartments={uniqueSubDepts}
        />
      }
    >
      {viewMode === "table" ? (
        <div className="pb-10">
          <GroupTaskTableView
            tasks={filteredTasks}
            hasAnyTasks={groupTasks.length > 0}
            onClearFilters={clearAllFilters}
            searchTerm={searchTerm}
            onView={(task) => openGroupTask(task.id, searchTerm)}
            currentUserId={user?.id}
            isSuperAdmin={isSuperAdmin}
          />
        </div>
      ) : (
        /* GRID */
        filteredTasks.length > 0 ? (
          <div className="pb-10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {gridPaging.rows.map((task) => (
                <GroupTaskCard
                  key={task.id}
                  task={task}
                  currentUserId={user?.id}
                  isSuperAdmin={isSuperAdmin}
                  onView={() => openGroupTask(task.id, searchTerm)}
                  searchTerm={searchTerm}
                  // demoProgress={index === 0 ? demoProgress : undefined}
                />
              ))}
            </div>
            <TablePager {...gridPaging} noun="tasks" className="mt-4 rounded-xl border" />
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No group tasks found"
            description={
              groupTasks.length > 0
                ? "No group tasks match these filters."
                : "There are no active group tasks at the moment."
            }
            action={
              groupTasks.length > 0 ? (
                <Button variant="outline" size="sm" className="mt-2" onClick={clearAllFilters}>
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        )
      )}

      {/* MODALS */}

      <CreateGroupTaskModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        user={user}
        employees={employees}
        onSubmit={(payload) => createGroupMutation.mutateAsync(payload)}
        isSubmitting={createGroupMutation.isPending}
      />

    </PageShell>
  );
}

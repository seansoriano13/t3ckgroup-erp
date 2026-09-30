import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Clock, History, Layers } from "lucide-react";
import toast from "react-hot-toast";
import { taskService } from "../../../services/taskService.js";
import { taskQueryService } from "../../../services/tasks/taskQueryService.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import TabGroup from "../../../components/ui/TabGroup";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";
import GradeSelector from "../../../components/GradeSelector.jsx";
import { filterAndSortTasks, partitionByStaleness, summariseQueueEmployees } from "../../../utils/approvalQueue.js";
import { taskToItem } from "../../../utils/approvalItems.js";
import { sameDepartment } from "../../../utils/compareDepartment.js";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalQueues } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar, SelectionBar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { TaskReview } from "../_components/TaskReview";
import { APPROVE_CLASS } from "../_components/approvalUi";
import BulkDeclineModal from "../_components/BulkDeclineModal";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "tasks");

/**
 * Task Approvals — the head's grading queue in the Approval Center.
 * One table of work waiting on the reviewer's grade; a row opens the review
 * sheet, where the grade and remarks are written.
 */
export default function TaskApprovalsPage() {
  return (
    <ProtectedRoute>
      <TaskApprovalsQueue />
    </ProtectedRoute>
  );
}

function TaskApprovalsQueue() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const [reportedToMeOnly, setReportedToMeOnly] = useState(true);
  const q = useApprovalQueues({ reportedToMeOnly });
  const { user, isSuperAdmin, isHead, isHr } = q.roles;

  const [view, setView] = useState("ALL");
  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();
  const [viewTask, setViewTask] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkGrade, setBulkGrade] = useState(null);
  const [isBulkDeclineOpen, setIsBulkDeclineOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("OLDEST");
  const [timeframe, setTimeframe] = useState("MONTHLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");

  // Anything that changes what the table shows drops the bulk selection.
  const narrowing = (set) => (v) => {
    set(v);
    setSelectedIds([]);
  };

  const { data: directory } = useQuery({
    queryKey: ["approvalDirectory"],
    queryFn: async () => {
      const { employeeService } = await import("../../../services/employeeService.js");
      const [employees, categories] = await Promise.all([employeeService.getAllEmployees(), employeeService.getAllCategories()]);
      return { employees: employees || [], categories: categories || [] };
    },
    enabled: isHead || isSuperAdmin,
  });
  const allEmployees = useMemo(() => directory?.employees || [], [directory]);
  const allCategories = useMemo(() => directory?.categories || [], [directory]);

  const uniqueDepts = useMemo(() => [...new Set(allCategories.map((c) => c.department).filter(Boolean))].sort(), [allCategories]);
  const uniqueSubDepts = useMemo(() => {
    const cats = deptFilter === "ALL" ? allCategories : allCategories.filter((c) => sameDepartment(c.department, deptFilter));
    return [...new Set(cats.map((c) => c.subDepartment).filter(Boolean))].sort();
  }, [allCategories, deptFilter]);
  const uniqueEmployees = useMemo(() => {
    let pool = allEmployees.filter((e) => !e.is_super_admin);
    if (deptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.department, deptFilter));
    if (subDeptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.subDepartment, subDeptFilter));
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  const { managerPending: pending, managerDecided: decided } = q;
  const { active, stale } = useMemo(() => partitionByStaleness(pending), [pending]);
  const source = view === "VERIFIED" ? decided : view === "ACTIVE" ? active : view === "STALE" ? stale : pending;

  const pendingIds = useMemo(() => pending.map((t) => t.id), [pending]);
  const { data: repliedIds } = useQuery({
    queryKey: ["managerReplies", user?.id, pendingIds],
    queryFn: () => taskQueryService.getManagerRepliesForTasks(pendingIds, user.id),
    enabled: !!user?.id && pendingIds.length > 0,
    staleTime: 30_000,
  });

  const people = useMemo(() => summariseQueueEmployees(source), [source]);
  const items = useMemo(
    () =>
      filterAndSortTasks(source, {
        searchQuery,
        priorityFilter,
        statusFilter: view === "VERIFIED" ? TASK_STATUS.COMPLETE : statusFilter,
        timeframe,
        selectedDateFilter,
        deptFilter,
        subDeptFilter,
        employeeFilter,
        sortBy,
        employees: allEmployees,
      }).map((t) => taskToItem(t, "tasks")),
    [source, searchQuery, priorityFilter, statusFilter, view, timeframe, selectedDateFilter, deptFilter, subDeptFilter, employeeFilter, sortBy, allEmployees],
  );

  const index = items.findIndex((i) => String(i.id) === recordId);
  const open = index >= 0 ? items[index] : null;

  // A notification deep link opens its task: in the sheet when it is in this
  // queue, otherwise in the full details view.
  useEffect(() => {
    const openTaskId = location.state?.openTaskId;
    if (!openTaskId || !q.rawTasks.length) return;
    navigate(location.pathname, { replace: true, state: {} });
    queueMicrotask(() => {
      if (pending.some((t) => t.id === openTaskId) || decided.some((t) => t.id === openTaskId)) {
        openRecord(openTaskId);
        return;
      }
      const known = q.rawTasks.find((t) => t.id === openTaskId);
      if (known) setViewTask(known);
      else
        taskQueryService
          .getTaskById(openTaskId)
          .then((task) => task && setViewTask(task))
          .catch((err) => toast.error(err.message || "Could not open that task."));
    });
  }, [location.state, location.pathname, q.rawTasks, pending, decided, navigate, openRecord]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["managerReplies"] });
  }, [queryClient]);

  const editTask = useMutation({
    mutationFn: (payload) => taskService.updateTask(payload.id, payload),
    onSuccess: invalidate,
  });
  const deleteTask = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: invalidate,
  });

  const selected = items.filter((i) => selectedIds.includes(i.id));

  const undoBulk = async (ids) => {
    try {
      await taskService.undoBulkApproval(ids, user.id);
      invalidate();
      toast.success("Reverted.");
    } catch (err) {
      toast.error(err.message || "Could not revert.");
    }
  };

  const bulkApprove = async () => {
    const ids = selected.map((i) => i.id);
    try {
      await taskService.bulkApproveTasks(ids, user.id, bulkGrade, "");
      invalidate();
      setSelectedIds([]);
      setBulkGrade(null);
      undoableSuccessToast(`${ids.length} tasks approved.`, "Undo", () => undoBulk(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Bulk approval failed.");
    }
  };

  const bulkReturn = async ({ remarks }) => {
    const ids = selected.map((i) => i.id);
    setIsBulkDeclineOpen(false);
    try {
      await taskService.bulkDeclineTasks(ids, user.id, remarks);
      invalidate();
      setSelectedIds([]);
      undoableSuccessToast(`${ids.length} tasks returned.`, "Undo", () => undoBulk(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Bulk return failed.");
    }
  };

  if (q.isLoadingTasks) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center py-20 text-muted-foreground">
        <Spinner size="md" />
        <p className="mt-3 animate-pulse text-sm font-bold uppercase tracking-wider">Loading Task Approvals...</p>
      </div>
    );
  }

  // HR-only reviewers have their own queue.
  if (isHr && !isHead && !isSuperAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-center">
        <p className="text-xl font-bold text-foreground">Manager Queue</p>
        <p className="mt-2 text-muted-foreground">
          Looking for HR verification? Go to{" "}
          <Link to="/approvals/hr-verification" className="font-semibold underline">
            /approvals/hr-verification
          </Link>
        </p>
      </div>
    );
  }

  const bulkEnabled = !!q.appSettings?.enable_bulk_approval;
  const isDecidedView = view === "VERIFIED";

  return (
    <>
      <ApprovalCenterLayout
        headerActions={
          (isSuperAdmin || isHead) && (
            <TabGroup
              size="sm"
              tabs={[
                { value: "ME", label: "My team" },
                { value: "ALL", label: "System-wide" },
              ]}
              activeTab={reportedToMeOnly ? "ME" : "ALL"}
              onChange={narrowing((v) => setReportedToMeOnly(v === "ME"))}
            />
          )
        }
      toolbar={
        <ApprovalToolbar
          views={[
            { value: "ALL", label: "All Pending", icon: Layers, badge: pending.length || undefined },
            { value: "ACTIVE", label: "Active (<48h)", icon: Clock, badge: active.length || undefined },
            { value: "STALE", label: "Stale Backlog (>48h)", icon: AlertTriangle, badge: stale.length || undefined },
            { value: "VERIFIED", label: "Recently Approved", icon: History, badge: decided.length || undefined },
          ]}
          view={view}
          onViewChange={narrowing((v) => {
            setView(v);
            setEmployeeFilter("ALL");
            setStatusFilter(v === "VERIFIED" ? TASK_STATUS.COMPLETE : "ALL");
          })}
          people={people}
          person={employeeFilter}
          onPersonChange={narrowing(setEmployeeFilter)}
          search={searchQuery}
          onSearchChange={narrowing(setSearchQuery)}
          advancedOpen={showAdvanced}
          onAdvancedToggle={() => setShowAdvanced((s) => !s)}
        />}
      >

        {showAdvanced && (
          <div className="rounded-xl border border-border bg-card p-3">
            <TaskFilters
              searchTerm={searchQuery}
              setSearchTerm={narrowing(setSearchQuery)}
              statusFilter={statusFilter}
              setStatusFilter={narrowing(setStatusFilter)}
              priorityFilter={priorityFilter}
              setPriorityFilter={narrowing(setPriorityFilter)}
              timeframe={timeframe}
              setTimeframe={narrowing(setTimeframe)}
              selectedDateFilter={selectedDateFilter}
              setSelectedDateFilter={narrowing(setSelectedDateFilter)}
              deptFilter={deptFilter}
              setDeptFilter={narrowing(setDeptFilter)}
              subDeptFilter={subDeptFilter}
              setSubDeptFilter={narrowing(setSubDeptFilter)}
              employeeFilter={employeeFilter}
              setEmployeeFilter={narrowing(setEmployeeFilter)}
              isManagement
              isHr={false}
              hrViewMode="ALL"
              disableDeptFilter={false}
              uniqueDepts={uniqueDepts}
              uniqueSubDepts={uniqueSubDepts}
              uniqueEmployees={uniqueEmployees}
              showStatusFilter
              disableStatusFilter={isDecidedView}
              sortBy={sortBy}
              setSortBy={setSortBy}
            />
          </div>
        )}

        <ApprovalTable
          items={items}
          queueIcon={QUEUE.icon}
          onOpen={(item) => openRecord(item.id)}
          selectable={bulkEnabled}
          selectedIds={selectedIds}
          onToggle={(id) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
          onToggleAll={(on) => setSelectedIds(on ? items.map((i) => i.id) : [])}
          repliedIds={repliedIds}
          searchTerm={searchQuery}
          keyboard={!open && !viewTask}
          renderRowAction={(item) =>
            !item.done && (
              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openRecord(item.id)}>
                Grade
              </Button>
            )
          }
          empty={
            view === "STALE"
              ? { title: "No Stale Backlog!", description: "Every task older than 48 hours has been graded." }
              : isDecidedView
                ? { title: "No Approved Tasks", description: "Tasks you grade will appear here." }
                : { title: "Queue is Clear!", description: "You're all caught up on approvals." }
          }
        />
      </ApprovalCenterLayout>

      <SelectionBar count={selected.length} onClear={() => setSelectedIds([])}>
        {isDecidedView ? (
          <Button variant="outline" size="sm" onClick={() => undoBulk(selected.map((i) => i.id)).then(() => setSelectedIds([]))}>
            Undo approval
          </Button>
        ) : (
          <>
            <div className="w-52">
              <GradeSelector grade={bulkGrade} onSelect={setBulkGrade} canEvaluate compact />
            </div>
            <Button variant="destructive" size="sm" onClick={() => setIsBulkDeclineOpen(true)}>
              Return {selected.length}
            </Button>
            <Button size="sm" className={APPROVE_CLASS} disabled={!bulkGrade} onClick={bulkApprove}>
              Approve {selected.length}
            </Button>
          </>
        )}
      </SelectionBar>

      <ApprovalSheet
        item={open}
        queueLabel={QUEUE.label}
        queueIcon={QUEUE.icon}
        index={index}
        total={items.length}
        onStep={(d) => { const to = items[index + d]; if (to) stepRecord(to.id); }}
        onClose={closeRecord}
        onOpenDetails={(item) => setViewTask(item.source)}
      >
        {(item) => (
          <TaskReview
            key={item.id}
            item={item}
            currentUserId={user?.id}
            onProcess={(payload) => editTask.mutateAsync({ ...payload, editedBy: user.id })}
            isSubmitting={editTask.isPending}
            searchTerm={searchQuery}
            onDecided={() => {
              const next = items[index + 1] || items[index - 1];
              if (next) stepRecord(next.id);
              else closeRecord();
            }}
          />
        )}
      </ApprovalSheet>

      <TaskDetails
        isOpen={!!viewTask}
        onClose={() => setViewTask(null)}
        task={viewTask}
        onUpdateTask={(t) => editTask.mutateAsync(t)}
        onDeleteTask={(payload) => deleteTask.mutateAsync(payload)}
      />

      <BulkDeclineModal isOpen={isBulkDeclineOpen} onClose={() => setIsBulkDeclineOpen(false)} selectedCount={selected.length} onConfirm={bulkReturn} isSubmitting={editTask.isPending} />
    </>
  );
}

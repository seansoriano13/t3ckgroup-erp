import PageLoading from "@/components/ui/PageLoading";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pluralize } from "@/utils/plural";
import QueryError from "@/components/ui/QueryError";
import { useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, History, Layers, Users } from "lucide-react";
import toast from "react-hot-toast";
import { taskService } from "../../../services/taskService.js";
import { taskQueryService } from "../../../services/tasks/taskQueryService.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import TabGroup from "../../../components/ui/TabGroup";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";
import GradeSelector from "../../../components/GradeSelector.jsx";
import { filterAndSortTasks, summariseQueueEmployees } from "../../../utils/approvalQueue.js";
import { taskToItem } from "../../../utils/approvalItems.js";
import { sameDepartment } from "../../../utils/compareDepartment.js";
import { useRecordParam } from "../../../hooks/useRecordParam";
import { APPROVAL_QUEUES, useApprovalQueues } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar, SelectionBar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { TaskReview } from "../_components/TaskReview";
import { APPROVE_CLASS } from "@/components/ui/approveClass";
import BulkDeclineModal from "../_components/BulkDeclineModal";
import BulkVerifyModal from "../_components/BulkVerifyModal";
import GroupTaskApprovalSection from "../_components/GroupTaskApprovalSection.jsx";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "tasks");
const queueOf = (key) => APPROVAL_QUEUES.find((q) => q.key === key) ?? QUEUE;

/** Each task once, tagged with the step it sits at: "tasks" (Head grade) or "hr" (HR verification). */
function tagSteps(groups) {
  const step = new Map();
  for (const [key, tasks] of groups) for (const t of tasks) step.set(t.id, key);
  const seen = new Set();
  const tasks = groups.flatMap(([, list]) => list).filter((t) => !seen.has(t.id) && seen.add(t.id));
  return { tasks, step };
}

/**
 * Task Approvals — the Approval Center queue for both steps of a task's chain:
 * Head grade, then HR verification. A head sees the tasks waiting on their
 * grade, HR the graded tasks waiting on their sign-off, a Super Admin both.
 * Each row names its step, and its action and review sheet follow that step.
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
  const canGrade = isSuperAdmin || isHead;
  const canVerify = isSuperAdmin || isHr;

  const [view, setView] = useState("ALL");
  const { recordId, open: openRecord, step: stepRecord, close: closeRecord } = useRecordParam();
  const [viewTask, setViewTask] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkGrade, setBulkGrade] = useState(null);
  const [isBulkDeclineOpen, setIsBulkDeclineOpen] = useState(false);
  const [isBulkVerifyOpen, setIsBulkVerifyOpen] = useState(false);
  const [isBulkPending, setIsBulkPending] = useState(false);
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
    enabled: canGrade || canVerify,
  });
  const allEmployees = useMemo(() => directory?.employees || [], [directory]);
  const allCategories = useMemo(() => directory?.categories || [], [directory]);

  const uniqueDepts = useMemo(() => [...new Set(allCategories.map((c) => c.department).filter(Boolean))].sort(), [allCategories]);
  const uniqueSubDepts = useMemo(() => {
    const cats = deptFilter === "ALL" ? allCategories : allCategories.filter((c) => sameDepartment(c.department, deptFilter));
    return [...new Set(cats.map((c) => c.subDepartment).filter(Boolean))].sort();
  }, [allCategories, deptFilter]);
  const uniqueEmployees = useMemo(() => {
    let pool = allEmployees.filter((e) => !(e.is_super_admin || e.isSuperAdmin));
    if (deptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.department, deptFilter));
    if (subDeptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.subDepartment, subDeptFilter));
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  const { managerPending, managerDecided, hrPending, hrVerified } = q;
  const pending = useMemo(
    () => tagSteps([["tasks", canGrade ? managerPending : []], ["hr", canVerify ? hrPending : []]]),
    [canGrade, canVerify, managerPending, hrPending],
  );
  // Verified wins over graded: a task a Super Admin graded and then verified is listed once, as verified.
  const done = useMemo(
    () => tagSteps([["hr", canVerify ? hrVerified : []], ["tasks", canGrade ? managerDecided : []]]),
    [canGrade, canVerify, managerDecided, hrVerified],
  );

  // Each step runs its own clock (a head's from logging, HR's from the grade),
  // so staleness is read off the item rather than the task.
  const staleIds = useMemo(
    () => new Set(pending.tasks.filter((t) => taskToItem(t, pending.step.get(t.id)).isStale).map((t) => t.id)),
    [pending],
  );
  const active = useMemo(() => pending.tasks.filter((t) => !staleIds.has(t.id)), [pending, staleIds]);
  const stale = useMemo(() => pending.tasks.filter((t) => staleIds.has(t.id)), [pending, staleIds]);
  const isDoneView = view === "DONE";
  const source = isDoneView ? done.tasks : view === "ACTIVE" ? active : view === "STALE" ? stale : pending.tasks;
  const stepOf = isDoneView ? done.step : pending.step;

  const pendingIds = useMemo(() => pending.tasks.map((t) => t.id), [pending]);
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
        statusFilter: isDoneView ? TASK_STATUS.COMPLETE : statusFilter,
        timeframe,
        selectedDateFilter,
        deptFilter,
        subDeptFilter,
        employeeFilter,
        sortBy,
        employees: allEmployees,
      }).map((t) => taskToItem(t, stepOf.get(t.id))),
    [source, stepOf, searchQuery, priorityFilter, statusFilter, isDoneView, timeframe, selectedDateFilter, deptFilter, subDeptFilter, employeeFilter, sortBy, allEmployees],
  );

  const clearFilters = () => {
    setSearchQuery("");
    setPriorityFilter("ALL");
    setStatusFilter(isDoneView ? TASK_STATUS.COMPLETE : "ALL");
    setSelectedDateFilter("");
    setDeptFilter("ALL");
    setSubDeptFilter("ALL");
    setEmployeeFilter("ALL");
    setSelectedIds([]);
  };

  const index = items.findIndex((i) => String(i.id) === recordId);
  const open = index >= 0 ? items[index] : null;

  // A notification deep link opens its task: in the sheet when it is in this
  // queue, otherwise in the full details view.
  useEffect(() => {
    const openTaskId = location.state?.openTaskId;
    if (!openTaskId || !q.rawTasks.length) return;
    navigate(location.pathname + location.search, { replace: true, state: {} });
    queueMicrotask(() => {
      if (pending.step.has(openTaskId) || done.step.has(openTaskId)) {
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
  }, [location.state, location.pathname, location.search, q.rawTasks, pending, done, navigate, openRecord]);

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
  const toGrade = selected.filter((i) => i.queue === "tasks");
  const toVerify = selected.filter((i) => i.queue === "hr");

  const undoBulk = async (ids) => {
    try {
      await taskService.undoBulkApproval(ids, user.id);
      invalidate();
      toast.success("Reverted.");
    } catch (err) {
      toast.error(err.message || "Could not revert.");
    }
  };

  const unverify = async (ids) => {
    try {
      await taskService.bulkUnverifyTasks(ids, user.id);
      invalidate();
      toast.success("Verification undone.");
    } catch (err) {
      toast.error(err.message || "Could not undo the verification.");
    }
  };

  const undoSelected = async () => {
    const graded = toGrade.map((i) => i.id);
    const verified = toVerify.map((i) => i.id);
    if (graded.length) await undoBulk(graded);
    if (verified.length) await unverify(verified);
    setSelectedIds([]);
  };

  const bulkApprove = async () => {
    if (isBulkPending) return;
    const ids = toGrade.map((i) => i.id);
    setIsBulkPending(true);
    try {
      await taskService.bulkApproveTasks(ids, user.id, bulkGrade, "");
      invalidate();
      setSelectedIds((s) => s.filter((id) => !ids.includes(id)));
      setBulkGrade(null);
      undoableSuccessToast(`${pluralize(ids.length, "task")} approved.`, "Undo", () => undoBulk(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Bulk approval failed.");
    } finally {
      setIsBulkPending(false);
    }
  };

  const bulkReturn = async ({ remarks }) => {
    if (isBulkPending) return;
    const ids = toGrade.map((i) => i.id);
    setIsBulkDeclineOpen(false);
    setIsBulkPending(true);
    try {
      await taskService.bulkDeclineTasks(ids, user.id, remarks);
      invalidate();
      setSelectedIds((s) => s.filter((id) => !ids.includes(id)));
      undoableSuccessToast(`${pluralize(ids.length, "task")} returned.`, "Undo", () => undoBulk(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Bulk return failed.");
    } finally {
      setIsBulkPending(false);
    }
  };

  const verify = async (ids, notes = "") => {
    if (isBulkPending) return;
    setIsBulkPending(true);
    try {
      await taskService.bulkVerifyTasks(ids, user.id, notes);
      invalidate();
      setSelectedIds((s) => s.filter((id) => !ids.includes(id)));
      undoableSuccessToast(`${pluralize(ids.length, "task")} verified.`, "Undo", () => unverify(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Verification failed.");
    } finally {
      setIsBulkPending(false);
    }
  };

  if (q.isErrorTasks) {
    return <QueryError className="m-6" title="Task approvals could not be loaded." onRetry={q.refetchTasks} />;
  }

  if (q.isLoadingTasks) {
    return (
      <PageLoading label="task approvals" className="h-[60vh]" />
    );
  }

  const bulkEnabled = !!q.appSettings?.enable_bulk_approval;
  const isGroupView = view === "GROUP";

  // The 48-hour clock starts at logging for a head and at the grade for HR;
  // the hover note says which one this reviewer is looking at.
  const clock = canGrade && canVerify ? "at its current step" : canVerify ? "since graded" : "";
  const activeHint = canVerify && !canGrade ? "Graded less than 48 hours ago" : `Waiting less than 48 hours${clock ? ` ${clock}` : ""}`;
  const staleHint = canVerify && !canGrade ? "Graded 48 hours or more ago" : `Waiting 48 hours or more${clock ? ` ${clock}` : ""}`;
  const doneLabel = canGrade && canVerify ? "Recently Done" : canVerify ? "Recently Verified" : "Recently Approved";

  return (
    <>
      <ApprovalCenterLayout
        headerActions={
          canGrade && (
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
            { value: "ALL", label: "All Pending", icon: Layers, badge: pending.tasks.length || undefined },
            { value: "ACTIVE", label: "Active", hint: activeHint, icon: Clock, badge: active.length || undefined },
            { value: "STALE", label: "Overdue", hint: staleHint, icon: AlertTriangle, badge: stale.length || undefined },
            { value: "DONE", label: doneLabel, icon: History, badge: done.tasks.length || undefined },
            ...(canVerify ? [{ value: "GROUP", label: "Group Tasks", icon: Users }] : []),
          ]}
          view={view}
          onViewChange={narrowing((v) => {
            setView(v);
            setEmployeeFilter("ALL");
            setStatusFilter(v === "DONE" ? TASK_STATUS.COMPLETE : "ALL");
          })}
          people={isGroupView ? [] : people}
          person={employeeFilter}
          onPersonChange={narrowing(setEmployeeFilter)}
          search={searchQuery}
          onSearchChange={narrowing(setSearchQuery)}
          advancedOpen={showAdvanced}
          onAdvancedToggle={isGroupView ? undefined : () => setShowAdvanced((s) => !s)}
        />}
      >

        {isGroupView ? (
          <GroupTaskApprovalSection searchTerm={searchQuery} onClearSearch={() => setSearchQuery("")} />
        ) : (
          <>
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
                  disableStatusFilter={isDoneView}
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
              onToggleAll={(on, pageItems) => setSelectedIds(on ? pageItems.map((i) => i.id) : [])}
              paginate
              showStage
              filtered={source.length > 0}
              onClearFilters={clearFilters}
              repliedIds={repliedIds}
              searchTerm={searchQuery}
              keyboard={!open && !viewTask}
              renderRowAction={(item) =>
                item.done ? null : item.queue === "hr" ? (
                  <Tooltip content="Verify & sign">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Verify ${item.title}`}
                      className="hover:border-green-7 hover:bg-green-3 hover:text-green-11"
                      onClick={() => verify([item.id])}
                    >
                      <Check size={14} />
                    </Button>
                  </Tooltip>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => openRecord(item.id)}>
                    Grade
                  </Button>
                )
              }
              empty={
                view === "STALE"
                  ? { title: "Nothing overdue", description: "Every task waiting 48 hours or more has been handled." }
                  : isDoneView
                    ? { title: "Nothing decided yet", description: "Tasks you grade or verify will appear here." }
                    : { title: "Queue is clear", description: "You’re all caught up on task approvals." }
              }
            />
          </>
        )}
      </ApprovalCenterLayout>

      <SelectionBar count={selected.length} onClear={() => setSelectedIds([])}>
        {isDoneView ? (
          <Button variant="outline" size="sm" onClick={undoSelected}>
            Undo
          </Button>
        ) : (
          <>
            {toGrade.length > 0 && (
              <>
                <div className="w-52">
                  <GradeSelector grade={bulkGrade} onSelect={setBulkGrade} canEvaluate compact />
                </div>
                <Button variant="destructive" size="sm" disabled={isBulkPending} onClick={() => setIsBulkDeclineOpen(true)}>
                  {isBulkPending && <Spinner size="sm" className="mr-1" />}
                  Return {toGrade.length}
                </Button>
                <Button size="sm" className={APPROVE_CLASS} disabled={!bulkGrade || isBulkPending} onClick={bulkApprove}>
                  {isBulkPending && <Spinner size="sm" className="mr-1" />}
                  Approve {toGrade.length}
                </Button>
              </>
            )}
            {toVerify.length > 0 && (
              <Button size="sm" className={APPROVE_CLASS} disabled={isBulkPending} onClick={() => setIsBulkVerifyOpen(true)}>
                {isBulkPending && <Spinner size="sm" className="mr-1" />}
                Verify {toVerify.length}
              </Button>
            )}
          </>
        )}
      </SelectionBar>

      <ApprovalSheet
        item={open}
        queueLabel={queueOf(open?.queue).label}
        queueIcon={queueOf(open?.queue).icon}
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

      <BulkDeclineModal isOpen={isBulkDeclineOpen} onClose={() => setIsBulkDeclineOpen(false)} selectedCount={toGrade.length} onConfirm={bulkReturn} isSubmitting={isBulkPending} />

      <BulkVerifyModal
        isOpen={isBulkVerifyOpen}
        onClose={() => setIsBulkVerifyOpen(false)}
        selectedCount={toVerify.length}
        onConfirm={({ notes }) => {
          setIsBulkVerifyOpen(false);
          verify(toVerify.map((i) => i.id), notes);
        }}
        isSubmitting={isBulkPending}
      />
    </>
  );
}

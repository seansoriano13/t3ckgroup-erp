import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Clock, History, Layers, Users } from "lucide-react";
import toast from "react-hot-toast";
import { taskService } from "../../../services/taskService.js";
import { employeeService } from "../../../services/employeeService.js";
import { TASK_STATUS } from "../../../constants/status.js";
import ProtectedRoute from "../../../components/ProtectedRoute.jsx";
import Spinner from "@/components/ui/Spinner";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/Tooltip";
import { undoableSuccessToast } from "../../../components/ui/CustomToast";
import TaskDetails from "../../../components/TaskDetails.jsx";
import TaskFilters from "../../../components/TaskFilters.jsx";
import { filterAndSortTasks, summariseQueueEmployees } from "../../../utils/approvalQueue.js";
import { taskToItem } from "../../../utils/approvalItems.js";
import { sameDepartment } from "../../../utils/compareDepartment.js";
import { APPROVAL_QUEUES, useApprovalQueues } from "../_components/useApprovalQueues";
import { ApprovalCenterLayout } from "../_components/ApprovalCenterLayout";
import { ApprovalToolbar, SelectionBar } from "../_components/ApprovalToolbar";
import { ApprovalTable } from "../_components/ApprovalTable";
import { ApprovalSheet } from "../_components/ApprovalSheet";
import { TaskReview } from "../_components/TaskReview";
import { APPROVE_CLASS } from "../_components/approvalUi";
import GroupTaskApprovalSection from "../_components/GroupTaskApprovalSection.jsx";
import BulkVerifyModal from "./_components/BulkVerifyModal";

const QUEUE = APPROVAL_QUEUES.find((q) => q.key === "hr");

/**
 * HR Verifications — HR's sign-off queue in the Approval Center: tasks a head
 * has graded that HR has not yet verified for payroll, plus Group Tasks
 * waiting on HR. Same table and review sheet as every other queue.
 */
export default function HrVerificationPage() {
  return (
    <ProtectedRoute requireHr={true}>
      <HrVerificationQueue />
    </ProtectedRoute>
  );
}

function HrVerificationQueue() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const q = useApprovalQueues();
  const { user, isHr, isSuperAdmin } = q.roles;

  const [view, setView] = useState("ALL");
  const [openId, setOpenId] = useState(null);
  const [viewTask, setViewTask] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [isBulkVerifyOpen, setIsBulkVerifyOpen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("OLDEST");
  const [timeframe, setTimeframe] = useState("MONTHLY");
  const [selectedDateFilter, setSelectedDateFilter] = useState("");
  const [deptFilter, setDeptFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [employeeFilter, setEmployeeFilter] = useState("ALL");

  const narrowing = (set) => (v) => {
    set(v);
    setSelectedIds([]);
  };

  const { data: allEmployees = [] } = useQuery({ queryKey: ["allEmployees"], queryFn: () => employeeService.getAllEmployees() });
  const { data: allCategories = [] } = useQuery({ queryKey: ["allCategories"], queryFn: () => employeeService.getAllCategories() });

  const uniqueDepts = useMemo(() => [...new Set(allCategories.map((c) => c.department).filter(Boolean))].sort(), [allCategories]);
  const uniqueSubDepts = useMemo(() => {
    const cats = deptFilter === "ALL" ? allCategories : allCategories.filter((c) => sameDepartment(c.department, deptFilter));
    return [...new Set(cats.map((c) => c.subDepartment).filter(Boolean))].sort();
  }, [allCategories, deptFilter]);
  const uniqueEmployees = useMemo(() => {
    let pool = allEmployees.filter((e) => !e.isSuperAdmin);
    if (deptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.department, deptFilter));
    if (subDeptFilter !== "ALL") pool = pool.filter((e) => sameDepartment(e.subDepartment, subDeptFilter));
    return pool.sort((a, b) => a.name.localeCompare(b.name));
  }, [allEmployees, deptFilter, subDeptFilter]);

  // HR's clock runs from the head's grade, so staleness is read off the item
  // (taskToItem measures an "hr" item from evaluatedAt), not off createdAt.
  const { hrPending: pending, hrVerified: verified } = q;
  const pendingItems = useMemo(() => pending.map((t) => taskToItem(t, "hr")), [pending]);
  const staleIds = useMemo(() => new Set(pendingItems.filter((i) => i.isStale).map((i) => i.id)), [pendingItems]);
  const active = useMemo(() => pending.filter((t) => !staleIds.has(t.id)), [pending, staleIds]);
  const stale = useMemo(() => pending.filter((t) => staleIds.has(t.id)), [pending, staleIds]);
  const source = view === "VERIFIED" ? verified : view === "ACTIVE" ? active : view === "STALE" ? stale : pending;

  const people = useMemo(() => summariseQueueEmployees(source), [source]);
  const items = useMemo(
    () =>
      filterAndSortTasks(source, {
        searchQuery,
        priorityFilter,
        statusFilter: "ALL",
        timeframe,
        selectedDateFilter,
        deptFilter,
        subDeptFilter,
        employeeFilter,
        sortBy,
        employees: allEmployees,
      }).map((t) => taskToItem(t, "hr")),
    [source, searchQuery, priorityFilter, timeframe, selectedDateFilter, deptFilter, subDeptFilter, employeeFilter, sortBy, allEmployees],
  );

  const index = items.findIndex((i) => i.id === openId);
  const open = index >= 0 ? items[index] : null;

  useEffect(() => {
    const openTaskId = location.state?.openTaskId;
    if (!openTaskId || !q.rawTasks.length) return;
    navigate(location.pathname, { replace: true, state: {} });
    queueMicrotask(() => {
      if (pending.some((t) => t.id === openTaskId) || verified.some((t) => t.id === openTaskId)) {
        setOpenId(openTaskId);
        return;
      }
      const known = q.rawTasks.find((t) => t.id === openTaskId);
      if (known) setViewTask(known);
      else
        import("../../../services/tasks/taskQueryService.js").then(({ taskQueryService }) =>
          taskQueryService
            .getTaskById(openTaskId)
            .then((task) => task && setViewTask(task))
            .catch((err) => toast.error(err.message || "Could not open that task.")),
        );
    });
  }, [location.state, location.pathname, q.rawTasks, pending, verified, navigate]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
  }, [queryClient]);

  const editTask = useMutation({ mutationFn: (payload) => taskService.updateTask(payload.id, payload), onSuccess: invalidate });
  const deleteTask = useMutation({ mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId), onSuccess: invalidate });

  const selected = items.filter((i) => selectedIds.includes(i.id));

  const unverify = async (ids, message = "Verification undone.") => {
    try {
      await taskService.bulkUnverifyTasks(ids, user.id);
      invalidate();
      toast.success(message);
    } catch (err) {
      toast.error(err.message || "Could not undo the verification.");
    }
  };

  const verify = async (ids, notes = "") => {
    try {
      await taskService.bulkVerifyTasks(ids, user.id, notes);
      invalidate();
      setSelectedIds([]);
      undoableSuccessToast(`${ids.length} task${ids.length === 1 ? "" : "s"} verified.`, "Undo", () => unverify(ids), 6000);
    } catch (err) {
      toast.error(err.message || "Verification failed.");
    }
  };

  if (q.isLoadingTasks) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center py-20 text-muted-foreground">
        <Spinner size="md" />
        <p className="mt-3 animate-pulse text-sm font-bold uppercase tracking-wider">Loading Verification Queue...</p>
      </div>
    );
  }

  const bulkEnabled = !!q.appSettings?.enable_bulk_approval;
  const isVerifiedView = view === "VERIFIED";

  return (
    <>
      <ApprovalCenterLayout queue="hr" counts={q.counts}>
        <ApprovalToolbar
          views={[
            { value: "ALL", label: "All Pending", icon: Layers, badge: pending.length || undefined },
            { value: "ACTIVE", label: "Active (<48h graded)", icon: Clock, badge: active.length || undefined },
            { value: "STALE", label: "Stale Backlog (≥48h graded)", icon: AlertTriangle, badge: stale.length || undefined },
            { value: "VERIFIED", label: "Recently Verified", icon: History, badge: verified.length || undefined },
            { value: "GROUP", label: "Group Tasks", icon: Users },
          ]}
          view={view}
          onViewChange={narrowing((v) => {
            setView(v);
            setEmployeeFilter("ALL");
          })}
          people={view === "GROUP" ? [] : people}
          person={employeeFilter}
          onPersonChange={narrowing(setEmployeeFilter)}
          search={searchQuery}
          onSearchChange={narrowing(setSearchQuery)}
          advancedOpen={showAdvanced}
          onAdvancedToggle={view === "GROUP" ? undefined : () => setShowAdvanced((s) => !s)}
        />

        {view === "GROUP" ? (
          <GroupTaskApprovalSection />
        ) : (
          <>
            {showAdvanced && (
              <div className="rounded-xl border border-border bg-card p-3">
                <TaskFilters
                  searchTerm={searchQuery}
                  setSearchTerm={narrowing(setSearchQuery)}
                  statusFilter={TASK_STATUS.COMPLETE}
                  setStatusFilter={() => {}}
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
                  isManagement={isHr || isSuperAdmin}
                  isHr={isHr}
                  hrViewMode="ALL"
                  disableDeptFilter={false}
                  uniqueDepts={uniqueDepts}
                  uniqueSubDepts={uniqueSubDepts}
                  uniqueEmployees={uniqueEmployees}
                  showStatusFilter
                  disableStatusFilter
                  sortBy={sortBy}
                  setSortBy={setSortBy}
                />
              </div>
            )}

            <ApprovalTable
              items={items}
              queueIcon={QUEUE.icon}
              onOpen={(item) => setOpenId(item.id)}
              selectable={bulkEnabled}
              selectedIds={selectedIds}
              onToggle={(id) => setSelectedIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
              onToggleAll={(on) => setSelectedIds(on ? items.map((i) => i.id) : [])}
              searchTerm={searchQuery}
              keyboard={!open && !viewTask}
              renderRowAction={(item) =>
                !item.done && (
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
                )
              }
              empty={
                view === "STALE"
                  ? { title: "No Stale Backlog!", description: "Every task graded more than 48 hours ago has been verified." }
                  : isVerifiedView
                    ? { title: "No Verified Tasks", description: "Tasks you sign off will appear here." }
                    : { title: "HR Queue is Clear!", description: "No tasks are awaiting HR verification right now." }
              }
            />
          </>
        )}
      </ApprovalCenterLayout>

      <SelectionBar count={selected.length} onClear={() => setSelectedIds([])}>
        {isVerifiedView ? (
          <Button variant="outline" size="sm" onClick={() => unverify(selected.map((i) => i.id)).then(() => setSelectedIds([]))}>
            Undo verification
          </Button>
        ) : (
          <Button size="sm" className={APPROVE_CLASS} onClick={() => setIsBulkVerifyOpen(true)}>
            Verify {selected.length}
          </Button>
        )}
      </SelectionBar>

      <ApprovalSheet
        item={open}
        queueLabel={QUEUE.label}
        queueIcon={QUEUE.icon}
        index={index}
        total={items.length}
        onStep={(d) => setOpenId(items[index + d]?.id ?? openId)}
        onClose={() => setOpenId(null)}
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
              setOpenId(next ? next.id : null);
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

      <BulkVerifyModal
        isOpen={isBulkVerifyOpen}
        onClose={() => setIsBulkVerifyOpen(false)}
        selectedCount={selected.length}
        onConfirm={({ notes }) => {
          setIsBulkVerifyOpen(false);
          verify(
            selected.map((i) => i.id),
            notes,
          );
        }}
        isSubmitting={editTask.isPending}
      />
    </>
  );
}

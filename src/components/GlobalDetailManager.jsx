import { useState, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../services/taskService";
import { groupTaskService } from "../services/groupTaskService";
import { employeeService } from "../services/employeeService";
import TaskDetails from "./TaskDetails";
import GroupTaskDetailModal from "../pages/group-tasks/_components/GroupTaskDetailModal";
import RateEmployeesModal from "../pages/group-tasks/_components/RateEmployeesModal";
import OpportunityDetailsModal from "./sor/OpportunityDetailsModal";
import OpportunityQuickView from "./sor/OpportunityQuickView";
import { opportunityService } from "../services/opportunityService";
import { useAuth } from "../context/AuthContext";
import PurchaseRequestModal from "./purchase-request/PurchaseRequestModal";
import toast from "react-hot-toast";
import { canManageGroupTasks } from "../utils/permissions";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useRecordParam } from "../hooks/useRecordParam";
import {
  RECORD_LINK_PARAM,
  RECORD_VIEW_PARAM,
  withRecord,
  NO_ACCESS_MESSAGE,
  itemToRecordKey,
  recordKeyToItem,
} from "../utils/recordLink";

export default function GlobalDetailManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  // The open record lives in the address (`?open=task:<id>`), so a copied link
  // reopens it and Back closes it. `view` (the tab an SOR opens on) isn't part
  // of the link; it rides along in state, matched to the record it was for.
  const { recordId } = useRecordParam(RECORD_LINK_PARAM);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  // A Purchase Request (#1019) is `?open=pr:<id>` with its tab in `&view=`. It
  // opens on top of whatever was open: that record's key rides in the history
  // entry's state (`under`), and the entry beneath is the record's own address,
  // so closing the request steps Back to it.
  const underKey = location.state?.under ?? null;
  const linkedItem = useMemo(() => recordKeyToItem(recordId), [recordId]);
  const requestId = linkedItem?.type === "PURCHASE_REQUEST" ? linkedItem.id : null;
  const requestView = requestId ? searchParams.get(RECORD_VIEW_PARAM) : null;
  // { id, type: 'TASK' | 'GROUP_TASK' | 'OPPORTUNITY' | 'OPPORTUNITY_QUICK_VIEW' }: the record behind a request when one is stacked.
  const activeItem = useMemo(() => {
    const linked = requestId ? recordKeyToItem(underKey) : linkedItem;
    // #1020: the SOR's tab is `&view=` in the address (it belongs to the request while one is stacked on top).
    const view = requestId ? null : searchParams.get(RECORD_VIEW_PARAM);
    return linked && view && linked.type === "OPPORTUNITY" ? { ...linked, view } : linked;
  }, [requestId, underKey, linkedItem, searchParams]);
  // Opening or closing in the app writes the address. A fresh open adds a
  // history entry; swapping one record for another replaces it.
  const setActiveItem = useCallback(
    (item) => {
      const key = itemToRecordKey(item);
      // The tab (`item.view`) rides in the address with the record; any other record's tab is dropped.
      const write = (replace) => setSearchParams((prev) => withRecord(prev, key, key ? (item.view ?? null) : null), { replace });
      if (!key) write(true);
      else if (key !== recordId) write(Boolean(recordId));
      else if (requestId || item.view !== (searchParams.get(RECORD_VIEW_PARAM) ?? undefined)) write(true);
    },
    [setSearchParams, searchParams, recordId, requestId],
  );
  // Moving between an SOR's tabs replaces the entry, so Back leaves the SOR rather than replaying tabs.
  const changeSorView = useCallback(
    (view) => setSearchParams((prev) => withRecord(prev, recordId, view), { replace: true }),
    [setSearchParams, recordId],
  );
  const [highlightIdOnClose, setHighlightIdOnClose] = useState(null);
  const [isRateOpen, setIsRateOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  // Quick View's Tasks section opens a Task stacked on top of it —
  // it's a drill-down, not a replacement, so closing the Task returns to
  // Quick View rather than to nothing.
  const [stackedTaskId, setStackedTaskId] = useState(null);
  // A Purchase Request (#309) always opens stacked: it never replaces an open
  // SOR/task (#310 opens it from the SOR), and closing it leaves the page, or
  // whatever was open underneath, exactly as it was.
  // Set by a mention notification: the request opens with its Chat ready to type in.
  const [purchaseRequestFocusChat, setPurchaseRequestFocusChat] = useState(false);
  // Counts every open, so a mention clicked while its request is already open still refreshes the Chat.
  const [purchaseRequestOpenCount, setPurchaseRequestOpenCount] = useState(0);

  const isSuperAdmin = user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const isHr = user?.is_hr === true || user?.isHr === true;
  const canManage = isHead || isSuperAdmin;

  useEffect(() => {
    const handleOpenDetails = (e) => {
      const { id, type, isNew, view, focusChat, tab, replace, dropParams } = e.detail;
      if (id && type === "PURCHASE_REQUEST") {
        const key = itemToRecordKey({ id, type });
        // The tab a notification names: "chat" or "items" (#850); a mention opens Chat; null leaves an open window as it is.
        const wantedTab = tab ?? (focusChat === true ? "chat" : null);
        setPurchaseRequestFocusChat(focusChat === true);
        setPurchaseRequestOpenCount((n) => n + 1);
        // Already open: swap in place. Over another record: push, remembering what is underneath.
        const stacked = recordId && recordId !== key && !requestId;
        setSearchParams(
          (prev) => {
            const next = withRecord(prev, key, wantedTab ?? (recordId === key ? prev.get(RECORD_VIEW_PARAM) : null));
            for (const name of dropParams ?? []) next.delete(name);
            return next;
          },
          { replace: replace === true || Boolean(requestId), state: stacked ? { under: recordId } : requestId ? location.state : null },
        );
      } else if (id && type) {
        // `view` names the tab an SOR opens on (the Costing Matrix page opens "pms"); absent, it opens on its Summary.
        setActiveItem(view ? { id, type, view } : { id, type });
        if (isNew) {
          setHighlightIdOnClose(id);
        }
      }
    };

    window.addEventListener("OPEN_ENTITY_DETAILS", handleOpenDetails);
    return () => window.removeEventListener("OPEN_ENTITY_DETAILS", handleOpenDetails);
  }, [setActiveItem, setSearchParams, recordId, requestId, location.state]);

  // Everyone needs the roster, not just managers: the detail modal feeds it to
  // the mention picker, and gating it on `canManage` left a normal employee
  // with an empty list and an `@` that silently matched nobody.
  useEffect(() => {
    if (activeItem?.type === "GROUP_TASK") {
      employeeService.getAllEmployees().then(setEmployees);
    }
  }, [activeItem?.type]);

  // 1. Task Fetching
  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: ["globalTask", activeItem?.id],
    queryFn: () => taskService.getTaskById(activeItem.id),
    enabled: activeItem?.type === "TASK" && !!activeItem?.id,
    staleTime: 0,
  });

  // 2. Group Task Fetching
  const { data: groupTaskData, isLoading: isLoadingGroupTask } = useQuery({
    queryKey: ["globalGroupTask", activeItem?.id],
    queryFn: () => groupTaskService.getGroupTaskById(activeItem.id),
    enabled: activeItem?.type === "GROUP_TASK" && !!activeItem?.id,
    staleTime: 0,
  });

  // 3. Opportunity Fetching
  // ADR 0021 / #297: a task link or notification is the one way a Stage
  // Participant or locked viewer reaches an SOR — the register and Board
  // never list one for them, since RLS already excludes them from
  // `sales_opportunities` there. `getOpportunityForModal` is what branches on
  // access level so this fetch doesn't just throw for them.
  const isOpportunityType =
    activeItem?.type === "OPPORTUNITY" || activeItem?.type === "OPPORTUNITY_QUICK_VIEW";

  const { data: opportunityData, isLoading: isLoadingOpportunity } = useQuery({
    queryKey: ["globalOpportunity", activeItem?.id],
    queryFn: () => opportunityService.getOpportunityForModal(activeItem.id),
    enabled: isOpportunityType && !!activeItem?.id,
    staleTime: 0,
  });

  // The Task stacked on top of Quick View — a separate fetch from the
  // primary `activeItem`, since both can be open at once.
  const { data: stackedTaskData } = useQuery({
    queryKey: ["globalTask", stackedTaskId],
    queryFn: () => taskService.getTaskById(stackedTaskId),
    enabled: !!stackedTaskId,
    staleTime: 0,
  });

  // #657: an old link to a task that was converted lands on the Group Task it became.
  useEffect(() => {
    if (activeItem?.type === "TASK" && taskData?.convertedToGroupTaskId) {
      setActiveItem({ id: taskData.convertedToGroupTaskId, type: "GROUP_TASK" });
    }
  }, [activeItem?.type, taskData?.convertedToGroupTaskId, setActiveItem]);

  // A link to a record the viewer can't read (or that is gone) says so, then
  // clears the address instead of leaving a blank window.
  const noAccess =
    (activeItem?.type === "TASK" && !isLoadingTask && !taskData) ||
    (activeItem?.type === "GROUP_TASK" && !isLoadingGroupTask && !groupTaskData);
  useEffect(() => {
    if (!noAccess) return;
    toast.error(NO_ACCESS_MESSAGE, { id: "record-no-access" });
    setSearchParams((prev) => withRecord(prev, null), { replace: true });
  }, [noAccess, setSearchParams]);

  useEffect(() => {
    if (activeItem) {
      if (activeItem.type === "TASK" && !isLoadingTask) {
        window.dispatchEvent(new CustomEvent("ENTITY_DETAILS_LOADED"));
      } else if (activeItem.type === "GROUP_TASK" && !isLoadingGroupTask) {
        window.dispatchEvent(new CustomEvent("ENTITY_DETAILS_LOADED"));
      } else if (isOpportunityType && !isLoadingOpportunity) {
        window.dispatchEvent(new CustomEvent("ENTITY_DETAILS_LOADED"));
      }
    }
  }, [activeItem, isLoadingTask, isLoadingGroupTask, isOpportunityType, isLoadingOpportunity]);

  // --- Task Mutations ---
  const editTaskMutation = useMutation({
    mutationFn: (updatedData) => taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      // No id: this also covers the Task stacked on top of Quick View, whose
      // cache entry keys off `stackedTaskId` rather than `activeItem.id`.
      queryClient.invalidateQueries({ queryKey: ["globalTask"] });
      queryClient.invalidateQueries({ queryKey: ["quickViewTasks"] });
      queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
      toast.success("Task updated.");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["quickViewTasks"] });
      queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
      // Deleting the stacked Task should only close the stack, not the Quick
      // View underneath it.
      if (variables.id === stackedTaskId) {
        setStackedTaskId(null);
      } else {
        setActiveItem(null);
      }
      toast.success("Task deleted.");
    },
  });

  // --- Group Task Mutations ---
  const invalidateGroup = () => {
    queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
    queryClient.invalidateQueries({ queryKey: ["globalGroupTask", activeItem?.id] });
    queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
  };

  const deleteGroupTaskMutation = useMutation({
    mutationFn: (id) => groupTaskService.cancelGroupTask(id, user?.id),
    onSuccess: () => {
      invalidateGroup();
      setActiveItem(null);
      toast.success("Group Task deleted.");
    },
  });

  const updateGroupTaskMutation = useMutation({
    mutationFn: (payload) => groupTaskService.updateGroupTask(activeItem.id, payload, user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Group Task updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const markDoneMutation = useMutation({
    mutationFn: (memberId) => groupTaskService.updateMemberStatus(memberId, "DONE", user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Task marked as done.");
    },
    onError: (err) => toast.error(err.message),
  });

  const revertDoneMutation = useMutation({
    mutationFn: (memberId) => groupTaskService.updateMemberStatus(memberId, "PENDING", user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Task reverted to pending.");
    },
    onError: (err) => toast.error(err.message),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload) => groupTaskService.addMemberToTask(activeItem.id, payload, user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Member added successfully!");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ memberId, payload }) => groupTaskService.updateMemberAssignment(memberId, activeItem.id, payload, user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Member task updated!");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) => groupTaskService.removeMemberFromTask(memberId, activeItem.id, user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Member removed from task.");
    },
    onError: (err) => toast.error(err.message),
  });

  // See the matching comment in pages/group-tasks/index.jsx: checklist ticks
  // go to the checklist column, gated to the assignee before DONE.
  const addMemberAttachmentMutation = useMutation({
    mutationFn: ({ memberId, url }) => groupTaskService.addMemberAttachment(memberId, url, user?.id),
    onSuccess: async () => {
      // Awaited so the modal's upload indicator stays up until the
      // attachment is actually visible in the refetched task.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["groupTasks"] }),
        queryClient.invalidateQueries({ queryKey: ["globalGroupTask", activeItem?.id] }),
      ]);
      toast.success("Attachment uploaded.");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMemberChecklistMutation = useMutation({
    mutationFn: ({ memberId, checklist }) =>
      groupTaskService.updateMemberChecklist(
        memberId,
        checklist,
        activeItem?.id,
        user?.id
      ),
    onSuccess: () => {
      invalidateGroup();
    },
  });

  const rateMutation = useMutation({
    mutationFn: (ratings) => groupTaskService.rateMembers(activeItem.id, ratings, user?.id),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Ratings submitted and task completed!");
      setIsRateOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.verifyGroupTask(id, user?.id, remarks),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Group Task verified!");
      setActiveItem(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }) => groupTaskService.rejectGroupTask(id, user?.id, remarks),
    onSuccess: () => {
      invalidateGroup();
      toast.success("Group Task rejected and sent back.");
      setActiveItem(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleClose = () => {
    if (highlightIdOnClose) {
      window.dispatchEvent(
        new CustomEvent("HIGHLIGHT_TASK", { detail: { id: highlightIdOnClose } })
      );
      setHighlightIdOnClose(null);
    }
    setActiveItem(null);
    setIsRateOpen(false);
    setStackedTaskId(null);
  };

  // Closing the request steps Back to the record under it. `leaving` (Open SOR) is
  // about to navigate elsewhere, and a request opened by its own link has nothing
  // under it: both just drop the request from the address.
  const closeRequest = ({ leaving = false } = {}) => {
    // #310: an SOR behind the request re-reads its card and item statuses.
    queryClient.invalidateQueries({ queryKey: ["sor-purchase-request"] });
    queryClient.invalidateQueries({ queryKey: ["sorModalTab"] });
    if (underKey && !leaving) navigate(-1);
    else setSearchParams((prev) => withRecord(prev, null), { replace: true });
  };
  // The Members / Chat toggle is the request's tab in the address; a toggle replaces, so Back doesn't replay tabs.
  const changeRequestPanel = (panel) => {
    const nextView = panel === "chat" ? "chat" : null;
    setPurchaseRequestFocusChat(false);
    setSearchParams((prev) => withRecord(prev, itemToRecordKey({ id: requestId, type: "PURCHASE_REQUEST" }), nextView), {
      replace: true,
      state: location.state,
    });
  };

  if (!activeItem && !requestId) return null;

  return (
    <>
      {requestId && (
        <PurchaseRequestModal
          requestId={requestId}
          focusChat={purchaseRequestFocusChat}
          tab={requestView}
          openCount={purchaseRequestOpenCount}
          onPanelChange={changeRequestPanel}
          onClose={closeRequest}
        />
      )}

      {/* TASK MODAL */}
      {activeItem?.type === "TASK" && (
        <TaskDetails
          isOpen={true}
          onClose={handleClose}
          task={taskData}
          onUpdateTask={(updated) => editTaskMutation.mutateAsync(updated)}
          onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
        />
      )}

      {/* GROUP TASK MODAL */}
      {activeItem?.type === "GROUP_TASK" && (
        <>
          <GroupTaskDetailModal
            isOpen={true}
            onClose={handleClose}
            task={groupTaskData}
            currentUserId={user?.id}
            isSuperAdmin={isSuperAdmin}
            isHr={isHr}
            canManage={canManageGroupTasks({ isHead, isHr, isSuperAdmin })}
            employees={employees}
            onMarkDone={(memberId) => markDoneMutation.mutate(memberId)}
            onRevertDone={(memberId) => revertDoneMutation.mutate(memberId)}
            onAddAttachment={(memberId, url) => addMemberAttachmentMutation.mutateAsync({ memberId, url })}
            isUploadingAttachment={addMemberAttachmentMutation.isPending}
            onOpenRateModal={() => setIsRateOpen(true)}
            onDelete={() => deleteGroupTaskMutation.mutate(activeItem.id)}
            onAddMember={(payload) => addMemberMutation.mutateAsync(payload)}
            onUpdateMember={(memberId, payload) => updateMemberMutation.mutateAsync({ memberId, payload })}
            onRemoveMember={(memberId) => removeMemberMutation.mutateAsync(memberId)}
            onInlineCheck={(memberId, checklist) => updateMemberChecklistMutation.mutateAsync({ memberId, checklist })}
            onVerify={() => verifyMutation.mutate({ id: activeItem.id, remarks: "" })}
            onReject={(remarks) => rejectMutation.mutate({ id: activeItem.id, remarks })}
            onUpdateTask={(payload) => updateGroupTaskMutation.mutateAsync(payload)}
            isUpdatingTask={updateGroupTaskMutation.isPending}
            isMarkingDone={markDoneMutation.isPending}
            isReverting={revertDoneMutation.isPending}
            isDeleting={deleteGroupTaskMutation.isPending}
            isAddingMember={addMemberMutation.isPending}
            isUpdatingMember={updateMemberMutation.isPending}
            isRemovingMember={removeMemberMutation.isPending}
            isVerifying={verifyMutation.isPending}
            isRejecting={rejectMutation.isPending}
          />

          {groupTaskData && canManage && (
            <RateEmployeesModal
              isOpen={isRateOpen}
              onClose={() => setIsRateOpen(false)}
              task={groupTaskData}
              onSubmit={(ratings) => rateMutation.mutateAsync(ratings)}
              isSubmitting={rateMutation.isPending}
            />
          )}
        </>
      )}

      {/* OPPORTUNITY MODAL */}
      {activeItem?.type === "OPPORTUNITY" && opportunityData && (
        <OpportunityDetailsModal
          isOpen={true}
          onClose={handleClose}
          opportunity={opportunityData.opportunity}
          opportunityId={activeItem?.id}
          accessLevel={opportunityData.accessLevel}
          lockedSummary={opportunityData.lockedSummary}
          initialView={activeItem?.view}
          onViewChange={changeSorView}
        />
      )}

      {/* QUICK VIEW — the landing spot for a task-originated link into an SOR.
          Locked access has no Tasks/Conditions of its own left to act
          on (its window is closed), so it keeps the existing trimmed summary
          dialog instead of a Quick View with nothing in it. */}
      {activeItem?.type === "OPPORTUNITY_QUICK_VIEW" &&
        opportunityData &&
        // Locked and no-access both land on the modal's own preview: there is
        // no Quick View work to show either of them (#474).
        (opportunityData.accessLevel === "locked" || opportunityData.accessLevel === "none" ? (
          <OpportunityDetailsModal
            isOpen={true}
            onClose={handleClose}
            opportunity={opportunityData.opportunity}
            opportunityId={activeItem?.id}
            accessLevel={opportunityData.accessLevel}
            lockedSummary={opportunityData.lockedSummary}
          />
        ) : (
          <OpportunityQuickView
            isOpen={true}
            onClose={handleClose}
            opportunity={opportunityData.opportunity}
            opportunityId={activeItem?.id}
            userId={user?.id}
            onViewFullDetails={() => setActiveItem({ id: activeItem.id, type: "OPPORTUNITY" })}
            onOpenTask={(taskId) => setStackedTaskId(taskId)}
            onOpenGroupTask={(groupTaskId) => setActiveItem({ id: groupTaskId, type: "GROUP_TASK" })}
          />
        ))}

      {/* TASK STACKED ON QUICK VIEW — a drill-down, so it renders alongside
          Quick View rather than replacing it. */}
      {stackedTaskId && activeItem && (
        <TaskDetails
          isOpen={true}
          onClose={() => setStackedTaskId(null)}
          task={stackedTaskData}
          onUpdateTask={(updated) => editTaskMutation.mutateAsync(updated)}
          onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
        />
      )}
    </>
  );
}

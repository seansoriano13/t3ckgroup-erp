import { useState, useEffect } from "react";
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
import Spinner from "@/components/ui/Spinner";

import GroupTaskCard from "./_components/GroupTaskCard";
import GroupTaskTableView from "./_components/GroupTaskTableView";
import CreateGroupTaskModal from "./_components/CreateGroupTaskModal";
import GroupTaskDetailModal from "./_components/GroupTaskDetailModal";
import RateEmployeesModal from "./_components/RateEmployeesModal";
import GroupTaskFilterBar from "../../components/GroupTaskFilterBar";
import { useGroupTaskFilters } from "../../hooks/useGroupTaskFilters";
import { useSavedFilters } from "../../hooks/useSavedFilters";
import { useMemo } from "react";

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
  const isHr = user?.is_hr === true || user?.isHr === true;
  const canManage = isHead || isSuperAdmin;

  // --- Data Fetching ---
  const { data: groupTasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ["groupTasks", user?.id],
    queryFn: () =>
      groupTaskService.getGroupTasks(user?.id, isHead, isSuperAdmin),
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

  const [selectedTaskId, setSelectedTaskId] = useState(null);
  const selectedTask = useMemo(() => {
    return groupTasks.find((t) => t.id === selectedTaskId) || null;
  }, [groupTasks, selectedTaskId]);

  const [isRateOpen, setIsRateOpen] = useState(false);

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

  const markDoneMutation = useMutation({
    mutationFn: (memberId) =>
      groupTaskService.updateMemberStatus(memberId, "DONE", user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Task marked as done.");
      // If the selected task was auto-completed, let's close or refresh it
      setSelectedTaskId(null);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const updateTaskMutation = useMutation({
    mutationFn: (payload) => groupTaskService.updateGroupTask(selectedTask.id, payload, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task updated.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const addMemberAttachmentMutation = useMutation({
    mutationFn: ({ memberId, url }) =>
      groupTaskService.addMemberAttachment(memberId, url, user.id),
    onSuccess: async () => {
      // Awaited so the caller's "uploading" indicator stays up until the
      // refetched task actually carries the new attachment — otherwise the
      // button clears before the list re-renders and it looks like the
      // upload vanished.
      await queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Attachment uploaded.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const revertDoneMutation = useMutation({
    mutationFn: (memberId) =>
      groupTaskService.updateMemberStatus(memberId, "PENDING", user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Task reverted to pending.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const rateMutation = useMutation({
    mutationFn: (ratings) =>
      groupTaskService.rateMembers(selectedTask.id, ratings, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Ratings submitted and task completed.");
      setIsRateOpen(false);
      setSelectedTaskId(null);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => groupTaskService.cancelGroupTask(id, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task deleted.");
      setSelectedTaskId(null);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload) =>
      groupTaskService.addMemberToTask(selectedTask.id, payload, user.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Member added.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ memberId, payload }) =>
      groupTaskService.updateMemberAssignment(
        memberId,
        selectedTask.id,
        payload,
        user.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Member task updated.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) =>
      groupTaskService.removeMemberFromTask(
        memberId,
        selectedTask.id,
        user.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Member removed from task.");
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  // Ticking a checklist item writes the checklist column, not
  // task_description — the two are separate fields now. The service refuses
  // the write unless the actor is the assignee and the assignment is not yet
  // marked DONE.
  const updateMemberChecklistMutation = useMutation({
    mutationFn: ({ memberId, checklist }) =>
      groupTaskService.updateMemberChecklist(
        memberId,
        checklist,
        selectedTask?.id,
        user?.id,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, remarks }) =>
      groupTaskService.verifyGroupTask(id, user.id, remarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task verified.");
      setSelectedTaskId(null);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }) =>
      groupTaskService.rejectGroupTask(id, user.id, remarks),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["groupTasks"] });
      toast.success("Group Task rejected and sent back.");
      setSelectedTaskId(null);
    },
    onError: (err) => toast.error(err.message || "Could not save that change. Try again."),
  });

  if (isError) return <QueryError className="m-6" title="Group tasks could not be loaded." onRetry={refetch} />;

  if (isLoading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-muted-foreground h-[60vh]">
        <Spinner size="md" />
        <p className="font-bold animate-pulse tracking-wider uppercase text-sm">
          Loading Group Tasks...
        </p>
      </div>
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
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus size={16} className="mr-1.5" />
            Create Group Task
          </Button>
        </>
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
            searchTerm={searchTerm}
            onView={(task) => setSelectedTaskId(task.id)}
            currentUserId={user?.id}
            isSuperAdmin={isSuperAdmin}
          />
        </div>
      ) : (
        /* GRID */
        filteredTasks.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredTasks.map((task) => (
              <GroupTaskCard
                key={task.id}
                task={task}
                currentUserId={user?.id}
                isSuperAdmin={isSuperAdmin}
                onView={() => setSelectedTaskId(task.id)}
                searchTerm={searchTerm}
                // demoProgress={index === 0 ? demoProgress : undefined}
              />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No Group Tasks Found"
            description={
              searchTerm
                ? "Try adjusting your search criteria."
                : "There are no active group tasks at the moment."
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

      <GroupTaskDetailModal
        isOpen={!!selectedTaskId}
        onClose={() => setSelectedTaskId(null)}
        task={selectedTask}
        currentUserId={user?.id}
        isSuperAdmin={isSuperAdmin}
        isHr={isHr}
        employees={employees}
        onMarkDone={(memberId) => markDoneMutation.mutate(memberId)}
        onRevertDone={(memberId) => revertDoneMutation.mutate(memberId)}

        onAddAttachment={(memberId, url) => addMemberAttachmentMutation.mutateAsync({ memberId, url })}
        onOpenRateModal={() => setIsRateOpen(true)}
        onDelete={() => deleteMutation.mutate(selectedTaskId)}
        onAddMember={(payload) => addMemberMutation.mutateAsync(payload)}
        onUpdateMember={(memberId, payload) =>
          updateMemberMutation.mutateAsync({ memberId, payload })
        }
        onRemoveMember={(memberId) =>
          removeMemberMutation.mutateAsync(memberId)
        }
        onInlineCheck={(memberId, checklist) =>
          updateMemberChecklistMutation.mutate({ memberId, checklist })
        }
        onVerify={() =>
          verifyMutation.mutate({ id: selectedTaskId, remarks: "" })
        }
        onReject={(remarks) =>
          rejectMutation.mutate({ id: selectedTaskId, remarks })
        }
        onUpdateTask={(payload) => updateTaskMutation.mutateAsync(payload)}
        isUpdatingTask={updateTaskMutation.isPending}
        isMarkingDone={markDoneMutation.isPending}
        isReverting={revertDoneMutation.isPending}

        isUploadingAttachment={addMemberAttachmentMutation.isPending}
        isDeleting={deleteMutation.isPending}
        isAddingMember={addMemberMutation.isPending}
        isUpdatingMember={updateMemberMutation.isPending}
        isRemovingMember={removeMemberMutation.isPending}
        isVerifying={verifyMutation.isPending}
        isRejecting={rejectMutation.isPending}
        searchTerm={searchTerm}
      />


      {selectedTaskId && (canManage || selectedTask?.created_by === user?.id) && (
        <RateEmployeesModal
          isOpen={isRateOpen}
          onClose={() => setIsRateOpen(false)}
          task={selectedTask}
          onSubmit={(ratings) => rateMutation.mutateAsync(ratings)}
          isSubmitting={rateMutation.isPending}
        />
      )}
    </PageShell>
  );
}

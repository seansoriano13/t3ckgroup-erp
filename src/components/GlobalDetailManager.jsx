import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { taskService } from "../services/taskService";
import { committeeTaskService } from "../services/committeeTaskService";
import { employeeService } from "../services/employeeService";
import TaskDetails from "./TaskDetails";
import CommitteeTaskDetailModal from "../pages/committee/components/CommitteeTaskDetailModal";
import RateEmployeesModal from "../pages/committee/components/RateEmployeesModal";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function GlobalDetailManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [activeItem, setActiveItem] = useState(null); // { id, type: 'TASK' | 'COMMITTEE_TASK' }
  const [isRateOpen, setIsRateOpen] = useState(false);
  const [employees, setEmployees] = useState([]);

  const isSuperAdmin = user?.is_super_admin === true || user?.isSuperAdmin === true;
  const isHead = user?.is_head === true || user?.isHead === true;
  const isHr = user?.is_hr === true || user?.isHr === true;
  const canManage = isHead || isSuperAdmin;

  useEffect(() => {
    const handleOpenDetails = (e) => {
      const { id, type } = e.detail;
      if (id && type) {
        setActiveItem({ id, type });
      }
    };

    window.addEventListener("OPEN_ENTITY_DETAILS", handleOpenDetails);
    return () => window.removeEventListener("OPEN_ENTITY_DETAILS", handleOpenDetails);
  }, []);

  // Fetch employees for committee task management (add member, etc.)
  useEffect(() => {
    if (canManage && activeItem?.type === "COMMITTEE_TASK") {
      employeeService.getAllEmployees().then(setEmployees);
    }
  }, [canManage, activeItem?.type]);

  // 1. Task Fetching
  const { data: taskData, isLoading: isLoadingTask } = useQuery({
    queryKey: ["globalTask", activeItem?.id],
    queryFn: () => taskService.getTaskById(activeItem.id),
    enabled: activeItem?.type === "TASK" && !!activeItem?.id,
    staleTime: 0,
  });

  // 2. Committee Task Fetching
  const { data: committeeTaskData, isLoading: isLoadingCommitteeTask } = useQuery({
    queryKey: ["globalCommitteeTask", activeItem?.id],
    queryFn: () => committeeTaskService.getCommitteeTaskById(activeItem.id),
    enabled: activeItem?.type === "COMMITTEE_TASK" && !!activeItem?.id,
    staleTime: 0,
  });

  useEffect(() => {
    if (activeItem) {
      if (activeItem.type === "TASK" && !isLoadingTask) {
        window.dispatchEvent(new CustomEvent("ENTITY_DETAILS_LOADED"));
      } else if (activeItem.type === "COMMITTEE_TASK" && !isLoadingCommitteeTask) {
        window.dispatchEvent(new CustomEvent("ENTITY_DETAILS_LOADED"));
      }
    }
  }, [activeItem, isLoadingTask, isLoadingCommitteeTask]);

  // --- Task Mutations ---
  const editTaskMutation = useMutation({
    mutationFn: (updatedData) => taskService.updateTask(updatedData.id, updatedData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] });
      queryClient.invalidateQueries({ queryKey: ["globalTask", activeItem?.id] });
      queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
      toast.success("Task updated.");
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: ({ id, userId }) => taskService.deleteTask(id, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
      setActiveItem(null);
      toast.success("Task deleted.");
    },
  });

  // --- Committee Task Mutations ---
  const invalidateCommittee = () => {
    queryClient.invalidateQueries({ queryKey: ["committeeTasks"] });
    queryClient.invalidateQueries({ queryKey: ["globalCommitteeTask", activeItem?.id] });
    queryClient.invalidateQueries({ queryKey: ["superAdminActivityLog"] });
  };

  const deleteCommitteeTaskMutation = useMutation({
    mutationFn: (id) => committeeTaskService.cancelCommitteeTask(id, user?.id),
    onSuccess: () => {
      invalidateCommittee();
      setActiveItem(null);
      toast.success("Committee Task deleted.");
    },
  });

  const markDoneMutation = useMutation({
    mutationFn: (memberId) => committeeTaskService.updateMemberStatus(memberId, "DONE", user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Task marked as done!");
    },
    onError: (err) => toast.error(err.message),
  });

  const revertDoneMutation = useMutation({
    mutationFn: (memberId) => committeeTaskService.updateMemberStatus(memberId, "PENDING", user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Task reverted to pending.");
    },
    onError: (err) => toast.error(err.message),
  });

  const addMemberMutation = useMutation({
    mutationFn: (payload) => committeeTaskService.addMemberToTask(activeItem.id, payload, user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Member added successfully!");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMemberMutation = useMutation({
    mutationFn: ({ memberId, payload }) => committeeTaskService.updateMemberAssignment(memberId, activeItem.id, payload, user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Member task updated!");
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (memberId) => committeeTaskService.removeMemberFromTask(memberId, activeItem.id, user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Member removed from task.");
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMemberTaskDescMutation = useMutation({
    mutationFn: ({ memberId, description }) =>
      committeeTaskService.updateMemberTaskDescription(
        memberId,
        description,
        activeItem?.id,
        user?.id
      ),
    onSuccess: () => {
      invalidateCommittee();
    },
    onError: (err) => toast.error(err.message),
  });

  const rateMutation = useMutation({
    mutationFn: (ratings) => committeeTaskService.rateMembers(activeItem.id, ratings, user?.id),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Ratings submitted and task completed!");
      setIsRateOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const verifyMutation = useMutation({
    mutationFn: ({ id, remarks }) => committeeTaskService.verifyCommitteeTask(id, user?.id, remarks),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Committee Task verified!");
      setActiveItem(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, remarks }) => committeeTaskService.rejectCommitteeTask(id, user?.id, remarks),
    onSuccess: () => {
      invalidateCommittee();
      toast.success("Committee Task rejected and sent back.");
      setActiveItem(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const handleClose = () => {
    setActiveItem(null);
    setIsRateOpen(false);
  };

  if (!activeItem) return null;

  return (
    <>
      {/* TASK MODAL */}
      {activeItem.type === "TASK" && (
        <TaskDetails
          isOpen={true}
          onClose={handleClose}
          task={taskData}
          onUpdateTask={(updated) => editTaskMutation.mutateAsync(updated)}
          onDeleteTask={(payload) => deleteTaskMutation.mutateAsync(payload)}
        />
      )}

      {/* COMMITTEE TASK MODAL */}
      {activeItem.type === "COMMITTEE_TASK" && (
        <>
          <CommitteeTaskDetailModal
            isOpen={true}
            onClose={handleClose}
            task={committeeTaskData}
            currentUserId={user?.id}
            isSuperAdmin={isSuperAdmin}
            isHr={isHr}
            employees={employees}
            onMarkDone={(memberId) => markDoneMutation.mutate(memberId)}
            onRevertDone={(memberId) => revertDoneMutation.mutate(memberId)}
            onOpenRateModal={() => setIsRateOpen(true)}
            onDelete={() => deleteCommitteeTaskMutation.mutate(activeItem.id)}
            onAddMember={(payload) => addMemberMutation.mutateAsync(payload)}
            onUpdateMember={(memberId, payload) => updateMemberMutation.mutateAsync({ memberId, payload })}
            onRemoveMember={(memberId) => removeMemberMutation.mutateAsync(memberId)}
            onInlineCheck={(memberId, description) => updateMemberTaskDescMutation.mutate({ memberId, description })}
            onVerify={() => verifyMutation.mutate({ id: activeItem.id, remarks: "" })}
            onReject={(remarks) => rejectMutation.mutate({ id: activeItem.id, remarks })}
            isMarkingDone={markDoneMutation.isPending}
            isReverting={revertDoneMutation.isPending}
            isDeleting={deleteCommitteeTaskMutation.isPending}
            isAddingMember={addMemberMutation.isPending}
            isUpdatingMember={updateMemberMutation.isPending}
            isRemovingMember={removeMemberMutation.isPending}
            isVerifying={verifyMutation.isPending}
            isRejecting={rejectMutation.isPending}
          />

          {committeeTaskData && canManage && (
            <RateEmployeesModal
              isOpen={isRateOpen}
              onClose={() => setIsRateOpen(false)}
              task={committeeTaskData}
              onSubmit={(ratings) => rateMutation.mutateAsync(ratings)}
              isSubmitting={rateMutation.isPending}
            />
          )}
        </>
      )}
    </>
  );
}

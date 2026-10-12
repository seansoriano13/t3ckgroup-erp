import { useState, useEffect, useRef } from "react"
import { useAuth } from "../context/AuthContext"
import { useTaskTopology } from "../hooks/useTaskTopology"
import TaskHeader from "./TaskHeader"
import ManagementSection from "./ManagementSection"
import StandardDetailsSection from "./StandardDetailsSection"
import TaskBodySection from "./TaskBodySection"
import TaskMetaDetails from "./TaskMetaDetails"
import TaskEvaluationSection from "./TaskEvaluationSection"
import TaskActivityTimeline from "./TaskActivityTimeline"
import { formatDate, toLocalDatetimeString } from "../utils/formatDate"
import { parseChecklist } from "../utils/checklist"
import {
  extractOthersDetailsFromRemarks,
  isCategoryMetadataRemarks,
} from "../utils/taskFormatters"
import { PencilLine, AlertTriangle, Columns2 } from "lucide-react"
import TaskFooter from "./TaskFooter.jsx"
import ReadOnlyTaskBanner from "./ReadOnlyTaskBanner"
import { isTaskClosedOff } from "../constants/journey"
import { TASK_STATUS } from "../constants/status.js"
import { useQuery } from "@tanstack/react-query"
import { toast } from "react-hot-toast"
import { confirmDeleteToast } from "./ui/CustomToast"
import { activeChatService } from "../services/tasks/activeChatService"
import { taskQueryService } from "@/services/tasks/taskQueryService"
import { Dialog } from "@/components/ui/dialog"
import { RecordModalContent } from "@/components/ui/record-modal"
import { useAppSettings } from "@/hooks/useAppSettings"
import { cn } from "@/lib/utils"
import { Button } from "./ui/button"

export default function TaskDetails({
  isOpen,
  onClose,
  task,
  onUpdateTask,
  onDeleteTask,
  searchTerm,
}) {
  const { user } = useAuth()
  const [isEditing, setIsEditing] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSplitScreen, setIsSplitScreen] = useState(() => {
    if (typeof window !== "undefined") {
      return window.innerWidth >= 1024
    }
    return false
  })

  const { settings: appSettings } = useAppSettings()

  const [approvalGrade, setApprovalGrade] = useState(null)
  const [editGrade, setEditGrade] = useState(null)
  const [approvalRemarks, setApprovalRemarks] = useState("")
  const [showChecklist, setShowChecklist] = useState(false)

  // 🔥 FULL TASK FETCH: Fetch complete details ONLY when drawer is open
  // This allows the main Dashboard/Task list to be lightweight (no attachments/large remarks)
  const { data: fullTask } = useQuery({
    queryKey: ["taskDetails", task?.id],
    queryFn: () => taskQueryService.getTaskById(task.id),
    enabled: isOpen && !!task?.id,
    staleTime: 1000 * 60, // Consider fresh for 1 min
  })

  const activeTask = fullTask || task // Fallback to prop while loading

  // Timeline message ref — used by the approval flow to grab the message
  // from the timeline input box when the head clicks Approve/Reject
  const timelineMessageRef = useRef("")
  // const modalRef = useRef(null)

  const [formData, setFormData] = useState({
    department: "",
    subDepartment: "",
    loggedById: "",
    categoryId: "",
    priority: "LOW",
    status: "INCOMPLETE",
    startAt: "",
    endAt: "",
    projectTitle: "",
    taskDescription: "",
    checklist: null,
    grade: 0,
    remarks: "",
    attachments: [],
    paymentVoucher: "",
  })
  const [initialFormData, setInitialFormData] = useState(null)

  // Pre-hydrate the form data immediately when the modal opens or fullTask loads
  useEffect(() => {
    if (isOpen && activeTask) {
      if (user?.id) {
        activeChatService.markAsRead(user.id, "TASK", activeTask.id)
      }

      const taskDept =
        activeTask.creator?.department ||
        activeTask.employees?.department ||
        activeTask.department ||
        ""
      const taskSubDept =
        activeTask.creator?.sub_department ||
        activeTask.employees?.sub_department ||
        activeTask.sub_department ||
        ""

        queueMicrotask(() => {
          setApprovalGrade(null)
          setEditGrade(activeTask?.grade ? Number(activeTask.grade) : null)
          setApprovalRemarks("")
          timelineMessageRef.current = ""

          // Determine if we should show the checklist section
          setShowChecklist(!!activeTask.checklist)

          const newFormData = {
            department: taskDept || user?.department || "",
            subDepartment:
              taskSubDept || user?.sub_department || user?.subDepartment || "",
            loggedById: activeTask.loggedById || "",
            categoryId: activeTask.categoryId || "",
            priority: activeTask.priority || "LOW",
            status: activeTask.status || "INCOMPLETE",
            startAt: activeTask.startAt
              ? toLocalDatetimeString(activeTask.startAt)
              : "",
            endAt: activeTask.endAt
              ? toLocalDatetimeString(activeTask.endAt)
              : "",
            projectTitle: activeTask.projectTitle || "",
            taskDescription: activeTask.taskDescription || "",
            checklist: activeTask.checklist || null,
            grade: activeTask.grade || 0,
            remarks: activeTask.remarks || "",
            attachments: activeTask.attachments || [],
            paymentVoucher: activeTask.paymentVoucher || "",
          }
          setFormData(newFormData)
          setInitialFormData(newFormData)
        })
    }
  }, [isOpen, activeTask, user])

  // Role Checks
  const isHr =
    user?.is_hr === true ||
    user?.isHr === true ||
    user?.is_super_admin === true ||
    user?.isSuperAdmin === true
  const isHead = user?.is_head === true || user?.isHead === true
  const isManagement = isHr || isHead
  const isSuperAdmin =
    user?.is_super_admin === true || user?.isSuperAdmin === true

  // A task on hold or cancelled is a frozen record: it opens for reading
  // (including its chat) but nothing on it can move — no edits, no
  // approve/reject/verify, no delete. See issue #396.
  // Closed-off individual tasks are stored DELETED with a cancel_reason
  // (tasks.status has no CANCELLED), so the reason is what marks them.
  const isClosedOff = isTaskClosedOff(task)
  const isReadOnly =
    task?.status === TASK_STATUS.ON_HOLD ||
    task?.status === TASK_STATUS.CANCELLED ||
    isClosedOff
  const canEvaluate = !isReadOnly && (isHead || isSuperAdmin)

  // Re-evaluation: head is editing a task already approved but not yet HR-verified.
  const canReEvalGrade =
    canEvaluate &&
    task?.status === TASK_STATUS.COMPLETE &&
    !task?.hrVerified &&
    isEditing

  // Custom Data Hook
  const topologyData = useTaskTopology(
    isOpen,
    formData,
    task?.categoryId,
    isEditing,
  )

  // Reset states when closed
  useEffect(() => {
    if (!isOpen) {
      const timer = setTimeout(() => {
        setIsEditing(false)
        setIsSubmitting(false)
        setIsSplitScreen(typeof window !== "undefined" && window.innerWidth >= 1024)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [isOpen])

  if (!task) return null

  const isDelayed =
    task?.status === TASK_STATUS.AWAITING_APPROVAL &&
    task?.createdAt &&
    (new Date() - new Date(task.createdAt)) / (1000 * 60 * 60) >= 48

  // Permissions & Handlers
  const isOwner = user?.id === task.loggedById
  const isHrRejected =
    task.status === TASK_STATUS.NOT_APPROVED && (task.grade ?? 0) > 0
  const canEdit =
    !isReadOnly &&
    (isHr ||
      isHead ||
      (isOwner &&
        task.status !== TASK_STATUS.COMPLETE &&
        task.status !== TASK_STATUS.AWAITING_APPROVAL))

  // Checklist detection — now uses the dedicated checklist field
  let hasChecklist = false
  let hasUncheckedItems = false
  const checklistItems = parseChecklist(formData.checklist)
  if (checklistItems.length > 0) {
    hasChecklist = true
    hasUncheckedItems = checklistItems.some(
      (item) => item && typeof item === "object" && !item.checked,
    )
  }

  const taskDept = formData.department || user?.department
  const taskSubDept =
    formData.subDepartment || user?.sub_department || user?.subDepartment
  const isMarketing =
    taskSubDept?.toUpperCase() === "MARKETING" ||
    taskDept?.toUpperCase() === "MARKETING" ||
    task?.categoryDesc?.toUpperCase()?.includes("MARKETING")

  const selectedCategoryObj = topologyData?.filteredCategories?.find(
    (c) => c.category_id === formData.categoryId,
  )
  const isOthersGlobal =
    selectedCategoryObj?.category_id?.toUpperCase().includes("OTHERS") ||
    selectedCategoryObj?.description?.toUpperCase().includes("OTHERS")

  // An Individual Task has no title of its own (CONTEXT.md): its Project /
  // Campaign Title stands in, then its Category.
  const categoryLabel =
    extractOthersDetailsFromRemarks(task?.remarks) ||
    topologyData?.filteredCategories?.find(
      (c) => c.category_id === task?.categoryId,
    )?.description ||
    activeTask?.categoryDesc ||
    "Unknown Category"
  const taskTitle =
    formData.projectTitle?.trim() ||
    (task?.categoryId ? categoryLabel : "Task Details")

  const isComplete = task.status === TASK_STATUS.COMPLETE

  const isNotApproved = task.status === TASK_STATUS.NOT_APPROVED
  const isFinalized = isComplete || isNotApproved
  const timelineLegacyRemarks = isCategoryMetadataRemarks(task?.remarks)
    ? ""
    : task?.remarks

  const handleToggleEdit = () => {
    if (isReadOnly) return
    setIsEditing(true)
  }

  const handleChange = (e) =>
    setFormData({ ...formData, [e.target.name]: e.target.value })
  const handleDeptChange = (e) =>
    setFormData({
      ...formData,
      department: e.target.value,
      subDepartment: "",
      loggedById: "",
      categoryId: "",
    })
  const handleSubDeptChange = (e) =>
    setFormData({
      ...formData,
      subDepartment: e.target.value,
      loggedById: "",
      categoryId: "",
    })
  const handleAssigneeChange = (e) =>
    setFormData({ ...formData, loggedById: e.target.value, categoryId: "" })

  const executeUpdate = async (payload, silent = false) => {
    // Belt-and-braces: every mutation flows through here, so a held/cancelled
    // task cannot change even if some control slipped past its own gating.
    if (isReadOnly) return
    if (!silent) setIsSubmitting(true)
    const toastId = !silent ? toast.loading("Processing...") : undefined
    try {
      await onUpdateTask(payload)
      if (!silent) {
        toast.success("Task updated!", { id: toastId })
        onClose()
      }
    } catch {
      if (!silent) {
        toast.error("Failed to process task", { id: toastId })
        setIsSubmitting(false)
      }
    }
  }

  const handleSaveEdit = () => {
    // eslint-disable-next-line no-unused-vars
    const { department, subDepartment, status, grade, ...dbPayload } = formData

    const payload = { id: task.id, ...dbPayload, editedBy: user.id }

    // If re-evaluating a COMPLETE, non-HR-verified task, include grade fields
    if (canReEvalGrade && editGrade !== null) {
      payload.grade = editGrade
      payload.evaluatedBy = user.id
      payload.status = TASK_STATUS.COMPLETE
    }

    executeUpdate(payload)
  }

  const handleApprove = () => {
    if (approvalGrade === null) {
      toast.error("Select a grade (1-5) before pressing Enter to approve")
      return
    }
    if (hasUncheckedItems) {
      toast.error("Checklist items must be complete before approval")
      return
    }
    executeUpdate({
      id: task.id,
      status: TASK_STATUS.COMPLETE,
      endAt: new Date().toISOString(),
      grade: approvalGrade,
      remarks: "",
      activityMessage: timelineMessageRef.current || "",
      evaluatedBy: user.id,
      editedBy: user.id,
      hrVerified: false,
      hrRemarks: "",
    })
  }

  const handleReject = () => {
    if (!timelineMessageRef.current) {
      toast.error("Remarks required to reject task in timeline")
      return
    }
    executeUpdate({
      id: task.id,
      status: TASK_STATUS.NOT_APPROVED,
      endAt: new Date().toISOString(),
      grade: 0,
      remarks: "",
      activityMessage: timelineMessageRef.current || "",
      evaluatedBy: user.id,
      editedBy: user.id,
      hrVerified: false,
      hrRemarks: "",
    })
  }

  const handleResubmit = () => {
    executeUpdate({
      id: task.id,
      status: TASK_STATUS.INCOMPLETE,
      editedBy: user.id,
    })
  }

  const handleVerify = () => {
    if (task.status !== TASK_STATUS.COMPLETE) {
      toast.error(
        "Security policy limits verification exclusively to fully COMPLETE entries.",
      )
      return
    }
    executeUpdate({
      id: task.id,
      status: TASK_STATUS.COMPLETE,
      hrVerified: true,
      hrVerifiedAt: new Date().toISOString(),
      editedBy: user.id,
      activityMessage: timelineMessageRef.current || "",
    })
  }

  const handleKeyDown = (e) => {
    if (!isOpen || isSubmitting || isEditing || isReadOnly) return

    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "SELECT"
    ) {
      if (e.key !== "Enter") return
    }

    // Ignore keyboard shortcuts if a modifier key is pressed (e.g. Ctrl+V for paste)
    if (e.ctrlKey || e.metaKey || e.altKey) return

    if (isFinalized || !canEvaluate) return

    if (!isHr) {
      const keyMap = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5 }
      if (
        keyMap[e.key] &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault()
        setApprovalGrade(keyMap[e.key])
      } else if (e.key === "Enter") {
        e.preventDefault()
        handleApprove()
      } else if (
        e.key.toLowerCase() === "x" &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault()
        handleReject()
      }
    } else {
      if (
        (e.key.toLowerCase() === "v" &&
          e.target.tagName !== "INPUT" &&
          e.target.tagName !== "TEXTAREA") ||
        (e.key === "Enter" &&
          e.target.tagName !== "INPUT" &&
          e.target.tagName !== "TEXTAREA")
      ) {
        e.preventDefault()
        handleVerify()
      } else if (
        e.key.toLowerCase() === "x" &&
        e.target.tagName !== "INPUT" &&
        e.target.tagName !== "TEXTAREA"
      ) {
        e.preventDefault()
        handleReject()
      }
    }
  }

  const handleDelete = () => {
    if (isReadOnly) return
    confirmDeleteToast(
      "Delete Task?",
      "This will permanently remove the task from all active queues and history.",
      async () => {
        setIsSubmitting(true)
        const loadingToast = toast.loading("Purging task from system...")
        try {
          await onDeleteTask({ id: task.id, userId: user.id })
          toast.success("Task deleted successfully.", { id: loadingToast })
          onClose()
        } catch {
          toast.error("Failed to delete task.", { id: loadingToast })
          setIsSubmitting(false)
        }
      },
    )
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <RecordModalContent
        showCloseButton={false}
        onKeyDown={handleKeyDown}
        className="z-[70] flex flex-col transition-all duration-300"
      >
        {/* CONTENT WRAPPER */}
        <div
          className={cn(
            "flex flex-1 overflow-hidden",
            isSplitScreen ? "flex-row" : "flex-col",
          )}
        >
          {/* TASK PANEL */}
          <div className="flex flex-col flex-1 overflow-hidden">
            <TaskHeader
              isEditing={isEditing}
              isHrVerified={task.hrVerified}
              title={taskTitle}
              status={isClosedOff ? TASK_STATUS.CANCELLED : task.status}
              onClose={onClose}
              onOpenChat={
                !isSplitScreen
                  ? () => {
                      window.dispatchEvent(
                        new CustomEvent("OPEN_CHAT_MODAL", {
                          detail: { entityId: task.id, entityType: "TASK" },
                        }),
                      )
                    }
                  : null
              }
              extraButtons={
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => {
                      setIsSplitScreen((prev) => !prev)
                    }}
                    title={
                      isSplitScreen
                        ? "Exit Split Screen"
                        : "Split Screen (Task + Chat)"
                    }
                    className={cn(
                      "h-9 w-9 rounded-xl transition-all active:scale-95",
                      isSplitScreen
                        ? "text-primary bg-primary/10 border-primary/20 hover:bg-primary/20"
                        : "text-muted-foreground border-transparent hover:bg-muted hover:border-border",
                    )}
                  >
                    <Columns2 size={16} />
                  </Button>
                </>
              }
            />

            <div className="p-6 flex-1 overflow-y-auto space-y-6 custom-scrollbar bg-card">
              {task.status === "DELETED" && !isClosedOff && (
                <div className="bg-destructive/5 border border-destructive/30 rounded-xl p-4 flex items-center gap-3 text-destructive shadow-sm mt-0 -mb-4">
                  <div className="bg-red-100 p-2 rounded-lg">
                    <AlertTriangle size={20} className="text-destructive" />
                  </div>
                  <div>
                    <p className="text-sm font-black uppercase tracking-tight">
                      Task Deleted
                    </p>
                    <p className="text-xs font-bold opacity-80">
                      This task has been soft-deleted and is hidden from regular
                      views.
                    </p>
                  </div>
                </div>
              )}

              {isReadOnly && (
                <ReadOnlyTaskBanner
                  held={task.status === TASK_STATUS.ON_HOLD}
                  heldAt={task.heldAt}
                  cancelReason={task.cancelReason}
                />
              )}

              <div className="space-y-4">
                {/* Who/what fields lead only while editing, where they are
                    controls. In view mode they sit last (TaskMetaDetails). */}
                {isEditing && (
                  <>
                    <ManagementSection
                      isEditing={isEditing}
                      isHr={isHr}
                      isHead={isHead}
                      task={task}
                      formData={formData}
                      taskLoggedByName={task.loggedByName}
                      reportedToName={task.reportedToName}
                      topologyData={topologyData}
                      handlers={{
                        handleDeptChange,
                        handleSubDeptChange,
                        handleAssigneeChange,
                      }}
                    />
                    <StandardDetailsSection
                      isEditing={isEditing}
                      isManagement={isManagement}
                      formData={formData}
                      handleChange={handleChange}
                      topologyData={topologyData}
                      task={task}
                    />
                  </>
                )}

                <TaskBodySection
                  isEditing={isEditing}
                  formData={formData}
                  handleChange={handleChange}
                  showChecklist={showChecklist}
                  setShowChecklist={setShowChecklist}
                  hasChecklist={hasChecklist}
                  isOthersGlobal={isOthersGlobal}
                  taskDept={taskDept}
                  isOwner={isOwner}
                  canEdit={canEdit}
                  searchTerm={searchTerm}
                  setFormData={setFormData}
                  executeUpdate={executeUpdate}
                  task={activeTask}
                  user={user}
                  onClose={onClose}
                />

                <TaskEvaluationSection
                  isEditing={isEditing}
                  canReEvalGrade={canReEvalGrade}
                  editGrade={editGrade}
                  setEditGrade={setEditGrade}
                  isComplete={isComplete}
                  isNotApproved={isNotApproved}
                  isFinalized={isFinalized}
                  canEvaluate={canEvaluate}
                  task={task}
                  activeTask={activeTask}
                  approvalGrade={approvalGrade}
                  setApprovalGrade={setApprovalGrade}
                  approvalRemarks={approvalRemarks}
                  setApprovalRemarks={setApprovalRemarks}
                  timelineMessageRef={timelineMessageRef}
                />

                {!isEditing && (
                  <TaskMetaDetails
                    task={task}
                    formData={formData}
                    categoryLabel={categoryLabel}
                  />
                )}

                {/* --- UNIFIED ACTIVITY TIMELINE --- */}
                {!isEditing && !isSplitScreen && (
                  <div className="pt-2 border-t border-border mt-2">
                    <TaskActivityTimeline
                      taskId={task.id}
                      legacyRemarks={timelineLegacyRemarks}
                      legacyHrRemarks={task.hrRemarks}
                      evaluatedByName={task.evaluatedByName}
                      grade={task.grade}
                      disabled={task.status === TASK_STATUS.DELETED}
                    />
                  </div>
                )}

                {!isEditing && task.editedById && (
                  <div className="pt-4 border-t border-border flex flex-col gap-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <p className="flex items-center gap-1.5">
                      <PencilLine size={12} /> Last Modified By{" "}
                      <span className="text-muted-foreground/80">
                        {task.editedByName}
                      </span>
                    </p>
                    <p>{formatDate(task.editedAt)}</p>
                  </div>
                )}

                {/* KEYBOARD SHORTCUTS HINT */}
                {!isFinalized && !isEditing && canEvaluate && (
                  <div className="pt-2 flex justify-center opacity-70 mb-4 pb-4">
                    <p className="text-[10px] text-muted-foreground font-bold tracking-widest uppercase flex items-center gap-2">
                      Shortcuts:
                      {!isHr ? (
                        <>
                          <span className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded border border-border">
                            1-5
                          </span>{" "}
                          Select Grade
                          <span className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                            Enter
                          </span>{" "}
                          Approve
                          <span className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                            X
                          </span>{" "}
                          Return
                        </>
                      ) : (
                        <>
                          <span className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded border border-border">
                            V / Enter
                          </span>{" "}
                          Verify
                          <span className="bg-muted/50 text-foreground px-1.5 py-0.5 rounded border border-border ml-2">
                            X
                          </span>{" "}
                          Return
                        </>
                      )}
                    </p>
                  </div>
                )}
              </div>
            </div>
            {/* end task scrollable content */}

            <TaskFooter
              actions={{
                onCancel: () => setIsEditing(false),
                onClose,
                onSave: handleSaveEdit,
                onToggleEdit: handleToggleEdit,
                onDelete: handleDelete,
                onHeadReject: handleReject,
                onSubmitApproval: () => {
                  const payload = {
                    id: task.id,
                    status: TASK_STATUS.AWAITING_APPROVAL,
                    editedBy: user.id,
                  }
                  if (isMarketing) {
                    payload.endAt = task.endAt || new Date().toISOString()
                  }
                  return executeUpdate(payload)
                },
                onMarkComplete: handleApprove,
                onUndoVerify: () =>
                  executeUpdate({
                    id: task.id,
                    status: TASK_STATUS.COMPLETE,
                    hrVerified: false,
                    hrRemarks: "",
                    editedBy: user.id,
                  }),

                onHrVerify: handleVerify,

                onSelfVerify: () =>
                  executeUpdate({
                    id: task.id,
                    status: TASK_STATUS.COMPLETE,
                    endAt: new Date().toISOString(),
                    grade: 3,
                    remarks: "Self-Verified (System Bypass)",
                    evaluatedBy: user.id,
                    editedBy: user.id,
                    hrVerified: false,
                    hrRemarks: "",
                  }),

                onRecallTask: () => {
                  setFormData((prev) => ({ ...prev, status: TASK_STATUS.INCOMPLETE, endAt: "" }))
                  return executeUpdate({
                    id: task.id,
                    status: TASK_STATUS.INCOMPLETE,
                    endAt: null,
                    editedBy: user.id,
                  })
                },

                onResubmit: handleResubmit,

                setTimelineMessage: (msg) => {
                  timelineMessageRef.current = msg
                },
              }}
              permissions={{
                canEdit,
                canEvaluate,
                isHr: isHr && !isReadOnly,
                isManagement: isManagement && !isReadOnly,
                isOwner,
              }}
              state={{
                isEditing,
                isSubmitting,
                task,
                formIsValid:
                  !isSubmitting &&
                  !topologyData.isLoadingTop &&
                  !(isManagement && !formData.loggedById) &&
                  !!formData.categoryId &&
                  (initialFormData
                    ? JSON.stringify(formData) !==
                        JSON.stringify(initialFormData) ||
                      (canReEvalGrade &&
                        editGrade !==
                          (activeTask?.grade
                            ? Number(activeTask.grade)
                            : null))
                    : false),
                canApprove: approvalGrade !== null && !hasUncheckedItems,
                isMarketing,
                universalTaskSubmission:
                  appSettings?.universal_task_submission === true,
                hasAttachments:
                  formData.attachments && formData.attachments.length > 0,
                hasUncheckedItems,
                isHrRejected,
                isDelayed,
                enableSelfVerification:
                  appSettings?.enable_self_verification === true,
                enableVisualShaming:
                  appSettings?.enable_visual_shaming === true,
              }}
            />
          </div>
          {/* end task panel */}

          {/* INLINE CHAT PANEL */}
          {isSplitScreen && (
            <TaskActivityTimeline
              taskId={task.id}
              legacyRemarks={timelineLegacyRemarks}
              legacyHrRemarks={task.hrRemarks}
              evaluatedByName={task.evaluatedByName}
              grade={task.grade}
              disabled={task.status === TASK_STATUS.DELETED}
              isSplitScreen={true}
            />
          )}
        </div>
      </RecordModalContent>
    </Dialog>
  )
}

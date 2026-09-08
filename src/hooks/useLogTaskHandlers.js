import { useState, useEffect, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { taskService } from "../services/taskService"
import { getCurrentLocalTime } from "../utils/formatDate"
import { hasChecklistContent } from "../utils/checklist"
import { resolveDepartmentHeads, resolveOrgWideHeads } from "../utils/resolveDepartmentHeads"

const DRAFT_KEY = "logTask_draft"

export function useLogTaskHandlers({
  isOpen,
  onClose,
  user,
  // categories,
  employees,
  availableHeads,
  roles,
  mode = "normal",
  onSubmitOverride,
  initialData = null,
}) {
  const queryClient = useQueryClient()
  const { isHr, isHead, isSuperAdmin } = roles

  // ── Form status ────────────────────────────────────────────
  const [formData, setFormData] = useState({
    loggedById: user?.id || "",
    categoryId: "",
    projectTitle: "",
    taskDescription: "",
    checklist: null,
    startAt: getCurrentLocalTime(),
    endAt: "",
    priority: "LOW",
    paymentVoucher: "",
    attachments: [],
  })

  const [selectedHead, setSelectedHead] = useState("")
  const [hrDeptFilter, setHrDeptFilter] = useState("")
  const [hrSubDeptFilter, setHrSubDeptFilter] = useState("")
  const [committeeRole, setCommitteeRole] = useState("")
  const [othersRemarks, setOthersRemarks] = useState("")
  const [showChecklist, setShowChecklist] = useState(false)
  const [openPopover, setOpenPopover] = useState(null)
  const [categorySearch, setCategorySearch] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [createMore, setCreateMore] = useState(false)

  // Track previous isOpen to only reset on false→true transition (not on refetches)
  const wasOpenRef = useRef(false)
  // Stable attachments ref – immune to React state resets (fixes tab-switch image loss)
  const attachmentsPersistRef = useRef([])
  const restoringAttachmentsRef = useRef(false)

  // Keep persist ref in sync with form state
  useEffect(() => {
    attachmentsPersistRef.current = formData.attachments || []
    restoringAttachmentsRef.current = false
  }, [formData.attachments])

  // Restore attachments if they were wiped by an unexpected re-render
  useEffect(() => {
    if (
      isOpen &&
      !restoringAttachmentsRef.current &&
      formData.attachments.length === 0 &&
      attachmentsPersistRef.current.length > 0
    ) {
      restoringAttachmentsRef.current = true
      queueMicrotask(() => {
        setFormData((prev) => ({
          ...prev,
          attachments: attachmentsPersistRef.current,
        }))
      })
    }
  })

  // ── Reset form when modal opens ───────────────────────────
  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current
    wasOpenRef.current = isOpen

    if (justOpened) {
      queueMicrotask(() => {
        if (initialData) {
          setFormData({
            loggedById: initialData.loggedById || user?.id || "",
            categoryId: initialData.categoryId || "",
            projectTitle: initialData.projectTitle || "",
            taskDescription: initialData.taskDescription || "",
            checklist: initialData.checklist || null,
            startAt: initialData.startAt || getCurrentLocalTime(),
            endAt: initialData.endAt || "",
            priority: initialData.priority || "LOW",
            paymentVoucher: initialData.paymentVoucher || "",
            attachments: initialData.attachments || [],
          })
          attachmentsPersistRef.current = initialData.attachments || []
          if (initialData.committeeRole)
            setCommitteeRole(initialData.committeeRole)
          if (initialData.othersRemarks)
            setOthersRemarks(initialData.othersRemarks)
          if (initialData.showChecklist)
            setShowChecklist(initialData.showChecklist)
          
          setHrDeptFilter(
            isHr && !isSuperAdmin ? user.department || "ADMIN" : "",
          )
          setHrSubDeptFilter(
            isHr && !isSuperAdmin
              ? user.sub_department || user.subDepartment || "HR"
              : "",
          )
          setOpenPopover(null)
          setCategorySearch("")
          setSelectedHead("")
          setIsExpanded(false)
          return
        }

        // Restore draft if one exists
        const savedDraft = (() => {
          try {
            const raw = localStorage.getItem(DRAFT_KEY)
            if (!raw) return null
            const parsed = JSON.parse(raw)
            // Only restore if it belongs to the current user
            if (parsed?.loggedById !== user?.id) return null
            return parsed
          } catch {
            return null
          }
        })()

        if (savedDraft) {
          const hasMeaningfulContent =
            savedDraft.projectTitle?.trim() ||
            (typeof savedDraft.taskDescription === "string" &&
              savedDraft.taskDescription?.trim()) ||
            savedDraft.categoryId ||
            savedDraft.attachments?.length > 0 ||
            hasChecklistContent(savedDraft.checklist)

          if (hasMeaningfulContent) {
            setFormData({
              loggedById: user?.id || "",
              categoryId: savedDraft.categoryId || "",
              projectTitle: savedDraft.projectTitle || "",
              taskDescription: savedDraft.taskDescription || "",
              checklist: savedDraft.checklist || null,
              startAt: getCurrentLocalTime(),
              endAt: savedDraft.endAt || "",
              priority: savedDraft.priority || "LOW",
              paymentVoucher: savedDraft.paymentVoucher || "",
              attachments: savedDraft.attachments || [],
            })
            attachmentsPersistRef.current = savedDraft.attachments || []
            if (savedDraft.committeeRole)
              setCommitteeRole(savedDraft.committeeRole)
            if (savedDraft.othersRemarks)
              setOthersRemarks(savedDraft.othersRemarks)
            if (savedDraft.showChecklist)
              setShowChecklist(savedDraft.showChecklist)
            localStorage.removeItem(DRAFT_KEY)
            toast("Draft restored", {
              duration: 3000,
            })
            setHrDeptFilter(
              isHr && !isSuperAdmin ? user.department || "ADMIN" : "",
            )
            setHrSubDeptFilter(
              isHr && !isSuperAdmin
                ? user.sub_department || user.subDepartment || "HR"
                : "",
            )
            setOpenPopover(null)
            setCategorySearch("")
            setSelectedHead("")
            setIsExpanded(false)
            return
          }
        }

        // No draft — fresh form
        attachmentsPersistRef.current = []
        setFormData({
          loggedById: user?.id || "",
          categoryId: "",
          projectTitle: "",
          taskDescription: "",
          checklist: null,
          startAt: getCurrentLocalTime(),
          endAt: "",
          priority: "LOW",
          paymentVoucher: "",
          attachments: [],
        })
        setCommitteeRole("")
        setOthersRemarks("")
        setShowChecklist(false)
        setOpenPopover(null)
        setCategorySearch("")
        setSelectedHead("")
        setIsExpanded(false)
        setHrDeptFilter(isHr && !isSuperAdmin ? user.department || "ADMIN" : "")
        setHrSubDeptFilter(
          isHr && !isSuperAdmin
            ? user.sub_department || user.subDepartment || "HR"
            : "",
        )
      })
    }
  }, [isOpen, user, isHr, isSuperAdmin])

  // ── Auto-select head when assignee changes ────────────────
  useEffect(() => {
    if (!formData.loggedById || !availableHeads.length) return
    if (isHead && !isHr && !isSuperAdmin) {
      queueMicrotask(() => setSelectedHead(user.id))
      return
    }

    const selectedEmployee = employees.find((e) => e.id === formData.loggedById)
    if (!selectedEmployee) return

    const directHeads = resolveDepartmentHeads(selectedEmployee, availableHeads)

    if (directHeads.length > 0) {
      queueMicrotask(() => setSelectedHead(directHeads[0].id))
    } else {
      const adminHeads = resolveOrgWideHeads(availableHeads)
      if (adminHeads.length > 0) {
        queueMicrotask(() => setSelectedHead(adminHeads[0].id))
      } else {
        queueMicrotask(() => setSelectedHead(""))
      }
    }
  }, [
    formData.loggedById,
    availableHeads,
    employees,
    isHead,
    isHr,
    isSuperAdmin,
    user.id,
  ])

  const addTaskMutation = useMutation({
    mutationFn: taskService.createTask,
    onMutate: async (newTask) => {
      await queryClient.cancelQueries({ queryKey: ["dashboardTasks"] })
      const previousTasks = queryClient.getQueryData(["dashboardTasks"])
      const optimisticTask = {
        id: `temp-${Date.now()}`,
        ...newTask,
        createdAt: new Date().toISOString(),
        status: "INCOMPLETE",
        loggedByName: user?.name,
        loggedById: user?.id,
      }
      queryClient.setQueryData(["dashboardTasks"], (old) =>
        old ? [optimisticTask, ...old] : [optimisticTask],
      )
      return { previousTasks }
    },
    onError: (error, _newTask, context) => {
      console.error("Failed to add task:", error)
      toast.error("Database error: Could not save task.")
      if (context?.previousTasks) {
        queryClient.setQueryData(["dashboardTasks"], context.previousTasks)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboardTasks"] })
      queryClient.invalidateQueries({ queryKey: ["tasks"] })
    },
    onSuccess: (data) => {
      toast.success("Task created successfully!")
      // Clear any saved draft — task was submitted successfully
      try {
        localStorage.removeItem(DRAFT_KEY)
      } catch {
        /* ignore */
      }
      if (createMore) {
        setFormData((prev) => ({
          ...prev,
          categoryId: "",
          projectTitle: "",
          taskDescription: "",
          checklist: null,
          startAt: getCurrentLocalTime(),
          endAt: "",
          priority: "LOW",
          paymentVoucher: "",
          attachments: [],
        }))
        setCommitteeRole("")
        setOthersRemarks("")
        setShowChecklist(false)
        setOpenPopover(null)
        setCategorySearch("")
      } else {
        onClose()
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("OPEN_ENTITY_DETAILS", {
              detail: { id: data.id, type: "TASK", isNew: true },
            })
          )
        }, 100)
      }
    },
  })

  const handleChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  const handleTogglePopover = (name) => {
    setOpenPopover((prev) => {
      if (prev === name) return null
      if (name === "category") setCategorySearch("")
      return name
    })
  }

  const handleSubmit = (e, { isCommittee, isOthersGlobal }) => {
    e.preventDefault()

    if (!formData.categoryId) {
      toast.error("Please select a Category before logging your task.")
      return
    }

    // An automation has no task description at configuration time — the
    // project title is the only name it carries, and actionTitle() reads
    // config.projectTitle to label it on the canvas and in StageActionManager.
    // A normal task has always let the title stay blank; requiring it there
    // too would block a submission this form has accepted for as long as it
    // has existed.
    if (mode === "automation" && !formData.projectTitle.trim()) {
      toast.error("Please enter a project title")
      return
    }

    // ── Normal Mode Validations ─────────────────────────────────
    if (mode !== "automation" && !formData.loggedById) {
      toast.error("Please assign the task to someone")
      return
    }

    // Validate: at least one of description or checklist must be filled
    const hasDescription = formData.taskDescription?.trim()
    const hasChecklist = hasChecklistContent(formData.checklist)
    if (mode !== "automation" && !hasDescription && !hasChecklist) {
      toast.error("Please add a description or checklist items.")
      return
    }

    let mergedRemarks = ""
    if (isCommittee) {
      if (!committeeRole) {
        toast.error("Please select a specific Committee Role.")
        return
      }
      mergedRemarks = `[COMMITTEE - ${committeeRole}]`
      if (committeeRole === "OTHERS") {
        if (!othersRemarks.trim()) {
          toast.error("Please specify details for 'Others'.")
          return
        }
        mergedRemarks += ` ${othersRemarks.trim()}`
      }
    } else if (isOthersGlobal) {
      if (!othersRemarks.trim()) {
        toast.error("Please specify details for your 'Others' task.")
        return
      }
      mergedRemarks = `[OTHERS] ${othersRemarks.trim()}`
    }

    const payload = {
      ...formData,
      endAt: mode === "automation" ? null : formData.endAt,
      isAutoVerified: false,
      remarks: mergedRemarks,
      paymentVoucher: formData.paymentVoucher?.trim() || null,
      submittedById: user.id,
      submittedByName: user.name,
      reportedTo: selectedHead || null,
    }

    if (mode === "automation") {
      if (onSubmitOverride) {
        onSubmitOverride(payload)
      }
      return
    }

    addTaskMutation.mutate(payload)
  }

  // ── Handle close with draft save ───────────────────────────
  const handleClose = () => {
    const hasMeaningfulContent =
      formData.projectTitle?.trim() ||
      (typeof formData.taskDescription === "string" &&
        formData.taskDescription?.trim()) ||
      formData.categoryId ||
      formData.attachments?.length > 0 ||
      hasChecklistContent(formData.checklist)

    if (hasMeaningfulContent) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            ...formData,
            committeeRole,
            othersRemarks,
            showChecklist,
          }),
        )
      } catch {
        // Storage might be full — fail silently
      }
      toast("Draft saved — your progress is safe!", {
        icon: "💾",
        duration: 3500,
      })
    }
    onClose()
  }

  return {
    formData,
    setFormData,
    selectedHead,
    setSelectedHead,
    committeeRole,
    setCommitteeRole,
    othersRemarks,
    setOthersRemarks,
    showChecklist,
    setShowChecklist,
    openPopover,
    setOpenPopover,
    categorySearch,
    setCategorySearch,
    createMore,
    setCreateMore,
    handleChange,
    handleTogglePopover,
    handleSubmit,
    handleClose,
    isSubmitting: addTaskMutation.isPending,
    hrDeptFilter,
    setHrDeptFilter,
    hrSubDeptFilter,
    setHrSubDeptFilter,
    isExpanded,
    setIsExpanded,
  }
}

import { useState, useEffect, useRef } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import toast from "react-hot-toast"
import { taskService } from "../services/taskService"
import { getCurrentLocalTime } from "../utils/formatDate"

const DRAFT_KEY = "logTask_draft"

export function useLogTaskHandlers({
  isOpen,
  onClose,
  user,
  // categories,
  employees,
  availableHeads,
  roles,
}) {
  const queryClient = useQueryClient()
  const { isHr, isHead, isSuperAdmin } = roles

  // ── Form status ────────────────────────────────────────────
  const [formData, setFormData] = useState({
    loggedById: user?.id || "",
    categoryId: "",
    projectTitle: "",
    taskDescription: "",
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
  const [descriptionType, setDescriptionType] = useState("description")
  const [openPopover, setOpenPopover] = useState(null)
  const [categorySearch, setCategorySearch] = useState("")
  const [isExpanded, setIsExpanded] = useState(false)
  const [createMore, setCreateMore] = useState(false)

  // Backup ref: preserves plain-text description when switching to Checklist tab
  const plainTextBackupRef = useRef("")
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
            savedDraft.attachments?.length > 0

          if (hasMeaningfulContent) {
            setFormData({
              loggedById: user?.id || "",
              categoryId: savedDraft.categoryId || "",
              projectTitle: savedDraft.projectTitle || "",
              taskDescription: savedDraft.taskDescription || "",
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
            if (savedDraft.descriptionType)
              setDescriptionType(savedDraft.descriptionType)
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
            plainTextBackupRef.current = ""
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
          startAt: getCurrentLocalTime(),
          endAt: "",
          priority: "LOW",
          paymentVoucher: "",
          attachments: [],
        })
        setCommitteeRole("")
        setOthersRemarks("")
        setDescriptionType("description")
        setOpenPopover(null)
        setCategorySearch("")
        setSelectedHead("")
        setIsExpanded(false)
        plainTextBackupRef.current = ""
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

    const empSubDept = selectedEmployee.sub_department
    const empDept = selectedEmployee.department

    const directHeads = availableHeads.filter((h) => {
      if (
        empSubDept &&
        h.sub_department &&
        h.sub_department.toUpperCase() !== "ALL"
      ) {
        return (
          h.sub_department.trim().toLowerCase() ===
          empSubDept.trim().toLowerCase()
        )
      }
      if (h.department?.toUpperCase() !== "SUPER ADMIN" && empDept) {
        return (
          h.department?.trim().toLowerCase() === empDept?.trim().toLowerCase()
        )
      }
      return false
    })

    if (directHeads.length > 0) {
      queueMicrotask(() => setSelectedHead(directHeads[0].id))
    } else {
      const adminHeads = availableHeads.filter(
        (h) =>
          h.is_super_admin ||
          h.sub_department?.trim().toUpperCase() === "ALL" ||
          h.department?.trim().toUpperCase() === "SUPER ADMIN",
      )
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
          startAt: getCurrentLocalTime(),
          endAt: "",
          priority: "LOW",
          paymentVoucher: "",
          attachments: [],
        }))
        setCommitteeRole("")
        setOthersRemarks("")
        setDescriptionType("description")
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

  /**
   * Switch between description/checklist tabs without losing data.
   * When going description → checklist: saves current text to backup ref.
   * When going checklist → description: restores backup ref into formData.
   */
  const handleDescriptionTypeChange = (newType) => {
    if (newType === "checklist") {
      // Save current plain text before switching to checklist
      const currentDesc = formData.taskDescription
      const isJson =
        typeof currentDesc === "string" &&
        (currentDesc.trim().startsWith("[") ||
          currentDesc.trim().startsWith("{"))
      if (!isJson) {
        plainTextBackupRef.current = currentDesc
      }
    } else if (newType === "description") {
      // Restore backed-up plain text when switching back
      setFormData((prev) => ({
        ...prev,
        taskDescription: plainTextBackupRef.current,
      }))
    }
    setDescriptionType(newType)
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
      isAutoVerified: false,
      remarks: mergedRemarks,
      paymentVoucher: formData.paymentVoucher?.trim() || null,
      submittedById: user.id,
      submittedByName: user.name,
      reportedTo: selectedHead || null,
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
      formData.attachments?.length > 0

    if (hasMeaningfulContent) {
      try {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({
            ...formData,
            committeeRole,
            othersRemarks,
            descriptionType,
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
    descriptionType,
    setDescriptionType,
    openPopover,
    setOpenPopover,
    categorySearch,
    setCategorySearch,
    createMore,
    setCreateMore,
    handleChange,
    handleDescriptionTypeChange,
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

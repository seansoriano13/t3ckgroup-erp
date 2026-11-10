import { useState, memo, useEffect, useRef } from "react"
import {
  Clock,
  CheckCircle2,
  TriangleAlert,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Circle,
} from "lucide-react"
import Dot from "./ui/Dot"
import { Button } from "./ui/button"
import { SorQuickLinkButton } from "./ui/SorQuickLinkButton"
import StatusBadge from "./StatusBadge"
import { useAuth } from "../context/AuthContext"
import { TASK_STATUS } from "../constants/status"
import Avatar from "./Avatar"
import { useEmployeeAvatarMap } from "../hooks/useEmployeeAvatarMap"
import HighlightText from "./HighlightText"
import {
  getChecklistProgress,
  parseChecklist,
  parseChecklistGroups,
} from "../utils/checklist"

const getRelativeTime = (dateString) => {
  if (!dateString) return ""
  const date = new Date(dateString)
  const now = new Date()
  const diffInSeconds = Math.floor((now - date) / 1000)

  if (diffInSeconds < 60) return "just now"

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) return `${diffInHours}h ago`

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 7) return `${diffInDays}d ago`

  const diffInWeeks = Math.floor(diffInDays / 7)
  if (diffInWeeks < 4) return `${diffInWeeks}w ago`

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

const TaskCard = memo(({ task, onView, onSilentUpdate, searchTerm }) => {
  const { user } = useAuth()
  const avatarMap = useEmployeeAvatarMap()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isHighlighted, setIsHighlighted] = useState(false)
  const cardRef = useRef(null)

  useEffect(() => {
    const handleHighlight = (e) => {
      if (e.detail.id === task.id) {
        setIsHighlighted(true)
        if (cardRef.current) {
          cardRef.current.scrollIntoView({ behavior: "smooth", block: "center" })
        }
        setTimeout(() => setIsHighlighted(false), 3000)
      }
    }
    window.addEventListener("HIGHLIGHT_TASK", handleHighlight)
    return () => window.removeEventListener("HIGHLIGHT_TASK", handleHighlight)
  }, [task.id])

  const isHr =
    user?.is_hr === true ||
    user?.isHr === true ||
    user?.is_super_admin === true ||
    user?.isSuperAdmin === true
  const isHead = user?.is_head === true || user?.isHead === true
  const isManagement = isHr || isHead

  const isOwner = user?.id === task.loggedById
  const canEdit =
    isHr ||
    isHead ||
    (isOwner &&
      task.status !== TASK_STATUS.COMPLETE &&
      task.status !== TASK_STATUS.AWAITING_APPROVAL)
  const isDisabled = !canEdit || !isOwner

  // Overdue nudge: INCOMPLETE task whose deadline has passed, shown only to owner
  const isOwnerOverdue =
    !isManagement &&
    task.status === TASK_STATUS.INCOMPLETE &&
    task.endAt &&
    new Date(task.endAt) < new Date() &&
    isOwner

  let isChecklistFormat = false
  let totalItems = 0
  let checkedItems = 0
  let parsedDesc = null
  let plainTextContent = ""
  let checklistProgress = null

  // 1. Check native checklist field
  if (task.checklist) {
    isChecklistFormat = true;
    checklistProgress = getChecklistProgress(task.checklist);
    totalItems = checklistProgress.total;
    checkedItems = checklistProgress.checked;
    parsedDesc = parseChecklist(task.checklist);

    if (typeof task.taskDescription === "string") {
      plainTextContent = task.taskDescription.trim();
    }
  } else if (task.taskDescription) {
    // 2. Fallback for legacy JSON strings
    const trimmed =
      typeof task.taskDescription === "string"
        ? task.taskDescription.trim()
        : ""
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        parsedDesc = JSON.parse(trimmed)
        if (Array.isArray(parsedDesc)) {
          isChecklistFormat = true
          checklistProgress = getChecklistProgress(parsedDesc)
          totalItems = checklistProgress.total
          checkedItems = checklistProgress.checked
          parsedDesc = parseChecklist(parsedDesc)
        } else {
          plainTextContent = trimmed;
        }
      } catch {
        plainTextContent = trimmed;
      }
    } else if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        parsedDesc = JSON.parse(trimmed)
        if (parsedDesc && Array.isArray(parsedDesc.items)) {
          isChecklistFormat = true
          checklistProgress = getChecklistProgress(parsedDesc)
          totalItems = checklistProgress.total
          checkedItems = checklistProgress.checked
          parsedDesc = parseChecklist(parsedDesc)
        } else {
          plainTextContent = trimmed;
        }
      } catch {
        plainTextContent = trimmed;
      }
    } else if (Array.isArray(task.taskDescription)) {
      isChecklistFormat = true
      checklistProgress = getChecklistProgress(task.taskDescription)
      totalItems = checklistProgress.total
      checkedItems = checklistProgress.checked
      parsedDesc = parseChecklist(task.taskDescription)
    } else {
      plainTextContent = trimmed;
    }
  }

  const handleInlineCheck = (newDesc) => {
    if (onSilentUpdate) {
      onSilentUpdate({
        id: task.id,
        checklist: newDesc,
        editedBy: user?.id,
      })
    }
  }

  const handleItemClick = (e, index) => {
    e.stopPropagation()
    if (!onSilentUpdate || isDisabled) return

    let newDesc
    if (task.checklist && checklistProgress?.isGrouped) {
      const groups = parseChecklistGroups(task.checklist);
      let count = 0;
      newDesc = groups.map((g) => ({
        ...g,
        items: g.items.map((item) => {
          const isTarget = count === index;
          count++;
          return isTarget ? { ...item, checked: !item.checked } : item;
        }),
      }));
    } else if (Array.isArray(parsedDesc)) {
      newDesc = parsedDesc.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item,
      )
    } else if (parsedDesc && Array.isArray(parsedDesc.items)) {
      newDesc = {
        ...parsedDesc,
        items: parsedDesc.items.map((item, i) =>
          i === index ? { ...item, checked: !item.checked } : item,
        ),
      }
    } else {
      return
    }

    const payloadDesc =
      typeof task.checklist === "string" || typeof task.taskDescription === "string"
        ? JSON.stringify(newDesc)
        : newDesc
    handleInlineCheck(payloadDesc)
  }

  let displayTitle = ""
  let displaySnippet = ""

  // For checklist format, gather actual items list
  const checklistItems = isChecklistFormat
    ? Array.isArray(parsedDesc)
      ? parsedDesc
      : parsedDesc?.items || []
    : []
  const checklistTitle = isChecklistFormat
    ? checklistProgress?.groups?.find((g) => g.title?.trim())?.title ||
      (typeof parsedDesc === "object" && !Array.isArray(parsedDesc) ? parsedDesc?.title : null)
    : null
  const previewItems = []
  const hiddenItems = checklistItems

  if (task.projectTitle) {
    displayTitle = task.projectTitle
    displaySnippet = plainTextContent
  } else if (plainTextContent) {
    const parts = plainTextContent.split("\n")
    displayTitle = parts[0] || checklistTitle || ""
    displaySnippet = parts.slice(1).join("\n").trim()
  } else if (checklistTitle) {
    displayTitle = checklistTitle
  }

  return (
    <div
      ref={cardRef}
      onClick={onView}
      className={`bg-card p-5 rounded-2xl border hover:shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:-translate-y-1 transition-all group flex flex-col h-full cursor-pointer relative ${
        isOwnerOverdue
          ? "border-amber-500/40 ring-1 ring-amber-500/20"
          : "border-border"
      } ${
        isHighlighted
          ? "ring-2 ring-mauve-8 bg-mauve-3/50 shadow-lg shadow-mauve-5/20 duration-200"
          : "ring-0 ring-transparent shadow-sm duration-[3000ms]"
      }`}
    >
      {/* Row 1: The Eyebrow (Context) */}
      <div className="flex justify-between items-center gap-3 mb-3">
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <div
            className="text-label text-muted-foreground uppercase tracking-widest font-semibold shrink min-w-0 truncate"
            title={
              task.categoryId ? task.categoryId.replace(" TASK", "") : "TASK"
            }
          >
            {task.categoryId ? task.categoryId.replace(" TASK", "") : "TASK"}
          </div>
          {task.createdAt && (
            <>
              <span className="text-mauve-7 text-[10px] shrink-0">•</span>
              <div
                className="text-[10px] text-muted-foreground font-medium tracking-wider whitespace-nowrap flex items-center gap-1 shrink-0"
                title={new Date(task.createdAt).toLocaleString()}
              >
                <Clock size={10} className="shrink-0" />
                {getRelativeTime(task.createdAt)}
              </div>
            </>
          )}
        </div>
        <div className="shrink-0 flex-center gap-2">
          <StatusBadge status={task.status} />

          {task.status === TASK_STATUS.COMPLETE && (
            <div
              className="flex items-center gap-1 shrink-0"
              title={
                task.hrVerified ? "Verified by HR" : "Pending HR Verification"
              }
            >
              {task.hrVerified ? (
                <CheckCircle2 size={12} className="text-green-9" />
              ) : (
                <Clock size={12} className="text-amber-9" />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Row 2: The Core (Action) */}
      <div className="flex-1">
        {/* Plain-text task title and snippet */}
        {(displayTitle || displaySnippet) && (
          <div className={isChecklistFormat && checklistItems.length > 0 ? "mb-3" : ""}>
            {displayTitle && (
              <h3 
                onClick={(e) => {
                  e.stopPropagation()
                  if (onView) onView(e)
                }}
                className="font-bold text-foreground truncate leading-snug group-hover:text-primary hover:underline cursor-pointer transition-colors"
              >
                <HighlightText text={displayTitle} search={searchTerm} />
              </h3>
            )}
            {displaySnippet && (
              <p
                className={`text-[13px] text-muted-foreground line-clamp-2 ${
                  displayTitle ? "mt-1" : ""
                }`}
              >
                <HighlightText text={displaySnippet} search={searchTerm} />
              </p>
            )}
          </div>
        )}

        {/* Checklist items */}
        {isChecklistFormat && checklistItems.length > 0 && (
          <div onClick={(e) => e.stopPropagation()}>
            {/* Always-visible first 2 items */}
            <div className="space-y-1.5">
              {previewItems.map((item, i) => (
                <div
                  key={i}
                  onClick={(e) => handleItemClick(e, i)}
                  className={`flex items-center gap-2.5 py-1.5 px-3 rounded-xl transition-all duration-300 border text-[12px] ${
                    isDisabled
                      ? "cursor-not-allowed"
                      : "cursor-pointer hover:opacity-80"
                  } ${
                    item.checked
                      ? "bg-muted/20 border-transparent"
                      : `bg-card shadow-sm border-border/40 ${isDisabled ? "" : "hover:border-mauve-8"}`
                  }`}
                >
                  {item.checked ? (
                    <div className="w-4 h-4 rounded-full bg-green-8 flex items-center justify-center shadow shadow-green-5 shrink-0">
                      <CheckCircle2
                        size={10}
                        className="text-primary-foreground"
                      />
                    </div>
                  ) : (
                    <div className="w-4 h-4 rounded-full border-2 border-mauve-5 bg-card shrink-0" />
                  )}
                  <span
                    className={`flex-1 min-w-0 font-medium leading-tight truncate ${
                      item.checked
                        ? "line-through text-muted-foreground"
                        : "text-foreground"
                    }`}
                  >
                    <HighlightText text={item.text} search={searchTerm} />
                  </span>
                </div>
              ))}
            </div>

            {/* Expandable remaining items */}
            {hiddenItems.length > 0 && (
              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{
                  maxHeight: isExpanded
                    ? `${hiddenItems.length * 44}px`
                    : "0px",
                  opacity: isExpanded ? 1 : 0,
                  marginTop: isExpanded ? "6px" : "0px",
                }}
              >
                <div className="space-y-1.5">
                  {hiddenItems.map((item, i) => (
                    <div
                      key={i + previewItems.length}
                      onClick={(e) => handleItemClick(e, i + previewItems.length)}
                      className={`flex items-center gap-2.5 py-1.5 px-3 rounded-xl transition-all duration-300 border text-[12px] ${
                        isDisabled
                          ? "cursor-not-allowed"
                          : "cursor-pointer hover:opacity-80"
                      } ${
                        item.checked
                          ? "bg-muted/20 border-transparent"
                          : `bg-card shadow-sm border-border/40 ${isDisabled ? "" : "hover:border-mauve-8"}`
                      }`}
                    >
                      {item.checked ? (
                        <div className="w-4 h-4 rounded-full bg-green-8 flex items-center justify-center shadow shadow-green-5 shrink-0">
                          <CheckCircle2
                            size={10}
                            className="text-primary-foreground"
                          />
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-mauve-5 bg-card shrink-0" />
                      )}
                      <span
                        className={`flex-1 min-w-0 font-medium leading-tight truncate ${
                          item.checked
                            ? "line-through text-muted-foreground"
                            : "text-foreground"
                        }`}
                      >
                        <HighlightText text={item.text} search={searchTerm} />
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* See more / See less button & Minimal Progress Indicator */}
            <div
              className={`flex items-center mt-3 gap-4 ${
                hiddenItems.length > 0 ? "justify-between" : "justify-end"
              }`}
            >
              {hiddenItems.length > 0 && (
                <Button
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation()
                    setIsExpanded(!isExpanded)
                  }}
                  className="h-auto p-0 flex items-center gap-1 text-label font-bold text-muted-foreground hover:text-foreground hover:bg-transparent transition-all duration-300 uppercase tracking-wider shrink-0"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp size={12} /> See less
                    </>
                  ) : (
                    <>
                      <ChevronDown size={12} /> {hiddenItems.length} {previewItems.length > 0 ? "more item" : "item"}{hiddenItems.length !== 1 ? "s" : ""}
                    </>
                  )}
                </Button>
              )}

              <div className="flex items-center gap-2 max-w-[170px]">
                <div className="w-16 h-1.5 rounded-full bg-mauve-3 overflow-hidden shrink-0">
                  <div
                    className="h-full rounded-full bg-green-8 transition-all duration-500"
                    style={{
                      width:
                        totalItems > 0
                          ? `${(checkedItems / totalItems) * 100}%`
                          : "0%",
                    }}
                  />
                </div>
                <span className="text-[10px] font-bold text-muted-foreground shrink-0 tabular-nums">
                  {checklistProgress?.isGrouped && checklistProgress.totalSteps > 1
                    ? `Step ${checklistProgress.activeStepIndex + 1}/${checklistProgress.totalSteps} · ${checkedItems}/${totalItems}`
                    : `${checkedItems}/${totalItems}`}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Row 3: The Footer (Metadata) */}
      <div className="mt-5 pt-4 flex items-center justify-between gap-2 overflow-hidden text-xs text-muted-foreground w-full border-t border-mauve-3">
        {/* Left side: SOR link -> Author -> Head */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <SorQuickLinkButton opportunityId={task.opportunityId} />

          {isManagement && task.loggedByName && (
            <div
              className="flex items-center gap-1.5 shrink-0"
              title={`Logged by ${task.loggedByName}`}
            >
              <Avatar
                name={task.loggedByName}
                src={avatarMap.get(task.loggedById) || task.loggedByAvatar}
                size="xs"
                className="shadow-inner bg-mauve-2 text-mauve-10 border-mauve-4"
              />
              <span className="truncate max-w-[70px] font-semibold text-foreground/80">
                {task.loggedByName}
              </span>
            </div>
          )}

          {isManagement && task.loggedByName && task.reportedToName && (
            <div className="text-mauve-12 mx-2 shrink-0">
              <ArrowRight size={12} />
            </div>
          )}

          {(!isManagement || !task.loggedByName) && task.reportedToName && (
            <span className="text-label text-muted-foreground uppercase tracking-widest font-semibold mr-1.5 shrink-0">
              To
            </span>
          )}

          {task.reportedToName && (
            <div
              className="flex items-center gap-1.5 shrink-0"
              title={`Reported to ${task.reportedToName}`}
            >
              <Avatar
                name={task.reportedToName}
                src={avatarMap.get(task.reportedTo) || task.reportedToAvatar}
                size="xs"
                className="shadow-inner bg-mauve-2 text-mauve-10 border-mauve-4"
              />
              <span className="truncate max-w-[70px] font-semibold text-foreground/80">
                {task.reportedToName}
              </span>
            </div>
          )}
        </div>

        {/* Right side: HR Status & Priority */}
        <div className="ml-auto flex items-center gap-3 shrink-0">
          {task.priority && (
            <div className="flex items-center gap-1.5 shrink-0 font-bold text-label uppercase tracking-wider">
              {task.priority === "HIGH" && (
                <Dot
                  color="bg-destructive"
                  className="shadow-[0_0_8px_rgba(239,68,68,0.4)]"
                />
              )}
              {task.priority === "MEDIUM" && (
                <Dot
                  color="bg-amber-10 "
                  className="shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                />
              )}
              {task.priority === "LOW" && <Dot />}
              <span
                className={
                  task.priority === "HIGH"
                    ? "text-destructive"
                    : task.priority === "MEDIUM"
                      ? "text-amber-10"
                      : "text-muted-foreground"
                }
              >
                {task.priority}
              </span>
            </div>
          )}
        </div>
      </div>
      {/* Overdue nudge strip — only for the task owner */}
      {isOwnerOverdue && (
        <div className="mt-4 -mx-5 -mb-5 px-4 py-2.5 bg-amber-500/10 border-t border-amber-500/25 rounded-b-2xl flex items-center gap-2">
          <TriangleAlert size={12} className="text-amber-500 shrink-0" />
          <span className="text-label font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
            Overdue — mark as done to submit for review
          </span>
        </div>
      )}
    </div>
  )
})

export default TaskCard

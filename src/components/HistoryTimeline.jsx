import { useMemo } from "react"
import {
  Zap,
  Edit3,
  PlusCircle,
  CheckCircle2,
  Star,
  Clock,
  X,
  User,
  ChevronRight,
} from "lucide-react"
import Avatar from "./Avatar"
import ChecklistTaskRenderer from "./ChecklistTaskRenderer"
import { cn } from "@/lib/utils"
import { ExternalLink } from "@/components/ui/ExternalLink";
import { Image } from "@/components/ui/Image";

const formatTime = (isoString) => {
  if (!isoString) return ""
  const d = new Date(isoString)
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

const isIsoDateString = (val) => {
  if (typeof val !== "string") return false
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(val) && !isNaN(Date.parse(val))
  )
}

const displayValue = (val) => {
  if (val === null || val === undefined) return "None"
  const str = String(val)
  if (isIsoDateString(str)) {
    return new Date(str).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
  }
  return str
}

/**
 * Standardized History Item Renderer
 */
function HistoryItem({ log, type = "TASK" }) {
  // Extract common fields based on source type
  let action = ""
  let details = null
  let actorName = "System"
  let actorAvatar = null
  let createdAt = ""
  let icon = Zap
  let colorClass = "bg-blue-3 text-blue-10 border-blue-6"

  if (type === "TASK") {
    action = log.type === "SYSTEM" ? log.metadata?.event || "SYSTEM" : log.type
    details = log.metadata
    actorName = log.authorName || "System"
    actorAvatar = log.authorAvatar
    createdAt = log.createdAt
  } else if (type === "GROUP") {
    action = log.action
    details = log.details
    actorName = log.actor?.name || "System"
    actorAvatar = log.actor?.avatar_path
    createdAt = log.created_at
  } else if (type === "QUOTA") {
    action = log.action
    details = { old: log.old_amount, new: log.new_amount }
    actorName = log.changed_by_employee?.name || "System"
    actorAvatar = log.changed_by_employee?.avatar_path
    createdAt = log.created_at
  }

  // Icon and Color mapping
  const actionLower = action.toLowerCase()
  if (actionLower.includes("created") || actionLower.includes("added")) {
    icon = PlusCircle
    colorClass = "bg-green-100 text-green-10 border-green-200"
  } else if (
    actionLower.includes("complete") ||
    actionLower.includes("verified") ||
    actionLower.includes("done")
  ) {
    icon = CheckCircle2
    colorClass = "bg-violet-3 text-violet-10 border-violet-6/30"
  } else if (
    actionLower.includes("reject") ||
    actionLower.includes("deleted") ||
    actionLower.includes("removed")
  ) {
    icon = X
    colorClass = "bg-destructive/10 text-destructive border-destructive/30"
  } else if (actionLower.includes("rate") || actionLower.includes("approve")) {
    icon = Star
    colorClass = "bg-amber-3 text-amber-10 border-amber-6"
  } else if (actionLower.includes("edit") || actionLower.includes("update")) {
    icon = Edit3
    colorClass = "bg-blue-3 text-blue-10 border-blue-6"
  }

  const Icon = icon

  // Diff rendering logic
  const renderDiff = () => {
    if (!details) return null

    // Checklist Diff (Special Case)
    const isChecklist = (val) => {
      if (typeof val !== "string") return false
      const trimmed = val.trim()
      return trimmed.startsWith("[") && trimmed.endsWith("]")
    }

    if (
      details.field === "task_description" &&
      (isChecklist(details.old) || isChecklist(details.new))
    ) {
      return (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 px-1">
                Before
              </span>
              <div className="p-3 rounded-xl border border-border bg-muted/30 opacity-60 scale-[0.98] origin-top">
                <ChecklistTaskRenderer
                  description={details.old}
                  disabled={true}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-9 px-1">
                After
              </span>
              <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/10 shadow-sm">
                <ChecklistTaskRenderer
                  description={details.new}
                  disabled={true}
                />
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Attachments Diff
    if (
      details.field === "attachments" &&
      Array.isArray(details.old) &&
      Array.isArray(details.new)
    ) {
      return (
        <div className="mt-3 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground/60 px-1">
                Before
              </span>
              <div className="p-3 rounded-xl border border-border bg-muted/30">
                {details.old.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No attachments
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {details.old.map((url, i) => (
                      <ExternalLink
                        key={i}
                        href={url}
                        
                        
                        className="block w-12 h-12 rounded-md overflow-hidden border border-border hover:opacity-80 transition-opacity no-underline"
                      >
                        <Image
                          src={url}
                          alt={`Attachment ${i}`}
                          className="w-full h-full object-cover"
                        />
                      </ExternalLink>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-widest text-blue-9 px-1">
                After
              </span>
              <div className="p-3 rounded-xl border border-blue-500/20 bg-blue-50/30 dark:bg-blue-950/10 shadow-sm">
                {details.new.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No attachments
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {details.new.map((url, i) => (
                      <ExternalLink
                        key={i}
                        href={url}
                        
                        
                        className="block w-12 h-12 rounded-md overflow-hidden border border-blue-500/30 hover:opacity-80 transition-opacity no-underline"
                      >
                        <Image
                          src={url}
                          alt={`Attachment ${i}`}
                          className="w-full h-full object-cover"
                        />
                      </ExternalLink>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )
    }

    // Standard Before/After Diff
    if (
      details.old !== undefined &&
      details.new !== undefined &&
      details.old !== details.new
    ) {
      return (
        <div className="mt-3 flex items-center gap-3 bg-muted/30 p-3 rounded-lg border border-border/50 overflow-hidden">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1">
              Before
            </p>
            <p className="text-xs text-muted-foreground line-through truncate">
              {displayValue(details.old)}
            </p>
          </div>
          <ChevronRight
            size={14}
            className="text-muted-foreground/40 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-blue-9 uppercase tracking-widest mb-1">
              After
            </p>
            <p className="text-xs text-foreground font-bold truncate">
              {displayValue(details.new)}
            </p>
          </div>
        </div>
      )
    }

    // Ratings (Group Task)
    if (details.ratings && Array.isArray(details.ratings)) {
      return (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
            Evaluations
          </p>
          <div className="flex flex-col gap-1.5 pl-3 border-l-2 border-primary/20">
            {details.ratings.map((r, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-3 bg-muted/30 px-2.5 py-1.5 rounded-md border border-border/50"
              >
                <span className="text-xs text-foreground font-medium">
                  {r.memberName || "Member"}
                </span>
                <span className="font-bold text-primary shrink-0 bg-primary/10 px-2 py-0.5 rounded text-[10px]">
                  {r.grade} / 5
                </span>
              </div>
            ))}
          </div>
        </div>
      )
    }

    // Members (Group Task)
    if (details.members && Array.isArray(details.members)) {
      return (
        <div className="mt-3 space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">
            Member Updates
          </p>
          <div className="flex flex-wrap gap-1.5">
            {details.members.map((m, idx) => (
              <span
                key={idx}
                className="text-[10px] font-bold bg-muted px-2 py-0.5 rounded-full border border-border"
              >
                {m.name || m.employee_id}
              </span>
            ))}
          </div>
        </div>
      )
    }

    // Single value display (e.g. remarks, role)
    const singleFields = [
      "remarks",
      "role",
      "taskDescription",
      "task_description",
      "grade",
    ]
    for (const field of singleFields) {
      if (details[field]) {
        const val = details[field]
        if (
          (field === "taskDescription" || field === "task_description") &&
          isChecklist(val)
        ) {
          return (
            <div className="mt-2 bg-muted/30 p-3 rounded-xl border border-border/50">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 px-1">
                Task Assignment
              </p>
              <ChecklistTaskRenderer description={val} disabled={true} />
            </div>
          )
        }
        return (
          <div className="mt-2 bg-muted/30 p-2.5 rounded-lg border border-border/50 text-xs text-muted-foreground">
            <strong className="text-foreground capitalize">{field}:</strong>{" "}
            {val}
          </div>
        )
      }
    }

    return null
  }

  return (
    <div className="relative flex items-start gap-4 group">
      {/* Icon Pillar */}
      <div className="flex flex-col items-center shrink-0">
        <div
          className={cn(
            "w-8 h-8 rounded-full border-2 flex items-center justify-center shadow-sm z-10 bg-card transition-transform group-hover:scale-110",
            colorClass,
          )}
        >
          <Icon size={14} />
        </div>
        <div className="w-0.5 flex-1 bg-border/50 group-last:bg-transparent -mt-2 h-full min-h-[40px]" />
      </div>

      {/* Content Box */}
      <div className="flex-1 pb-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border border-current/20",
                colorClass,
              )}
            >
              {action.replace(/_/g, " ")}
            </span>
            <time className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
              {formatTime(createdAt)}
            </time>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-4 shadow-sm hover:shadow-md transition-all">
          <div className="flex items-center gap-2 mb-3">
            <Avatar name={actorName} src={actorAvatar} size="xs" />
            <span className="text-xs font-bold text-foreground">
              {actorName}
            </span>
          </div>

          <p className="text-sm text-muted-foreground leading-relaxed">
            {log.content || (type === "GROUP" ? "" : "")}
          </p>

          {renderDiff()}
        </div>
      </div>
    </div>
  )
}

/**
 * Main HistoryTimeline Component
 */
export default function HistoryTimeline({
  logs = [],
  isLoading = false,
  type = "TASK",
  emptyMessage = "No history available.",
}) {
  const consolidatedLogs = useMemo(() => {
    if (type !== "TASK" || !Array.isArray(logs)) return logs

    const consolidated = []
    for (let i = 0; i < logs.length; i++) {
      const current = logs[i]
      const next = logs[i + 1]

      // Since logs are typically ORDERED BY created_at DESC (Newest First):
      const isSameTask = next && current.taskId === next.taskId

      // 1. Task submitted & Reported to:
      const isReportedSubmit =
        next &&
        current.content?.startsWith("Reported to:") &&
        next.content?.startsWith("Task submitted")

      // 2. HR_NOTE and SYSTEM verified redundancy
      const isHrRedundant =
        isSameTask &&
        ((current.type === "SYSTEM" &&
          next.type === "HR_NOTE" &&
          current.content?.toLowerCase().includes("verified") &&
          next.content?.toLowerCase().includes("verified")) ||
          (current.type === "HR_NOTE" &&
            next.type === "SYSTEM" &&
            next.content?.toLowerCase().includes("verified") &&
            current.content?.toLowerCase().includes("verified")))

      // 3. APPROVAL and SYSTEM redundancy (bulk approve/reject)
      const isApprovalRedundant =
        isSameTask &&
        ((current.type === "SYSTEM" &&
          next.type === "APPROVAL" &&
          (current.content?.includes("bulk-approved") ||
            current.content?.includes("bulk-rejected"))) ||
          (current.type === "APPROVAL" &&
            next.type === "SYSTEM" &&
            (next.content?.includes("bulk-approved") ||
              next.content?.includes("bulk-rejected"))))
      if (isReportedSubmit) {
        consolidated.push({
          ...next,
          content: `${next.content} ${current.content}`,
        })
        i++ // Skip next
      } else if (isHrRedundant) {
        // Keep the HR_NOTE
        consolidated.push(current.type === "HR_NOTE" ? current : next)
        i++
      } else if (isApprovalRedundant) {
        // Keep the APPROVAL
        consolidated.push(current.type === "APPROVAL" ? current : next)
        i++
      } else {
        consolidated.push(current)
      }
    }
    return consolidated
  }, [logs, type])

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-4 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-3">
              <div className="h-4 bg-muted rounded w-1/4" />
              <div className="h-20 bg-muted rounded-xl w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-12 h-12 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-3">
          <Clock size={24} className="text-muted-foreground/40" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-0 px-1 pt-4">
      {consolidatedLogs.map((log, idx) => (
        <HistoryItem key={log.id || idx} log={log} type={type} />
      ))}
    </div>
  )
}

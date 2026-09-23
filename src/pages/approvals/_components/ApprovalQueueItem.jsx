import {
  CheckSquare,
  Square,
  MessageSquareCheck,
  CheckCircle2,
  ListChecks,
  Clock,
  ChevronRight,
} from "lucide-react";
import Avatar from "../../../components/Avatar";
import { Button } from "@/components/ui/button";
import { useEmployeeAvatarMap } from "../../../hooks/useEmployeeAvatarMap";
import HighlightText from "../../../components/HighlightText";
import { formatDate } from "../../../utils/formatDate.js";
import { formatTaskPreview } from "../../../utils/taskFormatters";
import {
  STALE_AFTER_HOURS,
  checklistProgressLabel,
  isChecklistDescription,
  isStaleTask,
} from "../../../utils/approvalQueue.js";

export function ApprovalQueueItem({
  task,
  isActive,
  onSelect,
  isSelected,
  onToggleSelection,
  enableBulkSelection = true,
  searchTerm = "",
  isReplied = false,
  isVerifiedTab = false,
}) {
  const avatarMap = useEmployeeAvatarMap();

  const isDelayed = isStaleTask(task);
  const isChecklist = isChecklistDescription(task?.taskDescription);
  const checklistCount = checklistProgressLabel(task?.taskDescription);

  return (
    <div
      data-approval-queue=""
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group relative flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all duration-150 cursor-pointer select-none outline-none ${
        isActive
          ? "bg-muted/60 border-foreground/30 shadow-xs ring-1 ring-foreground/15"
          : isSelected
          ? "bg-muted/30 border-border/90 shadow-xs"
          : isReplied
          ? "bg-blue-500/5 border-blue-500/20 hover:border-blue-500/40 hover:bg-blue-500/10"
          : "bg-card border-border/70 hover:bg-muted/40 hover:border-border"
      }`}
    >
      {/* Active Indicator Bar on left */}
      {isActive && (
        <div className="absolute left-0 top-2.5 bottom-2.5 w-1 bg-foreground/80 rounded-r-full" />
      )}

      {/* Bulk Selection Checkbox & Avatar */}
      <div className="flex items-center gap-2.5 shrink-0 pt-0.5">
        {enableBulkSelection && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelection?.(task.id);
            }}
            className="h-auto w-auto rounded p-0.5 text-muted-foreground/60 hover:bg-transparent hover:text-foreground"
            title={isSelected ? "Deselect task" : "Select for bulk action"}
            aria-label={isSelected ? "Deselect task" : "Select for bulk action"}
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-foreground" />
            ) : (
              <Square className="w-4 h-4 opacity-40 group-hover:opacity-100" />
            )}
          </Button>
        )}

        <Avatar
          name={task.loggedByName}
          src={avatarMap.get(task.loggedById) || task.loggedByAvatar}
          size="md"
          className="ring-1 ring-border/60 shadow-xs shrink-0"
        />
      </div>

      {/* Middle Content */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* Row 1: Name, Category, Date */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-bold text-xs text-foreground truncate">
              <HighlightText text={task.loggedByName} search={searchTerm} />
            </span>
            <span className="text-muted-foreground/40 text-[10px]">•</span>
            <span className="text-[10px] font-medium text-muted-foreground bg-muted/60 px-1.5 py-0.5 rounded border border-border/50 truncate max-w-[120px]">
              <HighlightText text={task.categoryId} search={searchTerm} />
            </span>
          </div>

          <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
            {formatDate(task.createdAt)}
          </span>
        </div>

        {/* Row 2: Title / Description snippet */}
        <p className={`text-xs line-clamp-2 leading-relaxed transition-colors ${
          isActive ? "text-foreground font-semibold" : "text-foreground/80 font-medium"
        }`}>
          {task.projectTitle && (
            <>
              <strong className="font-bold">
                <HighlightText text={task.projectTitle} search={searchTerm} />
              </strong>
              <span className="opacity-60 mx-1.5">-</span>
            </>
          )}
          <HighlightText
            text={formatTaskPreview(task.taskDescription, task.checklist)}
            search={searchTerm}
          />
        </p>

        {/* Row 3: Badges & Tags */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1 pt-0.5">
          {task.priority === "HIGH" && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 border border-red-500/20 text-[9px] font-bold tracking-wide uppercase">
              Priority
            </span>
          )}

          {isDelayed && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 border border-amber-500/20 text-[9px] font-bold tracking-wide uppercase">
              <Clock className="w-2.5 h-2.5" />
              Stale &gt;{STALE_AFTER_HOURS}h
            </span>
          )}

          {isChecklist && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/60 text-[9px] font-medium">
              <ListChecks className="w-2.5 h-2.5" />
              {checklistCount ? `Checklist ${checklistCount}` : "Checklist"}
            </span>
          )}

          {isReplied && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20 text-[9px] font-semibold">
              <MessageSquareCheck className="w-2.5 h-2.5" />
              Replied
            </span>
          )}

          {Number(task.grade) > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/20 text-[9px] font-bold">
              Grade {task.grade}
            </span>
          )}

          {isVerifiedTab && task.hrVerified && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-foreground border border-border text-[9px] font-bold">
              <CheckCircle2 className="w-2.5 h-2.5 text-green-600" />
              HR Verified
            </span>
          )}
        </div>
      </div>

      <div className="shrink-0 self-center pl-1 text-muted-foreground/30 group-hover:text-muted-foreground/80 transition-colors">
        <ChevronRight className="w-4 h-4" />
      </div>
    </div>
  );
}

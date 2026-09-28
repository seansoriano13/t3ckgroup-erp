import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import { Button } from "../../ui/button";
import { NoteText } from "../../ui/MentionTextarea";
import { taskService } from "../../../services/taskService";
import { groupTaskService } from "../../../services/groupTaskService";
import { MAX_AVATARS } from "../../../constants/sorTasks";

function formatDue(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A held task's live status reads as "Held" everywhere else in the SOR
// modal (JourneyTab's TaskLine, TaskRow) — this card follows the same
// convention rather than showing the raw "ON_HOLD" status string.
function statusLabel(status) {
  return status === "ON_HOLD" ? "Held" : status;
}

// Normalizes an individual task (taskService.getTaskById's shape) or a group
// task (groupTaskService.getGroupTaskById's raw row) into the same shape the
// card renders — mirroring constants/sorTasks.js's groupTaskRow/
// individualTaskRow, but this card only needs a handful of fields, live.
function normalizeIndividualTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    entityType: "TASK",
    title: task.projectTitle || task.taskDescription?.split("\n")[0] || "Individual Task",
    status: task.status,
    dueDate: task.endAt || null,
    avatars: [{ id: task.id, name: task.loggedByName || "Unassigned", avatarPath: task.loggedByAvatar || null }],
  };
}

function normalizeGroupTask(task) {
  if (!task) return null;
  return {
    id: task.id,
    entityType: "GROUP_TASK",
    title: task.title || "Group Task",
    status: task.status,
    dueDate: task.due_date || null,
    avatars: (task.members || []).map((m) => ({
      id: m.id,
      name: m.employee?.name || "Unassigned",
      avatarPath: m.employee?.avatar_path || null,
    })),
  };
}

function openTask(entity) {
  window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: entity.id, type: entity.entityType } }));
}

function TaskCard({ entity }) {
  const due = formatDue(entity.dueDate);
  const extraAvatars = entity.avatars.length - MAX_AVATARS;

  return (
    <div className="mt-1.5 rounded-xl border border-border/80 bg-card p-3 shadow-xs">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="link"
          size="xs"
          onClick={() => openTask(entity)}
          title={entity.title}
          className="h-auto min-w-0 flex-1 justify-start truncate p-0 text-left text-xs font-bold text-foreground hover:text-primary"
        >
          {entity.title}
        </Button>

        <div className="flex shrink-0 -space-x-1.5">
          {entity.avatars.slice(0, MAX_AVATARS).map((m) => (
            <Avatar key={m.id} name={m.name} src={m.avatarPath} size="xs" title={m.name} />
          ))}
          {extraAvatars > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-1 ring-background">
              +{extraAvatars}
            </span>
          )}
        </div>

        <StatusBadge status={entity.status} label={statusLabel(entity.status)} />

        {due && (
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-medium text-muted-foreground tabular-nums">
            <CalendarClock size={11} className="shrink-0" />
            {due}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Issue #399: a Stage Action's "task created" system note renders as a
 * compact task card — same visual family as attachment cards — instead of
 * plain text, so the live status/title/avatars/due date show, not the
 * snapshot the note was written with.
 *
 * Falls back to today's plain text when the note predates #204 (no id in
 * metadata) or the viewer can't read the task (permission-denied / deleted).
 */
export default function TaskCreatedNoteCard({ note }) {
  const { taskId, groupTaskId } = note.metadata || {};
  const [state, setState] = useState(taskId || groupTaskId ? "loading" : "fallback");
  const [entity, setEntity] = useState(null);

  useEffect(() => {
    if (!taskId && !groupTaskId) {
      setState("fallback");
      return;
    }

    let cancelled = false;
    setState("loading");

    const fetcher = groupTaskId
      ? groupTaskService.getGroupTaskById(groupTaskId).then(normalizeGroupTask)
      : taskService.getTaskById(taskId).then(normalizeIndividualTask);

    fetcher
      .then((normalized) => {
        if (cancelled) return;
        if (!normalized) {
          setState("fallback");
          return;
        }
        setEntity(normalized);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("fallback");
      });

    return () => {
      cancelled = true;
    };
  }, [taskId, groupTaskId]);

  if (state === "ready" && entity) {
    return <TaskCard entity={entity} />;
  }

  if (state === "fallback") {
    return note.content ? (
      <NoteText content={note.content} className="text-sm text-muted-foreground italic break-words" />
    ) : null;
  }

  // Loading — render nothing rather than a placeholder card that would just
  // flash and be replaced.
  return null;
}

import { useState } from "react";
import { ChevronDown, ChevronRight, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import Avatar from "../../Avatar";
import { MAX_AVATARS } from "../../../constants/sorTasks";
import { Button } from "@/components/ui/button";

function formatDue(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function openTask(row) {
  window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: row.id, type: row.entityType } }));
}

/**
 * One task, one line (#299): title, member avatars, parts done, due date.
 * Eight group tasks with ten members each used to be eighty lines down the
 * left column of the old modal — here they are eight rows, and a row opens
 * to its members' parts in place rather than navigating away.
 *
 * The title is the only thing that opens the task, so expanding a row and
 * opening it are separate targets on a row this dense.
 */
export default function TaskRow({ row }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = row.kind === "group" && row.members.length > 0;
  const due = formatDue(row.dueDate);
  const allDone = row.totalCount > 0 && row.doneCount === row.totalCount;
  const extraAvatars = row.members.length - MAX_AVATARS;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50">
      <div className="flex items-center gap-2 px-3 py-2">
        <Button
          type="button"
          onClick={() => canExpand && setExpanded((e) => !e)}
          disabled={!canExpand}
          aria-label={canExpand ? (expanded ? `Collapse ${row.title}` : `Expand ${row.title}`) : undefined}
          aria-expanded={canExpand ? expanded : undefined}
          variant="ghost" className={cn("h-auto p-0 shrink-0 text-muted-foreground", canExpand ? "cursor-pointer hover:text-foreground" : "cursor-default opacity-0")}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </Button>

        <Button
          type="button"
          onClick={() => openTask(row)}
          title={row.title}
          variant="ghost" className="min-w-0 flex-1 truncate text-left h-auto justify-start"
        >
          {row.title}
        </Button>

        <div className="flex shrink-0 -space-x-1.5">
          {row.members.slice(0, MAX_AVATARS).map((m) => (
            <Avatar key={m.id} name={m.name} src={m.avatarPath} size="xs" title={m.name} />
          ))}
          {extraAvatars > 0 && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground ring-1 ring-background">
              +{extraAvatars}
            </span>
          )}
        </div>

        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums uppercase",
            allDone ? "bg-green-9/15 text-green-11" : "bg-amber-9/15 text-amber-11",
          )}
        >
          {row.doneCount}/{row.totalCount}
        </span>

        <span className="flex w-[64px] shrink-0 items-center justify-end gap-1 text-[11px] font-medium text-muted-foreground tabular-nums">
          {due && (
            <>
              <CalendarClock size={11} className="shrink-0" />
              {due}
            </>
          )}
        </span>
      </div>

      {expanded && canExpand && (
        <div className="space-y-1.5 border-t border-border/50 px-3 py-2">
          {row.members.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <Avatar name={m.name} src={m.avatarPath} size="xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-foreground">
                  {m.name}
                  <span className="ml-1 font-normal text-muted-foreground">({m.role})</span>
                </p>
                {m.part && <p className="truncate text-[10px] text-muted-foreground">{m.part.split("\n")[0]}</p>}
              </div>
              <span className={cn("shrink-0 text-[10px] font-bold uppercase", m.done ? "text-green-11" : "text-muted-foreground")}>
                {m.done ? "Done" : "Pending"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

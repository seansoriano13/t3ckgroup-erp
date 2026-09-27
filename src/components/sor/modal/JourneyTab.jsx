import { useState } from "react";
import { cn } from "@/lib/utils";
import { ArrowRight, CalendarClock, Check, ChevronDown, ChevronRight, CircleDashed, History, PackageSearch, ShieldOff } from "lucide-react";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import TabSkeleton from "./TabSkeleton";
import { useSorModalData } from "./useSorModalData";
import { opportunityService } from "../../../services/opportunityService";
import { Button } from "../../ui/button";
import { isConditionOutstanding, isTaskDeleted, journeyRows } from "../../../constants/journey";
import { groupTaskRow, individualTaskRow } from "../../../constants/sorTasks";
import { CONDITION_STATUS } from "../../../constants/stageGate";
import { TASK_STATUS } from "../../../constants/status";
import { REVERT_CHOICE } from "../../../constants/revertChoice";
import { formatDueDate as formatWhen } from "../../../utils/formatDate";

const notDeleted = (task) => !isTaskDeleted(task);

function Person({ person }) {
  if (!person) return <span className="text-muted-foreground/60">someone</span>;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Avatar name={person.name} src={person.avatar_path} size="xs" />
      <span className="font-semibold text-foreground">{person.name}</span>
    </span>
  );
}

function ConditionLine({ row }) {
  const met = row.status === CONDITION_STATUS.SATISFIED;
  const when = formatWhen(row.satisfiedAt);

  return (
    <div className="flex items-start gap-2 text-[11px] leading-5">
      {met ? (
        <Check size={12} className="mt-1 shrink-0 text-green-11" />
      ) : (
        <CircleDashed size={12} className="mt-1 shrink-0 text-amber-11" />
      )}
      <span className="min-w-0 flex-1 font-medium text-foreground">{row.condition.label}</span>
      {row.carried && <span className="shrink-0 text-[10px] text-muted-foreground">from an earlier visit</span>}
      {met ? (
        <span className="shrink-0 text-muted-foreground">
          Met by <Person person={row.satisfiedBy} />
          {when && ` on ${when}`}
        </span>
      ) : (
        <span className="shrink-0 font-bold text-amber-11">Not met</span>
      )}
    </div>
  );
}

function TaskLine({ title, status, owner, date, carried = false }) {
  const when = formatWhen(date);

  return (
    <div className="flex items-center gap-2 text-[11px] leading-5">
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
      {carried && <span className="shrink-0 text-[10px] text-muted-foreground">from an earlier visit</span>}
      {status === TASK_STATUS.ON_HOLD ? (
        <StatusBadge status={status}>Held</StatusBadge>
      ) : (
        <StatusBadge status={status} />
      )}
      <span className="flex w-[130px] shrink-0 items-center justify-end gap-1 text-muted-foreground">
        <Person person={owner} />
      </span>
      <span className="flex w-[110px] shrink-0 items-center justify-end gap-1 tabular-nums text-muted-foreground">
        {when && (
          <>
            <CalendarClock size={11} className="shrink-0" />
            {when}
          </>
        )}
      </span>
    </div>
  );
}

function VisitGroup({ label, children, count }) {
  if (count === 0) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-[9px] font-bold tracking-widest text-muted-foreground uppercase">
        {label} ({count})
      </p>
      {children}
    </div>
  );
}

/**
 * One closed Stage Visit: a line that says what it was and when, opening to
 * everything that stood on it. Closed by default (story 13) — an SOR that has
 * looped can carry a dozen of these, and a reader opening the Journey is
 * looking for the shape of the history before any one visit's detail.
 */
/**
 * A restricted Stage Visit (#296): one line, no toggle, no counts. RLS has
 * already stripped its conditions/tasks, so there is nothing behind this row
 * to open — rendering it as an ordinary PastVisit would show "0 tasks · All
 * met", which reads as "nothing happened here" rather than "you can't see
 * what happened here".
 */
function RestrictedVisit({ visit }) {
  const entered = formatWhen(visit.enteredAt);
  const left = formatWhen(visit.leftAt);

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/50 px-3 py-2">
      <ShieldOff size={14} className="shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <span className="text-xs font-bold text-foreground">{visit.stage.name}</span>
        {visit.stage.bracket && (
          <span className="ml-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            {visit.stage.bracket}
          </span>
        )}
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
        {entered} → {left || "open"}
      </span>
      <span className="shrink-0 rounded-md bg-mauve-a4 px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
        Restricted
      </span>
    </div>
  );
}

function PastVisit({ row, onToggle }) {
  const { visit, isExpanded } = row;
  if (visit.isRestricted) return <RestrictedVisit visit={visit} />;

  const entered = formatWhen(visit.enteredAt);
  const left = formatWhen(visit.leftAt);
  const unmet = visit.conditions.filter(isConditionOutstanding).length;
  // A deleted task is noise, not history — it never blocked or reported on
  // this visit, so it doesn't belong in a list of what stood on it.
  const tasks = visit.tasks.filter(notDeleted);
  const groupTasks = visit.groupTasks.filter(notDeleted);
  const taskCount = tasks.length + groupTasks.length;

  return (
    <div className="rounded-lg border border-border/70 bg-card/50">
      <Button
        type="button"
        variant="ghost"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-left"
      >
        {isExpanded ? (
          <ChevronDown size={14} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 truncate">
          <span className="text-xs font-bold text-foreground">{visit.stage.name}</span>
          {visit.stage.bracket && (
            <span className="ml-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
              {visit.stage.bracket}
            </span>
          )}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {entered} → {left || "open"}
        </span>
        <span
          className={cn(
            "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase",
            unmet > 0 ? "bg-amber-9/15 text-amber-11" : "bg-green-9/15 text-green-11",
          )}
        >
          {unmet > 0 ? `${unmet} unmet` : "All met"}
        </span>
        <span className="w-[70px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {taskCount} task{taskCount === 1 ? "" : "s"}
        </span>
      </Button>

      {isExpanded && (
        <div className="space-y-4 border-t border-border/50 px-3 py-3">
          <p className="text-[11px] text-muted-foreground">
            Entered by <Person person={visit.enteredBy} />
            {entered && ` on ${entered}`}
            {visit.leftAt && (
              <>
                , left by <Person person={visit.leftBy} />
                {left && ` on ${left}`}
              </>
            )}
          </p>
          {visit.resumedAt && (
            <p className="text-[11px] text-muted-foreground">
              Resumed {formatWhen(visit.resumedAt)} by <Person person={visit.resumedBy} />, its work carried forward.
            </p>
          )}
          {visit.revertChoice && (
            <p className="text-[11px] text-muted-foreground">
              Left by a Revert, {visit.revertChoice === REVERT_CHOICE.REMOVE ? "its progress removed." : "its progress kept."}
            </p>
          )}

          <VisitGroup label="Conditions" count={visit.conditions.length}>
            {visit.conditions.map((c) => (
              <ConditionLine key={c.condition.id} row={c} />
            ))}
          </VisitGroup>

          <VisitGroup label="Tasks" count={taskCount}>
            {groupTasks.map((t) => (
              <TaskLine
                key={t.id}
                title={groupTaskRow(t).title}
                status={t.status}
                // A group task's owner is whoever set it up, not whichever
                // member happens to be listed first.
                owner={t.creator || null}
                date={t.due_date || t.created_at}
                carried={Boolean(t.carried_from_visit_id)}
              />
            ))}
            {tasks.map((t) => (
              <TaskLine
                key={t.id}
                title={individualTaskRow(t).title}
                status={t.status}
                owner={t.assignee || null}
                date={t.end_at || t.created_at}
                carried={Boolean(t.carried_from_visit_id)}
              />
            ))}
          </VisitGroup>

          {visit.requestedItems.length > 0 && (
            <VisitGroup label="Requested items" count={visit.requestedItems.length}>
              {visit.requestedItems.map((item) => (
                <TaskLine key={item.id} title={item.description} status={item.status} owner={item.requestedBy} date={item.requestedAt} />
              ))}
            </VisitGroup>
          )}

          {!visit.resumedAt && visit.conditions.length === 0 && taskCount === 0 && visit.requestedItems.length === 0 && (
            <p className="text-[11px] text-muted-foreground">Nothing was recorded on this visit.</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Journey (#300) — every Stage Visit this SOR has made, latest first, so one
 * list answers "where does everything stand" across the SOR's whole life
 * instead of the timeline's one line per event.
 *
 * The current visit is a summary line linking back to Now rather than a
 * panel of its own (story 12): Now already renders this visit's conditions,
 * fields and tasks in the order they can be acted on, and repeating that here
 * would make the Journey a second, staler copy of the working view.
 *
 * Ordering and the summary live in `journeyRows`, not here, so what "latest
 * first" means is proven without a DOM.
 */
export default function JourneyTab({ opportunityId, hasOpened, onGoToNow }) {
  const [expandedIds, setExpandedIds] = useState([]);

  const { data: visits = [], isLoading } = useSorModalData({
    tab: "journey",
    opportunityId,
    queryFn: () => opportunityService.getJourney(opportunityId),
    hasOpened,
  });

  const toggle = (id) =>
    setExpandedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  if (isLoading) return <TabSkeleton />;

  const rows = journeyRows(visits, { expandedIds });

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
        <History size={28} className="text-muted-foreground/50" />
        <p className="text-sm font-semibold text-foreground">No Stage Visits yet</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          A visit is recorded the moment this SOR enters a Stage of its Sales Flow.
        </p>
      </div>
    );
  }

  const current = rows.find((r) => r.isCurrent);
  const past = rows.filter((r) => !r.isCurrent);

  return (
    <div className="space-y-4 p-6">
      {current && (
        <Button
          type="button"
          variant="ghost"
          onClick={onGoToNow}
          className="h-auto w-full items-center gap-3 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-left hover:border-mauve-7 hover:bg-muted/30"
        >
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
              Now
              {current.summary.bracket && <span className="text-muted-foreground/60">· {current.summary.bracket}</span>}
            </p>
            <p className="truncate text-sm font-black text-foreground">{current.summary.stageName}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {formatWhen(current.summary.enteredAt) ? `Since ${formatWhen(current.summary.enteredAt)} · ` : ""}
              {current.summary.line}
            </p>
          </div>
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-primary">
            Open Now
            <ArrowRight size={12} />
          </span>
        </Button>
      )}

      {past.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Earlier stages ({past.length})
          </p>
          {past.map((row) => (
            <PastVisit key={row.visit.id} row={row} onToggle={() => toggle(row.visit.id)} />
          ))}
        </div>
      ) : (
        <p className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <PackageSearch size={13} className="shrink-0 text-muted-foreground/60" />
          This SOR has not left its first Stage yet.
        </p>
      )}
    </div>
  );
}

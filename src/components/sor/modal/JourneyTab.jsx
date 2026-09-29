import { useState } from "react";
import { cn } from "@/lib/utils";
import {
  Bell,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  ExternalLink,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  History,
  PackageSearch,
  Paperclip,
  ShieldOff,
} from "lucide-react";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import TabSkeleton from "./TabSkeleton";
import TaskRow from "./TaskRow";
import { useSorModalData } from "./useSorModalData";
import { opportunityService } from "../../../services/opportunityService";
import { Button } from "../../ui/button";
import { ExternalLink as ExternalAnchor } from "../../ui/external-link";
import {
  displayTaskStatus,
  isConditionOutstanding,
  isTaskClosedOff,
  isTaskDeleted,
  journeyRows,
  otherTaskRows,
  skippedRunCount,
} from "../../../constants/journey";
import { groupTaskRow, individualTaskRow } from "../../../constants/sorTasks";
import { CONDITION_KINDS, CONDITION_STATUS } from "../../../constants/stageGate";
import { REVERT_CHOICE } from "../../../constants/revertChoice";
import { formatDueDate as formatWhen } from "../../../utils/formatDate";
import { formatBytes } from "../../../utils/attachments";

// Closed-off work stays on its visit (#400): an individual task a Start fresh
// or Remove progress cancelled is stored DELETED, but it is history, not noise.
const notDeleted = (task) => !isTaskDeleted(task) || isTaskClosedOff(task);

function Person({ person }) {
  if (!person) return <span className="text-muted-foreground/60">someone</span>;
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      <Avatar name={person.name} src={person.avatar_path} size="xs" />
      <span className="font-semibold text-foreground">{person.name}</span>
    </span>
  );
}

function getFileIcon(type, name = "") {
  const ext = (name.split(".").pop() || "").toLowerCase();
  if (type?.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) {
    return <FileImage size={15} className="shrink-0 text-blue-11" />;
  }
  if (type === "pdf" || ext === "pdf") {
    return <FileText size={15} className="shrink-0 text-red-11" />;
  }
  if (type === "excel" || ["xls", "xlsx", "csv"].includes(ext)) {
    return <FileSpreadsheet size={15} className="shrink-0 text-green-11" />;
  }
  if (type === "archive" || ["zip", "rar", "7z"].includes(ext)) {
    return <FileArchive size={15} className="shrink-0 text-amber-11" />;
  }
  return <FileText size={15} className="shrink-0 text-muted-foreground" />;
}

function DeliverableCard({ file, conditionLabel }) {
  const size = file.bytes ? formatBytes(file.bytes) : null;
  const when = formatWhen(file.uploadedAt);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-background">
          {getFileIcon(file.type, file.name)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-foreground" title={file.name}>
            {file.name || "Attachment"}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
            {conditionLabel && (
              <span className="font-medium text-foreground/80">
                Condition: {conditionLabel}
              </span>
            )}
            {size && <span>{size}</span>}
            {file.uploader && (
              <span className="inline-flex items-center gap-1">
                by <Person person={file.uploader} />
              </span>
            )}
            {when && <span>{when}</span>}
          </div>
        </div>
      </div>

      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={() => window.open(file.url, "_blank", "noopener,noreferrer")}
        className="gap-1 text-[11px]"
      >
        <ExternalLink size={11} />
        Open
      </Button>
    </div>
  );
}

/**
 * What met a condition, in its own terms (#397): who gave the file, who
 * ticked, who was assigned. A condition the system settles itself
 * (purchasing, inclusions) has no person — it just reads "Met".
 */
function MetBy({ row }) {
  const kind = row.condition?.kind;
  if (!row.satisfiedBy) return "Met";
  if (kind === CONDITION_KINDS.ATTACHMENT) return <>Given by <Person person={row.satisfiedBy} /></>;
  if (kind === CONDITION_KINDS.TICKBOX) return <>Ticked by <Person person={row.satisfiedBy} /></>;
  if (kind === CONDITION_KINDS.ASSIGNMENT) return <>Assigned <Person person={row.satisfiedBy} /></>;
  return <>Met by <Person person={row.satisfiedBy} /></>;
}

function ConditionLine({ row }) {
  const met = row.status === CONDITION_STATUS.SATISFIED;
  const when = formatWhen(row.satisfiedAt);
  const files = row.files || [];

  return (
    <div className="space-y-1.5 rounded-lg border border-border/40 bg-card/40 p-2.5 text-[11px] leading-5">
      <div className="flex items-start gap-2">
        {met ? (
          <Check size={12} className="mt-1 shrink-0 text-green-11" />
        ) : (
          <CircleDashed size={12} className="mt-1 shrink-0 text-amber-11" />
        )}
        <span className="min-w-0 flex-1 font-medium text-foreground">{row.condition.label}</span>
        {row.carried && <span className="shrink-0 text-[10px] text-muted-foreground">from an earlier visit</span>}
        {met ? (
          <span className="shrink-0 text-muted-foreground">
            <MetBy row={row} />
            {when && ` on ${when}`}
          </span>
        ) : (
          <span className="shrink-0 font-bold text-amber-11">Not met</span>
        )}
      </div>

      {files.length > 0 && (
        <div className="space-y-1 pl-5 pt-0.5">
          {files.map((file, idx) => (
            <div key={file.url || idx} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Paperclip size={11} className="shrink-0 text-muted-foreground" />
                <span className="truncate font-semibold text-foreground text-[11px]">{file.name}</span>
                {file.bytes && <span className="shrink-0 text-[10px] text-muted-foreground">({formatBytes(file.bytes)})</span>}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={() => window.open(file.url, "_blank", "noopener,noreferrer")}
                className="h-5 gap-1 px-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
              >
                <ExternalLink size={10} />
                Open
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A Follow-up's proof file, openable in a new tab. */
function FileLink({ file }) {
  if (!file?.url) return null;
  return (
    <ExternalAnchor
      href={file.url}
      className="inline-flex items-center gap-1 font-semibold text-foreground underline-offset-2 hover:underline"
    >
      <Paperclip size={11} className="shrink-0" />
      {file.name || "Attached file"}
    </ExternalAnchor>
  );
}

/** A past visit's Stage Fields (#397): filled ones with their value, unfilled ones named on one muted line. */
function StageFieldsSection({ stageFields }) {
  const { filled = [], notFilled = [] } = stageFields || {};
  if (filled.length === 0 && notFilled.length === 0) return null;

  return (
    <VisitGroup label="Stage fields" count={filled.length + (notFilled.length > 0 ? 1 : 0)}>
      {filled.map((field) => (
        <div key={field.id} className="flex items-start gap-2 text-[11px] leading-5">
          <span className="min-w-0 flex-1 font-medium text-foreground">{field.label}</span>
          <span className="shrink-0 text-muted-foreground">
            {field.type === "date" ? formatWhen(field.value) || String(field.value) : String(field.value)}
          </span>
        </div>
      ))}
      {notFilled.length > 0 && (
        <p className="text-[11px] text-muted-foreground/70">Not filled: {notFilled.join(", ")}</p>
      )}
    </VisitGroup>
  );
}

/** A past visit's Logged Follow-ups (#397), plus a count of reminders sent — the note text verbatim, proof openable. */
function FollowUpsSection({ followUps = [], reminderCount = 0 }) {
  if (followUps.length === 0 && reminderCount === 0) return null;

  return (
    <VisitGroup label="Follow-ups" count={followUps.length + (reminderCount > 0 ? 1 : 0)}>
      {followUps.map((entry, i) => {
        const when = formatWhen(entry.loggedAt);
        return (
          <div key={i} className="space-y-1 text-[11px] leading-5">
            <div className="flex items-start gap-2">
              <Person person={entry.loggedBy} />
              {when && <span className="text-muted-foreground">on {when}</span>}
            </div>
            {entry.note && <p className="text-foreground">{entry.note}</p>}
            {entry.files?.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {entry.files.map((file, fi) => (
                  <FileLink key={fi} file={file} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {reminderCount > 0 && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
          <Bell size={11} className="shrink-0" />
          {reminderCount} reminder{reminderCount === 1 ? "" : "s"} sent
        </p>
      )}
    </VisitGroup>
  );
}

/** One Stage Action's run on a past visit (#398): what it did, in the Stage's own flow order. */
function ActionRunLine({ run }) {
  if (run.outcome === "created") {
    const entity = run.groupTask || run.task;
    // Deleted by hand, not closed off: the task is gone, the action still ran.
    if (entity && !notDeleted(entity)) {
      return (
        <div className="flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
          <span className="min-w-0 flex-1 font-medium text-foreground">{run.label}</span>
          <span className="shrink-0">Task deleted</span>
        </div>
      );
    }
    const rowData = run.groupTask ? groupTaskRow(run.groupTask) : run.task ? individualTaskRow(run.task) : null;
    if (!rowData) return null;
    return (
      <TaskRow row={{ ...rowData, status: displayTaskStatus(entity), carried: Boolean(entity?.carried_from_visit_id) }} />
    );
  }

  if (run.outcome === "pending") {
    return (
      <div className="flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
        <span className="min-w-0 flex-1 font-medium text-foreground">{run.label}</span>
        <span className="shrink-0">{run.heldAt ? "Not decided, held for a Resume" : "Not decided"}</span>
      </div>
    );
  }

  if (run.outcome === "failed") {
    return (
      <div className="flex items-center gap-2 text-[11px] leading-5">
        <span className="min-w-0 flex-1 font-medium text-foreground">{run.label}</span>
        <span className="shrink-0 font-bold text-red-11">Failed to create</span>
      </div>
    );
  }

  // outcome === "skipped"
  if (run.leftUndecided) {
    return (
      <div className="flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
        <span className="min-w-0 flex-1 font-medium text-foreground">{run.label}</span>
        <span className="shrink-0">Not decided, counted as skipped</span>
      </div>
    );
  }

  const when = formatWhen(run.decidedAt);
  return (
    <div className="flex items-center gap-2 text-[11px] leading-5 text-muted-foreground">
      <span className="min-w-0 flex-1 font-medium text-foreground">{run.label}</span>
      <span className="shrink-0">
        Skipped by <Person person={run.decidedBy} />
        {when && `, ${when}`}
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

/**
 * #400: a Start fresh or a Revert's Remove progress closed a visit's Stage
 * Work off — never deleted, but marked why so History reads as "this work
 * stopped counting" rather than "this work vanished". Text mirrors the
 * ticket's own wording: "Start fresh on <date> by <X>" or "Removed by a
 * Revert on <date> by <X>".
 */
function ClosedOffBadge({ closedOff }) {
  const when = formatWhen(closedOff.at);
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="shrink-0 rounded-md bg-red-9/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-11">
        Closed off
      </span>
      <span>
        {closedOff.reason === "start_fresh" ? "Start fresh" : "Removed by a Revert"}
        {when && ` on ${when}`} by <Person person={closedOff.by} />
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
  const actionRuns = visit.actionRuns || [];
  const skipped = skippedRunCount(actionRuns);
  // #398: a task a Stage Action created is shown on its run's line; only the
  // rest (hand-logged, or pre-#204 with no run) stay under "Other tasks".
  const { tasks: otherTasks, groupTasks: otherGroupTasks } = otherTaskRows(tasks, groupTasks, actionRuns);

  const taskRowsList = [
    ...otherGroupTasks.map((t) => ({
      ...groupTaskRow(t),
      status: t.status,
      carried: Boolean(t.carried_from_visit_id),
    })),
    ...otherTasks.map((t) => ({
      ...individualTaskRow(t),
      status: displayTaskStatus(t),
      carried: Boolean(t.carried_from_visit_id),
    })),
  ];

  const conditionFiles = (visit.conditions || []).flatMap((c) =>
    (c.files || []).map((f) => ({ ...f, conditionLabel: c.condition?.label }))
  );
  const otherVisitFiles = (visit.attachments || []).filter(
    (a) => !conditionFiles.some((cf) => cf.url === a.url)
  );
  const allDeliverables = [...conditionFiles, ...otherVisitFiles];

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
        {/* ADR 0027: a Resume moved this visit's work on, so its conditions
            and tasks now read on the new visit — counting them here would
            show work that was carried forward as unmet. */}
        {visit.resumedAt ? (
          <span className="shrink-0 rounded-md bg-mauve-a4 px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
            Resumed
          </span>
        ) : (
          <span
            className={cn(
              "shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase",
              unmet > 0 ? "bg-amber-9/15 text-amber-11" : "bg-green-9/15 text-green-11",
            )}
          >
            {unmet > 0 ? `${unmet} unmet` : "All met"}
          </span>
        )}
        {skipped > 0 && (
          <span className="shrink-0 rounded-md bg-mauve-a4 px-1.5 py-0.5 text-[10px] font-black uppercase text-muted-foreground">
            {skipped} skipped
          </span>
        )}
        {visit.closedOff && (
          <span className="shrink-0 rounded-md bg-red-9/15 px-1.5 py-0.5 text-[10px] font-black uppercase text-red-11">
            Closed off
          </span>
        )}
        {!visit.resumedAt && (
        <span className="shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {allDeliverables.length > 0 ? `${allDeliverables.length} file${allDeliverables.length === 1 ? "" : "s"} · ` : ""}
          {taskCount} task{taskCount === 1 ? "" : "s"}
        </span>
        )}
      </Button>

      {isExpanded && (
        <div className="space-y-4 border-t border-border/50 px-3 py-3">
          {visit.closedOff && <ClosedOffBadge closedOff={visit.closedOff} />}

          {visit.conditions.length > 0 && (
            <VisitGroup label="Conditions & Approvals" count={visit.conditions.length}>
              <div className="space-y-1.5">
                {visit.conditions.map((c) => (
                  <ConditionLine key={c.condition.id} row={c} />
                ))}
              </div>
            </VisitGroup>
          )}

          {allDeliverables.length > 0 && (
            <VisitGroup label="Deliverables & Files" count={allDeliverables.length}>
              <div className="space-y-1.5">
                {allDeliverables.map((file, idx) => (
                  <DeliverableCard
                    key={file.url || idx}
                    file={file}
                    conditionLabel={file.conditionLabel}
                  />
                ))}
              </div>
            </VisitGroup>
          )}

          <StageFieldsSection stageFields={visit.stageFields} />

          <VisitGroup label="Stage actions" count={actionRuns.length}>
            <div className="space-y-1.5">
              {actionRuns.map((run) => (
                <ActionRunLine key={run.id} run={run} />
              ))}
            </div>
          </VisitGroup>

          {taskRowsList.length > 0 && (
            <VisitGroup label="Other tasks" count={taskRowsList.length}>
              <div className="space-y-1.5">
                {taskRowsList.map((r) => (
                  <TaskRow key={`${r.kind}-${r.id}`} row={r} />
                ))}
              </div>
            </VisitGroup>
          )}

          <FollowUpsSection followUps={visit.followUps} reminderCount={visit.followUpReminderCount} />

          {visit.requestedItems?.length > 0 && (
            <VisitGroup label="Requested items" count={visit.requestedItems.length}>
              {visit.requestedItems.map((item) => (
                <div key={item.id} className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{item.description}</span>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </VisitGroup>
          )}

          {!visit.resumedAt && visit.conditions.length === 0 && taskCount === 0 && actionRuns.length === 0 && allDeliverables.length === 0 &&
            !(visit.stageFields?.filled?.length || visit.stageFields?.notFilled?.length) &&
            !(visit.followUps?.length || visit.followUpReminderCount) && (
            <p className="text-[11px] text-muted-foreground">Nothing was recorded on this visit.</p>
          )}

          <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
            <div className="flex flex-wrap items-center gap-1">
              Entered by <Person person={visit.enteredBy} />
              {entered && ` on ${entered}`}
              {visit.leftAt && (
                <>
                  , left by <Person person={visit.leftBy} />
                  {left && ` on ${left}`}
                </>
              )}
            </div>
            {visit.resumedAt && (
              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                Resumed {formatWhen(visit.resumedAt)} by <Person person={visit.resumedBy} />, its work carried forward.
              </div>
            )}
            {visit.revertChoice && (
              <p className="mt-0.5">
                Left by a Revert, {visit.revertChoice === REVERT_CHOICE.REMOVE ? "its progress removed." : "its progress kept."}
              </p>
            )}
          </div>
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
          <span className="flex shrink-0 items-center gap-1 text-[11px] font-bold text-foreground">
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

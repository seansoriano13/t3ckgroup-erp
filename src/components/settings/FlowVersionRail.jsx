import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import Spinner from "@/components/ui/Spinner";
import { employeeService } from "@/services/employeeService";
import { diffFlowSnapshots, countFlowSnapshotChanges } from "@/constants/salesFlow";
import { formatSnapshotVersion } from "@/constants/flowVersion";
import DiffSummary from "./FlowSnapshotDiffSummary";

/**
 * The version rail (issue #192) — every Sale Type's Flow Snapshot history,
 * always on screen rather than behind a Super-Admin-only dialog, because
 * anyone who can open the Flow Canvas can already publish from it.
 *
 * Bound to whatever Sale Type the canvas has selected: it takes the live
 * `flow`/`stages`/`edges` as props instead of picking its own Sale Type, the
 * opposite choice from the retired `FlowSnapshotHistoryPanel`.
 */
export default function FlowVersionRail({
  flow,
  stages,
  edges,
  saleTypeName,
  salesFlowService,
  versionPreview,
  stageNameFor,
  onViewVersion,
  viewingSnapshotId,
}) {
  const [open, setOpen] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [compareTargetId, setCompareTargetId] = useState(null);

  const isLocked = flow?.state === "locked";
  const stageIds = useMemo(() => stages.map((s) => s.id), [stages]);
  const stageKey = useMemo(() => [...stageIds].sort().join(","), [stageIds]);

  const { data: history = [], isLoading: isHistoryLoading } = useQuery({
    queryKey: ["flowSnapshots", flow?.id],
    queryFn: () => salesFlowService.listSnapshots(flow.id),
    enabled: Boolean(flow?.id),
  });

  const { data: usageCounts = {} } = useQuery({
    queryKey: ["flowSnapshotUsage", flow?.id],
    queryFn: () => salesFlowService.getSnapshotUsageCounts(flow.id),
    enabled: Boolean(flow?.id),
  });

  const { data: reopenEvents = [] } = useQuery({
    queryKey: ["flowUnlockEvents", flow?.id],
    queryFn: () => salesFlowService.listUnlockEvents(flow.id),
    enabled: Boolean(flow?.id),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const employeeName = (id) => employees.find((e) => e.id === id)?.name || "someone";

  // Only fetched once a row asks to compare with the draft — it is the one
  // query here that costs a Stage-Action/Condition refetch, not just a read
  // of data the rail already has.
  const { data: draftSnapshotData } = useQuery({
    queryKey: ["flowDraftSnapshotData", flow?.id, stageKey, edges.length, flow?.won_stage_id],
    queryFn: () => salesFlowService.buildSnapshotData(flow, stages, edges),
    enabled: Boolean(flow?.id) && Boolean(compareTargetId),
  });

  // Ascending, so "changes since previous" reads forward through time — v1.0
  // has no previous, so everything it carries reads as added rather than the
  // row silently having nothing to expand.
  const ascending = useMemo(
    () =>
      [...history].sort(
        (a, b) => a.version - b.version || (a.version_minor ?? 0) - (b.version_minor ?? 0),
      ),
    [history],
  );
  const sincePreviousById = useMemo(() => {
    const map = new Map();
    ascending.forEach((snapshot, i) => {
      const previous = ascending[i - 1];
      map.set(snapshot.id, diffFlowSnapshots(previous?.snapshot_data ?? {}, snapshot.snapshot_data));
    });
    return map;
  }, [ascending]);

  const stageNameIn = (snapshot) => (stageId) =>
    snapshot.snapshot_data?.stages?.find((s) => s.id === stageId)?.name || stageId;

  // Newest first, with every reopen slotted in by when it happened — the
  // acceptance criteria's "between the versions they fall between".
  const timeline = useMemo(() => {
    const versionEntries = history.map((snapshot) => ({ type: "version", at: snapshot.created_at, snapshot }));
    const reopenEntries = reopenEvents.map((event) => ({ type: "reopen", at: event.createdAt, event }));
    return [...versionEntries, ...reopenEntries].sort((a, b) => new Date(b.at) - new Date(a.at));
  }, [history, reopenEvents]);

  if (!flow) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Show version history"
        className="pointer-events-auto absolute left-3 top-20 z-20 flex size-8 items-center justify-center rounded-xl bg-card/85 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md"
      >
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    );
  }

  const draftChanges = countFlowSnapshotChanges(versionPreview?.diff);
  const latest = history[0] ?? null;

  return (
    <>
      <div className="pointer-events-auto absolute left-3 top-20 z-20 flex max-h-[calc(100%-6rem)] w-72 flex-col overflow-hidden rounded-2xl bg-card/90 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Versions</p>
          <button type="button" onClick={() => setOpen(false)} aria-label="Hide version history">
            <ChevronLeft size={14} className="text-muted-foreground" />
          </button>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-2">
          {!isLocked && (
            <VersionRow
              label={`Draft${versionPreview?.label ? ` · ${versionPreview.label}` : ""}`}
              subtitle={
                !latest
                  ? "Never published"
                  : draftChanges > 0
                    ? `${draftChanges} change${draftChanges === 1 ? "" : "s"} since ${formatSnapshotVersion(latest)}`
                    : `Identical to ${formatSnapshotVersion(latest)}`
              }
              expanded={expandedId === "draft"}
              onToggleExpand={() => setExpandedId((id) => (id === "draft" ? null : "draft"))}
            >
              {versionPreview?.diff ? (
                <DiffSummary
                  result={versionPreview.diff}
                  stageName={stageNameFor}
                  emptyMessage="Nothing to publish yet."
                />
              ) : (
                <Spinner size="sm" />
              )}
            </VersionRow>
          )}

          {isHistoryLoading && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" />
            </div>
          )}

          {!isHistoryLoading && timeline.length === 0 && (
            <p className="px-1 py-3 text-center text-xs text-muted-foreground">
              {saleTypeName ? `${saleTypeName} has` : "This flow has"} never been published.
            </p>
          )}

          {timeline.map((entry) =>
            entry.type === "reopen" ? (
              <p
                key={`reopen-${entry.event.createdAt}-${entry.event.employeeId}`}
                className="px-1.5 py-1 text-[11px] text-muted-foreground"
              >
                Reopened {new Date(entry.at).toLocaleDateString()} by {employeeName(entry.event.employeeId)}
                {entry.event.reason ? ` — ${entry.event.reason}` : ""}
              </p>
            ) : (
              <VersionRow
                key={entry.snapshot.id}
                label={formatSnapshotVersion(entry.snapshot)}
                subtitle={`${employeeName(entry.snapshot.created_by)} · ${new Date(entry.snapshot.created_at).toLocaleDateString()} · ${usageCounts[entry.snapshot.id] || 0} SOR${usageCounts[entry.snapshot.id] === 1 ? "" : "s"}`}
                note={entry.snapshot.note}
                expanded={expandedId === entry.snapshot.id}
                onToggleExpand={() =>
                  setExpandedId((id) => (id === entry.snapshot.id ? null : entry.snapshot.id))
                }
                onSelect={onViewVersion ? () => onViewVersion(entry.snapshot) : undefined}
                selected={viewingSnapshotId === entry.snapshot.id}
                actions={
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setCompareTargetId((id) => (id === entry.snapshot.id ? null : entry.snapshot.id))
                    }
                  >
                    Compare with draft
                  </Button>
                }
              >
                <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Changes since previous version
                </p>
                <DiffSummary
                  result={sincePreviousById.get(entry.snapshot.id)}
                  stageName={stageNameIn(entry.snapshot)}
                  emptyMessage="This is the first version."
                />

                {compareTargetId === entry.snapshot.id && (
                  <div className="mt-2 border-t border-border pt-2">
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      What the draft would change
                    </p>
                    {draftSnapshotData ? (
                      <DiffSummary
                        result={diffFlowSnapshots(entry.snapshot.snapshot_data, draftSnapshotData)}
                        stageName={stageNameFor}
                        emptyMessage="The draft is identical to this version."
                      />
                    ) : (
                      <Spinner size="sm" />
                    )}
                  </div>
                )}
              </VersionRow>
            ),
          )}
        </div>
      </div>
    </>
  );
}

/**
 * `onSelect` is only ever handed to a real Snapshot row (issue #193) — the
 * Draft row has nothing frozen to view read-only, so it stays a plain
 * expand/collapse toggle. Selecting and expanding are independent actions:
 * the chevron only ever expands the diff, the label only ever asks the
 * canvas to switch to viewing that version, so a viewer who wants to read
 * "what changed" without leaving the draft can still do that.
 */
function VersionRow({ label, subtitle, note, expanded, onToggleExpand, onSelect, selected, actions, children }) {
  return (
    <div className={cn("rounded-xl border border-border", selected && "border-primary ring-1 ring-primary")}>
      <div className="flex w-full items-start gap-2 px-2.5 py-2 text-left">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="mt-0.5 shrink-0"
        >
          {expanded ? (
            <ChevronUp size={14} className="text-muted-foreground" />
          ) : (
            <ChevronDown size={14} className="text-muted-foreground" />
          )}
        </button>
        {onSelect ? (
          <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left">
            <RowLabel label={label} subtitle={subtitle} note={note} />
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <RowLabel label={label} subtitle={subtitle} note={note} />
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-1 px-2.5 pb-2">{actions}</div>}
      {expanded && <div className="border-t border-border px-2.5 py-2">{children}</div>}
    </div>
  );
}

function RowLabel({ label, subtitle, note }) {
  return (
    <>
      <p className="text-sm font-bold text-foreground">{label}</p>
      <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>
      {note && <p className="mt-0.5 truncate text-[11px] italic text-muted-foreground">“{note}”</p>}
    </>
  );
}

/**
 * The toolbar's status chip (issue #192) — always says where the draft
 * stands, without opening the rail. Clicking it lists the unpublished
 * changes counted the same way the rail and publish popover do.
 */
export function FlowVersionStatusChip({ flow, saleTypeName, versionPreview, salesFlowService, stageNameFor }) {
  const [open, setOpen] = useState(false);
  const isLocked = flow?.state === "locked";

  const { data: history = [] } = useQuery({
    queryKey: ["flowSnapshots", flow?.id],
    queryFn: () => salesFlowService.listSnapshots(flow.id),
    enabled: Boolean(flow?.id),
  });

  if (!flow) return null;

  const latest = history[0] ?? null;
  const draftChanges = countFlowSnapshotChanges(versionPreview?.diff);
  const canShowChanges = !isLocked && Boolean(versionPreview?.diff);

  let text;
  if (isLocked) {
    text = `${saleTypeName} · ${formatSnapshotVersion(latest)} · published`;
  } else if (!latest) {
    text = "never published";
  } else {
    text = `${saleTypeName} · ${versionPreview?.label ?? formatSnapshotVersion(latest)} · draft (${draftChanges} change${draftChanges === 1 ? "" : "s"})`;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => canShowChanges && setOpen((o) => !o)}
        className={cn(
          "whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-bold text-muted-foreground",
          canShowChanges && "hover:bg-mauve-a3",
        )}
      >
        {text}
      </button>
      {open && canShowChanges && (
        <div className="absolute left-0 top-full z-[10001] mt-1 w-80 rounded-2xl bg-popover p-3 shadow-2xl ring-1 ring-mauve-6">
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Unpublished changes
          </p>
          <DiffSummary
            result={versionPreview.diff}
            stageName={stageNameFor}
            emptyMessage="No unpublished changes."
          />
        </div>
      )}
    </div>
  );
}

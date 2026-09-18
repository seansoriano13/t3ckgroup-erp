import { useMemo, useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Lock, X } from "lucide-react";

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
        className="pointer-events-auto absolute left-4 top-[4.25rem] z-20 flex size-8 items-center justify-center rounded-xl bg-card/85 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md transition-colors hover:bg-card hover:text-foreground"
      >
        <ChevronRight size={14} className="text-muted-foreground" />
      </button>
    );
  }

  const draftChanges = countFlowSnapshotChanges(versionPreview?.diff);
  const latest = history[0] ?? null;

  return (
    <>
      <div className="pointer-events-auto absolute left-4 top-[4.25rem] z-20 flex max-h-[calc(100%-6rem)] w-80 flex-col overflow-hidden rounded-2xl bg-card/90 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-18px_rgba(0,0,0,0.4)] backdrop-blur-md">
        <div className="flex items-center justify-between border-b border-border/80 px-4 py-3">
          <p className="text-xs font-black uppercase tracking-widest text-muted-foreground">Versions</p>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Hide version history"
            className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
          {!isLocked ? (
            <VersionRow
              label={`Draft${versionPreview?.label ? ` · ${versionPreview.label}` : ""}`}
              badge={
                !viewingSnapshotId ? (
                  <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                    Editing
                  </span>
                ) : null
              }
              subtitle={
                !latest
                  ? "Never published"
                  : draftChanges > 0
                    ? `${draftChanges} change${draftChanges === 1 ? "" : "s"} since ${formatSnapshotVersion(latest)}`
                    : `Identical to ${formatSnapshotVersion(latest)}`
              }
              expanded={expandedId === "draft"}
              onToggleExpand={() => setExpandedId((id) => (id === "draft" ? null : "draft"))}
              onSelect={onViewVersion ? () => onViewVersion(null) : undefined}
              selected={!viewingSnapshotId}
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
          ) : (
            <div
              className={cn(
                "rounded-xl border p-3.5 transition-colors",
                !viewingSnapshotId
                  ? "border-blue-500/60 ring-1 ring-blue-500/30 bg-muted/20"
                  : "border-dashed border-border bg-muted/40 cursor-pointer hover:bg-muted/60",
              )}
              onClick={() => {
                if (viewingSnapshotId && onViewVersion) {
                  onViewVersion(null);
                }
              }}
              role={viewingSnapshotId ? "button" : undefined}
              tabIndex={viewingSnapshotId ? 0 : undefined}
              aria-label={viewingSnapshotId ? "Return to live flow" : undefined}
            >
              <div className="flex items-center justify-between gap-1.5 text-xs font-semibold text-foreground">
                <div className="flex items-center gap-1.5">
                  <Lock size={13} className="text-muted-foreground" />
                  <span>Flow is Locked</span>
                </div>
                {!viewingSnapshotId ? (
                  <span className="rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                    Live
                  </span>
                ) : (
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    Click to return
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                Currently running {latest ? formatSnapshotVersion(latest) : "published flow"}. Reopen draft to edit.
              </p>
            </div>
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
                className="px-2 py-1 text-xs text-muted-foreground"
              >
                Reopened {new Date(entry.at).toLocaleDateString()} by {employeeName(entry.event.employeeId)}
                {entry.event.reason ? ` — ${entry.event.reason}` : ""}
              </p>
            ) : (
              <VersionRow
                key={entry.snapshot.id}
                label={formatSnapshotVersion(entry.snapshot)}
                badge={
                  viewingSnapshotId === entry.snapshot.id ? (
                    <span className="rounded-md bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">
                      Viewing
                    </span>
                  ) : entry.snapshot.id === latest?.id ? (
                    <span className="rounded-md bg-green-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
                      Live
                    </span>
                  ) : null
                }
                subtitle={`${employeeName(entry.snapshot.created_by)} · ${new Date(entry.snapshot.created_at).toLocaleDateString()} · ${usageCounts[entry.snapshot.id] || 0} SOR${usageCounts[entry.snapshot.id] === 1 ? "" : "s"}`}
                note={entry.snapshot.note}
                expanded={expandedId === entry.snapshot.id}
                onToggleExpand={() =>
                  setExpandedId((id) => (id === entry.snapshot.id ? null : entry.snapshot.id))
                }
                onSelect={onViewVersion ? () => onViewVersion(entry.snapshot) : undefined}
                selected={viewingSnapshotId === entry.snapshot.id}
                actions={
                  !isLocked ? (
                    <Button
                      type="button"
                      variant={compareTargetId === entry.snapshot.id ? "secondary" : "outline"}
                      size="sm"
                      className="h-7 text-xs px-2.5 rounded-lg border-border/80"
                      onClick={() => {
                        if (compareTargetId === entry.snapshot.id) {
                          setCompareTargetId(null);
                        } else {
                          setCompareTargetId(entry.snapshot.id);
                          setExpandedId(entry.snapshot.id);
                        }
                      }}
                    >
                      {compareTargetId === entry.snapshot.id
                        ? "Comparing with draft"
                        : "Compare with draft"}
                    </Button>
                  ) : null
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
                  <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
                    <div className="mb-1.5 flex items-center justify-between">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-foreground">
                        What the draft would change
                      </p>
                      <button
                        type="button"
                        onClick={() => setCompareTargetId(null)}
                        className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                        aria-label="Close draft comparison"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {draftSnapshotData ? (
                      <DiffSummary
                        result={diffFlowSnapshots(entry.snapshot.snapshot_data, draftSnapshotData)}
                        stageName={stageNameFor}
                        emptyMessage="The draft is identical to this version."
                      />
                    ) : (
                      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
                        <Spinner size="sm" />
                        <span>Calculating diff against draft…</span>
                      </div>
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
function VersionRow({ label, subtitle, note, badge, expanded, onToggleExpand, onSelect, selected, actions, children }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/80 transition-colors",
        selected && "border-blue-500/60 ring-1 ring-blue-500/30 dark:border-blue-400/60",
      )}
    >
      <div className="flex w-full items-start gap-2.5 p-3 text-left">
        <button
          type="button"
          onClick={onToggleExpand}
          aria-label={expanded ? `Collapse ${label}` : `Expand ${label}`}
          className="mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {expanded ? (
            <ChevronUp size={15} />
          ) : (
            <ChevronDown size={15} />
          )}
        </button>
        {onSelect ? (
          <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left group/row">
            <RowLabel label={label} subtitle={subtitle} note={note} badge={badge} />
          </button>
        ) : (
          <div className="min-w-0 flex-1">
            <RowLabel label={label} subtitle={subtitle} note={note} badge={badge} />
          </div>
        )}
      </div>
      {actions && <div className="flex items-center gap-1.5 px-3 pb-3 pt-0.5">{actions}</div>}
      {expanded && <div className="border-t border-border/80 p-3">{children}</div>}
    </div>
  );
}

function RowLabel({ label, subtitle, note, badge }) {
  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-bold text-foreground leading-snug">{label}</p>
        {badge}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>
      {note && <p className="mt-1 truncate text-xs italic text-muted-foreground">“{note}”</p>}
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
  const chipRef = useRef(null);
  const isLocked = flow?.state === "locked";

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (chipRef.current && !chipRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside, true);
    document.addEventListener("touchstart", handleClickOutside, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside, true);
      document.removeEventListener("touchstart", handleClickOutside, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

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
    <div ref={chipRef} className="relative">
      <button
        type="button"
        onClick={() => canShowChanges && setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-1.5 text-xs font-bold transition-colors",
          isLocked
            ? "text-muted-foreground bg-muted/30 border border-border/50"
            : "text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/20",
          canShowChanges && "hover:bg-amber-500/20 hover:text-foreground cursor-pointer",
        )}
      >
        {isLocked && <Lock size={12} className="shrink-0 text-muted-foreground" />}
        <span>{text}</span>
      </button>
      {open && canShowChanges && (
        <div className="popover-enter absolute right-0 top-full z-[10001] mt-2 w-84 rounded-2xl bg-popover p-3.5 shadow-2xl ring-1 ring-mauve-6">
          <div className="flex items-center justify-between border-b border-border pb-2 mb-2.5">
            <p className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
              Unpublished changes
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close unpublished changes"
            >
              <X size={14} />
            </button>
          </div>
          <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
            <DiffSummary
              result={versionPreview.diff}
              stageName={stageNameFor}
              emptyMessage="No unpublished changes."
            />
          </div>
        </div>
      )}
    </div>
  );
}

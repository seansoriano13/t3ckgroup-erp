import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { History } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Spinner from "@/components/ui/Spinner";
import { useAuth } from "@/context/AuthContext";
import { salesFlowService } from "@/services/salesFlowService";
import { employeeService } from "@/services/employeeService";
import { diffFlowSnapshots } from "@/constants/salesFlow";

/**
 * A Super Admin's view of a Sale Type's Flow Snapshot history (issue #36's
 * user stories #64/#65, issue #83's `getSnapshotUsageCounts`, finally
 * surfaced) — who locked what, when, how many live SORs still run it, what
 * changed between any two, and restoring the live draft to an earlier one.
 *
 * Deliberately its own Sale Type picker rather than reading whatever is
 * selected on the canvas: the canvas's own selection state stays untouched,
 * so this panel adds nothing to `FlowCanvas` itself.
 */
export default function FlowSnapshotHistoryPanel({ open, onOpenChange }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [saleTypeId, setSaleTypeId] = useState("");
  const [compareIds, setCompareIds] = useState([]);
  const [restoreTarget, setRestoreTarget] = useState(null);

  const { data: saleTypes = [] } = useQuery({
    queryKey: ["saleTypes", "all"],
    queryFn: () => salesFlowService.getSaleTypes(),
    enabled: open,
  });

  const { data: flowData, isLoading: isFlowLoading } = useQuery({
    queryKey: ["salesFlow", saleTypeId],
    queryFn: () => salesFlowService.getFlow(saleTypeId),
    enabled: open && Boolean(saleTypeId),
  });
  const flow = flowData?.flow;

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

  const { data: unlockEvents = [] } = useQuery({
    queryKey: ["flowUnlockEvents", flow?.id],
    queryFn: () => salesFlowService.listUnlockEvents(flow.id),
    enabled: Boolean(flow?.id),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees", "all"],
    queryFn: () => employeeService.getAllEmployees(),
    enabled: open,
  });
  const employeeName = (id) => employees.find((e) => e.id === id)?.name || "someone";

  const restoreMutation = useMutation({
    mutationFn: (snapshotId) => salesFlowService.restoreSnapshot(flow.id, snapshotId, user?.id),
    onSuccess: () => {
      toast.success("Flow Snapshot restored into the draft.");
      queryClient.invalidateQueries({ queryKey: ["salesFlow"] });
      queryClient.invalidateQueries({ queryKey: ["flowSnapshots", flow?.id] });
      queryClient.invalidateQueries({ queryKey: ["flowSnapshotUsage", flow?.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  const diff = useMemo(() => {
    if (compareIds.length !== 2) return null;
    const a = history.find((s) => s.id === compareIds[0]);
    const b = history.find((s) => s.id === compareIds[1]);
    if (!a || !b) return null;
    // Always diff older -> newer, so "added" reads as "added since".
    const [older, newer] = a.version < b.version ? [a, b] : [b, a];
    return { older, newer, result: diffFlowSnapshots(older.snapshot_data, newer.snapshot_data) };
  }, [compareIds, history])

  const stageName = (stageId) => {
    if (!diff) return stageId;
    const combined = [...diff.older.snapshot_data.stages, ...diff.newer.snapshot_data.stages];
    return combined.find((s) => s.id === stageId)?.name || stageId;
  };

  const toggleCompare = (id) => {
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History size={16} /> Flow Snapshot history
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-1">
            <label htmlFor="flow-snapshot-history-sale-type" className="text-xs font-bold text-muted-foreground">
              Sale Type
            </label>
            <select
              id="flow-snapshot-history-sale-type"
              value={saleTypeId}
              onChange={(e) => {
                setSaleTypeId(e.target.value);
                setCompareIds([]);
              }}
              className="h-9 w-full rounded-lg border border-border bg-card px-3 text-sm outline-none focus-visible:border-mauve-7 focus-visible:ring-1 focus-visible:ring-mauve-7"
            >
              <option value="">Choose a Sale Type…</option>
              {saleTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          {saleTypeId && (isFlowLoading || isHistoryLoading) && (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          )}

          {saleTypeId && !isFlowLoading && !isHistoryLoading && history.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              This Sale Type's flow has never been locked, so it has no Flow Snapshot history yet.
            </p>
          )}

          {history.length > 0 && (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {history.map((snapshot) => (
                <li
                  key={snapshot.id}
                  className="flex items-center gap-3 rounded-xl border border-border px-3 py-2"
                >
                  <input
                    type="checkbox"
                    aria-label={`Compare Snapshot v${snapshot.version}`}
                    checked={compareIds.includes(snapshot.id)}
                    onChange={() => toggleCompare(snapshot.id)}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-foreground">v{snapshot.version}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Locked by {employeeName(snapshot.created_by)},{" "}
                      {new Date(snapshot.created_at).toLocaleString()} ·{" "}
                      {usageCounts[snapshot.id] || 0} live deal
                      {usageCounts[snapshot.id] === 1 ? "" : "s"} on it
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setRestoreTarget(snapshot)}
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {unlockEvents.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Reopened along the way
              </p>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {unlockEvents.map((event, i) => (
                  <li key={i}>
                    {new Date(event.createdAt).toLocaleDateString()} — {employeeName(event.employeeId)}:{" "}
                    {event.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {compareIds.length === 2 && diff && (
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
                v{diff.older.version} → v{diff.newer.version}
              </p>
              <DiffSummary result={diff.result} stageName={stageName} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(next) => !next && setRestoreTarget(null)}
        title={`Restore Flow Snapshot v${restoreTarget?.version}?`}
        description="This discards whatever unlocked draft state this flow currently has and rebuilds it as this Snapshot's shape. Nothing in the Snapshot history is changed or deleted — the restored shape only becomes its own new Snapshot the next time this flow is locked."
        confirmLabel="Restore"
        tone="destructive"
        onConfirm={() => restoreMutation.mutate(restoreTarget.id)}
      />
    </>
  );
}

function DiffSummary({ result, stageName }) {
  if (!result.hasChanges) {
    return <p className="text-sm text-muted-foreground">No changes between these two Snapshots.</p>;
  }

  return (
    <div className="space-y-2 text-sm">
      <DiffGroup label="Stages" group={result.stages} nameOf={(s) => s.name} renamedFrom="name" />
      <DiffEdgeGroup group={result.edges} stageName={stageName} />
      <DiffGroup
        label="Stage Actions"
        group={result.actions}
        nameOf={(a) => `${a.kind} on ${stageName(a.stage_id)}`}
      />
      <DiffGroup
        label="Stage Conditions"
        group={result.conditions}
        nameOf={(c) => `${c.label || c.kind} on ${stageName(c.stage_id)}`}
      />
      {result.wonStageChanged && <p>• Won Stage changed.</p>}
    </div>
  );
}

function DiffGroup({ label, group, nameOf }) {
  if (group.added.length === 0 && group.removed.length === 0 && group.changed.length === 0) return null;
  return (
    <div>
      <p className="font-bold text-foreground">{label}</p>
      <ul className="ml-3 list-disc space-y-0.5">
        {group.added.map((item) => (
          <li key={`added-${item.id}`} className="text-green-700 dark:text-green-500">
            Added: {nameOf(item)}
          </li>
        ))}
        {group.removed.map((item) => (
          <li key={`removed-${item.id}`} className="text-destructive">
            Removed: {nameOf(item)}
          </li>
        ))}
        {group.changed.map(({ id, before, after }) => (
          <li key={`changed-${id}`} className="text-muted-foreground">
            Changed: {nameOf(before)}
            {before.name !== after.name ? ` → renamed to "${after.name}"` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DiffEdgeGroup({ group, stageName }) {
  if (group.added.length === 0 && group.removed.length === 0) return null;
  const label = (edge) => `${stageName(edge.from_stage_id)} → ${stageName(edge.to_stage_id)}`;
  return (
    <div>
      <p className="font-bold text-foreground">Edges (permitted moves)</p>
      <ul className="ml-3 list-disc space-y-0.5">
        {group.added.map((edge) => (
          <li key={`added-${edge.id}`} className="text-green-700 dark:text-green-500">
            Added: {label(edge)}
          </li>
        ))}
        {group.removed.map((edge) => (
          <li key={`removed-${edge.id}`} className="text-destructive">
            Removed: {label(edge)}
          </li>
        ))}
      </ul>
    </div>
  );
}

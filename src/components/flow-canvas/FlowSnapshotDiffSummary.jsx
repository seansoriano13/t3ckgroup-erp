import { cn } from "@/lib/utils";

/**
 * The rendered form of `diffFlowSnapshots` (constants/salesFlow.js), shared
 * by the history dialog's compare view and the publish popover's change
 * summary (issue #189) — one presentation of "what changed" rather than two
 * that could drift apart.
 */
export default function DiffSummary({
  result,
  stageName,
  emptyMessage = "No changes between these two Snapshots.",
  className,
}) {
  if (!result.hasChanges) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className={cn("space-y-2 text-sm", className)}>
      <DiffGroup label="Stages" group={result.stages} nameOf={(s) => s.name} />
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
      <DiffGroup
        label="Stage Fields"
        group={result.stageFields}
        nameOf={(f) => `${f.label} on ${stageName(f.stage_id)}`}
      />
      <DiffGroup
        label="Registration Form"
        group={result.formFields}
        nameOf={(f) => f.label || f.default_key}
      />
      <DiffGroup
        label="Follow-up Cadence"
        group={result.followUps}
        nameOf={(c) => `on ${stageName(c.stage_id || c.id)}`}
      />
      {result.wonStageChanged && <p>• Won Stage changed.</p>}
    </div>
  );
}

function DiffGroup({ label, group, nameOf }) {
  if (!group) return null;
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

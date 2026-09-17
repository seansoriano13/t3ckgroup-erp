import { useQuery } from "@tanstack/react-query";
import { salesFlowService } from "../../services/salesFlowService";
import { stagesReachableFrom } from "../../utils/stageGraph";

const UNTIL_RULE_META = {
  stage_left: { label: "Until this Stage is left" },
  stage_entered: { label: "Until a later Stage is entered" },
  later_stage_left: { label: "Until a later Stage is left" },
  terminal: { label: "Until a Terminal Stage is reached" },
};

const NEEDS_LATER_STAGE = new Set(["stage_entered", "later_stage_left"]);

/**
 * Issue #294 — the shared `access: {until, stageId}` sub-form used by both an
 * Assignment condition (StageConditionManager) and the two task-creating
 * action kinds (StageActionDetail): how long the person it calls in keeps
 * their Stage Participant window open.
 *
 * The later-Stage picker only offers Stages reachable from `stageId` (the
 * calling Stage) along drawn moves — offering an unreachable Stage would let
 * someone configure a window that can only ever close by hitting a Terminal
 * Stage, never by its own stated rule.
 */
export default function AccessWindowConfig({ stageId, value, onChange, disabled = false }) {
  const { data: graph } = useQuery({
    queryKey: ["flowGraphForStage", stageId],
    queryFn: () => salesFlowService.getFlowGraphForStage(stageId),
    enabled: Boolean(stageId),
  });

  const until = value?.until || "stage_left";
  const reachableIds = stagesReachableFrom(stageId, graph?.edges || []);
  const laterStageOptions = (graph?.stages || []).filter((s) => reachableIds.has(s.id));

  const setUntil = (nextUntil) => {
    onChange({
      until: nextUntil,
      stageId: NEEDS_LATER_STAGE.has(nextUntil) ? value?.stageId : undefined,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Access window — how long they can see this deal
      </span>
      <select
        aria-label="Access window rule"
        disabled={disabled}
        value={until}
        onChange={(e) => setUntil(e.target.value)}
        className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
      >
        {Object.entries(UNTIL_RULE_META).map(([ruleValue, meta]) => (
          <option key={ruleValue} value={ruleValue}>
            {meta.label}
          </option>
        ))}
      </select>

      {NEEDS_LATER_STAGE.has(until) && (
        <select
          aria-label="Later Stage"
          disabled={disabled}
          value={value?.stageId || ""}
          onChange={(e) => onChange({ until, stageId: e.target.value || undefined })}
          className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
        >
          <option value="" disabled>
            Choose a later Stage…
          </option>
          {laterStageOptions.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </select>
      )}

      {NEEDS_LATER_STAGE.has(until) && value?.stageId && !reachableIds.has(value.stageId) && (
        <p className="mt-1 text-[10px] text-amber-11">
          The Stage this window was set to end at no longer exists or isn't reachable from here — it will
          fall back to "Until this Stage is left" once saved.
        </p>
      )}
    </div>
  );
}

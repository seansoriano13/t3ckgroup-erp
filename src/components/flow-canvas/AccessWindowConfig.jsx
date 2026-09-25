import { useQuery } from "@tanstack/react-query";
import { salesFlowService } from "../../services/salesFlowService";
import { stagesReachableFrom } from "../../utils/stageGraph";
import { ACCESS_WINDOW_RULES, NEEDS_LATER_STAGE, accessWindowSummary } from "../../utils/stageAudience";
import { SelectField } from "@/components/ui/SelectField";

/**
 * Issue #294 — the shared `access: {until, stageId}` sub-form used by both an
 * Assignment condition (StageConditionManager) and the two task-creating
 * action kinds (StageActionManager): how long the people it calls in keep
 * their Stage Participant window open.
 *
 * It reads as one sentence, top to bottom: who can read, how far, and what
 * comes with it. The copy it replaces failed three ways at once — "how long
 * they can see this deal" named nobody and called a template's record a
 * "deal" (on the Flow Canvas there is no deal yet), and all four rules began
 * "Until…", differing only in a word at the end. "Until a later Stage is
 * entered" and "Until a later Stage is left" are one word apart, and it is
 * the word that decides whether the end Stage is included. The labels now
 * name the span instead, so the two read "until X begins" and "through X".
 *
 * The later-Stage picker only offers Stages reachable from `stageId` (the
 * calling Stage) along drawn moves — offering an unreachable Stage would let
 * someone configure a window that can only ever close by hitting a Terminal
 * Stage, never by its own stated rule.
 */
export default function AccessWindowConfig({
  stageId,
  value,
  onChange,
  disabled = false,
  subjectLabel,
}) {
  const { data: graph } = useQuery({
    queryKey: ["flowGraphForStage", stageId],
    queryFn: () => salesFlowService.getFlowGraphForStage(stageId),
    enabled: Boolean(stageId),
  });

  const until = value?.until || "stage_left";
  const reachableIds = stagesReachableFrom(stageId, graph?.edges || []);
  const laterStageOptions = (graph?.stages || []).filter((s) => reachableIds.has(s.id));
  const stageNameById = Object.fromEntries((graph?.stages || []).map((s) => [s.id, s.name]));
  const summary = accessWindowSummary(value, stageNameById);

  const setUntil = (nextUntil) => {
    onChange({
      until: nextUntil,
      stageId: NEEDS_LATER_STAGE.has(nextUntil) ? value?.stageId : undefined,
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
        Access window
      </span>
      <p className="mb-2 text-[11px] leading-snug text-foreground">
        <span className="font-bold">{subjectLabel || "Whoever this calls in"}</span> can read:
      </p>
      <SelectField
        aria-label="Access window rule"
        disabled={disabled}
        value={until}
        onChange={setUntil}
        // Both later-Stage options name the chosen Stage, so "until Delivery
        // begins" and "through Delivery" sit side by side and the difference
        // between them is impossible to miss.
        options={Object.entries(ACCESS_WINDOW_RULES).map(([ruleValue, meta]) => ({
          value: ruleValue,
          label: meta.label(meta.needsStage ? stageNameById[value?.stageId] : null),
        }))}
        className="w-full"
      />

      {NEEDS_LATER_STAGE.has(until) && (
        <SelectField
          aria-label="Later Stage"
          disabled={disabled}
          value={value?.stageId || null}
          onChange={(next) => onChange({ until, stageId: next || undefined })}
          options={laterStageOptions.map((stage) => ({ value: stage.id, label: stage.name }))}
          placeholder="Choose a later Stage…"
          className="mt-2 w-full"
        />
      )}

      {/* What the label cannot say: which Stages in between come with it.
          Deliberately not a list of Stage names — flows branch, so which
          Stages a deal actually passes through depends on its route. */}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">{summary.helperLabel}</p>

      {/* The one caveat none of the four labels can carry. */}
      {NEEDS_LATER_STAGE.has(until) && value?.stageId && (
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          A Terminal Stage closes it earlier — if the deal ends before then, they are out at that
          point.
        </p>
      )}

      {NEEDS_LATER_STAGE.has(until) && value?.stageId && !reachableIds.has(value.stageId) && (
        <p className="mt-1 text-[10px] text-amber-11">
          The Stage this window was set to end at no longer exists or isn&apos;t reachable from
          here — it will fall back to &quot;Only this Stage&quot; once saved.
        </p>
      )}
    </div>
  );
}

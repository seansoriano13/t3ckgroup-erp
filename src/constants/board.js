/**
 * SORS Board — pure column-building helpers (issue #206).
 *
 * A flow's Stages have no shared ordering with any other flow's (ADR 0006),
 * so a board showing every Sale Type at once mixed unrelated Stages into one
 * row. These build one Sale Type's columns at a time, in the same bracket
 * order the Flow Canvas and the deal modal's ribbon already agree on
 * (`bracketRuns`), so the Board is a fourth picture of the same graph rather
 * than a new one.
 *
 * No React, no network: stages/opportunities/snapshots all come in as
 * arguments. Prior art: constants/sor.js and constants/salesFlow.js.
 */
import { bracketRuns } from "../components/settings/flowCanvasLayout";
import { isOpenPipelineOpportunity, isRealizedOpportunity } from "./sor";
import { flowStageTone } from "./salesFlow";

const sumExpectedValue = (items) =>
  items.reduce((sum, o) => sum + Number(o.expected_value || 0), 0);

/**
 * One Sale Type's Board columns, one per Stage in canvas/bracket order.
 * `bracketLabel` rides along per column (null when the Stage carries none) so
 * a renderer can group consecutive same-label columns under one heading
 * without re-deriving the grouping itself.
 */
export function flowBoardColumns({ stages = [], opportunities = [], snapshotsById = {}, flow = null } = {}) {
  const byStage = new Map();
  for (const o of opportunities) {
    if (!o.flow_stage_id) continue;
    if (!byStage.has(o.flow_stage_id)) byStage.set(o.flow_stage_id, []);
    byStage.get(o.flow_stage_id).push(o);
  }

  return bracketRuns(stages).flatMap((run) =>
    run.stages.map((stage) => {
      const items = byStage.get(stage.id) || [];
      return {
        key: stage.id,
        stage,
        theme: flowStageTone(stage, flow, stages),
        bracketLabel: run.label,
        items,
        count: items.length,
        openValue: sumExpectedValue(
          items.filter((o) => isOpenPipelineOpportunity(o, { snapshotsById })),
        ),
        wonValue: sumExpectedValue(
          items.filter((o) => isRealizedOpportunity(o, { snapshotsById })),
        ),
      };
    }),
  );
}

/** The legacy pipeline's columns, one per Stage in pipeline order. */
export function legacyBoardColumns({ stages = [], opportunities = [] } = {}) {
  return stages.map((stage) => {
    const items = opportunities.filter((o) => o.status === stage.code);
    return {
      key: stage.code,
      stage,
      theme: stage.theme,
      bracketLabel: null,
      items,
      count: items.length,
      openValue: sumExpectedValue(
        items.filter((o) => isOpenPipelineOpportunity(o, { stages })),
      ),
      wonValue: sumExpectedValue(items.filter((o) => isRealizedOpportunity(o, stages))),
    };
  });
}

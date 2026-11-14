// #1045: a flow with no Lost Stage cannot take Mark as Lost (until #785), so
// the menu says so up front instead of letting the server refuse it.
export const NO_LOST_STAGE_REASON = "This Sales Flow has no Lost Stage yet.";

export function noLostStageOnFlow({ isFlowDeal, flowCanvas, lostStages }) {
  return Boolean(isFlowDeal && flowCanvas && lostStages.length === 0);
}

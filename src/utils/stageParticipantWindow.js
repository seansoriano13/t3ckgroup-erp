/**
 * Pure evaluator for a Stage Participant's access window (issue #294).
 *
 * A window is opened with a rule chosen against the calling Stage:
 *   - "stage_left"       — closes when the calling Stage itself is left.
 *   - "stage_entered"    — closes when the chosen later Stage is entered.
 *   - "later_stage_left" — closes when the chosen later Stage is left.
 *   - "terminal"          — never closes on its own; only a Terminal Stage
 *                            closes it (handled separately, below).
 *
 * `window.callingStageId` is the Stage the participant was called in at —
 * in the schema this is never stored directly, it's read off the Stage
 * Visit the window was opened on (`opened_visit_id`). It's passed in here
 * already resolved so this function stays free of any notion of a visit
 * row.
 *
 * Reaching a Terminal Stage always closes every open window regardless of
 * rule — callers should check `isTerminalMove` before consulting a specific
 * window's rule, matching `close_stage_participant_windows()`
 * (20260925000000_stage_participants.sql).
 *
 * A loop back to a Stage before the chosen end Stage is just a move like any
 * other here: each call evaluates one `{fromStageId, toStageId}` move in
 * isolation, so looping through the calling or chosen Stage's neighbourhood
 * without actually entering/leaving the Stage the rule names never closes
 * the window.
 */
export function windowClosesOnMove(window, move) {
  const { untilRule, untilStageId, callingStageId } = window;
  const { fromStageId, toStageId, isTerminalMove = false } = move;

  if (isTerminalMove) return true;

  switch (untilRule) {
    case "stage_left":
      return fromStageId === callingStageId;
    case "stage_entered":
      return toStageId === untilStageId;
    case "later_stage_left":
      return fromStageId === untilStageId;
    case "terminal":
      return false;
    default:
      return false;
  }
}

/**
 * Replays a sequence of moves against a window and returns the move (1-based
 * index into `moves`) that closes it, or null if none do. Used by tests to
 * assert against literal move sequences without re-deriving the loop above
 * each time.
 */
export function findClosingMove(window, moves = []) {
  for (let i = 0; i < moves.length; i += 1) {
    if (windowClosesOnMove(window, moves[i])) return i;
  }
  return null;
}

/**
 * Pure graph helpers over a Sales Flow's drawn moves (`flow_edges`:
 * `{from_stage_id, to_stage_id}`). No Supabase, no service — issue #294's
 * later-Stage picker and the window-rule evaluator both need "what can this
 * Stage reach", and that question has nothing to do with how the edges got
 * loaded.
 */

/**
 * Every Stage reachable from `stageId` by following one or more drawn moves
 * forward. `stageId` itself is included only if a path loops back to it —
 * the picker is choosing an end Stage, not re-offering the start.
 */
export function stagesReachableFrom(stageId, edges = []) {
  const forward = new Map();
  for (const edge of edges) {
    const from = edge.from_stage_id ?? edge.fromStageId;
    const to = edge.to_stage_id ?? edge.toStageId;
    if (from == null || to == null) continue;
    if (!forward.has(from)) forward.set(from, []);
    forward.get(from).push(to);
  }

  const reachable = new Set();
  const queue = [...(forward.get(stageId) || [])];
  while (queue.length > 0) {
    const next = queue.shift();
    if (reachable.has(next)) continue;
    reachable.add(next);
    queue.push(...(forward.get(next) || []));
  }

  return reachable;
}

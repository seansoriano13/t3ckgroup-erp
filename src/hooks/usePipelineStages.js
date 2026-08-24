import { useQuery } from "@tanstack/react-query";
import { pipelineStageService } from "../services/pipelineStageService";
import { PIPELINE_STAGE_SEED, renderableStages } from "../constants/sor";

const SEEDED_ACTIVE = PIPELINE_STAGE_SEED.filter((s) => s.is_active);

/**
 * The configured SOR pipeline, for anything that renders stages — the board's
 * columns, the register's stage filter, the details modal's stepper, the
 * employee matrix.
 *
 * Returns the policy pipeline while the query is in flight rather than an
 * empty array. Every consumer here renders the pipeline as structure, so an
 * empty first paint is a board with no columns and a filter with no options,
 * which reads as breakage rather than as loading. The seed is what the table
 * was seeded from, so the first paint is almost always already correct and the
 * resolved query changes nothing visible.
 *
 * `includeInactive` is for the super admin screen, which manages every stage
 * whether it is offered to pickers or not.
 *
 * `occupiedCodes` is for a board or matrix rendering a set of opportunities:
 * pass the stage codes those opportunities are actually sitting in (their
 * `status` values) and a deactivated stage stays visible for exactly as long
 * as something occupies it. Deactivating a stage removes it from pickers; it
 * must never also make the opportunities inside it disappear.
 */
export function usePipelineStages({ includeInactive = false, occupiedCodes } = {}) {
  const needsInactive = includeInactive || Boolean(occupiedCodes);

  const { data, isLoading } = useQuery({
    queryKey: ["pipelineStages", needsInactive ? "all" : "active"],
    queryFn: () =>
      needsInactive
        ? pipelineStageService.getAllStages()
        : pipelineStageService.getActiveStages(),
    // The pipeline changes on the rare occasion a super admin edits it, and a
    // mutation invalidates ["pipelineStages"] directly, so polling it would be
    // noise on every screen in the Sales module.
    staleTime: 5 * 60 * 1000,
  });

  const fallback = needsInactive ? PIPELINE_STAGE_SEED : SEEDED_ACTIVE;
  const loaded = data ?? fallback;

  return {
    stages: occupiedCodes ? renderableStages(loaded, occupiedCodes) : loaded,
    isLoading,
  };
}

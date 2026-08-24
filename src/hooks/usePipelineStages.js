import { useQuery } from "@tanstack/react-query";
import { pipelineStageService } from "../services/pipelineStageService";
import { PIPELINE_STAGE_SEED } from "../constants/sor";

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
 * `includeInactive` is for the super admin screen and for rendering an
 * opportunity still sitting in a deactivated stage; pickers want the default.
 */
export function usePipelineStages({ includeInactive = false } = {}) {
  const { data, isLoading } = useQuery({
    queryKey: ["pipelineStages", includeInactive ? "all" : "active"],
    queryFn: () =>
      includeInactive
        ? pipelineStageService.getAllStages()
        : pipelineStageService.getActiveStages(),
    // The pipeline changes on the rare occasion a super admin edits it, and a
    // mutation invalidates ["pipelineStages"] directly, so polling it would be
    // noise on every screen in the Sales module.
    staleTime: 5 * 60 * 1000,
  });

  return {
    stages: data ?? (includeInactive ? PIPELINE_STAGE_SEED : SEEDED_ACTIVE),
    isLoading,
  };
}

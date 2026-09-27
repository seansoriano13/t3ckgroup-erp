import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import ReturnMoveDialog from "./ReturnMoveDialog";
import { returnStageIdsQuery } from "./useReturnStageIds";

/**
 * Issue #390 — puts the Resume / Start fresh prompt in front of `move` for a
 * Return; any other move goes straight through. Whether a move is a Return is
 * asked fresh at click time, so a click before any cached read landed still
 * reaches the prompt instead of a refused move.
 *
 * `move(variables)` takes the stage mutation's variables (`next` is the Stage
 * id); the prompt's choice is added as `returnChoice`.
 */
export function useReturnPrompt({ opportunity, stages = [], enabled, move }) {
  const queryClient = useQueryClient();
  // Kept after closing so the dialog's exit animation still names the Stage.
  const [pending, setPending] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  const request = async (variables) => {
    if (!enabled || variables.returnChoice) return move(variables);
    let returnStageIds = [];
    try {
      returnStageIds = await queryClient.fetchQuery(returnStageIdsQuery(opportunity));
    } catch {
      // The move itself still refuses a Return made without a choice.
    }
    if (!returnStageIds.includes(variables.next)) return move(variables);
    const stage = stages.find((s) => s.id === variables.next);
    setPending({ variables, stageName: stage?.name || "this Stage" });
    setIsOpen(true);
  };

  const dialog = (
    <ReturnMoveDialog
      isOpen={isOpen}
      stageName={pending?.stageName}
      onCancel={() => setIsOpen(false)}
      onConfirm={(returnChoice) => {
        const { variables } = pending;
        setIsOpen(false);
        move({ ...variables, returnChoice });
      }}
    />
  );

  return { request, dialog };
}

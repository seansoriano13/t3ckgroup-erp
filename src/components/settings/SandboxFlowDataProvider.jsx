import React, { useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlowDataContext } from './FlowDataContext';
import { useFlowPlanDoc } from '../../hooks/useFlowPlanDoc';
import Spinner from '../ui/Spinner';
import {
  addEdge,
  addStage,
  addStageAction,
  addStageCondition,
  deleteStage,
  readFlowPlan,
  removeEdge,
  removeStageAction,
  removeStageCondition,
  reorderStageActions,
  reorderStageConditions,
  reorderStages,
  setWonStage,
  updateStage,
  updateStageAction,
} from '../../lib/flowPlanDoc';

const SANDBOX_SALE_TYPE = { id: 'sandbox', name: 'Sandbox Flow', is_archived: false };

/**
 * Serves `FlowCanvas` from a Flow Plan's shared document instead of the live
 * flow tables (issues #115, #116).
 *
 * Every method here has the same signature as the real service, so the canvas
 * cannot tell which it is talking to — but nothing it writes touches a live
 * record, and every write goes into the CRDT document, which is what lets two
 * people edit one plan at once without either losing work.
 *
 * `useFlowPlanDoc` handles delivery and persistence; `flowPlanDoc` decides how
 * two edits merge. This file is only the adapter between the canvas's service
 * shape and the document's.
 */
export function SandboxFlowDataProvider({ planId, children }) {
  const queryClient = useQueryClient();
  const { doc, revision, isLoading } = useFlowPlanDoc(planId);

  // Any change to the document — this session's or a peer's — makes the
  // canvas's queries stale. Without this a peer's edit would sit in the
  // document unseen until something else happened to refetch.
  useEffect(() => {
    if (revision === 0) return;
    for (const queryKey of [
      ['saleTypes'],
      ['saleTypes', 'all'],
      ['salesFlow'],
      ['stageConditionsByStage'],
      ['stageActionsByStage'],
    ]) {
      queryClient.invalidateQueries({ queryKey });
    }
  }, [revision, queryClient]);

  const value = useMemo(() => {
    const read = () => readFlowPlan(doc);

    const groupByStage = (rows, stageIds) => {
      const grouped = {};
      for (const stageId of stageIds) {
        grouped[stageId] = rows.filter((row) => row.stage_id === stageId);
      }
      return grouped;
    };

    const salesFlow = {
      getSaleTypes: async () => [SANDBOX_SALE_TYPE],
      getFlow: async () => {
        const { flow, stages, edges } = read();
        return { flow, stages, edges };
      },

      // A plan is a sketch of one flow. Sale types, archiving and the draft/
      // locked lifecycle are properties of the live configuration it is a
      // sketch *of*, so they resolve to the sandbox's single flow rather than
      // pretending to change anything.
      createSaleType: async () => SANDBOX_SALE_TYPE,
      renameSaleType: async () => SANDBOX_SALE_TYPE,
      archiveSaleType: async () => SANDBOX_SALE_TYPE,
      restoreSaleType: async () => SANDBOX_SALE_TYPE,
      deleteSaleType: async () => {},
      lockFlow: async () => read().flow,
      unlockFlow: async () => read().flow,

      addStage: async (_flowId, name, _authorId, posX, posY) =>
        addStage(doc, { name, pos_x: posX, pos_y: posY }),
      updateStagePosition: async (stageId, x, y) =>
        updateStage(doc, stageId, { pos_x: Math.round(x), pos_y: Math.round(y) }),
      renameStage: async (stageId, name) => updateStage(doc, stageId, { name }),
      updateStageColor: async (stageId, color) => updateStage(doc, stageId, { color }),
      updateStageBracket: async (stageId, bracketLabel) =>
        updateStage(doc, stageId, { bracket_label: bracketLabel }),
      setStageTerminal: async (stageId, isTerminal) =>
        updateStage(doc, stageId, { is_terminal: isTerminal }),
      deleteStage: async (stageId) => deleteStage(doc, stageId),

      addEdge: async (_flowId, fromStageId, toStageId) => addEdge(doc, fromStageId, toStageId),
      removeEdge: async (edgeId) => removeEdge(doc, edgeId),
      reorderStages: async (_flowId, orderedStageIds) => reorderStages(doc, orderedStageIds),
      setWonStage: async (_flowId, stageId) => setWonStage(doc, stageId),
    };

    const stageCondition = {
      getForStages: async (stageIds) => groupByStage(read().conditions, stageIds),
      getForStage: async (stageId) => read().conditions.filter((row) => row.stage_id === stageId),
      // The real service takes a camelCase payload and stores the row's own
      // column names; a plan's rows are read by exactly the same components,
      // so the translation has to happen here too.
      add: async ({ stageId, kind, label, isRequired = true, config = {} }) =>
        addStageCondition(doc, {
          stage_id: stageId,
          kind,
          label: (label || '').trim(),
          is_required: Boolean(isRequired),
          config,
        }),
      reorder: async (updates) => reorderStageConditions(doc, updates),
      archive: async (conditionId) => removeStageCondition(doc, conditionId),
    };

    const stageAction = {
      getForStages: async (stageIds) => groupByStage(read().actions, stageIds),
      getForStage: async (stageId) => read().actions.filter((row) => row.stage_id === stageId),
      add: async ({ stageId, kind, config = {} }) =>
        addStageAction(doc, { stage_id: stageId, kind, config }),
      update: async (actionId, config) => updateStageAction(doc, actionId, { config }),
      reorder: async (updates) => reorderStageActions(doc, updates),
      archive: async (actionId) => removeStageAction(doc, actionId),
    };

    return {
      salesFlow,
      stageCondition,
      stageAction,
      // #117: everyone in this plan sees each other, scoped to this plan alone.
      presenceScope: planId,
    };
  }, [doc, planId]);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }

  return (
    <FlowDataContext.Provider value={value}>
      {children}
    </FlowDataContext.Provider>
  );
}

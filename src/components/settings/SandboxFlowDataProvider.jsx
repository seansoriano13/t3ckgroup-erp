import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { flowPlanService } from '../../services/flowPlanService';
import { useAuth } from '../../context/AuthContext';
import { useParams } from 'react-router';
import { FlowDataContext } from './FlowDataContext';
import Spinner from '../ui/Spinner';

function generateId() {
  return crypto.randomUUID();
}

export function SandboxFlowDataProvider({ planId, children }) {
  const { user } = useAuth();
  const [plan, setPlan] = useState(null);
  const [loading, setLoading] = useState(true);

  // Local State representing the flow data
  const [saleTypes, setSaleTypes] = useState([{ id: 'sandbox', name: 'Sandbox Flow', is_archived: false }]);
  const [flow, setFlow] = useState({ id: 'flow-1', sale_type_id: 'sandbox', won_stage_id: null, state: 'draft' });
  const [stages, setStages] = useState([]);
  const [edges, setEdges] = useState([]);
  const [conditions, setConditions] = useState([]);
  const [actions, setActions] = useState([]);

  useEffect(() => {
    async function load() {
      try {
        const data = await flowPlanService.getPlan(planId);
        setPlan(data);
        if (data?.yjs_state) {
          const text = new TextDecoder().decode(data.yjs_state);
          const parsed = JSON.parse(text);
          if (parsed.stages) setStages(parsed.stages);
          if (parsed.edges) setEdges(parsed.edges);
          if (parsed.conditions) setConditions(parsed.conditions);
          if (parsed.actions) setActions(parsed.actions);
          if (parsed.flow) setFlow(parsed.flow);
        }
      } catch (err) {
        console.error("Failed to load plan", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [planId]);

  const saveToDb = useCallback(
    (newState) => {
      const stateObj = {
        stages: newState.stages ?? stages,
        edges: newState.edges ?? edges,
        conditions: newState.conditions ?? conditions,
        actions: newState.actions ?? actions,
        flow: newState.flow ?? flow,
      };
      const text = JSON.stringify(stateObj);
      const uint8 = new TextEncoder().encode(text);
      flowPlanService.savePlan(planId, uint8, user?.id).catch(console.error);
    },
    [planId, user?.id, stages, edges, conditions, actions, flow]
  );

  const mockSalesFlowService = useMemo(() => ({
    getSaleTypes: async () => saleTypes,
    getFlow: async () => ({
      flow,
      stages,
      edges
    }),
    createSaleType: async (name) => {
      const newType = { id: generateId(), name, is_archived: false };
      setSaleTypes(s => [...s, newType]);
      return newType;
    },
    renameSaleType: async (id, name) => {
      setSaleTypes(s => s.map(t => t.id === id ? { ...t, name } : t));
    },
    addStage: async (flowId, name, authorId, pos_x, pos_y) => {
      const newStage = { id: generateId(), flow_id: flowId, name, pos_x, pos_y, is_terminal: false, bracket_label: null };
      const nextStages = [...stages, newStage];
      setStages(nextStages);
      saveToDb({ stages: nextStages });
      return newStage;
    },
    updateStagePosition: async (id, x, y) => {
      const nextStages = stages.map(s => s.id === id ? { ...s, pos_x: x, pos_y: y } : s);
      setStages(nextStages);
      saveToDb({ stages: nextStages });
    },
    renameStage: async (id, name) => {
      const nextStages = stages.map(s => s.id === id ? { ...s, name } : s);
      setStages(nextStages);
      saveToDb({ stages: nextStages });
    },
    updateStageColor: async (id, color) => {
      const nextStages = stages.map(s => s.id === id ? { ...s, color } : s);
      setStages(nextStages);
      saveToDb({ stages: nextStages });
    },
    updateStageBracket: async (id, label) => {
      const nextStages = stages.map(s => s.id === id ? { ...s, bracket_label: label } : s);
      setStages(nextStages);
      saveToDb({ stages: nextStages });
    },
    setStageTerminal: async (id, isTerminal) => {
      const nextStages = stages.map(s => s.id === id ? { ...s, is_terminal: isTerminal } : s);
      setStages(nextStages);
      saveToDb({ stages: nextStages });
    },
    deleteStage: async (id) => {
      const nextStages = stages.filter(s => s.id !== id);
      const nextEdges = edges.filter(e => e.from_stage_id !== id && e.to_stage_id !== id);
      const nextConds = conditions.filter(c => c.stage_id !== id);
      const nextActions = actions.filter(a => a.stage_id !== id);
      setStages(nextStages);
      setEdges(nextEdges);
      setConditions(nextConds);
      setActions(nextActions);
      saveToDb({ stages: nextStages, edges: nextEdges, conditions: nextConds, actions: nextActions });
    },
    addEdge: async (flowId, fromId, toId) => {
      const newEdge = { id: generateId(), flow_id: flowId, from_stage_id: fromId, to_stage_id: toId };
      const nextEdges = [...edges, newEdge];
      setEdges(nextEdges);
      saveToDb({ edges: nextEdges });
    },
    removeEdge: async (id) => {
      const nextEdges = edges.filter(e => e.id !== id);
      setEdges(nextEdges);
      saveToDb({ edges: nextEdges });
    },
    reorderStages: async (flowId, stageIds) => {
      // Just reorder in state
      const sorted = [...stages].sort((a, b) => stageIds.indexOf(a.id) - stageIds.indexOf(b.id));
      setStages(sorted);
      saveToDb({ stages: sorted });
    },
    setWonStage: async (flowId, stageId) => {
      const nextFlow = { ...flow, won_stage_id: stageId };
      setFlow(nextFlow);
      saveToDb({ flow: nextFlow });
    }
  }), [saleTypes, flow, stages, edges, saveToDb, actions, conditions]);

  const mockStageConditionService = useMemo(() => ({
    getForStages: async (stageIds) => {
      const grouped = {};
      stageIds.forEach(id => {
        grouped[id] = conditions.filter(c => c.stage_id === id).sort((a, b) => a.sort_order - b.sort_order);
      });
      return grouped;
    },
    getForStage: async (stageId) => {
      return conditions.filter(c => c.stage_id === stageId).sort((a, b) => a.sort_order - b.sort_order);
    },
    add: async (payload) => {
      const newCond = { id: generateId(), ...payload, sort_order: conditions.length };
      const nextConds = [...conditions, newCond];
      setConditions(nextConds);
      saveToDb({ conditions: nextConds });
    },
    reorder: async (updates) => {
      const nextConds = conditions.map(c => {
        const up = updates.find(u => u.id === c.id);
        return up ? { ...c, sort_order: up.sortOrder } : c;
      });
      setConditions(nextConds);
      saveToDb({ conditions: nextConds });
    },
    archive: async (id) => {
      const nextConds = conditions.filter(c => c.id !== id);
      setConditions(nextConds);
      saveToDb({ conditions: nextConds });
    }
  }), [conditions, saveToDb]);

  const mockStageActionService = useMemo(() => ({
    getForStages: async (stageIds) => {
      const grouped = {};
      stageIds.forEach(id => {
        grouped[id] = actions.filter(c => c.stage_id === id).sort((a, b) => a.sort_order - b.sort_order);
      });
      return grouped;
    },
    getForStage: async (stageId) => {
      return actions.filter(c => c.stage_id === stageId).sort((a, b) => a.sort_order - b.sort_order);
    },
    add: async (payload) => {
      const newAct = { id: generateId(), ...payload, sort_order: actions.length };
      const nextActs = [...actions, newAct];
      setActions(nextActs);
      saveToDb({ actions: nextActs });
    },
    update: async (id, config) => {
      const nextActs = actions.map(a => a.id === id ? { ...a, config } : a);
      setActions(nextActs);
      saveToDb({ actions: nextActs });
    },
    reorder: async (updates) => {
      const nextActs = actions.map(a => {
        const up = updates.find(u => u.id === a.id);
        return up ? { ...a, sort_order: up.sortOrder } : a;
      });
      setActions(nextActs);
      saveToDb({ actions: nextActs });
    },
    archive: async (id) => {
      const nextActs = actions.filter(c => c.id !== id);
      setActions(nextActs);
      saveToDb({ actions: nextActs });
    }
  }), [actions, saveToDb]);

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Spinner /></div>;
  }

  const value = {
    salesFlow: mockSalesFlowService,
    stageCondition: mockStageConditionService,
    stageAction: mockStageActionService,
  };

  return (
    <FlowDataContext.Provider value={value}>
      {children}
    </FlowDataContext.Provider>
  );
}

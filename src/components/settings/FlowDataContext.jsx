import React, { createContext, useContext } from 'react';
import { salesFlowService } from '../../services/salesFlowService';
import { stageConditionService } from '../../services/stageConditionService';
import { stageActionService } from '../../services/stageActionService';

export const FlowDataContext = createContext();

export function useFlowData() {
  const ctx = useContext(FlowDataContext);
  if (!ctx) throw new Error("useFlowData must be used within a FlowDataProvider");
  return ctx;
}

export function FlowDataProvider({ children }) {
  // The one provider behind the canvas since #186 removed the Sandbox: it
  // delegates straight to the live services.
  const value = {
    salesFlow: salesFlowService,
    stageCondition: stageConditionService,
    stageAction: stageActionService,
    // This provider names no presence scope; `FlowCanvas` falls back to a
    // per-Sale-Type live scope so peers on the same flow still see each other.
    presenceScope: null,
  };

  return (
    <FlowDataContext.Provider value={value}>
      {children}
    </FlowDataContext.Provider>
  );
}

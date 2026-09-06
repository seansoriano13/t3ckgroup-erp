import React, { createContext, useContext } from 'react';
import { salesFlowService } from '../../services/salesFlowService';
import { stageConditionService } from '../../services/stageConditionService';
import { stageActionService } from '../../services/stageActionService';

const FlowDataContext = createContext();

export function useFlowData() {
  const ctx = useContext(FlowDataContext);
  if (!ctx) throw new Error("useFlowData must be used within a FlowDataProvider");
  return ctx;
}

export function FlowDataProvider({ children }) {
  // Currently, the live provider just delegates directly to the existing services.
  const value = {
    salesFlow: salesFlowService,
    stageCondition: stageConditionService,
    stageAction: stageActionService,
  };

  return (
    <FlowDataContext.Provider value={value}>
      {children}
    </FlowDataContext.Provider>
  );
}

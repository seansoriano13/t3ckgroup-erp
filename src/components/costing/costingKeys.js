/** React Query keys for the Costing Matrix (#267). One prefix, so a change refreshes all of it. */
export const costingKeys = {
  all: (opportunityId) => ["costing", opportunityId],
  tier: (opportunityId) => ["costing", opportunityId, "tier"],
  matrix: (opportunityId) => ["costing", opportunityId, "matrix"],
  stock: (opportunityId) => ["costing", opportunityId, "stock"],
  requests: (opportunityId) => ["costing", opportunityId, "requests"],
  evaluationList: (opportunityId) => ["costing", opportunityId, "evaluationList"],
  sorLines: (opportunityId) => ["costing", opportunityId, "sorLines"],
  /** The rates and the signer lists (#270) belong to no SOR; the "costing" prefix still refreshes them with the rest. */
  settings: ["costing", "settings"],
  signerLists: ["costing", "signer-lists"],
  // The markup presets (#269) belong to no SOR: they are the business's named factors.
  presets: () => ["costing", "markupPresets"],
  canManageMarkup: () => ["costing", "markupPresets", "can-manage"],
};

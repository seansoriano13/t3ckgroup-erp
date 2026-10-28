/** React Query keys for the Costing Matrix (#267). One prefix, so a change refreshes all of it. */
export const costingKeys = {
  all: (opportunityId) => ["costing", opportunityId],
  tier: (opportunityId) => ["costing", opportunityId, "tier"],
  matrix: (opportunityId) => ["costing", opportunityId, "matrix"],
  stock: (opportunityId) => ["costing", opportunityId, "stock"],
  requests: (opportunityId) => ["costing", opportunityId, "requests"],
  /** The Canvass chip on each Component row (#276). */
  canvasses: (opportunityId) => ["costing", opportunityId, "canvasses"],
  evaluationList: (opportunityId) => ["costing", opportunityId, "evaluationList"],
  /** Typed lines that look like an S0 line, for Sales to confirm (#727). */
  s0Suggestions: (opportunityId) => ["costing", opportunityId, "s0Suggestions"],
  sorLines: (opportunityId) => ["costing", opportunityId, "sorLines"],
  /** The rates and the signer lists (#270) belong to no SOR; the "costing" prefix still refreshes them with the rest. */
  settings: ["costing", "settings"],
  signerLists: ["costing", "signer-lists"],
  // The markup presets (#269) belong to no SOR: they are the business's named factors.
  presets: () => ["costing", "markupPresets"],
  // The cost guide (#723): the categories' ranges belong to no SOR; the guide is per SOR.
  costCategories: () => ["costing", "costCategories"],
  costGuide: (opportunityId) => ["costing", opportunityId, "costGuide"],
  canManageMarkup: () => ["costing", "markupPresets", "can-manage"],
};

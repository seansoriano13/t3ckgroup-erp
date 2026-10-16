/** React Query keys for the Costing Matrix (#267). One prefix, so a change refreshes all of it. */
export const costingKeys = {
  all: (opportunityId) => ["costing", opportunityId],
  tier: (opportunityId) => ["costing", opportunityId, "tier"],
  matrix: (opportunityId) => ["costing", opportunityId, "matrix"],
  stock: (opportunityId) => ["costing", opportunityId, "stock"],
  sorLines: (opportunityId) => ["costing", opportunityId, "sorLines"],
  // The markup presets (#269) belong to no SOR: they are the business's named factors.
  presets: () => ["costing", "markupPresets"],
  canManageMarkup: () => ["costing", "markupPresets", "can-manage"],
};

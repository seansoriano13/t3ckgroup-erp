// A deal going Lost or coming back moves it between lists, counts, commission
// and its own window, so refresh the opportunity-related queries (the keys
// SorModal refreshes on a save) and leave the rest of the app's cache alone.
const OPPORTUNITY_QUERY_KEYS = [
  "opportunities",
  "opportunity",
  "globalOpportunity",
  "opportunityNotes",
  "sorModalTab",
  "sorCanEdit",
  "superAdminActivityLog",
  "commissionBreakdown",
  "stageChecklist",
  "quickViewChecklist",
  "stageFieldValues",
  "revertVisits",
  "blockedDeals",
  "deadlineStatuses",
];

export function invalidateOpportunityQueries(queryClient) {
  OPPORTUNITY_QUERY_KEYS.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
}

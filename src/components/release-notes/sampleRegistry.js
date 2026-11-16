import { BidDecisionSample, IpasPaymentsSample, PmsIpasSample } from "./purchasingSamples"
import { FieldTypesSample } from "./adminSamples"
import { RetailIncomeSample, RetrySample } from "./everydaySamples"
import { CalendarSample, LeaveRangeSample, MeetingRequestSample } from "./timeOffSamples"
import { GroupTaskDatesSample, GroupTaskEvaluationSample, TaskApprovalsSample } from "./taskSamples"
import { ChangeNotesSample, MarkLostSample, MyWorkSample, NeedsAttentionSample, S0CardSample } from "./sorSamples"
import * as demos from "./mainDemos"
import * as scenes from "./mainScenes"

/**
 * Maps an item's `sample` key in content.js to the demo a reader tries: the real component fed
 * Sample Data where there is one, otherwise a small demo of the rule (mainDemos.jsx). The
 * release-notes test fails if an item names a key missing here, if a key here is unused, or if any
 * demo reaches the network.
 *
 * Throwaway (ADR 0030, 2026-11 amendment): a sample renders a real component,
 * but a real component never changes to keep a sample working. If a sample
 * breaks, delete it here and in its file; its item shows as text only.
 */
export const SAMPLES = {
  // SORs
  "my-work": MyWorkSample,
  "mark-lost": MarkLostSample,
  "s0-card": S0CardSample,
  "needs-attention": NeedsAttentionSample,
  "change-notes": ChangeNotesSample,
  "award-dates": demos.AwardDatesDemo,
  // Tasks
  "group-task-evaluation": GroupTaskEvaluationSample,
  "group-task-dates": GroupTaskDatesSample,
  "task-approvals": TaskApprovalsSample,
  "group-task-reopen": demos.ReopenDemo,
  "group-task-teams": demos.TeamPickDemo,
  // Time Off & Calendar
  calendar: CalendarSample,
  "meeting-requests": MeetingRequestSample,
  "leave-range": LeaveRangeSample,
  "meal-break": demos.MealBreakDemo,
  venues: demos.VenuesDemo,
  // Everywhere
  retry: RetrySample,
  links: demos.LinkDemo,
  "chat-actions": demos.ChatActionsDemo,
  "resize-columns": demos.ResizeDemo,
  keyboard: demos.KeyboardDemo,
  pages: demos.PagesDemo,
  // Retail
  "retail-income": RetailIncomeSample,
  // For admins
  "field-types": FieldTypesSample,
  "auto-advance": demos.AutoAdvanceDemo,
  // Purchasing (Beta)
  "s0-evaluation": BidDecisionSample,
  ipas: IpasPaymentsSample,
  "pms-tab": PmsIpasSample,
  "purchase-requests": demos.PurchaseRequestDemo,
  technical: demos.TechnicalDemo,
  canvasses: demos.CanvassOffersDemo,
}

/**
 * Maps an item's `scene` key to what it plays: `{ Before, After }` for a fix, one component for a
 * change. The same test holds these to the same rules as the demos.
 */
export const SCENES = {
  "closed-won": { Before: scenes.ClosedWonBefore, After: scenes.ClosedWonAfter },
  "dashboard-all-tasks": { Before: scenes.DashboardBefore, After: scenes.DashboardAfter },
  "quick-view-tasks": scenes.QuickViewScene,
  "group-task-sor-chat": scenes.TwoChatsScene,
  "sign-out": scenes.SignOutScene,
  "grouped-notifications": scenes.GroupedNotificationsScene,
}

/**
 * How far a reader can play with a sample. Most are live — the real
 * component, so clicks, typing and drags all work and nothing saves — and the
 * page invites the reader to try them. These are not, and must not say so:
 * "look" is locked with ReadOnly, "pictures" are screenshots.
 */
export const SAMPLE_MODE = {}

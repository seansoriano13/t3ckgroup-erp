import * as everywhere from "./everywhereScenes"
import * as sors from "./sorScenes"
import * as timeOff from "./timeOffScenes"
import * as costing from "./costingScenes"
import * as purchasing from "./purchasingSamples"
import { BidDecisionSample, IpasPaymentsSample, PmsIpasSample } from "./purchasingSamplesOctNov"
import { FieldTypesSample } from "./adminSamples"
import { RetailIncomeSample, RetrySample } from "./everydaySamples"
import { CalendarSample, LeaveRangeSample, MeetingRequestSample } from "./timeOffSamples"
import { GroupTaskDatesSample, GroupTaskEvaluationSample, TaskApprovalsSample } from "./taskSamples"
import { ChangeNotesSample, MarkLostSample, MyWorkSample, NeedsAttentionSample, S0CardSample } from "./sorSamples"
import * as demos from "./mainDemos"
import * as scenes from "./mainScenes"

/**
 * Maps an item's `sample` key in content.js to the demo a reader tries: the real component fed
 * Sample Data where there is one, otherwise a small demo of the rule. The release-notes test
 * fails if an item names a key missing here, if a key here is unused, or if any demo reaches the
 * network.
 *
 * Throwaway (ADR 0030, 2026-11 amendment): a demo renders a real component where it can, but a
 * real component never changes to keep a demo working. If one breaks, delete it here and in its
 * file; its item shows as text only.
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
  // Time Off, HR & Calendar
  "available-after": timeOff.AvailableAfterDemo,
  "still-pending": timeOff.StillPendingDemo,
  calendar: CalendarSample,
  "meeting-requests": MeetingRequestSample,
  "leave-range": LeaveRangeSample,
  "meal-break": demos.MealBreakDemo,
  venues: demos.VenuesDemo,
  // Everywhere
  "window-links": everywhere.LinksDemo,
  bell: everywhere.BellDemo,
  "whats-new": everywhere.WhatsNewDemo,
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
  // S0 Evaluation (Beta): the real price corridor, opening on the step each item is about
  corridor: costing.CorridorOffersSample,
  "corridor-final-acquire": costing.CorridorFinalAcquireSample,
  "corridor-other-costs": costing.CorridorOtherCostsSample,
  "go-line": costing.GoLineDemo,
  // Purchasing (Beta)
  "canvass-grid": purchasing.CanvassGridSample,
  "pms-page": purchasing.PmsPageDemo,
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
  // Everywhere
  menu: everywhere.MenuScene,
  "notification-clicks": { Before: everywhere.NotificationClickBefore, After: everywhere.NotificationClickAfter },
  "dead-links": { Before: everywhere.DeadLinkBefore, After: everywhere.DeadLinkAfter },
  "no-access": { Before: everywhere.NoAccessBefore, After: everywhere.NoAccessAfter },
  speed: { Before: everywhere.SpeedBefore, After: everywhere.SpeedAfter },
  "group-task-chat": { Before: everywhere.ChatBefore, After: everywhere.ChatAfter },
  "whats-new-seen": { Before: everywhere.SeenBefore, After: everywhere.SeenAfter },
  "phone-menu": { Before: everywhere.PhoneMenuBefore, After: everywhere.PhoneMenuAfter },
  "sign-out": scenes.SignOutScene,
  "grouped-notifications": scenes.GroupedNotificationsScene,
  // SORs
  "real-stage": { Before: sors.StageBefore, After: sors.StageAfter },
  "sor-number-first": { Before: sors.RowsBefore, After: sors.RowsAfter },
  "mark-lost": { Before: sors.MarkLostBefore, After: sors.MarkLostAfter },
  "register-sor": { Before: sors.RegisterBefore, After: sors.RegisterAfter },
  "history-blocked": { Before: sors.HistoryBefore, After: sors.HistoryAfter },
  "one-count": { Before: sors.CountsBefore, After: sors.CountsAfter },
  "closed-won": { Before: scenes.ClosedWonBefore, After: scenes.ClosedWonAfter },
  "quick-view-tasks": scenes.QuickViewScene,
  // Tasks
  "dashboard-all-tasks": { Before: scenes.DashboardBefore, After: scenes.DashboardAfter },
  "group-task-sor-chat": scenes.TwoChatsScene,
  // Time Off, HR & Calendar
  "file-time-off": { Before: timeOff.OffsetBefore, After: timeOff.OffsetAfter },
  "head-picker": { Before: timeOff.HeadBefore, After: timeOff.HeadAfter },
  "one-colour": { Before: timeOff.ColoursBefore, After: timeOff.ColoursAfter },
  // S0 Evaluation (Beta)
  "odoo-srp": costing.OdooSrpScene,
  "ipas-column": costing.IpasColumnScene,
  decider: costing.DeciderScene,
  "specs-technical": costing.SpecsScene,
  "number-boxes": { Before: costing.WheelBefore, After: costing.WheelAfter },
  "go-floor": { Before: costing.FloorBefore, After: costing.FloorAfter },
  "fits-screen": { Before: costing.FitsBefore, After: costing.FitsAfter },
  // Purchasing (Beta)
  "canvasses-page": purchasing.CanvassesPageScene,
  "canvass-print": purchasing.CanvassPrintScene,
}

/**
 * How far a reader can play with a demo. Most are live — clicks, typing and drags all work and
 * nothing saves — and the page invites the reader to try them. These are not, and must not say so:
 * "look" is locked with ReadOnly, "pictures" are screenshots.
 */
export const SAMPLE_MODE = {}

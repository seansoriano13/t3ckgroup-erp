import {
  SorRegisterSample,
  BoardSample,
  SorSummarySample,
  RevertResumeSample,
  QuickViewSample,
  MySorsSample,
  BlockedMoveSample,
  OpenWonSample,
  StockSample,
} from "./sorSamples"
import {
  ProductListDoublingSample,
  SpuriousAddedProductsSample,
  RegistrationPickersSample,
  BoardEmptyStateSample,
  LostCommissionPoolSample,
  ConsistentLookSample,
} from "./fixSamples"
import {
  TaskFiltersSample,
  ApprovalCenterSample,
  OffsetSample,
  RetailReportSample,
  CommissionPoolSample,
  PageLayoutSample,
} from "./workSamples"
import { TaskSorTagSample } from "./taskSorTagSamples"
import { LeavesManagerSample } from "./leavesManagerSamples"
import { NotificationsSample } from "./notificationSamples"
import { LoginSample } from "./loginSamples"
import { ChatMentionSample } from "./chatSamples"
import { LeaveFormSample, RequestStagesSample, PrintedFormsSample } from "./hrSamples"
import {
  CanvasEditingSample,
  StageAccessSample,
  AlwaysAccessSample,
  StageFieldsSample,
  StageAutomationSample,
  EmployeeGroupsSample,
  SettingsTabsSample,
} from "./adminSamples"

/**
 * Maps an item's `sample` key in content.js to the component that renders it.
 * The release-notes test fails if an item names a key missing here, or if any
 * of these reaches the network.
 */
export const SAMPLES = {
  // SORs
  "sor-register": SorRegisterSample,
  "sor-board": BoardSample,
  "sor-summary": SorSummarySample,
  "revert-resume": RevertResumeSample,
  "quick-view": QuickViewSample,
  "my-sors": MySorsSample,
  "blocked-move": BlockedMoveSample,
  "open-won": OpenWonSample,
  stock: StockSample,
  "product-list-doubling": ProductListDoublingSample,
  "spurious-added-products": SpuriousAddedProductsSample,
  "registration-pickers": RegistrationPickersSample,
  "board-empty-state": BoardEmptyStateSample,
  // Tasks
  "task-filters": TaskFiltersSample,
  "task-sor-tag": TaskSorTagSample,
  "chat-mention": ChatMentionSample,
  // Approvals & Leaves
  "leave-form": LeaveFormSample,
  "request-stages": RequestStagesSample,
  "hr-forms": PrintedFormsSample,
  "approval-center": ApprovalCenterSample,
  "leaves-manager": LeavesManagerSample,
  "offset-hours": OffsetSample,
  // Retail
  "retail-report": RetailReportSample,
  // Commission
  "commission-pool": CommissionPoolSample,
  "lost-commission-pool": LostCommissionPoolSample,
  // Everywhere
  "page-layout": PageLayoutSample,
  notifications: NotificationsSample,
  login: LoginSample,
  "consistent-look": ConsistentLookSample,
  // For admins
  "canvas-editing": CanvasEditingSample,
  "stage-access": StageAccessSample,
  "always-access": AlwaysAccessSample,
  "stage-fields": StageFieldsSample,
  "stage-automation": StageAutomationSample,
  "employee-groups": EmployeeGroupsSample,
  "settings-tabs": SettingsTabsSample,
}

/**
 * How far a reader can play with a sample. Most are live — the real
 * component, so clicks, typing and drags all work and nothing saves — and the
 * page invites the reader to try them. These are not, and must not say so:
 * "look" is locked with ReadOnly, "pictures" are screenshots.
 */
export const SAMPLE_MODE = {
  "stage-automation": "look",
  "employee-groups": "look",
  "registration-pickers": "pictures",
  "board-empty-state": "pictures",
  "consistent-look": "pictures",
}

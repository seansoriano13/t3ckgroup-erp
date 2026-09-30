import {
  MySorsSample,
  StockSample,
  StageAccessSample,
  CanvasEditingSample,
  StageFieldsSample,
} from "./samples"
import {
  QuickViewSample,
  SorsRenameSample,
  RetailSample,
  SorWindowSample,
  BoardSample,
  SorsFiltersSample,
  OpenPipelineSample,
  BlockedMoveSample,
  ItbWonSample,
  StageAutomationSample,
  OffsetSample,
  EmployeeGroupsSample,
} from "./sorSamples"
import {
  LayoutPreviewSample,
  RevertReturnSample,
  AlwaysAccessSample,
  SettingsTabsSample,
  SorsHeaderSample,
  ConsistentLookSample,
} from "./releaseSamples"
import {
  ProductListDoublingSample,
  SpuriousAddedProductsSample,
  LostCommissionPoolSample,
  RegistrationPickersSample,
  BoardEmptyStateSample,
} from "./fixSamples"

/**
 * Maps a supplement row's `sample` key to the component that renders it —
 * headline rows and under-the-hood fixes alike. A headline row must have
 * one; an under-the-hood fix may skip it (see ADR 0022) when there is
 * nothing to show — an older entry recorded before every fix got a slide.
 */
export const SAMPLES = {
  // 14–21 September
  "my-sors": MySorsSample,
  "quick-view": QuickViewSample,
  "sors-rename": SorsRenameSample,
  "retail-screen": RetailSample,
  "sor-window": SorWindowSample,
  "crm-board": BoardSample,
  "sors-filters": SorsFiltersSample,
  "open-pipeline": OpenPipelineSample,
  "stage-access": StageAccessSample,
  "stage-fields": StageFieldsSample,
  "flow-canvas-editing": CanvasEditingSample,
  "blocked-move": BlockedMoveSample,
  "crm-itb-won": ItbWonSample,
  "stage-automation": StageAutomationSample,
  "stock-badges": StockSample,
  "offset-approved-hours": OffsetSample,
  "employee-groups": EmployeeGroupsSample,
  // 21–28 September
  "layout-preview": LayoutPreviewSample,
  "revert-return": RevertReturnSample,
  "always-access": AlwaysAccessSample,
  "settings-tabs": SettingsTabsSample,
  "sors-header": SorsHeaderSample,
  "consistent-look": ConsistentLookSample,
  "product-list-doubling": ProductListDoublingSample,
  "spurious-added-products": SpuriousAddedProductsSample,
  "lost-commission-pool": LostCommissionPoolSample,
  "registration-pickers": RegistrationPickersSample,
  "board-empty-state": BoardEmptyStateSample,
}

/**
 * Samples that open a real record from the environment the deck is open in —
 * not made-up data. The slide says so, because what is clicked there really
 * happens (a Super Admin acting on a live SOR, or clicking the demo SOR).
 */
export const LIVE_SAMPLES = new Set(["sor-window", "layout-preview", "revert-return"])

/** Samples that are a before/after pair rather than one component. */
export const BEFORE_AFTER_SAMPLES = new Set([
  "consistent-look",
  "product-list-doubling",
  "spurious-added-products",
  "lost-commission-pool",
  "registration-pickers",
  "board-empty-state",
])

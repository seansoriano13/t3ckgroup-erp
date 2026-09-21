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

/**
 * Maps a supplement row's `sample` key (its id) to the component that renders
 * it. Every headline row must have one; the generator refuses a row without.
 */
export const SAMPLES = {
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
}

/**
 * Samples that show real records from the environment the deck is open in,
 * not made-up data. The slide says so, because a Super Admin can act on them.
 */
export const LIVE_SAMPLES = new Set(["sor-window"])

import {
  FlowVersioningDemo,
  CrmBoardDemo,
  StageFieldsDemo,
  BlockedMoveDemo,
  StockBadgesDemo,
  LoginDemo,
} from "./demos"

/**
 * Maps a supplement row's `demo` key to the component that renders it.
 *
 * Kept apart from demos.jsx so that file exports components and nothing else
 * — a non-component export there makes fast refresh give up on all of them.
 */
export const DEMOS = {
  "flow-versioning": FlowVersioningDemo,
  "crm-board": CrmBoardDemo,
  "stage-fields": StageFieldsDemo,
  "blocked-move": BlockedMoveDemo,
  "stock-badges": StockBadgesDemo,
  login: LoginDemo,
}

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
 * headline rows and under-the-hood fixes alike. Every one must have one; the
 * generator refuses a row or fix without.
 */
export const SAMPLES = {
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
 * the demo SOR — not made-up data. The slide says so, because what is clicked
 * there really happens.
 */
export const LIVE_SAMPLES = new Set(["layout-preview", "revert-return"])

/** Samples that are a before/after pair rather than one component. */
export const BEFORE_AFTER_SAMPLES = new Set([
  "consistent-look",
  "product-list-doubling",
  "spurious-added-products",
  "lost-commission-pool",
  "registration-pickers",
  "board-empty-state",
])

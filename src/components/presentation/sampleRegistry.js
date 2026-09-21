import {
  MySorsSample,
  StockSample,
  StageAccessSample,
  CanvasEditingSample,
  StageFieldsSample,
} from "./samples"

/** Maps a supplement row's `sample` key to the component that renders it. */
export const SAMPLES = {
  "my-sors": MySorsSample,
  "stock-badges": StockSample,
  "stage-access": StageAccessSample,
  "flow-canvas-editing": CanvasEditingSample,
  "stage-fields": StageFieldsSample,
}

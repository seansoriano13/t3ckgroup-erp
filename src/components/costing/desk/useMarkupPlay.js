import { useState } from "react";

import { costingMatrixService } from "../../../services/costingMatrixService";
import { COMPONENT_COST_BANDS, COSTING_BAND, MATRIX_MONEY_BANDS, inAnyBand } from "../../../constants/costing";
import { linePreview, matrixPlay } from "../../../utils/costingPlayground";

const clamp = (value) => Math.min(5, Math.max(0.5, Math.round(value * 10000) / 10000));
const DEFAULT_TRY = 1.35;

/**
 * The markup being tried on the Costing Desk (#931), shared by the playground bar and the Lines table:
 * the factor in the box, the two switches, what the matrix would be offered at, and per line what the
 * table previews. Nothing is saved while trying. `previewing` is on from the first thing tried until the
 * box is cleared or Apply has saved; `apply` saves exactly the previewed prices. Null for a viewer who
 * is not sent the Closed Book (no matrix, or `enabled` false).
 *
 * When the saved markup changes (Apply, or someone else), the box starts again from it.
 */
export function useMarkupPlay(matrix, writes, { enabled = true } = {}) {
  const saved = matrix?.defaultFactor == null ? null : Number(matrix.defaultFactor);
  const [base, setBase] = useState(saved);
  const [tried, setTried] = useState(saved ?? DEFAULT_TRY);
  // What is in the box while typing ("1." on the way to "1.5"), apart from the factor it stands for.
  const [typed, setTyped] = useState(String(saved ?? DEFAULT_TRY));
  const [presetId, setPresetId] = useState(matrix?.defaultPresetId ?? null);
  const [capAtAbc, setCapAtAbc] = useState(true);
  const [ignoreOwn, setIgnoreOwn] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  // The saved markup moved: start again from it, out of the preview.
  if (base !== saved) {
    setBase(saved);
    setTried(saved ?? DEFAULT_TRY);
    setTyped(String(saved ?? DEFAULT_TRY));
    setPresetId(matrix?.defaultPresetId ?? null);
    setIgnoreOwn(false);
    setPreviewing(false);
  }

  if (!matrix || !enabled) return null;

  const play = matrixPlay(matrix, tried, { capAtAbc, ignoreOwn });
  // Parts with a markup of their own keep it unless the playground is told to price them all.
  const withOwn = matrix.tenderLines.flatMap((l) => l.components).filter((c) => c.markup_factor != null);
  const canSaveFactor = inAnyBand(matrix.bands, MATRIX_MONEY_BANDS.default_factor);
  const canFillOffers = matrix.bands.includes(COSTING_BAND.SALES);
  const canClearOwn = inAnyBand(matrix.bands, COMPONENT_COST_BANDS.markup_factor);
  const changed =
    play.lines.some((l, i) => l.offerUnit !== null && Number(l.offerUnit) !== Number(matrix.tenderLines[i].final_offer_unit)) ||
    tried !== saved ||
    (ignoreOwn && withOwn.length > 0);

  const preview = previewing
    ? new Map(matrix.tenderLines.map((line, i) => [line.id, linePreview(line, play.lines[i], { ignoreOwn })]))
    : null;

  const pick = (value, preset = null) => {
    const next = clamp(value);
    setTried(next);
    setTyped(String(next));
    setPresetId(preset);
    setPreviewing(true);
  };
  const type = (text) => {
    setTyped(text);
    // Clearing the box ends the preview and goes back to the saved markup. The switches stay as they
    // are, so retyping a number keeps them; the Clear button resets those too.
    if (text.trim() === "") {
      setTried(saved ?? DEFAULT_TRY);
      setPresetId(matrix.defaultPresetId ?? null);
      setPreviewing(false);
      return;
    }
    const n = Number(text);
    if (Number.isFinite(n) && n > 0) {
      setTried(clamp(n));
      setPresetId(null);
      setPreviewing(true);
    }
  };
  const clear = () => {
    setTried(saved ?? DEFAULT_TRY);
    setTyped(String(saved ?? DEFAULT_TRY));
    setPresetId(matrix.defaultPresetId ?? null);
    setIgnoreOwn(false);
    setPreviewing(false);
  };

  const apply = async () => {
    // The prices being previewed are the ones saved, worked out before anything is written.
    const offers = matrix.tenderLines
      .map((line, i) => ({ line, offerUnit: play.lines[i].offerUnit }))
      .filter(({ line, offerUnit }) => offerUnit !== null && Number(offerUnit) !== Number(line.final_offer_unit));
    await writes.run(async () => {
      if (canSaveFactor && tried !== saved) {
        await costingMatrixService.setDefaultMarkup(matrix.matrixId, presetId ? { presetId } : { factor: tried });
      }
      if (ignoreOwn && canClearOwn) {
        for (const c of withOwn) await costingMatrixService.updateComponent(c.id, { markupFactor: null });
      }
      if (canFillOffers) {
        for (const { line, offerUnit } of offers) await costingMatrixService.updateTenderLine(line.id, { finalOfferUnit: offerUnit });
      }
    });
    setPreviewing(false);
  };

  return {
    saved,
    tried,
    typed,
    presetId,
    capAtAbc,
    ignoreOwn,
    previewing,
    play,
    preview,
    withOwn,
    changed,
    canSaveFactor,
    canFillOffers,
    canClearOwn,
    pick,
    type,
    clear,
    apply,
    setCapAtAbc: (on) => {
      setCapAtAbc(on);
      setPreviewing(true);
    },
    setIgnoreOwn: (on) => {
      setIgnoreOwn(on);
      setPreviewing(true);
    },
    blur: () => setTyped(String(tried)),
  };
}


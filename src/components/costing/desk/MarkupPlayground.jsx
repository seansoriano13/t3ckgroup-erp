import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus } from "lucide-react";

import { Button } from "../../ui/button";
import { FieldBox } from "../../ui/FieldBox";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import StatusBadge from "../../StatusBadge";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COMPONENT_COST_BANDS, COSTING_BAND, MATRIX_MONEY_BANDS, inAnyBand } from "../../../constants/costing";
import { matrixPlay } from "../../../utils/costingPlayground";
import { cn } from "../../../lib/utils";
import { costingKeys } from "../costingKeys";
import { factorLabel, percentLabel, pesos } from "../gridFormat";

const clamp = (value) => Math.min(5, Math.max(0.5, Math.round(value * 10000) / 10000));

/**
 * The markup playground (Costing Desk), for the Closed Book: try a markup factor and see, before
 * anything is saved, what every line would be offered at, how that sits against the ABC and what it
 * earns. Apply saves the factor as the matrix's markup and fills every line's Final Offer from it (kept
 * at the line's ABC when asked); a line whose parts have no Acquire yet is left as it is. A part with a
 * factor of its own keeps it. Who may save what is the database's rule: the factor is Sales', and Purchasing's,
 * the Final Offers are Sales'.
 */
export default function MarkupPlayground({ matrix, writes }) {
  const { busy, run } = writes;
  const saved = matrix.defaultFactor == null ? null : Number(matrix.defaultFactor);
  const [tried, setTried] = useState(saved ?? 1.35);
  // What is in the box while typing ("1." on the way to "1.5"), apart from the factor it stands for.
  const [typed, setTyped] = useState(String(saved ?? 1.35));
  const [presetId, setPresetId] = useState(matrix.defaultPresetId ?? null);
  const [capAtAbc, setCapAtAbc] = useState(true);
  const [ignoreOwn, setIgnoreOwn] = useState(false);
  const canSaveFactor = inAnyBand(matrix.bands, MATRIX_MONEY_BANDS.default_factor);
  const canFillOffers = matrix.bands.includes(COSTING_BAND.SALES);

  const { data: presets = [] } = useQuery({
    queryKey: costingKeys.presets(),
    queryFn: () => costingMatrixService.listPresets(),
    retry: false,
  });
  const offered = presets.filter((p) => p.active || p.id === matrix.defaultPresetId);

  const play = matrixPlay(matrix, tried, { capAtAbc, ignoreOwn });
  // Parts with a markup of their own keep it unless the playground is told to price them all.
  const withOwn = matrix.tenderLines.flatMap((l) => l.components).filter((c) => c.markup_factor != null);
  const canClearOwn = inAnyBand(matrix.bands, COMPONENT_COST_BANDS.markup_factor);
  const changed =
    play.lines.some((l, i) => l.offerUnit !== null && Number(l.offerUnit) !== Number(matrix.tenderLines[i].final_offer_unit)) ||
    tried !== saved ||
    (ignoreOwn && withOwn.length > 0);
  const achieved = matrix.markup.achievedFactor;
  const target = matrix.markup.targetFactor;

  const pick = (value, preset = null) => {
    const next = clamp(value);
    setTried(next);
    setTyped(String(next));
    setPresetId(preset);
  };
  const type = (text) => {
    setTyped(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && n > 0) {
      setTried(clamp(n));
      setPresetId(null);
    }
  };

  const apply = () =>
    run(async () => {
      if (canSaveFactor && tried !== saved) {
        await costingMatrixService.setDefaultMarkup(matrix.matrixId, presetId ? { presetId } : { factor: tried });
      }
      if (ignoreOwn && canClearOwn) {
        for (const c of withOwn) await costingMatrixService.updateComponent(c.id, { markupFactor: null });
      }
      if (canFillOffers) {
        for (const [i, line] of matrix.tenderLines.entries()) {
          const offerUnit = play.lines[i].offerUnit;
          if (offerUnit !== null && Number(offerUnit) !== Number(line.final_offer_unit)) {
            await costingMatrixService.updateTenderLine(line.id, { finalOfferUnit: offerUnit });
          }
        }
      }
    });

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Markup playground" data-testid="markup-default">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-label font-bold uppercase tracking-wider text-muted-foreground">Markup playground</h2>
        <span className="text-xs text-muted-foreground" data-testid="markup-default-shown">
          Saved: {saved == null ? "none yet" : `${factorLabel(saved)} ${percentLabel(saved)}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="icon-sm" aria-label="Lower the markup to try" onClick={() => pick(tried - 0.01)}>
          <Minus size={14} />
        </Button>
        <Input
          type="number"
          step="0.01"
          min="0.5"
          aria-label="Markup factor to try"
          value={typed}
          onChange={(e) => type(e.target.value)}
          onBlur={() => setTyped(String(tried))}
          containerClassName="w-24"
          className="text-center font-mono tabular-nums"
        />
        <Button type="button" variant="outline" size="icon-sm" aria-label="Raise the markup to try" onClick={() => pick(tried + 0.01)}>
          <Plus size={14} />
        </Button>
        <span className="font-mono text-xs text-muted-foreground">{percentLabel(tried)}</span>
      </div>
      {offered.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="Markup presets">
          {offered.map((p) => (
            <Button key={p.id} type="button" size="xs" variant={presetId === p.id ? "secondary" : "ghost"} onClick={() => pick(Number(p.factor), p.id)}>
              {p.label} {factorLabel(p.factor)}
            </Button>
          ))}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]" data-testid="markup-preview">
        <div>
          <dt className="text-xs text-muted-foreground">Offer at this markup</dt>
          <dd className="font-mono font-semibold tabular-nums">{pesos(play.offerTotal)}</dd>
          <dd className="text-xs text-muted-foreground">{play.percentOfAbc == null ? "ABC not complete" : `${play.percentOfAbc}% of the ABC`}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Margin</dt>
          <dd className={cn("font-mono font-semibold tabular-nums", play.margin != null && play.margin < 0 && "text-red-11")}>{pesos(play.margin)}</dd>
          <dd className="text-xs text-muted-foreground">{play.marginPercent == null ? "Needs every cost" : `${play.marginPercent}% of the offer`}</dd>
        </div>
      </dl>
      {play.unpriced > 0 && (
        <p className="text-xs text-amber-11">
          {play.unpriced} line{play.unpriced === 1 ? " has" : "s have"} no Acquire yet, so {play.unpriced === 1 ? "it is" : "they are"} left as {play.unpriced === 1 ? "it is" : "they are"}.
        </p>
      )}
      {capAtAbc && play.capped > 0 && (
        <p className="text-xs text-muted-foreground">
          {play.capped} line{play.capped === 1 ? " is" : "s are"} kept at the ABC.
        </p>
      )}

      <FieldBox inline className="text-[13px]">
        <Switch checked={capAtAbc} onCheckedChange={setCapAtAbc} />
        <span>Keep each line at or under its ABC</span>
      </FieldBox>
      {withOwn.length > 0 && (
        <div className="space-y-1.5 rounded-lg bg-muted/40 p-2.5">
          <p className="text-xs text-muted-foreground">
            {withOwn.length} part{withOwn.length === 1 ? " has" : "s have"} a markup of {withOwn.length === 1 ? "its" : "their"} own (
            {[...new Set(withOwn.map((c) => factorLabel(c.markup_factor)))].join(", ")}), which {ignoreOwn ? "Apply clears" : "the factor above does not change"}.
          </p>
          {canClearOwn && (
            <FieldBox inline className="text-[13px]">
              <Switch checked={ignoreOwn} onCheckedChange={setIgnoreOwn} />
              <span>Price every part at this markup</span>
            </FieldBox>
          )}
        </div>
      )}

      {canSaveFactor || canFillOffers ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
          <Button type="button" variant="outline" size="sm" disabled={busy || !changed} onClick={apply}>
            {canFillOffers ? `Apply ${factorLabel(tried)} to the Final Offers` : `Save ${factorLabel(tried)} as the markup`}
          </Button>
          <span className="text-xs text-muted-foreground">{changed ? "Nothing changes until you apply." : "The Final Offers already match."}</span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Only the Markup list sets the markup.</p>
      )}

      <div className="space-y-1 border-t border-border pt-3" data-testid="markup-overall">
        <p className="text-xs text-muted-foreground">Achieved markup now (Final Offer over cost, with the other costs)</p>
        {achieved === null ? (
          <p className="text-sm text-muted-foreground">Not known yet</p>
        ) : (
          <p className="flex flex-wrap items-center gap-2 text-sm tabular-nums">
            <span className="font-semibold">
              {factorLabel(achieved)} {percentLabel(achieved)}
            </span>
            {target !== null && (
              <span className="text-muted-foreground">
                against {factorLabel(target)} {percentLabel(target)}
              </span>
            )}
            {achieved !== null && target !== null && achieved < target && <StatusBadge label="Under target" theme="amber" title="The Final Offer is below what the markup suggests" />}
          </p>
        )}
      </div>
    </section>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, X } from "lucide-react";

import { Button } from "../../ui/button";
import { FieldBox } from "../../ui/FieldBox";
import { Input } from "../../ui/input";
import { Switch } from "../../ui/switch";
import StatusBadge from "../../StatusBadge";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { cn } from "../../../lib/utils";
import { costingKeys } from "../costingKeys";
import { factorLabel, percentLabel, pesos } from "../gridFormat";

const plural = (n, one, many) => (n === 1 ? one : many);

/**
 * The markup playground (Costing Desk, #931): a bar directly above the Lines table, for the Closed Book.
 * Try a markup factor (its % beside it) and the Lines table previews every line's Final Offer at it, with
 * the new total, how it sits against the ABC and what it earns here. Apply saves the factor as the
 * matrix's markup and fills every line's Final Offer with the previewed price (kept at the line's ABC
 * when asked); a line whose parts have no Acquire yet is left as it is, and a part with a factor of its
 * own keeps it unless every part is priced at this markup. Who may save what is the database's rule:
 * the factor is Sales' and Purchasing's, the Final Offers are Sales'.
 */
export default function MarkupPlayground({ markup, matrix, busy }) {
  const { data: presets = [] } = useQuery({
    queryKey: costingKeys.presets(),
    queryFn: () => costingMatrixService.listPresets(),
    retry: false,
  });
  const offered = presets.filter((p) => p.active || p.id === matrix.defaultPresetId);
  const { play, saved, tried, withOwn } = markup;
  const achieved = matrix.markup.achievedFactor;
  const target = matrix.markup.targetFactor;

  return (
    <section
      className={cn("space-y-3 rounded-xl border bg-card p-3", markup.previewing ? "border-violet-7" : "border-border")}
      aria-label="Markup playground"
      data-testid="markup-default"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h4 className="text-label font-bold uppercase tracking-wider text-muted-foreground">Try a markup</h4>
        <div className="flex items-center gap-1.5">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Lower the markup to try" onClick={() => markup.pick(tried - 0.01)}>
            <Minus size={14} />
          </Button>
          <Input
            type="number"
            step="0.01"
            min="0.5"
            aria-label="Markup factor to try"
            value={markup.typed}
            onChange={(e) => markup.type(e.target.value)}
            onBlur={markup.blur}
            containerClassName="w-24"
            className="text-center font-mono tabular-nums"
          />
          <Button type="button" variant="outline" size="icon-sm" aria-label="Raise the markup to try" onClick={() => markup.pick(tried + 0.01)}>
            <Plus size={14} />
          </Button>
          <span className="w-14 font-mono text-sm font-semibold tabular-nums" data-testid="markup-percent">
            {percentLabel(tried)}
          </span>
        </div>
        {offered.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Markup presets">
            {offered.map((p) => (
              <Button key={p.id} type="button" size="xs" variant={markup.presetId === p.id ? "secondary" : "ghost"} onClick={() => markup.pick(Number(p.factor), p.id)}>
                {p.label} {factorLabel(p.factor)}
              </Button>
            ))}
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground" data-testid="markup-default-shown">
          Saved: {saved == null ? "none yet" : `${factorLabel(saved)} ${percentLabel(saved)}`}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <FieldBox inline className="text-[13px]">
          <Switch checked={markup.capAtAbc} onCheckedChange={markup.setCapAtAbc} />
          <span>Keep each line at or under its ABC</span>
        </FieldBox>
        {withOwn.length > 0 && markup.canClearOwn && (
          <FieldBox inline className="text-[13px]">
            <Switch checked={markup.ignoreOwn} onCheckedChange={markup.setIgnoreOwn} />
            <span>Price every part at this markup</span>
          </FieldBox>
        )}
      </div>
      {withOwn.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {withOwn.length} {plural(withOwn.length, "part has", "parts have")} a markup of {plural(withOwn.length, "its", "their")} own (
          {[...new Set(withOwn.map((c) => factorLabel(c.markup_factor)))].join(", ")}), which {markup.ignoreOwn ? "Apply clears" : "the factor above does not change"}.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 border-t border-border pt-3">
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]" data-testid="markup-preview">
          <div>
            <dt className="text-xs text-muted-foreground">New total at {factorLabel(tried)}</dt>
            <dd className="font-mono font-semibold tabular-nums">{pesos(play.offerTotal)}</dd>
            <dd className="text-xs text-muted-foreground">{play.percentOfAbc == null ? "ABC not complete" : `${play.percentOfAbc}% of the ABC`}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Margin</dt>
            <dd className={cn("font-mono font-semibold tabular-nums", play.margin != null && play.margin < 0 && "text-red-11")}>{pesos(play.margin)}</dd>
            <dd className="text-xs text-muted-foreground">{play.marginPercent == null ? "Needs every cost" : `${play.marginPercent}% of the offer`}</dd>
          </div>
        </dl>

        {markup.canSaveFactor || markup.canFillOffers ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground" role="status">
              {busy
                ? "Saving, the figures update in a moment…"
                : markup.previewing
                  ? "Previewing in the Lines table. Nothing changes until you apply."
                  : markup.changed
                    ? "Nothing changes until you apply."
                    : "The Final Offers already match."}
            </span>
            {markup.previewing && (
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={markup.clear}>
                <X size={14} aria-hidden="true" />
                Clear
              </Button>
            )}
            <Button type="button" size="sm" disabled={busy || !markup.changed} aria-busy={busy || undefined} onClick={markup.apply}>
              {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              {markup.canFillOffers ? `Apply ${factorLabel(tried)} to the Final Offers` : `Save ${factorLabel(tried)} as the markup`}
            </Button>
          </div>
        ) : (
          <p className="ml-auto text-xs text-muted-foreground">Only the Markup list sets the markup.</p>
        )}
      </div>
      {(play.unpriced > 0 || (markup.capAtAbc && play.capped > 0)) && (
        <p className="text-xs text-muted-foreground">
          {play.unpriced > 0 && (
            <span className="text-amber-11">
              {play.unpriced} {plural(play.unpriced, "line has", "lines have")} no Acquire yet, so {plural(play.unpriced, "it is left as it is", "they are left as they are")}.{" "}
            </span>
          )}
          {markup.capAtAbc && play.capped > 0 && `${play.capped} ${plural(play.capped, "line is", "lines are")} kept at the ABC.`}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs" data-testid="markup-overall">
        <span className="text-muted-foreground">Achieved markup now (Final Offer over cost, with the other costs):</span>
        {achieved === null ? (
          <span className="text-muted-foreground">Not known yet</span>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {factorLabel(achieved)} {percentLabel(achieved)}
            </span>
            {target !== null && (
              <span className="text-muted-foreground tabular-nums">
                against {factorLabel(target)} {percentLabel(target)}
              </span>
            )}
            {target !== null && achieved < target && <StatusBadge label="Under target" theme="amber" title="The Final Offer is below what the markup suggests" />}
          </>
        )}
      </div>
    </section>
  );
}

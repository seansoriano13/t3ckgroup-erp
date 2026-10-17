import { useQuery } from "@tanstack/react-query";

import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { MATRIX_MONEY_BANDS, inAnyBand } from "../../constants/costing";
import { costingKeys } from "./costingKeys";
import { Cell } from "./GridCell";
import { factorLabel, percentLabel } from "./gridFormat";

const NONE = "__typed__";

/**
 * The matrix's markup (#269), shown to the Closed Book only: the default factor (×1.35 and +35%), picked
 * from a preset or typed, and the overall achieved markup against the target. Only the Final Acquire list
 * can change the factor (the database decides), so for a Super Admin who is not on it the factor is read-only.
 * Picking a preset copies its factor: editing the preset later does not move this matrix. A Component or a
 * cost-only row with a factor of its own keeps it when the default changes. Changing the factor never
 * touches Final Offer: nothing fills it.
 */
export default function MarkupDefault({ matrix, writes }) {
  const { busy, run, refresh } = writes;
  const canWrite = inAnyBand(matrix.bands, MATRIX_MONEY_BANDS.default_factor);

  const { data: presets = [] } = useQuery({
    queryKey: costingKeys.presets(),
    queryFn: () => costingMatrixService.listPresets(),
    retry: false,
  });
  // A preset that has since been switched off stays on the list while this matrix uses it.
  const offered = presets.filter((preset) => preset.active || preset.id === matrix.defaultPresetId);
  const options = [
    { value: NONE, label: "Typed" },
    ...offered.map((preset) => ({ value: preset.id, label: `${preset.label} (${factorLabel(preset.factor)})` })),
  ];

  const { defaultFactor, markup } = matrix;
  const achieved = markup.achievedFactor;
  const target = markup.targetFactor;
  const under = achieved !== null && target !== null && achieved < target;

  return (
    <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-xl border border-border/70 bg-card px-4 py-3" data-testid="markup-default">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Default markup</p>
        <p className="text-sm tabular-nums" data-testid="markup-default-shown">
          <span className="font-semibold">{defaultFactor ? factorLabel(defaultFactor) : "None yet"}</span>
          {defaultFactor ? (
            <>
              {" "}
              <span className="ml-1 text-muted-foreground">{percentLabel(defaultFactor)}</span>
            </>
          ) : null}
        </p>
      </div>

      {canWrite ? (
        <>
          <div className="w-52">
            <SelectField
              aria-label="Markup preset"
              size="sm"
              options={options}
              value={matrix.defaultPresetId ?? NONE}
              disabled={busy}
              onChange={(value) => {
                if (value === NONE) return;
                run(() => costingMatrixService.setDefaultMarkup(matrix.matrixId, { presetId: value }));
              }}
            />
          </div>
          <div className="w-32">
            <Cell
              label="Default markup factor"
              noun="Markup factor"
              value={defaultFactor}
              numeric
              step="0.0001"
              align="right"
              placeholder="e.g. 1.35"
              onSave={async (value) => {
                await costingMatrixService.setDefaultMarkup(matrix.matrixId, { factor: value });
                await refresh();
              }}
            />
          </div>
        </>
      ) : (
        <p className="max-w-xs text-xs text-muted-foreground">The Final Acquire list sets the markup factor.</p>
      )}

      <div className="ml-auto space-y-1 text-right" data-testid="markup-overall">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Achieved markup</p>
        {achieved === null ? (
          <p className="text-sm text-muted-foreground">Not known yet</p>
        ) : (
          <p className="flex flex-wrap items-center justify-end gap-2 text-sm tabular-nums">
            <span className="font-semibold">
              {factorLabel(achieved)} {percentLabel(achieved)}
            </span>
            {target !== null && (
              <span className="text-muted-foreground">
                against {factorLabel(target)} {percentLabel(target)}
              </span>
            )}
            {under && <StatusBadge label="Under target" theme="amber" title="The Final Offer is below what the markup suggests" />}
          </p>
        )}
        <p className="text-xs text-muted-foreground">Final Offer over cost, counting cost-only rows.</p>
      </div>
    </div>
  );
}

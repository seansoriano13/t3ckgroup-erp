import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import { SelectField } from "../ui/SelectField";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COMPLETENESS_LABELS, COMPLETENESS_VALUES } from "../../constants/projectEvaluation";
import { INCLUSION_BANDS, ROW_EDIT_BANDS, inAnyBand } from "../../constants/costing";
import { Cell, SelectCell } from "./GridCell";

const COMPLETENESS_OPTIONS = COMPLETENESS_VALUES.map((value) => ({ value, label: COMPLETENESS_LABELS[value] }));

/**
 * A bundle Component's Inclusions (#268): unpriced check rows, grouped under their headings
 * ("Accessories", "With"), collapsible. Sales or Purchasing add, edit, move and remove them;
 * Completeness is Technical's. `otherBundles` are the matrix's other bundle Components, for
 * moving an "Unplaced inclusions" row under the bundle it belongs to.
 */
export default function InclusionList({ component, bands, otherBundles, writes }) {
  const [open, setOpen] = useState(true);
  const { busy, run, refresh } = writes;
  const canEdit = inAnyBand(bands, ROW_EDIT_BANDS);
  const canCheck = inAnyBand(bands, INCLUSION_BANDS.completeness);
  const { completeness } = component;

  const save = async (inclusion, fields) => {
    await costingMatrixService.updateInclusion(inclusion.id, fields);
    await refresh();
  };

  return (
    <div className="space-y-2" data-testid="inclusions" aria-label={`Inclusions of ${component.number}`}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
        Inclusions
        <span className="font-normal normal-case tracking-normal">
          {component.inclusions.length === 0
            ? "none yet"
            : completeness.counted === 0
              ? `${component.inclusions.length} not required`
              : `${completeness.covered} of ${completeness.counted} covered`}
        </span>
      </Button>

      {open && (
        <div className="space-y-3 pl-5">
          {component.inclusionGroups.map((group) => (
            <div key={group.heading ?? "__none__"} className="space-y-1.5">
              {group.heading && <p className="text-xs font-semibold text-foreground">{group.heading}</p>}
              {group.items.map((inclusion) => (
                <div key={inclusion.id} className="flex flex-wrap items-start gap-2" data-testid="inclusion">
                  <Cell
                    className="min-w-[14rem] flex-1"
                    label={`Inclusion ${component.number}.${inclusion.position} description`}
                    noun="Description"
                    value={inclusion.description}
                    readOnly={!canEdit}
                    onSave={(value) => save(inclusion, { description: value })}
                  />
                  <Cell
                    className="w-20"
                    label={`Inclusion ${component.number}.${inclusion.position} quantity`}
                    noun="Quantity"
                    value={inclusion.quantity}
                    numeric
                    required
                    align="right"
                    readOnly={!canEdit}
                    onSave={(value) => save(inclusion, { quantity: value })}
                  />
                  <Cell
                    className="w-20"
                    label={`Inclusion ${component.number}.${inclusion.position} unit`}
                    value={inclusion.unit}
                    placeholder="unit"
                    readOnly={!canEdit}
                    onSave={(value) => save(inclusion, { unit: value })}
                  />
                  <Cell
                    className="w-32"
                    label={`Inclusion ${component.number}.${inclusion.position} heading`}
                    value={inclusion.heading}
                    placeholder="Heading"
                    readOnly={!canEdit}
                    onSave={(value) => save(inclusion, { heading: value })}
                  />
                  <SelectCell
                    className="w-36"
                    label={`Completeness ${component.number}.${inclusion.position}`}
                    clearable={false}
                    value={inclusion.completeness}
                    options={COMPLETENESS_OPTIONS}
                    readOnly={!canCheck}
                    onSave={(value) => save(inclusion, { completeness: value })}
                  />
                  {canEdit && (
                    <div className="flex items-center gap-1">
                      {otherBundles.length > 0 && (
                        <SelectField
                          aria-label={`Move Inclusion ${component.number}.${inclusion.position}`}
                          size="sm"
                          className="w-36"
                          placeholder="Move to…"
                          disabled={busy}
                          value=""
                          options={otherBundles.map((bundle) => ({ value: bundle.id, label: `${bundle.number} ${bundle.name || "Unnamed"}` }))}
                          onChange={(componentId) => run(() => costingMatrixService.moveInclusion(inclusion.id, componentId))}
                        />
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remove Inclusion ${component.number}.${inclusion.position}`}
                        disabled={busy}
                        onClick={() => run(() => costingMatrixService.removeInclusion(inclusion.id))}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}

          {component.inclusions.length === 0 && <p className="text-xs text-muted-foreground">No Inclusions yet. A bundle lists what comes with it, unpriced.</p>}

          {canEdit && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => costingMatrixService.addInclusion(component.id, { description: "" }))}
            >
              <Plus size={14} aria-hidden="true" />
              Add Inclusion
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

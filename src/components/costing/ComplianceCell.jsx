import { useState } from "react";

import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";
import { Cell } from "./GridCell";
import { refusalMessage } from "./gridFormat";

const NOT_EVALUATED = "__none__";
const OPTIONS = [
  { value: NOT_EVALUATED, label: "Not evaluated" },
  { value: "complies", label: COMPLIANCE_LABEL.complies },
  { value: "deviates", label: COMPLIANCE_LABEL.deviates },
];

/**
 * One Component's Compliance verdict (#271): Complies, Deviates, or not evaluated yet. A
 * deviation needs a note and may name the compliant alternative recommended instead, so choosing
 * Deviates opens the note first and saves the verdict together with it (the database refuses a
 * deviation without one). Written by the Technical band; everyone else reads the verdict, its
 * note and the alternative. A gap is recorded, never blocked: nothing here touches a figure.
 *
 * `number` is the Component's number ("1.2") for the cells' labels. `onChanged` runs after each
 * save so the matrix refreshes.
 */
export default function ComplianceCell({ component, number, readOnly, onChanged }) {
  // "Deviates" chosen but not saved yet: it waits for its note.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const saved = component.compliance ?? null;
  const verdict = pending ? "deviates" : saved;
  const hasNote = Boolean(String(component.compliance_note ?? "").trim());

  const save = async (fields) => {
    await costingMatrixService.setCompliance(component.id, fields);
    setPending(false);
    await onChanged?.();
  };

  const choose = async (next) => {
    setError(null);
    const value = next === NOT_EVALUATED ? null : next;
    if (value === "deviates" && !hasNote) {
      setPending(true);
      return;
    }
    try {
      await save({ verdict: value });
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  if (readOnly) {
    return (
      <div className="space-y-1.5" data-testid="compliance">
        <StatusBadge label={COMPLIANCE_LABEL[saved] ?? "Not evaluated"} theme={COMPLIANCE_THEME[saved] ?? "mauve"} title="Compliance" />
        {saved === "deviates" && component.compliance_note && <p className="whitespace-pre-line text-xs text-foreground">{component.compliance_note}</p>}
        {saved === "deviates" && component.recommended_alternative && (
          <p className="whitespace-pre-line text-xs text-muted-foreground">
            <span className="font-medium">Recommended instead:</span> {component.recommended_alternative}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="compliance">
      <SelectField aria-label={`Compliance ${number}`} size="sm" className="w-full" options={OPTIONS} value={verdict ?? NOT_EVALUATED} onChange={choose} />
      {verdict === "deviates" && (
        <>
          <Cell
            label={`Compliance note ${number}`}
            noun="Compliance note"
            value={component.compliance_note}
            multiline
            placeholder="Why it deviates (needed)"
            onSave={(value) => (saved === "deviates" ? save({ note: value }) : save({ verdict: "deviates", note: value }))}
          />
          {(pending || !hasNote) && (
            <p className="text-xs text-muted-foreground" data-testid="compliance-needs-note">
              A deviation needs a note.
            </p>
          )}
          <Cell
            label={`Recommended alternative ${number}`}
            noun="Recommended alternative"
            value={component.recommended_alternative}
            placeholder="Recommended instead (optional)"
            onSave={(value) => save({ alternative: value })}
          />
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

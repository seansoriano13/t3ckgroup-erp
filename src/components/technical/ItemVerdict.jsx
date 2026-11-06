import { useState } from "react";

import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { Cell } from "../costing/GridCell";
import { refusalMessage } from "../costing/gridFormat";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";

const NOT_JUDGED = "__none__";
const OPTIONS = [
  { value: NOT_JUDGED, label: "Not judged" },
  { value: "complies", label: COMPLIANCE_LABEL.complies },
  { value: "deviates", label: COMPLIANCE_LABEL.deviates },
];

/**
 * One product's Complies or Deviates, with a remark, on the Technical sheet. Only the Technical in-charge writes
 * it (the database refuses anyone else); everyone else reads it. The remark can be kept under either verdict, and
 * a deviation needs one, so choosing Deviates waits for the remark and saves both together. `onChanged` runs after
 * each save so the sheet is read again.
 */
export default function ItemVerdict({ component, canWrite, onChanged }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const saved = component.compliance ?? null;
  const verdict = pending ? "deviates" : saved;
  const note = String(component.compliance_note ?? "").trim();

  const save = async (fields) => {
    setError(null);
    await costingMatrixService.setCompliance(component.id, fields);
    setPending(false);
    await onChanged?.();
  };

  const choose = async (next) => {
    const value = next === NOT_JUDGED ? null : next;
    if (value === "deviates" && !note) {
      setPending(true);
      return;
    }
    try {
      await save({ verdict: value });
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  if (!canWrite) {
    return (
      <div className="space-y-1" data-testid="item-verdict">
        <StatusBadge label={COMPLIANCE_LABEL[saved] ?? "Not judged"} theme={COMPLIANCE_THEME[saved] ?? "mauve"} title="Compliance" />
        {note && <p className="whitespace-pre-line text-xs text-foreground">{component.compliance_note}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1.5" data-testid="item-verdict">
      <SelectField aria-label={`Verdict ${component.number}`} size="sm" className="w-full min-w-32" options={OPTIONS} value={verdict ?? NOT_JUDGED} onChange={choose} />
      <Cell
        label={`Remark ${component.number}`}
        noun="Remark"
        value={component.compliance_note}
        multiline
        placeholder={verdict === "deviates" ? "Why it deviates (needed)" : "Remark (optional)"}
        onSave={(value) => (pending ? save({ verdict: "deviates", note: value }) : save({ note: value }))}
      />
      {pending && !note && (
        <p className="text-xs text-muted-foreground" data-testid="item-verdict-needs-note">
          A deviation needs a remark.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

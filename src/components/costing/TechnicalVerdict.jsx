import { useState } from "react";

import { SelectField } from "../ui/SelectField";
import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";
import { formatDate } from "../../utils/formatDate";
import { Cell } from "./GridCell";
import { refusalMessage } from "./gridFormat";

const NOT_JUDGED = "__none__";
const OPTIONS = [
  { value: NOT_JUDGED, label: "Not judged" },
  { value: "complies", label: COMPLIANCE_LABEL.complies },
  { value: "deviates", label: COMPLIANCE_LABEL.deviates },
];

/**
 * The S0 Evaluation's one Technical verdict (#909, spec #907 decision 10): Complies or Deviates for the
 * whole matrix, with the Technical Evaluation Remarks & Recommendations. Only the Technical in-charge
 * named on the matrix can give it; everyone else reads it, with who gave it and when. It is allowed at
 * any time and blocks no figure. Choosing Deviates waits for a note, since the database refuses a
 * deviation without one. `nameOf` turns an employee id into a name.
 */
export default function TechnicalVerdict({ matrix, actorId, nameOf, writes }) {
  const row = matrix.matrix ?? {};
  const matrixId = matrix.matrixId;
  const inCharge = row.technical_incharge_id ?? null;
  const isInCharge = Boolean(actorId) && actorId === inCharge;
  const saved = row.compliance ?? null;
  const note = row.compliance_note ?? "";

  // "Deviates" chosen but not saved yet: it waits for its note.
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const verdict = pending ? "deviates" : saved;

  const save = async (patch) => {
    setError(null);
    try {
      await costingMatrixService.setTechnicalVerdict(matrixId, patch);
      setPending(false);
      await writes.refresh();
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  const choose = (next) => {
    const value = next === NOT_JUDGED ? null : next;
    if (value === "deviates" && !note.trim()) {
      setError(null);
      setPending(true);
      return;
    }
    return save({ verdict: value });
  };

  const saveNote = (value) => save(pending ? { verdict: "deviates", note: value } : { note: value });

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="technical-verdict" aria-label="Technical verdict">
      <div>
        <h3 className="text-sm font-bold text-foreground">Technical verdict</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">One verdict for the whole S0 Evaluation, given by the Technical in-charge.</p>
      </div>

      {!inCharge && (
        <p className="text-sm text-muted-foreground" data-testid="technical-no-incharge">
          Name the Technical in-charge first. Only they can give the verdict.
        </p>
      )}

      {inCharge && isInCharge && (
        <div className="space-y-2">
          <SelectField aria-label="Technical verdict choice" size="sm" className="w-full" options={OPTIONS} value={verdict ?? NOT_JUDGED} onChange={choose} />
          {verdict === "deviates" && (
            <>
              <Cell
                label="Technical Evaluation Remarks & Recommendations"
                noun="The remarks"
                value={note}
                multiline
                placeholder="Why it deviates (needed)"
                onSave={saveNote}
              />
              {(pending || !note.trim()) && (
                <p className="text-xs text-muted-foreground" data-testid="verdict-needs-note">
                  A deviation needs a note.
                </p>
              )}
            </>
          )}
          {verdict !== "deviates" && (
            <Cell
              label="Technical Evaluation Remarks & Recommendations"
              noun="The remarks"
              value={note}
              multiline
              placeholder="Remarks and recommendations (optional)"
              onSave={saveNote}
            />
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      )}

      {inCharge && !isInCharge && (
        <div className="space-y-1.5" data-testid="technical-verdict-read">
          <StatusBadge label={COMPLIANCE_LABEL[saved] ?? "Not judged"} theme={COMPLIANCE_THEME[saved] ?? "mauve"} title="Technical verdict" />
          {note && <p className="whitespace-pre-line text-sm text-foreground">{note}</p>}
        </div>
      )}

      {inCharge && row.compliance_by && (
        <p className="text-xs text-muted-foreground" data-testid="technical-verdict-by">
          Given by {nameOf?.(row.compliance_by) ?? "the Technical in-charge"}
          {row.compliance_at ? `, ${formatDate(row.compliance_at)}` : ""}.
        </p>
      )}
    </section>
  );
}

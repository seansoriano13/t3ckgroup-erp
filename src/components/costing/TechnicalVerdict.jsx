import { useState } from "react";
import { Link } from "react-router";

import StatusBadge from "../StatusBadge";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COMPLIANCE_LABEL, COMPLIANCE_THEME } from "../../constants/costing";
import { overallCompliance } from "../../utils/technicalList";
import { Cell } from "./GridCell";
import { refusalMessage } from "./gridFormat";

/**
 * The S0 Evaluation's overall Technical verdict (#909, #932): never picked by hand, it follows from the products
 * (Complies only when every product complies, Deviates as soon as one deviates). It sits below the products and says
 * "Judge every product to see the result" until each one has a verdict. The Technical in-charge writes the offer-level
 * note, which a deviation needs; everyone else reads it. `nameOf` is kept for callers that pass it.
 */
export default function TechnicalVerdict({ matrix, actorId, writes, onTechnicalPage = false }) {
  const row = matrix.matrix ?? {};
  const matrixId = matrix.matrixId;
  const inCharge = row.technical_incharge_id ?? null;
  const isInCharge = Boolean(actorId) && actorId === inCharge;
  const note = row.compliance_note ?? "";

  const components = (matrix.tenderLines ?? []).flatMap((line) => line.components ?? []);
  const judged = components.filter((c) => c.compliance === "complies" || c.compliance === "deviates").length;
  const allJudged = components.length > 0 && judged === components.length;
  const result = overallCompliance(components);
  const opportunityId = row.opportunity_id ?? null;

  const [error, setError] = useState(null);
  const saveNote = async (value) => {
    setError(null);
    try {
      await costingMatrixService.setTechnicalVerdict(matrixId, { note: value });
      await writes.refresh();
    } catch (err) {
      setError(refusalMessage(err));
    }
  };

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="technical-verdict" aria-label="Technical verdict">
      <div>
        <h3 className="text-sm font-bold text-foreground">Technical verdict</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Follows from the products: Complies when every one complies, Deviates as soon as one deviates.</p>
      </div>

      {!inCharge && (
        <p className="text-sm text-muted-foreground" data-testid="technical-no-incharge">
          Name the Technical in-charge first. Only they can judge the products.
        </p>
      )}

      {inCharge && (
        <div className="space-y-2" data-testid="technical-verdict-read">
          {allJudged ? (
            <StatusBadge label={COMPLIANCE_LABEL[result]} theme={COMPLIANCE_THEME[result]} title="Technical verdict" />
          ) : (
            <p className="text-sm text-muted-foreground" data-testid="technical-verdict-waiting">
              Judge every product to see the result{components.length > 0 ? ` (${judged} of ${components.length} judged)` : ""}
            </p>
          )}

          {!onTechnicalPage &&
            (isInCharge && opportunityId ? (
              <Link
                to={`/technical/${opportunityId}`}
                className="inline-flex h-8 items-center rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-muted"
                data-testid="judge-products"
              >
                Judge the products
              </Link>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="judge-products-hint">
                The Technical in-charge judges the products on the Technical page.
              </p>
            ))}

          {isInCharge ? (
            <>
              <Cell
                label="Technical Evaluation Remarks & Recommendations"
                noun="The remarks"
                value={note}
                multiline
                placeholder={result === "deviates" ? "Name the lines that deviate (needed)" : "Remarks and recommendations (optional)"}
                onSave={saveNote}
              />
              {result === "deviates" && !note.trim() && (
                <p className="text-xs text-muted-foreground" data-testid="verdict-needs-note">
                  Write the deviation in Technical Evaluation Remarks below.
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
            </>
          ) : (
            note && <p className="whitespace-pre-line text-sm text-foreground">{note}</p>
          )}
        </div>
      )}
    </section>
  );
}

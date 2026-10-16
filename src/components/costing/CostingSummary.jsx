import { Calculator } from "lucide-react";

import { costingMatrixService } from "../../services/costingMatrixService";
import { MATRIX_MONEY_BANDS, inAnyBand } from "../../constants/costing";
import { Cell } from "./GridCell";
import { costIncomplete, offerIncomplete, pesos } from "./gridFormat";

/** A rate as the sheet labels it: 0.06 -> "6%", 0.075 -> "7.5%". */
const rateLabel = (rate) => `${Number((Number(rate) * 100).toFixed(4))}%`;

function Row({ label, hint, children, strong = false, testId }) {
  return (
    <div className={`flex items-baseline justify-between gap-4 py-1.5 ${strong ? "border-t border-border/70 pt-2.5" : ""}`} data-testid={testId}>
      <dt className={`min-w-0 text-sm ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
        {hint && <span className="ml-2 text-xs text-muted-foreground/80">{hint}</span>}
      </dt>
      <dd className={`text-right text-sm tabular-nums ${strong ? "font-semibold text-foreground" : "text-foreground"}`}>{children}</dd>
    </div>
  );
}

/**
 * The summary at the foot of the grid, copied from the PMS sheet (#270): VAT-exclusive, Tax,
 * Retention, Collected Amount, Operational Expenses (the Final Acquire total), Marketing, OPEX,
 * ITR and Revenue. Closed Book only: the matrix read gives every other tier no `summary`, and
 * this section is not drawn for it. A figure that cannot be worked yet says why in words
 * ("Incomplete — N rows have no cost") instead of a number; a blank cost is never zero.
 * Marketing and OPEX are typed here by Finance access or the Final Acquire list.
 */
export default function CostingSummary({ matrix, writes }) {
  const { summary, rates, bands } = matrix;
  if (!summary) return null;
  const { refresh } = writes;
  const { incomplete } = summary;

  const offerNote = offerIncomplete(incomplete);
  const costNote = costIncomplete(incomplete);
  const offerFigure = (value) => (value === null || value === undefined ? <span className="text-muted-foreground">{offerNote ?? "—"}</span> : pesos(value));
  const costFigure = (value) => (value === null || value === undefined ? <span className="text-muted-foreground">{costNote ?? "—"}</span> : pesos(value));
  // Revenue needs both sides; the cost shortfall is named first, as the sheet's Revenue is the cost line's answer.
  const revenueNote = costNote ?? offerNote;

  const canType = (column) => inAnyBand(bands, MATRIX_MONEY_BANDS[column]);
  const saveMoney = async (fields) => {
    await costingMatrixService.updateMatrixMoney(matrix.matrixId, fields);
    await refresh();
  };

  return (
    <section className="max-w-xl space-y-2 rounded-xl border border-border/70 bg-card p-4" aria-label="Summary" data-testid="costing-summary">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <Calculator size={14} aria-hidden="true" />
        Summary
      </h3>
      <dl className="divide-y divide-border/40">
        <Row label="Final Offer" testId="summary-final-offer">
          {offerFigure(summary.finalOfferTotal)}
        </Row>
        <Row label="VAT-exclusive" hint={`Final Offer ÷ ${Number(rates.vatDivisor)}`} testId="summary-vat">
          {offerFigure(summary.vatExclusive)}
        </Row>
        <Row label={`Less Tax ${rateLabel(rates.taxRate)}`} hint="on the gross offer" testId="summary-tax">
          {offerFigure(summary.tax)}
        </Row>
        <Row label={`Retention ${rateLabel(rates.retentionRate)}`} testId="summary-retention">
          {offerFigure(summary.retention)}
        </Row>
        <Row label="Collected Amount" testId="summary-collected">
          {offerFigure(summary.collected)}
        </Row>
        <Row label="Operational Expenses" hint="Final Acquire total" testId="summary-opex-total">
          {costFigure(summary.operationalExpenses)}
        </Row>
        <Row label="Marketing" testId="summary-marketing">
          <Cell
            className="ml-auto w-40"
            label="Marketing"
            noun="Marketing"
            value={summary.marketing}
            numeric
            money
            align="right"
            readOnly={!canType("marketing")}
            onSave={(value) => saveMoney({ marketing: value })}
          />
        </Row>
        <Row label="OPEX" testId="summary-opex">
          <Cell
            className="ml-auto w-40"
            label="OPEX"
            noun="OPEX"
            value={summary.opex}
            numeric
            money
            align="right"
            readOnly={!canType("opex")}
            onSave={(value) => saveMoney({ opex: value })}
          />
        </Row>
        <Row label={`ITR ${rateLabel(rates.itrRate)}`} hint={`of the offer above ${pesos(Number(rates.itrAllowance))}`} testId="summary-itr">
          {offerFigure(summary.itr)}
        </Row>
        <Row label="Revenue" strong testId="summary-revenue">
          {summary.revenue === null || summary.revenue === undefined ? (
            <span className="font-normal text-muted-foreground">{revenueNote ?? "—"}</span>
          ) : (
            pesos(summary.revenue)
          )}
        </Row>
      </dl>
    </section>
  );
}

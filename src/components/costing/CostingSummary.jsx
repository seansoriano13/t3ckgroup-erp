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
 * Planned and Actual side by side (#605): the cost line and Revenue worked on Final Acquire (Planned,
 * today's) and on Landed Cost where an item was bought (Actual), then the difference, highlighted when
 * Actual is lower. Actual reads "estimate" while any IPAS of the SOR is short of LC Odoo Done, and the
 * items nobody has bought yet are said to be counted at Final Acquire. A figure that cannot be worked
 * says why in words, like the rest of the summary.
 */
function PlannedVsActual({ comparison, revenueNote }) {
  const { planned, actual, difference, actualLower, estimate, notBought, itemsTotal, plannedCost, actualCost } = comparison;
  const figure = (value) => (value === null || value === undefined ? <span className="font-normal text-muted-foreground">—</span> : pesos(value));
  const actualMark = estimate && (
    <span className="ml-1.5 rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-normal text-amber-12" data-testid="summary-actual-estimate" title="An IPAS of this SOR has not reached LC Odoo Done yet">
      estimate
    </span>
  );
  return (
    <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3" data-testid="summary-planned-actual">
      <div className="grid grid-cols-[minmax(0,1fr)_7.5rem_7.5rem] items-baseline gap-x-3 text-sm sm:grid-cols-[minmax(0,1fr)_9.5rem_9.5rem]">
        <h4 className="text-sm font-semibold text-foreground">Planned vs Actual</h4>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="summary-planned-head">Planned</span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="summary-actual-head">
          Actual
          {actualMark}
        </span>

        <span className="pt-1.5 text-muted-foreground">
          Cost
          <span className="ml-2 text-xs text-muted-foreground/80">Planned | Landed Cost</span>
        </span>
        <span className="pt-1.5 text-right tabular-nums" data-testid="summary-planned-cost">{figure(plannedCost)}</span>
        <span className="pt-1.5 text-right tabular-nums" data-testid="summary-actual-cost">{figure(actualCost)}</span>

        <span className="border-t border-border/70 pt-2 font-semibold text-foreground">Revenue</span>
        <span className="border-t border-border/70 pt-2 text-right font-semibold tabular-nums text-foreground" data-testid="summary-planned-revenue">{figure(planned)}</span>
        <span className="border-t border-border/70 pt-2 text-right font-semibold tabular-nums text-foreground" data-testid="summary-actual-revenue">{figure(actual)}</span>
      </div>

      <div
        className={`flex items-baseline justify-between gap-4 rounded-md px-2 py-1.5 text-sm ${actualLower ? "bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
        data-testid="summary-difference"
        data-lower={actualLower ? "true" : "false"}
      >
        <span className={actualLower ? "font-semibold" : ""}>Difference (Actual − Planned)</span>
        <span className={`tabular-nums ${actualLower ? "font-semibold" : ""}`}>{difference === null ? "—" : `${difference > 0 ? "+" : ""}${pesos(difference)}`}</span>
      </div>

      {planned === null && revenueNote && (
        <p className="text-xs text-muted-foreground" data-testid="summary-planned-actual-note">
          {revenueNote}
        </p>
      )}
      {notBought > 0 && (
        <p className="text-xs text-muted-foreground" data-testid="summary-not-bought">
          {notBought} of {itemsTotal} {itemsTotal === 1 ? "item" : "items"} not bought yet, counted at the planned cost.
        </p>
      )}
    </div>
  );
}

/**
 * The summary at the foot of the grid, copied from the PMS sheet (#270): VAT-exclusive, Tax,
 * Retention, Collected Amount, Operational Expenses (the Final Acquire total), Marketing, OPEX,
 * ITR and Revenue. Closed Book only: the matrix read gives every other tier no `summary`, and
 * this section is not drawn for it. A figure that cannot be worked yet says why in words
 * ("Incomplete — N rows have no cost") instead of a number; a blank cost is never zero.
 * Marketing and OPEX are typed here by Finance access or the Final Acquire list. The Revenue row above
 * stays Planned Revenue; Actual Revenue sits beside it in the Planned vs Actual block (#605).
 */
export default function CostingSummary({ matrix, writes }) {
  const { summary, rates, bands, revenueComparison: comparison } = matrix;
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
    <section className="space-y-2 rounded-xl border border-border/70 bg-card p-4" aria-label="Summary" data-testid="costing-summary">
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
        <Row label="Operational Expenses" testId="summary-opex-total">
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
      {comparison && <PlannedVsActual comparison={comparison} revenueNote={revenueNote} />}
    </section>
  );
}

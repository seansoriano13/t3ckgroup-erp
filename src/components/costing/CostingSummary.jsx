import { Calculator } from "lucide-react";

import { costingMatrixService } from "../../services/costingMatrixService";
import { MATRIX_MONEY_BANDS, inAnyBand, summaryLineShown } from "../../constants/costing";
import { Cell } from "./GridCell";
import { costIncomplete, expensesIncomplete, offerIncomplete, opexIncomplete, pesos, revenueIncomplete } from "./gridFormat";

/** A rate as the sheet labels it: 0.06 -> "6%", 0.075 -> "7.5%". */
const rateLabel = (rate) => `${Number((Number(rate) * 100).toFixed(4))}%`;

function Row({ label, hint, children, strong = false, testId }) {
  return (
    <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-1.5 ${strong ? "border-t border-border/70 pt-2.5" : ""}`} data-testid={testId}>
      <dt className={`min-w-0 text-sm ${strong ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {label}
        {hint && <span className="block text-xs font-normal text-muted-foreground/80">{hint}</span>}
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
 * shows a dash; why is said once, under the summary's title.
 */
function PlannedVsActual({ comparison }) {
  const { planned, actual, difference, actualLower, estimate, notBought, itemsTotal, plannedCost, actualCost } = comparison;
  const figure = (value) => (value === null || value === undefined ? <span className="font-normal text-muted-foreground">—</span> : pesos(value));
  const actualMark = estimate && (
    <span className="ml-1.5 rounded bg-amber-a3 px-1.5 py-0.5 text-xs font-normal text-amber-12" data-testid="summary-actual-estimate" title="An IPAS of this SOR has not reached LC Odoo Done yet">
      estimate
    </span>
  );
  return (
    <div className="mt-3 space-y-1.5 border-t border-border/70 pt-3" data-testid="summary-planned-actual">
      <h4 className="text-sm font-semibold text-foreground">Planned vs Actual</h4>
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(6.5rem,auto)_minmax(6.5rem,auto)] items-baseline gap-x-3 text-sm">
        <span aria-hidden="true" />
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="summary-planned-head">Planned</span>
        <span className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground" data-testid="summary-actual-head">
          Actual
          {actualMark}
        </span>

        <span className="pt-1.5 text-muted-foreground">
          Cost
          <span className="block text-xs text-muted-foreground/80">Planned | Landed Cost</span>
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
 * Retention, Collected Amount, Landed Cost (planned), Project expenses, Marketing, OPEX (worked out),
 * ITR and Revenue. Closed Book only: the matrix read gives every other tier no `summary`, and
 * this section is not drawn for it. A figure that cannot be worked yet shows a dash, and why is said in
 * words once, under the title ("Incomplete — N rows have no cost"); a blank cost is never zero.
 * Marketing and OPEX are typed here by Finance access or the Final Acquire list. The Revenue row above
 * stays Planned Revenue; Actual Revenue sits beside it in the Planned vs Actual block (#605).
 */
export default function CostingSummary({ matrix, writes }) {
  const { summary, rates, bands, revenueComparison: comparison } = matrix;
  if (!summary) return null;
  const { refresh } = writes;
  const show = (key) => summaryLineShown(rates, key);
  const { incomplete } = summary;

  const offerNote = offerIncomplete(incomplete);
  const costNote = costIncomplete(incomplete);
  const dash = (note) => (
    <span className="font-normal text-muted-foreground" title={note ?? undefined}>
      —
    </span>
  );
  const offerFigure = (value) => (value === null || value === undefined ? dash(offerNote) : pesos(value));
  const costFigure = (value) => (value === null || value === undefined ? dash(costNote) : pesos(value));
  const expensesNote = expensesIncomplete(incomplete);
  const opexNote = opexIncomplete(incomplete);
  // Revenue needs the offer and OPEX; the cost shortfall is named first.
  const revenueNote = revenueIncomplete(incomplete);
  // Why some figures are blank, each reason once (2026-11-13: the same "Incomplete" in five rows was unreadable).
  const notes = [...new Set([offerNote, costNote, expensesNote, opexNote, revenueNote].filter(Boolean))];

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
      {notes.length > 0 && (
        <ul className="space-y-0.5 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" data-testid="summary-incomplete">
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
      <dl className="divide-y divide-border/40">
        <Row label="Final Offer" testId="summary-final-offer">
          {offerFigure(summary.finalOfferTotal)}
        </Row>
        {show("vatExclusive") && (
        <Row label="VAT-exclusive" hint={`Final Offer ÷ ${Number(rates.vatDivisor)}`} testId="summary-vat">
          {offerFigure(summary.vatExclusive)}
        </Row>
        )}
        {show("finalVat") && (
          <Row label={`Final VAT ${rateLabel(rates.finalVatRate ?? 0.12)}`} hint="on the VAT-exclusive figure" testId="summary-final-vat">
            {offerFigure(summary.finalVat)}
          </Row>
        )}
        {show("tax") && (
        <Row label={`Less Tax ${rateLabel(rates.taxRate)}`} hint="on the VAT-exclusive figure" testId="summary-tax">
          {offerFigure(summary.tax)}
        </Row>
        )}
        {show("retention") && (
        <Row label={`Retention ${rateLabel(rates.retentionRate)}`} testId="summary-retention">
          {offerFigure(summary.retention)}
        </Row>
        )}
        {show("collected") && (
        <Row label="Collected Amount" testId="summary-collected">
          {offerFigure(summary.collected)}
        </Row>
        )}
        {show("landedCost") && (
        <Row label="Landed Cost (planned)" hint="Final Acquire total of the Components" testId="summary-landed-cost">
          {costFigure(summary.landedCost)}
        </Row>
        )}
        {show("projectExpenses") && (
        <Row label="Project expenses" hint="the Other costs rows" testId="summary-project-expenses">
          {summary.projectExpenses === null || summary.projectExpenses === undefined ? (
            dash(expensesNote)
          ) : (
            pesos(summary.projectExpenses)
          )}
        </Row>
        )}
        {show("marketing") && (
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
        )}
        {show("opex") && (
        <Row label="OPEX" hint="retention + landed cost + project expenses + marketing" testId="summary-opex">
          {summary.opex === null || summary.opex === undefined ? (
            dash(opexNote)
          ) : (
            pesos(summary.opex)
          )}
        </Row>
        )}
        {show("itr") && (
        <Row label={`ITR ${rateLabel(rates.itrRate)}`} hint={`of the offer above ${pesos(Number(rates.itrAllowance))}`} testId="summary-itr">
          {offerFigure(summary.itr)}
        </Row>
        )}
        <Row label="Revenue" strong testId="summary-revenue">
          {summary.revenue === null || summary.revenue === undefined ? (
            dash(revenueNote)
          ) : (
            pesos(summary.revenue)
          )}
        </Row>
        {show("revenuePercent") && (
        <Row label="Revenue ÷ Final Offer" hint={`the bid goes ahead at ${summary.goLinePercent}% or more`} testId="summary-revenue-percent">
          {summary.revenuePercent === null || summary.revenuePercent === undefined ? (
            dash(revenueNote)
          ) : (
            <span className={summary.underGoLine ? "font-semibold text-amber-600 dark:text-amber-400" : undefined}>{summary.revenuePercent.toFixed(2)}%</span>
          )}
        </Row>
        )}
      </dl>
      {comparison && <PlannedVsActual comparison={comparison} />}
    </section>
  );
}

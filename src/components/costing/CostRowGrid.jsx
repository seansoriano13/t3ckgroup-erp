import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COST_ROW_BANDS, ROW_EDIT_BANDS, inAnyBand, tierReadsCost } from "../../constants/costing";
import { Cell } from "./GridCell";
import { factorLabel, percentLabel, pesos } from "./gridFormat";
import BandHeader from "./BandHeader";

/**
 * The cost-only rows below the Tender Lines (#268), like the Delivery Charge: a description, a
 * quantity and the unit costs, with no specification, ABC or Final Offer. They count in the
 * totals and the summary and never in any Tender Line's margin. Description and quantity show to
 * every tier that reads the matrix; a cost column shows only to the tiers that receive it.
 *
 * Markup (#269): a cost-only row is x1.00 unless the Final Acquire list gives it a factor of its own, and
 * the matrix default never reaches it. The Closed Book sees the factor; Sales and the Closed Book see the
 * Markup Price.
 */
export default function CostRowGrid({ matrix, writes }) {
  const { busy, run, refresh } = writes;
  const [removing, setRemoving] = useState(null);

  const { bands, tier, costRows, costRowsTotals, costRowsMarkupTotal } = matrix;
  const canEditRows = inAnyBand(bands, ROW_EDIT_BANDS);
  const can = (column) => inAnyBand(bands, COST_ROW_BANDS[column]);
  const showAcquire = tierReadsCost(tier, "acquire_unit");
  const showOdoo = tierReadsCost(tier, "odoo_unit");
  const showFactor = tierReadsCost(tier, "markup_factor");
  const showMarkupPrice = tierReadsCost(tier, "markup_price_unit");

  if (costRows.length === 0 && !canEditRows) return null;

  const save = async (row, fields) => {
    await costingMatrixService.updateCostRow(row.id, fields);
    await refresh();
  };

  const salesColumns = showOdoo ? 2 : 0;
  const pmsColumns = showAcquire ? 2 : 0;
  const markupColumns = (showFactor ? 1 : 0) + (showMarkupPrice ? 2 : 0);

  return (
    <section className="space-y-2" aria-label="Cost-only rows" data-testid="cost-rows">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Cost-only rows</h3>
          <p className="text-xs text-muted-foreground">
            Costs with no specification, like the Delivery Charge. They count in the totals and the summary, not in any Tender Line&apos;s margin.
          </p>
        </div>
        {canEditRows && (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => costingMatrixService.addCostRow(matrix.matrixId, { description: "" }))}>
            <Plus size={14} aria-hidden="true" />
            Add cost-only row
          </Button>
        )}
      </div>

      {costRows.length > 0 && (
        <div className="rounded-xl border border-border/70 bg-card">
          <Table>
            <TableHeader>
              {(salesColumns > 0 || pmsColumns > 0 || markupColumns > 0) && (
                <TableRow>
                  <TableHead colSpan={3} />
                  {salesColumns > 0 && (
                    <BandHeader band="sales" span={salesColumns}>
                      Sales
                    </BandHeader>
                  )}
                  {pmsColumns > 0 && (
                    <BandHeader band="pms" span={pmsColumns}>
                      PMS
                    </BandHeader>
                  )}
                  {markupColumns > 0 && (
                    <BandHeader band="mngt" span={markupColumns}>
                      Markup
                    </BandHeader>
                  )}
                  <TableHead />
                </TableRow>
              )}
              <TableRow>
                <TableHead className="w-12">No.</TableHead>
                <TableHead className="min-w-[16rem]">Description</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                {showOdoo && <TableHead className="w-36 text-right">Odoo / unit</TableHead>}
                {showOdoo && <TableHead className="w-32 text-right">Odoo total</TableHead>}
                {showAcquire && <TableHead className="w-36 text-right">Acquire / unit</TableHead>}
                {showAcquire && <TableHead className="w-32 text-right">Acquire total</TableHead>}
                {showFactor && <TableHead className="w-36 text-right">Markup factor</TableHead>}
                {showMarkupPrice && <TableHead className="w-36 text-right">Markup Price / unit</TableHead>}
                {showMarkupPrice && <TableHead className="w-36 text-right">Markup Price total</TableHead>}
                <TableHead className="w-16">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {costRows.map((row) => (
                <TableRow key={row.id} data-testid="cost-row">
                  <TableCell className="align-top font-semibold tabular-nums">C{row.number}</TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Cost-only row ${row.number} description`}
                      noun="Description"
                      value={row.description}
                      placeholder="Description"
                      readOnly={!can("description")}
                      onSave={(value) => save(row, { description: value })}
                    />
                  </TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Cost-only row ${row.number} quantity`}
                      noun="Quantity"
                      value={row.quantity}
                      numeric
                      required
                      align="right"
                      readOnly={!can("quantity")}
                      onSave={(value) => save(row, { quantity: value })}
                    />
                  </TableCell>
                  {showOdoo && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Cost-only row ${row.number} Odoo unit cost`}
                        noun="Odoo unit cost"
                        value={row.odoo_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!can("odoo_unit")}
                        onSave={(value) => save(row, { odooUnit: value })}
                      />
                    </TableCell>
                  )}
                  {showOdoo && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(row.totals.odooTotal)}</TableCell>}
                  {showAcquire && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Cost-only row ${row.number} Acquire`}
                        noun="Acquire"
                        value={row.acquire_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!can("acquire_unit")}
                        onSave={(value) => save(row, { acquireUnit: value })}
                      />
                    </TableCell>
                  )}
                  {showAcquire && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(row.totals.acquireTotal)}</TableCell>}
                  {showFactor && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Cost-only row ${row.number} markup factor`}
                        noun="Markup factor"
                        value={row.markup_factor}
                        numeric
                        step="0.0001"
                        align="right"
                        placeholder="1"
                        readOnly={!can("markup_factor")}
                        onSave={(value) => save(row, { markupFactor: value })}
                      />
                      <p className="mt-1 text-right text-xs text-muted-foreground" data-testid="markup-factor-shown">
                        {factorLabel(row.markup.factor)} · {percentLabel(row.markup.factor)}
                      </p>
                    </TableCell>
                  )}
                  {showMarkupPrice && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(row.markup.priceUnit)}</TableCell>}
                  {showMarkupPrice && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(row.markup.priceTotal)}</TableCell>}
                  <TableCell className="align-top">
                    {canEditRows && (
                      <div className="flex justify-end">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove cost-only row ${row.number}`} disabled={busy} onClick={() => setRemoving(row)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(showAcquire || showOdoo || showMarkupPrice) && (
                <TableRow data-testid="cost-row-totals">
                  <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cost-only total
                  </TableCell>
                  {showOdoo && <TableCell />}
                  {showOdoo && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(costRowsTotals.odooTotal)}</TableCell>}
                  {showAcquire && <TableCell />}
                  {showAcquire && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(costRowsTotals.acquireTotal)}</TableCell>}
                  {showFactor && <TableCell />}
                  {showMarkupPrice && <TableCell />}
                  {showMarkupPrice && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(costRowsMarkupTotal)}</TableCell>}
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove cost-only row ${removing.number}?` : "Remove cost-only row?"}
        description="Its costs go with it. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          run(() => costingMatrixService.removeCostRow(target.id));
        }}
      />
    </section>
  );
}

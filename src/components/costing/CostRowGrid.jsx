import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { costingMatrixService } from "../../services/costingMatrixService";
import { COST_ROW_BANDS, ROW_EDIT_BANDS, inAnyBand, tierReadsCost } from "../../constants/costing";
import { extended, finalAcquireTotal } from "../../utils/costingMath";
import { Cell } from "./GridCell";
import { pesos } from "./gridFormat";
import BandHeader from "./BandHeader";

/**
 * The cost-only rows below the Tender Lines (#268), like the Delivery Charge: a description, a
 * quantity and the unit costs, with no specification, ABC or Final Offer. They count in the
 * totals and the summary and never in any Tender Line's margin. Description and quantity show to
 * every tier that reads the matrix; a cost column shows only to the tiers that receive it.
 */
export default function CostRowGrid({ matrix, writes }) {
  const { busy, run, refresh } = writes;
  const [removing, setRemoving] = useState(null);

  const { bands, tier, costRows, costRowsTotals } = matrix;
  const canEditRows = inAnyBand(bands, ROW_EDIT_BANDS);
  const can = (column) => inAnyBand(bands, COST_ROW_BANDS[column]);
  const showAcquire = tierReadsCost(tier, "acquire_unit");
  const showOdoo = tierReadsCost(tier, "odoo_unit");
  const showFinal = tierReadsCost(tier, "final_acquire_unit");

  if (costRows.length === 0 && !canEditRows) return null;

  const save = async (row, fields) => {
    await costingMatrixService.updateCostRow(row.id, fields);
    await refresh();
  };

  const salesColumns = showOdoo ? 2 : 0;
  const pmsColumns = showAcquire ? 2 : 0;
  const mngtColumns = showFinal ? 2 : 0;

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
              {(salesColumns > 0 || pmsColumns > 0 || mngtColumns > 0) && (
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
                  {mngtColumns > 0 && (
                    <BandHeader band="mngt" span={mngtColumns}>
                      MNGT
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
                {showFinal && <TableHead className="w-36 text-right">Final Acquire / unit</TableHead>}
                {showFinal && <TableHead className="w-32 text-right">Final Acquire total</TableHead>}
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
                  {showFinal && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Cost-only row ${row.number} Final Acquire`}
                        noun="Final Acquire"
                        value={row.final_acquire_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!can("final_acquire_unit")}
                        onSave={(value) => save(row, { finalAcquireUnit: value })}
                      />
                    </TableCell>
                  )}
                  {showFinal && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(extended(row.final_acquire_unit, row.quantity))}</TableCell>}
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
              {(showAcquire || showOdoo || showFinal) && (
                <TableRow data-testid="cost-row-totals">
                  <TableCell colSpan={3} className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Cost-only total
                  </TableCell>
                  {showOdoo && <TableCell />}
                  {showOdoo && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(costRowsTotals.odooTotal)}</TableCell>}
                  {showAcquire && <TableCell />}
                  {showAcquire && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(costRowsTotals.acquireTotal)}</TableCell>}
                  {showFinal && <TableCell />}
                  {showFinal && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(finalAcquireTotal(costRows))}</TableCell>}
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

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "../../ui/button";
import ConfirmDialog from "../../ui/ConfirmDialog";
import { SelectField } from "../../ui/SelectField";
import { costingKeys } from "../costingKeys";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COST_ROW_BANDS, ROW_EDIT_BANDS, USUAL_COST_CATEGORIES, inAnyBand, tierReadsCostRow } from "../../../constants/costing";
import { usualRowsToAdd } from "../../../utils/costingMath";
import { cn } from "../../../lib/utils";
import { Cell, Readout } from "../GridCell";
import { pesos } from "../gridFormat";

const CAPTION = "text-label font-bold uppercase tracking-wider text-muted-foreground";

/**
 * Other costs (#268's cost-only rows): what we pay for the bid that is no line of the offer, like delivery,
 * installation or permits. Each is a description, a quantity and what it costs us; it counts in our cost,
 * the summary and the margin, never in a Tender Line's price, so it has no ABC, Final Offer or markup here
 * (it carries at ×1.00). A line the client asked for is added with "Add a line that is not on the SOR".
 * Description and quantity show to every tier that reads the matrix; a cost shows only to the tiers that
 * receive it. One row of boxes per cost on a wide screen, captioned once above; stacked and captioned on a phone.
 */
export default function OtherCosts({ matrix, writes }) {
  const { busy, run, refresh } = writes;
  const [removing, setRemoving] = useState(null);
  // A new cost needs a cost guide category (#723); an old one without shows "Uncategorised".
  const [newCategory, setNewCategory] = useState("");
  const { data: categories = [] } = useQuery({
    queryKey: costingKeys.costCategories(),
    queryFn: () => costingMatrixService.listCostCategories(),
    staleTime: 60_000,
  });
  const categoryOptions = categories.map((c) => ({ value: c.key, label: c.label }));

  const { bands, tier, costRows } = matrix;
  const canEditRows = inAnyBand(bands, ROW_EDIT_BANDS);
  const can = (column) => inAnyBand(bands, COST_ROW_BANDS[column]);
  const showAcquire = tierReadsCostRow(tier, "acquire_unit");
  const showFinal = tierReadsCostRow(tier, "final_acquire_unit");
  const showPct = tierReadsCostRow(tier, "abc_pct");
  const missingUsual = usualRowsToAdd(costRows, USUAL_COST_CATEGORIES).filter((key) => categories.some((c) => c.key === key));

  if (costRows.length === 0 && !canEditRows) return null;

  const save = async (row, fields) => {
    await costingMatrixService.updateCostRow(row.id, fields);
    await refresh();
  };

  // A percent row's peso amount is worked by the database (it follows the percent, the quantity and the ABC), so only the percent is sent (#963).
  const savePercent = (row, value) => save(row, { abcPct: value });
  // Typing the peso amount by hand clears the percent.
  const saveAmount = (row, value) => save(row, row.abc_pct == null ? { acquireUnit: value } : { acquireUnit: value, abcPct: null });
  const saveQuantity = (row, value) => save(row, { quantity: value });
  const addUsual = () =>
    run(async () => {
      for (const key of missingUsual) {
        const label = categories.find((c) => c.key === key)?.label ?? "";
        await costingMatrixService.addCostRow(matrix.matrixId, { description: label, categoryKey: key });
      }
    });

  const columns = [
    { key: "description", label: "Description", width: "minmax(11rem,1fr)", min: 11, wide: true },
    { key: "category", label: "Category", width: "10rem" },
    { key: "quantity", label: "Qty", width: "4.5rem" },
    showPct && { key: "pct", label: "% of ABC", width: "5rem" },
    showAcquire && { key: "acquire", label: "Acquire / unit", width: "7.5rem" },
    showFinal && { key: "final", label: "Final cost / unit", width: "7.5rem" },
    showAcquire && { key: "total", label: "Total", width: "6.5rem" },
    canEditRows && { key: "remove", label: "", width: "2.25rem" },
  ].filter(Boolean);
  // The description keeps a readable width: when the panel is too narrow for every column, the table scrolls sideways instead of squeezing it to nothing.
  const minRem = columns.reduce((sum, c) => sum + (c.min ?? parseFloat(c.width)), 0) + (columns.length - 1) + 2;
  const grid = { "--cost-columns": columns.map((c) => c.width).join(" "), "--cost-min": `${minRem}rem` };
  const rowClass = "grid grid-cols-2 items-start gap-x-4 gap-y-2 px-4 py-3 sm:[grid-template-columns:var(--cost-columns)]";
  // A phone has no caption row above, so each box carries its own.
  const caption = (key) => <p className={cn(CAPTION, "mb-1 sm:hidden")}>{columns.find((c) => c.key === key).label}</p>;

  return (
    <section className="space-y-3" aria-label="Other costs" data-testid="cost-rows">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="max-w-prose">
          <h3 className="text-sm font-semibold text-foreground">Other costs</h3>
          <p className="text-xs text-muted-foreground">
            What we pay that is not a line of the offer, like delivery, installation or permits. It adds to our cost and lowers the margin; the client never sees it as a line.
          </p>
        </div>
        {canEditRows && (
          <div className="flex flex-wrap items-center gap-2">
            <SelectField
              size="sm"
              className="w-56"
              options={categoryOptions}
              value={newCategory}
              onChange={setNewCategory}
              placeholder="Category (required)"
              aria-label="Category of the new cost"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy || !newCategory}
              onClick={() => run(() => costingMatrixService.addCostRow(matrix.matrixId, { description: "", categoryKey: newCategory }))}
            >
              <Plus aria-hidden="true" />
              Add another cost
            </Button>
            {missingUsual.length > 0 && (
              <Button type="button" size="sm" variant="outline" disabled={busy} onClick={addUsual}>
                <Plus aria-hidden="true" />
                Add the usual rows
              </Button>
            )}
          </div>
        )}
      </div>

      {costRows.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border/70 bg-card">
        <div className="divide-y divide-border/70 sm:min-w-[var(--cost-min)]" style={grid}>
          <div className={cn(rowClass, "hidden py-2 sm:grid")} aria-hidden="true">
            {columns.map((c) => (
              <p key={c.key} className={CAPTION}>
                {c.label}
              </p>
            ))}
          </div>
          {costRows.map((row) => (
            <div key={row.id} className={rowClass} data-testid="cost-row">
              <div className="col-span-2 sm:col-span-1">
                {caption("description")}
                <Cell
                  label={`Other cost ${row.number} description`}
                  noun="Description"
                  value={row.description}
                  placeholder="Delivery, installation, permits…"
                  readOnly={!can("description")}
                  onSave={(value) => save(row, { description: value })}
                />
              </div>
              <div>
                {caption("category")}
                <SelectField
                  size="sm"
                  options={categoryOptions}
                  value={row.category_key ?? ""}
                  onChange={(value) => save(row, { categoryKey: value })}
                  placeholder="Uncategorised"
                  disabled={!can("category_key") || busy}
                  aria-label={`Other cost ${row.number} category`}
                />
              </div>
              <div>
                {caption("quantity")}
                <Cell label={`Other cost ${row.number} quantity`} noun="Quantity" value={row.quantity} numeric required readOnly={!can("quantity")} onSave={(value) => saveQuantity(row, value)} />
              </div>
              {showPct && (
                <div>
                  {caption("pct")}
                  <Cell label={`Other cost ${row.number} percent of ABC`} noun="Percent of ABC" value={row.abc_pct} numeric placeholder="%" readOnly={!can("abc_pct")} onSave={(value) => savePercent(row, value)} />
                </div>
              )}
              {showAcquire && (
                <div>
                  {caption("acquire")}
                  <Cell
                    label={`Other cost ${row.number} Acquire`}
                    noun="Acquire"
                    value={row.acquire_unit}
                    numeric
                    money
                    placeholder={row.abcMissing ? "ABC missing" : "0.00"}
                    readOnly={!can("acquire_unit")}
                    onSave={(value) => saveAmount(row, value)}
                  />
                  {row.abc_pct != null && (
                    <p className="mt-1 text-xs text-muted-foreground" data-testid="cost-row-pct-note">
                      {row.abcMissing ? `${Number(row.abc_pct)}% of ABC: the ABC is missing` : `${Number(row.abc_pct)}% of ABC`}
                    </p>
                  )}
                </div>
              )}
              {showFinal && (
                <div>
                  {caption("final")}
                  <Cell
                    label={`Other cost ${row.number} Final cost`}
                    noun="Final cost"
                    value={row.final_acquire_unit}
                    numeric
                    money
                    placeholder="0.00"
                    readOnly={!can("final_acquire_unit")}
                    onSave={(value) => save(row, { finalAcquireUnit: value })}
                  />
                </div>
              )}
              {showAcquire && (
                <div>
                  {caption("total")}
                  <Readout>{pesos(row.totals.acquireTotal)}</Readout>
                </div>
              )}
              {canEditRows && (
                <Button type="button" variant="ghost" size="icon-lg" className="col-span-2 justify-self-end sm:col-span-1" aria-label={`Remove other cost ${row.number}`} disabled={busy} onClick={() => setRemoving(row)}>
                  <Trash2 size={14} aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
          {showAcquire && (
            <div className="flex items-center justify-between gap-4 rounded-b-xl bg-muted/40 px-4 py-2.5" data-testid="cost-row-totals">
              <span className={CAPTION}>Project expenses total</span>
              <span className="text-sm font-semibold tabular-nums text-foreground">{pesos(matrix.projectExpensesTotal)}</span>
            </div>
          )}
        </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove other cost ${removing.number}?` : "Remove this cost?"}
        description="It comes off our cost. The change stays in the history."
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

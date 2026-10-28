import { CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../ui/table";
import StatusBadge from "../../StatusBadge";
import { Cell } from "../GridCell";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COSTING_BAND, tierReads, tierReadsCost } from "../../../constants/costing";
import { lineCost } from "../../../utils/costingMath";
import { pesos } from "../gridFormat";

/** The word and colour under a price for where it came from; a cost Purchasing typed is amber. */
const SOURCE_BADGE = {
  canvass: { label: "Canvass", theme: "mauve" },
  p0: { label: "P0", theme: "mauve" },
  odoo: { label: "Odoo", theme: "mauve" },
  typed: { label: "Typed", theme: "amber" },
  mixed: { label: "Mixed", theme: "mauve" },
};

/**
 * The Costing Matrix as one flat grid, one row per line of the SOR's S0 (layout A "Sheet", spec #699,
 * ticket #700). A header strip of facts, two header rows (the team that owns each column, then the
 * column), and the Item column frozen while the money scrolls sideways. A box you can type in is a
 * `Cell`; everything else is plain text. This ticket draws Item, Qty, Client asks for, ABC / unit and
 * Final Offer / unit; later tickets add the cost, markup and compliance columns after them. A column
 * the viewer's tier is not sent is left out, not blanked.
 */

const CELL = "border-b border-r border-border px-3 py-2.5 align-top text-[13px] leading-snug";
const HEAD = "border-b border-r border-border bg-muted px-3 py-2 text-left text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const GROUP = "border-r border-border bg-card px-3 pb-2 pt-3 text-left text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const NUM = "text-right tabular-nums";
// Opaque, so the money slides under it; a plain border, no shadow.
const FROZEN = "sticky left-0 z-10";
const SUB = "mt-1 text-xs text-muted-foreground";

const firstLine = (text) => (text ?? "").split("\n")[0].trim();

function Fact({ label, children, sub }) {
  return (
    <div className="min-w-0 px-4 py-3">
      <div className="text-label font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold leading-snug tabular-nums">{children}</div>
      {sub && <div className="text-xs font-normal text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** The row's name: what the S0 line says, falling back to the tender wording. */
const itemName = (line) => line.sor_line_snapshot?.name || firstLine(line.tender_specification) || "Untitled line";

/** The client's ask is shown only where it says more than the item's own name (the fill copies the name in). */
const askOf = (line) => (line.tender_specification && line.tender_specification !== itemName(line) ? line.tender_specification : "");

/**
 * Price and In pesos for one row (Purchasing · cost, #701). The price is a box Purchasing can type in
 * when the row has one part (or none yet); typing one makes it "Typed", which no fill replaces. With
 * several parts the price is their sum, read-only. The source badge sits under the price, and while
 * the box is editable so does the currency. A foreign P0 shows its quoted price here and the peso
 * figure beside it.
 */
function CostCells({ line, canCost, onSave }) {
  const cost = lineCost(line);
  const single = line.components.length <= 1;
  const badge = cost ? SOURCE_BADGE[cost.source] : null;
  return (
    <>
      <TableCell className={cn(CELL, NUM, "w-40")} data-testid="sheet-price">
        <Cell
          label={`Price ${line.number}`}
          noun="The price"
          value={cost?.price}
          numeric
          money
          align="right"
          placeholder="Type a cost"
          readOnly={!canCost || !single || (cost && cost.currency !== "PHP")}
          onSave={onSave}
          className="min-w-28"
        />
        <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
          {canCost && single && cost && <span>{cost.currency}</span>}
          {badge && <StatusBadge label={badge.label} theme={badge.theme} />}
        </div>
      </TableCell>
      <TableCell className={cn(CELL, NUM, "w-36 border-r-0")} data-testid="sheet-pesos">
        {cost ? pesos(cost.pesos) : <span className="text-muted-foreground">—</span>}
      </TableCell>
    </>
  );
}

export default function CostingSheet({ matrix, opportunity, writes, canWrite }) {
  const lines = matrix.tenderLines;
  const { totals } = matrix;
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showCost = tierReadsCost(matrix.tier, "acquire_unit");
  const canCost = showCost && matrix.bands.includes(COSTING_BAND.PURCHASING);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const priced = lines.filter((line) => !line.included);

  const save = (line, fields) => async (value) => {
    await costingMatrixService.updateTenderLine(line.id, fields(value));
    await writes.refresh();
  };

  // Typing a price writes the row's one part (made on the spot when the line has none yet); it reads "Typed" from then on.
  const saveCost = (line) => async (value) => {
    const [part] = line.components;
    if (part) await costingMatrixService.updateComponent(part.id, { acquireUnit: value });
    else await costingMatrixService.addComponent(line.id, { name: itemName(line), quantity: line.quantity, unit: line.unit, acquireUnit: value });
    await writes.refresh();
  };

  return (
    <div className="space-y-3" data-testid="costing-sheet">
      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-4 sm:divide-y-0">
        <Fact label="S0 · client">
          <span className="font-mono text-xs">{opportunity?.sales_reference ?? opportunity?.sor_code ?? "—"}</span>
          {opportunity?.client_name ? ` · ${opportunity.client_name}` : ""}
        </Fact>
        <Fact label="S0 lines" sub={lines.length === priced.length ? undefined : `${lines.length - priced.length} included`}>
          {lines.length}
        </Fact>
        {showAbc && (
          <Fact label="ABC total" sub={totals.missingAbc ? `${totals.missingAbc} without one` : undefined}>
            {pesos(totals.abcTotal)}
          </Fact>
        )}
        {showOffer && (
          <Fact
            label="Final Offer total"
            sub={totals.missingOffer ? `${totals.missingOffer} without one` : totals.percentOfAbc == null ? undefined : `${totals.percentOfAbc.toFixed(1)}% of the ABC`}
          >
            {pesos(totals.finalOfferTotal)}
          </Fact>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="border-separate border-spacing-0 text-[13px]">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={cn(GROUP, FROZEN)}>S0 line</th>
              <th className={GROUP} />
              <th colSpan={1 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0)} className={cn(GROUP, !showCost && "border-r-0")}>
                Sales · the client&apos;s ask
              </th>
              {showCost && (
                <th colSpan={2} className={cn(GROUP, "border-r-0")}>
                  Purchasing · cost
                </th>
              )}
            </TableRow>
            <TableRow>
              <th className={cn(HEAD, FROZEN)}>Item</th>
              <th className={cn(HEAD, "text-right")}>Qty</th>
              <th className={cn(HEAD, !showAbc && !showOffer && !showCost && "border-r-0")}>Client asks for</th>
              {showAbc && <th className={cn(HEAD, "text-right", !showOffer && !showCost && "border-r-0")}>ABC / unit</th>}
              {showOffer && <th className={cn(HEAD, !showCost && "border-r-0", "text-right")}>Final Offer / unit</th>}
              {showCost && <th className={cn(HEAD, "text-right")}>Price</th>}
              {showCost && <th className={cn(HEAD, "border-r-0 text-right")}>In pesos</th>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={3 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0) + (showCost ? 2 : 0)} className="px-3 py-4 text-sm text-muted-foreground">
                  No S0 lines yet.
                </TableCell>
              </TableRow>
            )}
            {lines.map((line, index) => {
              const kid = line.included;
              const parent = kid ? byId.get(line.includedIn) : null;
              const startsBlock = !kid && index > 0;
              const parts = line.components.length;
              return (
                <TableRow
                  key={line.id}
                  data-testid="sheet-row"
                  data-included={kid ? "true" : "false"}
                  className={cn("hover:bg-transparent", startsBlock && "[&>td]:border-t [&>td]:border-t-mauve-7", kid && "[&>td:not(:first-child)]:bg-muted/40")}
                >
                  <TableCell className={cn(CELL, FROZEN, kid ? "bg-muted" : "bg-card", "min-w-[11rem] max-w-[13rem] sm:min-w-[17rem] sm:max-w-[19rem]")}>
                    <div className={cn("flex gap-2", kid && "pl-5")}>
                      {kid && <CornerDownRight size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />}
                      <div className="min-w-0">
                        <div className={cn(!kid && "font-semibold")}>{itemName(line)}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span>{kid ? `comes with ${parent ? itemName(parent) : "the line above"}` : `line ${line.number}`}</span>
                          {line.source !== "sor_line" && <StatusBadge label="Not on the S0" theme="amber" />}
                          {parts > 1 && <span>· {parts} parts</span>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, NUM)}>
                    {line.quantity}
                    {line.unit && <div className={SUB}>{line.unit}</div>}
                  </TableCell>
                  <TableCell className={cn(CELL, "min-w-[14rem] max-w-[17rem]", !showAbc && !showOffer && !showCost && "border-r-0")}>
                    {kid ? null : (
                      <Cell
                        label={`Client asks for ${line.number}`}
                        noun="The client's ask"
                        value={askOf(line)}
                        multiline
                        placeholder="The client's words"
                        readOnly={!canWrite}
                        onSave={save(line, (value) => ({ tenderSpecification: value || itemName(line) }))}
                      />
                    )}
                  </TableCell>
                  {showAbc && (
                    <TableCell className={cn(CELL, NUM, "w-36", !showOffer && !showCost && "border-r-0")}>
                      {kid ? (
                        <span className="text-muted-foreground">incl.</span>
                      ) : (
                        <Cell
                          label={`ABC / unit ${line.number}`}
                          noun="ABC"
                          value={line.abc_unit}
                          numeric
                          money
                          align="right"
                          placeholder="Budget"
                          readOnly={!canWrite}
                          onSave={save(line, (value) => ({ abcUnit: value }))}
                          className="min-w-28"
                        />
                      )}
                    </TableCell>
                  )}
                  {showOffer && (
                    <TableCell className={cn(CELL, NUM, "w-40", !showCost && "border-r-0")}>
                      {kid ? (
                        <span className="text-muted-foreground">incl.</span>
                      ) : (
                        <>
                          <Cell
                            label={`Final Offer / unit ${line.number}`}
                            noun="Final Offer"
                            value={line.final_offer_unit}
                            numeric
                            money
                            align="right"
                            placeholder="Our bid"
                            readOnly={!canWrite}
                            onSave={save(line, (value) => ({ finalOfferUnit: value }))}
                            className="min-w-28"
                          />
                          {line.totals.overAbc && <div className="mt-1 text-xs text-destructive">Over the ABC</div>}
                        </>
                      )}
                    </TableCell>
                  )}
                  {showCost && <CostCells line={line} canCost={canCost} onSave={saveCost(line)} />}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">A box you can type in is yours to change. An S0 line priced at ₱0 reads as included in the line above it.</p>
    </div>
  );
}

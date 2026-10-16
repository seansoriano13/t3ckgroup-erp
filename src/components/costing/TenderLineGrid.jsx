import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowDown, ArrowUp, ListPlus, Plus, Trash2 } from "lucide-react";

import { Button } from "../ui/button";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import StatusBadge from "../StatusBadge";
import { costingMatrixService, requestsByComponent } from "../../services/costingMatrixService";
import { opportunityService } from "../../services/opportunityService";
import { COSTING_BAND, COMPONENT_BANDS, inAnyBand, tierReads, tierReadsCost } from "../../constants/costing";
import { formatPHP } from "../../constants/sor";
import { costingKeys } from "./costingKeys";
import { Cell, StockBadge } from "./GridCell";
import { factorLabel, percentLabel, pesos } from "./gridFormat";
import { useCostingWrites, useInchargeOptions } from "./useCostingWrites";
import ComponentBlock from "./ComponentBlock";
import CostingSummary from "./CostingSummary";
import CostRowGrid from "./CostRowGrid";
import InchargeSelects from "./InchargeSelects";
import MarkupDefault from "./MarkupDefault";
import SorLinePicker from "./SorLinePicker";

/**
 * The Tender Lines of the Costing Matrix (#267): what the client asked for, with
 * its ABC and our Final Offer, numbered 1, 2, …. Which columns show is the
 * viewer's tier (a Stage Participant gets the lines and no money); which cells
 * type is the viewer's band (only the Deal Team writes here), the rest read-only.
 * Every refusal shows beside what was refused.
 *
 * Each Tender Line carries its Components (#268), nested under it as 1.1, 1.2 with a bundle's
 * Inclusions beneath it, and the cost-only rows come after the lines. The matrix's Sales and
 * Purchasing incharge sit at the top.
 *
 * Markup (#269): beside Final Offer each line shows the Markup Price its Components suggest (Sales and the
 * Closed Book); the Closed Book alone also sees the markup it actually achieves against the target, per line
 * and overall, and sets the default factor. Nothing fills Final Offer.
 */
export default function TenderLineGrid({ matrix, opportunityId, opportunity, actorId }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removing, setRemoving] = useState(null);
  const writes = useCostingWrites(opportunityId);
  const { busy, notice, run, refresh } = writes;
  const incharge = useInchargeOptions(opportunity);

  const canWrite = matrix.bands.includes(COSTING_BAND.SALES);
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showQuotation = tierReads(matrix.tier, "quotation_price_unit");
  const showMarkupPrice = tierReadsCost(matrix.tier, "markup_price_unit");
  const showAchieved = tierReadsCost(matrix.tier, "markup_factor");
  const lines = matrix.tenderLines;

  const { data: stockSnapshot } = useQuery({
    queryKey: costingKeys.stock(opportunityId),
    queryFn: () => opportunityService.getStockSnapshot(opportunityId),
    enabled: lines.some((l) => l.source === "sor_line"),
    retry: false,
  });

  // What is being bought for each Component (#273): the Requested Items that name it, with their statuses.
  // A failed read leaves the Components without it rather than failing the grid.
  const { data: componentRequests } = useQuery({
    queryKey: costingKeys.requests(opportunityId),
    queryFn: () => costingMatrixService.componentRequests(opportunityId),
    enabled: lines.some((l) => l.components.length > 0),
    staleTime: 0,
    retry: false,
  });
  const requests = requestsByComponent(componentRequests);

  const saveLine = async (line, fields) => {
    await costingMatrixService.updateTenderLine(line.id, fields);
    await refresh();
  };

  const move = (index, by) => {
    const ids = lines.map((l) => l.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => costingMatrixService.reorder(matrix.matrixId, ids));
  };

  const { totals } = matrix;
  const bundles = lines.flatMap((l) => l.components.filter((c) => c.is_bundle));
  const columnCount = 4 + (showAbc ? 2 : 0) + (showOffer ? 2 : 0) + (showMarkupPrice ? 1 : 0) + (showAchieved ? 1 : 0) + 1;
  const canSalesIncharge = inAnyBand(matrix.bands, COMPONENT_BANDS.sales_incharge_id);
  const canPurchasingIncharge = inAnyBand(matrix.bands, COMPONENT_BANDS.purchasing_incharge_id);

  return (
    <div className="space-y-3">
      <InchargeSelects
        sales={matrix.matrix?.sales_incharge_id}
        purchasing={matrix.matrix?.purchasing_incharge_id}
        salesOptions={incharge.salesOptions}
        purchasingOptions={incharge.purchasingOptions}
        canSales={canSalesIncharge}
        canPurchasing={canPurchasingIncharge}
        onSave={async (who) => {
          await costingMatrixService.setIncharge({ matrixId: matrix.matrixId }, who);
          await refresh();
        }}
      />

      {showAchieved && <MarkupDefault matrix={matrix} writes={writes} />}

      {canWrite && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => costingMatrixService.addTenderLine(matrix.matrixId, {}, actorId))}>
            <Plus size={14} aria-hidden="true" />
            Add Tender Line
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setPickerOpen(true)}>
            <ListPlus size={14} aria-hidden="true" />
            Pick from an SOR line
          </Button>
        </div>
      )}

      {notice && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}

      {lines.length === 0 ? (
        <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-6 text-center text-sm text-muted-foreground">
          No Tender Lines yet.{canWrite ? " Add what the client asked for, or pick it from the SOR's products." : ""}
        </p>
      ) : (
        <div className="rounded-xl border border-border/70 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">No.</TableHead>
                <TableHead className="min-w-[16rem]">Tender Specification</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                {showAbc && <TableHead className="w-36 text-right">ABC / unit</TableHead>}
                {showAbc && <TableHead className="w-36 text-right">ABC total</TableHead>}
                {showOffer && <TableHead className="w-40 text-right">Final Offer / unit</TableHead>}
                {showOffer && <TableHead className="w-36 text-right">Final Offer total</TableHead>}
                {showMarkupPrice && <TableHead className="w-40 text-right">Markup Price total</TableHead>}
                {showAchieved && <TableHead className="w-44 text-right">Achieved / target</TableHead>}
                <TableHead className="w-28">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((line, index) => (
                <Fragment key={line.id}>
                <TableRow data-testid="tender-line">
                  <TableCell className="align-top font-semibold tabular-nums">{line.number}</TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Tender Specification ${line.number}`}
                      value={line.tender_specification}
                      multiline
                      readOnly={!canWrite}
                      onSave={(value) => saveLine(line, { tenderSpecification: value })}
                    />
                    {line.source === "sor_line" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">From an SOR line</span>
                        {line.sorChange && <span className="font-medium text-amber-12">{line.sorChange.label}</span>}
                        <StockBadge quantity={line.quantity} odooProductId={line.odoo_product_id} snapshotData={stockSnapshot?.data} />
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <Cell label={`Unit ${line.number}`} value={line.unit} readOnly={!canWrite} onSave={(value) => saveLine(line, { unit: value })} />
                  </TableCell>
                  <TableCell className="align-top">
                    <Cell
                      label={`Quantity ${line.number}`}
                      noun="Quantity"
                      value={line.quantity}
                      numeric
                      required
                      align="right"
                      readOnly={!canWrite}
                      onSave={(value) => saveLine(line, { quantity: value })}
                    />
                  </TableCell>
                  {showAbc && (
                    <TableCell className="align-top">
                      <Cell
                        label={`ABC ${line.number}`}
                        noun="ABC"
                        value={line.abc_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!canWrite}
                        onSave={(value) => saveLine(line, { abcUnit: value })}
                      />
                    </TableCell>
                  )}
                  {showAbc && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(line.totals.abcTotal)}</TableCell>}
                  {showOffer && (
                    <TableCell className="align-top">
                      <Cell
                        label={`Final Offer ${line.number}`}
                        noun="Final Offer"
                        value={line.final_offer_unit}
                        numeric
                        money
                        align="right"
                        readOnly={!canWrite}
                        onSave={(value) => saveLine(line, { finalOfferUnit: value })}
                      />
                      {showQuotation && line.quotation_price_unit != null && Number(line.quotation_price_unit) !== Number(line.final_offer_unit) && (
                        <p className="mt-1 text-right text-xs text-muted-foreground" data-testid="quotation-price">
                          Quotation {formatPHP(Number(line.quotation_price_unit))}
                        </p>
                      )}
                    </TableCell>
                  )}
                  {showOffer && (
                    <TableCell className="text-right align-top text-sm tabular-nums">
                      <span className="block">{pesos(line.totals.finalOfferTotal)}</span>
                      {line.totals.overAbc && (
                        <StatusBadge label="Over ABC" theme="red" className="mt-1" title="Final Offer total is above the ABC total" />
                      )}
                    </TableCell>
                  )}
                  {showMarkupPrice && (
                    <TableCell className="text-right align-top text-sm tabular-nums" data-testid="line-markup-price">
                      {pesos(line.markup.priceTotal)}
                    </TableCell>
                  )}
                  {showAchieved && (
                    <TableCell className="text-right align-top text-sm tabular-nums" data-testid="line-achieved">
                      {line.markup.achievedFactor === null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="block font-medium">
                            {factorLabel(line.markup.achievedFactor)} {percentLabel(line.markup.achievedFactor)}
                          </span>
                          {line.markup.targetFactor !== null && (
                            <span className="block text-xs text-muted-foreground">
                              against {factorLabel(line.markup.targetFactor)} {percentLabel(line.markup.targetFactor)}
                            </span>
                          )}
                          {line.markup.targetFactor !== null && line.markup.achievedFactor < line.markup.targetFactor && (
                            <StatusBadge label="Under target" theme="amber" className="mt-1" title="The Final Offer is below what the markup suggests" />
                          )}
                        </>
                      )}
                    </TableCell>
                  )}
                  <TableCell className="align-top">
                    {canWrite && (
                      <div className="flex items-center justify-end gap-0.5">
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} up`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                          <ArrowUp size={14} aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} down`} disabled={busy || index === lines.length - 1} onClick={() => move(index, 1)}>
                          <ArrowDown size={14} aria-hidden="true" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove Tender Line ${line.number}`} disabled={busy} onClick={() => setRemoving(line)}>
                          <Trash2 size={14} aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
                <TableRow data-testid="tender-line-components" className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={columnCount} className="p-0">
                    <ComponentBlock line={line} matrix={matrix} bundles={bundles} stockData={stockSnapshot?.data} incharge={incharge} writes={writes} requests={requests} />
                  </TableCell>
                </TableRow>
                </Fragment>
              ))}
              {(showAbc || showOffer || showMarkupPrice) && (
                <TableRow data-testid="tender-totals">
                  <TableCell colSpan={4} className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Total
                  </TableCell>
                  {showAbc && <TableCell />}
                  {showAbc && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(totals.abcTotal)}
                      {totals.missingAbc > 0 && <span className="block text-xs font-normal text-muted-foreground">{totals.missingAbc} without ABC</span>}
                    </TableCell>
                  )}
                  {showOffer && <TableCell />}
                  {showOffer && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(totals.finalOfferTotal)}
                      {totals.missingOffer > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">{totals.missingOffer} without Final Offer</span>
                      )}
                    </TableCell>
                  )}
                  {showMarkupPrice && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(matrix.markup.priceTotal)}</TableCell>}
                  {showAchieved && <TableCell />}
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {showAbc && showOffer && totals.percentOfAbc !== null && (
        <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="abc-percent">
          <span className="font-semibold tabular-nums">{totals.percentOfAbc.toFixed(1)}%</span>
          <span className="text-muted-foreground">of the ABC</span>
          {totals.overAbc && <StatusBadge label="Over ABC" theme="red" title="The Final Offer total is above the ABC total" />}
        </p>
      )}

      <CostRowGrid matrix={matrix} writes={writes} />

      <CostingSummary matrix={matrix} writes={writes} />

      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={removing ? `Remove Tender Line ${removing.number}?` : "Remove Tender Line?"}
        description="Its ABC, Final Offer, Components and their costs go with it. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          run(() => costingMatrixService.removeTenderLine(target.id));
        }}
      />

      <SorLinePicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        opportunityId={opportunityId}
        onPick={(sorLine) => run(() => costingMatrixService.addTenderLineFromSorLine(matrix.matrixId, sorLine, {}, actorId))}
        busy={busy}
      />
    </div>
  );
}

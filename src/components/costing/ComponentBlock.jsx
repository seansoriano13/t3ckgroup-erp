import { Fragment, useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { costingMatrixService } from "../../services/costingMatrixService";
import {
  COMPONENT_AVAILABILITY_LABEL,
  COMPONENT_BANDS,
  COMPONENT_COST_BANDS,
  COMPONENT_SOURCE_LABEL,
  COMPONENT_STATUS_LABEL,
  ROW_EDIT_BANDS,
  inAnyBand,
  tierReadsCost,
} from "../../constants/costing";
import { extended, finalAcquireTotal } from "../../utils/costingMath";
import { Cell, SelectCell, StockBadge } from "./GridCell";
import { pesos } from "./gridFormat";
import BandHeader from "./BandHeader";
import InchargeSelects from "./InchargeSelects";
import InclusionList from "./InclusionList";

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = toOptions(COMPONENT_STATUS_LABEL);
const AVAILABILITY_OPTIONS = toOptions(COMPONENT_AVAILABILITY_LABEL);
const SOURCE_OPTIONS = toOptions(COMPONENT_SOURCE_LABEL);

/**
 * The Components of one Tender Line (#268): what T3CK supplies toward it, numbered 1.1, 1.2 under
 * the line's number. A bundle is priced as a whole and lists its Inclusions beneath it. The
 * owner-band header says whose columns they are (SALES: Brand, Status, Odoo unit; PMS: P.O./RFQ
 * No., availability, Source, Acquire). A cell outside the viewer's band is read-only, and a cost
 * column the viewer's tier never received is not drawn at all. Every refusal shows beside its cell.
 */
export default function ComponentBlock({ line, matrix, bundles, stockData, incharge, writes }) {
  const { busy, run, refresh } = writes;
  const [removing, setRemoving] = useState(null);
  const [inchargeOpen, setInchargeOpen] = useState(() => new Set());

  const { bands, tier } = matrix;
  const canEditRows = inAnyBand(bands, ROW_EDIT_BANDS);
  const can = (column) => inAnyBand(bands, COMPONENT_BANDS[column]);
  const canCost = (column) => inAnyBand(bands, COMPONENT_COST_BANDS[column]);
  const showAcquire = tierReadsCost(tier, "acquire_unit");
  const showOdoo = tierReadsCost(tier, "odoo_unit");
  const showFinal = tierReadsCost(tier, "final_acquire_unit");

  const salesColumns = 2 + (showOdoo ? 2 : 0);
  const pmsColumns = 3 + (showAcquire ? 2 : 0);
  const mngtColumns = showFinal ? 2 : 0;
  const columnCount = 4 + salesColumns + pmsColumns + mngtColumns + 1;

  const saveComponent = async (component, fields) => {
    await costingMatrixService.updateComponent(component.id, fields);
    await refresh();
  };

  const toggleIncharge = (id) =>
    setInchargeOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const { components } = line;
  const withoutAcquire = components.filter((c) => c.acquire_unit === null || c.acquire_unit === undefined).length;
  const withoutFinal = components.filter((c) => c.final_acquire_unit === null || c.final_acquire_unit === undefined).length;

  return (
    <div className="space-y-2 px-3 py-3" data-testid="components" aria-label={`Components of Tender Line ${line.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Components of Tender Line {line.number}
          <span className="ml-2 font-normal normal-case tracking-normal">{components.length === 0 ? "none yet" : `${components.length}`}</span>
        </p>
        {canEditRows && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => costingMatrixService.addComponent(line.id, { name: "" }))}
          >
            <Plus size={14} aria-hidden="true" />
            Add Component
          </Button>
        )}
      </div>

      {components.length > 0 && (
        <div className="rounded-lg border border-border/70 bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead colSpan={4} />
                <BandHeader band="sales" span={salesColumns}>
                  Sales
                </BandHeader>
                <BandHeader band="pms" span={pmsColumns}>
                  PMS
                </BandHeader>
                {showFinal && (
                  <BandHeader band="mngt" span={mngtColumns}>
                    MNGT
                  </BandHeader>
                )}
                <TableHead />
              </TableRow>
              <TableRow>
                <TableHead className="w-12">No.</TableHead>
                <TableHead className="min-w-[16rem]">Component</TableHead>
                <TableHead className="w-24 text-right">Qty</TableHead>
                <TableHead className="w-24">Unit</TableHead>
                <TableHead className="w-36">Brand</TableHead>
                <TableHead className="w-36">Status</TableHead>
                {showOdoo && <TableHead className="w-36 text-right">Odoo / unit</TableHead>}
                {showOdoo && <TableHead className="w-32 text-right">Odoo total</TableHead>}
                <TableHead className="w-36">P.O./RFQ No.</TableHead>
                <TableHead className="w-36">Availability</TableHead>
                <TableHead className="w-32">Source</TableHead>
                {showAcquire && <TableHead className="w-36 text-right">Acquire / unit</TableHead>}
                {showAcquire && <TableHead className="w-32 text-right">Acquire total</TableHead>}
                {showFinal && <TableHead className="w-36 text-right">Final Acquire / unit</TableHead>}
                {showFinal && <TableHead className="w-32 text-right">Final Acquire total</TableHead>}
                <TableHead className="w-24">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {components.map((component) => {
                const overridden = Boolean(component.sales_incharge_id || component.purchasing_incharge_id);
                const label = (text) => `${text} ${component.number}`;
                return (
                  <Fragment key={component.id}>
                    <TableRow data-testid="component">
                      <TableCell className="align-top font-semibold tabular-nums">{component.number}</TableCell>
                      <TableCell className="align-top">
                        <Cell
                          label={label("Component name")}
                          noun="Name"
                          value={component.name}
                          placeholder="Component"
                          readOnly={!can("name")}
                          onSave={(value) => saveComponent(component, { name: value })}
                        />
                        <Cell
                          className="mt-1"
                          label={label("Offer Specification")}
                          noun="Offer Specification"
                          value={component.offer_specification}
                          multiline
                          placeholder="Offer Specification"
                          readOnly={!can("offer_specification")}
                          onSave={(value) => saveComponent(component, { offerSpecification: value })}
                        />
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <Checkbox
                              aria-label={label("Bundle")}
                              checked={Boolean(component.is_bundle)}
                              disabled={!can("is_bundle") || busy}
                              onCheckedChange={(checked) => run(() => costingMatrixService.updateComponent(component.id, { isBundle: Boolean(checked) }))}
                            />
                            Bundle (priced as a whole)
                          </span>
                          <span className="flex items-center gap-1.5">
                            Odoo product
                            <Cell
                              className="w-24"
                              label={label("Odoo product id")}
                              noun="Odoo product id"
                              value={component.odoo_product_id}
                              numeric
                              step="1"
                              readOnly={!can("odoo_product_id")}
                              onSave={(value) => saveComponent(component, { odooProductId: value })}
                            />
                          </span>
                          {component.odoo_product_id ? (
                            <StockBadge quantity={component.quantity} odooProductId={component.odoo_product_id} snapshotData={stockData} />
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 gap-1 px-1.5 text-xs"
                            aria-expanded={inchargeOpen.has(component.id)}
                            aria-label={label("Incharge")}
                            onClick={() => toggleIncharge(component.id)}
                          >
                            <UserRound size={12} aria-hidden="true" />
                            {overridden ? "Incharge overridden" : "Incharge"}
                          </Button>
                        </div>
                        {inchargeOpen.has(component.id) && (
                          <div className="mt-2">
                            <InchargeSelects
                              labelPrefix={`Component ${component.number} `}
                              sales={component.sales_incharge_id}
                              purchasing={component.purchasing_incharge_id}
                              salesOptions={incharge.salesOptions}
                              purchasingOptions={incharge.purchasingOptions}
                              canSales={can("sales_incharge_id")}
                              canPurchasing={can("purchasing_incharge_id")}
                              emptyLabel="Matrix default"
                              onSave={async (who) => {
                                await costingMatrixService.setIncharge({ componentId: component.id }, who);
                                await refresh();
                              }}
                            />
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="align-top">
                        <Cell
                          label={label("Component quantity")}
                          noun="Quantity"
                          value={component.quantity}
                          numeric
                          required
                          align="right"
                          readOnly={!can("quantity")}
                          onSave={(value) => saveComponent(component, { quantity: value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Cell label={label("Component unit")} value={component.unit} readOnly={!can("unit")} onSave={(value) => saveComponent(component, { unit: value })} />
                      </TableCell>
                      <TableCell className="align-top">
                        <Cell label={label("Brand")} value={component.brand} readOnly={!can("brand")} onSave={(value) => saveComponent(component, { brand: value })} />
                      </TableCell>
                      <TableCell className="align-top">
                        <SelectCell
                          label={label("Status")}
                          value={component.status}
                          options={STATUS_OPTIONS}
                          readOnly={!can("status")}
                          onSave={(value) => saveComponent(component, { status: value })}
                        />
                      </TableCell>
                      {showOdoo && (
                        <TableCell className="align-top">
                          <Cell
                            label={label("Odoo unit cost")}
                            noun="Odoo unit cost"
                            value={component.odoo_unit}
                            numeric
                            money
                            align="right"
                            readOnly={!canCost("odoo_unit")}
                            onSave={(value) => saveComponent(component, { odooUnit: value })}
                          />
                        </TableCell>
                      )}
                      {showOdoo && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(component.totals.odooTotal)}</TableCell>}
                      <TableCell className="align-top">
                        <Cell
                          label={label("P.O./RFQ No.")}
                          value={component.po_rfq_no}
                          readOnly={!can("po_rfq_no")}
                          onSave={(value) => saveComponent(component, { poRfqNo: value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <SelectCell
                          label={label("Availability")}
                          value={component.availability}
                          options={AVAILABILITY_OPTIONS}
                          readOnly={!can("availability")}
                          onSave={(value) => saveComponent(component, { availability: value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <SelectCell
                          label={label("Source")}
                          value={component.source}
                          options={SOURCE_OPTIONS}
                          readOnly={!can("source")}
                          onSave={(value) => saveComponent(component, { source: value })}
                        />
                      </TableCell>
                      {showAcquire && (
                        <TableCell className="align-top">
                          <Cell
                            label={label("Acquire")}
                            noun="Acquire"
                            value={component.acquire_unit}
                            numeric
                            money
                            align="right"
                            readOnly={!canCost("acquire_unit")}
                            onSave={(value) => saveComponent(component, { acquireUnit: value })}
                          />
                        </TableCell>
                      )}
                      {showAcquire && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(component.totals.acquireTotal)}</TableCell>}
                      {showFinal && (
                        <TableCell className="align-top">
                          <Cell
                            label={label("Final Acquire")}
                            noun="Final Acquire"
                            value={component.final_acquire_unit}
                            numeric
                            money
                            align="right"
                            readOnly={!canCost("final_acquire_unit")}
                            onSave={(value) => saveComponent(component, { finalAcquireUnit: value })}
                          />
                        </TableCell>
                      )}
                      {showFinal && (
                        <TableCell className="text-right align-top text-sm tabular-nums">{pesos(extended(component.final_acquire_unit, component.quantity))}</TableCell>
                      )}
                      <TableCell className="align-top">
                        {canEditRows && (
                          <div className="flex justify-end">
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove Component ${component.number}`} disabled={busy} onClick={() => setRemoving(component)}>
                              <Trash2 size={14} aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {component.is_bundle && (
                      <TableRow data-testid="component-inclusions">
                        <TableCell />
                        <TableCell colSpan={columnCount - 1} className="pt-0">
                          <InclusionList
                            component={component}
                            bands={bands}
                            otherBundles={bundles.filter((b) => b.id !== component.id)}
                            writes={writes}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
              {(showAcquire || showOdoo || showFinal) && (
                <TableRow data-testid="component-totals">
                  <TableCell colSpan={6} className="text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Components total
                  </TableCell>
                  {showOdoo && <TableCell />}
                  {showOdoo && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(line.totals.odooTotal)}</TableCell>}
                  <TableCell colSpan={3} />
                  {showAcquire && <TableCell />}
                  {showAcquire && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(line.totals.acquireTotal)}
                      {withoutAcquire > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {withoutAcquire} without Acquire
                        </span>
                      )}
                    </TableCell>
                  )}
                  {showFinal && <TableCell />}
                  {showFinal && (
                    <TableCell className="text-right text-sm font-semibold tabular-nums">
                      {pesos(finalAcquireTotal(components))}
                      {withoutFinal > 0 && (
                        <span className="block text-xs font-normal text-muted-foreground">{withoutFinal} without Final Acquire</span>
                      )}
                    </TableCell>
                  )}
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
        title={removing ? `Remove Component ${removing.number}?` : "Remove Component?"}
        description="Its costs and Inclusions go with it. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          run(() => costingMatrixService.removeComponent(target.id));
        }}
      />
    </div>
  );
}

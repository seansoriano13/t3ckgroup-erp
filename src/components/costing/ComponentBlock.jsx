import { Fragment, useState } from "react";
import { Plus, Trash2, UserRound } from "lucide-react";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import ConfirmDialog from "../ui/ConfirmDialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table";
import { costingMatrixService } from "../../services/costingMatrixService";
import { describeComplianceRollup } from "../../utils/costingMath";
import {
  COMPONENT_AVAILABILITY_LABEL,
  COMPONENT_BANDS,
  COMPONENT_COST_BANDS,
  COMPONENT_SOURCE_LABEL,
  COMPONENT_STATUS_LABEL,
  COSTING_BAND,
  ROW_EDIT_BANDS,
  COSTING_TIER,
  inAnyBand,
  tierReadsCost,
  tierReadsLandedCost,
} from "../../constants/costing";
import { extended, finalAcquireTotal } from "../../utils/costingMath";
import { Cell, SelectCell, StockBadge } from "./GridCell";
import { unitOptionsWith } from "../../constants/procurement";
import { factorLabel, percentLabel, pesos } from "./gridFormat";
import BandHeader from "./BandHeader";
import ComplianceCell from "./ComplianceCell";
import InchargeSelects from "./InchargeSelects";
import InclusionList from "./InclusionList";
import ComponentRequests from "./ComponentRequests";
import ComponentCanvass, { BrandProposal, FromCanvass } from "./ComponentCanvass";
import SupplierMismatch from "./SupplierMismatch";
import ComponentPurchases from "./ComponentPurchases";
import { LandedCostCell, LandedCostRollup } from "./LandedCost";

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = toOptions(COMPONENT_STATUS_LABEL);
const AVAILABILITY_OPTIONS = toOptions(COMPONENT_AVAILABILITY_LABEL);
const SOURCE_OPTIONS = toOptions(COMPONENT_SOURCE_LABEL);

/**
 * The Components of one Tender Line (#268): what T3CK supplies toward it, numbered 1.1, 1.2 under
 * the line's number. A bundle is priced as a whole and lists its Inclusions beneath it. The
 * owner-band header says whose columns they are (SALES: Brand, Status, Odoo unit; PMS: P.O./RFQ
 * No., availability, Source, Acquire; TECH: Compliance, its note and the recommended alternative). The
 * Tender Specification sits beside each Offer Specification, and the line's roll-up
 * ("2 of 5 deviate · 1 not evaluated") heads the block. A cell outside the viewer's band is read-only, and a cost
 * column the viewer's tier never received is not drawn at all. Every refusal shows beside its cell.
 * Under each Component, what Purchasing is buying for it (#273): its Requested Items and their statuses,
 * `requests` mapping a Component's id to those items.
 *
 * Markup (#269): the Closed Book sees each Component's factor (×1.35 and +35%, its own override or the
 * matrix default) and can type an override if it is on the Final Acquire list; Sales and the Closed Book
 * see the Markup Price per unit and in total. Purchasing sees neither, so Acquire never meets a factor.
 *
 * Landed Cost (#283): a fourth cost beside Acquire, Odoo and Final Acquire, for the money tier only,
 * with its Provisional or Final mark or why it is blank. Under P.O./RFQ No., every tier sees the
 * Requested Items' PO numbers, each PO's IPAS and "ordered 3 of 5".
 */
export default function ComponentBlock({ line, matrix, bundles, stockData, incharge, writes, requests = new Map(), canvasses = new Map(), opportunityId, actorId }) {
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
  const showFactor = tierReadsCost(tier, "markup_factor");
  const showMarkupPrice = tierReadsCost(tier, "markup_price_unit");
  const showLanded = tierReadsLandedCost(tier);

  const salesColumns = 2 + (showOdoo ? 2 : 0);
  const pmsColumns = 3 + (showAcquire ? 2 : 0);
  const mngtColumns = showFinal ? 2 : 0;
  const landedColumns = showLanded ? 2 : 0;
  const markupColumns = (showFactor ? 1 : 0) + (showMarkupPrice ? 2 : 0);
  const columnCount = 4 + salesColumns + pmsColumns + mngtColumns + landedColumns + markupColumns + 1 + 1;
  const canEvaluate = inAnyBand(bands, COMPONENT_BANDS.compliance);
  // A Canvass is Purchasing's own job (#276); every other reader of the matrix may open one that exists.
  const canCanvass = inAnyBand(bands, [COSTING_BAND.PURCHASING]);

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
  const rollup = describeComplianceRollup(line.compliance);
  const withoutAcquire = components.filter((c) => c.acquire_unit === null || c.acquire_unit === undefined).length;
  const withoutFinal = components.filter((c) => c.final_acquire_unit === null || c.final_acquire_unit === undefined).length;

  return (
    <div className="space-y-2 px-3 py-3" data-testid="components" aria-label={`Components of Tender Line ${line.number}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Components of Tender Line {line.number}
          <span className="ml-2 font-normal normal-case tracking-normal">{components.length === 0 ? "none yet" : `${components.length}`}</span>
          {rollup && (
            <span className="ml-3 font-normal normal-case tracking-normal" data-testid="line-compliance">
              {rollup}
            </span>
          )}
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
                {showLanded && (
                  <BandHeader band="pms" span={landedColumns}>
                    Actual
                  </BandHeader>
                )}
                {markupColumns > 0 && (
                  <BandHeader band="mngt" span={markupColumns}>
                    Markup
                  </BandHeader>
                )}
                <BandHeader band="tech" span={1}>
                  Technical
                </BandHeader>
                <TableHead />
              </TableRow>
              <TableRow>
                <TableHead className="w-12 min-w-12">No.</TableHead>
                <TableHead className="min-w-[26rem]">Component</TableHead>
                <TableHead className="w-24 min-w-24 text-right">Qty</TableHead>
                <TableHead className="w-24 min-w-24">Unit</TableHead>
                <TableHead className="w-36 min-w-36">Brand</TableHead>
                <TableHead className="w-36 min-w-36">Status</TableHead>
                {showOdoo && <TableHead className="w-36 min-w-36 text-right">Odoo / unit</TableHead>}
                {showOdoo && <TableHead className="w-32 min-w-32 text-right">Odoo total</TableHead>}
                <TableHead className="w-36 min-w-36">P.O./RFQ No.</TableHead>
                <TableHead className="w-36 min-w-36">Availability</TableHead>
                <TableHead className="w-32 min-w-32">Source</TableHead>
                {showAcquire && <TableHead className="w-36 min-w-36 text-right">Acquire / unit</TableHead>}
                {showAcquire && <TableHead className="w-32 min-w-32 text-right">Acquire total</TableHead>}
                {showFinal && <TableHead className="w-36 min-w-36 text-right">Final Acquire / unit</TableHead>}
                {showFinal && <TableHead className="w-32 min-w-32 text-right">Final Acquire total</TableHead>}
                {showLanded && <TableHead className="w-36 min-w-36 text-right">Landed Cost / unit</TableHead>}
                {showLanded && <TableHead className="w-32 min-w-32 text-right">Landed Cost total</TableHead>}
                {showFactor && <TableHead className="w-36 min-w-36 text-right">Markup factor</TableHead>}
                {showMarkupPrice && <TableHead className="w-36 min-w-36 text-right">Markup Price / unit</TableHead>}
                {showMarkupPrice && <TableHead className="w-36 min-w-36 text-right">Markup Price total</TableHead>}
                <TableHead className="w-64 min-w-64">Compliance</TableHead>
                <TableHead className="w-24 min-w-24">
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
                        {component.canvassNoWinner && (
                          <p className="mt-1 text-xs text-muted-foreground" data-testid="canvass-no-winner-note">
                            These values came from Canvass {component.canvass?.number}, which has no winner picked now.
                          </p>
                        )}
                        <div className="mt-1 grid gap-2 sm:grid-cols-2" data-testid="specifications">
                          <div className="space-y-1">
                            <p className="text-label text-muted-foreground">Tender Specification</p>
                            <p className="whitespace-pre-line rounded-md bg-muted/40 px-2 py-1.5 text-sm text-foreground" aria-label={label("Tender Specification")}>
                              {line.tender_specification || "—"}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-label text-muted-foreground">
                              Offer Specification
                              {component.fromCanvass?.offerSpecification && <FromCanvass what="Offer Specification" number={component.canvass?.number} />}
                            </p>
                            <Cell
                              label={label("Offer Specification")}
                              noun="Offer Specification"
                              value={component.offer_specification}
                              multiline
                              placeholder="Offer Specification"
                              readOnly={!can("offer_specification")}
                              onSave={(value) => saveComponent(component, { offerSpecification: value })}
                            />
                          </div>
                        </div>
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
                        <ComponentRequests items={requests.get(component.id)} />
                        <ComponentCanvass
                          component={component}
                          canvass={canvasses.get(component.id)}
                          canWrite={canCanvass}
                          opportunityId={opportunityId}
                          actorId={actorId}
                        />
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
                        <SelectCell
                          label={label("Component unit")}
                          value={component.unit}
                          options={unitOptionsWith(component.unit)}
                          clearable={false}
                          readOnly={!can("unit")}
                          onSave={(value) => saveComponent(component, { unit: value })}
                        />
                      </TableCell>
                      <TableCell className="align-top">
                        <Cell label={label("Brand")} value={component.brand} readOnly={!can("brand")} onSave={(value) => saveComponent(component, { brand: value })} />
                        <BrandProposal component={component} canAccept={can("brand")} onAccepted={refresh} />
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
                        <SupplierMismatch mismatch={component.supplierMismatch} />
                        <ComponentPurchases
                          component={component}
                          linkIpas={tier !== COSTING_TIER.PARTICIPANT}
                          canPick={inAnyBand(bands, [COSTING_BAND.PURCHASING])}
                          onPicked={refresh}
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
                          {component.fromCanvass?.acquire && <FromCanvass what="Acquire" number={component.canvass?.number} className="mt-1 block text-right" />}
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
                      {showLanded && (
                        <TableCell className="align-top">
                          <LandedCostCell landedCost={component.landed_cost} which="unit" />
                        </TableCell>
                      )}
                      {showLanded && (
                        <TableCell className="align-top">
                          <LandedCostCell landedCost={component.landed_cost} which="total" />
                        </TableCell>
                      )}
                      {showFactor && (
                        <TableCell className="align-top">
                          <Cell
                            label={label("Markup factor")}
                            noun="Markup factor"
                            value={component.markup_factor}
                            numeric
                            step="0.0001"
                            align="right"
                            placeholder={matrix.defaultFactor ? `${matrix.defaultFactor}` : "Default"}
                            readOnly={!canCost("markup_factor")}
                            onSave={(value) => saveComponent(component, { markupFactor: value })}
                          />
                          <p className="mt-1 text-right text-xs text-muted-foreground" data-testid="markup-factor-shown">
                            {component.markup.factor === null
                              ? "No factor yet"
                              : `${factorLabel(component.markup.factor)} · ${percentLabel(component.markup.factor)}${
                                  component.markup_factor === null || component.markup_factor === undefined ? " (default)" : ""
                                }`}
                          </p>
                        </TableCell>
                      )}
                      {showMarkupPrice && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(component.markup.priceUnit)}</TableCell>}
                      {showMarkupPrice && <TableCell className="text-right align-top text-sm tabular-nums">{pesos(component.markup.priceTotal)}</TableCell>}
                      <TableCell className="align-top">
                        <ComplianceCell component={component} number={component.number} readOnly={!canEvaluate} onChanged={refresh} />
                      </TableCell>
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
              {(showAcquire || showOdoo || showFinal || showMarkupPrice || showLanded) && (
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
                  {showLanded && <TableCell />}
                  {showLanded && (
                    <TableCell className="text-right text-sm font-semibold">
                      <LandedCostRollup rollup={line.totals.landedCost} />
                    </TableCell>
                  )}
                  {showFactor && <TableCell />}
                  {showMarkupPrice && <TableCell />}
                  {showMarkupPrice && <TableCell className="text-right text-sm font-semibold tabular-nums">{pesos(line.markup.priceTotal)}</TableCell>}
                  <TableCell />
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
        description="Its costs and Inclusions go with it. The change stays in the history. A Component with a Requested Item or a typed P.O./RFQ No. can't be removed until it is unlinked."
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

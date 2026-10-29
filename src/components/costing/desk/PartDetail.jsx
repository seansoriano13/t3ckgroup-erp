import { useState } from "react";
import { Trash2, UserRound } from "lucide-react";

import { Button } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import { costingMatrixService } from "../../../services/costingMatrixService";
import {
  COMPONENT_AVAILABILITY_LABEL,
  COMPONENT_BANDS,
  COMPONENT_COST_BANDS,
  COMPONENT_SOURCE_LABEL,
  COMPONENT_STATUS_LABEL,
  COSTING_BAND,
  COSTING_TIER,
  inAnyBand,
  tierReadsCost,
  tierReadsLandedCost,
} from "../../../constants/costing";
import { unitOptionsWith } from "../../../constants/procurement";
import { extended } from "../../../utils/costingMath";
import { cn } from "../../../lib/utils";
import { Cell, Readout, SelectCell, StockBadge } from "../GridCell";
import { factorLabel, percentLabel, pesos } from "../gridFormat";
import ComplianceCell from "../ComplianceCell";
import InchargeSelects from "../InchargeSelects";
import InclusionList from "../InclusionList";
import ComponentRequests from "../ComponentRequests";
import ComponentCanvass, { BrandProposal, FromCanvass } from "../ComponentCanvass";
import SupplierMismatch from "../SupplierMismatch";
import ComponentPurchases from "../ComponentPurchases";
import { LandedCostCell } from "../LandedCost";
import { costComparisonText } from "../../../utils/costComparison";

const toOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const STATUS_OPTIONS = toOptions(COMPONENT_STATUS_LABEL);
const AVAILABILITY_OPTIONS = toOptions(COMPONENT_AVAILABILITY_LABEL);
const SOURCE_OPTIONS = toOptions(COMPONENT_SOURCE_LABEL);

const CAPTION = "text-balance text-label font-bold uppercase tracking-wider text-muted-foreground";
const HINT = "text-xs text-muted-foreground";

/**
 * One field: its caption over its control, the way the record windows read. `wide` takes two columns. It
 * takes two rows of its Band's grid (caption, then control), so a caption that wraps on a phone moves its
 * neighbours' boxes down with it and a row of boxes stays level.
 */
export function Field({ label, children, className, wide = false }) {
  return (
    <div className={cn("row-span-2 grid min-w-0 grid-rows-subgrid", wide && "col-span-2", className)}>
      <p className={cn(CAPTION, "self-end pb-1")}>{label}</p>
      <div className="min-w-0 space-y-1 pb-3">{children}</div>
    </div>
  );
}

/**
 * A run of fields under one name (who writes them), full width and parted from the next by a hairline: the
 * name sits to the left once there is room, and the fields run two, then four, to a row, so every box in a
 * row stands at the same height and nothing leaves a hole.
 */
export function Band({ title, hint, children, className }) {
  return (
    <section className={cn("@container border-t border-border/70 pt-4 pb-1 first:border-t-0 first:pt-0 last:pb-0", className)} aria-label={title}>
      <div className="grid gap-x-6 gap-y-3 @3xl:grid-cols-[8rem_minmax(0,1fr)]">
        <div>
          <h5 className="text-sm font-semibold text-foreground @3xl:pt-0.5">{title}</h5>
          {hint && <p className={HINT}>{hint}</p>}
        </div>
        <div className="grid grid-cols-2 items-start gap-x-4 @3xl:grid-cols-4">{children}</div>
      </div>
    </section>
  );
}

/**
 * Everything about one Component (#268), one band per writer: what we supply (name, quantity, the Offer
 * Specification beside the tender's words), Sales (Brand, Status, Odoo unit cost), Purchasing (availability,
 * source, P.O./RFQ, Acquire), the Final Acquire and the Landed Cost the IPAS brought back, the markup,
 * Technical's verdict, then its Odoo link, bundle and incharge. Under them the Canvass, what is being
 * bought for it and, for a bundle, its Inclusions. A total sits beside its unit figure, never under it. A
 * field outside the viewer's band reads; a cost the tier was never sent is not drawn. Labels end in the
 * Component's number (Brand 1.1) so each field is findable.
 *
 * `asProduct`: the line's only Component, the product it is priced from, so the line's words are not repeated.
 */
export default function PartDetail({ component, line, matrix, writes, incharge, requests, canvasses, bundles, stockData, opportunityId, actorId, asProduct = false, onRemove }) {
  const { busy, run, refresh } = writes;
  const [inchargeOpen, setInchargeOpen] = useState(false);
  const { bands, tier } = matrix;
  const can = (column) => inAnyBand(bands, COMPONENT_BANDS[column]);
  const canCost = (column) => inAnyBand(bands, COMPONENT_COST_BANDS[column]);
  const canEditRows = inAnyBand(bands, COMPONENT_BANDS.name);
  const showAcquire = tierReadsCost(tier, "acquire_unit");
  const showOdoo = tierReadsCost(tier, "odoo_unit");
  const showFinal = false; // Final Acquire left the screen (#703); the data stays for a later clean-up.
  const showFactor = tierReadsCost(tier, "markup_factor");
  const showMarkupPrice = tierReadsCost(tier, "markup_price_unit");
  const showLanded = tierReadsLandedCost(tier);
  const canEvaluate = inAnyBand(bands, COMPONENT_BANDS.compliance);
  const label = (text) => `${text} ${component.number}`;
  const save = async (fields) => {
    await costingMatrixService.updateComponent(component.id, fields);
    await refresh();
  };
  const overridden = Boolean(component.sales_incharge_id || component.purchasing_incharge_id);
  const ownFactor = component.markup_factor !== null && component.markup_factor !== undefined;

  return (
    <div data-testid="component">
      <Band title={asProduct ? "Product" : "Part"} hint="What we supply">
        <Field label="Name" wide>
          <div className="flex items-start gap-1">
            <Cell className="flex-1" label={label("Component name")} noun="Name" value={component.name} placeholder="What it is" readOnly={!can("name")} onSave={(value) => save({ name: value })} />
            {!asProduct && canEditRows && onRemove && (
              <Button type="button" variant="ghost" size="icon-lg" className="shrink-0" aria-label={`Remove Component ${component.number}`} disabled={busy} onClick={onRemove}>
                <Trash2 size={14} aria-hidden="true" />
              </Button>
            )}
          </div>
        </Field>
        <Field label="Qty">
          <Cell label={label("Component quantity")} noun="Quantity" value={component.quantity} numeric required readOnly={!can("quantity")} onSave={(value) => save({ quantity: value })} />
        </Field>
        <Field label="Unit">
          <SelectCell label={label("Component unit")} value={component.unit} options={unitOptionsWith(component.unit)} clearable={false} readOnly={!can("unit")} onSave={(value) => save({ unit: value })} />
        </Field>
        <div className="col-span-2 grid gap-x-4 @3xl:col-span-4 @3xl:grid-cols-2" data-testid="specifications">
          {/* A part sits beside the line's own words; the product of a line priced from it is right under them already. */}
          {!asProduct && (
            <Field label="Tender Specification">
              <p className="min-h-[72px] whitespace-pre-line rounded-lg bg-muted/50 px-3 py-2 text-sm text-foreground" aria-label={label("Tender Specification")}>
                {line.tender_specification || "—"}
              </p>
            </Field>
          )}
          <Field
            className={asProduct ? "@3xl:col-span-2" : undefined}
            label={
              <>
                Offer Specification
                {component.fromCanvass?.offerSpecification && <FromCanvass what="Offer Specification" number={component.canvass?.number} />}
              </>
            }
          >
            <Cell
              label={label("Offer Specification")}
              noun="Offer Specification"
              value={component.offer_specification}
              multiline
              placeholder="What we offer, in our words"
              readOnly={!can("offer_specification")}
              onSave={(value) => save({ offerSpecification: value })}
            />
          </Field>
        </div>
        {component.canvassNoWinner && (
          <p className={cn(HINT, "col-span-2 pb-3 @3xl:col-span-4")} data-testid="canvass-no-winner-note">
            These values came from Canvass {component.canvass?.number}, which has no winner picked now.
          </p>
        )}
      </Band>

      <Band title="Sales">
        <Field label="Brand">
          <Cell label={label("Brand")} value={component.brand} placeholder="Make or brand" readOnly={!can("brand")} onSave={(value) => save({ brand: value })} />
          <BrandProposal component={component} canAccept={can("brand")} onAccepted={refresh} />
        </Field>
        <Field label="Status">
          <SelectCell label={label("Status")} value={component.status} options={STATUS_OPTIONS} readOnly={!can("status")} onSave={(value) => save({ status: value })} />
        </Field>
        {showOdoo && (
          <>
            <Field label="Odoo cost / unit">
              <Cell label={label("Odoo unit cost")} noun="Odoo unit cost" value={component.odoo_unit} numeric money placeholder="0.00" readOnly={!canCost("odoo_unit")} onSave={(value) => save({ odooUnit: value })} />
            </Field>
            <Field label="Odoo total">
              <Readout>{pesos(component.totals.odooTotal)}</Readout>
            </Field>
          </>
        )}
      </Band>

      <Band title="Purchasing">
        <Field label="Availability">
          <SelectCell label={label("Availability")} value={component.availability} options={AVAILABILITY_OPTIONS} readOnly={!can("availability")} onSave={(value) => save({ availability: value })} />
        </Field>
        <Field label="Source">
          <SelectCell label={label("Source")} value={component.source} options={SOURCE_OPTIONS} readOnly={!can("source")} onSave={(value) => save({ source: value })} />
        </Field>
        <Field label="P.O./RFQ No." wide>
          <Cell label={label("P.O./RFQ No.")} value={component.po_rfq_no} placeholder="Once it is ordered or quoted" readOnly={!can("po_rfq_no")} onSave={(value) => save({ poRfqNo: value })} />
          <SupplierMismatch mismatch={component.supplierMismatch} />
          <ComponentPurchases component={component} linkIpas={tier !== COSTING_TIER.PARTICIPANT} canPick={inAnyBand(bands, [COSTING_BAND.PURCHASING])} onPicked={refresh} />
        </Field>
        {showAcquire && (
          <>
            <Field
              label={
                <>
                  Acquire / unit
                  {component.fromCanvass?.acquire && <FromCanvass what="Acquire" number={component.canvass?.number} />}
                </>
              }
            >
              <Cell label={label("Acquire")} noun="Acquire" value={component.acquire_unit} numeric money placeholder="0.00" readOnly={!canCost("acquire_unit")} onSave={(value) => save({ acquireUnit: value })} />
              {(() => {
                const text = costComparisonText({ expected: component.acquire_unit, actual: component.p0_unit_price, quoted: component.p0_quoted_unit_price, currency: component.p0_currency, fromCanvass: component.fromCanvass?.acquire });
                return text ? <p className={cn(HINT, "mt-1")} data-testid="cost-comparison">{text}</p> : null;
              })()}
            </Field>
            <Field label="Acquire total">
              <Readout>{pesos(component.totals.acquireTotal)}</Readout>
            </Field>
          </>
        )}
      </Band>

      {(showFinal || showLanded) && (
        <Band title="Final cost">
          {showFinal && (
            <>
              <Field label="Final cost / unit">
                <Cell label={label("Final cost")} noun="Final cost" value={component.final_acquire_unit} numeric money placeholder="0.00" readOnly={!canCost("final_acquire_unit")} onSave={(value) => save({ finalAcquireUnit: value })} />
              </Field>
              <Field label="Final cost total">
                <Readout>{pesos(extended(component.final_acquire_unit, component.quantity))}</Readout>
              </Field>
            </>
          )}
          {showLanded && (
            <>
              <Field label="Landed Cost / unit">
                <div className="flex min-h-9 items-center">
                  <LandedCostCell landedCost={component.landed_cost} which="unit" />
                </div>
              </Field>
              <Field label="Landed Cost total">
                <div className="flex min-h-9 items-center">
                  <LandedCostCell landedCost={component.landed_cost} which="total" />
                </div>
              </Field>
            </>
          )}
        </Band>
      )}

      {(showFactor || showMarkupPrice) && (
        <Band title="Markup">
          {showFactor && (
            <Field label="Markup factor">
              <Cell
                label={label("Markup factor")}
                noun="Markup factor"
                value={component.markup_factor}
                numeric
                step="0.0001"
                placeholder={matrix.defaultFactor ? `${matrix.defaultFactor} (the default)` : "The default"}
                readOnly={!canCost("markup_factor")}
                onSave={(value) => save({ markupFactor: value })}
              />
              <p className={HINT} data-testid="markup-factor-shown">
                {component.markup.factor === null ? "No factor yet" : `${factorLabel(component.markup.factor)} · ${percentLabel(component.markup.factor)}${ownFactor ? "" : " (default)"}`}
              </p>
            </Field>
          )}
          {showMarkupPrice && (
            <>
              <Field label="Markup Price / unit">
                <Readout>{pesos(component.markup.priceUnit)}</Readout>
              </Field>
              <Field label="Markup Price total">
                <Readout strong>{pesos(component.markup.priceTotal)}</Readout>
              </Field>
            </>
          )}
        </Band>
      )}

      <Band title="Technical">
        <Field label="Compliance" wide>
          <ComplianceCell component={component} number={component.number} readOnly={!canEvaluate} onChanged={refresh} />
        </Field>
      </Band>

      <Band title="Odoo and bundle">
        <Field label="Odoo product">
          <Cell label={label("Odoo product id")} noun="Odoo product id" value={component.odoo_product_id} numeric step="1" placeholder="Product id" readOnly={!can("odoo_product_id")} onSave={(value) => save({ odooProductId: value })} />
        </Field>
        <Field label="Stock">
          <div className="flex min-h-9 items-center">
            {component.odoo_product_id ? (
              <StockBadge quantity={component.quantity} odooProductId={component.odoo_product_id} snapshotData={stockData} />
            ) : (
              <span className={HINT}>Not linked to Odoo</span>
            )}
          </div>
        </Field>
        <Field label="Bundle" wide>
          <span className="flex min-h-9 items-center gap-2 text-sm text-foreground">
            <Checkbox
              aria-label={label("Bundle")}
              checked={Boolean(component.is_bundle)}
              disabled={!can("is_bundle") || busy}
              onCheckedChange={(checked) => run(() => costingMatrixService.updateComponent(component.id, { isBundle: Boolean(checked) }))}
            />
            Priced as a whole, with a checklist of what comes in it
          </span>
        </Field>
        <div className="col-span-2 @3xl:col-span-4">
          <Button type="button" variant="ghost" size="sm" className="-ml-2.5 text-muted-foreground" aria-expanded={inchargeOpen} aria-label={label("Incharge")} onClick={() => setInchargeOpen((v) => !v)}>
            <UserRound aria-hidden="true" />
            {overridden ? "Its own incharge is set" : "Give it its own incharge"}
          </Button>
          {inchargeOpen && (
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
          )}
        </div>
      </Band>

      <div className="space-y-3 empty:hidden">
        <ComponentRequests items={requests.get(component.id)} />
        <ComponentCanvass component={component} canvass={canvasses?.get(component.id)} canWrite={can("source")} opportunityId={opportunityId} actorId={actorId} />
        {component.is_bundle && (
          <div data-testid="component-inclusions">
            <InclusionList component={component} bands={bands} otherBundles={bundles.filter((b) => b.id !== component.id)} writes={writes} />
          </div>
        )}
      </div>
    </div>
  );
}

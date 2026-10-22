import { useState } from "react";
import { ArrowDown, ArrowUp, PackageOpen, Plus, Trash2 } from "lucide-react";

import { Button } from "../../ui/button";
import ConfirmDialog from "../../ui/ConfirmDialog";
import StatusBadge from "../../StatusBadge";
import LinerList from "../../record/LinerList";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COSTING_BAND, ROW_EDIT_BANDS, inAnyBand, tierReads, tierReadsCost } from "../../../constants/costing";
import { unitOptionsWith } from "../../../constants/procurement";
import { formatPHP } from "../../../constants/sor";
import { describeComplianceRollup } from "../../../utils/costingMath";
import { linePlay } from "../../../utils/costingPlayground";
import { Cell, Readout, SelectCell, StockBadge } from "../GridCell";
import { factorLabel, percentLabel, pesos } from "../gridFormat";
import PartDetail, { Band, Field } from "./PartDetail";

const HINT = "text-xs text-muted-foreground";

/** What a part's row says in one line: its brand and state, and what it costs when the tier has it. */
function partSub(component, showAcquire) {
  const bits = [`${component.quantity} ${component.unit ?? ""}`.trim()];
  if (component.brand) bits.push(component.brand);
  if (showAcquire) bits.push(component.acquire_unit == null ? "no Acquire yet" : `Acquire ${pesos(component.totals.acquireTotal)}`);
  if (component.compliance === "deviates") bits.push("deviates");
  return bits.join(" · ");
}

/**
 * One Tender Line opened in the Costing Desk, in the same bands as its parts: the tender (the client's words,
 * unit, quantity, ABC), then our offer (the Markup Price, the Final Offer with a "Use" that takes what the
 * markup suggests, and its total); then what we supply. A line filled from the SOR has one Component, the product, and is priced from it
 * directly; "Break down into parts" adds more when the line needs them, and a line with several parts
 * lists them, each opening in place. Labels keep the line's number (ABC 1, Final Offer 1).
 */
export default function LineDetail({ line, index, count, matrix, ctx }) {
  const { writes, actorId, opportunityId, incharge, requests, canvasses, bundles, stockData } = ctx;
  const { busy, run, refresh } = writes;
  const [removingLine, setRemovingLine] = useState(false);
  const [removingPart, setRemovingPart] = useState(null);

  const canWrite = matrix.bands.includes(COSTING_BAND.SALES);
  const canEditParts = inAnyBand(matrix.bands, ROW_EDIT_BANDS);
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showQuotation = tierReads(matrix.tier, "quotation_price_unit");
  const showMarkupPrice = tierReadsCost(matrix.tier, "markup_price_unit");
  const showAchieved = tierReadsCost(matrix.tier, "markup_factor");
  const showAcquire = tierReadsCost(matrix.tier, "acquire_unit");

  const saveLine = async (fields) => {
    await costingMatrixService.updateTenderLine(line.id, fields);
    await refresh();
  };
  const move = (by) => {
    const ids = matrix.tenderLines.map((l) => l.id);
    const target = index + by;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    run(() => costingMatrixService.reorder(matrix.matrixId, ids));
  };
  const addPart = (fields = { name: "" }) => run(() => costingMatrixService.addComponent(line.id, fields));

  // What the saved markup suggests per unit, kept at the ABC. Only the Closed Book can work it out.
  const suggested = showAchieved ? linePlay(line, matrix.defaultFactor, { capAtAbc: true }) : null;
  const rollup = describeComplianceRollup(line.compliance);
  const parts = line.components;
  const partProps = { line, matrix, writes, incharge, requests, canvasses, bundles, stockData, opportunityId, actorId };

  return (
    <div className="space-y-4 bg-muted/20 px-4 py-4" data-testid="line-detail">
      <div className="flex min-h-7 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {line.source === "sor_line" ? (
          <>
            <span>From the SOR&apos;s products</span>
            {line.sorChange && <span className="font-medium text-amber-12">{line.sorChange.label}</span>}
            <StockBadge quantity={line.quantity} odooProductId={line.odoo_product_id} snapshotData={stockData} />
          </>
        ) : (
          <span>Typed here, not on the SOR</span>
        )}
        {rollup && (
          <span className="font-medium text-foreground" data-testid="line-compliance">
            {rollup}
          </span>
        )}
        {canWrite && (
          <span className="ml-auto flex items-center gap-0.5">
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} up`} disabled={busy || index === 0} onClick={() => move(-1)}>
              <ArrowUp size={14} aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Move Tender Line ${line.number} down`} disabled={busy || index === count - 1} onClick={() => move(1)}>
              <ArrowDown size={14} aria-hidden="true" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove Tender Line ${line.number}`} disabled={busy} onClick={() => setRemovingLine(true)}>
              <Trash2 size={14} aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>

      <div>
        <Band title="The tender" hint="What the client asked for">
          <Field label="Tender Specification" className="col-span-2 @3xl:col-span-4">
            <Cell label={`Tender Specification ${line.number}`} value={line.tender_specification} multiline placeholder="The client's words" readOnly={!canWrite} onSave={(value) => saveLine({ tenderSpecification: value })} />
          </Field>
          <Field label="Unit">
            <SelectCell label={`Unit ${line.number}`} value={line.unit} options={unitOptionsWith(line.unit)} clearable={false} readOnly={!canWrite} onSave={(value) => saveLine({ unit: value })} />
          </Field>
          <Field label="Qty">
            <Cell label={`Quantity ${line.number}`} noun="Quantity" value={line.quantity} numeric required readOnly={!canWrite} onSave={(value) => saveLine({ quantity: value })} />
          </Field>
          {showAbc && (
            <>
              <Field label="ABC / unit">
                <Cell label={`ABC ${line.number}`} noun="ABC" value={line.abc_unit} numeric money placeholder="The client's budget" readOnly={!canWrite} onSave={(value) => saveLine({ abcUnit: value })} />
              </Field>
              <Field label="ABC total">
                <Readout>{pesos(line.totals.abcTotal)}</Readout>
              </Field>
            </>
          )}
        </Band>

        {(showOffer || showMarkupPrice) && (
          <Band title="Our offer" hint="What we bid for it">
            {showMarkupPrice && (
              <Field label="Markup Price total">
                <Readout data-testid="line-markup-price">{pesos(line.markup.priceTotal)}</Readout>
                <p className={HINT}>The parts&apos; cost at their markup</p>
              </Field>
            )}
            {showOffer && (
              <>
                <Field label="Final Offer / unit">
                  <Cell label={`Final Offer ${line.number}`} noun="Final Offer" value={line.final_offer_unit} numeric money placeholder="Our bid per unit" readOnly={!canWrite} onSave={(value) => saveLine({ finalOfferUnit: value })} />
                  {canWrite && suggested?.offerUnit != null && Number(suggested.offerUnit) !== Number(line.final_offer_unit) && (
                    <Button type="button" variant="link" size="xs" className="h-auto px-0" disabled={busy} onClick={() => run(() => costingMatrixService.updateTenderLine(line.id, { finalOfferUnit: suggested.offerUnit }))}>
                      Use {formatPHP(Number(suggested.offerUnit))}
                      {suggested.capped ? " (the ABC)" : ""}
                    </Button>
                  )}
                  {showQuotation && line.quotation_price_unit != null && Number(line.quotation_price_unit) !== Number(line.final_offer_unit) && (
                    <p className={HINT} data-testid="quotation-price">
                      Quotation {formatPHP(Number(line.quotation_price_unit))}
                    </p>
                  )}
                </Field>
                <Field label="Final Offer total" wide={!showMarkupPrice}>
                  <Readout strong className="flex-wrap gap-x-2">
                    {pesos(line.totals.finalOfferTotal)}
                    {line.totals.overAbc && <StatusBadge label="Over ABC" theme="red" title="Final Offer total is above the ABC total" />}
                  </Readout>
                  {showAchieved && line.markup.achievedFactor !== null && (
                    <p className={HINT} data-testid="line-achieved">
                      {factorLabel(line.markup.achievedFactor)} {percentLabel(line.markup.achievedFactor)}
                      {line.markup.targetFactor !== null && ` against ${factorLabel(line.markup.targetFactor)} ${percentLabel(line.markup.targetFactor)}`}
                      {line.markup.targetFactor !== null && line.markup.achievedFactor < line.markup.targetFactor && (
                        <StatusBadge label="Under target" theme="amber" className="ml-1" title="The Final Offer is below what the markup suggests" />
                      )}
                    </p>
                  )}
                </Field>
              </>
            )}
          </Band>
        )}
      </div>

      <section className="space-y-3 border-t border-border/70 pt-4" data-testid="components" aria-label={`Components of Tender Line ${line.number}`}>
        <div className="flex flex-wrap items-center gap-2">
          <PackageOpen size={16} aria-hidden="true" className="text-muted-foreground" />
          <h4 className="text-sm font-semibold text-foreground">
            {parts.length === 1 ? "Priced from its product" : parts.length === 0 ? "No product or parts yet" : `Parts · ${parts.length}`}
          </h4>
          {canEditParts && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={busy}
              onClick={() => (parts.length === 0 ? addPart({ name: line.tender_specification?.split("\n")[0] ?? "" }) : addPart())}
            >
              <Plus aria-hidden="true" />
              {parts.length === 0 ? "Add what we supply" : parts.length === 1 ? "Break down into parts" : "Add a part"}
            </Button>
          )}
        </div>
        {parts.length === 1 && <PartDetail component={parts[0]} asProduct {...partProps} onRemove={() => setRemovingPart(parts[0])} />}
        {parts.length > 1 && (
          <LinerList
            label={`Parts of Tender Line ${line.number}`}
            rows={parts.map((c) => ({
              key: c.id,
              label: `${c.number} ${c.name || "unnamed part"}`,
              main: `${c.number} · ${c.name || "Unnamed part"}`,
              sub: partSub(c, showAcquire),
              quantity: showAcquire ? pesos(c.totals.acquireTotal) : null,
              badge: c.compliance === "deviates" ? { label: "Deviates", theme: "amber" } : null,
              children: (
                <div className="bg-card px-4 py-4">
                  <PartDetail component={c} {...partProps} onRemove={() => setRemovingPart(c)} />
                </div>
              ),
            }))}
            total={showAcquire ? { label: "Parts Acquire total", value: pesos(line.totals.acquireTotal), testId: "component-totals" } : undefined}
          />
        )}
      </section>

      <ConfirmDialog
        open={removingLine}
        onOpenChange={setRemovingLine}
        title={`Remove Tender Line ${line.number}?`}
        description="Its ABC, Final Offer, product, parts and their costs go with it. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          setRemovingLine(false);
          run(() => costingMatrixService.removeTenderLine(line.id));
        }}
      />
      <ConfirmDialog
        open={Boolean(removingPart)}
        onOpenChange={(open) => !open && setRemovingPart(null)}
        title={removingPart ? `Remove Component ${removingPart.number}?` : "Remove Component?"}
        description="Its costs and Inclusions go with it. The change stays in the history. A Component with a Requested Item or a typed P.O./RFQ No. can't be removed until it is unlinked."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removingPart;
          setRemovingPart(null);
          run(() => costingMatrixService.removeComponent(target.id));
        }}
      />
    </div>
  );
}

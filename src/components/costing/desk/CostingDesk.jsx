import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Plus, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "../../ui/button";
import LinerList from "../../record/LinerList";
import NumbersStrip from "../../record/NumbersStrip";
import RecordHeader from "../../record/RecordHeader";
import { costingMatrixService, requestsByComponent } from "../../../services/costingMatrixService";
import { canvassService } from "../../../services/canvassService";
import { opportunityService } from "../../../services/opportunityService";
import { COMPONENT_BANDS, COSTING_BAND, inAnyBand, tierReads, tierReadsBidDecision, tierReadsCost } from "../../../constants/costing";
import { matrixPlay } from "../../../utils/costingPlayground";
import { useAuth } from "../../../context/AuthContext";
import { useCostingMatrix } from "../useCostingMatrix";
import { useCostingWrites, useInchargeOptions } from "../useCostingWrites";
import { costingKeys } from "../costingKeys";
import { pesos } from "../gridFormat";
import BidDecisionPanel from "../BidDecisionPanel";
import OtherCosts from "./OtherCosts";
import CostGuide from "./CostGuide";
import CostingSummary from "../CostingSummary";
import EvaluationBar from "../EvaluationBar";
import InchargeSelects from "../InchargeSelects";
import SignoffBar from "../SignoffBar";
import { LandedCostRollup } from "../LandedCost";
import LineDetail from "./LineDetail";
import CostingSheet from "./CostingSheet";
import MarkupPlayground from "./MarkupPlayground";

const firstLine = (text) => (text ?? "").split("\n")[0].trim();
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A line's state in one word, for its badge. */
function lineBadge(line, { showAbc, showOffer, showCost }) {
  if (showAbc && line.abc_unit == null) return { label: "No ABC", theme: "amber" };
  if (showCost && (line.components.length === 0 || line.totals.acquireTotal === null)) return { label: "No cost", theme: "amber" };
  if (showOffer && line.final_offer_unit == null) return { label: "No offer", theme: "amber" };
  if (showOffer && line.totals.overAbc) return { label: "Over ABC", theme: "red" };
  return null;
}

/**
 * The matrix fills itself from the SOR's products once, when it is opened with no line yet and the
 * viewer may fill it; "Refresh from the SOR" adds any product added since, and both then ask Odoo for
 * the products' costs. Nothing a person typed is ever overwritten.
 */
function useFill(matrix, opportunityId, writes) {
  const [odooNote, setOdooNote] = useState(null);
  const tried = useRef(false);
  const canFill = Boolean(matrix) && inAnyBand(matrix.bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING]);

  const fill = () =>
    writes.run(async () => {
      const added = await costingMatrixService.fillFromSor(opportunityId);
      const odoo = await costingMatrixService.fillOdooCosts(opportunityId);
      if (!odoo?.success) setOdooNote({ tone: "warning", text: `${added ? `${plural(added, "line")} added. ` : ""}Odoo's costs could not be read (${odoo?.message ?? "no answer"}); type them in, or try again.` });
      else if (added || odoo.filled) setOdooNote({ tone: "info", text: `${added ? `${plural(added, "line")} added from the SOR. ` : ""}${odoo.filled ? `${plural(odoo.filled, "cost")} filled from Odoo.` : ""}${odoo.unpriced ? ` ${plural(odoo.unpriced, "product")} have no cost in Odoo.` : ""}` });
      else setOdooNote({ tone: "info", text: "Everything on the SOR is already here." });
    });

  useEffect(() => {
    if (!matrix || tried.current || !canFill || matrix.tenderLines.length > 0) return;
    tried.current = true;
    fill();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening, when the matrix is empty
  }, [matrix, canFill]);

  return { canFill, fill, odooNote };
}

/**
 * The Costing Desk: one SOR's Costing Matrix in its record window (layout A, chosen 2026-10-22). The
 * overview first (ABC, Final Offer, cost, margin), then the lines as a liner list that opens in place to
 * be typed into, the other costs and the summary; on the right the Bid Decision, the markup playground
 * and the sign-offs. Lines come from the SOR's products, each priced from its product until it is broken
 * down into parts. Every figure and every write is the database's to allow; a tier sees only its columns.
 */
export default function CostingDesk({ opportunityId, opportunity }) {
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const { data: matrix, isLoading, isError, error } = useCostingMatrix(opportunityId);
  const writes = useCostingWrites(opportunityId);
  const incharge = useInchargeOptions(opportunity);
  const { canFill, fill, odooNote } = useFill(matrix, opportunityId, writes);
  const lines = matrix?.tenderLines ?? [];

  const { data: stockSnapshot } = useQuery({
    queryKey: costingKeys.stock(opportunityId),
    queryFn: () => opportunityService.getStockSnapshot(opportunityId),
    enabled: lines.some((l) => l.source === "sor_line"),
    retry: false,
  });
  // What is being bought for each Component (#273). A failed read leaves the parts without it.
  const { data: componentRequests } = useQuery({
    queryKey: costingKeys.requests(opportunityId),
    queryFn: () => costingMatrixService.componentRequests(opportunityId),
    enabled: lines.some((l) => l.components.length > 0),
    staleTime: 0,
    retry: false,
  });
  const componentIds = lines.flatMap((l) => l.components.map((c) => c.id));
  const { data: canvassRows } = useQuery({
    queryKey: [...costingKeys.canvasses(opportunityId), componentIds],
    queryFn: () => canvassService.listForComponents(componentIds),
    enabled: componentIds.length > 0,
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the Costing Matrix…</p>;
  if (isError) return <p className="text-sm text-destructive">{error?.message || "The Costing Matrix could not be read."}</p>;
  if (!matrix) {
    return (
      <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground" data-testid="no-costing-matrix">
        No Costing Matrix yet, or it is not yours to see. It opens when the flow&apos;s &quot;Open Costing Matrix&quot; step runs.
      </p>
    );
  }

  const { totals } = matrix;
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showCost = tierReadsCost(matrix.tier, "acquire_unit");
  const showClosedBook = tierReadsCost(matrix.tier, "markup_factor");
  const canWrite = matrix.bands.includes(COSTING_BAND.SALES);
  const play = showCost ? matrixPlay(matrix, matrix.defaultFactor) : null;
  const margin = showCost && totals.finalOfferTotal != null && play?.cost != null ? totals.finalOfferTotal - play.cost : null;

  const ctx = {
    writes,
    actorId,
    opportunityId,
    incharge,
    requests: requestsByComponent(componentRequests),
    canvasses: new Map((canvassRows || []).map((row) => [row.component_id, row])),
    bundles: lines.flatMap((l) => l.components.filter((c) => c.is_bundle)),
    stockData: stockSnapshot?.data,
  };

  const stats = [];
  if (showCost)
    stats.push({ key: "cost", label: "Our cost (Acquire)", value: pesos(play.cost), sub: play.cost == null ? "Some costs are blank" : "Products, parts and other costs", tone: play.cost == null ? "warning" : undefined });
  if (showCost)
    stats.push({ key: "margin", label: "Margin", value: pesos(margin), sub: margin == null ? "Needs every offer and cost" : `${((margin / totals.finalOfferTotal) * 100).toFixed(1)}% of the offer` });

  const rows = lines.map((line, index) => {
    const parts = line.components.length;
    const bits = [`${line.quantity} ${line.unit ?? ""}`.trim()];
    if (showAbc) bits.push(`ABC ${pesos(line.totals.abcTotal)}`);
    if (showCost) bits.push(`Cost ${pesos(line.totals.acquireTotal)}`);
    bits.push(parts === 1 ? "priced from its product" : parts === 0 ? "nothing supplied yet" : `${parts} parts`);
    return {
      key: line.id,
      testId: "tender-line",
      label: `Tender Line ${line.number}`,
      main: `${line.number}. ${firstLine(line.tender_specification) || "Untitled line"}`,
      sub: bits.join(" · "),
      quantity: showOffer ? pesos(line.totals.finalOfferTotal) : null,
      badge: lineBadge(line, { showAbc, showOffer, showCost }),
      children: <LineDetail line={line} index={index} count={lines.length} matrix={matrix} ctx={ctx} />,
    };
  });

  const canSalesIncharge = inAnyBand(matrix.allBands ?? matrix.bands, COMPONENT_BANDS.sales_incharge_id);
  const canPurchasingIncharge = inAnyBand(matrix.allBands ?? matrix.bands, COMPONENT_BANDS.purchasing_incharge_id);

  return (
    <div className="space-y-6 pb-2" data-testid="costing-desk">
      <RecordHeader
        reference={opportunity?.sor_code ?? "SOR"}
        name={opportunity?.project_title ?? "Costing Matrix"}
        line={[opportunity?.sales_reference && `SO ${opportunity.sales_reference}`, opportunity?.client_name].filter(Boolean).join(" · ") || null}
      />
      {stats.length > 0 && <NumbersStrip stats={stats} />}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px]" data-testid="fill-note">
            <Sparkles size={14} aria-hidden="true" className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              {odooNote ? (
                <span className={odooNote.tone === "warning" ? "text-amber-11" : undefined}>{odooNote.text}</span>
              ) : (
                <>Lines come from the SOR&apos;s products, with their Odoo cost.</>
              )}
            </span>
            {canFill && (
              <Button type="button" variant="ghost" size="xs" disabled={writes.busy} onClick={fill}>
                <RefreshCw size={12} aria-hidden="true" />
                Refresh from the SOR
              </Button>
            )}
          </div>

          {writes.notice && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {writes.notice}
            </p>
          )}

          <InchargeSelects
            sales={matrix.matrix?.sales_incharge_id}
            purchasing={matrix.matrix?.purchasing_incharge_id}
            salesOptions={incharge.salesOptions}
            purchasingOptions={incharge.purchasingOptions}
            canSales={canSalesIncharge}
            canPurchasing={canPurchasingIncharge}
            onSave={async (who) => {
              await costingMatrixService.setIncharge({ matrixId: matrix.matrixId }, who);
              await writes.refresh();
            }}
          />

          <EvaluationBar matrix={matrix} opportunityId={opportunityId} actorId={actorId} nameOf={incharge.nameOf} writes={writes} />

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-foreground">Lines · {lines.length}</h3>
            <CostingSheet matrix={matrix} opportunity={opportunity} writes={writes} canWrite={canWrite} />
            {/* Every line still opens in place for its parts, costs and evaluation; the later tickets move those onto the grid rows. */}
            {rows.length > 0 && (
              <div className="space-y-2" data-testid="line-details">
                <h4 className="text-sm font-bold text-foreground">
                  Line details
                  <span className="font-normal text-muted-foreground"> · open a line for its parts and costs</span>
                </h4>
                <LinerList
                  label="Tender Lines"
                  rows={rows}
                  empty="No lines yet."
                  total={showOffer ? { label: "Final Offer total", value: pesos(totals.finalOfferTotal), testId: "tender-totals" } : undefined}
                />
              </div>
            )}
            {canWrite && (
              <Button type="button" variant="outline" size="sm" disabled={writes.busy} onClick={() => writes.run(() => costingMatrixService.addTenderLine(matrix.matrixId, {}, actorId))}>
                <Plus size={14} aria-hidden="true" />
                Add a line that is not on the SOR
              </Button>
            )}
            {"landedCost" in totals && (
              <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="matrix-landed-cost">
                <span className="text-muted-foreground">Landed Cost, every Component</span>
                <LandedCostRollup rollup={totals.landedCost} />
              </p>
            )}
          </section>

          <OtherCosts matrix={matrix} writes={writes} />
          <CostingSummary matrix={matrix} writes={writes} />
          <CostGuide opportunityId={opportunityId} />
        </div>

        <aside className="min-w-0 space-y-4 xl:sticky xl:top-2 xl:self-start">
          {tierReadsBidDecision(matrix.tier) && <BidDecisionPanel matrix={matrix} writes={writes} nameOf={incharge.nameOf} />}
          {showClosedBook && <MarkupPlayground key={matrix.defaultFactor ?? "none"} matrix={matrix} writes={writes} />}
          <SignoffBar matrix={matrix} nameOf={incharge.nameOf} />
        </aside>
      </div>
    </div>
  );
}

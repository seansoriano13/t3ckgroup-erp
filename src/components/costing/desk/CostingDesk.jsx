import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Gavel, ListTree, Plus, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "../../ui/button";
import SlideOver, { SlideOverBody } from "../../ui/SlideOver";
import StatusBadge from "../../StatusBadge";
import SidePanel from "../../ui/SidePanel";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import RecordHeader from "../../record/RecordHeader";
import { costingMatrixService, requestsByComponent } from "../../../services/costingMatrixService";
import { canvassService } from "../../../services/canvassService";
import { opportunityService } from "../../../services/opportunityService";
import { BID_VERDICT_LABEL, COMPONENT_BANDS, COSTING_BAND, inAnyBand, tierReads, tierReadsBidDecision, tierReadsCost } from "../../../constants/costing";
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
import TechnicalVerdict from "../TechnicalVerdict";
import SignoffBar from "../SignoffBar";
import { LandedCostRollup } from "../LandedCost";
import LineDetail from "./LineDetail";
import CostingSheet from "./CostingSheet";
import MarkupPlayground from "./MarkupPlayground";
import { useMarkupPlay } from "./useMarkupPlay";
import S0LinkSuggestions from "./S0LinkSuggestions";

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
  const queryClient = useQueryClient();
  const [odooNote, setOdooNote] = useState(null);
  const tried = useRef(false);
  const canFill = Boolean(matrix) && inAnyBand(matrix.bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING]);

  const fill = () =>
    writes.run(async () => {
      const { added, leftOut } = await costingMatrixService.fillFromSor(opportunityId);
      const odoo = await costingMatrixService.fillOdooCosts(opportunityId);
      await queryClient.refetchQueries({ queryKey: costingKeys.all(opportunityId) });
      // A Go locks the sheet, so S0 lines that match no row are not added; say which ones.
      const shown = leftOut.slice(0, 3).map((l) => l.name || "an unnamed line").join(", ");
      const left = leftOut.length
        ? ` ${plural(leftOut.length, "S0 line")} left out while the sheet is locked by a Go: ${shown}${leftOut.length > 3 ? `, and ${leftOut.length - 3} more` : ""}.`
        : "";
      if (!odoo?.success) setOdooNote({ tone: "warning", text: `${added ? `${plural(added, "line")} added. ` : ""}Odoo's costs could not be read (${odoo?.message ?? "no answer"}); type them in, or try again.${left}` });
      else if (added || odoo.filled || left) setOdooNote({ tone: left ? "warning" : "info", text: `${added ? `${plural(added, "line")} added from the SOR. ` : ""}${odoo.filled ? `${plural(odoo.filled, "cost")} filled from Odoo.` : ""}${odoo.unpriced ? ` ${plural(odoo.unpriced, "product")} have no cost in Odoo.` : ""}${left}`.trim() });
      else setOdooNote({ tone: "info", text: "Everything on the SOR is already here." });
    });

  useEffect(() => {
    if (!matrix || tried.current || !canFill) return;
    const needsFill =
      matrix.tenderLines.length === 0 ||
      matrix.tenderLines.some((line) =>
        line.components?.some((c) => c.odoo_product_id && (c.odoo_unit == null || c.acquire_unit == null)),
      );
    if (!needsFill) return;
    tried.current = true;
    fill();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per opening
  }, [matrix, canFill]);

  return { canFill, fill, odooNote };
}

/**
 * The Costing Desk: one SOR's Costing Matrix in its record window (layout A, chosen 2026-10-22). The
 * overview first (ABC, Final Offer, cost, margin), then the lines as one sheet, the other costs and the
 * summary. A line's parts, costs and evaluation open in a slide-over from its row, so the sheet stays
 * one table, with the markup playground as a bar right above it (#931); on the right the Bid Decision
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
  // The markup being tried (#931): the bar above the Lines table and the table's per-line preview share it.
  const markup = useMarkupPlay(matrix, writes, { enabled: Boolean(matrix) && tierReadsCost(matrix.tier, "markup_factor") });
  const lines = matrix?.tenderLines ?? [];
  // The Bid Decision is a side column only where there is room (SidePanel's own rule); elsewhere a button in the header.
  const roomy = useMediaQuery("(min-width: 1440px) and (min-height: 701px)");
  // The line open in the slide-over, by id, so it stays open while lines are moved or refreshed.
  const [openLineId, setOpenLineId] = useState(null);

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
  // Typed lines that look like an S0 line (#727): offered, never linked by name.
  const { data: s0Suggestions } = useQuery({
    queryKey: costingKeys.s0Suggestions(opportunityId),
    queryFn: () => costingMatrixService.s0LinkSuggestions(opportunityId),
    enabled: canFill && lines.some((l) => l.source === "typed" && !l.sor_item_id),
    retry: false,
  });
  const componentIds = lines.flatMap((l) => l.components.map((c) => c.id));
  const { data: canvassRows } = useQuery({
    queryKey: [...costingKeys.canvasses(opportunityId), componentIds],
    queryFn: () => canvassService.listForComponents(componentIds),
    enabled: componentIds.length > 0,
    retry: false,
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading the S0 Evaluation…</p>;
  if (isError) return <p className="text-sm text-destructive">{error?.message || "The S0 Evaluation could not be read."}</p>;
  if (!matrix) {
    return (
      <p className="rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-sm text-muted-foreground" data-testid="no-costing-matrix">
        No S0 Evaluation yet, or it is not yours to see. It opens when the flow&apos;s &quot;Open S0 Evaluation&quot; step runs.
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

  // Our cost and Margin sit in the record header row as two figures.
  const figures = [];
  if (showCost) figures.push({ key: "cost", label: "Our cost", value: pesos(play.cost), title: play.cost == null ? "Some costs are blank" : "Products, parts and other costs", warn: play.cost == null });
  if (showCost)
    figures.push({
      key: "margin",
      label: "Margin",
      value: pesos(margin),
      title: margin == null ? "Needs every offer and cost" : `${((margin / totals.finalOfferTotal) * 100).toFixed(1)}% of the offer`,
      sub: margin == null ? null : `${((margin / totals.finalOfferTotal) * 100).toFixed(1)}%`,
    });
  const bidPanel = tierReadsBidDecision(matrix.tier) ? (
    <SidePanel label="Bid decision" icon={Gavel} badge={matrix.bidDecision ? (BID_VERDICT_LABEL[matrix.bidDecision.verdict] ?? matrix.bidDecision.verdict) : null} inlineFrom={1440} width="25rem" className="xl:sticky xl:top-2 xl:self-start">
      <BidDecisionPanel matrix={matrix} writes={writes} nameOf={incharge.nameOf} opportunity={opportunity} />
      {roomy && <div className="mt-4"><SignoffBar matrix={matrix} nameOf={incharge.nameOf} /></div>}
    </SidePanel>
  ) : null;

  const openIndex = lines.findIndex((l) => l.id === openLineId);
  const openLine = openIndex >= 0 ? lines[openIndex] : null;
  const lineSummary = (line) => {
    const parts = line.components.length;
    const bits = [`${line.quantity} ${line.unit ?? ""}`.trim()];
    if (showAbc) bits.push(`ABC ${pesos(line.totals.abcTotal)}`);
    if (showCost) bits.push(`Cost ${pesos(line.totals.acquireTotal)}`);
    bits.push(parts === 1 ? "priced from its product" : parts === 0 ? "nothing supplied yet" : `${parts} parts`);
    return bits.join(" · ");
  };

  const canSalesIncharge = inAnyBand(matrix.allBands ?? matrix.bands, COMPONENT_BANDS.sales_incharge_id);
  const canPurchasingIncharge = inAnyBand(matrix.allBands ?? matrix.bands, COMPONENT_BANDS.purchasing_incharge_id);
  // The Technical in-charge (#908) is named by Sales or Purchasing, as the other incharges are.
  const canPickTechnical = inAnyBand(matrix.allBands ?? matrix.bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING]);

  return (
    <div className="space-y-6 pb-2" data-testid="costing-desk">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-3 border-b border-border pb-4" data-testid="costing-desk-header">
        <RecordHeader
          className="min-w-0 flex-1"
          reference={opportunity?.sor_code ?? "SOR"}
          name={opportunity?.project_title ?? "S0 Evaluation"}
          line={[opportunity?.sales_reference && `SO ${opportunity.sales_reference}`, opportunity?.client_name].filter(Boolean).join(" · ") || null}
        />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {figures.map((figure) => (
            <div key={figure.key} className="flex flex-col" title={figure.title} data-testid={`desk-figure-${figure.key}`}>
              <span className="text-xs text-muted-foreground">{figure.label}</span>
              <span className={`font-mono text-lg font-semibold tabular-nums ${figure.warn ? "text-amber-11" : "text-foreground"}`}>
                {figure.value}
                {figure.sub && <span className="ml-2 text-xs font-normal text-muted-foreground">{figure.sub}</span>}
              </span>
            </div>
          ))}
          {!roomy && bidPanel}
        </div>
      </div>

      <div className={roomy ? "flex items-start gap-8" : undefined}>
        <div className="min-w-0 flex-1 space-y-6">
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

          <S0LinkSuggestions
            suggestions={s0Suggestions}
            canConfirm={matrix.bands.includes(COSTING_BAND.SALES)}
            busy={writes.busy}
            onConfirm={(s) => writes.run(() => costingMatrixService.linkToS0Line(s.tenderLineId, s.sorItemId))}
          />

          {writes.notice && (
            <p role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              {writes.notice}
            </p>
          )}

          <InchargeSelects
            sales={matrix.matrix?.sales_incharge_id ?? opportunity?.deal_owner_id}
            purchasing={matrix.matrix?.purchasing_incharge_id}
            salesOptions={incharge.salesOptions}
            purchasingOptions={incharge.purchasingOptions}
            canSales={canSalesIncharge}
            canPurchasing={canPurchasingIncharge}
            technical={matrix.matrix?.technical_incharge_id}
            technicalOptions={incharge.technicalOptions}
            canTechnical={canPickTechnical}
            onSave={async (who) => {
              await costingMatrixService.setIncharge({ matrixId: matrix.matrixId }, who);
              await writes.refresh();
            }}
          />

          <EvaluationBar matrix={matrix} opportunityId={opportunityId} actorId={actorId} nameOf={incharge.nameOf} writes={writes} />

          <section className="space-y-3">
            <h3 className="text-sm font-bold text-foreground">Lines · {lines.length}</h3>
            <CostingSheet
              matrix={matrix}
              opportunity={opportunity}
              writes={writes}
              canWrite={canWrite}
              onOpenLine={setOpenLineId}
              preview={showClosedBook ? markup?.preview : null}
              toolbar={showClosedBook && markup ? <MarkupPlayground markup={markup} matrix={matrix} busy={writes.busy} /> : null}
            />
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

          <TechnicalVerdict matrix={matrix} actorId={actorId} nameOf={incharge.nameOf} writes={writes} />

          <OtherCosts matrix={matrix} writes={writes} />
          <CostingSummary matrix={matrix} writes={writes} />
          <CostGuide opportunityId={opportunityId} />
          {(!roomy || !bidPanel) && <SignoffBar matrix={matrix} nameOf={incharge.nameOf} />}
        </div>
        {roomy && bidPanel}
      </div>

      <SlideOver
        record={openLine}
        icon={ListTree}
        crumb="Lines"
        overModal
        identity={(line) => {
          const badge = lineBadge(line, { showAbc, showOffer, showCost });
          return {
            ref: `Line ${line.number}`,
            title: firstLine(line.tender_specification) || "Untitled line",
            badge: badge && <StatusBadge label={badge.label} theme={badge.theme} />,
            subtitle: [lineSummary(line), showOffer && `Final Offer ${pesos(line.totals.finalOfferTotal)}`].filter(Boolean).join(" · "),
          };
        }}
        index={Math.max(openIndex, 0)}
        total={lines.length}
        onStep={(by) => setOpenLineId(lines[openIndex + by]?.id ?? openLineId)}
        onClose={() => setOpenLineId(null)}
      >
        {(line) => {
          const index = lines.findIndex((l) => l.id === line.id);
          return (
            <SlideOverBody>
              <div data-testid="tender-line">
                <LineDetail line={line} index={index} count={lines.length} matrix={matrix} ctx={ctx} />
              </div>
            </SlideOverBody>
          );
        }}
      </SlideOver>
    </div>
  );
}

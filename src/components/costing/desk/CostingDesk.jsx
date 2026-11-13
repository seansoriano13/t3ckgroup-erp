import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { ListTree, Plus, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "../../ui/button";
import SlideOver, { SlideOverBody } from "../../ui/SlideOver";
import StatusBadge from "../../StatusBadge";
import { costingMatrixService, requestsByComponent } from "../../../services/costingMatrixService";
import { canvassService } from "../../../services/canvassService";
import { opportunityService } from "../../../services/opportunityService";
import { COSTING_BAND, inAnyBand, tierReads, tierReadsCost } from "../../../constants/costing";
import { useAuth } from "../../../context/AuthContext";
import { useCostingMatrix } from "../useCostingMatrix";
import { useCostingWrites, useInchargeOptions } from "../useCostingWrites";
import { costingKeys } from "../costingKeys";
import { pesos } from "../gridFormat";
import { StandaloneBar } from "../StandaloneDialogs";
import LineDetail from "./LineDetail";
import S0LinkSuggestions from "./S0LinkSuggestions";
import CostingSummary from "../CostingSummary";
import CorridorScreen from "./corridor/CorridorScreen";
import Overview from "./corridor/Overview";
import AfterBuying from "./corridor/AfterBuying";
import { corridorSaves } from "./corridor/corridorSaves";
import { waterfallSteps } from "./corridor/sheetModel";

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
function useFill(matrix, opportunityId, writes, standalone = false) {
  const queryClient = useQueryClient();
  const [odooNote, setOdooNote] = useState(null);
  const tried = useRef(false);
  const canFill = Boolean(matrix) && inAnyBand(matrix.bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING]);

  const fill = () =>
    writes.run(async () => {
      // A standalone evaluation (#966) has no SOR to refresh from; its lines came from the S0 and only Odoo's prices are read again.
      const { added, leftOut } = standalone ? { added: 0, leftOut: [] } : await costingMatrixService.fillFromSor(opportunityId);
      const odoo = await costingMatrixService.fillOdooCosts(opportunityId);
      await queryClient.refetchQueries({ queryKey: costingKeys.all(opportunityId) });
      // A Go locks the sheet, so S0 lines that match no row are not added; say which ones.
      const shown = leftOut.slice(0, 3).map((l) => l.name || "an unnamed line").join(", ");
      const left = leftOut.length
        ? ` ${plural(leftOut.length, "S0 line")} left out while the sheet is locked by a Go: ${shown}${leftOut.length > 3 ? `, and ${leftOut.length - 3} more` : ""}.`
        : "";
      if (!odoo?.success) setOdooNote({ tone: "warning", text: `${added ? `${plural(added, "line")} added. ` : ""}Odoo's prices could not be read (${odoo?.message ?? "no answer"}); the Odoo SRP and costs stay as they were, type them in or try again.${left}` });
      else if (added || odoo.filled || left) setOdooNote({ tone: left ? "warning" : "info", text: `${added ? `${plural(added, "line")} added from the SOR. ` : ""}${odoo.filled ? `${plural(odoo.filled, "line")} updated from Odoo.` : ""}${odoo.unpriced ? ` ${plural(odoo.unpriced, "product")} have no price in Odoo.` : ""}${left}`.trim() });
      else setOdooNote({ tone: "info", text: standalone ? "Odoo has nothing new for these lines." : "Everything on the SOR is already here." });
    });

  useEffect(() => {
    if (!matrix || tried.current || !canFill) return;
    const needsFill =
      (!standalone && matrix.tenderLines.length === 0) ||
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
 * The Costing Desk: one SOR's S0 Evaluation in its record window, drawn as the price corridor (layout F, picked
 * 2026-11-13; corridor/CorridorScreen). On top the deal's corridor, Go floor to ABC, with the offer and Revenue;
 * then the relay in work order (Costs, Final Acquire, Other costs, Offers, Specs), and on the right the decision
 * card. Overview swaps in the whole sheet with the waterfall (layout B). Kept from the desk before it: the fill
 * from the SOR and Odoo, the S0 link suggestions, a standalone evaluation's people, adding a line, and a line's
 * slide-over with its parts, costs and canvass. Every figure and every write is the database's to allow.
 */
export default function CostingDesk({ opportunityId, opportunity }) {
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const { data: matrix, isLoading, isError, error } = useCostingMatrix(opportunityId);
  const writes = useCostingWrites(opportunityId);
  const incharge = useInchargeOptions(opportunity);
  const standalone = Boolean(opportunity?.standalone);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { canFill, fill, odooNote } = useFill(matrix, opportunityId, writes, standalone);
  const lines = matrix?.tenderLines ?? [];
  // The line open in the slide-over, by id, so it stays open while lines are moved or refreshed.
  const [openLineId, setOpenLineId] = useState(null);
  // The Overview (layout B) in place of the corridor, and back.
  const [overview, setOverview] = useState(false);
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
    enabled: canFill && !standalone && lines.some((l) => l.source === "typed" && !l.sor_item_id),
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

  const showAbc = tierReads(matrix.tier, "abc_unit") && matrix.abc?.mode !== "total_only";
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showCost = tierReadsCost(matrix.tier, "acquire_unit");
  const canWrite = matrix.bands.includes(COSTING_BAND.SALES);
  const fall = waterfallSteps(matrix);
  const save = corridorSaves(matrix, writes);
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

  // What today's desk did around the sheet, kept under the corridor's header: the fill note, the S0 link
  // suggestions, a standalone evaluation's people, and adding a line that is not on the SOR.
  const banner = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-border bg-muted/40 px-3 py-2 text-[13px]" data-testid="fill-note">
        <Sparkles size={14} aria-hidden="true" className="text-muted-foreground" />
        <span className="min-w-0 flex-1">
          {odooNote ? (
            <span className={odooNote.tone === "warning" ? "text-amber-11" : undefined}>{odooNote.text}</span>
          ) : (
            <>{standalone ? "Lines were pulled from the sale order in Odoo, with their Odoo SRP." : "Lines come from the SOR's products, with their Odoo SRP."}</>
          )}
        </span>
        {canFill && (
          <Button type="button" variant="ghost" size="xs" disabled={writes.busy} onClick={fill}>
            <RefreshCw size={12} aria-hidden="true" />
            {standalone ? "Refresh from Odoo" : "Refresh from the SOR"}
          </Button>
        )}
        {canWrite && (
          <Button type="button" variant="ghost" size="xs" disabled={writes.busy} onClick={() => writes.run(() => costingMatrixService.addTenderLine(matrix.matrixId, {}, actorId))}>
            <Plus size={12} aria-hidden="true" />
            {standalone ? "Add a line" : "Add a line that is not on the SOR"}
          </Button>
        )}
      </div>
      <S0LinkSuggestions
        suggestions={s0Suggestions}
        canConfirm={matrix.bands.includes(COSTING_BAND.SALES)}
        busy={writes.busy}
        onConfirm={(s) => writes.run(() => costingMatrixService.linkToS0Line(s.tenderLineId, s.sorItemId))}
      />
      {standalone && (
        <StandaloneBar
          matrix={matrix}
          technicalOptions={incharge.technicalOptions}
          nameOf={incharge.nameOf}
          canTechnical={inAnyBand(matrix.allBands ?? matrix.bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING])}
          onSaved={async (who) => {
            if ("technical" in who) await costingMatrixService.setIncharge({ matrixId: matrix.matrixId }, { technical: who.technical });
            else await costingMatrixService.setStandaloneIncharge(matrix.matrixId, who);
            await writes.refresh();
          }}
          onLinked={(linkedOpportunityId) => {
            // From now on the SOR's rules decide, and the window opens by the SOR.
            queryClient.invalidateQueries({ queryKey: costingKeys.matrixPage });
            queryClient.invalidateQueries({ queryKey: costingKeys.standalonePage });
            navigate(`/costing-matrix/${linkedOpportunityId}`, { replace: true });
          }}
        />
      )}
    </div>
  );

  return (
    <div className="pb-2" data-testid="costing-desk">
      {overview ? (
        <Overview
          matrix={matrix}
          fall={fall}
          opportunity={opportunity}
          opportunityId={opportunityId}
          onBack={() => setOverview(false)}
          aside={<CostingSummary matrix={matrix} writes={writes} />}
          below={<AfterBuying matrix={matrix} writes={writes} />}
        />
      ) : (
        <CorridorScreen
          data={{ matrix, save, fall, writes, opportunityId }}
          opportunity={opportunity}
          onOverview={() => setOverview(true)}
          onOpenLine={setOpenLineId}
          banner={banner}
        />
      )}

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

import { ChevronRight, CornerDownRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Button } from "../../ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../ui/table";
import StatusBadge from "../../StatusBadge";
import { Cell } from "../GridCell";
import { costingMatrixService } from "../../../services/costingMatrixService";
import { COSTING_BAND, COSTING_TIER, COST_SOURCE, LANDED_COST_MARK_LABEL, tierReads, tierReadsCost, tierReadsLandedCost } from "../../../constants/costing";
import { factorLabel, lineCost, lineLanded, lineSheetMarkup } from "../../../utils/costingMath";
import { pesos } from "../gridFormat";
import { useAuth } from "../../../context/AuthContext";
import ComplianceColumn from "./ComplianceColumn";
import { useMyEvaluationTeams } from "./evaluationTeams";
import { ROAD_THEMES, lineRoad } from "../../../utils/itemRoad";

/** Where the line is on its way from plan to warehouse (utils/itemRoad), as one badge; a stuck part says so. */
function RoadBadge({ line, locked }) {
  const road = lineRoad(line, { locked });
  return (
    <span data-testid="line-road" className="inline-flex items-center gap-1">
      <StatusBadge label={road.label} theme={ROAD_THEMES[road.step]} />
      {road.stuck && <StatusBadge label="Cannot source" theme="red" />}
    </span>
  );
}

/** The word and colour under a price for where it came from; a cost Purchasing typed is amber. */
const SOURCE_BADGE = {
  [COST_SOURCE.CANVASS]: { label: "Canvass", theme: "mauve" },
  [COST_SOURCE.P0]: { label: "P0", theme: "mauve" },
  [COST_SOURCE.ODOO]: { label: "Odoo", theme: "mauve" },
  [COST_SOURCE.TYPED]: { label: "Typed", theme: "amber" },
  [COST_SOURCE.MIXED]: { label: "Mixed", theme: "mauve" },
};

/**
 * The Costing Matrix as one flat grid, one row per line of the SOR's S0 (layout A "Sheet", spec #699,
 * ticket #700). A header strip of facts, two header rows (the team that owns each column, then the
 * column), and the Item column frozen while the money scrolls sideways. A box you can type in is a
 * `Cell`; everything else is plain text. The item opens the line's slide-over (CostingDesk). This ticket draws Item, Qty, Client asks for, ABC / unit and
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
      <TableCell className={cn(CELL, NUM, "w-36")} data-testid="sheet-pesos">
        {cost ? pesos(cost.pesos) : <span className="text-muted-foreground">—</span>}
      </TableCell>
    </>
  );
}

/**
 * Landed / unit (#702): the IPAS's real Landed Cost once the row's item has one, else an estimate on the
 * peso price plus the Import add-on (Local rows take the Local default). The words under it say which.
 */
function LandedCell({ line, addons }) {
  const landed = lineLanded(line, addons);
  return (
    <TableCell className={cn(CELL, NUM, "w-40")} data-testid="sheet-landed">
      {landed ? (
        <>
          {pesos(landed.unit)}
          <div className="mt-1 flex flex-wrap items-center justify-end gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            {landed.kind === "real" ? (
              <>
                <span>Real · from the IPAS</span>
                <StatusBadge label={LANDED_COST_MARK_LABEL[landed.mark]} theme={landed.mark === "final" ? "green" : "amber"} />
              </>
            ) : (
              <span>{landed.local ? "Estimate · local" : `Estimate · +${landed.percent}%`}</span>
            )}
          </div>
        </>
      ) : (
        <span className="text-muted-foreground">—</span>
      )}
    </TableCell>
  );
}

/**
 * Multiplier, Suggested / unit and Margin / unit for one row (#703). Suggested is the bare peso price x
 * the multiplier; the margin counts the cost of every item included in the row. Sales (the price tier)
 * is sent only the suggested peso figure, never the cost or the multiplier. An included row shows
 * "incl." and its cost goes to the row it comes with.
 */
function MarkupCells({ line, kid, figures, tier, canMarkup, onSaveFactor }) {
  const closed = tier === COSTING_TIER.CLOSED_BOOK;
  const quantity = Number(line.quantity);
  const suggested = closed ? figures.suggested : line.markup?.priceTotal != null && quantity > 0 ? Math.round((Number(line.markup.priceTotal) / quantity) * 100) / 100 : null;
  const dash = <span className="text-muted-foreground">—</span>;
  const incl = <span className="text-muted-foreground">incl.</span>;
  return (
    <>
      {closed && (
        <TableCell className={cn(CELL, NUM, "w-32")} data-testid="sheet-multiplier">
          {kid ? (
            incl
          ) : (
            <>
              <Cell
                label={`Multiplier ${line.number}`}
                noun="The multiplier"
                value={figures.own ? figures.factor : null}
                numeric
                align="right"
                placeholder={figures.factor == null ? "Default" : factorLabel(figures.factor)}
                readOnly={!canMarkup || line.components.length === 0}
                onSave={onSaveFactor}
                className="min-w-20"
              />
              <div className={SUB}>{figures.own ? "Own" : "Default"}</div>
            </>
          )}
        </TableCell>
      )}
      <TableCell className={cn(CELL, NUM, "w-36")} data-testid="sheet-suggested">
        {kid ? (
          incl
        ) : suggested == null ? (
          dash
        ) : (
          <>
            {pesos(suggested)}
            {closed && figures.included > 0 && <div className={SUB}>with {figures.included} included</div>}
          </>
        )}
      </TableCell>
      {closed && (
        <TableCell className={cn(CELL, NUM, "w-36")} data-testid="sheet-margin">
          {kid ? (
            incl
          ) : figures.margin == null ? (
            dash
          ) : (
            <>
              <span className={cn(figures.margin < 0 && "text-destructive")}>{pesos(figures.margin)}</span>
              {figures.percent != null && <div className={SUB}>{figures.percent}%</div>}
            </>
          )}
        </TableCell>
      )}
    </>
  );
}

export default function CostingSheet({ matrix, opportunity, writes, canWrite, onOpenLine, onVerdict, onVerdictSettled }) {
  const { user } = useAuth();
  const myTeams = useMyEvaluationTeams(user?.id ?? null);
  const lines = matrix.tenderLines;
  const { totals } = matrix;
  const showAbc = tierReads(matrix.tier, "abc_unit");
  const showOffer = tierReads(matrix.tier, "final_offer_unit");
  const showCost = tierReadsCost(matrix.tier, "acquire_unit");
  const showLanded = showCost && tierReadsLandedCost(matrix.tier);
  const canAddon = showLanded && matrix.bands.includes(COSTING_BAND.PURCHASING);
  const { data: defaults } = useQuery({
    queryKey: ["costing", "landed-defaults"],
    queryFn: () => costingMatrixService.getLandedDefaults(),
    enabled: showLanded,
  });
  const addons = { import: matrix.importAddonPercent ?? defaults?.import ?? 0, local: defaults?.local ?? 0 };
  const closed = matrix.tier === COSTING_TIER.CLOSED_BOOK;
  const showSuggested = closed || matrix.tier === COSTING_TIER.PRICE;
  const markupCols = closed ? 3 : showSuggested ? 1 : 0;
  const canMarkup = closed && matrix.bands.includes(COSTING_BAND.MARKUP);
  // Margin counts the landed cost per unit: the IPAS's real figure, else the estimate (#702).
  const landedOf = (line) => lineLanded(line, addons)?.unit ?? null;
  const canCost = showCost && matrix.bands.includes(COSTING_BAND.PURCHASING);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const kidsOf = new Map();
  for (const line of lines) if (line.included && line.includedIn) kidsOf.set(line.includedIn, [...(kidsOf.get(line.includedIn) ?? []), line]);
  const priced = lines.filter((line) => !line.included);
  const judged = matrix.compliance.total - matrix.compliance.notEvaluated;

  const save = (line, fields) => async (value) => {
    await costingMatrixService.updateTenderLine(line.id, fields(value));
    await writes.refresh();
  };

  // The multiplier lives on each part of the row; a blank puts the row back on the default.
  const saveFactor = (line) => async (value) => {
    for (const part of line.components) await costingMatrixService.updateComponent(part.id, { markupFactor: value });
    await writes.refresh();
  };

  const saveDefault = async (value) => {
    await costingMatrixService.setDefaultMarkup(matrix.matrixId, { factor: value === "" || value == null ? null : value });
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
      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-xl border border-border bg-card sm:grid-flow-col sm:auto-cols-fr sm:divide-y-0">
        <Fact label="S0 · client">
          <span className="font-mono text-xs">{opportunity?.sales_reference ?? opportunity?.sor_code ?? "—"}</span>
          {opportunity?.client_name ? ` · ${opportunity.client_name}` : ""}
        </Fact>
        <Fact label="S0 lines" sub={lines.length === priced.length ? undefined : `${lines.length - priced.length} included`}>
          {lines.length}
        </Fact>
        <Fact label="Judged">
          {judged} of {matrix.compliance.total}
        </Fact>
        {closed && (
          <Fact label="Default multiplier" sub={canMarkup ? "rows can override it" : "set by the Markup list"}>
            <Cell
              label="Default multiplier"
              noun="The default multiplier"
              value={matrix.defaultFactor}
              numeric
              placeholder="Not set"
              readOnly={!canMarkup}
              onSave={saveDefault}
              className="w-24"
            />
          </Fact>
        )}
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
        {showLanded && (
          <Fact label="Import add-on" sub="on the peso price, until the IPAS has the real one">
            <Cell
              label="Import add-on percent"
              noun="The Import add-on"
              value={matrix.importAddonPercent ?? defaults?.import ?? 0}
              numeric
              align="right"
              placeholder="0"
              readOnly={!canAddon}
              onSave={async (value) => {
                await costingMatrixService.setImportAddon(matrix.matrixId, value);
                await writes.refresh();
              }}
              className="w-24"
            />
          </Fact>
        )}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="border-separate border-spacing-0 text-[13px]">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={cn(GROUP, FROZEN)}>S0 line</th>
              <th className={GROUP} />
              <th colSpan={1 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0)} className={GROUP}>
                Sales · the client&apos;s ask
              </th>
              {showCost && (
                <th colSpan={2 + (showLanded ? 1 : 0)} className={GROUP}>
                  Purchasing · cost
                </th>
              )}
              {markupCols > 0 && (
                <th colSpan={markupCols} className={GROUP}>
                  {closed ? "Markup" : "Price"}
                </th>
              )}
              <th className={cn(GROUP, "border-r-0")}>Technical</th>
            </TableRow>
            <TableRow>
              <th className={cn(HEAD, FROZEN)}>Item</th>
              <th className={cn(HEAD, "text-right")}>Qty</th>
              <th className={HEAD}>Client asks for</th>
              {showAbc && <th className={cn(HEAD, "text-right")}>ABC / unit</th>}
              {showOffer && <th className={cn(HEAD, "text-right")}>Final Offer / unit</th>}
              {showCost && <th className={cn(HEAD, "text-right")}>Price</th>}
              {showCost && <th className={cn(HEAD, "text-right")}>In pesos</th>}
              {showLanded && <th className={cn(HEAD, "text-right")}>Landed / unit</th>}
              {closed && <th className={cn(HEAD, "text-right")}>Multiplier</th>}
              {showSuggested && <th className={cn(HEAD, "text-right")}>Suggested / unit</th>}
              {closed && <th className={cn(HEAD, "text-right")}>Margin / unit</th>}
              <th className={cn(HEAD, "border-r-0")}>Compliance</th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4 + (showAbc ? 1 : 0) + (showOffer ? 1 : 0) + (showCost ? 2 : 0) + (showLanded ? 1 : 0) + markupCols} className="px-3 py-4 text-sm text-muted-foreground">
                  No S0 lines yet.
                </TableCell>
              </TableRow>
            )}
            {lines.map((line, index) => {
              const kid = line.included;
              const parent = kid ? byId.get(line.includedIn) : null;
              const startsBlock = !kid && index > 0;
              const parts = line.components.length;
              const figures = lineSheetMarkup(line, kid ? [] : (kidsOf.get(line.id) ?? []), matrix.defaultFactor, landedOf);
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
                        {onOpenLine ? (
                          <Button
                            type="button"
                            variant="link"
                            className={cn("group h-auto items-start gap-1 whitespace-normal p-0 text-left text-sm text-foreground", kid ? "font-normal" : "font-semibold")}
                            aria-label={`Open line ${line.number}: ${itemName(line)}`}
                            onClick={() => onOpenLine(line.id)}
                          >
                            <span>{itemName(line)}</span>
                            <ChevronRight size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                          </Button>
                        ) : (
                          <div className={cn(!kid && "font-semibold")}>{itemName(line)}</div>
                        )}
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                          <span>{kid ? `comes with ${parent ? itemName(parent) : "the line above"}` : `line ${line.number}`}</span>
                          {line.source === "typed" && !line.sor_item_id && <StatusBadge label="Not on the S0" theme="amber" />}
                          {!kid && <RoadBadge line={line} locked={Boolean(matrix.locked)} />}
                          {parts > 1 && <span>· {parts} parts</span>}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={cn(CELL, NUM)}>
                    {line.quantity}
                    {line.unit && <div className={SUB}>{line.unit}</div>}
                  </TableCell>
                  <TableCell className={cn(CELL, "min-w-[14rem] max-w-[17rem]")}>
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
                    <TableCell className={cn(CELL, NUM, "w-36")}>
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
                    <TableCell className={cn(CELL, NUM, "w-40")}>
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
                  {showLanded && <LandedCell line={line} addons={addons} />}
                  {showSuggested && <MarkupCells line={line} kid={kid} figures={figures} tier={matrix.tier} canMarkup={canMarkup} onSaveFactor={saveFactor(line)} />}
                  <TableCell className={cn(CELL, "min-w-[12rem] max-w-[16rem] border-r-0")}>
                    <ComplianceColumn line={line} myTeams={myTeams} canSetTeam={canWrite} onChanged={writes.refresh} onVerdict={onVerdict} onVerdictSettled={onVerdictSettled} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">A box you can type in is yours to change. Click an item to open its parts, costs and evaluation. An S0 line priced at ₱0 reads as included in the line above it.</p>
    </div>
  );
}

/**
 * The S0 Evaluation as a price corridor (layout F, picked 2026-11-13 over the Google-sheet layouts A-E).
 *
 * The evaluation is a relay: Purchasing prices the parts (with the markup price as their guide), Management sets
 * Final Acquire, Purchasing adds the other costs, Sales types the ABC and the offer (by line or as one total, as the
 * sheet does), the Technical in-charge judges the specs, then the decider says Go. Every priced line shows its
 * corridor, from the lowest offer that keeps the deal at the Go line (the Go floor) up to the client's ABC, with
 * our offer as the dot; the whole deal gets the same bar, pinned on top. With the ABC as one total, a line has no
 * ceiling of its own and shows only its Go floor.
 *
 * On the right the decision card: what a Go needs (Costing settled), then Go / Revise / No-go and the sign-offs.
 * Parts are one-line liners under their line, never a table in a row; a line's name opens its slide-over.
 */
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, LayoutDashboard, Trash2, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../../../ui/button";
import ConfirmDialog from "../../../ui/ConfirmDialog";
import { SelectField } from "../../../ui/SelectField";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../../ui/table";
import RecordHeader from "../../../record/RecordHeader";
import { Cell, SelectCell } from "../../GridCell";
import { factorLabel, pesos } from "../../gridFormat";
import { costingKeys } from "../../costingKeys";
import EvaluationBar from "../../EvaluationBar";
import InchargeSelects from "../../InchargeSelects";
import SignoffBar from "../../SignoffBar";
import TechnicalVerdict from "../../TechnicalVerdict";
import DecisionCard from "./DecisionCard";
import { goFloorSoFar } from "./goFloor";
import { useInchargeOptions } from "../../useCostingWrites";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { useAuth } from "../../../../context/AuthContext";
import { ABC_MODE, COMPONENT_BANDS, COMPONENT_STATUS_LABEL, COSTING_BAND, COSTING_TIER, COST_ROW_BANDS, MATRIX_MONEY_BANDS, ROW_EDIT_BANDS, USUAL_COST_CATEGORIES, inAnyBand, tierReads, tierReadsCost, tierReadsCostRow } from "../../../../constants/costing";
import { costUnit, finalAcquireByRule, finalAcquireTotal, projectExpensesTotal } from "../../../../utils/costingMath";

const STATUS_OPTIONS = Object.entries(COMPONENT_STATUS_LABEL).map(([value, label]) => ({ value, label }));
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : pesos(v));
const itemName = (line) => line.sor_line_snapshot?.name || (line.tender_specification ?? "").split("\n")[0].trim() || "Untitled line";
const partName = (part) => [part.brand, part.name].filter(Boolean).join(" ") || "Unnamed part";
const sum = (xs) => (xs.length === 0 || xs.some((x) => x === null) ? null : xs.reduce((a, b) => a + b, 0));

/* ------------------------------------------------------------------ the Go floor */

/** Everything F draws, worked once from the matrix. */
function useCorridor(matrix) {
  return useMemo(() => {
    const lines = matrix.tenderLines;
    const kidsOf = new Map();
    for (const l of lines) if (l.included && l.includedIn) kidsOf.set(l.includedIn, [...(kidsOf.get(l.includedIn) ?? []), l]);
    const priced = lines.filter((l) => !l.included || !lines.some((p) => p.id === l.includedIn));
    const rows = priced.map((line) => {
      const block = [line, ...(kidsOf.get(line.id) ?? [])];
      const parts = block.flatMap((l) => l.components.map((part) => ({ part, from: l })));
      const cost = sum(block.map((l) => num(finalAcquireTotal(l.components))));
      return { line, kids: block.slice(1), parts, qty: num(line.quantity), cost };
    });
    const offerTotalOnly = matrix.offer?.mode === ABC_MODE.TOTAL_ONLY;
    const productCost = sum(rows.map((r) => r.cost));
    const expenses = num(projectExpensesTotal(matrix.costRows));
    const costRows = matrix.costRows ?? [];
    // Every usual category is shown, row or not (2026-11-13: "add all at default"); one without a row is blank.
    const missingUsual = USUAL_COST_CATEGORIES.filter((key) => !costRows.some((row) => row.category_key === key));
    const { floor: floorTotal, uncounted, partial } = goFloorSoFar({ productCost, costRows, missingUsual: missingUsual.length, marketing: matrix.money?.marketing, rates: matrix.rates });
    // A line's floor: the deal's floor shared out by each line's part of the product cost.
    for (const row of rows) {
      row.floorTotal = floorTotal === null || row.cost === null || !productCost ? null : (floorTotal * row.cost) / productCost;
      row.floorUnit = row.floorTotal === null || !row.qty ? null : row.floorTotal / row.qty;
      row.abcUnit = matrix.abc?.mode === ABC_MODE.TOTAL_ONLY ? null : num(row.line.abc_unit);
      row.offerUnit = offerTotalOnly ? null : num(row.line.final_offer_unit);
      row.offerTotal = offerTotalOnly ? null : num(row.line.totals?.finalOfferTotal);
      row.marginPct = row.offerTotal && row.cost !== null ? ((row.offerTotal - row.cost) / row.offerTotal) * 100 : null;
    }
    const allParts = rows.flatMap((r) => r.parts.map((p) => p.part));
    const evaluated = Boolean(matrix.evaluation?.approved);
    // Each tier gets the steps whose figures it is sent (the Closed Book all of them, a Stage Participant only the specs).
    const tier = matrix.tier;
    const sees = {
      closed: tier === COSTING_TIER.CLOSED_BOOK,
      cost: tierReadsCost(tier, "acquire_unit"),
      final: tierReadsCost(tier, "final_acquire_unit"),
      rows: tierReadsCostRow(tier, "acquire_unit"),
      abc: tierReads(tier, "abc_unit"),
      offer: tierReads(tier, "final_offer_unit"),
    };
    // A tier sent no money still reads the lines: they get a Lines step of their own.
    const show = { costs: sees.cost, finalAcquire: sees.final, otherCosts: sees.rows, offers: sees.abc || sees.offer, lines: !sees.cost && !sees.abc && !sees.offer, specs: true };
    return {
      sees,
      rows,
      floorTotal,
      floorUncounted: uncounted,
      floorPartial: partial,
      expenses,
      abcTotal: num(matrix.totals?.abcTotal),
      offerTotal: num(matrix.totals?.finalOfferTotal),
      steps: [
        { key: "costs", label: "Costs", who: "Purchasing", band: "purchasing", left: allParts.filter((p) => p.acquire_unit == null).length, of: allParts.length },
        {
          key: "finalAcquire",
          label: "Final Acquire",
          who: "Management",
          band: "management",
          left: allParts.filter((p) => costUnit(p) == null).length,
          of: allParts.length,
          // What is in the way: a part with no Status gets no Final Acquire from the rule (#1034).
          words: (() => {
            const left = allParts.filter((p) => costUnit(p) == null).length;
            const noStatus = allParts.filter((p) => costUnit(p) == null && !p.status).length;
            if (allParts.length === 0) return undefined;
            if (left === 0) return "all filled";
            return `${left} of ${allParts.length} left${noStatus > 0 ? ` · ${noStatus} need a Status` : ""}`;
          })(),
        },
        {
          key: "otherCosts",
          label: "Other costs",
          who: "Purchasing",
          band: "purchasing",
          left: costRows.filter((row) => num(costUnit(row)) === null).length + missingUsual.length + (num(matrix.money?.marketing) === null ? 1 : 0),
          of: costRows.length + missingUsual.length + 1,
        },
        {
          key: "offers",
          label: "Offers",
          who: "Sales",
          band: "sales",
          left: offerTotalOnly ? (matrix.totals?.finalOfferTotal == null ? 1 : 0) : rows.filter((r) => r.offerUnit == null).length,
          of: offerTotalOnly ? 1 : rows.length,
        },
        { key: "lines", label: "Lines", who: "Read only", band: "sales", left: 0, of: 0, words: `${rows.length} S0 lines` },
        { key: "specs", label: "Specs", who: "Technical", band: "technical", left: evaluated ? 0 : 1, of: 1, words: evaluated ? "approved" : "not approved yet" },
      ].filter((step) => show[step.key]),
    };
  }, [matrix]);
}

/* ------------------------------------------------------------------ the corridor */

/**
 * One bar: the Go floor and the ABC as two lines, the safe zone between them, our offer as a dot and the markup's
 * suggestion as a ring. Each label sits under its own line. Outside the corridor is tinted and named.
 */
function Corridor({ floor, abc, offer, size = "sm", deal = false, floorLabel = "Go floor", uncounted = 0 }) {
  if (floor === null && abc === null) return <span className="text-xs text-muted-foreground">Needs the costs and the ABC</span>;
  const values = [floor, abc, offer].filter((v) => v !== null);
  const lo = Math.min(...values) * 0.85;
  const hi = Math.max(...values) * 1.08;
  const pct = (v) => ((v - lo) / (hi - lo)) * 100;
  const at = (v) => `${pct(v)}%`;
  const state = offer === null ? "none" : floor !== null && offer < floor ? "low" : abc !== null && offer > abc ? "high" : "ok";
  const big = size === "lg";
  // No offer can work when the floor is above the ABC (#1036); said once, on the deal bar.
  const noOffer = deal && floor !== null && abc !== null && floor > abc;
  // The floor's label ends at its line and the ABC's starts at its line, so the two never run into each other.
  const floorAt = (v) => ({ right: `clamp(0%, calc(100% - ${at(v)}), calc(100% - 7rem))` });
  const abcAt = (v) => ({ left: `clamp(0%, ${at(v)}, calc(100% - 7rem))` });
  return (
    <div className="w-full">
      <div className={cn("relative rounded-full bg-mauve-3", big ? "h-3" : "h-2")}>
        {floor !== null && abc !== null && abc > floor && <div className="absolute inset-y-0 bg-jade-5" style={{ left: at(floor), width: `calc(${at(abc)} - ${at(floor)})` }} />}
        {floor !== null && <div className="absolute -inset-y-1 w-px bg-mauve-11" style={{ left: at(floor) }} />}
        {abc !== null && <div className="absolute -inset-y-1 w-px bg-mauve-11" style={{ left: at(abc) }} />}
        {offer !== null && (
          <div
            className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-card", big ? "size-4" : "size-3", state === "ok" ? "bg-mauve-12" : "bg-red-9")}
            style={{ left: at(offer) }}
            title={`Saved offer ${pesos(offer)}`}
          />
        )}
      </div>
      {floor !== null && abc !== null && pct(abc) - pct(floor) < (big ? 22 : 45) ? (
        // Too close for two labels: one line, in the same left-to-right order as the two lines on the bar.
        <div className={cn("mt-1.5 text-right tabular-nums text-muted-foreground", big ? "text-xs" : "text-[11px]")}>
          {floorLabel} <span className="text-foreground">{pesos(floor)}</span> – ABC <span className="text-foreground">{pesos(abc)}</span>
        </div>
      ) : (
      <div className={cn("relative mt-1.5", big ? "h-9" : "h-8")}>
        {floor !== null && (
          <div className="absolute whitespace-nowrap pr-1.5 text-right leading-tight" style={floorAt(floor)}>
            <div className={cn("text-muted-foreground", big ? "text-xs" : "text-[11px]")}>{floorLabel}</div>
            <div className={cn("tabular-nums", big ? "text-xs font-semibold" : "text-[11px]")}>{pesos(floor)}</div>
          </div>
        )}
        {abc !== null && (
          <div className="absolute whitespace-nowrap pl-1.5 text-left leading-tight" style={abcAt(abc)}>
            <div className={cn("text-muted-foreground", big ? "text-xs" : "text-[11px]")}>ABC</div>
            <div className={cn("tabular-nums", big ? "text-xs font-semibold" : "text-[11px]")}>{pesos(abc)}</div>
          </div>
        )}
      </div>
      )}
      {deal && uncounted > 0 && (
        <div className="text-xs text-muted-foreground" data-testid="corridor-uncounted">
          {uncounted} {uncounted === 1 ? "cost" : "costs"} not counted yet
        </div>
      )}
      {noOffer && <div className="text-xs font-medium text-red-11" data-testid="corridor-no-offer">No offer reaches the Go line under this ABC.</div>}
      {!noOffer && state === "low" && (
        <div className="text-xs font-medium text-red-11">{deal ? "Below the Go floor: the deal stops paying." : "Under this line’s share of the Go floor."}</div>
      )}
      {state === "high" && <div className="text-xs font-medium text-red-11">Over the ABC: the client cannot accept it.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ the rows */

const HEAD = "border-b border-border bg-muted px-3 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
// Under the pinned deal bar (xl and up): the table heading sticks at the bar's bottom edge (the body's 0.75rem padding is taken off so nothing shows above the bar), on a solid background (#1038).
const STICKY_HEAD = "xl:sticky xl:top-[calc(var(--deal-h,0px)-0.75rem)] xl:z-10";
const CELL = "border-b border-border px-3 py-3 align-top text-sm";
const NUM = "text-right tabular-nums whitespace-nowrap";

/** A part as one line: name and quantity, its Odoo SRP, then the one box this step fills (or the figure, greyed). */
function PartLiner({ part, step, save, canWrite, canStatus, factor, faPercent }) {
  const srp = num(part.odoo_unit);
  const fa = num(costUnit(part));
  const markupCol = step === "costs" && factor != null;
  const statusCol = step === "finalAcquire";
  // The empty Final Acquire box says what the rule needs, never "by rule" when the rule gives nothing (#1034).
  const byRule = finalAcquireByRule(part, faPercent);
  const ruleHint = byRule !== null ? `${pesos(byRule)} by rule` : !part.status ? "Needs a Status" : part.status === "source_out" ? "Needs the Acquire" : "Needs the Odoo SRP";
  if (step === "lines") {
    return (
      <li className="grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-4 py-1.5 text-[13px]" data-testid="corridor-part">
        <span className="min-w-0 truncate">{partName(part)}</span>
        <span className="text-right tabular-nums text-muted-foreground">
          {num(part.quantity)} {part.unit}
        </span>
      </li>
    );
  }
  return (
    <li className={cn("grid items-center gap-x-4 py-1.5 text-[13px]", markupCol ? "grid-cols-[minmax(0,1fr)_5rem_8rem_10rem_12rem]" : statusCol ? "grid-cols-[minmax(0,1fr)_5rem_8rem_9rem_10rem]" : "grid-cols-[minmax(0,1fr)_5rem_8rem_10rem]")} data-testid="corridor-part">
      <span className="min-w-0 truncate">{partName(part)}</span>
      <span className="text-right tabular-nums text-muted-foreground">
        {num(part.quantity)} {part.unit}
      </span>
      <span className="text-right tabular-nums text-muted-foreground" title="Odoo SRP / unit">
        SRP {money(srp)}
      </span>
      {statusCol && (
        <div title={canStatus ? undefined : "Sales sets the Status"} data-testid="corridor-part-status">
          <SelectCell label={`Status ${partName(part)}`} value={part.status} options={STATUS_OPTIONS} readOnly={!canStatus} onSave={(v) => save.part(part.id, { status: v })} />
          {!canStatus && <p className="text-xs text-muted-foreground">Sales sets the Status</p>}
        </div>
      )}
      {step === "costs" ? (
        <Cell label={`Acquire / unit ${partName(part)}`} noun="Acquire" value={part.acquire_unit} numeric money align="right" placeholder="Supplier price" readOnly={!canWrite} onSave={(v) => save.part(part.id, { acquireUnit: v })} />
      ) : step === "finalAcquire" ? (
        <Cell label={`Final Acquire / unit ${partName(part)}`} noun="Final Acquire" value={part.final_acquire_unit} numeric money align="right" placeholder={ruleHint} readOnly={!canWrite} onSave={(v) => save.part(part.id, { finalAcquireUnit: v })} />
      ) : (
        <span className="text-right tabular-nums text-muted-foreground">FA {money(fa)}</span>
      )}
      {markupCol && (
        <span className="text-right tabular-nums text-muted-foreground" title="Acquire × markup (the part's own, else the evaluation's), worked out by itself" data-testid="corridor-markup-price">
          <span className="mr-1.5 text-xs">Markup price</span>
          {money(num(part.acquire_unit) === null ? null : Math.round(num(part.acquire_unit) * Number(num(part.markup_factor) ?? factor) * 100) / 100)}
        </span>
      )}
    </li>
  );
}

function LineRow({ row, step, save, bands, sees, open, onToggle, abcByLine, offerByLine, factor, faPercent, onOpenLine, floorLabel = "Go floor" }) {
  const { line, kids, parts, qty } = row;
  const showAbc = sees.abc && abcByLine;
  const showBar = sees.abc || sees.closed;
  const columns = 1 + (sees.cost ? 1 : 0) + (showAbc ? 1 : 0) + (showBar ? 1 : 0) + (sees.offer ? 1 : 0) + (sees.closed ? 1 : 0);
  const pricing = step === "offers";
  const showParts = !pricing || open;
  const canOffer = bands.includes(COSTING_BAND.SALES);
  const canStatus = inAnyBand(bands, COMPONENT_BANDS.status);
  const canPart = bands.includes(step === "costs" ? COSTING_BAND.PURCHASING : COSTING_BAND.MANAGEMENT);
  const cut = showParts && "border-b-0";
  return (
    <>
      <TableRow className="hover:bg-transparent" data-testid="corridor-line">
        <TableCell className={cn(CELL, "min-w-[14rem] max-w-[20rem] whitespace-normal", cut)}>
          <div className="flex items-start gap-1.5">
            {pricing && (
              <Button type="button" variant="ghost" size="icon-xs" aria-expanded={open} aria-label={open ? "Hide parts" : "Show parts"} onClick={onToggle} className="mt-0.5">
                {open ? <ChevronDown /> : <ChevronRight />}
              </Button>
            )}
            <div className="min-w-0">
              {onOpenLine ? (
                <Button type="button" variant="link" className="h-auto whitespace-normal p-0 text-left text-sm font-semibold leading-snug text-foreground" aria-label={`Open line ${line.number}: ${itemName(line)}`} onClick={() => onOpenLine(line.id)}>
                  {line.number}. {itemName(line)}
                </Button>
              ) : (
                <div className="font-semibold leading-snug">
                  {line.number}. {itemName(line)}
                </div>
              )}
              <div className="mt-0.5 text-xs text-muted-foreground">
                {qty} {line.unit}
                {kids.length > 0 && ` · with ${kids.map(itemName).join(", ")}`}
              </div>
            </div>
          </div>
        </TableCell>
        {sees.cost && (
          <TableCell className={cn(CELL, NUM, cut)}>
            <div>{money(row.cost === null || !qty ? null : row.cost / qty)}</div>
            <div className="text-xs text-muted-foreground">per unit</div>
          </TableCell>
        )}
        {showAbc && (
          <TableCell className={cn(CELL, "w-40", cut)}>
            {pricing ? (
              <Cell label={`ABC / unit ${line.number}`} noun="ABC" value={line.abc_unit} numeric money align="right" placeholder="Client budget" readOnly={!canOffer} onSave={(v) => save.line(line.id, { abcUnit: v })} />
            ) : (
              <div className={NUM}>{money(row.abcUnit)}</div>
            )}
          </TableCell>
        )}
        {showBar && (
        <TableCell className={cn(CELL, "w-[20rem] min-w-[15rem]", cut)}>
          {abcByLine && sees.abc ? (
            <Corridor floor={row.floorUnit} abc={row.abcUnit} offer={row.offerUnit} floorLabel={floorLabel} />
          ) : (
            // The ABC is one total, so a line has no ceiling of its own: no bar, just its floor (2026-11-13, option 1).
            <div className="text-sm" data-testid="corridor-floor-only">
              <span className="text-muted-foreground">{floorLabel} </span>
              <span className="tabular-nums">{money(row.floorUnit)}</span>
              {row.offerUnit != null && row.floorUnit != null && row.offerUnit < row.floorUnit && <div className="text-xs font-medium text-red-11">Under this line&apos;s share of the Go floor.</div>}
            </div>
          )}
        </TableCell>
        )}
        {sees.offer && (
        <TableCell className={cn(CELL, "w-44", cut)}>
          {!offerByLine ? (
            <div className="text-right text-xs text-muted-foreground">In the offer total</div>
          ) : pricing ? (
            <Cell label={`Final Offer / unit ${line.number}`} noun="Final Offer" value={line.final_offer_unit} numeric money align="right" placeholder={row.floorUnit ? `from ${pesos(row.floorUnit)}` : "Our bid"} readOnly={!canOffer} onSave={(v) => save.line(line.id, { finalOfferUnit: v })} />
          ) : (
            <div className={NUM}>{money(row.offerUnit)}</div>
          )}
          <div className="mt-1 text-right text-xs text-muted-foreground">{row.offerTotal === null ? "" : `${pesos(row.offerTotal)} total`}</div>
        </TableCell>
        )}
        {sees.closed && <TableCell className={cn(CELL, NUM, cut, row.marginPct !== null && row.marginPct < 0 && "text-red-11")}>{row.marginPct === null ? "—" : `${row.marginPct.toFixed(1)}%`}</TableCell>}
      </TableRow>
      {showParts && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={columns} className="border-b border-border bg-mauve-2/60 px-3 pb-2 pt-1">
            <ul className="ml-8 max-w-3xl divide-y divide-border/60">
              {parts.map(({ part }) => (
                <PartLiner key={part.id} part={part} step={step} save={save} canWrite={canPart} canStatus={canStatus} factor={factor} faPercent={faPercent} />
              ))}
              {parts.length === 0 && <li className="py-1.5 text-[13px] text-muted-foreground">No part yet. Open the line to add one.</li>}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ other costs */

const FALLBACK_LABEL = { labor: "Labor", logistics: "Logistics & Transportation", equipment: "Equipment & Tools", permits: "Permits/Insurance/Compliance", overhead: "Overhead" };

/** A share as the sheet prints it: 10 -> 10, 9.98321 -> 9.98. */
const pctOf = (v) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

/** The range the company expects for a cost; amber, with the word, only when a typed amount falls outside it. */
function RangeCell({ range, share }) {
  if (!range) return <span className="text-muted-foreground">—</span>;
  const off = share !== null && share !== undefined ? (share < range.lowPct ? "below" : share > range.highPct ? "above" : null) : null;
  return (
    <span className={cn("tabular-nums", off ? "font-semibold text-amber-11" : "text-muted-foreground")} title={off ? `This cost is ${off} the range, as a share of the ABC` : undefined} data-testid="other-cost-range">
      {range.lowPct}–{range.highPct}%{off && <span className="block text-xs font-normal">{off}</span>}
    </span>
  );
}

/**
 * Other costs, the sheet's "Project Cost Summary": each cost, the range the company expects, its amount and
 * its share of the ABC. Type the amount, or the % of the ABC (the database then works the amount, #963). The
 * five usual categories are always listed; another cost is added under one of them (a cost needs a category,
 * #723), named, renamed or removed, and the category's range is checked on its rows together. Marketing is the
 * last row. They all count in OPEX, so every amount moves the Go floor as it is typed.
 */
function OtherCostsPanel({ matrix, save, bands, abcTotal, expenses, floorTotal, floorPartial }) {
  const { data: categories = [] } = useQuery({ queryKey: costingKeys.costCategories(), queryFn: () => costingMatrixService.listCostCategories(), staleTime: 60_000 });
  const [removing, setRemoving] = useState(null);
  const rows = matrix.costRows ?? [];
  const guide = new Map(categories.map((cat) => [cat.key, cat]));
  const can = (column) => inAnyBand(bands, COST_ROW_BANDS[column]);
  const canRows = inAnyBand(bands, ROW_EDIT_BANDS);
  const canMarketing = inAnyBand(bands, MATRIX_MONEY_BANDS.marketing);
  const amountOf = (row) => {
    const unit = num(costUnit(row));
    return unit === null ? null : Math.round(unit * (num(row.quantity) ?? 1) * 100) / 100;
  };
  const share = (amount) => (amount === null || !abcTotal ? null : (amount / abcTotal) * 100);
  const marketing = num(matrix.money?.marketing);

  // The sheet's order: the usual categories (each row, or one blank to type into), then every other cost.
  const list = [];
  for (const cat of USUAL_COST_CATEGORIES) {
    const own = rows.filter((r) => r.category_key === cat);
    const label = guide.get(cat)?.label ?? FALLBACK_LABEL[cat] ?? cat;
    // Flag from the rows that have an amount (an empty second row does not hide it); 0 counts and is below.
    const amounts = own.map(amountOf).filter((a) => a !== null);
    const groupShare = share(amounts.length === 0 ? null : amounts.reduce((a, b) => a + b, 0));
    if (own.length === 0) list.push({ key: cat, cat, label, range: guide.get(cat), row: null, share: null });
    else own.forEach((row, i) => list.push({ key: row.id, cat, label, range: i === 0 ? guide.get(cat) : null, row, share: i === 0 ? groupShare : null, more: i > 0 }));
  }
  for (const row of rows.filter((r) => !USUAL_COST_CATEGORIES.includes(r.category_key))) {
    const range = row.category_key ? guide.get(row.category_key) : null;
    list.push({ key: row.id, cat: row.category_key, label: range?.label ?? "", range, row, share: share(amountOf(row)) });
  }
  const nameOf = (l) => l.row?.description || l.label || "this cost";

  // Typing the amount makes the row one lot of that amount: the percent, a quantity and a typed-over cost give way.
  const saveAmount = (l, value) => {
    if (!l.row) return value === "" || value == null ? undefined : save.addCostRow({ categoryKey: l.cat, description: l.label, acquireUnit: value });
    const fields = { acquireUnit: value };
    if (l.row.abc_pct != null) fields.abcPct = null;
    if ((num(l.row.quantity) ?? 1) !== 1) fields.quantity = 1;
    if (l.row.final_acquire_unit != null) fields.finalAcquireUnit = null;
    return save.costRow(l.row.id, fields);
  };
  const savePercent = (l, value) => {
    if (!l.row) return value === "" || value == null ? undefined : save.addCostRow({ categoryKey: l.cat, description: l.label, abcPct: value });
    return save.costRow(l.row.id, l.row.final_acquire_unit != null ? { abcPct: value, finalAcquireUnit: null } : { abcPct: value });
  };
  const total = expenses === null ? null : expenses + (marketing ?? 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Other costs" data-testid="corridor-other-costs">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-4 py-2.5">
        <h3 className="text-sm font-semibold">Other costs</h3>
        <span className="text-xs text-muted-foreground">Type the amount, or the % of the ABC. They count in OPEX and raise the Go floor.</span>
      </div>
      <div className="overflow-x-auto">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow className="hover:bg-transparent">
              <th className={cn(HEAD, "text-left")}>Cost</th>
              <th className={cn(HEAD, "text-right")}>Range</th>
              <th className={cn(HEAD, "text-right")}>Amount</th>
              <th className={cn(HEAD, "text-right")} title="Share of the ABC">%</th>
              {canRows && <th className={HEAD}><span className="sr-only">Remove</span></th>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((l) => (
              <TableRow key={l.key} className="hover:bg-transparent" data-testid="corridor-other-cost">
                <TableCell className={cn(CELL, "min-w-[12rem] py-1.5")}>
                  {l.row ? (
                    <>
                      <Cell label={`Name of ${nameOf(l)}`} noun="The name" value={l.row.description} placeholder={l.label ? `Name it (${l.label})` : "Name the cost"} readOnly={!can("description")} onSave={(v) => save.costRow(l.row.id, { description: v })} />
                      {l.label && l.row.description && l.row.description !== l.label && <span className="mt-0.5 block text-xs text-muted-foreground">under {l.label}</span>}
                    </>
                  ) : (
                    <span className="block py-1.5">{l.label}</span>
                  )}
                </TableCell>
                <TableCell className={cn(CELL, NUM, "w-28 py-1.5 align-middle")}>
                  {!l.more && <RangeCell range={l.range} share={l.share} />}
                </TableCell>
                <TableCell className={cn(CELL, "w-44 py-1.5")}>
                  <Cell
                    label={`Amount of ${nameOf(l)}`}
                    noun="The amount"
                    value={l.row ? amountOf(l.row) : null}
                    numeric
                    money
                    align="right"
                    placeholder={l.row?.abcMissing ? "ABC missing" : "0.00"}
                    readOnly={!can("acquire_unit")}
                    onSave={(v) => saveAmount(l, v)}
                  />
                </TableCell>
                <TableCell className={cn(CELL, "w-28 py-1.5")}>
                  <Cell
                    label={`Percent of the ABC for ${nameOf(l)}`}
                    noun="The percent of the ABC"
                    value={l.row ? (l.row.abc_pct != null ? Number(l.row.abc_pct) : pctOf(share(amountOf(l.row)))) : null}
                    numeric
                    align="right"
                    placeholder="%"
                    readOnly={!can("abc_pct")}
                    onSave={(v) => savePercent(l, v)}
                  />
                </TableCell>
                {canRows && (
                  <TableCell className={cn(CELL, "w-12 py-1.5 text-right align-middle")}>
                    {l.row && (
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${nameOf(l)}`} onClick={() => setRemoving(l.row)}>
                        <Trash2 size={14} aria-hidden="true" />
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            <TableRow className="hover:bg-transparent" data-testid="corridor-marketing">
              <TableCell className={cn(CELL, "py-1.5")}>
                <span className="block py-1.5">Marketing</span>
              </TableCell>
              <TableCell className={cn(CELL, NUM, "py-1.5 align-middle text-muted-foreground")}>—</TableCell>
              <TableCell className={cn(CELL, "py-1.5")}>
                <Cell label="Marketing" noun="Marketing" value={marketing} numeric money align="right" placeholder="0.00" readOnly={!canMarketing} onSave={(v) => save.marketing(v)} />
              </TableCell>
              <TableCell className={cn(CELL, NUM, "py-1.5 align-middle text-muted-foreground")}>{marketing === null || !abcTotal ? "—" : `${pctOf(share(marketing))}%`}</TableCell>
              {canRows && <TableCell className={cn(CELL, "py-1.5")} />}
            </TableRow>
            <TableRow className="hover:bg-transparent" data-testid="corridor-other-costs-total">
              <TableCell className="px-3 py-2.5 text-sm font-semibold">Total</TableCell>
              <TableCell className="px-3 py-2.5" />
              <TableCell className="px-3 py-2.5 text-right font-mono text-sm font-semibold tabular-nums">{money(total)}</TableCell>
              <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums text-muted-foreground">{total === null || !abcTotal ? "—" : `${pctOf(share(total))}%`}</TableCell>
              {canRows && <TableCell className="px-3 py-2.5" />}
            </TableRow>
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-2">
        {canRows ? (
          <SelectField
            size="sm"
            className="w-56"
            options={USUAL_COST_CATEGORIES.map((key) => ({ value: key, label: guide.get(key)?.label ?? FALLBACK_LABEL[key] }))}
            value=""
            onChange={(key) => key && save.addCost(key)}
            placeholder="+ Add a cost under…"
            aria-label="Add a cost under a category"
          />
        ) : (
          <span />
        )}
        <span className="text-xs text-muted-foreground">{floorPartial ? "Go floor so far" : "Go floor now"} {floorTotal === null ? "—" : pesos(floorTotal)}</span>
      </div>
      <ConfirmDialog
        open={Boolean(removing)}
        onOpenChange={(isOpen) => !isOpen && setRemoving(null)}
        title={removing ? `Remove ${removing.description || "this cost"}?` : "Remove this cost?"}
        description="It comes off our cost. The change stays in the history."
        confirmLabel="Remove"
        tone="destructive"
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          save.removeCostRow(target.id);
        }}
      />
    </section>
  );
}

/* ------------------------------------------------------------------ the screen */

/**
 * The S0 Evaluation, for one decision: Go or No-go on the bid. The steps hold the estimate, in the order the
 * work happens; what happens after buying (IPAS, Landed Cost, Planned vs Actual) is in the Overview and in a
 * line's detail, never in the steps.
 */
export default function CorridorScreen({ data, opportunity, onOverview, onOpenLine, banner = null }) {
  const { matrix, save, fall, writes, opportunityId } = data;
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const incharge = useInchargeOptions(opportunity);
  const c = useCorridor(matrix);
  // The deal bar's height, handed to the table heading so it sticks right under the bar (#1038).
  const dealRef = useRef(null);
  const [dealH, setDealH] = useState(0);
  useLayoutEffect(() => {
    const el = dealRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(() => setDealH(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  });
  const bands = matrix.bands ?? [];
  const closed = matrix.tier === COSTING_TIER.CLOSED_BOOK;
  // Markup is Purchasing's (the sheet's "Markup Price · PMS – Automatic"): Acquire × the evaluation's markup, 1.35 by default.
  const factor = matrix.defaultFactor ?? 1.35;
  const canFactor = inAnyBand(bands, MATRIX_MONEY_BANDS.default_factor);
  // Final Acquire = the Odoo SRP less this discount (stored signed, -20 by default); every part follows it unless typed over.
  const discount = matrix.finalAcquirePercent == null ? null : -Number(matrix.finalAcquirePercent) || 0;
  const canDiscount = inAnyBand(bands, MATRIX_MONEY_BANDS.final_acquire_percent);
  const abcByLine = matrix.abc?.mode !== ABC_MODE.TOTAL_ONLY;
  const canAbc = bands.includes(COSTING_BAND.SALES);
  // The Final Offer by line or as one total (costing_matrices.offer_mode), the twin of the ABC's switch.
  const offerByLine = matrix.offer?.mode !== ABC_MODE.TOTAL_ONLY;
  const canOfferTotal = bands.includes(COSTING_BAND.SALES) && matrix.offer != null;
  const { sees } = c;
  // Open on the first step with something left; a new evaluation (its lines still filling in) opens on the lines.
  const [step, setStep] = useState(() => {
    const lineStep = c.steps.find((s) => ["costs", "offers", "lines"].includes(s.key));
    const first = c.rows.length === 0 && lineStep ? lineStep : (c.steps.find((s) => s.left > 0) ?? c.steps.find((s) => s.key === "offers") ?? c.steps[0]);
    return first.key;
  });
  const [open, setOpen] = useState(() => new Set());
  const [showPeople, setShowPeople] = useState(false);
  const toggle = (id) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const standalone = Boolean(opportunity?.standalone);
  const under = fall?.revenuePercent != null && fall.under;
  const nameOf = incharge.nameOf;
  const peopleSummary = [
    ["Sales", matrix.matrix?.sales_incharge_id ?? opportunity?.deal_owner_id],
    ["Purchasing", matrix.matrix?.purchasing_incharge_id],
    ["Technical", matrix.matrix?.technical_incharge_id],
  ]
    .map(([role, id]) => `${role}: ${(id && nameOf(id)) || "not named"}`)
    .join(" · ");

  return (
    <div className="space-y-5 pb-16" data-testid="proto-corridor">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <RecordHeader
          className="min-w-0 flex-1"
          reference={standalone ? "No SOR" : (opportunity?.sor_code ?? "SOR")}
          name={opportunity?.project_title ?? "S0 Evaluation"}
          line={[opportunity?.sales_reference && `SO ${opportunity.sales_reference}`, opportunity?.client_name].filter(Boolean).join(" · ") || null}
        />
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" aria-expanded={showPeople} onClick={() => setShowPeople((v) => !v)}>
            <Users size={14} aria-hidden="true" />
            People
          </Button>
          {closed && (
            <Button type="button" variant="outline" size="sm" onClick={onOverview} data-testid="corridor-overview">
              <LayoutDashboard size={14} aria-hidden="true" />
              Overview
            </Button>
          )}
        </div>
      </div>

      {showPeople ? (
        <div className="rounded-xl border border-border bg-card p-4" data-testid="corridor-people">
          <InchargeSelects
            sales={matrix.matrix?.sales_incharge_id ?? opportunity?.deal_owner_id}
            purchasing={matrix.matrix?.purchasing_incharge_id}
            salesOptions={incharge.salesOptions}
            purchasingOptions={incharge.purchasingOptions}
            canSales={inAnyBand(matrix.allBands ?? bands, COMPONENT_BANDS.sales_incharge_id)}
            canPurchasing={inAnyBand(matrix.allBands ?? bands, COMPONENT_BANDS.purchasing_incharge_id)}
            technical={matrix.matrix?.technical_incharge_id}
            technicalOptions={incharge.technicalOptions}
            canTechnical={inAnyBand(matrix.allBands ?? bands, [COSTING_BAND.SALES, COSTING_BAND.PURCHASING])}
            onSave={async (who) => {
              await costingMatrixService.setIncharge({ matrixId: matrix.matrixId }, who);
              await writes.refresh();
            }}
          />
        </div>
      ) : (
        <p className="-mt-2 text-xs text-muted-foreground">{peopleSummary}</p>
      )}

      {banner}

      {writes.notice && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {writes.notice}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]" style={{ "--deal-h": `${dealH}px` }}>
        <div className="min-w-0 space-y-5">
          {/* The deal's corridor: is the whole bid winnable and paying? */}
          {(sees.abc || sees.offer) && (
          <section ref={dealRef} className="grid gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto] xl:sticky xl:top-[-0.75rem] xl:z-20" aria-label="The deal" data-testid="corridor-deal">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-sm font-semibold">The deal</h3>
                <span className="text-xs text-muted-foreground">{closed ? "Keep the dot between the Go floor and the client\u2019s ABC" : "Keep the dot under the client\u2019s ABC"}</span>
              </div>
              <Corridor floor={c.floorTotal} abc={c.abcTotal} offer={c.offerTotal} size="lg" deal floorLabel={c.floorPartial ? "Go floor so far" : "Go floor"} uncounted={c.floorUncounted} />
            </div>
            <dl className="flex min-w-0 flex-col gap-y-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-x-6">
              {sees.abc && (
              <div>
                <dt className="text-xs text-muted-foreground">Client ABC</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{money(c.abcTotal)}</dd>
              </div>
              )}
              {sees.offer && (
              <div>
                <dt className="text-xs text-muted-foreground">
                  Offer
                  {c.abcTotal && c.offerTotal != null && <span className="ml-1">· {((c.offerTotal / c.abcTotal) * 100).toFixed(1)}% of ABC</span>}
                </dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{money(c.offerTotal)}</dd>
              </div>
              )}
              {fall && (
              <div>
                <dt className="text-xs text-muted-foreground">Revenue</dt>
                <dd className={cn("font-mono text-lg font-semibold tabular-nums", fall?.revenuePercent == null ? "" : under ? "text-amber-11" : "text-green-11")}>
                  {money(fall?.revenue)}
                  {fall?.revenuePercent != null && <span className="ml-1.5 text-sm">{fall.revenuePercent.toFixed(1)}%</span>}
                </dd>
              </div>
              )}
            </dl>
          </section>
          )}

          {/* The relay, in the order the work happens. */}
          <ol className="grid grid-cols-[repeat(auto-fit,minmax(10.5rem,1fr))] gap-2" aria-label="Steps">
            {c.steps.map((s, i) => {
              const on = s.key === step;
              const done = s.left === 0 && s.of > 0;
              return (
                <li key={s.key} className="flex min-w-0">
                  <Button
                    type="button"
                    variant="outline"
                    aria-current={on ? "step" : undefined}
                    onClick={() => setStep(s.key)}
                    className={cn("h-auto min-w-0 flex-1 justify-start gap-2.5 overflow-hidden rounded-xl px-3 py-2 text-left", on ? "border-mauve-9 bg-card shadow-sm" : "bg-muted/50 text-muted-foreground")}
                  >
                    <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold", on ? "bg-mauve-12 text-mauve-1" : done ? "border border-mauve-7 text-mauve-11" : "bg-mauve-4 text-mauve-11")}>
                      {done ? <Check size={13} aria-label="Done" /> : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-semibold", on && "text-foreground")}>{s.label}</span>
                      <span className="block truncate text-xs font-normal">
                        {s.who} · {s.words ?? (s.of === 0 ? "nothing to fill" : done ? "all filled" : `${s.left} of ${s.of} left`)}
                      </span>
                    </span>
                  </Button>
                </li>
              );
            })}
          </ol>

          {step === "otherCosts" && <OtherCostsPanel matrix={matrix} save={save} bands={bands} abcTotal={c.abcTotal} expenses={c.expenses} floorTotal={c.floorTotal} floorPartial={c.floorPartial} />}

          {step === "specs" && (
            <div className="space-y-4" data-testid="corridor-specs">
              <TechnicalVerdict matrix={matrix} actorId={actorId} nameOf={nameOf} writes={writes} />
              <EvaluationBar matrix={matrix} opportunityId={opportunityId} actorId={actorId} nameOf={nameOf} writes={writes} />
            </div>
          )}

          {step !== "otherCosts" && step !== "specs" && (
            <div className="space-y-3">
              {step === "finalAcquire" && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="corridor-final-acquire-percent">
                  <span className="text-sm font-semibold">Final Acquire</span>
                  <span className="text-sm text-muted-foreground">= Odoo SRP less</span>
                  <Cell label="Final Acquire discount from the Odoo SRP" noun="The discount" value={discount} numeric align="right" placeholder="20" readOnly={!canDiscount} onSave={(v) => save.finalAcquireDiscount(v)} className="w-20" />
                  <span className="text-sm text-muted-foreground">%</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    Every part follows it, unless its own Final Acquire is typed below.{!canDiscount && " Management types the discount."}
                  </span>
                </div>
              )}
              {step === "costs" && closed && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="corridor-markup">
                  <span className="text-sm font-semibold">Markup</span>
                  <Cell label="Markup" noun="The markup" value={matrix.defaultFactor ?? 1.35} numeric align="right" readOnly={!canFactor} onSave={(v) => save.defaultFactor(v)} className="w-20" />
                  <span className="text-xs text-muted-foreground">Markup price = Acquire × {factorLabel(factor).replace(/^×/, "")}, worked out by itself. A guide for Purchasing; it does not change the offer.</span>
                </div>
              )}
              {step === "offers" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="corridor-abc-mode">
                  {sees.abc && (
                  <>
                  <span className="text-sm font-semibold">Client ABC</span>
                  <div className="flex gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label="How the ABC is typed">
                    <Button type="button" size="xs" variant={abcByLine ? "outline" : "ghost"} className={cn(abcByLine && "bg-card shadow-sm")} aria-pressed={abcByLine} disabled={!canAbc} onClick={() => save.abc({ mode: ABC_MODE.BY_LINE })}>
                      Per line
                    </Button>
                    <Button type="button" size="xs" variant={!abcByLine ? "outline" : "ghost"} className={cn(!abcByLine && "bg-card shadow-sm")} aria-pressed={!abcByLine} disabled={!canAbc} onClick={() => save.abc({ mode: ABC_MODE.TOTAL_ONLY })}>
                      One total
                    </Button>
                  </div>
                  {abcByLine ? (
                    <span className="text-xs text-muted-foreground">Total {money(c.abcTotal)}</span>
                  ) : (
                    <>
                      <Cell label="ABC total" noun="The ABC total" value={matrix.abc?.total} numeric money align="right" placeholder="Type the total" readOnly={!canAbc} onSave={(v) => save.abc({ total: v })} className="w-40" />
                    </>
                  )}
                  </>
                  )}
                  {sees.abc && sees.offer && <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />}
                  {sees.offer && (
                  <>
                  <span className="text-sm font-semibold">Final Offer</span>
                  <div className="flex gap-1 rounded-lg bg-muted p-0.5" role="group" aria-label="How the Final Offer is typed">
                    <Button type="button" size="xs" variant={offerByLine ? "outline" : "ghost"} className={cn(offerByLine && "bg-card shadow-sm")} aria-pressed={offerByLine} disabled={!canOfferTotal} onClick={() => save.offer({ mode: ABC_MODE.BY_LINE })}>
                      Per line
                    </Button>
                    <Button type="button" size="xs" variant={!offerByLine ? "outline" : "ghost"} className={cn(!offerByLine && "bg-card shadow-sm")} aria-pressed={!offerByLine} disabled={!canOfferTotal} onClick={() => save.offer({ mode: ABC_MODE.TOTAL_ONLY })}>
                      One total
                    </Button>
                  </div>
                  {offerByLine ? (
                    <span className="text-xs text-muted-foreground">Total {money(c.offerTotal)}</span>
                  ) : (
                    <Cell label="Final Offer total" noun="The Final Offer total" value={matrix.offer?.total} numeric money align="right" placeholder="Type the total" readOnly={!canOfferTotal} onSave={(v) => save.offer({ total: v })} className="w-40" />
                  )}
                  </>
                  )}
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-border bg-card xl:overflow-x-clip">
                <Table className="border-separate border-spacing-0" containerClassName="xl:overflow-x-clip">
                  <TableHeader className="bg-transparent">
                    <TableRow className="hover:bg-transparent">
                      <th className={cn(HEAD, STICKY_HEAD, "text-left")}>S0 line</th>
                      {sees.cost && <th className={cn(HEAD, STICKY_HEAD, "text-right")}>{step === "costs" ? "Final Acquire / unit" : "Our cost"}</th>}
                      {sees.abc && abcByLine && <th className={cn(HEAD, STICKY_HEAD, "text-right")}>ABC / unit</th>}
                      {(sees.abc || closed) && <th className={cn(HEAD, STICKY_HEAD, "text-left")}>{abcByLine && sees.abc ? "Corridor · per unit" : "Go floor · per unit"}</th>}
                      {sees.offer && <th className={cn(HEAD, STICKY_HEAD, "text-right")}>Offer / unit</th>}
                      {closed && <th className={cn(HEAD, STICKY_HEAD, "text-right")}>Margin</th>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.rows.map((row) => (
                      <LineRow key={row.line.id} row={row} step={step} save={save} bands={bands} sees={sees} open={open.has(row.line.id)} onToggle={() => toggle(row.line.id)} abcByLine={abcByLine} offerByLine={offerByLine} factor={closed ? factor : null} faPercent={Number(matrix.finalAcquirePercent ?? -20)} onOpenLine={onOpenLine} floorLabel={c.floorPartial ? "Go floor so far" : "Go floor"} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {closed && (
          <p className="max-w-prose text-xs text-muted-foreground">
            Dot = our offer. The Go floor is the lowest offer that keeps Revenue at the Go line, worked with the summary&apos;s own formula; a line&apos;s floor is the deal&apos;s floor shared by its part of the cost. It is a guide, not a rule.
          </p>
          )}
        </div>

        <aside className="space-y-4 xl:sticky xl:top-2" aria-label="Decision">
          <DecisionCard matrix={matrix} c={c} fall={fall} writes={writes} nameOf={nameOf} opportunity={opportunity} onJump={setStep} />
          <SignoffBar matrix={matrix} nameOf={nameOf} />
        </aside>
      </div>
    </div>
  );
}

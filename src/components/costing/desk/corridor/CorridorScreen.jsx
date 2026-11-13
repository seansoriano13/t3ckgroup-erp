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
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronDown, ChevronRight, LayoutDashboard, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "../../../ui/button";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../../../ui/table";
import RecordHeader from "../../../record/RecordHeader";
import { Cell } from "../../GridCell";
import { factorLabel, pesos } from "../../gridFormat";
import { costingKeys } from "../../costingKeys";
import EvaluationBar from "../../EvaluationBar";
import InchargeSelects from "../../InchargeSelects";
import SignoffBar from "../../SignoffBar";
import TechnicalVerdict from "../../TechnicalVerdict";
import DecisionCard from "./DecisionCard";
import { useInchargeOptions } from "../../useCostingWrites";
import { costingMatrixService } from "../../../../services/costingMatrixService";
import { useAuth } from "../../../../context/AuthContext";
import { ABC_MODE, COMPONENT_BANDS, COSTING_BAND, COSTING_TIER, MATRIX_MONEY_BANDS, USUAL_COST_CATEGORIES, inAnyBand } from "../../../../constants/costing";
import { costUnit, finalAcquireTotal, projectExpensesTotal } from "../../../../utils/costingMath";

const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const money = (v) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : pesos(v));
const itemName = (line) => line.sor_line_snapshot?.name || (line.tender_specification ?? "").split("\n")[0].trim() || "Untitled line";
const partName = (part) => [part.brand, part.name].filter(Boolean).join(" ") || "Unnamed part";
const sum = (xs) => (xs.length === 0 || xs.some((x) => x === null) ? null : xs.reduce((a, b) => a + b, 0));

/* ------------------------------------------------------------------ the Go floor */

/**
 * The lowest offer total that keeps Revenue at the Go line, from the same formula the summary uses
 * (costingMath sheetRevenue): Revenue = offer ÷ VAT divisor − (retention × offer + landed + expenses + marketing)
 * − ITR × (offer above the allowance). Solved for Revenue = Go% × offer. Null while a cost is blank.
 */
function goFloor(fixedCost, rates) {
  if (fixedCost === null || !rates) return null;
  const d = Number(rates.vatDivisor ?? 1.12);
  const r = Number(rates.retentionRate ?? 0.01);
  const i = Number(rates.itrRate ?? 0.08);
  const a = Number(rates.itrAllowance ?? 0);
  const g = Number(rates.goLinePercent ?? 20) / 100;
  const above = (fixedCost - i * a) / (1 / d - r - i - g);
  if (above > a && 1 / d - r - i - g > 0) return above;
  return 1 / d - r - g > 0 ? fixedCost / (1 / d - r - g) : null;
}

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
    const marketing = num(matrix.money?.marketing) ?? 0;
    const floorTotal = goFloor(productCost === null ? null : productCost + (expenses ?? 0) + marketing, matrix.rates);
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
    const costRows = matrix.costRows ?? [];
    // Every usual category is shown, row or not (2026-11-13: "add all at default"); one without a row is blank.
    const missingUsual = USUAL_COST_CATEGORIES.filter((key) => !costRows.some((row) => row.category_key === key));
    const evaluated = Boolean(matrix.evaluation?.approved);
    return {
      rows,
      floorTotal,
      expenses,
      abcTotal: num(matrix.totals?.abcTotal),
      offerTotal: num(matrix.totals?.finalOfferTotal),
      steps: [
        { key: "costs", label: "Costs", who: "Purchasing", band: "purchasing", left: allParts.filter((p) => p.acquire_unit == null).length, of: allParts.length },
        { key: "finalAcquire", label: "Final Acquire", who: "Management", band: "management", left: allParts.filter((p) => costUnit(p) == null).length, of: allParts.length },
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
        { key: "specs", label: "Specs", who: "Technical", band: "technical", left: evaluated ? 0 : 1, of: 1, words: evaluated ? "approved" : "not approved yet" },
      ],
    };
  }, [matrix]);
}

/* ------------------------------------------------------------------ the corridor */

/**
 * One bar: the Go floor and the ABC as two lines, the safe zone between them, our offer as a dot and the markup's
 * suggestion as a ring. Each label sits under its own line. Outside the corridor is tinted and named.
 */
function Corridor({ floor, abc, offer, size = "sm" }) {
  if (floor === null && abc === null) return <span className="text-xs text-muted-foreground">Needs the costs and the ABC</span>;
  const values = [floor, abc, offer].filter((v) => v !== null);
  const lo = Math.min(...values) * 0.85;
  const hi = Math.max(...values) * 1.08;
  const pct = (v) => ((v - lo) / (hi - lo)) * 100;
  const at = (v) => `${pct(v)}%`;
  const state = offer === null ? "none" : floor !== null && offer < floor ? "low" : abc !== null && offer > abc ? "high" : "ok";
  const big = size === "lg";
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
          Go floor <span className="text-foreground">{pesos(floor)}</span> – ABC <span className="text-foreground">{pesos(abc)}</span>
        </div>
      ) : (
      <div className={cn("relative mt-1.5", big ? "h-9" : "h-8")}>
        {floor !== null && (
          <div className="absolute whitespace-nowrap pr-1.5 text-right leading-tight" style={floorAt(floor)}>
            <div className={cn("text-muted-foreground", big ? "text-xs" : "text-[11px]")}>Go floor</div>
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
      {state === "low" && <div className="text-xs font-medium text-red-11">Below the Go floor: the deal stops paying.</div>}
      {state === "high" && <div className="text-xs font-medium text-red-11">Over the ABC: the client cannot accept it.</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ the rows */

const HEAD = "border-b border-border bg-muted px-3 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground whitespace-nowrap";
const CELL = "border-b border-border px-3 py-3 align-top text-sm";
const NUM = "text-right tabular-nums whitespace-nowrap";

/** A part as one line: name and quantity, its Odoo SRP, then the one box this step fills (or the figure, greyed). */
function PartLiner({ part, step, save, canWrite, factor }) {
  const srp = num(part.odoo_unit);
  const fa = num(costUnit(part));
  return (
    <li className={cn("grid items-center gap-x-4 py-1.5 text-[13px]", step === "costs" ? "grid-cols-[minmax(0,1fr)_5rem_8rem_10rem_9rem]" : "grid-cols-[minmax(0,1fr)_5rem_8rem_10rem]")} data-testid="corridor-part">
      <span className="min-w-0 truncate">{partName(part)}</span>
      <span className="text-right tabular-nums text-muted-foreground">
        {num(part.quantity)} {part.unit}
      </span>
      <span className="text-right tabular-nums text-muted-foreground" title="Odoo SRP / unit">
        SRP {money(srp)}
      </span>
      {step === "costs" ? (
        <Cell label={`Acquire / unit ${partName(part)}`} noun="Acquire" value={part.acquire_unit} numeric money align="right" placeholder="Supplier price" readOnly={!canWrite} onSave={(v) => save.part(part.id, { acquireUnit: v })} />
      ) : step === "finalAcquire" ? (
        <Cell label={`Final Acquire / unit ${partName(part)}`} noun="Final Acquire" value={part.final_acquire_unit} numeric money align="right" placeholder={srp ? `${pesos(srp * 0.8)} by rule` : "Final Acquire"} readOnly={!canWrite} onSave={(v) => save.part(part.id, { finalAcquireUnit: v })} />
      ) : (
        <span className="text-right tabular-nums text-muted-foreground">FA {money(fa)}</span>
      )}
      {step === "costs" && (
        <span className="text-right tabular-nums text-muted-foreground" title="Acquire × markup, worked out by itself">
          {money(num(part.acquire_unit) === null || factor == null ? null : Math.round(num(part.acquire_unit) * Number(factor) * 100) / 100)}
        </span>
      )}
    </li>
  );
}

function LineRow({ row, step, save, bands, open, onToggle, abcByLine, offerByLine, factor, onOpenLine }) {
  const { line, kids, parts, qty } = row;
  const pricing = step === "offers";
  const showParts = !pricing || open;
  const canOffer = bands.includes(COSTING_BAND.SALES);
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
        <TableCell className={cn(CELL, NUM, cut)}>
          <div>{money(row.cost === null || !qty ? null : row.cost / qty)}</div>
          <div className="text-xs text-muted-foreground">per unit</div>
        </TableCell>
        {abcByLine && (
          <TableCell className={cn(CELL, "w-40", cut)}>
            {pricing ? (
              <Cell label={`ABC / unit ${line.number}`} noun="ABC" value={line.abc_unit} numeric money align="right" placeholder="Client budget" readOnly={!canOffer} onSave={(v) => save.line(line.id, { abcUnit: v })} />
            ) : (
              <div className={NUM}>{money(row.abcUnit)}</div>
            )}
          </TableCell>
        )}
        <TableCell className={cn(CELL, "w-[20rem] min-w-[15rem]", cut)}>
          {abcByLine ? (
            <Corridor floor={row.floorUnit} abc={row.abcUnit} offer={row.offerUnit} />
          ) : (
            // The ABC is one total, so a line has no ceiling of its own: no bar, just its floor (2026-11-13, option 1).
            <div className="text-sm" data-testid="corridor-floor-only">
              <span className="text-muted-foreground">Go floor </span>
              <span className="tabular-nums">{money(row.floorUnit)}</span>
              {row.offerUnit != null && row.floorUnit != null && row.offerUnit < row.floorUnit && <div className="text-xs font-medium text-red-11">The offer is below this line&apos;s Go floor.</div>}
            </div>
          )}
        </TableCell>
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
        <TableCell className={cn(CELL, NUM, cut, row.marginPct !== null && row.marginPct < 0 && "text-red-11")}>{row.marginPct === null ? "—" : `${row.marginPct.toFixed(1)}%`}</TableCell>
      </TableRow>
      {showParts && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={abcByLine ? 6 : 5} className="border-b border-border bg-mauve-2/60 px-3 pb-2 pt-1">
            <ul className="ml-8 max-w-3xl divide-y divide-border/60">
              {parts.map(({ part }) => (
                <PartLiner key={part.id} part={part} step={step} save={save} canWrite={canPart} factor={factor} />
              ))}
              {parts.length === 0 && <li className="py-1.5 text-[13px] text-muted-foreground">No part yet. Add it on today&apos;s screen.</li>}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ other costs */

const FALLBACK_LABEL = { labor: "Labor", logistics: "Logistics & Transportation", equipment: "Equipment & Tools", permits: "Permits/Insurance/Compliance", overhead: "Overhead" };

/** A share of the offer beside the cost guide's range; amber when outside it. */
function Share({ pct, range }) {
  if (!range) return null;
  if (pct === null) return <span className="block text-xs text-muted-foreground">aim {range.lowPct}–{range.highPct}%</span>;
  const off = pct < range.lowPct || pct > range.highPct;
  return (
    <span className={cn("block text-xs tabular-nums", off ? "font-semibold text-amber-11" : "text-muted-foreground")} title="Share of the Final Offer, against the cost guide">
      {pct.toFixed(1)}% · aim {range.lowPct}–{range.highPct}%
    </span>
  );
}

function CostLiner({ title, sub, qty, value, onSave, readOnly, amount, extra, pct, onSavePct, pctReadOnly }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_4rem_6.5rem_10.5rem_9rem] items-center gap-x-4 py-2" data-testid="corridor-other-cost">
      <span className="min-w-0">
        <span className="block truncate text-sm">{title}</span>
        {sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className="text-right text-[13px] tabular-nums text-muted-foreground">{qty}</span>
      {onSavePct ? (
        <Cell label={`% of ABC ${title}`} noun="The percent of the ABC" value={pct} numeric align="right" placeholder="% ABC" readOnly={pctReadOnly} onSave={onSavePct} />
      ) : (
        <span />
      )}
      <Cell label={`Amount ${title}`} noun="The amount" value={value} numeric money align="right" placeholder="Amount" readOnly={readOnly} onSave={onSave} />
      <span className="text-right">
        <span className="block text-sm font-medium tabular-nums">{money(amount)}</span>
        {extra}
      </span>
    </li>
  );
}

/**
 * What the bid costs us that is no line of the offer. Every usual cost category is listed, row or not, and
 * Marketing with them (it is OPEX too, typed by Finance or the decider list); a category with no row yet takes
 * its amount and the row is made. Each category shows its share of the offer beside the range the company
 * expects (the cost guide). They all count in OPEX, so every amount moves the Go floor as it is typed.
 */
function OtherCostsPanel({ matrix, save, canWrite, canMarketing, expenses, floorTotal, offerTotal }) {
  const { data: categories = [] } = useQuery({ queryKey: costingKeys.costCategories(), queryFn: () => costingMatrixService.listCostCategories(), staleTime: 60_000 });
  const rows = matrix.costRows ?? [];
  const guide = new Map(categories.map((cat) => [cat.key, cat]));
  const extraKeys = [...new Set(rows.map((r) => r.category_key).filter((k) => k && !USUAL_COST_CATEGORIES.includes(k)))];
  const groups = [...USUAL_COST_CATEGORIES, ...extraKeys].map((key) => ({ key, label: guide.get(key)?.label ?? FALLBACK_LABEL[key] ?? key, range: guide.get(key), rows: rows.filter((r) => r.category_key === key) }));
  const loose = rows.filter((r) => !r.category_key);
  const marketing = num(matrix.money?.marketing);
  const totalOf = (list) => sum(list.map((r) => (num(costUnit(r)) === null ? null : num(costUnit(r)) * (num(r.quantity) ?? 1))));
  const share = (amount) => (amount === null || !offerTotal ? null : (amount / offerTotal) * 100);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Other costs" data-testid="corridor-other-costs">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border bg-muted px-4 py-2.5">
        <h3 className="text-sm font-semibold">Other costs</h3>
        <span className="text-xs text-muted-foreground">Every cost category is listed. They count in OPEX and raise the Go floor.</span>
      </div>
      <ul className="divide-y divide-border/60 px-4">
        {groups.map((g) =>
          g.rows.length === 0 ? (
            <CostLiner
              key={g.key}
              title={g.label}
              sub="No row yet. Type an amount to add it."
              qty="1 lot"
              value={null}
              readOnly={!canWrite}
              amount={null}
              onSave={(v) => (v === "" || v == null ? undefined : save.addCostRow({ categoryKey: g.key, description: g.label, acquireUnit: v }))}
              pct={null}
              pctReadOnly={!canWrite}
              onSavePct={(v) => (v === "" || v == null ? undefined : save.addCostRow({ categoryKey: g.key, description: g.label, abcPct: v }))}
              extra={<Share pct={null} range={g.range} />}
            />
          ) : (
            g.rows.map((row, i) => (
              <CostLiner
                key={row.id}
                title={i === 0 ? g.label : `${g.label} (${i + 1})`}
                sub={row.abc_pct != null ? `${row.description || ""} · ${row.abc_pct}% of the ABC` : row.description || ""}
                qty={`${num(row.quantity) ?? 1} ${row.unit ?? ""}`}
                value={row.acquire_unit}
                readOnly={!canWrite}
                amount={totalOf([row])}
                onSave={(v) => save.costRow(row.id, row.abc_pct == null ? { acquireUnit: v } : { acquireUnit: v, abcPct: null })}
                pct={row.abc_pct}
                pctReadOnly={!canWrite}
                onSavePct={(v) => save.costRow(row.id, { abcPct: v })}
                extra={i === g.rows.length - 1 ? <Share pct={share(totalOf(g.rows))} range={g.range} /> : null}
              />
            ))
          ),
        )}
        {loose.map((row) => (
          <CostLiner key={row.id} title={row.description || "Untitled cost"} sub="Uncategorised" qty={`${num(row.quantity) ?? 1} ${row.unit ?? ""}`} value={row.acquire_unit} readOnly={!canWrite || row.abc_pct != null} amount={totalOf([row])} onSave={(v) => save.costRow(row.id, { acquireUnit: v })} pct={row.abc_pct} pctReadOnly={!canWrite} onSavePct={(v) => save.costRow(row.id, { abcPct: v })} />
        ))}
        <CostLiner title="Marketing" sub="Typed by Finance or the decider list" qty="" value={marketing} readOnly={!canMarketing} amount={marketing} onSave={(v) => save.marketing(v)} />
      </ul>
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border bg-mauve-2/60 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground">Other costs and Marketing · Go floor now {floorTotal === null ? "—" : pesos(floorTotal)}</span>
        <span className="font-mono font-semibold tabular-nums">{money(expenses === null ? null : expenses + (marketing ?? 0))}</span>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the screen */

export default function CorridorScreen({ data, opportunity, onOverview, onOpenLine, banner = null }) {
  const { matrix, save, fall, writes, opportunityId } = data;
  const { user } = useAuth();
  const actorId = user?.id ?? null;
  const incharge = useInchargeOptions(opportunity);
  const c = useCorridor(matrix);
  const bands = matrix.bands ?? [];
  const closed = matrix.tier === COSTING_TIER.CLOSED_BOOK;
  // Markup is Purchasing's (the sheet's "Markup Price · PMS – Automatic"): Acquire × the evaluation's markup, 1.35 by default.
  const factor = matrix.defaultFactor ?? 1.35;
  const canFactor = inAnyBand(bands, MATRIX_MONEY_BANDS.default_factor);
  const abcByLine = matrix.abc?.mode !== ABC_MODE.TOTAL_ONLY;
  const canAbc = bands.includes(COSTING_BAND.SALES);
  // The Final Offer by line or as one total (costing_matrices.offer_mode), the twin of the ABC's switch.
  const offerByLine = matrix.offer?.mode !== ABC_MODE.TOTAL_ONLY;
  const canOfferTotal = bands.includes(COSTING_BAND.SALES) && matrix.offer != null;
  const [step, setStep] = useState(() => c.steps.find((s) => s.left > 0)?.key ?? "offers");
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

  if (!closed) return <p className="text-sm text-muted-foreground">The price corridor needs the Closed Book (costs and offers together).</p>;

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
          <Button type="button" variant="outline" size="sm" onClick={onOverview} data-testid="corridor-overview">
            <LayoutDashboard size={14} aria-hidden="true" />
            Overview
          </Button>
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

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-5">
          {/* The deal's corridor: is the whole bid winnable and paying? */}
          <section className="sticky top-0 z-20 grid gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-4 lg:grid-cols-[minmax(0,1fr)_auto]" aria-label="The deal" data-testid="corridor-deal">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h3 className="text-sm font-semibold">The deal</h3>
                <span className="text-xs text-muted-foreground">Keep the dot between the Go floor and the client&apos;s ABC</span>
              </div>
              <Corridor floor={c.floorTotal} abc={c.abcTotal} offer={c.offerTotal} size="lg" />
            </div>
            <dl className="flex items-end gap-x-6">
              <div>
                <dt className="text-xs text-muted-foreground">Client ABC</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{money(c.abcTotal)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">
                  Offer
                  {c.abcTotal && c.offerTotal != null && <span className="ml-1">· {((c.offerTotal / c.abcTotal) * 100).toFixed(1)}% of ABC</span>}
                </dt>
                <dd className="font-mono text-lg font-semibold tabular-nums">{money(c.offerTotal)}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Revenue</dt>
                <dd className={cn("font-mono text-lg font-semibold tabular-nums", fall?.revenuePercent == null ? "" : under ? "text-amber-11" : "text-green-11")}>
                  {money(fall?.revenue)}
                  {fall?.revenuePercent != null && <span className="ml-1.5 text-sm">{fall.revenuePercent.toFixed(1)}%</span>}
                </dd>
              </div>
            </dl>
          </section>

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

          {step === "otherCosts" && (
            <OtherCostsPanel
              matrix={matrix}
              save={save}
              canWrite={bands.includes(COSTING_BAND.PURCHASING)}
              canMarketing={inAnyBand(bands, [COSTING_BAND.FINANCE, COSTING_BAND.MANAGEMENT])}
              expenses={c.expenses}
              floorTotal={c.floorTotal}
              offerTotal={c.offerTotal}
            />
          )}

          {step === "specs" && (
            <div className="space-y-4" data-testid="corridor-specs">
              <TechnicalVerdict matrix={matrix} actorId={actorId} nameOf={nameOf} writes={writes} />
              <EvaluationBar matrix={matrix} opportunityId={opportunityId} actorId={actorId} nameOf={nameOf} writes={writes} />
            </div>
          )}

          {step !== "otherCosts" && step !== "specs" && (
            <div className="space-y-3">
              {step === "costs" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="corridor-markup">
                  <span className="text-sm font-semibold">Markup</span>
                  <Cell label="Markup" noun="The markup" value={matrix.defaultFactor ?? 1.35} numeric align="right" readOnly={!canFactor} onSave={(v) => save.defaultFactor(v)} className="w-20" />
                  <span className="text-xs text-muted-foreground">Markup price = Acquire × {factorLabel(factor).replace(/^×/, "")}, worked out by itself. A guide for Purchasing; it does not change the offer.</span>
                </div>
              )}
              {step === "offers" && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5" data-testid="corridor-abc-mode">
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
                  <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
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
                </div>
              )}
              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <Table className="border-separate border-spacing-0">
                  <TableHeader className="bg-transparent">
                    <TableRow className="hover:bg-transparent">
                      <th className={cn(HEAD, "text-left")}>S0 line</th>
                      <th className={cn(HEAD, "text-right")}>Our cost</th>
                      {abcByLine && <th className={cn(HEAD, "text-right")}>ABC / unit</th>}
                      <th className={cn(HEAD, "text-left")}>{abcByLine ? "Corridor · per unit" : "Go floor · per unit"}</th>
                      <th className={cn(HEAD, "text-right")}>Offer / unit</th>
                      <th className={cn(HEAD, "text-right")}>Margin</th>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {c.rows.map((row) => (
                      <LineRow key={row.line.id} row={row} step={step} save={save} bands={bands} open={open.has(row.line.id)} onToggle={() => toggle(row.line.id)} abcByLine={abcByLine} offerByLine={offerByLine} factor={factor} onOpenLine={onOpenLine} />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          <p className="max-w-prose text-xs text-muted-foreground">
            Dot = our offer. The Go floor is the lowest offer that keeps Revenue at the Go line, worked with the summary&apos;s own formula; a line&apos;s floor is the deal&apos;s floor shared by its part of the cost. It is a guide, not a rule.
          </p>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-2" aria-label="Decision">
          <DecisionCard matrix={matrix} c={c} fall={fall} writes={writes} nameOf={nameOf} opportunity={opportunity} onJump={setStep} />
          <SignoffBar matrix={matrix} nameOf={nameOf} />
        </aside>
      </div>
    </div>
  );
}

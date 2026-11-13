/**
 * The Overview's pieces (layout B of the 2026-11-13 S0 Evaluation layouts): the sheet table with each band's total
 * in its header and the waterfall from offer to Revenue, opened from the price corridor's Overview button. Read-only.
 */
import { ArrowRight, CornerDownRight } from "lucide-react";

import { cn } from "@/lib/utils";
import StatusBadge from "../../../StatusBadge";
import { Button } from "../../../ui/button";
import { Table } from "../../../ui/table";
import { pesos } from "../../gridFormat";
import { TONE } from "./sheetModel";

const money = (v) => (v === null || v === undefined ? <span className="text-muted-foreground">—</span> : pesos(v));
const pct = (v) => (v === null || v === undefined ? "—" : `${Number(Number(v).toFixed(2))}%`);
const CAPTION = "text-label font-bold uppercase tracking-wider";

/* ---------------------------------------------------------------- band totals road */

/** One tile per band, left to right, each coloured by who fills it, with the band's total. */
export function BandRoad({ sheet, big = false, deltas = false }) {
  const { bands, totals, missing } = sheet;
  return (
    <ol className="flex flex-wrap items-stretch gap-y-2" data-testid="proto-band-road">
      {bands.map((band, i) => {
        const tone = TONE[band.tone];
        const prev = i > 0 ? bands[i - 1] : null;
        const delta = deltas && prev && totals[band.key] != null && totals[prev.key] ? (totals[band.key] / totals[prev.key]) * 100 : null;
        return (
          <li key={band.key} className="flex min-w-0 flex-1 items-stretch">
            {i > 0 && (
              <div className="flex shrink-0 flex-col items-center justify-center px-1.5 text-muted-foreground">
                <ArrowRight size={14} aria-hidden="true" />
                {delta !== null && <span className="text-[11px] tabular-nums">{delta.toFixed(0)}%</span>}
              </div>
            )}
            <div className={cn("min-w-[9rem] flex-1 overflow-hidden rounded-lg border bg-card", tone.ring)}>
              <div className={cn("flex items-center justify-between gap-2 px-3 py-1", tone.strip)}>
                <span className={CAPTION}>{band.label}</span>
                <span className="text-[11px] opacity-90">{band.owner}</span>
              </div>
              <div className={cn("px-3 font-mono font-semibold tabular-nums", big ? "py-3 text-xl" : "py-2 text-base")}>{money(totals[band.key])}</div>
              {missing[band.key] > 0 && <div className="px-3 pb-2 text-xs text-amber-11">{missing[band.key]} line{missing[band.key] === 1 ? "" : "s"} blank</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ---------------------------------------------------------------- the sheet */

const CELL = "border-b border-r border-border px-3 py-2 align-top text-[13px] leading-snug";
const NUM = "text-right tabular-nums whitespace-nowrap";

/**
 * The lines as one flat sheet. Band header strips coloured by owner; `totalsInHead` puts each band's total
 * in the header (the Google Sheet's TOTAL row); `unitCols` shows Unit and Total per band, else Total only.
 * Parts and included lines sit under their line, indented; never a table inside a row.
 */
export function SheetTable({ sheet, unitCols = true, totalsInHead = true, footer = true, hidden = new Set(), onOpenLine }) {
  const bands = sheet.bands.filter((b) => !hidden.has(b.key));
  const per = unitCols ? 2 : 1;
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card" data-testid="proto-sheet">
      <Table className="w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th rowSpan={totalsInHead ? 3 : 2} className={cn("sticky left-0 z-10 border-b border-r border-border bg-muted px-3 py-2 text-left align-bottom text-label font-bold uppercase tracking-wider text-muted-foreground", unitCols ? "min-w-[16rem]" : "min-w-[11rem]")}>
              Item
            </th>
            <th rowSpan={totalsInHead ? 3 : 2} className="border-b border-r border-border bg-muted px-3 py-2 text-right align-bottom text-label font-bold uppercase tracking-wider text-muted-foreground">
              Qty
            </th>
            {bands.map((band) => (
              <th key={band.key} colSpan={per} className={cn("whitespace-nowrap border-r border-border/40 px-3 py-1.5 text-left", TONE[band.tone].strip)}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className={CAPTION}>{band.label}</span>
                  {unitCols && <span className="text-[11px] font-normal opacity-90">{band.owner}</span>}
                </div>
              </th>
            ))}
          </tr>
          {totalsInHead && (
            <tr>
              {bands.map((band) => (
                <th key={band.key} colSpan={per} className={cn("border-b border-r border-border px-3 py-1.5 text-right font-mono text-sm font-semibold tabular-nums", TONE[band.tone].soft)}>
                  {money(sheet.totals[band.key])}
                </th>
              ))}
            </tr>
          )}
          <tr>
            {bands.map((band) =>
              (unitCols ? ["Unit", "Total"] : ["Total"]).map((col) => (
                <th key={`${band.key}-${col}`} className="border-b border-r border-border bg-muted px-3 py-1.5 text-right text-label font-bold uppercase tracking-wider text-muted-foreground">
                  {col}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.length === 0 && (
            <tr>
              <td colSpan={2 + bands.length * per} className="px-3 py-4 text-sm text-muted-foreground">
                No S0 lines yet.
              </td>
            </tr>
          )}
          {sheet.rows.map((row) => {
            const isPart = row.kind === "part";
            const isKid = row.kind === "included";
            const indent = isPart ? (row.depth === 2 ? "pl-10" : "pl-5") : isKid ? "pl-5" : "";
            return (
              <tr key={row.id} className={cn(row.kind === "line" && "[&>td]:border-t [&>td]:border-t-mauve-6")} data-testid={`proto-row-${row.kind}`}>
                <td className={cn(CELL, "sticky left-0 z-[1]", unitCols ? "min-w-[16rem] max-w-[22rem]" : "min-w-[11rem] max-w-[15rem]", isPart ? "bg-muted" : "bg-card")}>
                  <div className={cn("flex gap-1.5", indent)}>
                    {(isPart || isKid) && <CornerDownRight size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-muted-foreground" />}
                    <div className="min-w-0">
                      {row.kind === "line" && onOpenLine ? (
                        <Button type="button" variant="link" className="h-auto p-0 text-left font-semibold text-foreground" onClick={() => onOpenLine(row.lineId)}>
                          {row.number}. {row.name}
                        </Button>
                      ) : (
                        <span className={cn(row.kind === "line" ? "font-semibold" : isPart ? "text-muted-foreground" : "")}>
                          {row.kind === "line" ? `${row.number}. ` : ""}
                          {row.name}
                        </span>
                      )}
                      {row.kind === "line" && row.parts > 1 && <span className="ml-1.5 text-xs text-muted-foreground">{row.parts} parts</span>}
                      {row.overAbc && (
                        <span className="ml-1.5 align-middle">
                          <StatusBadge label="Over ABC" theme="red" />
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className={cn(CELL, NUM, isPart && "bg-muted/40 text-muted-foreground")}>
                  {row.qty ?? "—"} <span className="text-xs text-muted-foreground">{row.unit ?? ""}</span>
                </td>
                {bands.map((band) => {
                  const cell = row.cells[band.key];
                  const cls = cn(CELL, NUM, !unitCols && "px-2", isPart && "bg-muted/40 text-muted-foreground");
                  if (cell === null)
                    return unitCols ? [<td key={`${band.key}-u`} className={cls} />, <td key={`${band.key}-t`} className={cls} />] : <td key={band.key} className={cls} />;
                  if (cell === "incl")
                    return unitCols ? (
                      [<td key={`${band.key}-u`} className={cn(cls, "text-muted-foreground")}>incl.</td>, <td key={`${band.key}-t`} className={cls} />]
                    ) : (
                      <td key={band.key} className={cn(cls, "text-muted-foreground")}>incl.</td>
                    );
                  return unitCols
                    ? [
                        <td key={`${band.key}-u`} className={cls}>{money(cell.unit)}</td>,
                        <td key={`${band.key}-t`} className={cn(cls, !isPart && "font-medium")}>{money(cell.total)}{cell.pct != null && <div className="text-xs font-normal text-muted-foreground">{cell.pct.toFixed(1)}%</div>}</td>,
                      ]
                    : <td key={band.key} className={cn(cls, !isPart && "font-medium")}>{money(cell.total)}{cell.pct != null && <div className="text-xs font-normal text-muted-foreground">{cell.pct.toFixed(1)}%</div>}</td>;
                })}
              </tr>
            );
          })}
        </tbody>
        {footer && sheet.rows.length > 0 && (
          <tfoot>
            <tr>
              <td className="sticky left-0 z-[1] border-r border-border bg-mauve-2 px-3 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground">Total</td>
              <td className="border-r border-border bg-mauve-2" />
              {bands.map((band) =>
                unitCols
                  ? [
                      <td key={`${band.key}-u`} className="border-r border-border bg-mauve-2" />,
                      <td key={`${band.key}-t`} className={cn("border-r border-border bg-mauve-2 px-3 py-2 font-mono font-semibold", NUM, TONE[band.tone].ink)}>{money(sheet.totals[band.key])}</td>,
                    ]
                  : <td key={band.key} className={cn("border-r border-border bg-mauve-2 px-3 py-2 font-mono font-semibold", NUM, TONE[band.tone].ink)}>{money(sheet.totals[band.key])}</td>,
              )}
            </tr>
          </tfoot>
        )}
      </Table>
    </div>
  );
}

/* ---------------------------------------------------------------- the waterfall */

/** Final Offer down to Revenue, one step a row, ending on Revenue against the Go line. */
export function Waterfall({ fall, dense = false }) {
  if (!fall) return <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">The money summary is shown to the Closed Book only.</p>;
  const ok = fall.revenuePercent != null && !fall.under;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="From offer to revenue" data-testid="proto-waterfall">
      <h3 className="border-b border-border bg-muted px-4 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground">From offer to revenue</h3>
      <dl>
        {fall.steps.map((step) => (
          <div
            key={step.key}
            className={cn(
              "flex items-baseline justify-between gap-4 px-4",
              dense ? "py-1" : "py-1.5",
              step.sign === 0 && "border-t border-border/70 font-semibold",
              step.key === "revenue" && "hidden",
            )}
          >
            <dt className={cn("text-sm", step.sign === -1 ? "pl-3 text-muted-foreground" : "text-foreground")}>
              {step.sign === -1 ? "− " : ""}
              {step.label}
              {step.opex && <span className="ml-1.5 text-[11px] text-muted-foreground/80">OPEX</span>}
            </dt>
            <dd className="font-mono text-sm tabular-nums">{money(step.value)}</dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-4 border-t border-dashed border-border/70 px-4 py-1.5 text-sm text-muted-foreground">
          <dt>OPEX (the four marked)</dt>
          <dd className="font-mono tabular-nums">{money(fall.opex)}</dd>
        </div>
      </dl>
      <div className={cn("flex items-end justify-between gap-4 px-4 py-3", ok ? "bg-green-3" : fall.revenuePercent == null ? "bg-muted" : "bg-amber-3")}>
        <div>
          <div className={cn(CAPTION, ok ? "text-green-11" : "text-amber-11")}>Revenue</div>
          <div className="font-mono text-2xl font-semibold tabular-nums">{money(fall.revenue)}</div>
        </div>
        <div className="text-right">
          <div className={cn("font-mono text-lg font-semibold tabular-nums", ok ? "text-green-11" : "text-amber-11")}>{pct(fall.revenuePercent)}</div>
          <div className="text-xs text-muted-foreground">of the offer · Go at {fall.goLine}%</div>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- cost shares */

/** Each cost category's share of the offer, with a bar showing where it sits against its target range. */
export function CostShares({ guide, title = "Cost shares vs target" }) {
  if (!guide) return null;
  const max = Math.max(100, ...guide.categories.map((c) => Number(c.highPct ?? 0)));
  const scale = (v) => `${Math.min(100, (Number(v) / Math.min(max, 100)) * 100)}%`;
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Cost shares" data-testid="proto-cost-shares">
      <h3 className="border-b border-border bg-muted px-4 py-2 text-label font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
      <ul className="divide-y divide-border/60">
        {guide.categories.map((c) => {
          const off = c.status === "below" || c.status === "above";
          return (
            <li key={c.key} className="grid grid-cols-[minmax(0,1fr)_6.5rem_4rem] items-center gap-x-3 px-4 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm">{c.label}</div>
                <div className="relative mt-1 h-1.5 rounded-full bg-mauve-3" aria-hidden="true">
                  {c.lowPct != null && c.highPct != null && (
                    <div className="absolute inset-y-0 rounded-full bg-green-5" style={{ left: scale(c.lowPct), width: `calc(${scale(c.highPct)} - ${scale(c.lowPct)})` }} />
                  )}
                  {c.sharePct != null && <div className={cn("absolute -top-0.5 h-2.5 w-1 rounded-sm", off ? "bg-amber-9" : "bg-mauve-12")} style={{ left: scale(c.sharePct) }} />}
                </div>
              </div>
              <span className="text-right text-xs tabular-nums text-muted-foreground">
                {pct(c.lowPct)} – {pct(c.highPct)}
              </span>
              <span className={cn("text-right text-sm tabular-nums", off ? "font-semibold text-amber-11" : "text-foreground")}>{pct(c.sharePct)}</span>
            </li>
          );
        })}
      </ul>
      <p className="border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">Green band = the range the company expects. A mark outside it is a warning, never a block.</p>
    </section>
  );
}

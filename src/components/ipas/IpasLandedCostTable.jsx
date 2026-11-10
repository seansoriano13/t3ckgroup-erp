// Section 3's Landed cost as one bordered table (spec #699, ticket #710, layout M1), in the same chrome
// as the Payments and Charges tables: Item (frozen), Qty, Unit price, In pesos, Share, Duties / unit,
// Freight / unit, Other / unit and Landed / unit, with a totals row and a note on the average rate.
// An Inventory IPAS adds Retail, Wholesale and WS income / unit. Only the Markup list sets the
// multiplier and the wholesale discount. One table, nothing nested in its rows.

import { useRef, useState } from "react";

import { Button } from "../ui/button";
import { FieldBox } from "../ui/FieldBox";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../ui/table";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../utils/ipas";
import { landedTable } from "../../utils/ipasLandedTable";

const th = "relative border-b border-r border-mauve-5 bg-mauve-2 px-3 py-2 text-left text-label uppercase tracking-wider text-mauve-11 whitespace-nowrap last:border-r-0";
const td = "border-b border-r border-mauve-5 px-3 py-2.5 align-top text-[13px] leading-snug last:border-r-0";
const num = "text-right tabular-nums whitespace-nowrap";
const foot = "border-r border-mauve-5 bg-mauve-2 px-3 py-2.5 text-[13px] font-semibold last:border-r-0";

// The Item column starts narrow, so the figures beside it stay in view; the handle on its edge widens it.
const ITEM_WIDTH = { start: 176, min: 120, max: 640 };
const clampItem = (px) => Math.min(ITEM_WIDTH.max, Math.max(ITEM_WIDTH.min, px));

/** The grip on the Item heading's right edge: drag it, or use the arrow keys, to resize the column. */
function ItemResizer({ width, onChange }) {
  const drag = useRef(null);
  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the Item column"
      aria-valuenow={Math.round(width)}
      aria-valuemin={ITEM_WIDTH.min}
      aria-valuemax={ITEM_WIDTH.max}
      tabIndex={0}
      data-testid="ipas-landed-item-resizer"
      className="absolute inset-y-0 right-0 z-20 w-2 cursor-col-resize touch-none select-none hover:bg-primary/30 focus-visible:bg-primary/40 focus-visible:outline-none"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) onChange(clampItem(drag.current.width + event.clientX - drag.current.x));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onDoubleClick={() => onChange(ITEM_WIDTH.start)}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onChange(clampItem(width - 16));
        else if (event.key === "ArrowRight") onChange(clampItem(width + 16));
        else return;
        event.preventDefault();
      }}
    />
  );
}

const php = (value) => (value === null || value === undefined ? "—" : formatAmount(value, "PHP"));

/** The multiplier and the wholesale discount, typed by the Markup list only. */
function MarkupInputs({ multiplier, discount, onSave }) {
  const [mult, setMult] = useState(multiplier === null ? "" : String(multiplier));
  const [disc, setDisc] = useState(String(discount));
  const changed = mult !== (multiplier === null ? "" : String(multiplier)) || disc !== String(discount);
  return (
    <div className="flex flex-wrap items-end gap-3" data-testid="ipas-markup-inputs">
      <FieldBox label="Multiplier" bare className="w-24">
        <Input value={mult} inputMode="decimal" onChange={(e) => setMult(e.target.value)} />
      </FieldBox>
      <FieldBox label="Wholesale discount %" bare className="w-32">
        <Input value={disc} inputMode="decimal" onChange={(e) => setDisc(e.target.value)} />
      </FieldBox>
      <Button size="sm" disabled={!changed} onClick={() => onSave?.({ multiplier: mult.trim() === "" ? null : Number(mult), discount: Number(disc) })}>
        Save markup
      </Button>
    </div>
  );
}

export default function IpasLandedCostTable({ ipas, canSetMarkup = false, onSetMarkup }) {
  const [itemWidth, setItemWidth] = useState(ITEM_WIDTH.start);
  const table = landedTable(ipas);
  if (!table) return null;
  const itemStyle = { width: itemWidth, minWidth: itemWidth, maxWidth: itemWidth };
  const lc = ipas.landedCost;
  const currency = lc.currency || ipas.currency;
  const { pricing, totals, note } = table;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-mauve-5 bg-card" data-testid="ipas-landed-table">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={cn(th, "sticky left-0 z-10")} style={itemStyle}>
                Item
                <ItemResizer width={itemWidth} onChange={setItemWidth} />
              </th>
              {["Qty", "Unit price", "In pesos", "Share", "Duties / unit", "Freight / unit", "Other / unit", "Landed / unit"].map((h) => (
                <th key={h} className={cn(th, "text-right")}>{h}</th>
              ))}
              {pricing && (
                <>
                  <th className={cn(th, "text-right")}>Retail{table.multiplier !== null ? ` ×${table.multiplier}` : ""}</th>
                  <th className={cn(th, "text-right")}>Wholesale −{table.discount}%</th>
                  <th className={cn(th, "text-right")}>WS income / unit</th>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y-0">
            {table.rows.map((row) => (
              <TableRow key={row.key} data-testid="ipas-landed-line" className="hover:bg-transparent">
                <TableCell className={cn(td, "sticky left-0 z-10 bg-card font-semibold [overflow-wrap:anywhere]")} style={itemStyle}>
                  <span className="whitespace-pre-line">{row.name}</span>
                </TableCell>
                <TableCell className={cn(td, num)}>{row.quantity}{row.unit ? ` ${row.unit}` : ""}</TableCell>
                <TableCell className={cn(td, num)}>
                  {lc.isForeign ? formatAmount(row.unitPriceForeign, currency) : php(row.unitPrice)}
                </TableCell>
                <TableCell className={cn(td, num)}>{php(row.unitPrice)}</TableCell>
                <TableCell className={cn(td, num, "text-mauve-11")}>{row.share === null ? "—" : `${row.share.toFixed(2)}%`}</TableCell>
                <TableCell className={cn(td, num)}>{php(row.duties)}</TableCell>
                <TableCell className={cn(td, num)}>{php(row.freight)}</TableCell>
                <TableCell className={cn(td, num)}>{php(row.other)}</TableCell>
                <TableCell className={cn(td, num, "font-semibold")}>{php(row.landed)}</TableCell>
                {pricing && (
                  <>
                    <TableCell className={cn(td, num)}>{php(row.retail)}</TableCell>
                    <TableCell className={cn(td, num)}>{php(row.wholesale)}</TableCell>
                    <TableCell className={cn(td, num, row.income !== null && row.income < 0 && "text-red-11")}>{php(row.income)}</TableCell>
                  </>
                )}
              </TableRow>
            ))}
          </TableBody>
          <tfoot>
            <tr>
              <td className={cn(foot, "sticky left-0 z-10")} style={itemStyle}>{totals.units} units</td>
              <td className={foot} />
              <td className={cn(foot, num)}>{lc.isForeign ? formatAmount(totals.goodsForeign, currency) : ""}</td>
              <td className={cn(foot, num)}>{php(totals.goodsPhp)}</td>
              <td className={cn(foot, num)}>100%</td>
              <td className={foot} />
              <td className={foot} />
              <td className={foot} />
              <td className={cn(foot, num)}>{php(totals.landedPhp)}</td>
              {pricing && (
                <>
                  <td className={foot} />
                  <td className={foot} />
                  <td className={foot} />
                </>
              )}
            </tr>
          </tfoot>
        </Table>
      </div>
      {note && (
        <p className="text-xs text-mauve-11" data-testid="ipas-landed-rate-note">
          Average rate <span className="font-mono tabular-nums">₱{note.average.toFixed(2)}</span> across {ipas.payments?.length ?? 0} payments.
          {note.off !== null && note.off > 0 && (
            <> One rate for the whole sheet would have been off by <span className="font-mono tabular-nums">{php(note.off)}</span>.</>
          )}
        </p>
      )}
      {pricing && (
        <div className="space-y-1" data-testid="ipas-pricing">
          {canSetMarkup ? (
            <MarkupInputs
              key={`${table.multiplier}-${table.discount}`}
              multiplier={table.multiplier}
              discount={table.discount}
              onSave={onSetMarkup}
            />
          ) : (
            <p className="text-xs text-mauve-11">
              {table.multiplier === null
                ? "No multiplier yet, so no retail or wholesale. Only the Markup list sets it."
                : "Only the Markup list changes the multiplier and the wholesale discount."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

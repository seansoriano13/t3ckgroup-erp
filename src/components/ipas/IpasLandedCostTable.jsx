// Section 3's Landed cost as one bordered table (spec #699, ticket #710, layout M1), in the same chrome
// as the Payments and Charges tables: Item (frozen), Qty, Unit price, In pesos, Share, Duties / unit,
// Freight / unit, Other / unit and Landed / unit, with a totals row and a note on the average rate.
// An Inventory IPAS adds Retail, Wholesale and WS income / unit. Only the Markup list sets the
// multiplier and the wholesale discount. One table, nothing nested in its rows.

import { useState } from "react";

import { Button } from "../ui/button";
import { FieldBox } from "../ui/FieldBox";
import { Input } from "../ui/input";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "../ui/table";
import { cn } from "@/lib/utils";
import { formatAmount } from "../../utils/ipas";
import { landedTable } from "../../utils/ipasLandedTable";

const th = "border-b border-r border-mauve-5 bg-mauve-2 px-3 py-2 text-left text-label uppercase tracking-wider text-mauve-11 whitespace-nowrap last:border-r-0";
const td = "border-b border-r border-mauve-5 px-3 py-2.5 align-top text-[13px] leading-snug last:border-r-0";
const num = "text-right tabular-nums whitespace-nowrap";
const foot = "border-r border-mauve-5 bg-mauve-2 px-3 py-2.5 text-[13px] font-semibold last:border-r-0";

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
  const table = landedTable(ipas);
  if (!table) return null;
  const lc = ipas.landedCost;
  const currency = lc.currency || ipas.currency;
  const { pricing, totals, note } = table;

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-xl border border-mauve-5 bg-card" data-testid="ipas-landed-table">
        <Table className="border-separate border-spacing-0">
          <TableHeader className="bg-transparent">
            <TableRow>
              <th className={cn(th, "sticky left-0 z-10")}>Item</th>
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
                <TableCell className={cn(td, "sticky left-0 z-10 min-w-[14rem] bg-card font-semibold")}>
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
              <td className={cn(foot, "sticky left-0 z-10")}>{totals.units} units</td>
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

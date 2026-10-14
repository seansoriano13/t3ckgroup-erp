import { ArrowUpRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LANDED_BADGE } from "./digest";

/**
 * The four headline amounts, the only place they show on the record page. Each
 * one opens the section it comes from. Values may wrap at narrow widths but
 * never overflow their column.
 */
export default function Figures({ digest, onOpen }) {
  const { money } = digest;
  const stats = [
    {
      key: "purchasing",
      label: "Odoo PO, before tax",
      value: money.poTotalText,
      sub: `${money.lineCount} ${money.lineCount === 1 ? "line" : "lines"}`,
    },
    {
      key: "purchasing",
      label: "Paid",
      value: money.paidText,
      sub: money.paymentCount > 0 ? `${money.debitedPhpText} debited` : "No payments yet",
    },
    {
      key: "finance",
      label: "Charges",
      value: money.chargesPhpText,
      sub: `${money.chargeCount} recorded`,
    },
    {
      key: "costing",
      label: "Landed Cost",
      value: money.landedText,
      // Unavailable already reads "Not available yet" in the value: one line says it.
      sub: money.landedPhp === null ? undefined : LANDED_BADGE[money.landedStatus]?.label,
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-x-6 gap-y-4 border-b border-border pb-5 sm:grid-cols-4">
      {stats.map((stat) => (
        <li key={stat.label} className="min-w-0">
          <Button
            variant="ghost"
            onClick={() => onOpen(stat.key)}
            className="group/stat h-auto w-full min-w-0 flex-col items-start justify-start gap-0 rounded-sm p-0 text-left font-normal whitespace-normal hover:bg-transparent"
          >
            <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover/stat:text-foreground">
              {stat.label}
              <ArrowUpRight aria-hidden="true" className="size-3 opacity-40 group-hover/stat:opacity-100" />
            </span>
            <span
              className={cn(
                "mt-0.5 block max-w-full min-w-0 font-mono text-lg font-semibold tracking-tight tabular-nums break-words text-foreground",
              )}
            >
              {stat.value}
            </span>
            {stat.sub && <span className="block text-xs text-muted-foreground">{stat.sub}</span>}
          </Button>
        </li>
      ))}
    </ul>
  );
}

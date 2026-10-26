/**
 * REMOVE-BEFORE-PROD (ADR 0028): the cells of one Product status line: the
 * notes column, the opened details, and the "asked in words" text.
 */
import { AlertTriangle } from "lucide-react";

import DetailGrid from "@/components/record/DetailGrid";
import { Button } from "@/components/ui/button";
import { Image } from "@/components/ui/image";
import StatusBadge from "@/components/StatusBadge";
import { STATUS_THEME } from "@/constants/statusTheme";
import { cn } from "@/lib/utils";
import { ROLE, actionState, lineNotes, priceText, stockText } from "./lineState";

export function Notes({ line, onYours }) {
  const notes = lineNotes(line);
  return (
    <div className="flex min-w-0 flex-col items-start gap-1 text-xs text-muted-foreground">
      {line.newOnS0 && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => onYours(line)}
          aria-label={`Is ${line.name} yours? Compare it with your request`}
          className="h-auto rounded-full p-0 hover:bg-transparent"
        >
          <StatusBadge label="Is this yours?" theme={STATUS_THEME.AMBER} />
        </Button>
      )}
      {line.newOnS0 && <span className="text-amber-12">New on the S0 today</span>}
      {notes.map((note) => (
        <span key={note.text} className={cn("flex items-start gap-1", note.warn && "font-medium text-amber-12")}>
          {note.warn && <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />}
          <span className="min-w-0 break-words">{note.text}</span>
        </span>
      ))}
      {notes.length === 0 && !line.newOnS0 && <span aria-hidden="true">—</span>}
    </div>
  );
}

export function Details({ line, role, onAction }) {
  const off = actionState(line);
  const price = priceText(line);
  const asked = line.section === "other";
  const stock = stockText(line);
  const canvass = line.canvass
    ? `${line.canvass.code} · ${line.canvass.stopped ? `Stopped · replaced by ${line.replacedBy?.name}` : `${line.canvass.offers} of ${line.canvass.of} offers`}`
    : null;
  const items = [
    asked
      ? { label: "What it is for", value: line.forWhat }
      : { label: "Stock", value: stock.text },
    asked
      ? { label: "Asked by", value: `${line.addedByPurchasing ? "Added by Purchasing" : `Asked by ${line.askedBy}`} · ${line.when}` }
      : { label: "Odoo code", value: line.code, mono: true },
    line.p0 && { label: "P0", value: `${line.p0.number} · ${line.p0.state === "RFQ" ? "RFQ only, not confirmed" : "Confirmed"}`, mono: true },
    line.p0 && line.p0.product !== line.name && { label: "Bought as", value: line.p0.product },
    price && { label: "Price each", value: price },
    canvass && { label: "Canvass", value: canvass, mono: true },
    line.replaces && { label: "Replaces", value: line.replaces },
    line.mergedFrom && { label: "Merged with", value: `Your request "${line.mergedFrom}"` },
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <DetailGrid items={items} />
      {role === ROLE.PURCHASING && (
        <div className="flex flex-wrap gap-2" role="group" aria-label={`Purchasing actions for ${line.name}`}>
          {[
            ["canvass", "Canvass"],
            ["attach", "Attach P0"],
            ["replace", "Replace"],
          ].map(([kind, label]) => (
            <Button
              key={kind}
              type="button"
              variant="outline"
              size="sm"
              disabled={!!off[kind]}
              title={off[kind] ?? undefined}
              onClick={() => onAction(kind, line)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AskedText({ line }) {
  return (
    <>
      {line.photo && (
        <Image src={line.photo} alt="" className="mr-2 inline-block size-6 rounded-md border border-border object-cover align-middle" />
      )}
      {line.p0 ? `Asked as: ${line.name}` : line.name}
    </>
  );
}

export function AskedSub({ line }) {
  return (
    <>
      {line.p0 && <span className="block">Bought as: {line.p0.product}</span>}
      <span className="block">
        {line.addedByPurchasing ? "Added by Purchasing" : `Asked by ${line.askedBy}`} · {line.when}
      </span>
    </>
  );
}

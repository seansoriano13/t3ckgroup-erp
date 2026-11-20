import { useState } from "react";
import { RequiredMark } from "@/components/ipas/record/FormFields";
import { Check, ChevronDown, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/ui/SelectField";
import { cn } from "@/lib/utils";
import { TRANSMITTAL_LINE_KIND } from "@/constants/transmittals";
import { QUANTITY_MESSAGE, countsWholeThings, overClaim } from "@/utils/transmittals";

const NO_SOR = "__none__";

/** Project (S.O) for a line: a click-to-toggle chip when there are a few, a select past that. */
function ProjectChoice({ line, onChange }) {
  const options = line.sorOptions;
  if (options.length === 0) return <span className="text-[13px] text-muted-foreground">No project</span>;
  if (options.length <= 3) {
    return (
      <div role="group" aria-label="Project (S.O)" className="flex flex-wrap gap-1.5">
        {options.map((sor) => {
          const on = line.sorId === sor.id;
          return (
            <Button
              key={sor.id}
              type="button"
              variant="outline"
              size="sm"
              aria-pressed={on}
              onClick={() => onChange(on ? null : sor.id)}
              className={cn(
                "h-7 rounded-full px-2.5 font-mono text-xs",
                on ? "border-mauve-12 bg-mauve-12 text-mauve-1 hover:bg-mauve-12 hover:text-mauve-1" : "text-muted-foreground",
              )}
            >
              {on && <Check size={12} />}
              {sor.label}
            </Button>
          );
        })}
      </div>
    );
  }
  return (
    <SelectField
      size="sm"
      options={[{ value: NO_SOR, label: "None" }, ...options.map((s) => ({ value: s.id, label: s.label }))]}
      value={line.sorId ?? NO_SOR}
      onChange={(value) => onChange(value === NO_SOR ? null : value)}
      placeholder="Project (S.O)"
    />
  );
}

/**
 * One slip line as a single tidy row: the item (typed in, for a typed line),
 * its quantity and unit, its project, and a "More" fold for SN# and the box
 * quantity. A P0 line brings its item, quantity, unit and project from the PO.
 */
export default function LineLiner({ line, lines = [], index, onChange, onRemove }) {
  const isPo = line.kind === TRANSMITTAL_LINE_KIND.PO_LINE;
  const [more, setMore] = useState(Boolean(line.serialNumbers || line.boxQuantity));
  const badQuantity = !(Number(line.quantity) > 0) || (countsWholeThings(line.unit) && !Number.isInteger(Number(line.quantity)));
  const extra = overClaim(line, lines);
  return (
    <li className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>
        <div className="min-w-44 flex-1">
          {isPo ? (
            <>
              <p className="truncate text-[13px] font-semibold text-foreground">{line.description || "P0 line"}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                <span className="font-mono">{line.poNumber}</span> · {line.ipasNumber}
              </p>
            </>
          ) : (
            <span className="relative block">
            <Input
              className="h-9 pr-6 text-[13px]"
              value={line.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Describe the item"
              aria-label="Description"
              autoFocus={!line.description}
            />
            <span className="absolute right-2 top-1.5"><RequiredMark /></span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            min="0"
            step="any"
            className="h-9 w-20 text-right text-[13px]"
            value={line.quantity}
            onFocus={(e) => e.target.select()}
            onChange={(e) => onChange({ quantity: e.target.value })}
            aria-label="Quantity"
            aria-invalid={badQuantity || undefined}
          />
          <RequiredMark />
          {isPo ? (
            <span className="w-10 text-[13px] text-muted-foreground">{line.unit}</span>
          ) : (
            <>
            <Input
              className="h-9 w-16 text-[13px]"
              value={line.unit}
              onChange={(e) => onChange({ unit: e.target.value })}
              placeholder="Unit"
              aria-label="Unit"
            />
            <RequiredMark />
            </>
          )}
        </div>
        <ProjectChoice line={line} onChange={(sorId) => onChange({ sorId })} />
        <div className="ml-auto flex items-center">
          <Button type="button" variant="ghost" size="xs" aria-expanded={more} onClick={() => setMore((open) => !open)} className="gap-1 text-muted-foreground">
            More <ChevronDown size={12} className={cn("transition-transform", more && "rotate-180")} />
          </Button>
          <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove line" onClick={onRemove}>
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
      {badQuantity && (
        <p role="alert" className="mt-1.5 pl-8 text-[12px] text-destructive max-sm:pl-0">
          {Number(line.quantity) > 0 ? `${line.unit} takes a whole number.` : QUANTITY_MESSAGE}
        </p>
      )}
      {extra > 0 && (
        <div className="mt-2 space-y-1.5 pl-8 max-sm:pl-0">
          <p className="text-[12px] text-amber-11">
            {extra} more than this P0 line has left. Say why{line.overClaimRemark?.trim() ? "" : ", to submit"}.
          </p>
          <span className="relative block">
            <Input
              className="h-9 pr-6 text-[13px]"
              value={line.overClaimRemark ?? ""}
              onChange={(e) => onChange({ overClaimRemark: e.target.value })}
              placeholder="Remark (a replacement for an NA line, for one)"
              aria-label="Remark"
            />
            <span className="absolute right-2 top-1.5"><RequiredMark /></span>
          </span>
        </div>
      )}
      {more && (
        <div className="mt-2 grid grid-cols-2 gap-2 pl-8 max-sm:pl-0">
          <Input className="h-9 text-[13px]" value={line.serialNumbers} onChange={(e) => onChange({ serialNumbers: e.target.value })} placeholder="SN#" aria-label="SN#" />
          <Input className="h-9 text-[13px]" value={line.boxQuantity} onChange={(e) => onChange({ boxQuantity: e.target.value })} placeholder="Quantity of Box" aria-label="Quantity of Box" />
        </div>
      )}
    </li>
  );
}

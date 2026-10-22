import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { transmittalService } from "@/services/transmittalService";
import { TRANSMITTAL_LINE_KIND } from "@/constants/transmittals";
import { pickedLineLabel } from "@/utils/transmittals";

const MAX_SHOWN = 80;

/** The key a PO line has on the slip and in the live list. */
const pickKey = (pick) => `${pick.ipasId}:${pick.odooPoLineId}`;

/** The PO lines already on the slip, as a Set of pick keys. */
const onSlipKeys = (lines) =>
  new Set(lines.filter((l) => l.kind === TRANSMITTAL_LINE_KIND.PO_LINE).map((l) => `${l.ipasId}:${l.odooPoLineId}`));

function useDebounced(value, ms = 220) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function PickRow({ pick, active, onSlip, onToggle, onHover }) {
  const projects = pick.sors.map((s) => s.sales_reference).join(", ");
  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={onSlip}
      onClick={onToggle}
      onMouseEnter={onHover}
      className={cn("h-auto w-full justify-start gap-3 rounded-lg px-3 py-2 text-left whitespace-normal", active && "bg-muted")}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-semibold text-foreground">{pickedLineLabel(pick)}</span>
        <span className="block truncate text-[12px] font-normal text-muted-foreground">
          <span className="font-mono">{pick.poNumber}</span> · {pick.ipasNumber}
          {projects && ` · ${projects}`}
        </span>
      </span>
      <span className={cn("flex shrink-0 items-center gap-1 text-[12px] font-semibold", onSlip ? "text-foreground" : "text-muted-foreground")}>
        {onSlip ? (
          <>
            <Check size={13} /> On slip
          </>
        ) : (
          <>
            <Plus size={13} /> Add
          </>
        )}
      </span>
    </Button>
  );
}

/**
 * The live PO lines, always open beside the slip (#252). One search box: type a
 * PO number or an item name and the matching lines show. Click a line to put it
 * on the slip, click it again to take it off; Enter does the same for the
 * highlighted one (↑ ↓ move). When a PO number matches, "Add all" takes every
 * line of that PO, and the last choice adds what was typed as a typed line.
 *
 * `lines` are the slip's lines, so a line already on it reads "On slip".
 */
export default function PoLineBrowser({ lines, onToggle, onAddAll, onAddTyped }) {
  const [term, setTerm] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef(null);
  const debounced = useDebounced(term.trim());

  const { data: picks = [], isFetching, isError } = useQuery({
    queryKey: ["transmittals", "pickable", debounced],
    queryFn: () => transmittalService.pickablePoLines(debounced),
    placeholderData: (previous) => previous,
  });
  const onSlip = onSlipKeys(lines);

  const needle = term.trim().toLowerCase();
  const items = [];
  if (needle) {
    const poNumbers = [...new Set(picks.map((p) => p.poNumber))].filter((po) => po?.toLowerCase().includes(needle));
    for (const po of poNumbers.slice(0, 2)) {
      const missing = picks.filter((p) => p.poNumber === po && !onSlip.has(pickKey(p)));
      if (missing.length > 1) items.push({ type: "all", po, picks: missing });
    }
  }
  picks.slice(0, MAX_SHOWN).forEach((pick) => items.push({ type: "line", pick }));
  if (needle) items.push({ type: "typed", text: term.trim() });
  const at = Math.min(active, Math.max(items.length - 1, 0));

  const choose = (item) => {
    if (!item) return;
    if (item.type === "all") {
      onAddAll(item.picks);
      setTerm("");
    } else if (item.type === "typed") {
      onAddTyped(item.text);
      setTerm("");
    } else {
      onToggle(item.pick);
    }
    inputRef.current?.focus();
  };

  const onKeyDown = (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive(Math.min(at + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(Math.max(at - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[at]);
    }
  };

  return (
    <div className="space-y-2">
      <Input
        ref={inputRef}
        icon={Search}
        className="h-11"
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder="Type a PO number or an item name"
        aria-label="Find a PO line"
      />
      <div className="max-h-[52vh] overflow-y-auto rounded-xl border border-border bg-card p-1">
        {isError && <p className="p-4 text-center text-[13px] text-muted-foreground">The PO lines could not be loaded.</p>}
        {!isError && items.length === 0 && (
          <p className="p-4 text-center text-[13px] text-muted-foreground">{isFetching ? "Searching…" : "No live PO lines."}</p>
        )}
        {items.map((item, index) => {
          if (item.type === "all") {
            return (
              <Button
                key={`all-${item.po}`}
                type="button"
                variant="ghost"
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
                className={cn("h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-[13px] font-bold", index === at && "bg-muted")}
              >
                <Plus size={14} /> Add all {item.picks.length} lines of <span className="font-mono">{item.po}</span>
              </Button>
            );
          }
          if (item.type === "typed") {
            return (
              <Button
                key="typed"
                type="button"
                variant="ghost"
                onClick={() => choose(item)}
                onMouseEnter={() => setActive(index)}
                className={cn("h-auto w-full justify-start gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold whitespace-normal", index === at && "bg-muted")}
              >
                <Plus size={14} className="shrink-0" />
                <span className="min-w-0 truncate">
                  Add “{item.text}” as a typed line <span className="font-normal text-muted-foreground">(not on a PO)</span>
                </span>
              </Button>
            );
          }
          return (
            <PickRow
              key={pickKey(item.pick)}
              pick={item.pick}
              active={index === at}
              onSlip={onSlip.has(pickKey(item.pick))}
              onToggle={() => choose(item)}
              onHover={() => setActive(index)}
            />
          );
        })}
      </div>
    </div>
  );
}

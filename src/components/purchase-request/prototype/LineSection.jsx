/**
 * REMOVE-BEFORE-PROD (ADR 0028): one foldable section of the Product status
 * prototype ("From the S0", "Other requests"). The header folds the whole
 * section shut; inside it, finished lines fold into one "N done" row.
 */
import { useId, useState } from "react";
import { ChevronRight } from "lucide-react";

import LinerList from "@/components/record/LinerList";
import Reveal from "@/components/record/Reveal";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { buildRow } from "./LineRows";
import { COLUMNS, isFolded } from "./lineState";

function ColumnHeads({ third }) {
  const head = "text-label font-bold uppercase tracking-wider text-muted-foreground";
  return (
    <div className="flex gap-3 border-b border-border bg-muted/40 pr-4 py-1.5" aria-hidden="true">
      <span className={cn(head, "min-w-0 flex-1 px-4")}>{third.first}</span>
      <div className={cn("grid gap-3", COLUMNS)}>
        <span className={cn(head, "text-right")}>Qty</span>
        <span className={head}>{third.label}</span>
        <span className={head}>Status</span>
        <span className={head}>P0</span>
        <span className={head}>Delivery and notes</span>
      </div>
      <span className="w-4 shrink-0" />
    </div>
  );
}

export default function LineSection({ id, title, subtitle, lines, open, onOpenChange, role, onChoose, onAction, onYours, sectionRef }) {
  const [showDone, setShowDone] = useState(false);
  const panelId = useId();
  const asked = id === "other";
  const rowFor = (line) => buildRow({ line, role, onChoose, onAction, onYours });

  const active = lines.filter((l) => !isFolded(l));
  const folded = lines.filter(isFolded);
  const rows = [
    ...active.map(rowFor),
    ...(showDone ? folded.map(rowFor) : []),
    ...(folded.length > 0
      ? [
          {
            key: `${id}-done`,
            testId: "done-row",
            main: `${folded.length} done`,
            sub: "Available, Received and Cancelled lines",
            actions: (
              <Button type="button" variant="link" size="sm" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
                {showDone ? "hide" : "show"}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <section
      ref={sectionRef}
      aria-label={title}
      // Keeps every shut Reveal clipped. The committed Reveal lets a shut panel leak its contents
      // (it counts a panel that never opened as settled); drop this once that is fixed there.
      className="scroll-mt-4 space-y-2 [&_.reveal[data-open='false']>*]:overflow-hidden!"
    >
      <Button
        type="button"
        variant="ghost"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onOpenChange(!open)}
        className="h-auto w-full justify-start gap-2 px-1 py-1.5 text-left hover:bg-muted/50"
      >
        <ChevronRight size={16} aria-hidden="true" className={cn("shrink-0 text-muted-foreground transition-transform duration-200 ease-out-expo", open && "rotate-90")} />
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="text-xs font-normal text-muted-foreground">{subtitle}</span>
      </Button>
      <Reveal open={open} id={panelId}>
        <div className="overflow-x-auto">
          <div className="min-w-[64rem] overflow-hidden rounded-2xl border border-border bg-card">
            <ColumnHeads third={asked ? { first: "What was asked", label: "For" } : { first: "Product", label: "Stock" }} />
            <LinerList
              label={title}
              rows={rows}
              className="rounded-none border-0"
              empty={asked ? "Nothing asked for in words yet." : "No products on the S0."}
            />
          </div>
        </div>
      </Reveal>
    </section>
  );
}

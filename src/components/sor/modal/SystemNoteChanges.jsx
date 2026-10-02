import { useState } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Button } from "../../ui/button";
import { CATEGORY_META, CATEGORY_ORDER, splitNoteChanges } from "./systemNoteChangeParser";

function Chip({ children, theme = "mauve" }) {
  const styles = {
    green: "border-green-6 text-green-11 bg-green-a2",
    red: "border-red-6 text-red-11 bg-red-a2",
    blue: "border-blue-6 text-blue-11 bg-blue-a2",
    violet: "border-violet-6 text-violet-11 bg-violet-a2",
    mauve: "border-border text-foreground bg-card",
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${styles[theme]}`}>
      {children}
    </span>
  );
}

// A field change renders as LABEL  old → new, never the "changed from … to
// …" sentence — the arrow plus the chip styling is what signals this line
// was written by the system, not typed by a person.
function FieldChangeRow({ change }) {
  if (!change.label) {
    return <span className="text-sm text-muted-foreground italic break-words">· {change.raw}</span>;
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase">{change.label}</span>
      <Chip>{change.from}</Chip>
      <ArrowRight size={11} className="shrink-0 text-muted-foreground/60" />
      <Chip>{change.to}</Chip>
    </div>
  );
}

function categories(productCategories) {
  return CATEGORY_ORDER
    .map((key) => ({ key, ...CATEGORY_META[key], items: productCategories[key] }))
    .filter((c) => c.items.length > 0);
}

function itemLabel(cat, item) {
  return cat.key === "renamed" ? (
    <span className="inline-flex items-center gap-1">
      {item.from}
      <ArrowRight size={10} className="shrink-0 text-muted-foreground/60" />
      {item.name}
    </span>
  ) : (
    item.name
  );
}

function ProductCategoryLine({ cat }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        type="button"
        variant="ghost"
        onClick={() => setOpen((o) => !o)}
        className="h-auto gap-1.5 p-0 text-sm font-normal text-muted-foreground hover:bg-transparent"
      >
        <ChevronDown size={12} className={`shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        <span>
          <span className="font-semibold text-foreground">{cat.label}</span>{" "}
          {cat.items.length} product{cat.items.length !== 1 ? "s" : ""}
        </span>
      </Button>
      <div className="reveal pl-5" style={{ gridTemplateRows: open ? "1fr" : "0fr" }}>
        <div className="overflow-hidden">
          <div className="mt-1 flex flex-wrap gap-1 pb-0.5">
            {cat.items.map((item, i) => (
              <Chip key={i} theme={cat.theme}>
                {itemLabel(cat, item)}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a SYSTEM note's `metadata.changes` — field diffs as LABEL old → new
 * rows, product diffs as a disclosure line per category (Added/Removed/
 * Modified/Renamed). A bordered, muted-fill card distinguishes the whole
 * block as system-generated rather than a typed note.
 */
export default function SystemNoteChanges({ metadata }) {
  if (!metadata?.changes?.length) return null;
  const { fieldChanges, productCategories } = splitNoteChanges(metadata);
  const cats = categories(productCategories);

  return (
    <div className="mt-1 rounded-xl border border-border/70 bg-muted/40 p-2.5 space-y-1.5">
      {fieldChanges.map((change, idx) => (
        <FieldChangeRow key={idx} change={change} />
      ))}
      {cats.map((cat) => (
        <ProductCategoryLine key={cat.key} cat={cat} />
      ))}
    </div>
  );
}

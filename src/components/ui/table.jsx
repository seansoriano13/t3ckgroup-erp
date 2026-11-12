import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

import { useAuth } from "@/context/AuthContext";

const MIN_COL_WIDTH = 60;

// useAuth throws outside an AuthProvider; a primitive must still render there.
function useUserId() {
  try {
    return useAuth()?.user?.id ?? "anon";
  } catch {
    return "anon";
  }
}
const ColumnWidthsContext = React.createContext(null);

function readWidths(storageKey) {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    return stored && typeof stored === "object" ? stored : {};
  } catch {
    return {};
  }
}

function writeWidths(storageKey, widths) {
  try {
    if (Object.keys(widths).length)
      localStorage.setItem(storageKey, JSON.stringify(widths));
    else localStorage.removeItem(storageKey);
  } catch {
    /* ignore */
  }
}

// Styling set plus opt-in column resizing. Sorting, pagination and selection
// stay in feature code. The scroll wrapper lets wide tables overflow
// horizontally. Give the Table a `tableId` and a TableHead an `id` and that
// column is drag-resizable; widths are remembered per user, per table, in
// this browser only. The first drag freezes every identified column at its
// current width so only the dragged column moves.
//
// `resetAbove` puts the "Reset columns" button just above the table instead of
// over its header, and lets it fade out slowly so the pointer can reach it.
// The table's parents must not clip it (no overflow-hidden around the table).
//
// Density (#978): cells use px-3 py-2 from 768px to the end of the laptop band
// (ADR 0051) and px-4 py-3.5 elsewhere. Headings never wrap. `scrollCue` is on
// by default; while the table is wider than its frame the first column stays
// put as the rest scrolls sideways.
//
// `stackOnPhone` (opt-in): below 768px each row is a card, same DOM (CSS grid on
// the tr), so sorting, paging, selection and row clicks keep working. A column's
// place on the card is its `phone` prop on TableHead (or on a TableCell to
// override): "title" (top line), "badge" (top right), "select" (top left, for a
// checkbox; also the default for a column whose heading is empty), "meta"
// (default; "Label value" lines, the label from the cell's `label` prop or the
// matching heading, at most three, any further ones are dropped) or "hide".
// The heading row is not shown in card mode, so resize handles are gone too.
const CARD_TABLE =
  "max-md:block max-md:[&_thead]:hidden max-md:[&_tbody]:block " +
  "max-md:[&_tr]:grid max-md:[&_tr]:grid-cols-[auto_minmax(0,1fr)_auto] max-md:[&_tr]:px-3 max-md:[&_tr]:py-2.5 " +
  "max-md:[&_td]:min-w-0 max-md:[&_td]:p-0 max-md:[&_td]:whitespace-normal " +
  "max-md:[&_td[data-phone=title]]:col-start-2 max-md:[&_td[data-phone=title]]:row-start-1 max-md:[&_td[data-phone=title]]:truncate max-md:[&_td[data-phone=title]]:text-sm max-md:[&_td[data-phone=title]]:font-medium " +
  "max-md:[&_td[data-phone=badge]]:col-start-3 max-md:[&_td[data-phone=badge]]:row-start-1 max-md:[&_td[data-phone=badge]]:ml-2 max-md:[&_td[data-phone=badge]]:justify-self-end " +
  "max-md:[&_td[data-phone=select]]:col-start-1 max-md:[&_td[data-phone=select]]:row-start-1 max-md:[&_td[data-phone=select]]:mr-2 " +
  "max-md:[&_td[data-phone=meta]]:col-span-3 max-md:[&_td[data-phone=meta]]:flex max-md:[&_td[data-phone=meta]]:gap-1.5 max-md:[&_td[data-phone=meta]]:pt-0.5 max-md:[&_td[data-phone=meta]]:text-muted-foreground max-md:[&_td[data-phone=meta]]:before:shrink-0 max-md:[&_td[data-phone=meta]]:before:content-[attr(data-label)] max-md:[&_td[data-phone=meta]]:before:text-[11px] max-md:[&_td[data-phone=meta]]:before:font-semibold max-md:[&_td[data-phone=meta]]:before:uppercase max-md:[&_td[data-phone=meta]]:before:tracking-wider " +
  "max-md:[&_td[data-phone=hide]]:hidden";

const STICKY_FIRST =
  "md:[&_tr>:first-child]:sticky md:[&_tr>:first-child]:left-0 md:[&_tr>:first-child]:z-[1] md:[&_tbody_tr>:first-child]:bg-card md:[&_thead_tr>:first-child]:bg-muted";

const MAX_META = 3;

// Fills in each cell's card role and label from its column heading. A role or
// label set on the cell itself wins.
function placeCardCells(table) {
  const heads = Array.from(
    table.querySelectorAll("thead tr:last-child > th"),
  ).map((th) => ({
    phone:
      th.getAttribute("data-phone") ||
      (th.textContent.trim() ? "meta" : "select"),
    label: th.textContent.trim(),
  }));
  table.querySelectorAll("tbody > tr, tfoot > tr").forEach((tr) => {
    let metas = 0;
    Array.from(tr.children).forEach((td, i) => {
      const head = heads[i];
      if (!td.hasAttribute("data-label"))
        td.setAttribute("data-label", head?.label ?? "");
      let role = td.getAttribute("data-phone-set");
      if (!role) {
        role = td.getAttribute("data-phone") || head?.phone || "meta";
        td.setAttribute("data-phone-set", role);
      }
      if (role === "meta" && ++metas > MAX_META) role = "hide";
      td.setAttribute("data-phone", role);
    });
  });
}

function Table({
  className,
  tableId,
  style,
  scrollCue = true,
  resetAbove = false,
  stackOnPhone = false,
  ...props
}) {
  const userId = useUserId();
  const storageKey = tableId ? `erp_colwidths_${userId}_${tableId}` : null;
  const tableRef = React.useRef(null);
  const [widths, setWidths] = React.useState(() =>
    storageKey ? readWidths(storageKey) : {},
  );

  const commit = React.useCallback(
    (next) => {
      setWidths(next);
      if (storageKey) writeWidths(storageKey, next);
    },
    [storageKey],
  );

  const ctx = React.useMemo(() => {
    if (!tableId) return null;
    return {
      widths,
      // Called on drag start: pin every identified column at its rendered width.
      freeze: () => {
        const frozen = { ...widths };
        tableRef.current?.querySelectorAll("th[data-col-id]").forEach((th) => {
          const id = th.getAttribute("data-col-id");
          const rendered = Math.round(th.getBoundingClientRect().width);
          // A header hidden at this breakpoint measures 0; leave it unpinned.
          if (frozen[id] == null && rendered >= MIN_COL_WIDTH)
            frozen[id] = rendered;
        });
        setWidths(frozen);
        return frozen;
      },
      set: (id, width, base) =>
        setWidths({
          ...base,
          [id]: Math.max(MIN_COL_WIDTH, Math.round(width)),
        }),
      save: (next) => commit(next),
      // Back to the page's own widths. A single column cannot go back alone:
      // the rest stay pinned, so it would collapse to the leftover space.
      reset: () => commit({}),
    };
  }, [tableId, widths, commit]);

  const resized = Object.keys(widths).length > 0;

  // Opt-in: fade the edge that still has content off-screen. Nothing shows when the table fits.
  const containerRef = React.useRef(null);
  const [cue, setCue] = React.useState({ left: false, right: false });
  const [overflows, setOverflows] = React.useState(false);
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const update = () => {
      setOverflows(el.scrollWidth > el.clientWidth + 1);
      if (!scrollCue) return;
      const left = el.scrollLeft > 1;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      setCue((prev) =>
        prev.left === left && prev.right === right ? prev : { left, right },
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    let ro;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(update);
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, [scrollCue]);

  // Card mode: give every cell its role and label before paint, and again
  // whenever rows are added or swapped.
  React.useLayoutEffect(() => {
    const table = tableRef.current;
    if (!stackOnPhone || !table) return undefined;
    placeCardCells(table);
    if (typeof MutationObserver === "undefined") return undefined;
    const mo = new MutationObserver(() => {
      mo.disconnect();
      placeCardCells(table);
      mo.observe(table, { childList: true, subtree: true });
    });
    mo.observe(table, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [stackOnPhone]);

  const scroller = (
    <div
      ref={containerRef}
      data-slot="table-container"
      className="overflow-x-auto"
    >
      <table
        ref={tableRef}
        data-slot="table"
        className={cn(
          "w-full border-collapse text-left text-xs",
          overflows && STICKY_FIRST,
          stackOnPhone && CARD_TABLE,
          className,
        )}
        style={resized ? { tableLayout: "fixed", ...style } : style}
        {...props}
      />
    </div>
  );

  const body = scrollCue ? (
    <div className="relative">
      {scroller}
      {cue.left && (
        <div
          aria-hidden="true"
          data-slot="table-scroll-cue"
          data-edge="left"
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-card to-transparent"
        />
      )}
      {cue.right && (
        <div
          aria-hidden="true"
          data-slot="table-scroll-cue"
          data-edge="right"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-card to-transparent"
        />
      )}
    </div>
  ) : (
    scroller
  );

  return (
    <ColumnWidthsContext.Provider value={ctx}>
      {/* Stable wrapper so toggling `resized` never remounts the table mid-drag. */}
      <div className={resized ? "group/table relative" : undefined}>
        {body}
        {resized && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            data-slot="table-reset-widths"
            onClick={() => ctx.reset()}
            className={cn(
              "absolute right-2 z-10 bg-card text-[11px] text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/table:opacity-100 group-focus-within/table:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
              resetAbove
                ? "bottom-full mb-1.5 delay-700 duration-200 group-hover/table:delay-0 group-focus-within/table:delay-0 before:absolute before:inset-x-0 before:-bottom-2 before:h-2 before:content-['']"
                : "top-1",
            )}
          >
            Reset columns
          </Button>
        )}
      </div>
    </ColumnWidthsContext.Provider>
  );
}

function TableHeader({ className, ...props }) {
  return (
    <thead
      data-slot="table-header"
      className={cn(
        "bg-muted/50 [&_tr]:border-b [&_tr]:border-border [&_tr]:hover:bg-transparent",
        className,
      )}
      {...props}
    />
  );
}

function TableBody({ className, ...props }) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("divide-y divide-border", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }) {
  return (
    <tr
      data-slot="table-row"
      className={cn("transition-colors hover:bg-muted/40", className)}
      {...props}
    />
  );
}

const WIDE_TALL = "[@media(min-width:1536px)_and_(min-height:821px)]";
const CELL_PAD = `px-4 py-3.5 md:px-3 md:py-2 ${WIDE_TALL}:px-4 ${WIDE_TALL}:py-3.5`;

function TableHead({ className, id, style, children, phone, ...props }) {
  const ctx = React.useContext(ColumnWidthsContext);
  const resizable = Boolean(ctx && id);
  const width = resizable ? ctx.widths[id] : undefined;

  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const th = e.currentTarget.parentElement;
    const base = ctx.freeze();
    const startX = e.clientX;
    const startWidth = base[id] ?? th.getBoundingClientRect().width;
    let latest = base;
    const onMove = (ev) => {
      latest = {
        ...base,
        [id]: Math.max(
          MIN_COL_WIDTH,
          Math.round(startWidth + ev.clientX - startX),
        ),
      };
      ctx.set(id, startWidth + ev.clientX - startX, base);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      ctx.save(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <th
      data-slot="table-head"
      data-col-id={resizable ? id : undefined}
      data-phone={phone}
      className={cn(
        "select-none whitespace-nowrap",
        CELL_PAD,
        "text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
        resizable && "relative",
        className,
      )}
      style={width != null ? { width, ...style } : style}
      {...props}
    >
      {children}
      {resizable && (
        <span
          aria-hidden="true"
          data-slot="table-col-resizer"
          onPointerDown={startDrag}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => {
            e.stopPropagation();
            ctx.reset();
          }}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize touch-none hover:bg-foreground/20 pointer-coarse:w-6"
        />
      )}
    </th>
  );
}

// A header you can tap to sort by: a TableHead with a button and the same
// up/down arrows the Tasks tables use. `sort` and `onSort` come from
// useTableSort; `sortKey` names this column in its accessors.
function SortHead({ sortKey, sort, onSort, children, className, ...props }) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <TableHead
      aria-sort={
        active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"
      }
      className={cn("hover:text-foreground transition-colors", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-[inherit] font-[inherit]"
      >
        {children}
        <Icon
          size={12}
          className={cn("shrink-0", active ? "text-foreground" : "opacity-40")}
        />
      </button>
    </TableHead>
  );
}

function TableCell({ className, phone, label, ...props }) {
  return (
    <td
      data-slot="table-cell"
      data-phone={phone}
      data-label={label}
      className={cn(CELL_PAD, "align-middle", className)}
      {...props}
    />
  );
}

export {
  SortHead,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
};

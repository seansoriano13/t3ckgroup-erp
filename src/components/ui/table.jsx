import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

import { cn } from "@/lib/utils";

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
    if (Object.keys(widths).length) localStorage.setItem(storageKey, JSON.stringify(widths));
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
function Table({ className, tableId, style, ...props }) {
  const userId = useUserId();
  const storageKey = tableId ? `erp_colwidths_${userId}_${tableId}` : null;
  const tableRef = React.useRef(null);
  const [widths, setWidths] = React.useState(() => (storageKey ? readWidths(storageKey) : {}));

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
          if (frozen[id] == null && rendered >= MIN_COL_WIDTH) frozen[id] = rendered;
        });
        setWidths(frozen);
        return frozen;
      },
      set: (id, width, base) => setWidths({ ...base, [id]: Math.max(MIN_COL_WIDTH, Math.round(width)) }),
      save: (next) => commit(next),
      // Back to the page's own widths. A single column cannot go back alone:
      // the rest stay pinned, so it would collapse to the leftover space.
      reset: () => commit({}),
    };
  }, [tableId, widths, commit]);

  const resized = Object.keys(widths).length > 0;

  return (
    <ColumnWidthsContext.Provider value={ctx}>
      {resized && (
        <div className="flex justify-end px-3 pt-2">
          <button
            type="button"
            data-slot="table-reset-widths"
            onClick={() => ctx.reset()}
            className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Reset columns
          </button>
        </div>
      )}
      <div data-slot="table-container" className="overflow-x-auto">
        <table
          ref={tableRef}
          data-slot="table"
          className={cn("w-full border-collapse text-left text-xs", className)}
          style={resized ? { tableLayout: "fixed", ...style } : style}
          {...props}
        />
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

function TableHead({ className, id, style, children, ...props }) {
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
      latest = { ...base, [id]: Math.max(MIN_COL_WIDTH, Math.round(startWidth + ev.clientX - startX)) };
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
      className={cn(
        "select-none px-4 py-3.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground",
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
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("hover:text-foreground transition-colors", className)}
      {...props}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex items-center gap-1 uppercase tracking-[inherit] font-[inherit]"
      >
        {children}
        <Icon size={12} className={cn("shrink-0", active ? "text-foreground" : "opacity-40")} />
      </button>
    </TableHead>
  );
}

function TableCell({ className, ...props }) {
  return (
    <td
      data-slot="table-cell"
      className={cn("px-4 py-3.5 align-middle", className)}
      {...props}
    />
  );
}

export { SortHead, Table, TableBody, TableCell, TableHead, TableHeader, TableRow };

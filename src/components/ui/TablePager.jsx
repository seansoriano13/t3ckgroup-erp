import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/SelectField";

const PAGE_SIZES = [10, 25, 50];

/**
 * Footer pager for a list: "Showing X to Y of N <noun>", a rows-per-page
 * select and Prev / Next. Drive it with `usePaging`: <TablePager {...paging} noun="tasks" />.
 * `children` renders at the far end of the bar (e.g. keyboard hints).
 */
export function TablePager({ total, page, pageSize, totalPages, setPage, setPageSize, noun = "rows", children, className = "" }) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground ${className}`}>
      <div className="flex items-center gap-3">
        <span>
          Showing <span className="font-semibold text-foreground">{first}</span> to <span className="font-semibold text-foreground">{last}</span> of{" "}
          <span className="font-semibold text-foreground">{total}</span> {noun}
        </span>
        <span className="text-border">|</span>
        <div className="flex items-center gap-1.5">
          <span>Rows:</span>
          <SelectField
            value={pageSize}
            onChange={(next) => setPageSize(Number(next))}
            options={PAGE_SIZES.map((n) => ({ value: n, label: String(n) }))}
            size="sm"
            aria-label="Rows per page"
          />
        </div>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1.5">
          <Button variant="outline" size="icon-sm" disabled={page === 1} onClick={() => setPage(page - 1)} title="Previous Page" aria-label="Previous page">
            <ChevronLeft size={14} />
          </Button>
          <span className="px-2 text-xs font-semibold text-foreground">
            Page {page} of {totalPages}
          </span>
          <Button variant="outline" size="icon-sm" disabled={page === totalPages} onClick={() => setPage(page + 1)} title="Next Page" aria-label="Next page">
            <ChevronRight size={14} />
          </Button>
        </div>
      )}
      {children}
    </div>
  );
}

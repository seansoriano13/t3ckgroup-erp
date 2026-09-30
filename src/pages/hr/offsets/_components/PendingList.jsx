import { useMemo, useState } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide, CheckCircle2, ChevronRight, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Spinner from '@/components/ui/Spinner';
import Avatar from '../../../../components/Avatar';
import { EmptyState, LeaveFilters, StatusPill } from './LeaveParts';
import { LABEL, TYPE_META, fmtRange, hoursOf, recordKey, relTime, windowOf } from './leaveDisplay';

const COLS = 'grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.1fr)_minmax(0,1fr)_80px]';
const PAGE_SIZES = [20, 100, 500];

/**
 * The pending queue as one roomy table. A row opens the request's own page;
 * decisions are made there, never from the row.
 */
export default function PendingList({ rows, total, loading, availableHoursFor, filters, companies, onOpen }) {
  const [pageSize, setPageSize] = useState(20);
  const [asc, setAsc] = useState(true);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (asc ? 1 : -1) * (new Date(a.date) - new Date(b.date))),
    [rows, asc],
  );
  const shown = sorted.slice(0, pageSize);

  return (
    <div className="flex flex-col gap-5">
      <LeaveFilters
        filters={filters}
        companies={companies}
        mode="pending"
        right={
          <Button type="button" variant="outline" onClick={() => setAsc((v) => !v)} className="h-10 gap-2 px-4 font-semibold">
            {asc ? <ArrowUpNarrowWide /> : <ArrowDownWideNarrow />}
            {asc ? 'Soonest first' : 'Latest first'}
          </Button>
        }
      />

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <div className="min-w-[720px]">
            <div className={`grid ${COLS} h-12 items-center gap-5 border-b border-border bg-muted/40 px-6`}>
              <span className={LABEL}>Employee</span>
              <span className={LABEL}>Type</span>
              <span className={LABEL}>Date</span>
              <span className={`${LABEL} text-right`}>Hours</span>
              <span className={LABEL}>Status</span>
              <span className={`${LABEL} text-right`}>Filed</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center gap-3 py-20 text-muted-foreground">
                <Spinner size="sm" />
                <span className="text-sm font-medium">Loading pending requests…</span>
              </div>
            ) : shown.length === 0 ? (
              <EmptyState icon={CheckCircle2} title="Nothing waiting on HR">
                {total > 0
                  ? 'Filters hide every request. Clear one in the sidebar or the chips above.'
                  : 'Requests land here once a department head approves them.'}
              </EmptyState>
            ) : (
              <div className="divide-y divide-border">
                {shown.map((r) => {
                  const h = hoursOf(r);
                  const available = availableHoursFor(r);
                  const sub = r.dayCount > 1 ? `${r.dayCount} days` : windowOf(r);
                  return (
                    <div
                      key={recordKey(r)}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${r.employee?.name}'s ${TYPE_META[r.type].label} request`}
                      onClick={() => onOpen(r, sorted)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(r, sorted))}
                      className={`group grid ${COLS} min-h-[68px] cursor-pointer items-center gap-5 px-6 py-3 text-sm outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40`}
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-foreground">{r.employee?.name}</span>
                          <span className="block truncate text-xs font-medium text-muted-foreground">{r.employee?.department}</span>
                        </span>
                      </span>
                      <span className="flex items-center gap-2 truncate font-medium text-foreground">
                        <span className={`size-2 shrink-0 rounded-full ${TYPE_META[r.type].dot}`} />
                        {TYPE_META[r.type].label}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-foreground">{fmtRange(r, true)}</span>
                        {sub && <span className="block truncate text-xs font-medium text-muted-foreground">{sub}</span>}
                      </span>
                      <span className="text-right">
                        <span className="block font-mono tabular-nums text-foreground">{h.requested} hrs</span>
                        {/* Balance minus every pending application, not the raw balance (#106). */}
                        {available !== null && (
                          <span className={`block text-xs font-semibold ${available < 0 ? 'text-red-11' : 'text-muted-foreground'}`}>
                            {available} hrs available
                          </span>
                        )}
                      </span>
                      <span><StatusPill record={r} /></span>
                      <span className="flex items-center justify-end gap-2 font-mono text-xs text-muted-foreground">
                        {r.attachments?.length > 0 && (
                          <span className="flex items-center gap-0.5" title={`${r.attachments.length} attachment(s)`}>
                            <Paperclip size={12} />{r.attachments.length}
                          </span>
                        )}
                        {relTime(r.created_at)}
                        <ChevronRight size={15} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {rows.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex rounded-xl border border-border bg-card p-1" role="group" aria-label="Rows per page">
            {PAGE_SIZES.map((n) => (
              <Button
                key={n}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={pageSize === n}
                onClick={() => setPageSize(n)}
                className={`px-3 font-mono tabular-nums ${pageSize === n ? 'bg-muted font-bold text-foreground' : 'text-muted-foreground'}`}
              >
                {n}
              </Button>
            ))}
          </div>
          <span className="text-xs font-semibold text-muted-foreground">
            {shown.length} of {rows.length}
            {rows.length < total ? ` · filtered from ${total}` : ''}
          </span>
        </div>
      )}
    </div>
  );
}

import PageLoading from "@/components/ui/PageLoading";
import { useMemo, useState } from 'react';
import { pluralize } from "@/utils/plural";
import { CheckCircle2, ChevronRight, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import Avatar from '../../../../components/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import { StatusPill } from './LeaveParts';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LABEL, TYPE_META, fmtRange, hoursOf, recordKey, relTime, windowOf } from './leaveDisplay';

const PAGE_SIZES = [20, 100, 500];

/**
 * The pending queue as one roomy table. A row opens the request's own page;
 * decisions are made there, never from the row.
 */
export default function PendingList({ rows, total, loading, availableHoursFor, asc, onOpen }) {
  const [pageSize, setPageSize] = useState(20);
  const sorted = useMemo(
    () => [...rows].sort((a, b) => (asc ? 1 : -1) * (new Date(a.date) - new Date(b.date))),
    [rows, asc],
  );
  const shown = sorted.slice(0, pageSize);

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {loading ? (
          <PageLoading label="pending requests" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="Nothing waiting on HR"
            description={
              total > 0
                ? 'Filters hide every request. Clear one above.'
                : 'Requests land here once a department head approves them.'
            }
          />
        ) : (
          <Table stackOnPhone tableId="hr-pending" className="md:min-w-[720px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead id="employee" phone="title" className={LABEL}>Employee</TableHead>
                <TableHead id="type" phone="meta" className={LABEL}>Type</TableHead>
                <TableHead id="date" phone="meta" className={LABEL}>Date</TableHead>
                <TableHead id="hours" phone="meta" className={`${LABEL} md:text-right`}>Hours</TableHead>
                <TableHead id="status" phone="badge" className={LABEL}>Status</TableHead>
                <TableHead id="filed" phone="hide" className={`${LABEL} text-right`}>Filed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((r) => {
                const h = hoursOf(r);
                const available = availableHoursFor(r);
                const sub = r.dayCount > 1 ? `${r.dayCount} days` : windowOf(r);
                return (
                  <TableRow
                    key={recordKey(r)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${r.employee?.name}'s ${TYPE_META[r.type].label} request`}
                    onClick={() => onOpen(r, sorted)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(r, sorted))}
                    className="group cursor-pointer outline-none focus-visible:bg-muted/40"
                  >
                    <TableCell>
                      <span className="flex min-w-0 items-center gap-3">
                        <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="sm" />
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-foreground">{r.employee?.name}</span>
                          <span className="block truncate text-xs font-medium text-muted-foreground max-md:hidden">{r.employee?.department}</span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2 truncate font-medium text-foreground">
                        <span className={`size-2 shrink-0 rounded-full ${TYPE_META[r.type].dot}`} />
                        {TYPE_META[r.type].label}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="block truncate font-semibold text-foreground">{fmtRange(r, true)}</span>
                      {sub && <span className="block truncate text-xs font-medium text-muted-foreground max-md:hidden">{sub}</span>}
                    </TableCell>
                    <TableCell className="md:text-right">
                      <span className="block font-mono tabular-nums text-foreground">{h.requested} hrs</span>
                      {/* Balance minus every pending application, not the raw balance (#106). */}
                      {available !== null && (
                        <span className={`block text-xs font-semibold max-md:hidden ${available < 0 ? 'text-red-11' : 'text-muted-foreground'}`}>
                          {available} hrs available
                        </span>
                      )}
                    </TableCell>
                    <TableCell><StatusPill record={r} /></TableCell>
                    <TableCell>
                      <span className="flex items-center justify-end gap-2 font-mono text-xs text-muted-foreground">
                        {r.attachments?.length > 0 && (
                          <span className="flex items-center gap-0.5" title={pluralize(r.attachments.length, "attachment")}>
                            <Paperclip size={12} />{r.attachments.length}
                          </span>
                        )}
                        {relTime(r.created_at)}
                        <ChevronRight size={15} className="opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
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

import PageLoading from "@/components/ui/PageLoading";
import { useMemo } from 'react';
import { CheckCircle2, ChevronRight, History, XCircle } from 'lucide-react';
import Avatar from '../../../../components/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import { StatusPill } from './LeaveParts';
import { TYPE_META, fmtDay, fmtRange, hoursOf, recordKey } from './leaveDisplay';

/** Decisions this period, grouped by the day they were made. Read-only; a row opens the record. */
export default function HistoryView({ rows, loading, onOpen }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')), [rows]);
  const days = useMemo(() => {
    const m = new Map();
    sorted.forEach((r) => {
      const k = (r.updated_at || '').slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    });
    return [...m.entries()];
  }, [sorted]);

  return (
    <div className="flex flex-col gap-8">
      {loading ? (
        <PageLoading label="history" />
      ) : days.length === 0 ? (
        <EmptyState icon={History} title="No decisions this period" description="Pick another month with the month picker." />
      ) : (
        days.map(([day, dayRows]) => (
          <section key={day} className="grid grid-cols-1 gap-4 md:grid-cols-[180px_minmax(0,1fr)]">
            <div className="md:pt-5">
              {/* Some legacy rows carry no updated_at; they group together at the end. */}
              <p className="text-base font-black text-foreground">{day ? fmtDay(day, { weekday: 'long' }) : 'Date not recorded'}</p>
              {day && <p className="text-sm font-medium text-muted-foreground">{fmtDay(day, { month: 'long', day: 'numeric' })}</p>}
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
              {dayRows.map((r) => {
                const h = hoursOf(r);
                return (
                  <li key={recordKey(r)}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${r.employee?.name}'s ${TYPE_META[r.type].label} decision`}
                      onClick={() => onOpen(r, sorted)}
                      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(r, sorted))}
                      className="group flex cursor-pointer items-center gap-4 px-6 py-4 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
                    >
                      {r.status === 'REJECTED'
                        ? <XCircle size={20} className="shrink-0 text-red-9" />
                        : <CheckCircle2 size={20} className="shrink-0 text-green-9" />}
                      <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-bold text-foreground">{r.employee?.name}</p>
                        <p className="truncate text-xs font-medium text-muted-foreground">
                          {h.changed ? <><s>{h.requested}</s> {h.granted}</> : h.granted} hrs {TYPE_META[r.type].label} · {fmtRange(r, true)}
                        </p>
                      </div>
                      <StatusPill record={r} />
                      <ChevronRight size={16} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

import { CalendarRange } from 'lucide-react';
import Avatar from '../../../../components/Avatar';
import { EmptyState } from './LeaveParts';
import { LABEL, TYPE_META, fmtDay, todayIso } from './leaveDisplay';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/**
 * People by days for the picked month: approved Offset/SIL as solid bars,
 * pending ones dashed, so overlaps and thin days show at a glance.
 */
export default function TeamTimeline({ approvedLeaves, pendingLeaves, monthStart }) {
  const start = new Date(monthStart);
  const y = start.getFullYear();
  const m = start.getMonth();
  const nDays = new Date(y, m + 1, 0).getDate();
  const days = Array.from({ length: nDays }, (_, i) => new Date(y, m, i + 1));
  const today = todayIso();

  const byEmp = new Map();
  const put = (r, day, state) => {
    if (!byEmp.has(r.employee_id)) byEmp.set(r.employee_id, { emp: r.employee, id: r.employee_id, cells: {} });
    byEmp.get(r.employee_id).cells[day] = { type: r.type, state };
  };
  approvedLeaves.forEach((r) => put(r, (r.date || '').slice(0, 10), 'approved'));
  pendingLeaves
    .filter((r) => r.type === 'OFFSET' || r.type === 'SIL')
    .forEach((r) => (r.dates || [r.date]).forEach((d) => {
      const day = (d || '').slice(0, 10);
      const dt = new Date(day);
      if (dt.getFullYear() === y && dt.getMonth() === m) put(r, day, 'pending');
    }));
  const people = [...byEmp.values()].sort((a, b) => (a.emp?.name || '').localeCompare(b.emp?.name || ''));
  const outToday = people.filter((p) => p.cells[today]?.state === 'approved').length;
  const gridCols = { gridTemplateColumns: `240px repeat(${nDays}, minmax(30px, 1fr))` };

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-4 border-b border-border px-6 py-4">
        <h3 className="text-base font-black text-foreground">{fmtDay(start, { month: 'long', year: 'numeric' })}</h3>
        <span className="text-sm font-medium text-muted-foreground">
          <b className="font-bold text-foreground">{people.length}</b> with time off · <b className="font-bold text-foreground">{outToday}</b> out today
        </span>
        <span className="flex-1" />
        <div className="flex items-center gap-4 text-xs font-semibold text-muted-foreground">
          <span className="flex items-center gap-2"><span className={`h-3 w-5 rounded ${TYPE_META.OFFSET.bar}`} />Offset</span>
          <span className="flex items-center gap-2"><span className={`h-3 w-5 rounded ${TYPE_META.SIL.bar}`} />SIL</span>
          <span className="flex items-center gap-2"><span className="h-3 w-5 rounded border border-dashed border-mauve-9" />Pending</span>
        </div>
      </div>

      {people.length === 0 ? (
        <EmptyState icon={CalendarRange} title="No time off this month">Approved and pending Offset and SIL show here as bars.</EmptyState>
      ) : (
        <div className="custom-scrollbar overflow-x-auto">
          <div className="min-w-[1100px]">
            <div className="grid border-b border-border" style={gridCols}>
              <span className={`${LABEL} sticky left-0 z-[1] flex items-center bg-card px-6`}>Employee</span>
              {days.map((d) => (
                <span key={d.getDate()} className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${isWeekend(d) ? 'bg-muted/60' : ''}`}>
                  <span className="font-semibold text-muted-foreground">{'SMTWTFS'[d.getDay()]}</span>
                  <span className={`flex size-6 items-center justify-center rounded-full font-mono tabular-nums ${iso(d) === today ? 'bg-mauve-12 font-bold text-mauve-1' : 'text-foreground'}`}>
                    {d.getDate()}
                  </span>
                </span>
              ))}
            </div>
            {people.map((p) => (
              <div key={p.id} className="grid items-center border-b border-border/60 last:border-b-0 hover:bg-muted/30" style={gridCols}>
                <span className="sticky left-0 z-[1] flex min-w-0 items-center gap-3 bg-card px-6 py-3">
                  <Avatar name={p.emp?.name} src={p.emp?.avatar_path} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-foreground">{p.emp?.name}</span>
                    <span className="block truncate text-xs font-medium text-muted-foreground">{p.emp?.department}</span>
                  </span>
                </span>
                {days.map((d, i) => {
                  const k = iso(d);
                  const c = p.cells[k];
                  const prev = i > 0 && p.cells[iso(days[i - 1])];
                  const next = i < nDays - 1 && p.cells[iso(days[i + 1])];
                  const same = (o) => o && c && o.type === c.type && o.state === c.state;
                  return (
                    <span key={k} className={`flex h-16 items-center ${isWeekend(d) ? 'bg-muted/60' : ''} ${k === today ? 'bg-mauve-3' : ''}`}>
                      {c && (
                        <span
                          title={`${p.emp?.name} · ${TYPE_META[c.type].label} · ${c.state} · ${fmtDay(k, { weekday: 'short', month: 'short', day: 'numeric' })}`}
                          className={`relative block h-8 w-full ${same(prev) ? '' : 'ml-1 rounded-l-lg'} ${same(next) ? '' : 'mr-1 rounded-r-lg'} ${c.state === 'pending' ? 'border border-dashed border-mauve-9' : TYPE_META[c.type].bar}`}
                        >
                          <span className="sr-only">{`${TYPE_META[c.type].label}, ${c.state}`}</span>
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

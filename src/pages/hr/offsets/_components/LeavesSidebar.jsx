import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import Avatar from '../../../../components/Avatar';
import { LABEL, LEAVE_TYPES, LEAVE_VIEWS, TYPE_META, useWhoIsOut } from './leaveDisplay';

/**
 * The Leaves Manager's view switcher. It sits flush on the panel's left edge
 * (the page is full-bleed) so the views never eat into the content padding.
 * Pending and History also get live type/company counts that double as
 * filters, and the foot of the rail says who is out today and tomorrow.
 * Below `lg` it collapses to a horizontal strip with just the views.
 */
export default function LeavesSidebar({ activeTab, onChange, pendingLeaves, processedLeaves, approvedLeaves, filters, companies }) {
  const source = activeTab === 'history' ? processedLeaves : pendingLeaves;
  const showGroups = activeTab === 'pending' || activeTab === 'history';
  const out = useWhoIsOut(approvedLeaves);

  const byType = useMemo(() => {
    const m = {};
    source.forEach((r) => { m[r.type] = (m[r.type] || 0) + 1; });
    return m;
  }, [source]);

  const byCompany = useMemo(() => {
    const m = new Map();
    source.forEach((r) => {
      const id = r.company_id || 'NONE';
      const name = r.company?.name || companies.find((c) => c.id === r.company_id)?.name || 'No company set';
      m.set(id, { id, name, n: (m.get(id)?.n || 0) + 1 });
    });
    return [...m.values()].sort((a, b) => b.n - a.n).slice(0, 6);
  }, [source, companies]);

  return (
    <aside className="flex shrink-0 flex-col gap-8 border-b border-border bg-card px-4 py-3 lg:w-64 lg:overflow-y-auto lg:border-b-0 lg:border-r lg:py-10 custom-scrollbar">
      <div className="flex flex-col gap-1">
        <p className={`${LABEL} mb-2 hidden px-3 lg:block`}>Leaves Manager</p>
        <div role="tablist" aria-label="Leaves Manager views" aria-orientation="vertical" className="flex gap-1 overflow-x-auto lg:flex-col">
          {LEAVE_VIEWS.map(({ value, label, icon: Icon }) => {
            const on = activeTab === value;
            return (
              <Button
                key={value}
                type="button"
                variant="ghost"
                role="tab"
                aria-selected={on}
                onClick={() => onChange(value)}
                className={`h-10 shrink-0 justify-start gap-3 rounded-xl px-3 text-[13px] ${on ? 'bg-muted font-bold text-foreground' : 'font-semibold text-muted-foreground hover:text-foreground'}`}
              >
                <Icon size={16} />
                <span className="flex-1 text-left">{label}</span>
                {value === 'pending' && pendingLeaves.length > 0 && (
                  <span className="rounded-full bg-mauve-12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-mauve-1">{pendingLeaves.length}</span>
                )}
              </Button>
            );
          })}
        </div>
      </div>

      {showGroups && (
        <div className="hidden flex-col gap-8 lg:flex">
          <GroupCounts
            title="Type"
            active={filters.leaveTypeFilter}
            onPick={(v) => filters.setLeaveTypeFilter(filters.leaveTypeFilter === v ? 'ALL' : v)}
            items={LEAVE_TYPES.map((t) => ({ id: t, name: TYPE_META[t].label, n: byType[t] || 0, dot: TYPE_META[t].dot }))}
          />
          <GroupCounts
            title="Company"
            active={filters.companyFilter}
            onPick={(v) => filters.setCompanyFilter(filters.companyFilter === v ? 'ALL' : v)}
            items={byCompany}
          />
        </div>
      )}

      <div className="mt-auto hidden flex-col gap-5 border-t border-border pt-6 lg:flex">
        <OutList label="Out today" rows={out.today} empty="Everyone's in." />
        <OutList label="Out tomorrow" rows={out.tomorrow} empty="No one." />
      </div>
    </aside>
  );
}

function GroupCounts({ title, items, active, onPick }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className={`${LABEL} mb-2 px-3`}>{title}</p>
      {items.map((it) => (
        <Button
          key={it.id}
          type="button"
          variant="ghost"
          onClick={() => onPick(it.id)}
          aria-pressed={active === it.id}
          className={`h-9 justify-start gap-2.5 rounded-xl px-3 text-[13px] ${active === it.id ? 'bg-muted font-bold text-foreground' : 'font-medium text-muted-foreground'}`}
        >
          {it.dot && <span className={`size-2 rounded-full ${it.dot}`} />}
          <span className="flex-1 truncate text-left">{it.name}</span>
          <span className="font-mono text-xs tabular-nums">{it.n}</span>
        </Button>
      ))}
    </div>
  );
}

function OutList({ label, rows, empty }) {
  return (
    <div className="px-3">
      <p className={`${LABEL} mb-3`}>{label}</p>
      {rows.length === 0 ? (
        <p className="text-xs font-medium text-muted-foreground">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((r) => (
            <li key={`${r.employee_id}_${r.type}`} className="flex items-center gap-2.5">
              <Avatar name={r.employee?.name} src={r.employee?.avatar_path} size="xs" />
              <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">{r.employee?.name}</span>
              <span className={`size-2 shrink-0 rounded-full ${TYPE_META[r.type].dot}`} title={TYPE_META[r.type].label} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

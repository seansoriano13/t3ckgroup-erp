import { useState } from 'react';
import { ArrowDown, ArrowUp, ChevronRight, ChevronsUpDown, Scale } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/SelectField';
import Avatar from '../../../../components/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import { TYPE_META, num, usePendingByEmployee } from './leaveDisplay';

const COLS = 'grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_90px_120px_16px]';
const GROUP_KEY = {
  none: () => '',
  company: (e) => e.company?.name || 'No company set',
  department: (e) => e.department || 'No department',
};

/** Every employee's balances at a glance; a row opens that person's Time Off profile. */
export default function BalancesTable({ employees, pendingLeaves, onOpenPerson }) {
  const pendingMap = usePendingByEmployee(pendingLeaves);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [group, setGroup] = useState('none');

  const held = (e) => (pendingMap.get(`${e.id}_OFFSET`) || 0) + (pendingMap.get(`${e.id}_SIL`) || 0);
  const get = {
    name: (e) => e.name,
    company: (e) => e.company?.name || '',
    offset: (e) => num(e.offset_hours_balance),
    sil: (e) => num(e.sil_hours_balance),
    held,
    ut: (e) => num(e.undertime_this_month),
  };

  const sorted = [...employees].sort((a, b) => {
    const x = get[sort.key](a);
    const y = get[sort.key](b);
    return sort.dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
  });
  const groups = [];
  sorted.forEach((e) => {
    const k = GROUP_KEY[group](e);
    const g = groups.find((x) => x[0] === k);
    if (g) g[1].push(e);
    else groups.push([k, [e]]);
  });
  const maxOffset = Math.max(1, ...employees.map(get.offset));
  const maxSil = Math.max(1, ...employees.map(get.sil));
  const owed = Math.round(employees.reduce((s, e) => s + get.offset(e), 0) * 100) / 100;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted-foreground">
          <b className="font-bold text-foreground">{employees.length}</b> employees · <b className="font-bold tabular-nums text-foreground">{owed}</b> Offset hrs owed
        </span>
        <SelectField
          size="sm"
          className="h-9"
          value={group}
          aria-label="Group by"
          onChange={setGroup}
          options={[{ value: 'none', label: 'No grouping' }, { value: 'company', label: 'Group: Company' }, { value: 'department', label: 'Group: Department' }]}
        />
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div className={`grid ${COLS} h-12 items-center gap-6 border-b border-border bg-muted/40 px-6`}>
              <SortHead label="Employee" k="name" sort={sort} setSort={setSort} />
              <SortHead label="Company" k="company" sort={sort} setSort={setSort} />
              <SortHead label="Offset hrs" k="offset" sort={sort} setSort={setSort} />
              <SortHead label="SIL hrs" k="sil" sort={sort} setSort={setSort} />
              <SortHead label="Pending" k="held" sort={sort} setSort={setSort} right />
              <SortHead label="Undertime (mo)" k="ut" sort={sort} setSort={setSort} right />
              <span />
            </div>
            {groups.map(([label, rows]) => (
              <div key={label || 'all'}>
                {group !== 'none' && (
                  <div className="flex h-10 items-center gap-3 border-b border-border bg-muted/60 px-6 text-sm">
                    <span className="font-bold text-foreground">{label}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{rows.length}</span>
                  </div>
                )}
                {rows.map((e) => (
                  <div
                    key={e.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${e.name}'s time off`}
                    onClick={() => onOpenPerson(e.id)}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpenPerson(e.id))}
                    className={`group grid ${COLS} h-[68px] cursor-pointer items-center gap-6 border-b border-border/70 px-6 text-sm outline-none transition-colors last:border-b-0 hover:bg-muted/40 focus-visible:bg-muted/40`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <Avatar name={e.name} src={e.avatar_path} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-foreground">{e.name}</span>
                        <span className="block truncate text-xs font-medium text-muted-foreground">{e.department || 'No department'}</span>
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {e.company?.name || <span className="font-semibold text-amber-11">No company set</span>}
                    </span>
                    <Bar value={get.offset(e)} max={maxOffset} tone={TYPE_META.OFFSET.solid} />
                    <Bar value={get.sil(e)} max={maxSil} tone={TYPE_META.SIL.solid} />
                    <span className={`text-right font-mono tabular-nums ${held(e) ? 'text-foreground' : 'text-muted-foreground'}`}>{held(e) || '—'}</span>
                    {/* Derived from approved undertime this month; never a stored balance (#148). */}
                    <span className="text-right font-mono tabular-nums text-muted-foreground">{get.ut(e) || '—'}</span>
                    <ChevronRight size={16} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
                  </div>
                ))}
              </div>
            ))}
            {employees.length === 0 && <EmptyState icon={Scale} title="No employees match" description="Clear the search or company filter." />}
          </div>
        </div>
      </div>
    </div>
  );
}

function SortHead({ label, k, right, sort, setSort }) {
  const on = sort.key === k;
  return (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}
      aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}
      className={`-mx-2 gap-1 text-[10px] font-bold uppercase tracking-wider ${right ? 'justify-end' : 'justify-start'} ${on ? 'text-foreground' : 'text-muted-foreground'}`}
    >
      {label}
      {on ? (sort.dir > 0 ? <ArrowUp /> : <ArrowDown />) : <ChevronsUpDown className="opacity-40" />}
    </Button>
  );
}

function Bar({ value, max, tone }) {
  return (
    <span className="flex items-center gap-3">
      <span className="w-12 text-right font-mono tabular-nums text-foreground">{value}</span>
      <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className={`block h-full rounded-full ${tone}`} style={{ width: `${(value / max) * 100}%` }} />
      </span>
    </span>
  );
}

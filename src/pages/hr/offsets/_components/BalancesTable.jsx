import { Fragment, useState } from 'react';
import { ChevronRight, Scale } from 'lucide-react';
import { SortHead, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SelectField } from '@/components/ui/SelectField';
import Avatar from '../../../../components/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import { TYPE_META, num, usePendingByEmployee } from './leaveDisplay';

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
    lwop: (e) => num(e.lwop_this_month),
  };

  const sorted = [...employees].sort((a, b) => {
    const x = get[sort.key](a);
    const y = get[sort.key](b);
    return sort.dir * (typeof x === 'string' ? x.localeCompare(y) : x - y);
  });
  const tableSort = { key: sort.key, dir: sort.dir > 0 ? 'asc' : 'desc' };
  const toggleSort = (k) => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }));
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
        {employees.length === 0 ? (
          <EmptyState icon={Scale} title="No employees match" description="Clear the search or company filter." />
        ) : (
          <Table stackOnPhone tableId="hr-balances" className="md:min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortHead id="name" phone="title" sortKey="name" sort={tableSort} onSort={toggleSort}>Employee</SortHead>
                <SortHead id="company" phone="meta" sortKey="company" sort={tableSort} onSort={toggleSort}>Company</SortHead>
                <SortHead id="offset" phone="meta" sortKey="offset" sort={tableSort} onSort={toggleSort}>Offset hrs</SortHead>
                <SortHead id="sil" phone="meta" sortKey="sil" sort={tableSort} onSort={toggleSort}>SIL hrs</SortHead>
                <SortHead id="held" phone="meta" sortKey="held" sort={tableSort} onSort={toggleSort} className="text-right">Pending</SortHead>
                <SortHead id="ut" phone="hide" sortKey="ut" sort={tableSort} onSort={toggleSort} className="text-right">Undertime (mo)</SortHead>
                <SortHead id="lwop" phone="meta" sortKey="lwop" sort={tableSort} onSort={toggleSort} className="text-right">LWOP this month</SortHead>
                <TableHead id="open" phone="hide" className="w-6"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map(([label, rows]) => (
                <Fragment key={label || 'all'}>
                  {group !== 'none' && (
                    <TableRow className="bg-muted/60 hover:bg-muted/60">
                      <TableCell colSpan={8} phone="title" className="text-sm">
                        <span className="font-bold text-foreground">{label}</span>
                        <span className="ml-3 font-mono text-xs tabular-nums text-muted-foreground">{rows.length}</span>
                      </TableCell>
                    </TableRow>
                  )}
                  {rows.map((e) => (
                    <TableRow
                      key={e.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`Open ${e.name}'s time off`}
                      onClick={() => onOpenPerson(e.id)}
                      onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), onOpenPerson(e.id))}
                      className="group cursor-pointer outline-none focus-visible:bg-muted/40"
                    >
                      <TableCell>
                        <span className="flex min-w-0 items-center gap-3">
                          <Avatar name={e.name} src={e.avatar_path} size="sm" />
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-foreground">{e.name}</span>
                            <span className="block truncate text-xs font-medium text-muted-foreground max-md:hidden">{e.department || 'No department'}</span>
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {e.company?.name || <span className="font-semibold text-amber-11">No company set</span>}
                      </TableCell>
                      <TableCell><Bar value={get.offset(e)} max={maxOffset} tone={TYPE_META.OFFSET.solid} /></TableCell>
                      <TableCell><Bar value={get.sil(e)} max={maxSil} tone={TYPE_META.SIL.solid} /></TableCell>
                      <TableCell className={`font-mono tabular-nums md:text-right ${held(e) ? 'text-foreground' : 'text-muted-foreground'}`}>{held(e) || '—'}</TableCell>
                      {/* Derived from approved undertime this month; never a stored balance (#148). */}
                      <TableCell className="font-mono tabular-nums text-muted-foreground md:text-right">{get.ut(e) || '—'}</TableCell>
                      {/* Derived from approved LWOP this Manila month, in hours; never a stored balance (#620). */}
                      <TableCell className="font-mono tabular-nums text-muted-foreground md:text-right">{get.lwop(e) || '—'}</TableCell>
                      <TableCell><ChevronRight size={16} className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></TableCell>
                    </TableRow>
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
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

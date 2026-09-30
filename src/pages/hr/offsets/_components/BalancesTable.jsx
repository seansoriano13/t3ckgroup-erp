import { useState } from 'react';
import { ArrowDown, ArrowUp, CalendarCheck, ChevronRight, ChevronsUpDown, Clock, Scale, TimerOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectField } from '@/components/ui/SelectField';
import { Drawer, DrawerClose, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import Avatar from '../../../../components/Avatar';
import { EmptyState, LeaveFilters, StatusPill } from './LeaveParts';
import { TYPE_META, fmtRange, hoursOf, recordKey, usePendingByEmployee } from './leaveDisplay';

const COLS = 'grid-cols-[minmax(0,2.2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.5fr)_90px_120px_16px]';
const num = (v) => Number(v) || 0;
const GROUP_KEY = {
  none: () => '',
  company: (e) => e.company?.name || 'No company set',
  department: (e) => e.department || 'No department',
};

/** Every employee's balances at a glance; a row opens that person's Time Off profile. */
export default function BalancesTable({ employees, pendingLeaves, processedLeaves, filters, companies, onReview }) {
  const pendingMap = usePendingByEmployee(pendingLeaves);
  const [sort, setSort] = useState({ key: 'name', dir: 1 });
  const [group, setGroup] = useState('none');
  const [personId, setPersonId] = useState(null);

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
  const person = employees.find((e) => e.id === personId);

  return (
    <div className="flex flex-col gap-5">
      <LeaveFilters
        filters={filters}
        companies={companies}
        mode="balances"
        right={
          <div className="flex flex-wrap items-center gap-4">
            <span className="text-sm font-medium text-muted-foreground">
              <b className="font-bold text-foreground">{employees.length}</b> employees · <b className="font-bold tabular-nums text-foreground">{owed}</b> Offset hrs owed
            </span>
            <SelectField
              size="sm"
              className="h-10"
              value={group}
              onChange={setGroup}
              options={[{ value: 'none', label: 'No grouping' }, { value: 'company', label: 'Group: Company' }, { value: 'department', label: 'Group: Department' }]}
            />
          </div>
        }
      />

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
                    onClick={() => setPersonId(e.id)}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setPersonId(e.id))}
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
                      {e.company?.name || <span className="font-semibold text-amber-11">No company</span>}
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
            {employees.length === 0 && <EmptyState icon={Scale} title="No employees match">Clear the search or company filter.</EmptyState>}
          </div>
        </div>
      </div>

      <ProfileDrawer
        person={person}
        held={(t) => (person ? pendingMap.get(`${person.id}_${t}`) || 0 : 0)}
        pending={person ? pendingLeaves.filter((r) => r.employee_id === person.id) : []}
        decided={person ? processedLeaves.filter((r) => r.employee_id === person.id) : []}
        onClose={() => setPersonId(null)}
        onReview={(r, list) => { setPersonId(null); onReview(r, list); }}
      />
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

function ProfileDrawer({ person: p, held, pending, decided, onClose, onReview }) {
  return (
    <Drawer open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent side="right" className="w-[560px]">
        {p && (
          <>
            <div className="flex h-14 items-center justify-end border-b border-border px-5">
              <DrawerClose render={<Button type="button" variant="ghost" size="icon" aria-label="Close" />}><X /></DrawerClose>
            </div>
            <div className="custom-scrollbar flex-1 overflow-y-auto px-8 py-8">
              <div className="flex items-center gap-4">
                <Avatar name={p.name} src={p.avatar_path} size="xl" />
                <div className="min-w-0">
                  <DrawerTitle className="text-2xl font-black tracking-tight text-foreground">{p.name}</DrawerTitle>
                  <p className="text-sm font-medium text-muted-foreground">{[p.department, p.company?.name].filter(Boolean).join(' · ') || 'No department'}</p>
                </div>
              </div>

              <div className="mt-8 grid grid-cols-3 gap-3">
                <BalanceBlock icon={Clock} label="Offset" hours={p.offset_hours_balance} held={held('OFFSET')} />
                <BalanceBlock icon={CalendarCheck} label="SIL" hours={p.sil_hours_balance} held={held('SIL')} />
                <BalanceBlock icon={TimerOff} label="Undertime" hours={p.undertime_this_month} note="this month" />
              </div>

              <ProfileList title="Waiting on HR" rows={pending} empty="Nothing pending." onReview={(r) => onReview(r, pending)} />
              <ProfileList title="Decided this period" rows={decided} empty="No decisions this period." />
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

function BalanceBlock({ icon: Icon, label, hours, held = 0, note }) {
  const left = Math.round((num(hours) - held) * 100) / 100;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Icon size={15} /> {label}</p>
      <p className="mt-3 text-3xl font-black tracking-tight text-foreground">
        {hours}<span className="ml-1 text-sm font-bold text-muted-foreground">hrs</span>
      </p>
      <p className={`mt-1 text-xs font-medium ${left < 0 ? 'text-red-11' : 'text-muted-foreground'}`}>
        {note || (held > 0 ? `${held} pending · ${left} left` : 'available')}
      </p>
    </div>
  );
}

function ProfileList({ title, rows, empty, onReview }) {
  return (
    <section className="mt-8">
      <h3 className="mb-3 text-base font-black text-foreground">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm font-medium text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((r) => (
            <li key={recordKey(r)} className="flex items-center gap-3 px-5 py-3.5 text-sm">
              <span className={`size-2 shrink-0 rounded-full ${TYPE_META[r.type].dot}`} />
              <span className="w-20 shrink-0 font-bold text-foreground">{TYPE_META[r.type].label}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-foreground">{fmtRange(r, true)}</span>
              <span className="font-mono tabular-nums text-muted-foreground">{hoursOf(r).granted}h</span>
              {onReview
                ? <Button type="button" variant="outline" size="sm" onClick={() => onReview(r)} className="px-3 font-semibold">Review</Button>
                : <StatusPill record={r} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

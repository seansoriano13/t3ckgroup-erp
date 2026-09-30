import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SelectField } from '@/components/ui/SelectField';
import { LEAVE_TYPES, TYPE_META, statusOf } from './leaveDisplay';

/** Status pill: a muted pill with the status dot (Pending / Overdue / Approved · Offset / …). */
export function StatusPill({ record }) {
  const s = statusOf(record);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-foreground">
      <span className={`size-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

export function TypeChip({ type }) {
  return (
    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${TYPE_META[type].chip}`}>
      {TYPE_META[type].label}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-20 text-center">
      {Icon && <Icon size={32} className="text-muted-foreground/60" />}
      <p className="text-base font-black text-foreground">{title}</p>
      {children && <p className="max-w-sm text-sm font-medium text-muted-foreground">{children}</p>}
    </div>
  );
}

/**
 * Search + filter row for the list views, with removable chips for whatever
 * is set. `mode` decides which filters apply: balances has no type, only
 * pending has the date period.
 */
export function LeaveFilters({ filters, companies, mode, right }) {
  const companyName = (id) => (id === 'NONE' ? 'Not set' : companies.find((c) => c.id === id)?.name);
  const chips = [
    mode !== 'balances' && filters.leaveTypeFilter !== 'ALL' && { k: 'Type', v: TYPE_META[filters.leaveTypeFilter]?.label, clear: () => filters.setLeaveTypeFilter('ALL') },
    filters.companyFilter !== 'ALL' && { k: 'Company', v: companyName(filters.companyFilter), clear: () => filters.setCompanyFilter('ALL') },
    mode === 'pending' && filters.pendingPeriodFilter !== 'ALL' && { k: 'Period', v: filters.pendingPeriodFilter.replace('_', ' ').toLowerCase(), clear: () => filters.setPendingPeriodFilter('ALL') },
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.searchQuery}
            onChange={(e) => filters.setSearchQuery(e.target.value)}
            placeholder="Search employees"
            aria-label="Search employees"
            containerClassName="w-full"
            className="h-10 pl-10"
          />
        </div>
        {mode !== 'balances' && (
          <SelectField
            size="sm"
            className="h-10"
            value={filters.leaveTypeFilter}
            onChange={filters.setLeaveTypeFilter}
            options={[{ value: 'ALL', label: 'All types' }, ...LEAVE_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label }))]}
          />
        )}
        <SelectField
          size="sm"
          className="h-10"
          value={filters.companyFilter}
          onChange={filters.setCompanyFilter}
          title="Filter by company"
          options={[{ value: 'ALL', label: 'All companies' }, { value: 'NONE', label: 'No company set' }, ...companies.map((c) => ({ value: c.id, label: c.name }))]}
        />
        {mode === 'pending' && (
          <SelectField
            size="sm"
            className="h-10"
            value={filters.pendingPeriodFilter}
            onChange={filters.setPendingPeriodFilter}
            options={[
              { value: 'ALL', label: 'Any date' },
              { value: 'THIS_MONTH', label: 'This month' },
              { value: 'NEXT_MONTH', label: 'Next month' },
              { value: 'OVERDUE', label: 'Overdue' },
            ]}
          />
        )}
        <span className="flex-1" />
        {right}
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((c) => (
            <span key={c.k} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card py-1 pl-3 pr-1 text-xs">
              <span className="text-muted-foreground">{c.k}</span>
              <span className="font-bold capitalize text-foreground">{c.v}</span>
              <Button type="button" variant="ghost" size="icon-xs" onClick={c.clear} aria-label={`Clear ${c.k} filter`} className="rounded-full">
                <X />
              </Button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

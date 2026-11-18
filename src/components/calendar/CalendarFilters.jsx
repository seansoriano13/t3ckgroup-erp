import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import FilterBar from '@/components/ui/FilterBar';
import { ACTIVITY_TYPES, LAYERS, layerLabel } from './entryKinds.jsx';
import { ActivityTypeFilter, LayerToggles, PendingSwitch } from './calendarParts.jsx';
import { departmentsOf } from './peopleFilter.js';

/** A filter that is on: a small chip with a one-click remove. */
function FilterChip({ label, onRemove }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card pl-3 pr-1 text-sm font-semibold">
      {label}
      <Button variant="ghost" size="icon-sm" className="size-6 rounded-full" onClick={onRemove} aria-label={`Remove filter ${label}`}>
        <X size={12} />
      </Button>
    </span>
  );
}

function PickRow({ label, checked, onChange }) {
  return (
    <div className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-mauve-3">
      <Checkbox checked={checked} onCheckedChange={onChange} aria-label={label} tone="neutral" />
      <span className="truncate">{label}</span>
    </div>
  );
}

const toggled = (list, item) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

/** Pick people, whole departments, or just yourself. */
function PeopleFilter({ people, onChange, options, departments, viewerId }) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();
  const shown = options.filter((p) => !needle || `${p.name} ${p.department ?? ''}`.toLowerCase().includes(needle));
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="People">
      <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">People</p>
      {viewerId && <PickRow label="Only me" checked={people.onlyMe} onChange={() => onChange({ ...people, onlyMe: !people.onlyMe })} />}
      {departments.length > 0 && (
        <div className="flex flex-col" role="group" aria-label="Departments">
          {departments.map((d) => (
            <PickRow
              key={d}
              label={`${d} department`}
              checked={people.departments.includes(d)}
              onChange={() => onChange({ ...people, departments: toggled(people.departments, d) })}
            />
          ))}
        </div>
      )}
      <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person" aria-label="Find a person" className="h-9" />
      <div className="flex max-h-48 flex-col overflow-y-auto" role="group" aria-label="Pick people">
        {shown.map((p) => (
          <PickRow key={p.id} label={p.name} checked={people.people.includes(p.id)} onChange={() => onChange({ ...people, people: toggled(people.people, p.id) })} />
        ))}
        {shown.length === 0 && <span className="px-1.5 py-1 text-sm text-muted-foreground">No one found.</span>}
      </div>
    </div>
  );
}

/**
 * The Calendar's one Filters button and the chips beside it. Inside the button:
 * the layers, Activity types, people and Pending. Every filter that is on shows
 * as a chip; removing the chip turns it off. `baseline` is the layers the page
 * starts with, so a preset view's own choices are not counted as filters.
 */
export default function CalendarFilters({
  layers,
  baseline,
  toggleLayer,
  all,
  activityTypes,
  toggleActivityType,
  clearActivityTypes,
  people,
  setPeople,
  options,
  viewerId,
  canSeePending,
  showPending,
  setShowPending,
  onClearAll,
}) {
  const departments = departmentsOf(options);
  const changedLayers = LAYERS.filter((l) => Boolean(layers[l.key]) !== Boolean(baseline[l.key]));
  const nameOf = (id) => options.find((p) => p.id === id)?.name ?? 'Someone';

  const chips = [
    ...changedLayers.map((l) => ({ key: `layer-${l.key}`, label: `${layerLabel(l)} ${layers[l.key] ? 'shown' : 'hidden'}`, remove: () => toggleLayer(l.key) })),
    ...activityTypes.map((t) => ({ key: `type-${t}`, label: ACTIVITY_TYPES[t]?.label ?? t, remove: () => toggleActivityType(t) })),
    ...(people.onlyMe ? [{ key: 'only-me', label: 'Only me', remove: () => setPeople({ ...people, onlyMe: false }) }] : []),
    ...people.departments.map((d) => ({ key: `dept-${d}`, label: `${d} department`, remove: () => setPeople({ ...people, departments: people.departments.filter((x) => x !== d) }) })),
    ...people.people.map((id) => ({ key: `person-${id}`, label: nameOf(id), remove: () => setPeople({ ...people, people: people.people.filter((x) => x !== id) }) })),
    ...(canSeePending && showPending ? [{ key: 'pending', label: 'Pending', remove: () => setShowPending(false) }] : []),
  ];

  const body = (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">Layers</p>
        <LayerToggles layers={layers} toggleLayer={toggleLayer} all={all} />
      </div>
      {layers.meetings && (
        <div className="flex flex-col gap-2">
          <p className="text-label font-bold uppercase tracking-wider text-muted-foreground">Activity type</p>
          <ActivityTypeFilter selected={activityTypes} onToggle={toggleActivityType} onClear={clearActivityTypes} all={all} />
        </div>
      )}
      {canSeePending && <PendingSwitch showPending={showPending} setShowPending={setShowPending} />}
      <PeopleFilter people={people} onChange={setPeople} options={options} departments={departments} viewerId={viewerId} />
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FilterBar
        className="w-auto flex-none sm:flex-none"
        filters={body}
        activeCount={chips.length}
        hasActiveFilters={chips.length > 0}
        onClearAll={onClearAll}
      />
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5" role="list" aria-label="Filters on">
          {chips.map((c) => (
            <span key={c.key} role="listitem">
              <FilterChip label={c.label} onRemove={c.remove} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

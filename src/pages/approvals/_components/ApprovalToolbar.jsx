import { ListFilter, Search, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import TabGroup from "../../../components/ui/TabGroup";
import Dropdown from "../../../components/ui/Dropdown";
import { FilterOptionList } from "../../../components/ui/FilterDropdown";

/** A PropertyPill-styled filter that opens a single-choice list. */
export function PillFilter({ label, icon, value, options, onChange }) {
  const current = options.find((o) => o.value === value);
  const active = value !== "ALL";
  return (
    <Dropdown
      usePortal
      trigger={({ isOpen }) => (
        <Button type="button" variant="ghost" className={`property-pill h-auto gap-1.5 rounded-full border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground ${active ? "active border-mauve-6 bg-muted font-semibold text-foreground" : ""}`} data-open={isOpen || undefined} aria-haspopup="listbox" aria-expanded={!!isOpen} aria-label={`${label}${active ? `: ${current?.label}` : ""}`}>
          {icon}
          <span>
            {label}
            {active && `: ${current?.label}`}
          </span>
        </Button>
      )}
    >
      {({ close }) => <FilterOptionList options={options} value={value} onChange={onChange} close={close} />}
    </Dropdown>
  );
}

/**
 * Views on the left, narrowing on the right: who it is from, a search, and —
 * where the queue has them — the full filter set behind "Filters".
 */
export function ApprovalToolbar({
  views,
  view,
  onViewChange,
  people = [],
  person,
  onPersonChange,
  personLabel = "Logged by",
  extraFilters,
  search,
  onSearchChange,
  advancedOpen,
  onAdvancedToggle,
}) {
  const personOptions = [{ value: "ALL", label: "Anyone" }, ...people.map((p) => ({ value: p.id, label: `${p.name} (${p.count})` }))];
  return (
    <>
      <TabGroup className="max-w-full" size="sm" tabs={views} activeTab={view} onChange={onViewChange} />
      <div className="flex flex-wrap items-center gap-2 md:ml-auto">
        {onPersonChange && people.length > 0 && (
          <PillFilter label={personLabel} icon={<UserRound size={13} className="text-muted-foreground" />} value={person} options={personOptions} onChange={onPersonChange} />
        )}
        {extraFilters}
        <Input
          icon={Search}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search requests"
          aria-label="Search requests"
          containerClassName="w-full sm:w-56"
          className="h-8 rounded-lg text-[13px]"
        />
        {onAdvancedToggle && (
          <Button variant="outline" size="sm" onClick={onAdvancedToggle} aria-pressed={advancedOpen} className={`h-8 gap-1.5 rounded-lg text-xs font-semibold ${advancedOpen ? "bg-muted text-foreground" : "text-muted-foreground"}`}>
            <ListFilter size={14} /> Filters
          </Button>
        )}
      </div>
    </>
  );
}

/** Rises from the bottom while rows are selected; the page supplies the actions. */
export function SelectionBar({ count, onClear, children }) {
  if (!count) return null;
  return (
    <div role="region" aria-label="Selection" aria-live="polite" className="fixed bottom-6 pb-[env(safe-area-inset-bottom)] left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg">
      <span className="text-[13px] font-bold">{count} selected</span>
      {children}
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear
      </Button>
    </div>
  );
}

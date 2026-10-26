import { Briefcase, Building2, Calendar as CalendarIcon, Filter, UserRound, Users, X } from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Button } from "@/components/ui/button";
import Dropdown from "./ui/Dropdown";
import FilterBar from "./ui/FilterBar";
import PeriodFilter from "./ui/PeriodFilter";
import { FilterSelect, FilterTriggerButton } from "./ui/FilterDropdown";

const STATUS_OPTIONS = [
  { value: "ALL", label: "Any status" },
  { value: "ACTIVE", label: "Active" },
  { value: "AWAITING_EVALUATION", label: "Awaiting evaluation" },
  { value: "COMPLETED", label: "Completed" },
];

const people = (label, list) => [{ value: "ALL", label }, ...list.map((p) => ({ value: p.id, label: p.name }))];

/** The due-date field inside the Filters popover: a date picker with an x to clear. */
function DueDateField({ value, onChange }) {
  return (
    <div className="flex items-center gap-1">
      <Dropdown
        usePortal
        matchTriggerWidth={false}
        placement="bottom-start"
        className="min-w-0 flex-1"
        trigger={({ isOpen }) => (
          <FilterTriggerButton
            popup="dialog"
            icon={CalendarIcon}
            label={
              value
                ? value.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                : "Due date"
            }
            isActive={!!value}
            isOpen={isOpen}
          />
        )}
      >
        {({ close }) => (
          <div className="p-1">
            <DatePicker
              selected={value}
              onChange={(date) => {
                onChange(date);
                close();
              }}
              inline
            />
          </div>
        )}
      </Dropdown>
      {value && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Clear due date" onClick={() => onChange(null)}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/**
 * The Group Tasks page's filter line (FilterBar): search, Status, Created by and
 * the period inline; department, sub-department, member, due date and SORs-only
 * behind Filters. `filters` is the page's whole filter set (with `dueDate`) and
 * `onChange(key, value)` sets one of them.
 */
export default function GroupTaskFilterBar({
  searchTerm,
  onSearchChange,
  filters,
  onChange,
  onClearAll,
  saveDefault,
  creators = [],
  members = [],
  departments = [],
  subDepartments = [],
}) {
  const { statusFilter, creatorFilter, memberFilter, deptFilter, subDeptFilter, timeframe, selectedDateFilter, dueDate, crmOnly } = filters;

  const deptOptions = [{ value: "ALL", label: "All departments" }, ...departments.map((d) => ({ value: d, label: d }))];
  const subDeptOptions = [{ value: "ALL", label: "All sub-departments" }, ...subDepartments.map((s) => ({ value: s, label: s }))];

  const activeCount = [
    deptFilter !== "ALL",
    subDeptFilter !== "ALL",
    memberFilter !== "ALL",
    dueDate !== null,
    crmOnly,
  ].filter(Boolean).length;

  const hasActiveFilters =
    searchTerm !== "" ||
    statusFilter !== "ALL" ||
    creatorFilter !== "ALL" ||
    selectedDateFilter !== "" ||
    activeCount > 0;

  return (
    <FilterBar
      search={{ value: searchTerm, onChange: onSearchChange, placeholder: "Search group tasks, creators, or members" }}
      chips={
        <>
          <FilterSelect
            icon={Filter}
            label="Status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(v) => onChange("statusFilter", v)}
            className="h-9 w-auto gap-2 px-2.5"
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={UserRound}
            label="Created by"
            options={people("Created by: everyone", creators)}
            value={creatorFilter}
            onChange={(v) => onChange("creatorFilter", v)}
            className="h-9 w-auto gap-2 px-2.5"
            wrapperClassName="w-auto shrink-0"
          />
          <PeriodFilter
            timeframe={timeframe}
            onTimeframeChange={(v) => onChange("timeframe", v)}
            value={selectedDateFilter}
            onChange={(v) => onChange("selectedDateFilter", v)}
          />
        </>
      }
      filters={
        <>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <FilterSelect
              icon={Building2}
              label="Department"
              options={deptOptions}
              value={deptFilter}
              onChange={(v) => {
                onChange("deptFilter", v);
                onChange("subDeptFilter", "ALL");
              }}
            />
            <FilterSelect
              icon={Building2}
              label="Sub-department"
              options={subDeptOptions}
              value={subDeptFilter}
              onChange={(v) => onChange("subDeptFilter", v)}
              disabled={deptFilter === "ALL"}
            />
            <FilterSelect
              icon={Users}
              label="Member"
              options={people("Member: everyone", members)}
              value={memberFilter}
              onChange={(v) => onChange("memberFilter", v)}
            />
            <DueDateField value={dueDate} onChange={(v) => onChange("dueDate", v)} />
          </div>
          <Button
            type="button"
            variant={crmOnly ? "secondary" : "outline"}
            aria-pressed={crmOnly}
            onClick={() => onChange("crmOnly", !crmOnly)}
            className="self-start"
          >
            <Briefcase aria-hidden="true" />
            SORs only
          </Button>
        </>
      }
      activeCount={activeCount}
      hasActiveFilters={hasActiveFilters}
      onClearAll={onClearAll}
      saveDefault={saveDefault}
    />
  );
}

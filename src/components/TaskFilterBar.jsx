import { Briefcase, Building2, Filter, SlidersHorizontal, Users } from "lucide-react";
import { TASK_STATUS } from "../constants/status";
import { PRIORITY_OPTIONS } from "../constants/task";
import { Button } from "@/components/ui/button";
import FilterBar from "./ui/FilterBar";
import PeriodFilter from "./ui/PeriodFilter";
import { FilterSelect } from "./ui/FilterDropdown";

const SORT_OPTIONS = [
  { value: "NEWEST", label: "Newest" },
  { value: "OLDEST", label: "Oldest" },
  { value: "NAME", label: "By Name" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "Any status" },
  { value: TASK_STATUS.COMPLETE, label: "Complete" },
  { value: TASK_STATUS.AWAITING_APPROVAL, label: "Awaiting Approval" },
  { value: TASK_STATUS.INCOMPLETE, label: "Incomplete" },
  { value: TASK_STATUS.NOT_APPROVED, label: "Not Approved" },
  { value: "DELAYED", label: "Delayed" },
];

const PRIORITY_FILTER_OPTIONS = [
  { value: "ALL", label: "Any priority" },
  ...PRIORITY_OPTIONS.map(({ value, label }) => ({ value, label })),
];

const everyone = (label, people) => [
  { value: "ALL", label },
  ...people.map((p) => ({ value: p.id, label: p.name })),
];

/**
 * The Tasks page's filter line (FilterBar): search, Status, Priority and the
 * period inline; sort, department, sub-department, who logged it, who it was
 * reported to and SORs-only behind Filters. `filters` is the page's whole
 * filter set and `onChange(key, value)` sets one of them.
 *
 * `scope` says which of the people/department filters this viewer may change:
 * a staff member or an HR "My Tasks" view is locked to their own tasks, and a
 * locked filter is neither greyed-in as "active" nor cleared by Clear all.
 */
export default function TaskFilterBar({
  searchTerm,
  onSearchChange,
  filters,
  onChange,
  onClearAll,
  saveDefault,
  scope: { canPickPeople, canPickDepartment },
  departments = [],
  subDepartments = [],
  people = [],
}) {
  const { statusFilter, priorityFilter, sortBy, timeframe, selectedDateFilter, deptFilter, subDeptFilter, employeeFilter, reportedToFilter, crmOnly } =
    filters;

  const deptOptions = [
    { value: "ALL", label: "All departments" },
    ...(departments.includes("SALES") ? [] : [{ value: "SALES", label: "SALES" }]),
    ...departments.map((d) => ({ value: d, label: d })),
  ];
  const subDeptOptions = [{ value: "ALL", label: "All sub-departments" }, ...subDepartments.map((s) => ({ value: s, label: s }))];

  // What the Filters popover holds that is currently narrowing the list.
  const activeCount = [
    sortBy !== "NEWEST",
    deptFilter !== "ALL" && canPickDepartment,
    subDeptFilter !== "ALL" && canPickPeople,
    employeeFilter !== "ALL" && canPickPeople,
    reportedToFilter !== "ALL",
    crmOnly,
  ].filter(Boolean).length;

  const hasActiveFilters =
    searchTerm !== "" ||
    statusFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    selectedDateFilter !== "" ||
    (deptFilter !== "ALL" && canPickDepartment) ||
    (subDeptFilter !== "ALL" && canPickPeople) ||
    (employeeFilter !== "ALL" && canPickPeople) ||
    reportedToFilter !== "ALL" ||
    crmOnly;

  return (
    <FilterBar
      search={{ value: searchTerm, onChange: onSearchChange, placeholder: "Search tasks" }}
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
            icon={Filter}
            label="Priority"
            options={PRIORITY_FILTER_OPTIONS}
            value={priorityFilter}
            onChange={(v) => onChange("priorityFilter", v)}
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
              icon={SlidersHorizontal}
              label="Sort"
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(v) => onChange("sortBy", v)}
              allValue="NEWEST"
            />
            <FilterSelect
              icon={Building2}
              label="Department"
              options={deptOptions}
              value={deptFilter}
              onChange={(v) => {
                onChange("deptFilter", v);
                onChange("subDeptFilter", "ALL");
              }}
              disabled={!canPickDepartment}
            />
            <FilterSelect
              icon={Building2}
              label="Sub-department"
              options={subDeptOptions}
              value={subDeptFilter}
              onChange={(v) => onChange("subDeptFilter", v)}
              disabled={deptFilter === "ALL" || !canPickPeople}
            />
            <FilterSelect
              icon={Users}
              label="Logged by"
              options={everyone("Logged by: everyone", people)}
              value={employeeFilter}
              onChange={(v) => onChange("employeeFilter", v)}
              disabled={!canPickPeople}
            />
            <FilterSelect
              icon={Users}
              label="Reported to"
              options={everyone("Reported to: everyone", people)}
              value={reportedToFilter}
              onChange={(v) => onChange("reportedToFilter", v)}
            />
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

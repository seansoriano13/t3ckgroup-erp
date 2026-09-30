import { useMemo } from "react";
import { Activity, Building2, Clock, ShieldCheck, Users } from "lucide-react";
import FilterBar from "./ui/FilterBar";
import { FilterSelect } from "./ui/FilterDropdown";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";
import { DEFAULT_LOG_FILTERS } from "@/lib/activityLog";

const TYPE_OPTIONS = [
  { value: "ALL", label: "All types" },
  { value: "SYSTEM", label: "System" },
  { value: "COMMENT", label: "Comment" },
  { value: "APPROVAL", label: "Approval" },
  { value: "HR_NOTE", label: "HR note" },
];

const STATUS_OPTIONS = [
  { value: "ALL", label: "All statuses" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "AWAITING APPROVAL", label: "Awaiting approval" },
  { value: "COMPLETE", label: "Complete" },
  { value: "NOT APPROVED", label: "Not approved" },
  { value: "DELETED", label: "Deleted" },
];

const chip = "h-9 w-auto gap-2 px-2.5";

const dateField = (label, value, onChange, min) => (
  <FieldBox bare label={label}>
    <Input type="date" value={value} min={min || undefined} onChange={(e) => onChange(e.target.value)} />
  </FieldBox>
);

/**
 * The Activity Log's filter line (FilterBar): search, Type, Task status and
 * Actor inline; task owner, department, sub-department and the date range
 * behind Filters. `filters` is the page's whole filter set; dates are
 * "YYYY-MM-DD" strings ("" = unset).
 */
export default function ActivityLogFilterBar({ filters, setFilters, employees = [], liveIndicator }) {
  const set = (key) => (value) => setFilters((p) => ({ ...p, [key]: value }));

  const departments = useMemo(
    () => [...new Set(employees.map((e) => e.department).filter((d) => typeof d === "string" && d.trim()))].sort(),
    [employees],
  );
  const subDepartments = useMemo(() => {
    const pool = filters.dept === "ALL" ? employees : employees.filter((e) => e.department === filters.dept);
    return [...new Set(pool.map((e) => e.subDepartment).filter((d) => typeof d === "string" && d.trim()))].sort();
  }, [employees, filters.dept]);

  const employeeOptions = employees.map((e) => ({ value: e.id, label: e.name }));
  const people = (label) => [{ value: "ALL", label }, ...employeeOptions];

  const activeCount = [
    filters.employeeId !== "ALL",
    filters.dept !== "ALL",
    filters.subDept !== "ALL",
    filters.dateFrom !== "",
    filters.dateTo !== "",
  ].filter(Boolean).length;

  const hasActiveFilters =
    activeCount > 0 ||
    filters.search !== "" ||
    filters.type !== "ALL" ||
    filters.taskStatus !== "ALL" ||
    filters.authorId !== "ALL";

  return (
    <FilterBar
      search={{ value: filters.search, onChange: set("search"), placeholder: "Search content or task description" }}
      chips={
        <>
          <FilterSelect
            icon={Activity}
            label="Type"
            options={TYPE_OPTIONS}
            value={filters.type}
            onChange={set("type")}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={Clock}
            label="Task status"
            options={STATUS_OPTIONS}
            value={filters.taskStatus}
            onChange={set("taskStatus")}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={ShieldCheck}
            label="Actor"
            options={[{ value: "ALL", label: "All actors" }, { value: "SYSTEM", label: "System" }, ...employeeOptions]}
            value={filters.authorId}
            onChange={set("authorId")}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
        </>
      }
      filters={
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FilterSelect
            icon={Users}
            label="Task owner"
            options={people("All owners")}
            value={filters.employeeId}
            onChange={set("employeeId")}
          />
          <FilterSelect
            icon={Building2}
            label="Department"
            options={[{ value: "ALL", label: "All departments" }, ...departments.map((d) => ({ value: d, label: d }))]}
            value={filters.dept}
            onChange={(v) => setFilters((p) => ({ ...p, dept: v, subDept: "ALL" }))}
          />
          <FilterSelect
            icon={Building2}
            label="Sub-department"
            options={[{ value: "ALL", label: "All sub-departments" }, ...subDepartments.map((d) => ({ value: d, label: d }))]}
            value={filters.subDept}
            onChange={set("subDept")}
            disabled={filters.dept === "ALL"}
          />
          <div className="grid grid-cols-2 gap-2.5 sm:col-span-2">
            {dateField("Date from", filters.dateFrom, set("dateFrom"))}
            {dateField("Date to", filters.dateTo, set("dateTo"), filters.dateFrom)}
          </div>
        </div>
      }
      activeCount={activeCount}
      hasActiveFilters={hasActiveFilters}
      onClearAll={() => setFilters(DEFAULT_LOG_FILTERS)}
      actions={liveIndicator}
    />
  );
}

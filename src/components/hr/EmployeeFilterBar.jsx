import { Building2, Shield, SlidersHorizontal, Users } from "lucide-react";
import FilterBar from "../ui/FilterBar";
import { FilterSelect } from "../ui/FilterDropdown";

const SORT_OPTIONS = [
  { value: "NAME_ASC", label: "Name (A–Z)" },
  { value: "NAME_DESC", label: "Name (Z–A)" },
  { value: "DEPT", label: "By department" },
];

const ROLE_FLAG_OPTIONS = [
  { value: "ALL", label: "All Flags" },
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "HR", label: "HR" },
  { value: "HEAD", label: "Head" },
  { value: "LEAVE_MANAGER", label: "Leave Manager" },
  { value: "STANDARD", label: "Standard" },
];

const withAll = (label, values) => [
  { value: "ALL", label },
  ...values.map((v) => ({ value: v, label: v })),
];

const chip = "h-9 w-auto gap-2 px-2.5";

/**
 * The Employees register's filter line (FilterBar): search, Department, Role
 * and Status inline; sub-department, role flag, company and sort behind
 * Filters. `filters` is the page's whole filter set and `onChange(key, value)`
 * sets one of them; `companyOptions` is the ready-made option list.
 */
export default function EmployeeFilterBar({
  filters,
  onChange,
  onClearAll,
  departments = [],
  subDepartments = [],
  roles = [],
  statuses = [],
  companyOptions = [],
}) {
  const { searchTerm, deptFilter, subDeptFilter, roleFilter, roleFlagFilter, statusFilter, companyFilter, sortBy } =
    filters;

  const activeCount = [
    subDeptFilter !== "ALL",
    roleFlagFilter !== "ALL",
    companyFilter !== "ALL",
    sortBy !== "NAME_ASC",
  ].filter(Boolean).length;

  const hasActiveFilters =
    searchTerm !== "" || deptFilter !== "ALL" || roleFilter !== "ALL" || statusFilter !== "ALL" || activeCount > 0;

  return (
    <FilterBar
      search={{
        value: searchTerm,
        onChange: (v) => onChange("searchTerm", v),
        placeholder: "Search by name or email",
      }}
      chips={
        <>
          <FilterSelect
            icon={Building2}
            label="Department"
            options={withAll("All Departments", departments)}
            value={deptFilter}
            onChange={(v) => {
              onChange("deptFilter", v);
              onChange("subDeptFilter", "ALL");
            }}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={Users}
            label="Role"
            options={withAll("All Roles", roles)}
            value={roleFilter}
            onChange={(v) => onChange("roleFilter", v)}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
          <FilterSelect
            icon={Users}
            label="Status"
            options={withAll("All Statuses", statuses)}
            value={statusFilter}
            onChange={(v) => onChange("statusFilter", v)}
            className={chip}
            wrapperClassName="w-auto shrink-0"
          />
        </>
      }
      filters={
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <FilterSelect
            icon={Building2}
            label="Sub-department"
            options={withAll("All Sub-Depts", subDepartments)}
            value={subDeptFilter}
            onChange={(v) => onChange("subDeptFilter", v)}
            disabled={deptFilter === "ALL"}
          />
          <FilterSelect
            icon={Shield}
            label="Role flag"
            options={ROLE_FLAG_OPTIONS}
            value={roleFlagFilter}
            onChange={(v) => onChange("roleFlagFilter", v)}
          />
          <FilterSelect
            icon={Building2}
            label="Company"
            options={companyOptions}
            value={companyFilter}
            onChange={(v) => onChange("companyFilter", v)}
          />
          <FilterSelect
            icon={SlidersHorizontal}
            label="Sort"
            options={SORT_OPTIONS}
            value={sortBy}
            onChange={(v) => onChange("sortBy", v)}
            allValue="NAME_ASC"
          />
        </div>
      }
      activeCount={activeCount}
      hasActiveFilters={hasActiveFilters}
      onClearAll={onClearAll}
    />
  );
}

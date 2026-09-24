import React, { useMemo } from "react";
import {
  Search,
  Filter,
  X,
  Activity,
  Clock,
  ChevronDown,
  ShieldCheck,
  Building2,
  Users,
  Calendar,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";
import { Button } from "./ui/button";
import { Input } from "@/components/ui/input";

// ── FieldBox — mirrors LogTaskAssignmentBar's label+container pattern ────────
function FieldBox({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider pl-1">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function ActivityLogFilters({
  filters,
  setFilters,
  employees = [],
}) {
  // ── Derived data ──────────────────────────────────────────────────────────
  const uniqueDepts = useMemo(() => {
    const s = new Set(["ALL"]);
    employees.forEach((e) => {
      if (typeof e.department === "string" && e.department.trim())
        s.add(e.department);
    });
    return Array.from(s).sort();
  }, [employees]);

  const uniqueSubDepts = useMemo(() => {
    const s = new Set(["ALL"]);
    const pool =
      filters.dept === "ALL"
        ? employees
        : employees.filter((e) => e.department === filters.dept);
    pool.forEach((e) => {
      if (typeof e.subDepartment === "string" && e.subDepartment.trim())
        s.add(e.subDepartment);
    });
    return Array.from(s).sort();
  }, [employees, filters.dept]);

  const hasActiveFilters =
    filters.type !== "ALL" ||
    filters.authorId !== "ALL" ||
    filters.employeeId !== "ALL" ||
    filters.taskStatus !== "ALL" ||
    filters.dept !== "ALL" ||
    filters.subDept !== "ALL" ||
    filters.dateFrom !== null ||
    filters.dateTo !== null ||
    filters.search !== "";

  const clearFilters = () =>
    setFilters({
      type: "ALL",
      authorId: "ALL",
      employeeId: "ALL",
      taskStatus: "ALL",
      dept: "ALL",
      subDept: "ALL",
      dateFrom: null,
      dateTo: null,
      search: "",
    });

  // Date input style — matches FilterTrigger height and premium style
  const dateCls = (isActive) =>
    `w-full border rounded-lg px-3 h-[40px] md:h-[46px] text-[13px] text-foreground outline-none transition-all cursor-pointer flex items-center ${
      isActive
        ? "bg-muted ring-1 ring-mauve-4 font-medium"
        : "bg-card border-border hover:border-border/80"
    }`;

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm">
      {/* Panel top bar — matches LogTaskHeader strip */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-muted border border-border shrink-0">
            <Filter size={10} className="text-muted-foreground" />
          </div>
          <ChevronDown
            size={11}
            className="text-muted-foreground -rotate-90"
          />
          <span className="font-medium text-muted-foreground/80">
            Filters
          </span>
          {hasActiveFilters && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
              Active
            </span>
          )}
        </div>
        {hasActiveFilters && (
          <Button
            type="button"
            variant="ghost"
            onClick={clearFilters}
            className="h-auto p-0 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-transparent transition-colors"
          >
            <X size={12} /> Clear
          </Button>
        )}
      </div>

      {/* Filter fields — react-select matching LogTaskAssignmentBar exactly */}
      <div className="px-4 py-3.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-4">
        {/* Search — spans 2 cols */}
        <div className="lg:col-span-2">
          <FieldBox label="Search">
            <div className="relative flex items-center">
              <Search
                size={13}
                className="absolute left-3 text-muted-foreground pointer-events-none shrink-0"
              />
              <Input
                value={filters.search}
                onChange={(e) =>
                  setFilters((p) => ({ ...p, search: e.target.value }))
                }
                placeholder="Search content or task description…"
                containerClassName="w-full" className="bg-card border border-border rounded-lg pl-8 pr-3 h-[40px] md:h-[46px] text-[13px] text-foreground outline-none focus:ring-1 focus:ring-mauve-4 hover:border-border/80 transition-all placeholder:text-muted-foreground"
              />
            </div>
          </FieldBox>
        </div>

        <FieldBox label="Type">
          <Dropdown
            usePortal
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={filters.type === "ALL" ? "All Types" : filters.type}
                isActive={filters.type !== "ALL"}
                isOpen={isOpen}
                icon={Activity}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={[
                  { value: "ALL", label: "All Types" },
                  { value: "SYSTEM", label: "SYSTEM" },
                  { value: "COMMENT", label: "COMMENT" },
                  { value: "APPROVAL", label: "APPROVAL" },
                  { value: "HR_NOTE", label: "HR_NOTE" },
                ]}
                value={filters.type}
                onChange={(val) => {
                  setFilters((p) => ({ ...p, type: val }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Task Status">
          <Dropdown
            usePortal
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  filters.taskStatus === "ALL"
                    ? "All Statuses"
                    : filters.taskStatus
                }
                isActive={filters.taskStatus !== "ALL"}
                isOpen={isOpen}
                icon={Clock}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={[
                  { value: "ALL", label: "All Statuses" },
                  { value: "INCOMPLETE", label: "INCOMPLETE" },
                  {
                    value: "AWAITING APPROVAL",
                    label: "AWAITING APPROVAL",
                  },
                  { value: "COMPLETE", label: "COMPLETE" },
                  { value: "NOT APPROVED", label: "NOT APPROVED" },
                  { value: "DELETED", label: "DELETED" },
                ]}
                value={filters.taskStatus}
                onChange={(val) => {
                  setFilters((p) => ({ ...p, taskStatus: val }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Author (Actor)">
          <Dropdown
            usePortal
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  filters.authorId === "ALL"
                    ? "All Actors"
                    : employees.find((e) => e.id === filters.authorId)
                      ? employees.find((e) => e.id === filters.authorId)
                          .name
                      : filters.authorId === "SYSTEM"
                        ? "System"
                        : "All Actors"
                }
                isActive={filters.authorId !== "ALL"}
                isOpen={isOpen}
                icon={ShieldCheck}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                showSearch
                options={[
                  { value: "ALL", label: "All Actors" },
                  { value: "SYSTEM", label: "System" },
                  ...employees.map((emp) => ({
                    value: emp.id,
                    label: emp.name,
                  })),
                ]}
                value={filters.authorId}
                onChange={(val) => {
                  setFilters((p) => ({ ...p, authorId: val }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Task Owner">
          <Dropdown
            usePortal
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  filters.employeeId === "ALL"
                    ? "All Employees"
                    : employees.find((e) => e.id === filters.employeeId)
                        ?.name || filters.employeeId
                }
                isActive={filters.employeeId !== "ALL"}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                showSearch
                options={[
                  { value: "ALL", label: "All Employees" },
                  ...employees.map((emp) => ({
                    value: emp.id,
                    label: emp.name,
                  })),
                ]}
                value={filters.employeeId}
                onChange={(val) => {
                  setFilters((p) => ({ ...p, employeeId: val }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Department">
          <Dropdown
            usePortal
            className="w-full"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={
                  filters.dept === "ALL" ? "All Departments" : filters.dept
                }
                isActive={filters.dept !== "ALL"}
                isOpen={isOpen}
                icon={Building2}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={uniqueDepts.map((d) => ({
                  value: d,
                  label: d === "ALL" ? "All Departments" : d,
                }))}
                value={filters.dept}
                onChange={(val) => {
                  setFilters((p) => ({
                    ...p,
                    dept: val,
                    subDept: "ALL",
                  }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Sub-Department">
          <Dropdown
            usePortal
            className="w-full"
            disabled={filters.dept === "ALL"}
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={
                  filters.subDept === "ALL"
                    ? "All Sub-Depts"
                    : filters.subDept
                }
                isActive={filters.subDept !== "ALL"}
                isOpen={isOpen}
                icon={Building2}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={uniqueSubDepts.map((s) => ({
                  value: s,
                  label: s === "ALL" ? "All Sub-Depts" : s,
                }))}
                value={filters.subDept}
                onChange={(val) => {
                  setFilters((p) => ({ ...p, subDept: val }));
                  close();
                }}
                close={close}
              />
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Date From">
          <Dropdown
            usePortal
            placement="bottom-start"
            trigger={({ isOpen }) => (
              <div className="relative flex items-center group">
                <div className={`${dateCls(!!filters.dateFrom || isOpen)} pl-9 w-full flex items-center justify-between`}>
                  <span className={!filters.dateFrom ? "text-muted-foreground" : ""}>
                    {filters.dateFrom ? new Date(filters.dateFrom).toLocaleDateString("en-US", {month: "short", day:"numeric", year:"numeric"}) : "Select start date"}
                  </span>
                  {filters.dateFrom && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilters((p) => ({ ...p, dateFrom: null }));
                      }}
                      className="h-auto w-auto hover:text-foreground hover:bg-transparent text-muted-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
                <Calendar
                  size={14}
                  className={`absolute left-3 transition-colors pointer-events-none z-10 ${filters.dateFrom || isOpen ? "text-mauve-11" : "text-mauve-8"}`}
                />
              </div>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <DatePicker
                  selected={filters.dateFrom}
                  onChange={(date) => {
                    setFilters((p) => ({ ...p, dateFrom: date }));
                    close();
                  }}
                  inline
                />
              </div>
            )}
          </Dropdown>
        </FieldBox>

        <FieldBox label="Date To">
          <Dropdown
            usePortal
            placement="bottom-start"
            trigger={({ isOpen }) => (
              <div className="relative flex items-center group">
                <div className={`${dateCls(!!filters.dateTo || isOpen)} pl-9 w-full flex items-center justify-between`}>
                  <span className={!filters.dateTo ? "text-muted-foreground" : ""}>
                    {filters.dateTo ? new Date(filters.dateTo).toLocaleDateString("en-US", {month: "short", day:"numeric", year:"numeric"}) : "Select end date"}
                  </span>
                  {filters.dateTo && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFilters((p) => ({ ...p, dateTo: null }));
                      }}
                      className="h-auto w-auto hover:text-foreground hover:bg-transparent text-muted-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X size={14} />
                    </Button>
                  )}
                </div>
                <Calendar
                  size={14}
                  className={`absolute left-3 transition-colors pointer-events-none z-10 ${filters.dateTo || isOpen ? "text-mauve-11" : "text-mauve-8"}`}
                />
              </div>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <DatePicker
                  selected={filters.dateTo}
                  onChange={(date) => {
                    setFilters((p) => ({ ...p, dateTo: date }));
                    close();
                  }}
                  minDate={filters.dateFrom}
                  inline
                />
              </div>
            )}
          </Dropdown>
        </FieldBox>
      </div>
    </div>
  );
}

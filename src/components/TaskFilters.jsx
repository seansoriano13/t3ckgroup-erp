import React, { useState } from "react";
import {
  Search,
  Filter,
  Users,
  Building2,
  Calendar as CalendarIcon,
  SlidersHorizontal,
  ChevronDown,
  Briefcase,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { TASK_STATUS } from "../constants/status";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import PriorityDropdown from "./dropdowns/PriorityDropdown";
import Dropdown from "./ui/Dropdown";

import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";

export default function TaskFilters({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  timeframe,
  setTimeframe,
  selectedDateFilter,
  setSelectedDateFilter,
  deptFilter,
  setDeptFilter,
  subDeptFilter,
  setSubDeptFilter,
  employeeFilter,
  setEmployeeFilter,
  reportedToFilter,
  setReportedToFilter,
  isManagement,
  isHr,
  hrViewMode = "ALL",
  uniqueDepts = [],
  uniqueSubDepts = [],
  uniqueEmployees = [],
  showStatusFilter = true,
  disableStatusFilter = false,
  disableDeptFilter,
  sortBy,
  setSortBy,
  forceAdvancedOpen = false,
  onAdvancedOpenChange,
  crmOnly = false,
  setCrmOnly,
  actions,
}) {
  const [showAdvanced, setShowAdvancedRaw] = useState(
    forceAdvancedOpen || !!employeeFilter,
  );

  const isFiltersReadOnly =
    !isManagement || (isHr && hrViewMode === "PERSONAL");

  const setShowAdvanced = (val) => {
    setShowAdvancedRaw(val);
    if (onAdvancedOpenChange) onAdvancedOpenChange(val);
  };

  const isAnyFilterActive =
    statusFilter !== "ALL" ||
    priorityFilter !== "ALL" ||
    (deptFilter !== "ALL" && !disableDeptFilter) ||
    subDeptFilter !== "ALL" ||
    employeeFilter !== "ALL" ||
    selectedDateFilter !== "" ||
    crmOnly ||
    searchTerm !== "";

  const handleClearAll = () => {
    setSearchTerm("");
    if (setStatusFilter && showStatusFilter) setStatusFilter("ALL");
    if (setPriorityFilter) setPriorityFilter("ALL");
    setSelectedDateFilter("");

    // Only clear these if not in a read-only filter state (like My Tasks)
    if (!isFiltersReadOnly) {
      if (setDeptFilter && !disableDeptFilter) setDeptFilter("ALL");
      if (setSubDeptFilter) setSubDeptFilter("ALL");
      if (setEmployeeFilter) setEmployeeFilter("ALL");
    }
    if (setReportedToFilter) setReportedToFilter("ALL");
    if (setCrmOnly) setCrmOnly(false);
  };

  // Option Definitions
  const sortOptions = [
    { value: "NEWEST", label: "Newest" },
    { value: "OLDEST", label: "Oldest" },
    { value: "NAME", label: "By Name" },
  ];

  const timeframeOptions = [
    { value: "DAILY", label: "Daily" },
    { value: "WEEKLY", label: "Weekly" },
    { value: "MONTHLY", label: "Monthly" },
    { value: "YEARLY", label: "Yearly" },
  ];

  const statusOptions = [
    { value: "ALL", label: "All" },
    { value: TASK_STATUS.COMPLETE, label: "Complete" },
    { value: TASK_STATUS.AWAITING_APPROVAL, label: "Awaiting Approval" },
    { value: TASK_STATUS.INCOMPLETE, label: "Incomplete" },
    { value: TASK_STATUS.NOT_APPROVED, label: "Not Approved" },
    { value: "DELAYED", label: "Delayed" },
  ];

  const deptOptions = [
    { value: "ALL", label: "All" },
    ...(!uniqueDepts.includes("SALES")
      ? [{ value: "SALES", label: "SALES" }]
      : []),
    ...uniqueDepts
      .filter((d) => d !== "ALL")
      .map((d) => ({ value: d, label: d })),
  ];

  const subDeptOptions = [
    { value: "ALL", label: "All" },
    ...uniqueSubDepts
      .filter((s) => s !== "ALL")
      .map((s) => ({ value: s, label: s })),
  ];

  const employeeOptions = [
    { value: "ALL", label: "Logged By: Everyone" },
    ...uniqueEmployees.map((emp) => ({ value: emp.id, label: emp.name })),
  ];

  const reportedToOptions = [
    { value: "ALL", label: "Reported To: Everyone" },
    ...uniqueEmployees.map((emp) => ({ value: emp.id, label: emp.name })),
  ];

  const currentSortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label || sortOptions[0].label;
  const currentStatusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label ||
    statusOptions[0].label;
  const currentDeptLabel =
    deptOptions.find((o) => o.value === deptFilter)?.label ||
    deptOptions[0].label;
  const currentSubDeptLabel =
    subDeptOptions.find((o) => o.value === subDeptFilter)?.label ||
    subDeptOptions[0].label;
  const currentEmployeeLabel =
    employeeOptions.find((o) => o.value === employeeFilter)?.label ||
    employeeOptions[0].label;
  const currentReportedToLabel =
    reportedToOptions.find((o) => o.value === reportedToFilter)?.label ||
    reportedToOptions[0].label;
  const currentTimeframeLabel =
    timeframeOptions.find((o) => o.value === timeframe)?.label || "Daily";

  return (
    <div className="grid gap-3 md:gap-4">
      {/* Row 1: Search & Permanent Filters */}
      <div className="bg-card border border-[#E5E7EB] p-3 md:p-4 rounded-xl flex flex-col xl:flex-row items-stretch xl:items-center gap-3 md:gap-4 relative z-20">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={18}
          />
          <Input
            type="text"
            placeholder="Search tasks..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 block h-[40px] md:h-[46px]"
          />
        </div>

        {/* Action Group */}
        <div className="flex items-center gap-2 w-full xl:w-auto flex-wrap justify-between xl:justify-start relative z-10">
          <div className="flex gap-2 items-center flex-wrap">
            {/* DATE PICKER */}
            <div
              className={`flex items-center border rounded-lg h-[40px] md:h-[46px] shadow-sm transition-all shrink-0 ${
                selectedDateFilter
                  ? "bg-muted ring-1 ring-mauve-4 font-medium"
                  : "bg-card border-border hover:border-border/80 text-foreground"
              }`}
            >
              {/* Timeframe Dropdown inside DatePicker wrapper */}
              <Dropdown
                usePortal={true}
                className="h-full border-r border-border flex-center"
                trigger={({ isOpen }) => (
                  <div className="flex items-center pl-4 pr-3 gap-2 cursor-pointer hover:bg-muted/60 transition-colors h-full rounded-l-lg min-w-[80px] justify-center">
                    <span className="text-[10px] uppercase font-bold tracking-widest text-foreground">
                      {currentTimeframeLabel}
                    </span>
                    <ChevronDown
                      size={10}
                      className={`text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  </div>
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={timeframeOptions}
                    value={timeframe}
                    onChange={(val) => {
                      setTimeframe(val);
                      const today = new Date();
                      const y = today.getFullYear();
                      const m = String(today.getMonth() + 1).padStart(2, "0");
                      const d = String(today.getDate()).padStart(2, "0");
                      if (val === "YEARLY") {
                        setSelectedDateFilter(`${y}`);
                      } else if (val === "MONTHLY") {
                        setSelectedDateFilter(`${y}-${m}`);
                      } else {
                        setSelectedDateFilter(`${y}-${m}-${d}`);
                      }
                    }}
                    close={close}
                  />
                )}
              </Dropdown>

              <Dropdown
                usePortal={true}
                placement="bottom-start"
                trigger={({ isOpen }) => (
                  <div className="relative flex items-center px-2 cursor-pointer h-full group">
                    <CalendarIcon
                      size={14}
                      className={`${selectedDateFilter || isOpen ? "text-foreground" : "text-muted-foreground"} mr-2 shrink-0`}
                    />
                    <div
                      className={`bg-transparent outline-none w-[110px] text-[13px] flex items-center justify-between ${
                        selectedDateFilter
                          ? "text-foreground font-medium"
                          : "text-muted-foreground"
                      }`}
                    >
                      <span className="truncate">
                        {selectedDateFilter
                          ? timeframe === "YEARLY"
                            ? selectedDateFilter
                            : timeframe === "MONTHLY"
                              ? new Date(selectedDateFilter).toLocaleDateString("en-US", {
                                  month: "long",
                                  year: "numeric",
                                })
                              : new Date(selectedDateFilter).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                          : timeframe === "YEARLY"
                            ? "Select Year"
                            : timeframe === "MONTHLY"
                              ? "Select Month"
                              : "Select Date"}
                      </span>
                      {selectedDateFilter && (
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDateFilter("");
                          }}
                          className="h-auto w-auto hover:text-foreground hover:bg-transparent text-muted-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              >
                {({ close }) => (
                  <div className="p-1">
                    <DatePicker
                      selected={
                        selectedDateFilter ? new Date(selectedDateFilter) : null
                      }
                      onChange={(date) => {
                        if (!date) {
                          setSelectedDateFilter("");
                          return;
                        }
                        if (timeframe === "YEARLY") {
                          setSelectedDateFilter(date.getFullYear().toString());
                        } else if (timeframe === "MONTHLY") {
                          const m = String(date.getMonth() + 1).padStart(2, "0");
                          setSelectedDateFilter(`${date.getFullYear()}-${m}`);
                        } else {
                          const y = date.getFullYear();
                          const m = String(date.getMonth() + 1).padStart(2, "0");
                          const d = String(date.getDate()).padStart(2, "0");
                          setSelectedDateFilter(`${y}-${m}-${d}`);
                        }
                        close();
                      }}
                      showMonthYearPicker={timeframe === "MONTHLY"}
                      showYearPicker={timeframe === "YEARLY"}
                      inline
                    />
                  </div>
                )}
              </Dropdown>
            </div>

            {/* SORTING */}
            {sortBy !== undefined && setSortBy && (
              <Dropdown
                usePortal={true}
                className="min-w-[150px] shrink-0"
                /* popoverClassName="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-[50] min-w-full popover-enter" */
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    label={currentSortLabel}
                    isActive={sortBy !== "NEWEST"}
                    isOpen={isOpen}
                    icon={SlidersHorizontal}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={sortOptions}
                    value={sortBy}
                    onChange={setSortBy}
                    close={close}
                  />
                )}
              </Dropdown>
            )}

            <Button
              variant={showAdvanced ? "secondary" : "outline"}
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`flex items-center gap-2 h-[40px] md:h-[46px] text-[13px] shrink-0 font-semibold`}
            >
              <Filter size={16} />
              Add Filter
            </Button>

            {setCrmOnly && (
              <Button
                type="button"
                variant={crmOnly ? "secondary" : "outline"}
                onClick={() => setCrmOnly(!crmOnly)}
                className={`flex items-center gap-2 h-[40px] md:h-[46px] text-[13px] shrink-0 font-semibold ${crmOnly ? "ring-1 ring-mauve-4" : ""}`}
              >
                <Briefcase size={16} />
                SORS
              </Button>
            )}
          </div>

          {actions}

          {/* CLEAR ALL ESCAPE HATCH */}
          {isAnyFilterActive && (
            <Button
              variant="ghost"
              onClick={handleClearAll}
              className="h-auto ml-auto xl:ml-2 text-sm text-muted-foreground hover:text-black hover:bg-transparent font-semibold px-3 py-2 shrink-0 transition-colors"
            >
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Advanced Filters */}
      {showAdvanced && (
        <div className="bg-mauve-2 border border-[#E5E7EB] p-4 rounded-xl flex flex-wrap gap-3 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Status Filter */}
          {showStatusFilter && (
            <Dropdown
              disabled={disableStatusFilter}
              className="flex-1 min-w-[170px]"
              /* popoverClassName="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-[50] min-w-full popover-enter" */
              trigger={({ isOpen, disabled }) => (
                <FilterTrigger
                  label={currentStatusLabel}
                  isActive={statusFilter !== "ALL"}
                  isOpen={isOpen}
                  icon={Filter}
                  disabled={disabled}
                />
              )}
            >
              {({ close }) => (
                <FilterOptionList
                  options={statusOptions}
                  value={statusFilter}
                  onChange={setStatusFilter}
                  close={close}
                />
              )}
            </Dropdown>
          )}

          {/* Priority */}
          <PriorityDropdown
            value={priorityFilter}
            onChange={(val) => setPriorityFilter(val)}
            className="flex-1 min-w-[150px]"
            hasAll={true}
            customTrigger={({ isOpen, currentPriority }) => {
              const isActive = priorityFilter && priorityFilter !== "ALL";
              return (
                <div
                  className={`h-[40px] md:h-[46px] w-full flex items-center justify-between px-3 rounded-lg border transition-all cursor-pointer ${
                    isOpen || isActive
                      ? "ring-1 ring-mauve-4 bg-muted font-medium"
                      : "border-border bg-card hover:border-border/80"
                  }`}
                >
                  <div className="flex items-center gap-2 overflow-hidden flex-1">
                    <div
                      className={`w-2 h-2 shrink-0 rounded-full ${currentPriority.dot}`}
                    />
                    <span className="text-[13px] text-foreground font-500 truncate block w-full text-left">
                      {currentPriority.value === "ALL"
                        ? "All"
                        : currentPriority.label}
                    </span>
                  </div>
                  <ChevronDown
                    size={14}
                    className={`ml-1 shrink-0 text-muted-foreground transition-transform ${
                      isOpen ? "rotate-180" : ""
                    }`}
                  />
                </div>
              );
            }}
          />

          {/* Dept */}
          <Dropdown
            disabled={
              disableDeptFilter !== undefined
                ? disableDeptFilter
                : !isHr || isFiltersReadOnly
            }
            className="flex-1 min-w-[180px]"
            /* popoverClassName="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-[50] min-w-full popover-enter max-h-[300px] overflow-y-auto" */
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={currentDeptLabel}
                isActive={deptFilter !== "ALL"}
                isOpen={isOpen}
                icon={Building2}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={deptOptions}
                value={deptFilter}
                onChange={(val) => {
                  setDeptFilter(val);
                  setSubDeptFilter("ALL");
                }}
                close={close}
              />
            )}
          </Dropdown>

          {/* Sub-Dept */}
          <Dropdown
            disabled={deptFilter === "ALL" || isFiltersReadOnly}
            className="flex-1 min-w-[180px]"
            /* popoverClassName="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-[50] min-w-full popover-enter max-h-[300px] overflow-y-auto" */
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={currentSubDeptLabel}
                isActive={subDeptFilter !== "ALL"}
                isOpen={isOpen}
                icon={Building2}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={subDeptOptions}
                value={subDeptFilter}
                onChange={setSubDeptFilter}
                close={close}
              />
            )}
          </Dropdown>

          {/* Employees */}
          <Dropdown
            disabled={isFiltersReadOnly}
            className="flex-1 min-w-[180px]"
            trigger={({ isOpen, disabled }) => (
              <FilterTrigger
                label={currentEmployeeLabel}
                isActive={employeeFilter !== "ALL"}
                isOpen={isOpen}
                icon={Users}
                disabled={disabled}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={employeeOptions}
                value={employeeFilter}
                onChange={setEmployeeFilter}
                close={close}
              />
            )}
          </Dropdown>

          {/* Reported To */}
          {setReportedToFilter && (
            <Dropdown
              className="flex-1 min-w-[180px]"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  label={currentReportedToLabel}
                  isActive={reportedToFilter !== "ALL"}
                  isOpen={isOpen}
                  icon={Users}
                />
              )}
            >
              {({ close }) => (
                <FilterOptionList
                  options={reportedToOptions}
                  value={reportedToFilter}
                  onChange={setReportedToFilter}
                  close={close}
                />
              )}
            </Dropdown>
          )}
        </div>
      )}
    </div>
  );
}

import React, { useState } from "react";
import {
  Search,
  Filter,
  Users,
  Building2,
  Calendar as CalendarIcon,
  ChevronDown,
} from "lucide-react";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";

export default function GroupTaskFilters({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
  creatorFilter,
  setCreatorFilter,
  memberFilter,
  setMemberFilter,
  deptFilter,
  setDeptFilter,
  subDeptFilter,
  setSubDeptFilter,
  timeframe,
  setTimeframe,
  selectedDateFilter,
  setSelectedDateFilter,
  dueDate,
  setDueDate,
  uniqueCreators = [],
  uniqueDepts = [],
  uniqueSubDepts = [],
  uniqueMembers = [],
  actions,
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isAnyFilterActive =
    statusFilter !== "ALL" ||
    creatorFilter !== "ALL" ||
    memberFilter !== "ALL" ||
    deptFilter !== "ALL" ||
    subDeptFilter !== "ALL" ||
    selectedDateFilter !== "" ||
    dueDate !== null ||
    searchTerm !== "";

  const handleClearAll = () => {
    setSearchTerm("");
    if (setStatusFilter) setStatusFilter("ALL");
    if (setCreatorFilter) setCreatorFilter("ALL");
    if (setMemberFilter) setMemberFilter("ALL");
    if (setDeptFilter) setDeptFilter("ALL");
    if (setSubDeptFilter) setSubDeptFilter("ALL");
    if (setSelectedDateFilter) setSelectedDateFilter("");
    if (setDueDate) setDueDate(null);
  };

  const timeframeOptions = [
    { value: "DAILY", label: "Daily" },
    { value: "WEEKLY", label: "Weekly" },
    { value: "MONTHLY", label: "Monthly" },
    { value: "YEARLY", label: "Yearly" },
  ];

  const statusOptions = [
    { value: "ALL", label: "All" },
    { value: "ACTIVE", label: "Active" },
    { value: "COMPLETED", label: "Completed" },
  ];

  const creatorOptions = [
    { value: "ALL", label: "Created By: Everyone" },
    ...uniqueCreators.map((c) => ({ value: c.id, label: c.name })),
  ];

  const memberOptions = [
    { value: "ALL", label: "Member: Everyone" },
    ...uniqueMembers.map((m) => ({ value: m.id, label: m.name })),
  ];

  const deptOptions = [
    { value: "ALL", label: "All Depts" },
    ...uniqueDepts.filter((d) => d !== "ALL").map((d) => ({ value: d, label: d })),
  ];

  const subDeptOptions = [
    { value: "ALL", label: "All Sub-Depts" },
    ...uniqueSubDepts.filter((s) => s !== "ALL").map((s) => ({ value: s, label: s })),
  ];

  const currentStatusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label ||
    statusOptions[0].label;
  const currentCreatorLabel =
    creatorOptions.find((o) => o.value === creatorFilter)?.label ||
    creatorOptions[0].label;
  const currentMemberLabel =
    memberOptions.find((o) => o.value === memberFilter)?.label ||
    memberOptions[0].label;
  const currentDeptLabel =
    deptOptions.find((o) => o.value === deptFilter)?.label ||
    deptOptions[0].label;
  const currentSubDeptLabel =
    subDeptOptions.find((o) => o.value === subDeptFilter)?.label ||
    subDeptOptions[0].label;
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
            placeholder="Search group tasks, creators, or members..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 block h-[40px] md:h-[46px]"
          />
        </div>

        {/* Action Group */}
        <div className="flex items-center gap-2 w-full xl:w-auto flex-wrap justify-between xl:justify-start relative z-10">
          <div className="flex gap-2 items-center flex-wrap">
            {/* DATE PICKER FOR CREATED AT */}
            <div
              className={`flex items-center border rounded-lg h-[40px] md:h-[46px] shadow-sm transition-all shrink-0 ${
                selectedDateFilter
                  ? "bg-muted ring-1 ring-mauve-4 font-medium"
                  : "bg-card border-border hover:border-border/80 text-foreground"
              }`}
            >
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
                      if (val === "YEARLY") setSelectedDateFilter(`${y}`);
                      else if (val === "MONTHLY") setSelectedDateFilter(`${y}-${m}`);
                      else setSelectedDateFilter(`${y}-${m}-${d}`);
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
                              ? new Date(selectedDateFilter).toLocaleDateString("en-US", { month: "long", year: "numeric" })
                              : new Date(selectedDateFilter).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                          : timeframe === "YEARLY"
                            ? "Select Year"
                            : timeframe === "MONTHLY"
                              ? "Select Month"
                              : "Select Date"}
                      </span>
                      {selectedDateFilter && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDateFilter("");
                          }}
                          className="hover:text-foreground text-muted-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              >
                {({ close }) => (
                  <div className="p-1">
                    <DatePicker
                      selected={selectedDateFilter ? new Date(selectedDateFilter) : null}
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

            <Button
              variant={showAdvanced ? "secondary" : "outline"}
              onClick={() => setShowAdvanced(!showAdvanced)}
              className={`flex items-center gap-2 h-[40px] md:h-[46px] text-[13px] shrink-0 font-semibold`}
            >
              <Filter size={16} />
              Add Filter
            </Button>
          </div>

          {actions}

          {isAnyFilterActive && (
            <button
              onClick={handleClearAll}
              className="ml-auto xl:ml-2 text-sm text-muted-foreground hover:text-black font-semibold px-3 py-2 shrink-0 transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Advanced Filters */}
      {showAdvanced && (
        <div className="bg-mauve-2 border border-[#E5E7EB] p-4 rounded-xl flex flex-wrap gap-3 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
          <Dropdown
            className="flex-1 min-w-[170px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentStatusLabel}
                isActive={statusFilter !== "ALL"}
                isOpen={isOpen}
                icon={Filter}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList options={statusOptions} value={statusFilter} onChange={setStatusFilter} close={close} />
            )}
          </Dropdown>

          <Dropdown
            className="flex-1 min-w-[180px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentDeptLabel}
                isActive={deptFilter !== "ALL"}
                isOpen={isOpen}
                icon={Building2}
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

          <Dropdown
            disabled={deptFilter === "ALL"}
            className="flex-1 min-w-[180px]"
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
              <FilterOptionList options={subDeptOptions} value={subDeptFilter} onChange={setSubDeptFilter} close={close} />
            )}
          </Dropdown>

          <Dropdown
            className="flex-1 min-w-[180px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentCreatorLabel}
                isActive={creatorFilter !== "ALL"}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList options={creatorOptions} value={creatorFilter} onChange={setCreatorFilter} close={close} />
            )}
          </Dropdown>

          <Dropdown
            className="flex-1 min-w-[180px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentMemberLabel}
                isActive={memberFilter !== "ALL"}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList options={memberOptions} value={memberFilter} onChange={setMemberFilter} close={close} />
            )}
          </Dropdown>

          {/* DUE DATE FILTER */}
          <Dropdown
            usePortal
            placement="bottom-start"
            className="flex-1 min-w-[150px]"
            trigger={({ isOpen }) => (
              <div
                className={`bg-card flex items-center border rounded-lg px-3 py-2.5 h-[40px] md:h-[46px] shadow-sm transition-colors shrink-0 cursor-pointer w-full group ${
                  dueDate || isOpen
                    ? "text-foreground border-primary/20 font-medium ring-1 ring-mauve-4 bg-muted"
                    : "border-border hover:border-border/80 text-foreground"
                }`}
              >
                <CalendarIcon
                  size={16}
                  className={`${dueDate || isOpen ? "text-foreground" : "text-muted-foreground"} mr-2 shrink-0`}
                />
                <div
                  className={`bg-transparent outline-none w-full text-[13px] flex items-center justify-between ${
                    dueDate ? "text-foreground font-medium" : "text-muted-foreground"
                  }`}
                >
                  <span className="truncate">
                    {dueDate
                      ? dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      : "Due Date"}
                  </span>
                  {dueDate && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDueDate(null);
                      }}
                      className="hover:text-foreground text-muted-foreground p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  )}
                </div>
              </div>
            )}
          >
            {({ close }) => (
              <div className="p-1">
                <DatePicker
                  selected={dueDate}
                  onChange={(date) => {
                    setDueDate(date);
                    close();
                  }}
                  inline
                />
              </div>
            )}
          </Dropdown>
        </div>
      )}
    </div>
  );
}

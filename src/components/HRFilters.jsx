import React, { useState } from "react";
import {
  Search,
  Filter,
  Building2,
  Users,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import Dropdown from "./ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "./ui/FilterDropdown";

/**
 * HRFilters
 * Filter bar for the Employee Management table.
 * Mirrors the pattern established in TaskFilters.
 */
export default function HRFilters({
  searchTerm,
  setSearchTerm,
  deptFilter,
  setDeptFilter,
  subDeptFilter,
  setSubDeptFilter,
  roleFilter,
  setRoleFilter,
  roleFlagFilter,
  setRoleFlagFilter,
  statusFilter,
  setStatusFilter,
  sortBy,
  setSortBy,
  uniqueDepts = [],
  uniqueSubDepts = [],
  uniqueRoles = [],
  uniqueStatuses = [],
}) {
  const [showAdvanced, setShowAdvanced] = useState(
    deptFilter !== "ALL" ||
      subDeptFilter !== "ALL" ||
      roleFilter !== "ALL" ||
      roleFlagFilter !== "ALL" ||
      statusFilter !== "ALL",
  );

  const isAnyFilterActive =
    searchTerm !== "" ||
    deptFilter !== "ALL" ||
    subDeptFilter !== "ALL" ||
    roleFilter !== "ALL" ||
    roleFlagFilter !== "ALL" ||
    statusFilter !== "ALL" ||
    (sortBy !== undefined && sortBy !== "NAME_ASC");

  const handleClearAll = () => {
    setSearchTerm("");
    setDeptFilter("ALL");
    setSubDeptFilter("ALL");
    setRoleFilter("ALL");
    setRoleFlagFilter("ALL");
    setStatusFilter("ALL");
    if (setSortBy) setSortBy("NAME_ASC");
  };

  // ── Options ────────────────────────────────────────────────────────────────

  const sortOptions = [
    { value: "NAME_ASC", label: "Name (A–Z)" },
    { value: "NAME_DESC", label: "Name (Z–A)" },
    { value: "DEPT", label: "By Department" },
  ];

  const deptOptions = [
    { value: "ALL", label: "All Departments" },
    ...uniqueDepts.filter((d) => d !== "ALL").map((d) => ({ value: d, label: d })),
  ];

  const subDeptOptions = [
    { value: "ALL", label: "All Sub-Depts" },
    ...uniqueSubDepts
      .filter((s) => s !== "ALL")
      .map((s) => ({ value: s, label: s })),
  ];

  const roleOptions = [
    { value: "ALL", label: "All Roles" },
    ...uniqueRoles.filter((r) => r !== "ALL").map((r) => ({ value: r, label: r })),
  ];

  const roleFlagOptions = [
    { value: "ALL", label: "All Flags" },
    { value: "SUPER_ADMIN", label: "Super Admin" },
    { value: "HR", label: "HR" },
    { value: "HEAD", label: "Head" },
    { value: "LEAVE_MANAGER", label: "Leave Manager" },
    { value: "STANDARD", label: "Standard" },
  ];

  const statusOptions = [
    { value: "ALL", label: "All Statuses" },
    ...uniqueStatuses.filter((s) => s !== "ALL").map((s) => ({ value: s, label: s })),
  ];

  // ── Labels ─────────────────────────────────────────────────────────────────

  const currentSortLabel =
    sortOptions.find((o) => o.value === sortBy)?.label || sortOptions[0].label;
  const currentDeptLabel =
    deptOptions.find((o) => o.value === deptFilter)?.label || deptOptions[0].label;
  const currentSubDeptLabel =
    subDeptOptions.find((o) => o.value === subDeptFilter)?.label ||
    subDeptOptions[0].label;
  const currentRoleLabel =
    roleOptions.find((o) => o.value === roleFilter)?.label || roleOptions[0].label;
  const currentRoleFlagLabel =
    roleFlagOptions.find((o) => o.value === roleFlagFilter)?.label ||
    roleFlagOptions[0].label;
  const currentStatusLabel =
    statusOptions.find((o) => o.value === statusFilter)?.label || statusOptions[0].label;

  return (
    <div className="grid gap-3 md:gap-4">
      {/* Row 1: Search & Permanent Controls */}
      <div className="bg-card border border-border p-3 md:p-4 rounded-xl flex flex-col xl:flex-row items-stretch xl:items-center gap-3 md:gap-4 relative z-20 shadow-sm">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={18}
          />
          <Input
            type="text"
            placeholder="Search by name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 block h-[40px] md:h-[46px]"
          />
        </div>

        {/* Action Group */}
        <div className="flex items-center gap-2 w-full xl:w-auto flex-wrap justify-between xl:justify-start relative z-10">
          <div className="flex gap-2 items-center flex-wrap">
            {/* Sort */}
            {sortBy !== undefined && setSortBy && (
              <Dropdown
                usePortal={true}
                className="min-w-[150px] shrink-0"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    label={currentSortLabel}
                    isActive={sortBy !== "NAME_ASC"}
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

            {/* Add Filter */}
            <Button
              variant={showAdvanced ? "secondary" : "outline"}
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 h-[40px] md:h-[46px] text-[13px] shrink-0 font-semibold"
            >
              <Filter size={16} />
              Add Filter
            </Button>
          </div>

          {/* Clear All */}
          {isAnyFilterActive && (
            <Button
              variant="ghost"
              onClick={handleClearAll}
              className="h-auto ml-auto xl:ml-2 text-sm text-muted-foreground hover:text-foreground hover:bg-transparent font-semibold px-3 py-2 shrink-0 transition-colors"
            >
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Advanced Filters */}
      {showAdvanced && (
        <div className="bg-mauve-2 border border-border p-4 rounded-xl flex flex-wrap gap-3 relative z-10 animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Department */}
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

          {/* Sub-Department */}
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
              <FilterOptionList
                options={subDeptOptions}
                value={subDeptFilter}
                onChange={setSubDeptFilter}
                close={close}
              />
            )}
          </Dropdown>

          {/* Role */}
          <Dropdown
            className="flex-1 min-w-[160px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentRoleLabel}
                isActive={roleFilter !== "ALL"}
                isOpen={isOpen}
                icon={Users}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={roleOptions}
                value={roleFilter}
                onChange={setRoleFilter}
                close={close}
              />
            )}
          </Dropdown>

          {/* Role Flag */}
          <Dropdown
            className="flex-1 min-w-[160px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentRoleFlagLabel}
                isActive={roleFlagFilter !== "ALL"}
                isOpen={isOpen}
                icon={Shield}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={roleFlagOptions}
                value={roleFlagFilter}
                onChange={setRoleFlagFilter}
                close={close}
              />
            )}
          </Dropdown>

          {/* Status */}
          <Dropdown
            className="flex-1 min-w-[160px]"
            trigger={({ isOpen }) => (
              <FilterTrigger
                label={currentStatusLabel}
                isActive={statusFilter !== "ALL"}
                isOpen={isOpen}
                icon={Users}
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
        </div>
      )}
    </div>
  );
}

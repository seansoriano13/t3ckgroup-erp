import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, User, Users, Building2, BadgeCheck, Globe, X } from "lucide-react";

import Dropdown from "@/components/ui/Dropdown";
import { cn } from "@/lib/utils";
import { employeeService } from "@/services/employeeService";
import { employeeGroupService } from "@/services/employeeGroupService";
import { DEAL_TEAM_ROLES, SELECTOR_TYPES, departmentOptions, selectorKey, teamOptions } from "@/utils/resolvePeople";

/**
 * Issue #201 — the one people picker for every setting that asks "who".
 *
 * Its value is a list of selectors (see `src/utils/resolvePeople.js`): a
 * specific employee, an Employee Group, everyone in a Team, and — where the
 * setting is per SOR — a Deal Team role. Call sites turn the role option on
 * with `allowRoles`, "Everyone" with `allowEveryone` and "Everyone in a Department" with `allowDepartments` (Flow Canvas access pickers only); `types` narrows the offer further (the group editor
 * picks only employees, or only Teams).
 *
 * Archived groups are never offered, but one already in the value still shows
 * by name: archiving hides a group from pickers, it does not empty a setting.
 */
export default function PeoplePicker({
  value = [],
  onChange,
  allowRoles = false,
  allowEveryone = false,
  allowDepartments = false,
  types = [SELECTOR_TYPES.GROUP, SELECTOR_TYPES.TEAM, SELECTOR_TYPES.EMPLOYEE],
  disabled = false,
  placeholder = "Add people",
  className,
}) {
  const [search, setSearch] = useState("");

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["employeeGroups", "all"],
    queryFn: () => employeeGroupService.list({ includeArchived: true }),
  });

  const teams = useMemo(
    () => teamOptions(employees.map((e) => ({ ...e, sub_department: e.subDepartment }))),
    [employees],
  );
  const departments = useMemo(() => departmentOptions(employees), [employees]);

  const chosen = new Set(value.map(selectorKey));
  const needle = search.trim().toLowerCase();
  const matches = (text) => !needle || String(text || "").toLowerCase().includes(needle);

  const options = [
    ...(allowEveryone && matches("Everyone")
      ? [
          {
            selector: { type: SELECTOR_TYPES.EVERYONE },
            label: "Everyone",
            section: "Everyone",
            icon: Globe,
          },
        ]
      : []),
    ...(allowDepartments
      ? departments
          .filter(matches)
          .map((department) => ({
            selector: { type: SELECTOR_TYPES.DEPARTMENT, department },
            label: `Everyone in ${department} department`,
            section: "Departments",
            icon: Building2,
          }))
      : []),
    ...groups
      .filter((g) => !g.archived_at && matches(g.name))
      .map((g) => ({
        selector: { type: SELECTOR_TYPES.GROUP, id: g.id },
        label: `${g.name} (${g.memberIds.length})`,
        section: "Employee Groups",
        icon: Users,
      })),
    ...teams
      .filter(matches)
      .map((team) => ({
        selector: { type: SELECTOR_TYPES.TEAM, team },
        label: `Everyone in ${team}`,
        section: "Teams",
        icon: Building2,
      })),
    ...(allowRoles
      ? Object.entries(DEAL_TEAM_ROLES)
          .filter(([, meta]) => matches(meta.label))
          .map(([role, meta]) => ({
            selector: { type: SELECTOR_TYPES.ROLE, role },
            label: meta.label,
            section: "Deal Team",
            icon: BadgeCheck,
          }))
      : []),
    ...employees
      .filter((e) => matches(e.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({
        selector: { type: SELECTOR_TYPES.EMPLOYEE, id: e.id },
        label: e.name,
        section: "Employees",
        icon: User,
      })),
  ].filter(
    (option) =>
      (types.includes(option.selector.type) ||
        option.selector.type === SELECTOR_TYPES.ROLE ||
        option.selector.type === SELECTOR_TYPES.EVERYONE ||
        option.selector.type === SELECTOR_TYPES.DEPARTMENT) &&
      !chosen.has(selectorKey(option.selector)),
  );

  const labelFor = (selector) => {
    switch (selector.type) {
      case SELECTOR_TYPES.GROUP: {
        const group = groups.find((g) => g.id === selector.id);
        if (!group) return "Unknown group";
        return `${group.name} (${group.memberIds.length})${group.archived_at ? " · archived" : ""}`;
      }
      case SELECTOR_TYPES.TEAM:
        return `Everyone in ${selector.team}`;
      case SELECTOR_TYPES.DEPARTMENT:
        return `Everyone in ${selector.department} department`;
      case SELECTOR_TYPES.EVERYONE:
        return "Everyone";
      case SELECTOR_TYPES.ROLE:
        return DEAL_TEAM_ROLES[selector.role]?.label || selector.role;
      default:
        return employees.find((e) => e.id === selector.id)?.name || "Former employee";
    }
  };

  const add = (selector) => onChange?.([...value, selector]);
  const remove = (key) => onChange?.(value.filter((s) => selectorKey(s) !== key));

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {value.map((selector) => {
        const key = selectorKey(selector);
        return (
          <span
            key={key}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-xs font-semibold text-foreground"
          >
            {labelFor(selector)}
            {!disabled && (
              <button
                type="button"
                aria-label={`Remove ${labelFor(selector)}`}
                onClick={() => remove(key)}
                className="rounded text-muted-foreground hover:text-destructive"
              >
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}

      {!disabled && (
        <Dropdown
          usePortal
          placement="bottom-start"
          onClose={() => setSearch("")}
          popoverClassName="popover-enter z-[10001] w-[18rem] rounded-2xl bg-popover p-1.5 shadow-2xl ring-1 ring-mauve-6"
          trigger={({ isOpen }) => (
            <button
              type="button"
              className={cn(
                "inline-flex items-center gap-1 rounded-lg border border-dashed border-mauve-7 px-2 py-1 text-xs font-semibold transition-colors",
                isOpen ? "border-primary text-primary" : "text-muted-foreground hover:border-primary hover:text-primary",
              )}
            >
              <Plus size={12} /> {placeholder}
            </button>
          )}
        >
          {({ close }) => (
            <div className="flex min-h-0 flex-col">
              <div className="flex items-center gap-2 border-b border-border px-2 pb-1.5">
                <Search size={14} className="text-muted-foreground" />
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search people, groups, teams, departments"
                  className="h-8 w-full bg-transparent text-sm focus:outline-none"
                />
              </div>
              <div className="min-h-0 overflow-y-auto py-1">
                {options.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing matches.</p>
                )}
                {options.map((option, index) => {
                  const heading = option.section !== options[index - 1]?.section ? option.section : null;
                  const Icon = option.icon;
                  return (
                    <div key={selectorKey(option.selector)}>
                      {heading && (
                        <p className="px-2.5 pb-1 pt-2 text-label font-black uppercase tracking-[0.15em] text-muted-foreground">
                          {heading}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          add(option.selector);
                          close();
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <Icon size={14} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">{option.label}</span>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Dropdown>
      )}
    </div>
  );
}

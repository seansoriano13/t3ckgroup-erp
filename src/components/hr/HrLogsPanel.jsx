import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  X,
  Filter,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  UserCog,
  Tags,
  Timer,
  CalendarClock,
  CalendarHeart,
  ShieldCheck,
  Users,
  Activity,
  Settings,
} from "lucide-react";
import { Button } from "../ui/button";
import { systemAuditLogService, HR_ENTITY_TYPES } from "../../services/systemAuditLogService";
import { employeeService } from "../../services/employeeService";
import { useEmployeeAvatarMap } from "../../hooks/useEmployeeAvatarMap";
import Avatar from "../Avatar";
import HighlightText from "../HighlightText";
import Dot from "../ui/Dot";
import Dropdown from "../ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../ui/FilterDropdown";
import { Input } from "@/components/ui/input";
import { FieldBox } from "@/components/ui/FieldBox";

const PAGE_SIZE = 30;

const ENTITY_CONFIG = {
  EMPLOYEE: { label: "Employee", icon: UserCog, style: "bg-blue-a2 text-blue-11 border-blue-a4" },
  CATEGORY: { label: "Category", icon: Tags, style: "bg-orange-a2 text-orange-11 border-orange-a4" },
  OVERTIME: { label: "Overtime", icon: Timer, style: "bg-primary/10 text-primary border-primary/20" },
  OFFSET_LEAVE: { label: "Offset Leave", icon: CalendarClock, style: "bg-blue-2 text-blue-11 border-blue-6" },
  SIL_LEAVE: { label: "SIL Leave", icon: CalendarHeart, style: "bg-green-2 text-green-11 border-green-6" },
  HR_SETTINGS: { label: "Settings", icon: Settings, style: "bg-purple-a2 text-purple-11 border-purple-a4" },
};

function formatWhen(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function HrLogsPanel() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [liveAnim, setLiveAnim] = useState(false);
  const avatarMap = useEmployeeAvatarMap();

  const [filters, setFilters] = useState({
    entityType: "ALL",
    type: "ALL",
    authorId: "ALL",
    employeeId: "ALL",
    search: "",
  });

  const [debouncedSearch, setDebouncedSearch] = useState(filters.search);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search), 300);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const queryFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  );

  const offset = useMemo(() => page * PAGE_SIZE, [page]);

  useEffect(() => {
    queueMicrotask(() => setPage(0));
  }, [filters.entityType, filters.type, filters.authorId, filters.employeeId, debouncedSearch]);

  useEffect(() => {
    const handleNewEntry = (entry) => {
      if (!HR_ENTITY_TYPES.includes(entry?.entity_type)) return;
      setLiveAnim(true);
      setTimeout(() => setLiveAnim(false), 2000);
      queryClient.invalidateQueries({ queryKey: ["hrActivityLog"] });
    };

    const sub = systemAuditLogService.subscribeToAllActivity(handleNewEntry);
    return () => systemAuditLogService.unsubscribeFromActivity(sub);
  }, [queryClient]);

  const { data: employees = [] } = useQuery({
    queryKey: ["allEmployees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const {
    data: entries = [],
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["hrActivityLog", offset, queryFilters],
    queryFn: () =>
      systemAuditLogService.getRecentHrActivity({
        limit: PAGE_SIZE,
        offset,
        entityType: queryFilters.entityType,
        type: queryFilters.type,
        authorId: queryFilters.authorId,
        employeeId: queryFilters.employeeId,
        search: queryFilters.search,
      }),
    staleTime: 15_000,
  });

  const hasActiveFilters =
    filters.entityType !== "ALL" ||
    filters.type !== "ALL" ||
    filters.authorId !== "ALL" ||
    filters.employeeId !== "ALL" ||
    filters.search !== "";

  const clearFilters = () =>
    setFilters({ entityType: "ALL", type: "ALL", authorId: "ALL", employeeId: "ALL", search: "" });

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="bg-card border border-border rounded-2xl shadow-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 bg-muted/30">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <div className="w-[18px] h-[18px] rounded flex items-center justify-center bg-muted border border-border shrink-0">
              <Filter size={10} className="text-muted-foreground" />
            </div>
            <ChevronDown size={11} className="text-muted-foreground -rotate-90" />
            <span className="font-medium text-muted-foreground/80">Filters</span>
            {hasActiveFilters && (
              <span className="ml-1 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-primary/10 text-primary border border-primary/20">
                Active
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border transition-all duration-300 ${liveAnim ? "bg-green-a2 border-green-a4 text-green-11" : "bg-transparent border-transparent text-muted-foreground/60"}`}
            >
              <Dot
                size="w-1.5 h-1.5"
                color={liveAnim ? "bg-green-9 shadow-[0_0_8px_var(--green-9)]" : "bg-muted-foreground/40"}
                className={liveAnim ? "animate-pulse" : ""}
              />
              <span className="text-[10px] font-bold uppercase tracking-wider">
                {liveAnim ? "New Update" : "Live"}
              </span>
            </div>
            {hasActiveFilters && (
              <Button
                type="button"
                variant="ghost"
                onClick={clearFilters}
                className="h-auto p-0 flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-transparent transition-colors cursor-pointer"
              >
                <X size={12} /> Clear
              </Button>
            )}
          </div>
        </div>

        <div className="px-4 py-3.5 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-x-3 gap-y-4">
          <div className="lg:col-span-2">
            <FieldBox label="Search" className="pl-1 block mb-1.5" />
            <div className="relative flex items-center">
              <Search size={13} className="absolute left-3 text-muted-foreground pointer-events-none shrink-0" />
              <Input
                value={filters.search}
                onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))}
                placeholder="Search log content..."
                containerClassName="w-full" className="bg-card border border-border rounded-lg pl-8 pr-3 h-[40px] md:h-[46px] text-[13px] text-foreground outline-none focus:ring-1 focus:ring-mauve-4 hover:border-border/80 transition-all placeholder:text-muted-foreground"
              />
            </div>
          </div>

          <div>
            <FieldBox label="Category" className="pl-1 block mb-1.5" />
            <Dropdown
              usePortal
              className="w-full"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  label={filters.entityType === "ALL" ? "All Categories" : ENTITY_CONFIG[filters.entityType]?.label || filters.entityType}
                  isActive={filters.entityType !== "ALL"}
                  isOpen={isOpen}
                  icon={Activity}
                />
              )}
            >
              {({ close }) => (
                <FilterOptionList
                  options={[
                    { value: "ALL", label: "All Categories" },
                    ...HR_ENTITY_TYPES.map((t) => ({ value: t, label: ENTITY_CONFIG[t]?.label || t })),
                  ]}
                  value={filters.entityType}
                  onChange={(val) => {
                    setFilters((p) => ({ ...p, entityType: val }));
                    close();
                  }}
                  close={close}
                />
              )}
            </Dropdown>
          </div>

          <div>
            <FieldBox label="Action Type" className="pl-1 block mb-1.5" />
            <Dropdown
              usePortal
              className="w-full"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  label={filters.type === "ALL" ? "All Actions" : filters.type === "APPROVAL" ? "Decisions" : "Updates"}
                  isActive={filters.type !== "ALL"}
                  isOpen={isOpen}
                  icon={ShieldCheck}
                />
              )}
            >
              {({ close }) => (
                <FilterOptionList
                  options={[
                    { value: "ALL", label: "All Actions" },
                    { value: "APPROVAL", label: "Decisions (Approve/Reject)" },
                    { value: "SYSTEM", label: "Updates (Apply/Undo/Withdraw)" },
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
          </div>

          <div>
            <FieldBox label="Actor" className="pl-1 block mb-1.5" />
            <Dropdown
              usePortal
              className="w-full"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  label={
                    filters.authorId === "ALL"
                      ? "All Actors"
                      : employees.find((e) => e.id === filters.authorId)?.name || "All Actors"
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
                    ...employees.map((emp) => ({ value: emp.id, label: emp.name })),
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
          </div>

          <div>
            <FieldBox label="Employee Involved" className="pl-1 block mb-1.5" />
            <Dropdown
              usePortal
              className="w-full"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  label={
                    filters.employeeId === "ALL"
                      ? "All Employees"
                      : employees.find((e) => e.id === filters.employeeId)?.name || "All Employees"
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
                    ...employees.map((emp) => ({ value: emp.id, label: emp.name })),
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
          </div>
        </div>
      </div>

      {/* Entry count */}
      {!isLoading && !isError && entries.length > 0 && (
        <p className="text-[11px] font-semibold text-muted-foreground/70 px-0.5">
          {entries.length} entr{entries.length === 1 ? "y" : "ies"}
          {hasActiveFilters && " (filtered)"}
        </p>
      )}

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-4 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-2.5 w-24 bg-muted rounded-full" />
                  <div className="h-3.5 w-2/3 bg-muted rounded-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="py-8 px-5 rounded-2xl border border-red-a5 bg-red-a2 flex items-start gap-4">
          <div className="w-8 h-8 rounded-lg bg-red-a3 border border-red-a5 flex items-center justify-center shrink-0">
            <X size={15} className="text-red-11" />
          </div>
          <div>
            <p className="text-red-11 font-black text-sm">Failed to load HR logs</p>
            <p className="text-red-11/70 text-xs mt-1 font-medium">{error?.message || "Unknown error"}</p>
          </div>
        </div>
      ) : entries.length === 0 ? (
        <div className="py-16 flex flex-col items-center justify-center text-center gap-3 bg-muted/20 rounded-2xl border border-border">
          <div className="w-12 h-12 rounded-xl bg-muted border border-border flex items-center justify-center mb-1">
            <Activity size={20} className="text-muted-foreground/40" />
          </div>
          <p className="text-sm font-black text-foreground">No HR activity found</p>
          <p className="text-xs text-muted-foreground/70 font-medium max-w-[240px]">
            {hasActiveFilters ? "Try adjusting your filters." : "Employee, category, and leave/OT actions will show up here."}
          </p>
          {hasActiveFilters && (
            <Button variant="link" onClick={clearFilters} className="h-auto p-0 text-xs font-semibold text-primary hover:underline mt-1 cursor-pointer">
              Clear filters
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const cfg = ENTITY_CONFIG[e.entityType] || { label: e.entityType, icon: Activity, style: "bg-mauve-a2 text-mauve-11 border-mauve-a4" };
            const Icon = cfg.icon;
            const involvedEmployee = e.metadata?.employeeId
              ? employees.find((emp) => emp.id === e.metadata.employeeId)
              : null;

            return (
              <div key={e.id} className="bg-card border border-border rounded-xl p-4 animate-in fade-in duration-200">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-muted border border-border flex items-center justify-center shrink-0">
                    <Icon size={14} className="text-muted-foreground" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 mb-1.5 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm border ${cfg.style}`}>
                          {cfg.label}
                        </span>
                        {e.type === "APPROVAL" && (
                          <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-violet-3 text-violet-11 border border-violet-5">
                            Decision
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0 text-muted-foreground/60">
                        <Clock size={10} />
                        <span className="text-[11px] font-bold">{formatWhen(e.createdAt)}</span>
                      </div>
                    </div>

                    <p className="text-sm font-semibold text-foreground leading-relaxed">
                      <HighlightText text={e.content} search={filters.search} />
                    </p>

                    <div className="flex items-center gap-4 mt-2.5 flex-wrap">
                      <div className="flex items-center gap-1.5">
                        <Avatar
                          name={e.authorName || "System"}
                          src={avatarMap.get(e.authorId)}
                          size="xxs"
                          className="bg-mauve-4 text-mauve-12 shadow-sm"
                        />
                        <span className="text-[11px] font-semibold text-muted-foreground">
                          {e.authorName || "System"}
                        </span>
                      </div>
                      {involvedEmployee && involvedEmployee.id !== e.authorId && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-muted-foreground/50 font-bold uppercase">for</span>
                          <Avatar
                            name={involvedEmployee.name}
                            src={avatarMap.get(involvedEmployee.id)}
                            size="xxs"
                            className="bg-mauve-4 text-mauve-12 shadow-sm"
                          />
                          <span className="text-[11px] font-semibold text-muted-foreground">
                            {involvedEmployee.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {entries.length > 0 && (
        <div className="flex items-center justify-center gap-3 pt-3 border-t border-border/40">
          <Button
            variant="outline"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="h-auto flex items-center gap-1.5 px-4 py-2 rounded-xl border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <ChevronLeft size={14} /> Newer
          </Button>
          <span className="text-[11px] font-bold text-muted-foreground">Page {page + 1}</span>
          <Button
            variant="outline"
            onClick={() => setPage((p) => p + 1)}
            disabled={entries.length < PAGE_SIZE}
            className="h-auto flex items-center gap-1.5 px-4 py-2 rounded-xl border-border bg-card text-muted-foreground font-bold text-xs disabled:opacity-40 disabled:cursor-not-allowed hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            Older <ChevronRight size={14} />
          </Button>
        </div>
      )}
    </div>
  );
}

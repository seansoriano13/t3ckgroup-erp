import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Plus, Search, Target, List, Kanban, LayoutDashboard, X } from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import PageContainer from "../../components/ui/PageContainer";
import PageHeader from "../../components/ui/PageHeader";
import Spinner from "../../components/ui/Spinner";
import TabGroup from "../../components/ui/TabGroup";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import Dropdown from "../../components/ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../../components/ui/FilterDropdown";
import FilterBar from "../../components/ui/FilterBar";
import OpportunityFormModal from "../../components/sor/OpportunityFormModal";
import OpportunityDetailsModal from "../../components/sor/OpportunityDetailsModal";
import OpportunityBoard from "../../components/sor/OpportunityBoard";
import EmployeeOpportunityMatrix from "../../components/sor/EmployeeOpportunityMatrix";
import PersonalOpportunityOverview from "../../components/sor/PersonalOpportunityOverview";
import { opportunityService } from "../../services/opportunityService";
import { employeeService } from "../../services/employeeService";
import { useAuth } from "../../context/AuthContext";
import {
  OPPORTUNITY_STAGES,
  PROJECT_TYPE_SHORT,
  formatLeadSource,
  formatPHP,
  PROJECT_TYPES,
} from "../../constants/sor";
import { leadSourceService } from "../../services/leadSourceService";
import HighlightText from "../../components/HighlightText";
import { Building2, Users, Layers, Tag } from "lucide-react";

const OPEN_STAGES = OPPORTUNITY_STAGES.filter(
  (s) => s.value !== "CLOSED_WON" && s.value !== "CLOSED_LOST",
).map((s) => s.value);

export default function OpportunitiesPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  const isPrivileged =
    user?.is_head || user?.isHead || user?.is_hr || user?.isHr || user?.isSuperAdmin;

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState(
    () => location.state?.filterStatus || "ALL",
  );
  const [leadSourceFilter, setLeadSourceFilter] = useState("ALL");
  const [projectTypeFilter, setProjectTypeFilter] = useState("ALL");
  const [departmentFilter, setDepartmentFilter] = useState("ALL");
  const [subDeptFilter, setSubDeptFilter] = useState("ALL");
  const [ownershipRole, setOwnershipRole] = useState("ALL");
  const [mineOnly, setMineOnly] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState(
    () => location.state?.filterEmployeeId || "ALL",
  );
  const [view, setView] = useState(() => {
    if (location.state?.filterEmployeeId) return "list";
    return sessionStorage.getItem("opportunitiesView") || "list";
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  // Clear nav state so back-navigation doesn't re-apply the deep-link filter
  // (mirrors /tasks's handling of the same pattern).
  useEffect(() => {
    if (location.state?.filterEmployeeId || location.state?.filterStatus) {
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeView = (next) => {
    setView(next);
    sessionStorage.setItem("opportunitiesView", next);
  };

  const { data: opportunities = [], isLoading } = useQuery({
    queryKey: ["opportunities"],
    queryFn: () => opportunityService.getOpportunities(),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const { data: activeLeadSources = [] } = useQuery({
    queryKey: ["leadSources", "active"],
    queryFn: () => leadSourceService.getActiveLeadSources(),
  });

  const createMutation = useMutation({
    mutationFn: (payload) =>
      opportunityService.createOpportunity(payload, user?.id),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      setFormOpen(false);
      toast.success(`Opportunity ${created.opportunity_no} registered.`);
    },
    onError: (err) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (payload) =>
      opportunityService.updateOpportunity(editing.id, payload, user?.id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["opportunityItems", updated.id] });
      setEditing(null);
      toast.success("Opportunity updated.");
    },
    onError: (err) => toast.error(err.message),
  });

  const employeeFilterName = useMemo(
    () => opportunities.find((o) => o.deal_owner_id === employeeFilter)?.deal_owner?.name,
    [opportunities, employeeFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (stageFilter === "OPEN" && !OPEN_STAGES.includes(o.status)) return false;
      if (stageFilter !== "ALL" && stageFilter !== "OPEN" && o.status !== stageFilter) return false;
      if (leadSourceFilter !== "ALL" && o.lead_source !== leadSourceFilter) return false;
      if (projectTypeFilter !== "ALL" && o.project_type !== projectTypeFilter) return false;
      
      const dealOwner = employees.find(e => e.id === o.deal_owner_id);
      if (departmentFilter !== "ALL" && dealOwner?.department !== departmentFilter) return false;
      if (subDeptFilter !== "ALL" && dealOwner?.subDepartment !== subDeptFilter) return false;
      
      if (ownershipRole !== "ALL" && employeeFilter !== "ALL") {
        if (o[ownershipRole] !== employeeFilter) return false;
      } else if (employeeFilter !== "ALL" && employeeFilter !== null) {
        if (
          o.deal_owner_id !== employeeFilter &&
          o.support_sales_1_id !== employeeFilter &&
          o.support_sales_2_id !== employeeFilter &&
          o.sales_director_id !== employeeFilter
        ) {
          return false;
        }
      }

      if (mineOnly && employeeFilter === "ALL") {
        const mine =
          o.deal_owner_id === user?.id ||
          o.support_sales_1_id === user?.id ||
          o.support_sales_2_id === user?.id ||
          o.sales_director_id === user?.id;
        if (!mine) return false;
      }
      if (!q) return true;
      return [
        o.opportunity_no,
        o.sales_reference,
        o.client_name,
        o.project_title,
        o.deal_owner?.name,
        o.lead_source_detail,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [
    opportunities,
    employees,
    search,
    stageFilter,
    leadSourceFilter,
    projectTypeFilter,
    departmentFilter,
    subDeptFilter,
    ownershipRole,
    mineOnly,
    employeeFilter,
    user?.id,
  ]);

  const totals = useMemo(() => {
    const open = filtered.filter((o) => OPEN_STAGES.includes(o.status));
    return {
      count: filtered.length,
      openValue: open.reduce((sum, o) => sum + Number(o.expected_value || 0), 0),
    };
  }, [filtered]);

  const selected = opportunities.find((o) => o.id === selectedId) || null;

  const stageOptions = [
    { value: "ALL", label: "All Stages" },
    { value: "OPEN", label: "Open Only" },
    ...OPPORTUNITY_STAGES.map((s) => ({ value: s.value, label: s.label })),
  ];

  const currentStageLabel =
    stageOptions.find((o) => o.value === stageFilter)?.label || "All Stages";

  const leadSourceOptions = [
    { value: "ALL", label: "All Lead Sources" },
    ...activeLeadSources.map((s) => ({ value: s.value, label: s.label })),
  ];

  const currentLeadSourceLabel =
    leadSourceOptions.find((o) => o.value === leadSourceFilter)?.label || "All Lead Sources";

  const projectTypeOptions = [
    { value: "ALL", label: "All Types" },
    ...PROJECT_TYPES.map((s) => ({ value: s.value, label: s.label })),
  ];

  const currentProjectTypeLabel =
    projectTypeOptions.find((o) => o.value === projectTypeFilter)?.label || "All Types";

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))];
  const subDepartments = [...new Set(employees.map(e => e.subDepartment).filter(Boolean))];

  const departmentOptions = [
    { value: "ALL", label: "All Departments" },
    ...departments.map(d => ({ value: d, label: d })),
  ];

  const subDepartmentOptions = [
    { value: "ALL", label: "All Sub-Departments" },
    ...subDepartments.map(d => ({ value: d, label: d })),
  ];

  const ownershipRoleOptions = [
    { value: "ALL", label: "Any Role" },
    { value: "deal_owner_id", label: "Deal Owner" },
    { value: "sales_director_id", label: "Sales Director" },
    { value: "support_sales_1_id", label: "Supporting Salesperson 1" },
    { value: "support_sales_2_id", label: "Supporting Salesperson 2" },
  ];

  const employeeOptions = [
    { value: "ALL", label: "All Employees" },
    ...employees.map((e) => ({ value: e.id, label: e.name })),
  ];

  const currentDepartmentLabel = departmentOptions.find(o => o.value === departmentFilter)?.label || "All Departments";
  const currentSubDeptLabel = subDepartmentOptions.find(o => o.value === subDeptFilter)?.label || "All Sub-Departments";
  const currentRoleLabel = ownershipRoleOptions.find(o => o.value === ownershipRole)?.label || "Any Role";
  const currentEmployeeLabel = employeeOptions.find(o => o.value === employeeFilter)?.label || "All Employees";

  const hasActiveFilters =
    search !== "" ||
    stageFilter !== "ALL" ||
    leadSourceFilter !== "ALL" ||
    projectTypeFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    subDeptFilter !== "ALL" ||
    ownershipRole !== "ALL" ||
    employeeFilter !== "ALL" ||
    mineOnly;

  const handleClearAll = () => {
    setSearch("");
    setStageFilter("ALL");
    setLeadSourceFilter("ALL");
    setProjectTypeFilter("ALL");
    setDepartmentFilter("ALL");
    setSubDeptFilter("ALL");
    setOwnershipRole("ALL");
    setMineOnly(false);
    setEmployeeFilter("ALL");
  };

  return (
    <ProtectedRoute>
      <PageContainer className="pt-4">
        <PageHeader
          title="SOR Sales Opportunity Registration"
          description="Register every lead before bid, proposal, or quotation issuance. Registration date establishes deal ownership."
        >
          <button
            onClick={() => setFormOpen(true)}
            className="h-10 px-4 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground font-bold text-[13px] shadow-lg shadow-primary/20 transition-all flex items-center gap-1.5 shrink-0"
          >
            <Plus size={15} /> Register Opportunity
          </button>
        </PageHeader>

        {/* Filters */}
        <FilterBar
          className="mt-6"
          hasActiveFilters={hasActiveFilters}
          onClearAll={handleClearAll}
          actions={
            <TabGroup
              tabs={[
                { value: "list", label: "List", icon: List },
                { value: "board", label: "Board", icon: Kanban },
                { value: "overview", label: "Overview", icon: LayoutDashboard },
              ]}
              activeTab={view}
              onChange={changeView}
              variant="pill"
              size="sm"
              className="shrink-0"
            />
          }
          advancedFilters={
            <>
              <Dropdown
                usePortal={true}
                className="min-w-[170px] flex-1"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    icon={Building2}
                    label={currentDepartmentLabel}
                    isActive={departmentFilter !== "ALL"}
                    isOpen={isOpen}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={departmentOptions}
                    value={departmentFilter}
                    onChange={setDepartmentFilter}
                    close={close}
                  />
                )}
              </Dropdown>

              <Dropdown
                usePortal={true}
                className="min-w-[170px] flex-1"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    icon={Building2}
                    label={currentSubDeptLabel}
                    isActive={subDeptFilter !== "ALL"}
                    isOpen={isOpen}
                    disabled={departmentFilter === "ALL"}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={subDepartmentOptions}
                    value={subDeptFilter}
                    onChange={setSubDeptFilter}
                    close={close}
                  />
                )}
              </Dropdown>

              <div className="flex flex-1 min-w-[280px] rounded-lg border border-border bg-card">
                <Dropdown
                  usePortal={true}
                  className="w-1/2"
                  trigger={({ isOpen }) => (
                    <FilterTrigger
                      className="border-0 border-r border-border rounded-none rounded-l-lg hover:border-border/80"
                      icon={Users}
                      label={currentRoleLabel}
                      isActive={ownershipRole !== "ALL"}
                      isOpen={isOpen}
                    />
                  )}
                >
                  {({ close }) => (
                    <FilterOptionList
                      options={ownershipRoleOptions}
                      value={ownershipRole}
                      onChange={setOwnershipRole}
                      close={close}
                    />
                  )}
                </Dropdown>
                <Dropdown
                  usePortal={true}
                  className="w-1/2"
                  trigger={({ isOpen }) => (
                    <FilterTrigger
                      className="border-0 rounded-none rounded-r-lg hover:border-border/80"
                      label={currentEmployeeLabel}
                      isActive={employeeFilter !== "ALL"}
                      isOpen={isOpen}
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
              </div>

              <Dropdown
                usePortal={true}
                className="min-w-[150px] shrink-0"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    icon={Layers}
                    label={currentProjectTypeLabel}
                    isActive={projectTypeFilter !== "ALL"}
                    isOpen={isOpen}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={projectTypeOptions}
                    value={projectTypeFilter}
                    onChange={setProjectTypeFilter}
                    close={close}
                  />
                )}
              </Dropdown>

              <Dropdown
                usePortal={true}
                className="min-w-[150px] shrink-0"
                trigger={({ isOpen }) => (
                  <FilterTrigger
                    label={currentLeadSourceLabel}
                    isActive={leadSourceFilter !== "ALL"}
                    isOpen={isOpen}
                  />
                )}
              >
                {({ close }) => (
                  <FilterOptionList
                    options={leadSourceOptions}
                    value={leadSourceFilter}
                    onChange={setLeadSourceFilter}
                    close={close}
                  />
                )}
              </Dropdown>
            </>
          }
        >
          <div className="flex-1 min-w-[200px] max-w-sm bg-muted/30 border border-border rounded-xl px-3 py-2.5 flex items-center gap-2 focus-within:border-mauve-7">
            <Search size={15} className="text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search number, client, project, deal owner…"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none font-medium"
            />
          </div>
          <Dropdown
            usePortal={true}
            className="min-w-[150px] shrink-0"
            trigger={({ isOpen }) => (
              <FilterTrigger
                icon={Tag}
                label={currentStageLabel}
                isActive={stageFilter !== "ALL"}
                isOpen={isOpen}
              />
            )}
          >
            {({ close }) => (
              <FilterOptionList
                options={stageOptions}
                value={stageFilter}
                onChange={setStageFilter}
                close={close}
              />
            )}
          </Dropdown>
          <button
            onClick={() => setMineOnly((v) => !v)}
            className={`px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shrink-0 ${mineOnly
              ? "bg-primary/10 border-primary/40 text-primary"
              : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
              }`}
          >
            My Deals
          </button>
        </FilterBar>

        {employeeFilter && employeeFilter !== "ALL" && (
          <button
            onClick={() => setEmployeeFilter("ALL")}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/30 text-primary text-xs font-bold hover:bg-primary/15 transition-colors"
          >
            Filtered to {employeeFilterName || "employee"}
            <X size={12} />
          </button>
        )}

        {/* Summary */}
        <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground font-semibold">
          <span>{totals.count} opportunit{totals.count === 1 ? "y" : "ies"}</span>
          <span className="text-muted-foreground/40">•</span>
          <span>
            Open pipeline value{" "}
            <span className="text-foreground font-bold">
              {formatPHP(totals.openValue)}
            </span>
          </span>
        </div>

        {view === "overview" ? (
          <div className="mt-4">
            {isLoading ? (
              <div className="border border-border rounded-2xl overflow-hidden bg-card">
                <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
                  <Spinner size="sm" />
                  <span className="text-sm font-bold uppercase tracking-widest">
                    Loading overview…
                  </span>
                </div>
              </div>
            ) : isPrivileged ? (
              opportunities.some((o) => o.deal_owner) ? (
                <EmployeeOpportunityMatrix opportunities={opportunities} />
              ) : (
                <OverviewEmptyState />
              )
            ) : opportunities.some((o) => o.deal_owner_id === user?.id) ? (
              <PersonalOpportunityOverview opportunities={opportunities} />
            ) : (
              <OverviewEmptyState />
            )}
          </div>
        ) : isLoading ? (
          <div className="mt-4 border border-border rounded-2xl overflow-hidden bg-card">
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Spinner size="sm" />
              <span className="text-sm font-bold uppercase tracking-widest">
                Loading register…
              </span>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-4 border border-border rounded-2xl overflow-hidden bg-card">
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-3">
                <Target size={18} />
              </div>
              <p className="text-sm font-bold text-foreground">
                {opportunities.length === 0
                  ? "No opportunities registered yet"
                  : "No opportunities match these filters"}
              </p>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm">
                {opportunities.length === 0
                  ? "Register a lead to claim ownership of it."
                  : "Try clearing the search or stage filter."}
              </p>
            </div>
          </div>
        ) : view === "board" ? (
          <div className="mt-4">
            <OpportunityBoard
              opportunities={filtered}
              search={search}
              onCardClick={(o) => setSelectedId(o.id)}
            />
          </div>
        ) : (
          <div className="mt-4 border border-border rounded-2xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="text-left font-bold px-4 py-3">No.</th>
                    <th className="text-left font-bold px-4 py-3">Sales Ref.</th>
                    <th className="text-left font-bold px-4 py-3">Date</th>
                    <th className="text-left font-bold px-4 py-3">Lead Source</th>
                    <th className="text-left font-bold px-4 py-3">Client</th>
                    <th className="text-left font-bold px-4 py-3">Project</th>
                    <th className="text-right font-bold px-4 py-3">Expected Value</th>
                    <th className="text-left font-bold px-4 py-3">Div.</th>
                    <th className="text-left font-bold px-4 py-3">Deal Owner</th>
                    <th className="text-left font-bold px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((o) => (
                    <tr
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className="border-b border-border/50 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-bold text-primary whitespace-nowrap">
                        <HighlightText text={o.serial_no} search={search} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs whitespace-nowrap">
                        {o.sales_reference ? (
                          <HighlightText text={o.sales_reference} search={search} />
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground whitespace-nowrap text-xs">
                        {o.registration_date
                          ? new Date(o.registration_date).toLocaleDateString("en-US", {
                              month: "long",
                              day: "numeric",
                              year: "numeric",
                            })
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <HighlightText text={formatLeadSource(o.lead_source, o.lead_source_detail, activeLeadSources)} search={search} />
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        <HighlightText text={o.client_name} search={search} />
                      </td>
                      <td className="px-4 py-3 max-w-[220px] truncate">
                        <HighlightText text={o.project_title} search={search} />
                      </td>
                      <td className="px-4 py-3 text-right font-bold whitespace-nowrap">
                        {formatPHP(o.expected_value)}
                      </td>
                      <td className="px-4 py-3 text-xs font-bold text-muted-foreground">
                        {PROJECT_TYPE_SHORT[o.project_type] || o.project_type}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {o.deal_owner ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Avatar
                              name={o.deal_owner.name}
                              src={o.deal_owner.avatar_path}
                              size="xs"
                            />
                            <span className="text-xs font-semibold">
                              <HighlightText text={o.deal_owner.name} search={search} />
                            </span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground/60">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </PageContainer>

      <OpportunityFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={(payload) => createMutation.mutate(payload)}
        isPending={createMutation.isPending}
      />

      <OpportunityFormModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        onSubmit={(payload) => updateMutation.mutate(payload)}
        isPending={updateMutation.isPending}
        opportunity={editing}
      />

      <OpportunityDetailsModal
        isOpen={!!selected}
        onClose={() => setSelectedId(null)}
        opportunity={selected}
        onEdit={(o) => {
          setSelectedId(null);
          setEditing(o);
        }}
      />
    </ProtectedRoute>
  );
}

function OverviewEmptyState() {
  return (
    <div className="border border-border rounded-2xl overflow-hidden bg-card">
      <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-10 h-10 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground mb-3">
          <LayoutDashboard size={18} />
        </div>
        <p className="text-sm font-bold text-foreground">Nothing to show yet</p>
        <p className="text-xs text-muted-foreground mt-1 max-w-sm">
          The overview fills in once opportunities have a deal owner assigned.
        </p>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Plus,
  Search,
  Target,
  List,
  Kanban,
  LayoutDashboard,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Clock,
  ShoppingBag,
} from "lucide-react";
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
import RetailOrdersQueue from "../../components/sor/RetailOrdersQueue";
import { opportunityService } from "../../services/opportunityService";
import { employeeService } from "../../services/employeeService";
import { useAuth } from "../../context/AuthContext";
import {
  isTerminalStage,
  PROJECT_TYPE_SHORT,
  formatLeadSource,
  formatPHP,
  PROJECT_TYPES,
} from "../../constants/sor";
import { leadSourceService } from "../../services/leadSourceService";
import { salesFlowService } from "../../services/salesFlowService";
import { flowStageTone } from "../../constants/salesFlow";
import { usePipelineStages } from "../../hooks/usePipelineStages";
import HighlightText from "../../components/HighlightText";
import { Building2, Users, Layers, Tag } from "lucide-react";
import { getRetailQueuePendingCount } from "../../services/retailQueueService";

// Alignment classes are written out in full rather than interpolated —
// Tailwind scans source for literal class names, so a `text-${align}` would
// compile to nothing.
const TH_ALIGN = {
  left: { cell: "text-left", inner: "" },
  right: { cell: "text-right", inner: "justify-end" },
  center: { cell: "text-center", inner: "justify-center" },
};

/**
 * A clickable register column header. Same interaction styling as
 * `TaskTableView` — cursor-pointer, hover:text-foreground, transition-colors —
 * but this table keeps its own px-2.5/py-2.5 padding: ten columns already
 * overflow the fixed layout, and wider gutters would push Status out of view.
 *
 * Lives at module scope, not inside the page component. A component declared
 * during render is a new type on every render, so React unmounts and remounts
 * every header on each keystroke in the search box.
 */
function SortableTh({ field, sortField, sortOrder, onSort, align = "left", className = "", children }) {
  const active = sortField === field;
  const { cell, inner } = TH_ALIGN[align] ?? TH_ALIGN.left;

  const icon = !active ? (
    <ArrowUpDown size={11} className="opacity-40 ml-1 inline-block shrink-0" />
  ) : sortOrder === "asc" ? (
    <ArrowUp size={11} className="text-primary ml-1 inline-block shrink-0" />
  ) : (
    <ArrowDown size={11} className="text-primary ml-1 inline-block shrink-0" />
  );

  return (
    <th
      scope="col"
      onClick={() => onSort(field)}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      className={`${cell} font-bold px-2.5 py-2.5 whitespace-nowrap cursor-pointer hover:text-foreground transition-colors ${className}`}
    >
      <span className={`flex items-center ${inner}`}>
        {children}
        {icon}
      </span>
    </th>
  );
}

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
  const [blockedOnly, setBlockedOnly] = useState(false);
  const [employeeFilter, setEmployeeFilter] = useState(
    () => location.state?.filterEmployeeId || "ALL",
  );
  const [view, setView] = useState(() => {
    if (location.state?.filterEmployeeId) return "list";
    return sessionStorage.getItem("opportunitiesView") || "list";
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  // notificationRouter sends every OPPORTUNITY_* notification here with the
  // record's id, so the deep link has to actually open it — otherwise clicking
  // a stage-change or procurement notification lands on an unfiltered list and
  // the user has to find the deal by hand.
  const [selectedId, setSelectedId] = useState(
    () => location.state?.openOpportunityId || null,
  );

  // Synchronise deep-link nav state whenever location.state updates (e.g. from
  // notification drawer, toast popup, or overview clicks), and clear nav state
  // so back-navigation doesn't re-apply filters.
  useEffect(() => {
    const navState = location.state;
    if (!navState) return;

    let hasHandledState = false;

    if (navState.openOpportunityId) {
      // Router location is the external system this effect exists to follow:
      // a notification or toast navigates here carrying the deal to open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedId(navState.openOpportunityId);
      hasHandledState = true;
    }
    if (navState.filterEmployeeId) {
      setEmployeeFilter(navState.filterEmployeeId);
      setView("list");
      hasHandledState = true;
    }
    if (navState.filterStatus) {
      setStageFilter(navState.filterStatus);
      hasHandledState = true;
    }

    if (hasHandledState) {
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, navigate, location.pathname]);

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

  const { data: retailQueueCount = 0 } = useQuery({
    queryKey: ["retailQueueCount"],
    queryFn: () => getRetailQueuePendingCount(),
    refetchInterval: 60_000, // refresh every minute
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

  const { stages: pipelineStages } = usePipelineStages();

  // A flow deal's `status` is stale (opportunityService's moveAlongFlow never
  // touches it — see that comment). Its real current Stage lives in
  // `flow_stage_id` against its own flow, so the register needs every flow's
  // Stages to show it — one bulk index rather than a query per Sale Type.
  const { data: flowStagesIndex } = useQuery({
    queryKey: ["allFlowStagesIndex"],
    queryFn: () => salesFlowService.getAllStagesIndex(),
  });

  const stageDisplay = (o) => {
    if (o.sale_type_id) {
      const stage = flowStagesIndex?.stagesById?.[o.flow_stage_id];
      if (!stage) return { label: null, tone: "mauve" };
      const flow = flowStagesIndex.flowsById[stage.flow_id];
      const stagesOfFlow = flowStagesIndex.stagesByFlow[stage.flow_id] || [];
      return { label: stage.name, tone: flowStageTone(stage, flow, stagesOfFlow) };
    }
    const pipelineStage = pipelineStages.find((s) => s.code === o.status);
    return { label: pipelineStage?.label || o.status, tone: null, code: o.status };
  };

  // "Open" here means not yet terminal — it deliberately includes the whole
  // post-award run, which is still work in progress for the sales team.
  const openStageCodes = useMemo(
    () => pipelineStages.filter((s) => !isTerminalStage(s)).map((s) => s.code),
    [pipelineStages],
  );

  // Stage Gate Engine, tickets 6 & 7 — open deals only. Story 25 (blocked)
  // is about unblocking the pipeline, and story 26 (deadlines) is scoped the
  // same way; a Won/Lost deal isn't part of either even if a condition
  // were ever attached to a terminal Stage. Keyed by id+status so a stage
  // move (not just a new/removed deal) refetches both; content-level changes
  // (e.g. an attachment satisfying a condition) freshen the next time this
  // key changes or the page is revisited, which is enough for a
  // register-level indicator.
  const openOpportunities = useMemo(
    () => opportunities.filter((o) => openStageCodes.includes(o.status)),
    [opportunities, openStageCodes],
  );
  const openOpportunitiesKey = useMemo(
    () => openOpportunities.map((o) => `${o.id}:${o.status}`).join(","),
    [openOpportunities],
  );

  // Ticket 6 (Sales Director visibility, story 25) — every open deal blocked
  // on its own current Stage, and what it's missing. One bulk read for the
  // whole register rather than a checklist call per row.
  const { data: blockedDeals = {} } = useQuery({
    queryKey: ["blockedDeals", openOpportunitiesKey],
    queryFn: () => opportunityService.getBlockedDeals(openOpportunities),
    enabled: openOpportunities.length > 0,
  });

  // Ticket 7 (deadline countdown, story 16/26) — the same bulk shape as
  // blockedDeals, for the board card countdown and the register's "past a
  // deadline" read.
  const { data: deadlineStatuses = {} } = useQuery({
    queryKey: ["deadlineStatuses", openOpportunitiesKey],
    queryFn: () => opportunityService.getDeadlineStatuses(openOpportunities),
    enabled: openOpportunities.length > 0,
  });

  // There's no server-side cron in this app (see opportunityService's own
  // comment on checkDeadlineNotifications), so the approach/breach
  // notification D42 asks for is triggered here instead: once per mount,
  // opportunistically, whenever someone has the open register loaded. The
  // check is idempotent per milestone, so a second visit — or another user's
  // — is always safe, just a no-op for whatever already fired.
  const hasCheckedDeadlines = useRef(false);
  useEffect(() => {
    if (hasCheckedDeadlines.current || openOpportunities.length === 0) return;
    hasCheckedDeadlines.current = true;
    opportunityService.checkDeadlineNotifications(openOpportunities).catch(console.error);
  }, [openOpportunities]);

  const employeeFilterName = useMemo(
    () => opportunities.find((o) => o.deal_owner_id === employeeFilter)?.deal_owner?.name,
    [opportunities, employeeFilter],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((o) => {
      if (stageFilter === "OPEN" && !openStageCodes.includes(o.status)) return false;
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
      if (blockedOnly && !blockedDeals[o.id]?.length) return false;
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
    blockedOnly,
    blockedDeals,
    employeeFilter,
    user?.id,
    openStageCodes,
  ]);

  // ── Register sorting ────────────────────────────────────────────────────
  // `serial_no` descending is what the register showed before it was
  // sortable, so it stays the default — turning sorting on must not silently
  // reorder everyone's list on first load.
  const [sortField, setSortField] = useState("serial_no");
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc'

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Stage sorts by pipeline position, never alphabetically — "Awarded" before
  // "Bid Submitted" is meaningless, and the whole point of a stage column is
  // where the deal is in the funnel.
  const stageRank = useMemo(() => {
    const rank = {};
    pipelineStages.forEach((s) => {
      rank[s.code] = s.sort_order;
    });
    return rank;
  }, [pipelineStages]);

  const sorted = useMemo(() => {
    const dir = sortOrder === "asc" ? 1 : -1;
    const text = (v) => (v || "").toString().toLowerCase();

    const key = (o) => {
      switch (sortField) {
        case "serial_no":
          return Number(o.serial_no) || 0;
        case "sales_reference":
          return text(o.sales_reference);
        case "registration_date":
          return o.registration_date ? new Date(o.registration_date).getTime() : 0;
        case "lead_source":
          return text(formatLeadSource(o.lead_source, o.lead_source_detail, activeLeadSources));
        case "client_name":
          return text(o.client_name);
        case "project_title":
          return text(o.project_title);
        case "expected_value":
          return Number(o.expected_value) || 0;
        case "project_type":
          return text(PROJECT_TYPE_SHORT[o.project_type] || o.project_type);
        case "deal_owner":
          return text(o.deal_owner?.name);
        case "status":
          return stageRank[o.status] ?? Number.MAX_SAFE_INTEGER;
        default:
          return 0;
      }
    };

    // Sort a copy: `filtered` is a memo other consumers read, and Array.sort
    // mutates in place.
    return [...filtered].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tiebreak so equal keys never shuffle between renders.
      return (Number(b.serial_no) || 0) - (Number(a.serial_no) || 0);
    });
  }, [filtered, sortField, sortOrder, stageRank, activeLeadSources]);

  const totals = useMemo(() => {
    const open = filtered.filter((o) => openStageCodes.includes(o.status));
    return {
      count: filtered.length,
      openValue: open.reduce((sum, o) => sum + Number(o.expected_value || 0), 0),
    };
  }, [filtered, openStageCodes]);

  const { data: directOpportunity } = useQuery({
    queryKey: ["opportunity", selectedId],
    queryFn: () => opportunityService.getOpportunityById(selectedId),
    enabled: !!selectedId && !opportunities.some((o) => o.id === selectedId),
  });

  const selected = useMemo(() => {
    if (!selectedId) return null;
    return opportunities.find((o) => o.id === selectedId) || directOpportunity || null;
  }, [opportunities, selectedId, directOpportunity]);

  const stageOptions = [
    { value: "ALL", label: "All Stages" },
    { value: "OPEN", label: "Open Only" },
    ...pipelineStages.map((s) => ({ value: s.code, label: s.label })),
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
    mineOnly ||
    blockedOnly;

  const handleClearAll = () => {
    setSearch("");
    setStageFilter("ALL");
    setLeadSourceFilter("ALL");
    setProjectTypeFilter("ALL");
    setDepartmentFilter("ALL");
    setSubDeptFilter("ALL");
    setOwnershipRole("ALL");
    setMineOnly(false);
    setBlockedOnly(false);
    setEmployeeFilter("ALL");
  };

  return (
    <ProtectedRoute>
      <PageContainer maxWidth="full" className="pt-4 px-0 sm:px-0 lg:px-0">
        <PageHeader
          title="SOR / CRM"
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
                {
                  value: "retailQueue",
                  icon: ShoppingBag,
                  label: "Retail Queue",
                  badge: retailQueueCount > 0 ? retailQueueCount : null,
                },
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
          {/* Sales Director visibility (Stage Gate Engine ticket 6, story 25) —
              which deals are stuck on their own Stage, without hunting for it
              deal by deal. */}
          <button
            onClick={() => setBlockedOnly((v) => !v)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shrink-0 ${blockedOnly
              ? "bg-red-500/10 border-red-500/40 text-red-600 dark:text-red-400"
              : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"
              }`}
          >
            <AlertTriangle size={13} />
            Blocked
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

        {view === "retailQueue" ? (
          <RetailOrdersQueue />
        ) : view === "overview" ? (
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
              deadlineStatuses={deadlineStatuses}
              flowStagesIndex={flowStagesIndex}
              onCardClick={(o) => setSelectedId(o.id)}
            />
          </div>
        ) : (
          <div className="mt-4 border border-border rounded-2xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <table className="w-full table-fixed text-sm">
                <thead>
                  {/* Sortable headers. The interaction styling is
                      TaskTableView's — cursor-pointer hover:text-foreground
                      transition-colors — but the padding stays at this
                      table's own px-2.5/py-2.5: ten columns already overflow
                      the fixed layout, and px-4 gutters would push Status out
                      of view. */}
                  <tr className="border-b border-border bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground select-none">
                    <SortableTh field="serial_no" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[46px]">No.</SortableTh>
                    <SortableTh field="sales_reference" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[76px]">Sales Ref.</SortableTh>
                    <SortableTh field="registration_date" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[84px]">Date</SortableTh>
                    <SortableTh field="lead_source" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[13%]">Lead Source</SortableTh>
                    <SortableTh field="client_name" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[18%]">Company</SortableTh>
                    <SortableTh field="project_title" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[22%]">Project</SortableTh>
                    <SortableTh field="expected_value" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} align="right" className="w-[114px]">Expected Value</SortableTh>
                    <SortableTh field="project_type" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} align="center" className="px-2 w-[44px]">Div.</SortableTh>
                    <SortableTh field="deal_owner" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[14%]">Deal Owner</SortableTh>
                    <SortableTh field="status" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[96px]">Status</SortableTh>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((o) => {
                    const deadline = deadlineStatuses[o.id];
                    const leadSourceText = formatLeadSource(
                      o.lead_source,
                      o.lead_source_detail,
                      activeLeadSources,
                    );
                    const dateFormatted = o.registration_date
                      ? (() => {
                        const d = new Date(o.registration_date);
                        const m = d.toLocaleDateString("en-US", { month: "short" });
                        const day = d.getDate();
                        const yr = String(d.getFullYear()).slice(-2);
                        return `${m} ${day}, '${yr}`;
                      })()
                      : "—";

                    return (
                      <tr
                        key={o.id}
                        onClick={() => setSelectedId(o.id)}
                        className="border-b border-border/50 last:border-0 hover:bg-muted/40 cursor-pointer transition-colors"
                      >
                        <td className="px-2.5 py-2.5 font-mono text-xs font-bold text-primary whitespace-nowrap">
                          <HighlightText text={o.serial_no} search={search} />
                        </td>
                        <td
                          className="px-2.5 py-2.5 font-mono text-xs whitespace-nowrap truncate"
                          title={o.sales_reference || ""}
                        >
                          {o.sales_reference ? (
                            <HighlightText text={o.sales_reference} search={search} />
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                          {dateFormatted}
                        </td>
                        <td
                          className="px-2.5 py-2.5 text-xs truncate whitespace-nowrap"
                          title={leadSourceText}
                        >
                          <HighlightText text={leadSourceText} search={search} />
                        </td>
                        <td
                          className="px-2.5 py-2.5 font-semibold text-xs truncate whitespace-nowrap"
                          title={o.client_name}
                        >
                          <HighlightText text={o.client_name} search={search} />
                        </td>
                        <td
                          className="px-2.5 py-2.5 text-xs truncate whitespace-nowrap"
                          title={o.project_title}
                        >
                          <HighlightText text={o.project_title} search={search} />
                        </td>
                        <td className="px-2.5 py-2.5 text-right font-bold text-xs whitespace-nowrap">
                          {formatPHP(o.expected_value)}
                        </td>
                        <td className="px-2 py-2.5 text-center text-xs font-bold text-muted-foreground whitespace-nowrap">
                          {PROJECT_TYPE_SHORT[o.project_type] || o.project_type}
                        </td>
                        <td
                          className="px-2.5 py-2.5 whitespace-nowrap"
                          title={o.deal_owner?.name || ""}
                        >
                          {o.deal_owner ? (
                            <span className="inline-flex items-center gap-1.5 max-w-full overflow-hidden">
                              <Avatar
                                name={o.deal_owner.name}
                                src={o.deal_owner.avatar_path}
                                size="xs"
                              />
                              <span className="text-xs font-semibold truncate">
                                <HighlightText text={o.deal_owner.name} search={search} />
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2.5 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            {(() => {
                              const display = stageDisplay(o);
                              return display.label ? (
                                <StatusBadge label={display.label} status={display.code} theme={display.tone} />
                              ) : (
                                <span className="text-muted-foreground/50 text-xs">—</span>
                              );
                            })()}
                            {blockedDeals[o.id]?.length > 0 && (
                              <span
                                title={`Blocked on: ${blockedDeals[o.id].map((r) => r.label).join(", ")}`}
                                className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400"
                              >
                                <AlertTriangle size={10} />
                              </span>
                            )}
                            {/* Deadline kind (ticket 7, story 26) — deadlines
                                never block, so this is informational only,
                                separate from the "Blocked" badge above. */}
                            {deadline?.isBreached && (
                              <span
                                title={`Deadline passed: "${deadline.condition.label}"`}
                                className="inline-flex items-center gap-1 rounded-full bg-red-500/10 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:text-red-400"
                              >
                                <Clock size={10} />
                              </span>
                            )}
                            {deadline && !deadline.isBreached && deadline.isApproaching && (
                              <span
                                title={`"${deadline.condition.label}" — ${deadline.daysRemaining} day(s) left`}
                                className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400"
                              >
                                <Clock size={10} />
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
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

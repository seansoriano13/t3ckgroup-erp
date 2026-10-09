import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import {
  Plus,
  Search,
  Target,
  LayoutDashboard,
  X,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import ProtectedRoute from "../../components/ProtectedRoute";
import Spinner from "../../components/ui/Spinner";
import PageShell from "../../components/ui/PageShell";
import { Button } from "@/components/ui/button";
import StatusBadge from "../../components/StatusBadge";
import Avatar from "../../components/Avatar";
import Dropdown from "../../components/ui/Dropdown";
import { FilterTrigger, FilterOptionList } from "../../components/ui/FilterDropdown";
import OpportunityFormModal from "../../components/sor/OpportunityFormModal";
import OpportunityDetailsModal from "../../components/sor/OpportunityDetailsModal";
import OpportunityBoard from "../../components/sor/OpportunityBoard";
import SorsViewTabs from "../../components/sor/SorsViewTabs";
import SorsTotals from "../../components/sor/SorsTotals";
import SaleTypeFilter from "../../components/sor/SaleTypeFilter";
import EmployeeOpportunityMatrix from "../../components/sor/EmployeeOpportunityMatrix";
import PersonalOpportunityOverview from "../../components/sor/PersonalOpportunityOverview";
import DeletedOpportunitiesView from "../../components/sor/DeletedOpportunitiesView";
import { opportunityService } from "../../services/opportunityService";
import { employeeService } from "../../services/employeeService";
import { useAuth } from "../../context/AuthContext";
import {
  isOpenPipelineOpportunity,
  isStillMovingOpportunity,
  isOnTerminalStage,
  isRealizedOpportunity,
  PROJECT_TYPE_SHORT,
  matchesSaleType,
  formatLeadSource,
  formatPHP,
  PROJECT_TYPES,
} from "../../constants/sor";
import { leadSourceService } from "../../services/leadSourceService";
import { salesFlowService } from "../../services/salesFlowService";
import { flowStageTone } from "../../constants/salesFlow";
import { usePipelineStages } from "../../hooks/usePipelineStages";
import { useTableRealtime } from "../../hooks/useTableRealtime";
import HighlightText from "../../components/HighlightText";
import { sorCodeOf, matchesSorCode } from "../../utils/sorCode";
import { Building2, Users, Layers, Tag } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";

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
    <TableHead
      scope="col"
      onClick={() => onSort(field)}
      aria-sort={active ? (sortOrder === "asc" ? "ascending" : "descending") : "none"}
      className={`${cell} px-2.5 py-2.5 whitespace-nowrap cursor-pointer hover:text-foreground transition-colors ${className}`}
    >
      <span className={`flex items-center ${inner}`}>
        {children}
        {icon}
      </span>
    </TableHead>
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
  const [saleTypeFilter, setSaleTypeFilter] = useState("ALL");
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
    const saved = sessionStorage.getItem("opportunitiesView");
    // "retailQueue" and "retail" moved to /retail. A session that still names
    // one of them would otherwise restore a tab that no longer exists, leaving
    // the strip with nothing selected.
    if (saved === "retailQueue" || saved === "retail") return "list";
    return saved || "list";
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
      // The drill-down leaves Overview for good, so List is the view to
      // remember: otherwise a reload restores the "overview" that was saved
      // before the click and the register jumps back to a screen the user
      // already left.
      sessionStorage.setItem("opportunitiesView", "list");
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

  // Someone else moving or editing an SOR redraws the Board and the list here
  // without a refresh. The signal carries only a row id; the refetch goes
  // through the same RLS-filtered query as any other load. Debounced because
  // that refetch is the whole register, and one move can touch the row twice.
  useTableRealtime("sales_opportunities", {
    invalidateKeys: [["opportunities"]],
    debounceMs: 800,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ["employees"],
    queryFn: () => employeeService.getAllEmployees(),
  });

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);

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

  // Issue #206 — the Board's Sale Type switcher: one flow at a time, plus
  // "Legacy pipeline" for SORs with no Sale Type.
  const { data: saleTypes = [] } = useQuery({
    queryKey: ["saleTypes"],
    queryFn: () => salesFlowService.getSaleTypes(),
  });

  // The filter lists every Sale Type, archived ones included: an SOR registered
  // against a since-archived Sale Type is still in the register and must stay
  // findable by it. The Board's switcher above keeps to the live ones.
  const { data: allSaleTypes = [] } = useQuery({
    queryKey: ["saleTypes", "all"],
    queryFn: () => salesFlowService.getSaleTypes({ includeArchived: true }),
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

  // Issue #199 — each flow SOR is judged against its OWN Flow Snapshot, so
  // the register reads every distinct snapshot among its SORs once, in bulk,
  // like the Stage index above.
  const snapshotIds = useMemo(
    () => [...new Set(opportunities.map((o) => o.flow_snapshot_id).filter(Boolean))].sort(),
    [opportunities],
  );
  const { data: snapshotsById = {} } = useQuery({
    queryKey: ["flowSnapshotsById", snapshotIds.join(",")],
    queryFn: () => salesFlowService.getSnapshotsByIds(snapshotIds),
    enabled: snapshotIds.length > 0,
  });
  const stageContext = useMemo(
    () => ({ snapshotsById, stages: pipelineStages }),
    [snapshotsById, pipelineStages],
  );

  // Stage Gate Engine, tickets 6 & 7 — deals still moving only: not on a
  // Terminal Stage. A won SOR on a post-award Stage (PO, delivery,
  // collection) is still in scope, since conditions and deadlines on those
  // Stages still need to show. This is deliberately wider than Open
  // Pipeline, which also leaves out anything with a Contract Date. Keyed by
  // id + Stage so a move (not just a new/removed deal) refetches both;
  // content-level changes (e.g. an attachment satisfying a condition)
  // freshen the next time this key changes or the page is revisited, which
  // is enough for a register-level indicator.
  const movingOpportunities = useMemo(
    () => opportunities.filter((o) => isStillMovingOpportunity(o, stageContext)),
    [opportunities, stageContext],
  );
  const movingOpportunitiesKey = useMemo(
    () => movingOpportunities.map((o) => `${o.id}:${o.flow_stage_id || o.status}`).join(","),
    [movingOpportunities],
  );

  // Ticket 6 (Sales Director visibility, story 25) — every still-moving deal blocked
  // on its own current Stage, and what it's missing. One bulk read for the
  // whole register rather than a checklist call per row.
  const { data: blockedDeals = {} } = useQuery({
    queryKey: ["blockedDeals", movingOpportunitiesKey],
    queryFn: () => opportunityService.getBlockedDeals(movingOpportunities),
    enabled: movingOpportunities.length > 0,
  });

  // Ticket 7 (deadline countdown, story 16/26) — the same bulk shape as
  // blockedDeals, for the board card countdown and the register's "past a
  // deadline" read.
  const { data: deadlineStatuses = {} } = useQuery({
    queryKey: ["deadlineStatuses", movingOpportunitiesKey],
    queryFn: () => opportunityService.getDeadlineStatuses(movingOpportunities),
    enabled: movingOpportunities.length > 0,
  });

  // There's no server-side cron in this app (see opportunityService's own
  // comment on checkDeadlineNotifications), so the approach/breach
  // notification D42 asks for is triggered here instead: once per mount,
  // opportunistically, whenever someone has the open register loaded. The
  // check is idempotent per milestone, so a second visit — or another user's
  // — is always safe, just a no-op for whatever already fired.
  const hasCheckedDeadlines = useRef(false);
  useEffect(() => {
    if (hasCheckedDeadlines.current || movingOpportunities.length === 0) return;
    hasCheckedDeadlines.current = true;
    opportunityService.checkDeadlineNotifications(movingOpportunities).catch(console.error);
  }, [movingOpportunities]);

  const employeeFilterName = useMemo(
    () => opportunities.find((o) => o.deal_owner_id === employeeFilter)?.deal_owner?.name,
    [opportunities, employeeFilter],
  );

  // The Board has its own Sale Type switcher — it is not a filter, it picks
  // which flow's Stages are drawn as columns — so a Sale Type chosen here for
  // the list must not silently empty the Board behind it.
  const effectiveSaleTypeFilter = view === "board" ? "ALL" : saleTypeFilter;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return opportunities.filter((o) => {
      // Open Pipeline (CONTEXT.md): the same rule the Open pipeline value
      // adds up, so the filter lists exactly the rows behind the figure.
      if (stageFilter === "OPEN" && !isOpenPipelineOpportunity(o, stageContext)) return false;
      if (stageFilter !== "ALL" && stageFilter !== "OPEN" && o.status !== stageFilter) return false;
      if (leadSourceFilter !== "ALL" && o.lead_source !== leadSourceFilter) return false;
      if (projectTypeFilter !== "ALL" && o.project_type !== projectTypeFilter) return false;
      if (!matchesSaleType(o, effectiveSaleTypeFilter)) return false;

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
      if (matchesSorCode(o, q)) return true;
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
    effectiveSaleTypeFilter,
    departmentFilter,
    subDeptFilter,
    ownershipRole,
    mineOnly,
    blockedOnly,
    blockedDeals,
    employeeFilter,
    user?.id,
    stageContext,
  ]);

  // ── Register sorting ────────────────────────────────────────────────────
  // `serial_no` descending is what the register showed before it was
  // sortable, so it stays the default — turning sorting on must not silently
  // reorder everyone's list on first load.
  const [sortField, setSortField] = useState("serial_no");
  const [sortOrder, setSortOrder] = useState("desc"); // 'asc' | 'desc'
  // Issue #206: distinguishes the untouched default order (which sinks
  // Terminal Stage SORs to the bottom) from a column sort the user actually
  // chose (which overrides that, even a click back onto "SOR").
  const [hasExplicitSort, setHasExplicitSort] = useState(false);

  const handleSort = (field) => {
    setHasExplicitSort(true);
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
      // Issue #206: in the default order (no explicit column sort chosen),
      // a Terminal Stage SOR sinks below everything still moving. Choosing a
      // column sort overrides this — it applies only to the untouched default.
      if (!hasExplicitSort) {
        const aTerminal = isOnTerminalStage(a, stageContext);
        const bTerminal = isOnTerminalStage(b, stageContext);
        if (aTerminal !== bTerminal) return aTerminal ? 1 : -1;
      }

      const av = key(a);
      const bv = key(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      // Stable tiebreak so equal keys never shuffle between renders.
      return (Number(b.serial_no) || 0) - (Number(a.serial_no) || 0);
    });
  }, [filtered, sortField, sortOrder, stageRank, activeLeadSources, stageContext, hasExplicitSort]);

  const totals = useMemo(() => {
    const open = filtered.filter((o) => isOpenPipelineOpportunity(o, stageContext));
    const won = filtered.filter((o) => isRealizedOpportunity(o, stageContext));
    return {
      count: filtered.length,
      openValue: open.reduce((sum, o) => sum + Number(o.expected_value || 0), 0),
      wonValue: won.reduce((sum, o) => sum + Number(o.expected_value || 0), 0),
    };
  }, [filtered, stageContext, pipelineStages]);

  const { data: directOpportunity, isError: directOpportunityRefused } = useQuery({
    queryKey: ["opportunity", selectedId],
    queryFn: () => opportunityService.getOpportunityById(selectedId),
    enabled: !!selectedId && !opportunities.some((o) => o.id === selectedId),
    retry: false,
  });

  // #474: RLS returns no row below full access, so a deep link to an SOR the
  // viewer cannot fully read used to open nothing. Hand it to the global modal,
  // which branches on access level and shows the participant, locked or
  // no-access view instead.
  useEffect(() => {
    if (!directOpportunityRefused || !selectedId) return;
    window.dispatchEvent(new CustomEvent("OPEN_ENTITY_DETAILS", { detail: { id: selectedId, type: "OPPORTUNITY" } }));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedId(null);
  }, [directOpportunityRefused, selectedId]);

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
    saleTypeFilter !== "ALL" ||
    departmentFilter !== "ALL" ||
    subDeptFilter !== "ALL" ||
    ownershipRole !== "ALL" ||
    employeeFilter !== "ALL" ||
    mineOnly ||
    blockedOnly;

  // The tab picks WHICH records; search and Filters narrow within them. Only
  // List and Board read `filtered` — Overview draws straight from
  // `opportunities` and Deleted runs its own query — so on those two tabs the
  // control row would offer a search that does nothing and read out figures
  // for a set the user is not looking at.
  const supportsFiltering = view === "list" || view === "board";

  // What the Filters badge counts. `search` is deliberately left out: it has
  // its own box beside the button now, and counting it lit the button up
  // merely because someone was typing.
  const activeFilterCount = [
    stageFilter !== "ALL",
    leadSourceFilter !== "ALL",
    projectTypeFilter !== "ALL",
    saleTypeFilter !== "ALL",
    departmentFilter !== "ALL",
    subDeptFilter !== "ALL",
    ownershipRole !== "ALL",
    employeeFilter !== "ALL",
    mineOnly,
    blockedOnly,
  ].filter(Boolean).length;

  const handleClearAll = () => {
    setSearch("");
    setStageFilter("ALL");
    setLeadSourceFilter("ALL");
    setProjectTypeFilter("ALL");
    setSaleTypeFilter("ALL");
    setDepartmentFilter("ALL");
    setSubDeptFilter("ALL");
    setOwnershipRole("ALL");
    setMineOnly(false);
    setBlockedOnly(false);
    setEmployeeFilter("ALL");
  };

  // The toolbar, in reading order: what you are looking for, what it came
  // to, how it is narrowed. Search, the figures and Filters speak only for List
  // and Board — Overview draws straight from `opportunities` and Deleted runs
  // its own query — so on those the toolbar slot is left empty and the space
  // goes to the content. It is the one-line filter form: search, the result
  // readout, and a Filters popover carrying every other filter with a count.
  const toolbar = supportsFiltering && (
    <div className="flex w-full min-w-0 items-center gap-2 sm:gap-3">
      <div className="flex h-9 min-w-[7rem] max-w-[360px] flex-1 items-center gap-2 rounded-xl border border-border bg-muted/30 px-2.5 focus-within:border-mauve-7 sm:px-3 2xl:max-w-[520px]">
        <Search size={15} className="shrink-0 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search number, client, project, deal owner…"
          containerClassName="w-full"
          className="h-auto rounded-none border-0 bg-transparent px-0 py-0 text-sm font-medium text-foreground shadow-none outline-none placeholder:text-muted-foreground/50 focus-visible:ring-0"
        />
      </div>

      <span aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-border lg:block" />

      <SorsTotals
        className="hidden lg:flex"
        count={totals.count}
        openValue={totals.openValue}
        wonValue={totals.wonValue}
      />

      {/* The drill-down arriving from Overview or a notification. It is counted
          in the Filters badge like any other filter, but it is the one a
          visitor lands on without having set it, so it keeps a one-click way
          back out. */}
      {employeeFilter && employeeFilter !== "ALL" && (
        <Button
          variant="outline"
          onClick={() => setEmployeeFilter("ALL")}
          title={`Filtered to ${employeeFilterName || "employee"} — click to clear`}
          className="hidden h-9 max-w-[120px] shrink-0 gap-1.5 rounded-xl border-mauve-6 bg-muted px-3 text-xs font-bold text-foreground ring-1 ring-mauve-4 hover:bg-muted sm:inline-flex xl:max-w-[170px]"
        >
          <span className="truncate">{employeeFilterName || "employee"}</span>
          <X size={12} className="shrink-0" />
        </Button>
      )}

      <div className="flex-1" />

          {/* Filters popover — every filter the register offers lives here, so
              the row stays one line regardless of how many are active, and the
              badge says how many that is. */}
            <Dropdown
              usePortal={true}
              placement="bottom-end"
              className="shrink-0"
              trigger={({ isOpen }) => (
                <FilterTrigger
                  className="h-9 w-auto gap-2 px-2.5 sm:px-3"
                  labelClassName="hidden sm:block"
                  icon={SlidersHorizontal}
                  label="Filters"
                  count={activeFilterCount}
                  isActive={activeFilterCount > 0}
                  isOpen={isOpen}
                />
              )}
            >
            {({ close }) => (
              <div className="flex w-[min(90vw,560px)] flex-col gap-2.5 p-1">
                {/* Row 1: Departments */}
                <div className="flex gap-2.5">
                  <Dropdown
                    usePortal={true}
                    className="min-w-0 flex-1"
                    trigger={({ isOpen }) => (
                      <FilterTrigger
                        icon={Building2}
                        label={currentDepartmentLabel}
                        isActive={departmentFilter !== "ALL"}
                        isOpen={isOpen}
                      />
                    )}
                  >
                    {({ close: closeInner }) => (
                      <FilterOptionList
                        options={departmentOptions}
                        value={departmentFilter}
                        onChange={setDepartmentFilter}
                        close={closeInner}
                      />
                    )}
                  </Dropdown>

                  <Dropdown
                    usePortal={true}
                    className="min-w-0 flex-1"
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
                    {({ close: closeInner }) => (
                      <FilterOptionList
                        options={subDepartmentOptions}
                        value={subDeptFilter}
                        onChange={setSubDeptFilter}
                        close={closeInner}
                      />
                    )}
                  </Dropdown>
                </div>

                {/* Row 2: Role / Employee & Project Type */}
                <div className="flex gap-2.5">
                  <div className="flex min-w-0 flex-[2] rounded-lg border border-border bg-card">
                    <Dropdown
                      usePortal={true}
                      className="w-1/2"
                      trigger={({ isOpen }) => (
                        <FilterTrigger
                          className="rounded-none rounded-l-lg border-0 border-r border-border hover:border-border/80"
                          icon={Users}
                          label={currentRoleLabel}
                          isActive={ownershipRole !== "ALL"}
                          isOpen={isOpen}
                        />
                      )}
                    >
                      {({ close: closeInner }) => (
                        <FilterOptionList
                          options={ownershipRoleOptions}
                          value={ownershipRole}
                          onChange={setOwnershipRole}
                          close={closeInner}
                        />
                      )}
                    </Dropdown>
                    <Dropdown
                      usePortal={true}
                      className="w-1/2"
                      trigger={({ isOpen }) => (
                        <FilterTrigger
                          className="rounded-none rounded-r-lg border-0 hover:border-border/80"
                          label={currentEmployeeLabel}
                          isActive={employeeFilter !== "ALL"}
                          isOpen={isOpen}
                        />
                      )}
                    >
                      {({ close: closeInner }) => (
                        <FilterOptionList
                          options={employeeOptions}
                          value={employeeFilter}
                          onChange={setEmployeeFilter}
                          close={closeInner}
                        />
                      )}
                    </Dropdown>
                  </div>

                  <Dropdown
                    usePortal={true}
                    className="min-w-0 flex-1"
                    trigger={({ isOpen }) => (
                      <FilterTrigger
                        icon={Layers}
                        label={currentProjectTypeLabel}
                        isActive={projectTypeFilter !== "ALL"}
                        isOpen={isOpen}
                      />
                    )}
                  >
                    {({ close: closeInner }) => (
                      <FilterOptionList
                        options={projectTypeOptions}
                        value={projectTypeFilter}
                        onChange={setProjectTypeFilter}
                        close={closeInner}
                      />
                    )}
                  </Dropdown>
                </div>

                {/* Row 3: Sale Type (All SORs), Stages, Lead Sources */}
                <div className="flex gap-2.5">
                  <SaleTypeFilter saleTypes={allSaleTypes} value={saleTypeFilter} onChange={setSaleTypeFilter} />

                  <Dropdown
                    usePortal={true}
                    className="min-w-0 flex-1"
                    trigger={({ isOpen }) => (
                      <FilterTrigger
                        icon={Tag}
                        label={currentStageLabel}
                        isActive={stageFilter !== "ALL"}
                        isOpen={isOpen}
                      />
                    )}
                  >
                    {({ close: closeInner }) => (
                      <FilterOptionList
                        options={stageOptions}
                        value={stageFilter}
                        onChange={setStageFilter}
                        close={closeInner}
                      />
                    )}
                  </Dropdown>

                  <Dropdown
                    usePortal={true}
                    className="min-w-0 flex-1"
                    trigger={({ isOpen }) => (
                      <FilterTrigger
                        label={currentLeadSourceLabel}
                        isActive={leadSourceFilter !== "ALL"}
                        isOpen={isOpen}
                      />
                    )}
                  >
                    {({ close: closeInner }) => (
                      <FilterOptionList
                        options={leadSourceOptions}
                        value={leadSourceFilter}
                        onChange={setLeadSourceFilter}
                        close={closeInner}
                      />
                    )}
                  </Dropdown>
                </div>

                {/* Row 4: Toggles and Clear All */}
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setMineOnly((v) => !v)}
                      className={`h-9 shrink-0 rounded-xl px-3.5 text-sm font-bold ${mineOnly
                        ? "border-mauve-6 bg-muted font-bold text-foreground ring-1 ring-mauve-4"
                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      My Deals
                    </Button>
                    {/* Sales Director visibility (Stage Gate Engine ticket 6,
                        story 25) — which deals are stuck on their own Stage,
                        without hunting for it deal by deal. */}
                    <Button
                      variant="outline"
                      onClick={() => setBlockedOnly((v) => !v)}
                      className={`h-9 shrink-0 gap-1.5 rounded-xl px-3.5 text-sm font-bold ${blockedOnly
                        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400"
                        : "border-border bg-muted/30 text-muted-foreground hover:text-foreground"
                        }`}
                    >
                      <AlertTriangle size={13} />
                      Blocked
                    </Button>
                  </div>

                  {hasActiveFilters && (
                    <Button
                      variant="link"
                      onClick={() => {
                        handleClearAll();
                        close();
                      }}
                      className="h-auto p-0 text-sm font-semibold text-muted-foreground hover:text-foreground hover:no-underline"
                    >
                      Clear filters
                    </Button>
                  )}
                </div>
              </div>
            )}
      </Dropdown>
    </div>
  );

  return (
    <ProtectedRoute>
      {/* Issue #206: the register is something you pan or scan across, so it
          fills the app frame (frame="full") instead of sitting in the centred
          page column. Register type (ADR 0029): the view strip is the display
          toggle and Register SOR the one main action, both in the header's
          action slot; the one-line filter row is the toolbar slot. */}
      <PageShell
        title="SOR Register"
        frame="full"
        action={
          <>
            <SorsViewTabs view={view} onChange={changeView} />
            <Button onClick={() => setFormOpen(true)}>
              <Plus size={16} strokeWidth={2.5} />
              Register SOR
            </Button>
          </>
        }
        toolbar={toolbar}
      >
        {view === "deleted" ? (
          <DeletedOpportunitiesView currentUserId={user?.id} isSuperAdmin={isSuperAdmin} />
        ) : view === "overview" ? (
          <div>
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
          <div className="border border-border rounded-2xl overflow-hidden bg-card">
            <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
              <Spinner size="sm" />
              <span className="text-sm font-bold uppercase tracking-widest">
                Loading register…
              </span>
            </div>
          </div>
        ) : view === "board" && opportunities.length > 0 ? (
          <OpportunityBoard
            opportunities={filtered}
            search={search}
            deadlineStatuses={deadlineStatuses}
            flowStagesIndex={flowStagesIndex}
            snapshotsById={snapshotsById}
            blockedDeals={blockedDeals}
            saleTypes={saleTypes}
            stages={pipelineStages}
            onCardClick={(o) => setSelectedId(o.id)}
            onMoved={() => queryClient.invalidateQueries({ queryKey: ["opportunities"] })}
            currentUserId={user?.id}
            saleTypeFilter={saleTypeFilter}
            onSaleTypeChange={setSaleTypeFilter}
            onSwitchToList={() => changeView("list")}
          />
        ) : filtered.length === 0 ? (
          <div className="border border-border rounded-2xl overflow-hidden bg-card">
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
        ) : (
          <div className="border border-border rounded-2xl overflow-hidden bg-card">
            <div className="overflow-x-auto">
              <Table className="table-fixed">
                <TableHeader>
                  {/* Sortable headers. The interaction styling is
                      TaskTableView's — cursor-pointer hover:text-foreground
                      transition-colors — but the padding stays at this
                      table's own px-2.5/py-2.5: ten columns already overflow
                      the fixed layout, and px-4 gutters would push Status out
                      of view. */}
                  <TableRow>
                    <SortableTh field="serial_no" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[80px]">SOR</SortableTh>
                    <SortableTh field="sales_reference" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[76px]">Sales Ref.</SortableTh>
                    <SortableTh field="registration_date" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[84px]">Date</SortableTh>
                    <SortableTh field="lead_source" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[13%]">Lead Source</SortableTh>
                    <SortableTh field="client_name" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[18%]">Company</SortableTh>
                    <SortableTh field="project_title" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[20%]">Project</SortableTh>
                    <SortableTh field="expected_value" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} align="right" className="w-[114px]">Expected Value</SortableTh>
                    <SortableTh field="project_type" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} align="center" className="px-2 w-[44px]">Div.</SortableTh>
                    <SortableTh field="deal_owner" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[13%]">Deal Owner</SortableTh>
                    <SortableTh field="status" sortField={sortField} sortOrder={sortOrder} onSort={handleSort} className="w-[150px]">Status</SortableTh>
                  </TableRow>
                </TableHeader>
                <TableBody>
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
                      <TableRow
                        key={o.id}
                        onClick={() => setSelectedId(o.id)}
                        className="cursor-pointer"
                      >
                        <TableCell className="px-2.5 py-2.5 font-mono text-xs font-bold text-primary whitespace-nowrap">
                          <HighlightText text={sorCodeOf(o)} search={search} />
                        </TableCell>
                        <TableCell
                          className="px-2.5 py-2.5 font-mono text-xs whitespace-nowrap truncate"
                          title={o.sales_reference || ""}
                        >
                          {o.sales_reference ? (
                            <HighlightText text={o.sales_reference} search={search} />
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </TableCell>
                        <TableCell className="px-2.5 py-2.5 text-muted-foreground whitespace-nowrap text-xs">
                          {dateFormatted}
                        </TableCell>
                        <TableCell
                          className="px-2.5 py-2.5 text-xs truncate whitespace-nowrap"
                          title={leadSourceText}
                        >
                          <HighlightText text={leadSourceText} search={search} />
                        </TableCell>
                        <TableCell
                          className="px-2.5 py-2.5 font-semibold text-xs truncate whitespace-nowrap"
                          title={o.client_name}
                        >
                          <HighlightText text={o.client_name} search={search} />
                        </TableCell>
                        <TableCell
                          className="px-2.5 py-2.5 text-xs truncate whitespace-nowrap"
                          title={o.project_title}
                        >
                          <HighlightText text={o.project_title} search={search} />
                        </TableCell>
                        <TableCell className="px-2.5 py-2.5 text-right font-bold text-xs whitespace-nowrap">
                          {formatPHP(o.expected_value)}
                        </TableCell>
                        <TableCell className="px-2 py-2.5 text-center text-xs font-bold text-muted-foreground whitespace-nowrap">
                          {PROJECT_TYPE_SHORT[o.project_type] || o.project_type}
                        </TableCell>
                        <TableCell
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
                        </TableCell>
                        <TableCell className="px-2.5 py-2.5 whitespace-nowrap overflow-hidden">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {(() => {
                              const display = stageDisplay(o);
                              return display.label ? (
                                <StatusBadge
                                  label={display.label}
                                  status={display.code}
                                  theme={display.tone}
                                  className="min-w-0 max-w-full truncate"
                                  title={display.label}
                                />
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
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </PageShell>

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

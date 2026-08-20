import { useState, useMemo, useEffect } from "react";
import { useLocation } from "react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Sparkles,
  TrendingUp,
  Percent,
  Layers,
  Users,
  Search,
  Download,
  Calendar,
  Filter,
  CheckCircle2,
  Building2,
  FileSpreadsheet,
  Lock,
  ArrowUpRight,
  HelpCircle,
} from "lucide-react";
import { commissionService } from "../../services/commissionService";
import { useAuth } from "../../context/AuthContext";
import { formatPHP, OPPORTUNITY_STAGES, PROJECT_TYPES, REALIZED_STAGES } from "../../constants/sor";
import Spinner from "../ui/Spinner";
import TabGroup from "../ui/TabGroup";
import Avatar from "../Avatar";
import StatusBadge from "../StatusBadge";
import HighlightText from "../HighlightText";

const DATE_PRESETS = [
  { value: "ALL", label: "All Time" },
  { value: "THIS_MONTH", label: "This Month" },
  { value: "LAST_MONTH", label: "Last Month" },
  { value: "Q1", label: "Q1 (Jan - Mar)" },
  { value: "Q2", label: "Q2 (Apr - Jun)" },
  { value: "Q3", label: "Q3 (Jul - Sep)" },
  { value: "Q4", label: "Q4 (Oct - Dec)" },
  { value: "YTD", label: "Year-To-Date (YTD)" },
];

function getPresetDateRange(preset) {
  const now = new Date();
  const year = now.getFullYear();

  if (preset === "THIS_MONTH") {
    const start = new Date(year, now.getMonth(), 1).toISOString().slice(0, 10);
    const end = new Date(year, now.getMonth() + 1, 0).toISOString().slice(0, 10);
    return { startDate: start, endDate: end };
  }
  if (preset === "LAST_MONTH") {
    const start = new Date(year, now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const end = new Date(year, now.getMonth(), 0).toISOString().slice(0, 10);
    return { startDate: start, endDate: end };
  }
  if (preset === "Q1") {
    return { startDate: `${year}-01-01`, endDate: `${year}-03-31` };
  }
  if (preset === "Q2") {
    return { startDate: `${year}-04-01`, endDate: `${year}-06-30` };
  }
  if (preset === "Q3") {
    return { startDate: `${year}-07-01`, endDate: `${year}-09-30` };
  }
  if (preset === "Q4") {
    return { startDate: `${year}-10-01`, endDate: `${year}-12-31` };
  }
  if (preset === "YTD") {
    return { startDate: `${year}-01-01`, endDate: now.toISOString().slice(0, 10) };
  }
  return null;
}

/**
 * Downloads the commission transaction ledger as an audit-ready CSV.
 */
function downloadLedgerCsv(ledger = [], filename = "commission_ledger.csv") {
  const headers = [
    "SOR Number",
    "Client Name",
    "Project Title",
    "Stage",
    "Project Type",
    "Contract Date",
    "Created Date",
    "Contract Value (PHP)",
    "VAT Percent",
    "Withholding Percent",
    "Commissionable Revenue (PHP)",
    "Pool Percent",
    "Commission Pool (PHP)",
    "Sales Share (PHP)",
    "Deal Owner",
    "Deal Owner Share (PHP)",
    "Support Sales 1",
    "Support Sales 2",
    "Support Sales Total (PHP)",
    "Sales Director",
    "Sales Director Share (PHP)",
  ];

  const escapeCsv = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = ledger.map((deal) => {
    const ownerShare = deal.salesRoleShares.find((s) => s.role === "deal_owner")?.amount || 0;
    const supportShares = deal.salesRoleShares.filter((s) => s.role === "supporting_salesperson");
    const supportTotal = supportShares.reduce((sum, s) => sum + s.amount, 0);
    const directorShare = deal.salesRoleShares.find((s) => s.role === "sales_director")?.amount || 0;

    return [
      escapeCsv(deal.opportunityNo),
      escapeCsv(deal.clientName),
      escapeCsv(deal.projectTitle),
      escapeCsv(deal.status),
      escapeCsv(deal.projectType),
      escapeCsv(deal.contractDate || "—"),
      escapeCsv(deal.createdAt ? deal.createdAt.slice(0, 10) : "—"),
      (deal.contractValue || 0).toFixed(2),
      deal.rates?.vatPercent ?? "",
      deal.rates?.withholdingPercent ?? "",
      (deal.commissionableRevenue || 0).toFixed(2),
      deal.rates?.poolPercent ?? "",
      (deal.commissionPool || 0).toFixed(2),
      (deal.salesShareAmount || 0).toFixed(2),
      escapeCsv(deal.participants?.dealOwner?.name || "Unassigned"),
      ownerShare.toFixed(2),
      escapeCsv(deal.participants?.support1?.name || ""),
      escapeCsv(deal.participants?.support2?.name || ""),
      supportTotal.toFixed(2),
      escapeCsv(deal.participants?.salesDirector?.name || ""),
      directorShare.toFixed(2),
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function CommissionDashboardView() {
  const { user } = useAuth();
  const location = useLocation();

  const isSuperAdmin = !!(user?.is_super_admin || user?.isSuperAdmin);
  const isHead = !!(user?.is_head || user?.isHead);
  const isAccounting =
    isSuperAdmin ||
    user?.department?.toLowerCase().includes("accounting") ||
    user?.department?.toLowerCase().includes("finance");
  const canViewAllFinancials = isSuperAdmin || isAccounting;

  // Filter States
  const [scope, setScope] = useState("REALIZED"); // "REALIZED" | "FORECAST"
  const [datePreset, setDatePreset] = useState("ALL");
  const [activeTab, setActiveTab] = useState(() => {
    if (location.state?.openOpportunityId) return "transaction-ledger";
    return "sales-roster";
  });
  const [search, setSearch] = useState("");
  const [selectedSalesRep, setSelectedSalesRep] = useState("ALL");
  const [selectedProjectType, setSelectedProjectType] = useState("ALL");
  const [highlightedDealId, setHighlightedDealId] = useState(
    () => location.state?.openOpportunityId || null,
  );

  useEffect(() => {
    if (location.state?.openOpportunityId) {
      setHighlightedDealId(location.state.openOpportunityId);
      setActiveTab("transaction-ledger");
    }
  }, [location.state]);

  const dateFilter = useMemo(() => getPresetDateRange(datePreset), [datePreset]);

  const { data: dashboard, isLoading, error } = useQuery({
    queryKey: ["commissionDashboard", scope, datePreset],
    queryFn: () =>
      commissionService.getCommissionDashboardData({
        scope,
        dateFilter,
      }),
  });

  // Filtered Ledger based on search & local filters
  const filteredLedger = useMemo(() => {
    if (!dashboard?.dealLedger) return [];
    const q = search.trim().toLowerCase();

    return dashboard.dealLedger.filter((deal) => {
      if (selectedProjectType !== "ALL" && deal.projectType !== selectedProjectType) return false;
      if (selectedSalesRep !== "ALL") {
        const matchesOwner = deal.participants?.dealOwner?.id === selectedSalesRep;
        const matchesSupport1 = deal.participants?.support1?.id === selectedSalesRep;
        const matchesSupport2 = deal.participants?.support2?.id === selectedSalesRep;
        const matchesDirector = deal.participants?.salesDirector?.id === selectedSalesRep;
        if (!matchesOwner && !matchesSupport1 && !matchesSupport2 && !matchesDirector) return false;
      }
      if (!q) return true;
      return [
        deal.opportunityNo,
        deal.clientName,
        deal.projectTitle,
        deal.participants?.dealOwner?.name,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [dashboard?.dealLedger, search, selectedProjectType, selectedSalesRep]);

  // Monthly aggregated data for trend visualization
  const monthlyTrendData = useMemo(() => {
    if (!dashboard?.dealLedger) return [];
    const monthMap = {};

    dashboard.dealLedger.forEach((deal) => {
      const dateStr = deal.contractDate || deal.createdAt?.slice(0, 10);
      if (!dateStr) return;
      const monthKey = dateStr.slice(0, 7); // "YYYY-MM"
      if (!monthMap[monthKey]) {
        monthMap[monthKey] = {
          monthKey,
          label: new Date(`${monthKey}-01`).toLocaleDateString("en-US", {
            month: "short",
            year: "numeric",
          }),
          revenue: 0,
          pool: 0,
          count: 0,
        };
      }
      monthMap[monthKey].revenue += deal.commissionableRevenue || 0;
      monthMap[monthKey].pool += deal.commissionPool || 0;
      monthMap[monthKey].count += 1;
    });

    return Object.values(monthMap).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
  }, [dashboard?.dealLedger]);

  if (isLoading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Spinner size="lg" />
        <p className="text-sm font-medium text-muted-foreground">
          Accumulating commission ledger & analytics…
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 text-center">
        <p className="font-semibold text-destructive">Failed to load commission analytics</p>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
      </div>
    );
  }

  const {
    totalCommissionableRevenue = 0,
    totalCommissionPool = 0,
    salesDeptTotal = 0,
    otherDeptsTotal = 0,
    wonDealsCount = 0,
    totalDealsCount = 0,
    departmentTotals = [],
    salesEmployees = [],
  } = dashboard || {};

  const maxLeaderboardShare =
    salesEmployees.length > 0 ? Math.max(...salesEmployees.map((e) => e.totalCommissionShare)) : 1;

  return (
    <div className="space-y-6">
      {/* Top Filter / Control Bar */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Scope Toggle */}
          <div className="flex items-center rounded-xl bg-muted p-1 text-[12px] font-semibold">
            <button
              type="button"
              onClick={() => setScope("REALIZED")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                scope === "REALIZED"
                  ? "bg-card text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CheckCircle2 size={13} className={scope === "REALIZED" ? "text-primary" : ""} />
              <span>Realized Pool</span>
            </button>
            <button
              type="button"
              onClick={() => setScope("FORECAST")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-all ${
                scope === "FORECAST"
                  ? "bg-card text-foreground shadow-xs font-bold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <TrendingUp size={13} className={scope === "FORECAST" ? "text-primary" : ""} />
              <span>Pipeline Forecast</span>
            </button>
          </div>

          {/* Date Presets Dropdown */}
          <div className="flex items-center gap-1.5">
            <Calendar size={14} className="text-muted-foreground" />
            <select
              value={datePreset}
              onChange={(e) => setDatePreset(e.target.value)}
              className="h-9 rounded-xl border border-border bg-background px-3 text-[12.5px] font-medium text-foreground outline-none hover:border-border/80 focus:border-primary"
            >
              {DATE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2.5">
          {canViewAllFinancials && (
            <button
              type="button"
              onClick={() => downloadLedgerCsv(filteredLedger)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3.5 py-2 text-[12.5px] font-bold text-foreground transition-all hover:bg-muted shadow-2xs hover:border-border/80"
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Commission Pool */}
        <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-card to-background p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
              Total Commission Pool
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/20 text-primary">
              <Sparkles size={16} />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tabular-nums text-foreground">
              {canViewAllFinancials ? formatPHP(totalCommissionPool) : "••••••"}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {canViewAllFinancials ? "1% of Commissionable Revenue" : "Restricted to Accounting"}
            </p>
          </div>
        </div>

        {/* Card 2: Commissionable Revenue */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Commissionable Revenue
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <TrendingUp size={16} />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tabular-nums text-foreground">
              {formatPHP(totalCommissionableRevenue)}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Net of VAT & Withholding
            </p>
          </div>
        </div>

        {/* Card 3: Sales Department Share */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Sales Department Share
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Users size={16} />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tabular-nums text-foreground">
              {canViewAllFinancials || isHead ? formatPHP(salesDeptTotal) : "50.00% Pool"}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              50% allocation to Sales personnel
            </p>
          </div>
        </div>

        {/* Card 4: Deals Won & Volume */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
              Won Opportunities
            </span>
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold tabular-nums text-foreground">
              {wonDealsCount}{" "}
              <span className="text-sm font-normal text-muted-foreground">
                / {totalDealsCount} deals
              </span>
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {scope === "REALIZED" ? "Awarded through Closed Won" : "Including active pipeline"}
            </p>
          </div>
        </div>
      </div>

      {/* Visual Analytics Section */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Monthly Trend Progress Visual */}
        <div className="lg:col-span-7 flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <TrendingUp size={14} />
                </div>
                <h4 className="text-[13px] font-bold uppercase tracking-wider text-foreground">
                  Revenue & Pool Velocity
                </h4>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {monthlyTrendData.length} active period{monthlyTrendData.length === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Historical accumulation of commissionable revenue and pool reserves by month.
            </p>
          </div>

          <div className="mt-6 space-y-4">
            {monthlyTrendData.length === 0 ? (
              <p className="py-8 text-center text-xs text-muted-foreground">
                No monthly transactions recorded for this period.
              </p>
            ) : (
              monthlyTrendData.slice(-6).map((item) => {
                const maxRev = Math.max(...monthlyTrendData.map((d) => d.revenue)) || 1;
                const pct = Math.min(100, Math.max(10, (item.revenue / maxRev) * 100));

                return (
                  <div key={item.monthKey} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold">
                      <span className="text-foreground">{item.label}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-muted-foreground tabular-nums">
                          {formatPHP(item.revenue)}
                        </span>
                        {canViewAllFinancials && (
                          <span className="font-bold text-primary tabular-nums">
                            {formatPHP(item.pool)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Department Distribution Donut / Split Card */}
        <div className="lg:col-span-5 flex flex-col justify-between rounded-2xl border border-border bg-card p-6 shadow-xs">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Building2 size={14} />
              </div>
              <h4 className="text-[13px] font-bold uppercase tracking-wider text-foreground">
                Department Allocations
              </h4>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Fixed percentage split of the pool across company operational units.
            </p>
          </div>

          <div className="mt-6 space-y-3">
            {departmentTotals.map((dept) => (
              <div
                key={dept.name}
                className="flex items-center justify-between rounded-xl bg-muted/30 px-3.5 py-2.5 transition-all hover:bg-muted/50"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      dept.isSales ? "bg-primary" : "bg-muted-foreground/60"
                    }`}
                  />
                  <div>
                    <p className="text-[12.5px] font-bold text-foreground">{dept.name}</p>
                    <p className="text-[10.5px] text-muted-foreground">
                      {dept.allocationPercent}% allocation
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[13px] font-bold tabular-nums text-foreground">
                    {canViewAllFinancials || (dept.isSales && isHead)
                      ? formatPHP(dept.amount)
                      : `${dept.allocationPercent}%`}
                  </p>
                  {!canViewAllFinancials && !dept.isSales && (
                    <span className="text-[9.5px] text-muted-foreground">Accounting Only</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Multi-Tab Ledger Section */}
      <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-border/60 pb-4">
          <TabGroup
            tabs={[
              { value: "sales-roster", label: "Sales Roster Summary", icon: Users },
              { value: "transaction-ledger", label: "Transaction Ledger", icon: FileSpreadsheet },
              { value: "department-breakdown", label: "Department Allocations", icon: Layers },
            ]}
            activeTab={activeTab}
            onChange={setActiveTab}
            variant="pill"
            size="sm"
          />

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <input
              type="text"
              placeholder="Search deals, clients, reps…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full rounded-xl border border-border bg-background pl-9 pr-3 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-primary"
            />
          </div>
        </div>

        {/* TAB 1: Sales Roster Summary */}
        {activeTab === "sales-roster" && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead>
                <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  <th className="py-3 px-4">Salesperson</th>
                  <th className="py-3 px-4 text-center">Won Deals</th>
                  <th className="py-3 px-4 text-right">Credited Volume</th>
                  <th className="py-3 px-4 text-right">Deal Owner Share</th>
                  <th className="py-3 px-4 text-right">Support Share</th>
                  <th className="py-3 px-4 text-right">Director Share</th>
                  <th className="py-3 px-4 text-right">Total Commission</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {salesEmployees.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-muted-foreground">
                      No sales employee records found for the selected filter.
                    </td>
                  </tr>
                ) : (
                  salesEmployees.map((emp) => {
                    const isCurrentUser = emp.employeeId === user?.id;
                    const canSeeEmpAmounts = canViewAllFinancials || isHead || isCurrentUser;

                    return (
                      <tr
                        key={emp.employeeId}
                        className={`transition-colors hover:bg-muted/30 ${
                          isCurrentUser ? "bg-primary/5 font-semibold" : ""
                        }`}
                      >
                        <td className="py-3.5 px-4">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={emp.name} src={emp.avatarPath} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate font-bold text-foreground">
                                {emp.name}{" "}
                                {isCurrentUser && (
                                  <span className="ml-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                                    You
                                  </span>
                                )}
                              </p>
                              <p className="text-[10.5px] text-muted-foreground">
                                {emp.totalDealsCount} total involved
                              </p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-center font-semibold tabular-nums text-foreground">
                          {emp.wonDealsCount}
                        </td>
                        <td className="py-3.5 px-4 text-right font-medium tabular-nums text-muted-foreground">
                          {formatPHP(emp.totalContractValue)}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground">
                          {canSeeEmpAmounts
                            ? formatPHP(emp.roleBreakdown.deal_owner)
                            : "••••••"}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground">
                          {canSeeEmpAmounts
                            ? formatPHP(emp.roleBreakdown.supporting_salesperson)
                            : "••••••"}
                        </td>
                        <td className="py-3.5 px-4 text-right tabular-nums text-muted-foreground">
                          {canSeeEmpAmounts
                            ? formatPHP(emp.roleBreakdown.sales_director)
                            : "••••••"}
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span className="font-bold tabular-nums text-foreground">
                            {canSeeEmpAmounts
                              ? formatPHP(emp.totalCommissionShare)
                              : `${(
                                  (emp.totalCommissionShare / (salesDeptTotal || 1)) *
                                  100
                                ).toFixed(1)}% Share`}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* TAB 2: Transaction Ledger */}
        {activeTab === "transaction-ledger" && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-border/60 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-3">SOR #</th>
                    <th className="py-3 px-3">Client & Project</th>
                    <th className="py-3 px-3">Stage</th>
                    <th className="py-3 px-3">Type</th>
                    <th className="py-3 px-3">Contract Date</th>
                    <th className="py-3 px-3 text-right">Contract Value</th>
                    <th className="py-3 px-3 text-right">Commissionable</th>
                    <th className="py-3 px-3 text-right">Pool</th>
                    <th className="py-3 px-3">Participants & Role Splits</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {filteredLedger.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-muted-foreground">
                        No transactions match the selected filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLedger.map((deal) => {
                      const isHighlighted = highlightedDealId === deal.id;

                      return (
                        <tr
                          key={deal.id}
                          className={`transition-colors hover:bg-muted/30 ${
                            isHighlighted ? "bg-primary/10 ring-1 ring-primary/40" : ""
                          }`}
                        >
                          <td className="py-3 px-3 font-mono font-bold text-foreground">
                            <HighlightText text={deal.opportunityNo} query={search} />
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-foreground">
                              <HighlightText text={deal.clientName} query={search} />
                            </p>
                            <p className="truncate text-[10.5px] text-muted-foreground max-w-[180px]">
                              <HighlightText text={deal.projectTitle} query={search} />
                            </p>
                          </td>
                          <td className="py-3 px-3">
                            <StatusBadge status={deal.status} />
                          </td>
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
                              {deal.projectType}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-muted-foreground">
                            {deal.contractDate || "—"}
                          </td>
                          <td className="py-3 px-3 text-right font-medium tabular-nums text-foreground">
                            {formatPHP(deal.contractValue)}
                          </td>
                          <td className="py-3 px-3 text-right font-medium tabular-nums text-muted-foreground">
                            {formatPHP(deal.commissionableRevenue)}
                          </td>
                          <td className="py-3 px-3 text-right font-bold tabular-nums text-foreground">
                            {canViewAllFinancials ? formatPHP(deal.commissionPool) : "••••••"}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1.5 max-w-[280px]">
                              {deal.salesRoleShares.map((roleShare, i) => {
                                const isUser = roleShare.employee?.id === user?.id;
                                const showMoney = canViewAllFinancials || isHead || isUser;

                                return (
                                  <span
                                    key={`${roleShare.role}-${i}`}
                                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] ${
                                      isUser
                                        ? "bg-primary/20 text-primary font-bold border border-primary/30"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    <span>{roleShare.employee?.name || "Unassigned"}:</span>
                                    <span className="font-semibold tabular-nums">
                                      {showMoney ? formatPHP(roleShare.amount) : "•••"}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: Department Allocations Breakdown */}
        {activeTab === "department-breakdown" && (
          <div className="space-y-4">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-border/60 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    <th className="py-3 px-4">Commission Department</th>
                    <th className="py-3 px-4 text-center">Fixed Allocation</th>
                    <th className="py-3 px-4 text-right">Accumulated Pool Reserve</th>
                    <th className="py-3 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {departmentTotals.map((dept) => (
                    <tr key={dept.name} className="hover:bg-muted/30">
                      <td className="py-3.5 px-4 font-bold text-foreground">{dept.name}</td>
                      <td className="py-3.5 px-4 text-center font-semibold tabular-nums text-foreground">
                        {dept.allocationPercent}%
                      </td>
                      <td className="py-3.5 px-4 text-right font-bold tabular-nums text-foreground">
                        {canViewAllFinancials || (dept.isSales && isHead)
                          ? formatPHP(dept.amount)
                          : "Restricted"}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-muted-foreground">
                        {dept.isSales
                          ? "Distributed directly to Deal Owners, Supporters, and Sales Directors."
                          : "Company reserve split per Commission Pool configuration."}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

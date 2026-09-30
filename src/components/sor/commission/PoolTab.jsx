import { useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { ResponsiveContainer, AreaChart, Area, XAxis, Tooltip } from "recharts";
import { Download, Search } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Avatar from "../../Avatar";
import StatusBadge from "../../StatusBadge";
import HighlightText from "../../HighlightText";
import { formatPHP } from "../../../constants/sor";
import { MASK, TONE, compactPHP, downloadLedgerCsv, monthlyPool, projectTypeInfo } from "./commissionView";
import { Pager, Swatch, UnderlineTabs } from "./parts";
import DealCommissionModal from "./DealCommissionModal";

const PAGE_SIZE = 10;

function ChartTooltip({ active, payload, canSee }) {
  if (!active || !payload?.length) return null;
  const month = payload[0].payload;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="font-semibold text-foreground">{month.label}</p>
      <p className="mt-0.5 tabular-nums text-muted-foreground">
        {canSee ? formatPHP(month.pool) : MASK} · {month.count} SOR{month.count === 1 ? "" : "s"}
      </p>
    </div>
  );
}

/**
 * The pool at a glance — the figure, its trend, where it goes by Commission
 * Department — then every SOR and every salesperson behind it. A SOR row opens
 * its receipt; `initialDealId` opens one straight away (the SOR modal's
 * "view in Commission Dashboard" link).
 */
export default function PoolTab({ access, departments, initialDealId }) {
  const navigate = useNavigate();
  const { dashboard, rates, user, canViewAllFinancials, canViewSalesAmounts } = access;
  const [list, setList] = useState("deals");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [openDealId, setOpenDealId] = useState(initialDealId ?? null);

  const ledger = useMemo(() => dashboard.dealLedger || [], [dashboard]);
  const months = useMemo(() => monthlyPool(ledger), [ledger]);
  const needle = search.trim().toLowerCase();
  const deals = ledger.filter(
    (d) => !needle || [d.opportunityNo, d.clientName, d.projectTitle, d.participants?.dealOwner?.name].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)),
  );
  const people = (dashboard.salesEmployees || []).filter((e) => !needle || e.name?.toLowerCase().includes(needle));
  const rows = list === "deals" ? deals : people;
  const lastPage = Math.max(0, Math.ceil(rows.length / PAGE_SIZE) - 1);
  const safePage = Math.min(page, lastPage);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const openDeal = ledger.find((d) => d.id === openDealId);

  return (
    <div className="space-y-8">
      <section className="grid gap-8 lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium text-muted-foreground">Commission Pool</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-foreground">
              {canViewAllFinancials ? formatPHP(dashboard.totalCommissionPool) : MASK}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              An estimate · {rates.pool}% of {canViewAllFinancials ? compactPHP(dashboard.totalCommissionableRevenue) : "Commissionable Revenue"}
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Sales fund</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{canViewSalesAmounts ? formatPHP(dashboard.salesDeptTotal) : MASK}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Won SORs</dt>
              <dd className="mt-0.5 font-semibold tabular-nums text-foreground">
                {dashboard.wonDealsCount ?? 0} <span className="font-normal text-muted-foreground">of {dashboard.totalDealsCount ?? 0}</span>
              </dd>
            </div>
          </dl>
        </div>
        <div className="h-[200px] min-w-0">
          {months.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground">No SORs in this period.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 600, height: 200 }}>
              <AreaChart data={months} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                <defs>
                  <linearGradient id="commission-pool-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--blue-9)" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="var(--blue-9)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" tick={{ fontSize: 11, fill: "var(--mauve-10)" }} />
                <Tooltip content={<ChartTooltip canSee={canViewAllFinancials} />} cursor={{ stroke: "var(--mauve-7)" }} />
                <Area type="monotone" dataKey="pool" stroke="var(--blue-9)" strokeWidth={2} fill="url(#commission-pool-area)" activeDot={{ r: 4, strokeWidth: 0 }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-foreground">Where the pool goes</h3>
        <div className="mt-3 flex h-2.5 w-full gap-0.5 overflow-hidden rounded-full">
          {departments.map((d) => (
            <span key={d.name} title={`${d.name} ${d.allocationPercent}%`} className="h-full" style={{ width: `${d.allocationPercent}%`, background: d.color }} />
          ))}
        </div>
        <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
          {departments.map((d) => (
            <li key={d.name} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
                <Swatch color={d.color} />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="shrink-0 tabular-nums text-foreground">
                <span className="font-semibold">{d.allocationPercent}%</span>
                {(canViewAllFinancials || (d.isSales && canViewSalesAmounts)) && <span className="ml-2 text-muted-foreground">{compactPHP(d.amount)}</span>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border">
          <UnderlineTabs
            tabs={[
              { value: "deals", label: "SORs", count: deals.length },
              { value: "people", label: "People", count: people.length },
            ]}
            value={list}
            onChange={(v) => {
              setList(v);
              setPage(0);
            }}
          />
          <div className="mb-2 flex w-full items-center gap-2 sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
                placeholder={list === "deals" ? "Search SORs, companies, owners…" : "Search people…"}
                aria-label="Search"
                className="h-8 rounded-lg border border-border bg-card pl-8 pr-3 text-sm outline-none"
              />
            </div>
            {canViewAllFinancials && (
              <Button type="button" variant="outline" size="sm" onClick={() => downloadLedgerCsv(deals)}>
                <Download /> Export CSV
              </Button>
            )}
          </div>
        </div>

        {list === "deals" ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SOR</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead>Deal Owner</TableHead>
                <TableHead className="text-right">Contract Value</TableHead>
                <TableHead className="text-right">Pool</TableHead>
                <TableHead className="text-right">Contract Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">No SORs match.</TableCell>
                </TableRow>
              ) : (
                pageRows.map((d) => (
                  <TableRow key={d.id} onClick={() => setOpenDealId(d.id)} className="cursor-pointer">
                    <TableCell>
                      <p className="font-medium text-foreground"><HighlightText text={d.clientName} search={search} /></p>
                      <p className="text-xs text-muted-foreground">
                        <span><HighlightText text={d.opportunityNo} search={search} /></span> · {projectTypeInfo(d.projectType)?.label ?? d.projectType}
                      </p>
                    </TableCell>
                    <TableCell><StatusBadge status={d.status} /></TableCell>
                    <TableCell className="text-muted-foreground">{d.participants?.dealOwner?.name ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-foreground">{formatPHP(d.contractValue)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums text-foreground">{canViewAllFinancials ? formatPHP(d.commissionPool) : MASK}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{d.contractDate ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead className="text-right">Won</TableHead>
                <TableHead>Share of the Sales fund</TableHead>
                <TableHead className="text-right">Commission</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">No one is credited in this period.</TableCell>
                </TableRow>
              ) : (
                pageRows.map((e) => {
                  const isMe = e.employeeId === user?.id;
                  const share = dashboard.salesDeptTotal ? (e.totalCommissionShare / dashboard.salesDeptTotal) * 100 : 0;
                  return (
                    <TableRow key={e.employeeId} onClick={() => navigate("/sors", { state: { filterEmployeeId: e.employeeId } })} className="cursor-pointer">
                      <TableCell>
                        <span className="flex items-center gap-2.5">
                          <Avatar name={e.name} src={e.avatarPath} size="sm" />
                          <span className="font-medium text-foreground">{e.name}</span>
                          {isMe && <span className="rounded bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground">You</span>}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{e.wonDealsCount}</TableCell>
                      <TableCell>
                        <span className="flex items-center gap-3">
                          <span className="h-1.5 w-32 overflow-hidden rounded-full bg-muted">
                            <span className="block h-full rounded-full" style={{ width: `${share}%`, background: TONE.sales.solid }} />
                          </span>
                          <span className="text-xs tabular-nums text-muted-foreground">{share.toFixed(1)}%</span>
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-foreground">
                        {canViewSalesAmounts || isMe ? formatPHP(e.totalCommissionShare) : MASK}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        )}
        <Pager page={safePage} pageSize={PAGE_SIZE} total={rows.length} onPage={setPage} />
      </section>

      <DealCommissionModal deal={openDeal} onClose={() => setOpenDealId(null)} access={access} />
    </div>
  );
}

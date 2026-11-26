// PROTOTYPE (throwaway) — Option B, "Like the S0 Evaluation".
// List: the S0 Evaluation list (filter bar, a totals row inside the table, rows under the go line tinted).
// Report: the record window as a sheet. One dense table per tab, prices and costs typed straight into
// the cells (saved when you leave the cell, like the Costing Matrix), the summary pinned on the right.
import { Fragment, useState } from "react";
import { Banknote, Calculator, Plus, RefreshCw, Trash2, TriangleAlert } from "lucide-react";

import PageShell from "../../../../components/ui/PageShell";
import EmptyState from "../../../../components/ui/EmptyState";
import QueryError from "../../../../components/ui/QueryError";
import PageLoading from "../../../../components/ui/PageLoading";
import ModalShell from "../../../../components/ui/ModalShell";
import TabGroup from "../../../../components/ui/TabGroup";
import StatusBadge from "../../../../components/StatusBadge";
import { Button } from "../../../../components/ui/button";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Input } from "../../../../components/ui/input";
import { Tooltip } from "../../../../components/ui/Tooltip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../../components/ui/table";
import RecordHeader from "../../../../components/record/RecordHeader";
import { Cell, SelectCell } from "../../../../components/costing/GridCell";
import { listDate } from "../../../../utils/listDates";
import { COST_GROUP, COST_GROUPS, DEFAULT_COST_GROUP } from "../../../../utils/opexReport";
import { HEALTH, STATE_WORDS, isGreyed, lineBadge, p0Groups, peso, useListRows, usePrefetchReport, useReport, unitPriceOf } from "./data";
import { AddP0Dialog, HEAD, ListFilterBar, ListTable, NewButton, NewReportDialog, SummaryList, TypedMark, useListFilters } from "./parts";

export function ListB({ onOpen, children }) {
  const { rows, isPending, isError, refetch } = useListRows();
  const f = useListFilters(rows);
  const prefetch = usePrefetchReport();
  const [creating, setCreating] = useState(false);
  return (
    <PageShell
      title="OPEX Report"
      description="Every S0's real spend from Odoo beside its contract price. Open one to check its lines and type what Odoo is missing."
      action={<NewButton onClick={() => setCreating(true)} />}
      toolbar={<ListFilterBar f={f} />}
    >
      {isPending && <PageLoading label="OPEX Reports" />}
      {isError && <QueryError title="OPEX Reports could not be loaded." onRetry={refetch} />}
      {!isPending && !isError && f.filtered.length === 0 && (
        <EmptyState icon={Banknote} title={rows.length === 0 ? "No OPEX Reports yet" : "No matching report"} description="Nothing matches. Try another search or clear the filters." />
      )}
      {!isPending && !isError && f.filtered.length > 0 && <ListTable rows={f.filtered} onOpen={onOpen} onHover={prefetch} totals="row" tintBelow search={f.search} />}
      <NewReportDialog open={creating} onOpenChange={setCreating} rows={rows} onOpen={onOpen} />
      {children}
    </PageShell>
  );
}

const SUB = "text-xs";
const NUM = "text-right text-xs tabular-nums";
const typedGroupLabel = (key) => COST_GROUPS.find((g) => g.key === key)?.label ?? key;
const GROUP_OPTIONS = COST_GROUPS.map((g) => ({ value: g.key, label: g.label }));

function P0Sheet({ view, actions, onAdd }) {
  const groups = p0Groups(view.lines);
  const total = view.lines.reduce((a, l) => a + l.countedPesos, 0);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Lines Odoo has at zero take a unit price in pesos. Type it in the cell; it saves when you leave the cell.</p>
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={onAdd}>
          <Plus size={14} /> Add P0
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={HEAD}>P0</TableHead>
              <TableHead className={HEAD}>Product</TableHead>
              <TableHead className={`${HEAD} text-right`}>Qty</TableHead>
              <TableHead className={`${HEAD} text-right`}>Unit price</TableHead>
              <TableHead className={`${HEAD} text-right`}>Share</TableHead>
              <TableHead className={`${HEAD} text-right`}>Counted</TableHead>
              <TableHead className={HEAD} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => {
              const hand = view.handP0s.find((h) => h.p0_number === g.p0);
              return g.lines.map((l, i) => {
                const badge = lineBadge(l);
                return (
                  <TableRow key={l.lineId} className={`${i === 0 ? "border-t-2 border-t-border" : ""} ${isGreyed(l) ? "text-muted-foreground" : ""}`}>
                    <TableCell className="align-top">
                      {i === 0 && (
                        <>
                          <span className="block font-mono text-xs font-semibold text-foreground">
                            {g.p0}
                            {hand && <TypedMark title="Added by hand" />}
                          </span>
                          <span className="block max-w-[14rem] truncate text-xs text-muted-foreground" title={g.supplier}>
                            {g.supplier} · {STATE_WORDS[g.state] ?? g.state}
                          </span>
                          {hand && (
                            <Button type="button" size="xs" variant="link" className="h-auto p-0 text-xs text-muted-foreground" onClick={() => actions.removeP0(hand.id)}>
                              Remove
                            </Button>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className={`${SUB} max-w-[20rem]`}>
                      <span className={`line-clamp-2 ${isGreyed(l) ? "line-through decoration-mauve-8" : "text-foreground"}`} title={l.product}>
                        {l.product}
                      </span>
                    </TableCell>
                    <TableCell className={NUM}>{l.quantity}</TableCell>
                    <TableCell className={`${NUM} w-40`}>
                      {l.canType ? (
                        <Cell
                          className="ml-auto w-32"
                          label={`Unit price for ${l.p0} ${l.product}`}
                          noun="Unit price"
                          value={l.typedPrice}
                          placeholder="0.00"
                          numeric
                          money
                          align="right"
                          onSave={async (v) => actions.setLinePrice(l.lineId, v)}
                        />
                      ) : (
                        peso(unitPriceOf(l))
                      )}
                    </TableCell>
                    <TableCell className={NUM}>{l.sharePercent}%</TableCell>
                    <TableCell className={`${NUM} font-mono ${isGreyed(l) ? "" : "text-foreground"}`}>{peso(l.countedPesos)}</TableCell>
                    <TableCell className="text-right">{badge && <StatusBadge label={badge.label} theme={badge.theme} />}</TableCell>
                  </TableRow>
                );
              });
            })}
            <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
              <TableCell colSpan={5} className="text-xs">
                Counted to this S0 · {view.lines.filter((l) => l.countedPesos > 0).length} of {view.lines.length} lines
              </TableCell>
              <TableCell className={`${NUM} font-mono`}>{peso(total)}</TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ExpenseSheet({ view, actions }) {
  const groups = COST_GROUPS.filter((g) => g.key !== COST_GROUP.PRODUCT).map((g) => ({
    ...g,
    rows: view.expenses.filter((e) => (g.key === COST_GROUP.MARKETING ? e.group === COST_GROUP.MARKETING : e.group !== COST_GROUP.MARKETING)),
  }));
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Untick an expense to leave it out. It stays here, crossed out, and stops counting.</p>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className={`${HEAD} w-16`}>Counts</TableHead>
              <TableHead className={HEAD}>Date</TableHead>
              <TableHead className={HEAD}>Description</TableHead>
              <TableHead className={HEAD}>Odoo account</TableHead>
              <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((g) => (
              <Fragment key={g.key}>
                <TableRow className="bg-muted/20 hover:bg-muted/20">
                  <TableCell colSpan={4} className="text-xs font-semibold text-muted-foreground">
                    {g.label} <span className="font-medium">· {g.rows.length}</span>
                  </TableCell>
                  <TableCell className={`${NUM} font-mono font-semibold text-foreground`}>{peso(g.rows.filter((e) => !e.leftOut).reduce((a, e) => a + e.amount, 0))}</TableCell>
                </TableRow>
                {g.rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-xs text-muted-foreground">
                      Nothing in this group.
                    </TableCell>
                  </TableRow>
                )}
                {g.rows.map((e) => (
                  <TableRow key={e.analyticLineId} className={e.leftOut ? "text-muted-foreground" : ""}>
                    <TableCell>
                      <Checkbox tone="neutral" checked={!e.leftOut} onCheckedChange={(on) => actions.setLeftOut(e.analyticLineId, !on)} aria-label={`Count ${e.description}`} />
                    </TableCell>
                    <TableCell className={`${SUB} whitespace-nowrap`}>{e.date ? listDate(e.date) : "—"}</TableCell>
                    <TableCell className={SUB}>
                      <span className={e.leftOut ? "line-through decoration-mauve-8" : "text-foreground"}>{e.description}</span>
                    </TableCell>
                    <TableCell className={`${SUB} text-muted-foreground`}>{e.account}</TableCell>
                    <TableCell className={`${NUM} font-mono ${e.leftOut ? "line-through decoration-mauve-8" : "text-foreground"}`}>{peso(e.amount)}</TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function TypedSheet({ costs, actions }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Costs Odoo does not have. Each counts in the group you pick.</p>
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => actions.saveTypedCost({ id: null, description: "", amount: 0, cost_date: "", note: "", cost_group: DEFAULT_COST_GROUP })}>
          <Plus size={14} /> Add row
        </Button>
      </div>
      {costs.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No Typed costs yet.</p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className={HEAD}>Description</TableHead>
                <TableHead className={HEAD}>Date</TableHead>
                <TableHead className={HEAD}>Counts as</TableHead>
                <TableHead className={HEAD}>Note</TableHead>
                <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
                <TableHead className={HEAD} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {costs.map((c) => (
                <TableRow key={c.id} className="hover:bg-transparent">
                  <TableCell className="min-w-[12rem]">
                    <Cell label="Description" value={c.description} placeholder="What was it?" onSave={async (v) => actions.saveTypedCost({ ...c, cost_group: c.group, description: v ?? "" })} />
                  </TableCell>
                  <TableCell className="w-40">
                    <Input type="date" className="h-9 rounded-lg text-sm" value={c.cost_date ?? ""} onChange={(e) => actions.saveTypedCost({ ...c, cost_group: c.group, cost_date: e.target.value })} aria-label="Date" />
                  </TableCell>
                  <TableCell className="w-48">
                    <SelectCell label="Counts as" value={c.group} options={GROUP_OPTIONS} clearable={false} onSave={async (v) => actions.saveTypedCost({ ...c, cost_group: v })} />
                  </TableCell>
                  <TableCell>
                    <Cell label="Note" value={c.note ?? ""} placeholder="Optional" onSave={async (v) => actions.saveTypedCost({ ...c, cost_group: c.group, note: v ?? "" })} />
                  </TableCell>
                  <TableCell className="w-40">
                    <Cell label="Amount" noun="Amount" value={c.amount} numeric money align="right" onSave={async (v) => actions.saveTypedCost({ ...c, cost_group: c.group, amount: v ?? 0 })} />
                  </TableCell>
                  <TableCell className="w-10">
                    <Tooltip content="Delete this row">
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${c.description || "row"}`} onClick={() => actions.deleteTypedCost(c.id)}>
                        <Trash2 size={14} />
                      </Button>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="bg-muted/40 font-semibold hover:bg-muted/40">
                <TableCell colSpan={4} className="text-xs">
                  {COST_GROUPS.map((g) => `${g.label} ${peso(costs.filter((c) => c.group === g.key).reduce((a, c) => a + c.amount, 0))}`).join(" · ")}
                </TableCell>
                <TableCell className={`${NUM} font-mono`}>{peso(costs.reduce((a, c) => a + c.amount, 0))}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function SheetSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border border-border bg-card p-4" aria-label="Reading Odoo">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="h-5 animate-pulse rounded bg-muted" style={{ width: `${92 - (i % 3) * 14}%` }} />
      ))}
      <p className="pt-1 text-xs text-muted-foreground">Reading Odoo…</p>
    </div>
  );
}

export function RecordB({ s0, onClose }) {
  const r = useReport(s0);
  const { view, quick, read, readQuery, edits, actions, settings } = r;
  const [tab, setTab] = useState("p0");
  const [addingP0, setAddingP0] = useState(false);
  const health = quick ? (quick.revenue < 0 ? "loss" : quick.revenuePercent < Number(settings?.goLinePercent ?? 20) ? "below" : "on_target") : "unread";
  const typedCosts = view?.typedCosts ?? edits.typedCosts.map((c) => ({ ...c, amount: Number(c.amount), group: c.cost_group }));

  return (
    <>
      <ModalShell
        open
        onOpenChange={(n) => !n && onClose()}
        size="record"
        crumbs={["OPEX Report", s0]}
        headerActions={
          <Button size="sm" variant="outline" className="mr-1 gap-1.5" disabled={readQuery.isFetching} onClick={() => readQuery.refetch()}>
            <RefreshCw size={14} className={readQuery.isFetching ? "animate-spin" : ""} />
            Read again
          </Button>
        }
      >
        <div className="space-y-4 pb-2">
          <RecordHeader
            reference={s0}
            name={view?.projectName ?? r.record?.snapshot?.project_name ?? undefined}
            badge={HEALTH[health]}
            line={
              read
                ? `Read from Odoo ${listDate(read.readAt)}, ${new Date(read.readAt).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}${r.hasStubEdits ? " · Prototype: your changes are not saved" : ""}`
                : "Reading Odoo… the summary shows the figures saved last time."
            }
          />
          {read?.noProjectTag && (
            <p className="flex items-start gap-2 rounded-xl bg-amber-a3 px-3 py-2 text-[13px] text-amber-12">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" /> Odoo has no Project tag for {s0}. Only P0s whose Source Document names it are shown.
            </p>
          )}
          {readQuery.isError && (
            <div role="alert" className="rounded-xl border border-red-6 bg-red-a2 px-4 py-3 text-sm text-red-11">
              Odoo could not be read. The summary shows the figures saved last time.
            </div>
          )}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="min-w-0 space-y-3">
              <TabGroup
                variant="underline"
                activeTab={tab}
                onChange={setTab}
                tabs={[
                  { value: "p0", label: "P0 lines", badge: view?.lines.length },
                  { value: "expenses", label: "Expenses", badge: view?.expenses.length },
                  { value: "typed", label: "Typed costs", badge: typedCosts.length },
                ]}
              />
              {tab === "typed" ? (
                <TypedSheet costs={typedCosts} actions={actions} />
              ) : !view ? (
                <SheetSkeleton />
              ) : tab === "p0" ? (
                <P0Sheet view={view} actions={actions} onAdd={() => setAddingP0(true)} />
              ) : (
                <ExpenseSheet view={view} actions={actions} />
              )}
            </div>
            <aside className="self-start rounded-xl border border-border/70 bg-card p-4 xl:sticky xl:top-0" aria-label="Summary">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
                <Calculator size={14} aria-hidden="true" />
                Summary
              </h3>
              <SummaryList quick={quick} edits={edits} read={read} settings={settings} actions={actions} />
            </aside>
          </div>
        </div>
      </ModalShell>
      <AddP0Dialog open={addingP0} onOpenChange={setAddingP0} onAdd={actions.addP0} />
    </>
  );
}


